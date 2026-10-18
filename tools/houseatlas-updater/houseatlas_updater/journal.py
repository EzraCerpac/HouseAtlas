"""One stable flock inode and one atomically synced bounded operation journal."""

import fcntl
import json
import os
import stat
from pathlib import Path

from .archive import sync_directory
from .model import UpdateError
from .validation import canonical, digest, operation_id, private_directory, require


TERMINAL = {"checked", "succeeded", "rolled-back", "rejected", "recovery-needed"}
PHASES = TERMINAL | {"checking", "staging", "staged", "stopping", "publishing",
                     "starting", "verifying", "rolling-back"}
CODES = {
    "none", "invalid-request", "layout-invalid", "platform-incompatible", "busy",
    "journal-invalid", "journal-full", "operation-conflict", "recovery-required",
    "acquisition-failed", "producer-untrusted", "digest-mismatch", "manifest-invalid",
    "release-identity-mismatch", "state-incompatible", "installed-invalid",
    "installed-changed", "component-incompatible", "archive-invalid", "health-failed",
    "boundary-failed", "interrupted", "rollback-incompatible", "rollback-failed",
}


def private_file(path: Path, create: bool = False) -> int:
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
    descriptor = os.open(path, flags | (os.O_CREAT if create else 0), 0o600)
    meta = os.fstat(descriptor)
    if not (stat.S_ISREG(meta.st_mode) and stat.S_IMODE(meta.st_mode) == 0o600
            and meta.st_uid == os.geteuid() and meta.st_nlink == 1):
        os.close(descriptor)
        raise UpdateError("journal-invalid")
    return descriptor


class Journal:
    LIMIT = 2 * 1024 * 1024
    MAX_OPERATIONS = 256

    def __init__(self, directory: Path):
        self.directory = directory
        self.descriptor = None
        self.data = None

    def __enter__(self):
        private_directory(self.directory)
        self.root_identity = (self.directory.stat().st_dev, self.directory.stat().st_ino)
        self.descriptor = private_file(self.directory / "updater.lock", create=True)
        try:
            fcntl.flock(self.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.descriptor)
            self.descriptor = None
            raise UpdateError("busy") from None
        try:
            sync_directory(self.directory)
            self.data = self.read(self.directory)
            self.check()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None

    def check(self):
        require(self.descriptor is not None, "journal-invalid")
        private_directory(self.directory)
        named = (self.directory.stat().st_dev, self.directory.stat().st_ino)
        require(named == self.root_identity, "journal-invalid")
        opened = os.fstat(self.descriptor)
        current = (self.directory / "updater.lock").lstat()
        require(current.st_dev == opened.st_dev and current.st_ino == opened.st_ino
                and not stat.S_ISLNK(current.st_mode), "journal-invalid")

    @classmethod
    def read(cls, directory: Path) -> dict:
        private_directory(directory)
        try:
            descriptor = private_file(directory / "journal.json")
        except FileNotFoundError:
            return {"format": "houseatlas.updater.journal.v1", "sequence": 0,
                    "current": None, "operations": {}}
        with os.fdopen(descriptor, "rb") as source:
            require(os.fstat(source.fileno()).st_size <= cls.LIMIT, "journal-invalid")
            raw = source.read(cls.LIMIT + 1)
        try:
            data = json.loads(raw)
            require(set(data) == {"format", "sequence", "current", "operations"} and
                    data["format"] == "houseatlas.updater.journal.v1" and
                    type(data["sequence"]) is int and data["sequence"] >= 0 and
                    type(data["operations"]) is dict and
                    len(data["operations"]) <= cls.MAX_OPERATIONS, "journal-invalid")
            require(data["current"] is None or data["current"] in data["operations"],
                    "journal-invalid")
            for key, entry in data["operations"].items():
                operation_id(key)
                require(set(entry) == {"requestSha256", "status"} and
                        digest(entry["requestSha256"]), "journal-invalid")
                validate_status(entry["status"])
                require(entry["status"]["operationId"] == key and
                        entry["status"]["sequence"] <= data["sequence"], "journal-invalid")
        except (TypeError, ValueError, KeyError, RecursionError, UpdateError):
            raise UpdateError("journal-invalid") from None
        return data

    def save(self):
        self.check()
        raw = canonical(self.data)
        require(len(raw) <= self.LIMIT, "journal-full")
        # An unfinished .next is deliberate recovery evidence, never adopted or
        # overwritten by a later process. Ordinary I/O failures fail closed.
        path = self.directory / "journal.next"
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        self.check()
        os.replace(path, self.directory / "journal.json")
        sync_directory(self.directory)

    def existing(self, identifier: str, request_sha256: str) -> dict | None:
        require(not (self.directory / "journal.next").exists() and
                not (self.directory / "journal.next").is_symlink(), "recovery-required")
        entry = self.data["operations"].get(identifier)
        if entry is not None:
            require(entry["requestSha256"] == request_sha256, "operation-conflict")
            if entry["status"]["phase"] not in TERMINAL:
                self.transition(identifier, "recovery-needed", "interrupted",
                                rollback="blocked", active=None, healthVerified=False)
            return entry["status"].copy()
        for entry in self.data["operations"].values():
            if entry["status"]["phase"] not in TERMINAL:
                self.transition(entry["status"]["operationId"], "recovery-needed", "interrupted",
                                rollback="blocked", active=None, healthVerified=False)
            require(entry["status"]["phase"] != "recovery-needed", "recovery-required")
        return None

    def begin(self, status: dict, request_sha256: str):
        require(len(self.data["operations"]) < self.MAX_OPERATIONS, "journal-full")
        identifier = status["operationId"]
        self.data["operations"][identifier] = {"requestSha256": request_sha256, "status": status}
        self.data["current"] = identifier
        return self.transition(identifier, "checking", "none")

    def transition(self, identifier: str, phase: str, code: str, **fields) -> dict:
        self.check()
        self.data["sequence"] += 1
        status = self.data["operations"][identifier]["status"]
        status.update(fields)
        status.update(phase=phase, code=code, sequence=self.data["sequence"],
                      recoveryNeeded=phase == "recovery-needed")
        # The clock is diagnostic only; ordering and idempotence use sequence/ID.
        from datetime import datetime, timezone
        status["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        validate_status(status)
        self.save()
        return status.copy()


def validate_status(value: dict) -> None:
    require(type(value) is dict and set(value) == {
        "format", "operationId", "action", "sequence", "updatedAt", "phase", "code",
        "expectedInstalledRevision", "requested", "previous", "active", "compatibility",
        "rollback", "healthVerified", "recoveryNeeded",
        "bundleContract",
    }, "journal-invalid")
    require(value["format"] == "houseatlas.updater.status.v1" and
            value["phase"] in PHASES and value["code"] in CODES and
            value["action"] in ("check", "apply") and
            value["bundleContract"] in ("unverified", "provisional-fixture", "houseatlas.release-bundle.v1") and
            type(value["sequence"]) is int and value["sequence"] > 0 and
            type(value["updatedAt"]) is str and len(value["updatedAt"]) <= 40 and
            value["compatibility"] in ("unknown", "compatible", "incompatible") and
            value["rollback"] in ("unknown", "eligible", "blocked") and
            type(value["healthVerified"]) is bool and type(value["recoveryNeeded"]) is bool and
            value["recoveryNeeded"] == (value["phase"] == "recovery-needed"), "journal-invalid")
    from .validation import selection
    operation_id(value["operationId"])
    require(digest(value["expectedInstalledRevision"]), "journal-invalid")
    selection(value["requested"])
    for name in ("previous", "active"):
        installed = value[name]
        if installed is not None:
            require(set(installed) == {"revision", "release", "frontendIdentity", "frontendShellIdentity"} and
                    digest(installed["revision"]) and digest(installed["frontendIdentity"]) and
                    (installed["frontendShellIdentity"] is None or digest(installed["frontendShellIdentity"])),
                    "journal-invalid")
            selection(installed["release"])
