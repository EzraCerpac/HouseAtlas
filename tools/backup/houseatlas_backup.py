#!/usr/bin/env python3
"""Nightly HouseAtlas backup to iCloud Drive with a proven restore.

One run:
  1. stops the HouseAtlas launchd service, runs the native `backup` CLI against
     the live data directory, and starts the service again (seconds of downtime);
  2. lists the served model release with every file's hash and checks its pins;
  3. restores the bundle into a fresh folder with `restore-check`;
  4. stores each model file in iCloud once, named by its SHA-256, so an
     unchanged release adds nothing; the nightly archive only lists them;
  5. packs the bundle and report into one archive and copies it to iCloud;
  6. waits until iCloud reports the uploads done, evicts the local copies,
     downloads them again from iCloud, compares the bytes, repeats the
     restore check on the downloaded bundle, and rebuilds the model folders
     from the stored blobs.

Nothing in iCloud is ever deleted or overwritten. The live database is only
read through the backup CLI while the service is stopped. All private paths
come from a JSON config outside the repository (see docs/operations/icloud-backup.md).
Standard library only; the iCloud steps need the `houseatlas-icloud` helper and
the run must be started through the `houseatlas-backup` launcher, which holds
the iCloud Drive permission.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PROFILE = "native-stock-queue-free"
ARCHIVE_PREFIX = "houseatlas-backup-"
# Model files are stored once in this iCloud subfolder, under blobs/<sha256>.
MODEL_STORE = "models"
MODEL_FLAGS = (
    "--model-overview-manifest",
    "--atlas-scene-manifest",
    "--atlas-room-links-manifest",
)


class StepFailed(Exception):
    def __init__(self, step: str, detail: str):
        super().__init__(f"{step}: {detail}")
        self.step = step
        self.detail = detail


def expand(value: str) -> Path:
    return Path(os.path.expanduser(value))


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run(step: str, command: list[str], timeout: float = 600) -> str:
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired:
        raise StepFailed(step, f"timed out after {timeout:.0f}s") from None
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise StepFailed(step, f"exit {result.returncode}: {detail[-1] if detail else ''}")
    return result.stdout


def private_dir(path: Path) -> Path:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path.resolve()


class Config:
    def __init__(self, path: Path):
        raw = json.loads(path.read_text())
        self.service_label: str = raw["serviceLabel"]
        self.service_plist = expand(raw["servicePlist"])
        self.state_directory = expand(raw["stateDirectory"])
        self.icloud_directory = expand(raw["icloudDirectory"])
        self.icloud_helper = expand(raw["icloudHelper"])
        self.health_url: str | None = raw.get("healthUrl")
        self.restore_check_binary = (
            expand(raw["restoreCheckBinary"]) if raw.get("restoreCheckBinary") else None
        )
        self.upload_timeout = float(raw.get("uploadTimeoutSeconds", 3600))
        self.keep_local_archives = int(raw.get("keepLocalArchives", 3))
        if self.keep_local_archives < 1:
            raise ValueError("keepLocalArchives must be at least 1")
        self.report_command: list[str] | None = raw.get("reportCommand")


class Service:
    """The live server as launchd runs it, read from its plist every run so a
    deploy that swaps the binary or config is picked up automatically."""

    def __init__(self, config: Config):
        self.label = config.service_label
        self.plist = config.service_plist
        self.domain = f"gui/{os.getuid()}"
        arguments = plistlib.loads(self.plist.read_bytes())["ProgramArguments"]
        self.binary = Path(arguments[0])
        options = dict(zip(arguments[1:], arguments[2:]))
        self.server_config = Path(options["--server-config"])
        self.models = [
            (Path(options[flag]), options.get(f"{flag}-sha256"))
            for flag in MODEL_FLAGS
            if flag in options
        ]

    def pid(self) -> int | None:
        result = subprocess.run(
            ["launchctl", "print", f"{self.domain}/{self.label}"],
            capture_output=True, text=True, check=False,
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("pid = "):
                return int(line.split("=", 1)[1])
        return None

    def stop(self) -> None:
        run("stop service", ["launchctl", "bootout", f"{self.domain}/{self.label}"], 120)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            result = subprocess.run(
                ["launchctl", "print", f"{self.domain}/{self.label}"],
                capture_output=True, check=False,
            )
            if result.returncode != 0:
                return
            time.sleep(1)
        raise StepFailed("stop service", "service still loaded after 120s")

    def start(self) -> None:
        try:
            run("start service", ["launchctl", "bootstrap", self.domain, str(self.plist)], 120)
        except StepFailed:
            # A failed stop can leave the service loaded; that is the goal state.
            if self.pid() is None:
                raise


def wait_healthy(service: Service, health_url: str | None) -> None:
    deadline = time.monotonic() + 180
    last = "no response"
    while time.monotonic() < deadline:
        if service.pid() is not None:
            if not health_url:
                return
            try:
                with urllib.request.urlopen(health_url, timeout=10) as response:
                    if response.status == 200:
                        return
                    last = f"HTTP {response.status}"
            except (urllib.error.URLError, OSError) as error:
                last = str(error)
        time.sleep(3)
    raise StepFailed("service health", f"not healthy after restart: {last}")


def capture(service: Service, config: Config, bundle: Path) -> dict:
    """Stop, back up, start. The start always runs, even if the backup fails."""
    if service.pid() is None:
        raise StepFailed("stop service", "service is not running; refusing to touch it")
    try:
        service.stop()
        report = run(
            "native backup",
            [str(service.binary), "backup", "--server-config", str(service.server_config),
             "--destination", str(bundle), "--profile", PROFILE],
        )
    finally:
        service.start()
        wait_healthy(service, config.health_url)
    return json.loads(report)


def list_models(service: Service) -> list[dict]:
    """List every file of each served publication folder with its hash and
    size, after checking the manifests against the hashes the service was
    started with and the model files against the manifests' pins."""
    folders: list[Path] = []
    for manifest, expected in service.models:
        if expected and sha256_file(manifest) != expected:
            raise StepFailed("model release", f"{manifest.name} hash differs from the service")
        check_pinned_original(manifest)
        if manifest.parent not in folders:
            folders.append(manifest.parent)
    models = []
    for folder in folders:
        name = Path(folder.parent.name) / folder.name
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            models.append({
                "file": str(name / path.relative_to(folder)),
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
                "source": path,
            })
    return models


def check_pinned_original(manifest: Path) -> None:
    """The served manifests pin the model file (and an optional detail model) by
    digest and size; a copy whose model no longer matches would not load, so it
    is not a valid backup."""
    pinned = json.loads(manifest.read_text())
    for key, default in (("original", "overview.glb"), ("detail", "detail.glb")):
        pin = pinned.get(key)
        if not isinstance(pin, dict):
            continue
        path = manifest.parent / pin.get("file", default)
        if (not path.is_file() or path.stat().st_size != pin.get("bytes")
                or sha256_file(path) != pin.get("sha256")):
            raise StepFailed("model release", f"{path.name} differs from {manifest.name}")


def check_models(root: Path, models: list[dict]) -> None:
    for model in models:
        if sha256_file(root / model["file"]) != model["sha256"]:
            raise StepFailed("model release", f"{model['file']} differs from the served copy")
        if model["file"].endswith(".json"):
            check_pinned_original(root / model["file"])


def copy_checked(source: Path, target: Path, sha256: str, step: str) -> None:
    """Exclusively create target (mode 0600) from source, failing if the bytes
    written do not hash to sha256."""
    digest = hashlib.sha256()
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with source.open("rb") as read, os.fdopen(descriptor, "wb") as write:
        for block in iter(lambda: read.read(1 << 20), b""):
            digest.update(block)
            write.write(block)
        write.flush()
        os.fsync(write.fileno())
    if digest.hexdigest() != sha256:
        raise StepFailed(step, f"{target.name} does not match its recorded hash")


def store_models(store: Path, models: list[dict], stamp: str) -> list[Path]:
    """Model files live in iCloud once, named by their SHA-256, so a release
    that did not change costs nothing the next night. Returns the blobs this
    run created; existing blobs are never replaced."""
    blobs = private_dir(store / "blobs")
    created = []
    for model in models:
        blob = blobs / model["sha256"]
        if blob.exists() or blob in created:
            continue
        # Write under a run-specific name and rename, so a crash never leaves a
        # truncated file under the final name, which could not be replaced.
        partial = blobs / f"{model['sha256']}.partial-{stamp}"
        try:
            copy_checked(model["source"], partial, model["sha256"], "model store")
        except BaseException:
            partial.unlink(missing_ok=True)  # never a backup; only this run's scratch
            raise
        if blob.exists():
            raise StepFailed("model store", f"{blob.name} appeared during the copy")
        partial.rename(blob)
        created.append(blob)
    return created


def check_model_list(models) -> None:
    """A report's model list names blobs and restore paths; refuse anything but
    relative file names and 64-hex digests before any file is opened."""
    if not isinstance(models, list):
        raise StepFailed("model restore", "report has no model list")
    for model in models:
        if not (isinstance(model, dict) and isinstance(model.get("file"), str)
                and isinstance(model.get("sha256"), str) and isinstance(model.get("bytes"), int)
                and re.fullmatch(r"[0-9a-f]{64}", model["sha256"])):
            raise StepFailed("model restore", f"malformed model entry {model!r}")
        parts = Path(model["file"]).parts
        if not parts or Path(model["file"]).is_absolute() or ".." in parts:
            raise StepFailed("model restore", f"unsafe file name {model['file']!r}")


def restore_models(store: Path, models: list[dict], destination: Path, fetch=None) -> None:
    """Rebuild the served publication folders from the blob store, as a restore
    does: every file is copied from its blob and checked against its hash, and
    every manifest's model pins are checked again."""
    check_model_list(models)
    for model in models:
        parts = Path(model["file"]).parts
        blob = store / "blobs" / model["sha256"]
        if fetch:
            fetch(blob)  # before the check: an evicted item may not be local yet
        if not blob.is_file():
            raise StepFailed("model restore", f"blob for {model['file']} is missing")
        folder = destination
        for part in parts[:-1]:
            folder = private_dir(folder / part)
        copy_checked(blob, folder / parts[-1], model["sha256"], "model restore")
    check_models(destination, models)


def restore_check(binary: Path, bundle: Path, destination: Path, step: str) -> dict:
    report = json.loads(run(
        step,
        [str(binary), "restore-check", "--bundle", str(bundle),
         "--destination", str(destination), "--profile", PROFILE],
    ))
    shutil.rmtree(destination)
    return report


def pack(work: Path, archive: Path) -> None:
    with tarfile.open(archive, "w:gz") as tar:
        for name in ("bundle", "backup-report.json"):
            tar.add(work / name, arcname=name)


def unpack(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(destination, filter="tar")


def icloud(config: Config, action: str, path: Path) -> dict:
    return json.loads(run(f"iCloud {action}", [str(config.icloud_helper), action, str(path)], 120))


def wait_for(config: Config, path: Path, step: str, done) -> dict:
    deadline = time.monotonic() + config.upload_timeout
    while True:
        state = icloud(config, "status", path)
        if not state.get("ubiquitous"):
            raise StepFailed(step, "destination is not in iCloud Drive")
        if done(state):
            return state
        if time.monotonic() > deadline:
            error = state.get("uploadingError") or state.get("downloadingError") or "no error reported"
            raise StepFailed(step, f"not done after {config.upload_timeout:.0f}s ({error})")
        time.sleep(15)


def upload_and_round_trip(config: Config, archive: Path, checksum: str, work: Path) -> Path:
    folder = config.icloud_directory
    folder.mkdir(exist_ok=True)
    target = folder / archive.name
    try:
        # Exclusive creation: an existing file in iCloud is never replaced.
        with archive.open("rb") as source, target.open("xb") as copy:
            shutil.copyfileobj(source, copy, 1 << 20)
            copy.flush()
            os.fsync(copy.fileno())
        with (folder / f"{archive.name}.sha256").open("x") as sidecar:
            sidecar.write(f"{checksum}  {archive.name}\n")
    except FileExistsError:
        raise StepFailed("iCloud copy", f"{archive.name} already exists; not overwriting") from None

    wait_for(config, target, "iCloud upload", lambda s: s.get("uploaded"))
    wait_for(config, folder / f"{archive.name}.sha256", "iCloud upload", lambda s: s.get("uploaded"))
    icloud(config, "evict", target)
    wait_for(config, target, "iCloud evict", lambda s: s.get("downloadingStatus") != "NSURLUbiquitousItemDownloadingStatusCurrent")
    icloud(config, "download", target)
    wait_for(config, target, "iCloud download", lambda s: s.get("downloadingStatus") == "NSURLUbiquitousItemDownloadingStatusCurrent")

    downloaded = work / "downloaded.tar.gz"
    shutil.copyfile(target, downloaded)
    if sha256_file(downloaded) != checksum:
        raise StepFailed("iCloud download", "downloaded archive differs from the uploaded one")
    return downloaded


def settle_blobs(config: Config, store: Path, models: list[dict], created: list[Path]) -> None:
    """Wait until every blob the archive names is uploaded, reused ones too (a
    blob an earlier run created may never have finished uploading), then evict
    this run's new blobs, so the restore check below reads them back from iCloud."""
    for blob in dict.fromkeys(store / "blobs" / model["sha256"] for model in models):
        wait_for(config, blob, "iCloud upload", lambda s: s.get("uploaded"))
    for blob in created:
        icloud(config, "evict", blob)
        wait_for(config, blob, "iCloud evict", lambda s: s.get("downloadingStatus") != "NSURLUbiquitousItemDownloadingStatusCurrent")


def fetch_from_icloud(config: Config):
    def fetch(path: Path) -> None:
        icloud(config, "download", path)
        wait_for(config, path, "iCloud download", lambda s: s.get("downloadingStatus") == "NSURLUbiquitousItemDownloadingStatusCurrent")
    return fetch


def prune_local(archives: Path, keep: int) -> None:
    """Local copies on the NAS only. iCloud copies are never deleted."""
    local = sorted(archives.glob(f"{ARCHIVE_PREFIX}*.tar.gz"))
    for old in local[: max(0, len(local) - keep)]:
        old.unlink()


def prune_runs(runs: Path, keep: int) -> None:
    """Failed runs keep their work folder for inspection; cap how many stay."""
    failed = sorted(path for path in runs.iterdir() if path.is_dir())
    for old in failed[: max(0, len(failed) - keep)]:
        shutil.rmtree(old)


def report_failure(config: Config, message: str) -> None:
    if not config.report_command:
        return
    try:
        subprocess.run(
            [part.replace("{message}", message) for part in config.report_command],
            capture_output=True, timeout=120, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def backup(config: Config) -> dict:
    started = now()
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    state = private_dir(config.state_directory)
    prune_runs(private_dir(state / "runs"), 2)
    work = private_dir(state / "runs" / stamp)
    archives = private_dir(state / "archives")
    prune_local(archives, config.keep_local_archives)
    timings: dict[str, float] = {}

    def timed(name: str, function, *args):
        begin = time.monotonic()
        result = function(*args)
        timings[name] = round(time.monotonic() - begin, 1)
        return result

    service = Service(config)
    restore_binary = config.restore_check_binary or service.binary
    capture_report = timed("captureSeconds", capture, service, config, work / "bundle")
    listed = timed("modelSeconds", list_models, service)
    models = [{key: model[key] for key in ("file", "sha256", "bytes")} for model in listed]
    local_restore = timed(
        "localRestoreSeconds", restore_check, restore_binary, work / "bundle",
        work / "restore-local", "restore check (local)",
    )
    report = {
        "format": "houseatlas-icloud-backup-report/2",
        "recoveryPoint": started.isoformat(timespec="seconds"),
        "serverBinarySha256": sha256_file(service.binary),
        "capture": capture_report,
        "modelStore": MODEL_STORE,
        "models": models,
    }
    (work / "backup-report.json").write_text(json.dumps(report, indent=2) + "\n")

    # Blobs go up before the archive that names them, so no archive in iCloud
    # ever points at a model file that is not there.
    config.icloud_directory.mkdir(exist_ok=True)
    store = config.icloud_directory / MODEL_STORE
    stored = timed("modelStoreSeconds", store_models, store, listed, stamp)
    timed("modelUploadSeconds", settle_blobs, config, store, models, stored)

    archive = archives / f"{ARCHIVE_PREFIX}{stamp}.tar.gz"
    timed("packSeconds", pack, work, archive)
    checksum = sha256_file(archive)
    downloaded = timed("icloudRoundTripSeconds", upload_and_round_trip, config, archive, checksum, work)

    verify = private_dir(work / "verify")
    unpack(downloaded, verify)
    cloud_restore = timed(
        "cloudRestoreSeconds", restore_check, restore_binary, verify / "bundle",
        work / "restore-cloud", "restore check (from iCloud)",
    )
    if cloud_restore != local_restore:
        raise StepFailed("restore check (from iCloud)", "differs from the local restore")
    restored = json.loads((verify / "backup-report.json").read_text())["models"]
    if restored != models:
        raise StepFailed("model restore", "downloaded report lists other model files")
    timed("modelRestoreSeconds", restore_models, store, restored,
          private_dir(work / "restore-model"), fetch_from_icloud(config))

    shutil.rmtree(work)
    prune_local(archives, config.keep_local_archives)
    result = {
        "status": "ok",
        "recoveryPoint": report["recoveryPoint"],
        "archive": archive.name,
        "archiveSha256": checksum,
        "archiveBytes": archive.stat().st_size,
        "assetRecordCount": cloud_restore["assetRecordCount"],
        "restoredOriginalCount": cloud_restore["restoredOriginalCount"],
        "databaseSha256": cloud_restore["databaseSha256"],
        "modelFileCount": len(models),
        "modelBlobsStored": len(stored),
        "modelBytesStored": sum({m["sha256"]: m["bytes"] for m in models}[blob.name] for blob in stored),
        "timings": timings,
        "finished": now().isoformat(timespec="seconds"),
    }
    (state / "last-success.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def restore_models_command(report: Path, store: Path, destination: Path) -> int:
    """Rebuild the model folders an unpacked archive names, from the iCloud
    blob store, into a new folder. Reading an evicted blob downloads it."""
    if destination.exists():
        print(f"{destination} exists; restore into a new folder", file=sys.stderr)
        return 64
    models = json.loads(report.read_text()).get("models")
    try:
        check_model_list(models)
        restore_models(store, models, private_dir(destination))
    except StepFailed as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({"status": "ok", "modelFileCount": len(models), "destination": str(destination)}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", type=Path, help="run the nightly backup")
    parser.add_argument("--restore-models", type=Path, metavar="REPORT",
                        help="rebuild the model folders named in an archive's backup-report.json")
    parser.add_argument("--store", type=Path, help="with --restore-models: the iCloud models folder")
    parser.add_argument("--destination", type=Path, help="with --restore-models: a new folder")
    args = parser.parse_args()
    if args.restore_models:
        if not (args.store and args.destination):
            parser.error("--restore-models needs --store and --destination")
        return restore_models_command(args.restore_models, args.store, args.destination)
    if not args.config:
        parser.error("--config is required")
    config = Config(args.config)
    state = private_dir(config.state_directory)
    with open(state / "run.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another backup run is in progress", file=sys.stderr)
            return 75
        try:
            result = backup(config)
        except StepFailed as error:
            failure = {"status": "failed", "step": error.step, "detail": error.detail,
                       "at": now().isoformat(timespec="seconds")}
            (state / "last-failure.json").write_text(json.dumps(failure, indent=2) + "\n")
            print(json.dumps(failure), file=sys.stderr)
            report_failure(config, f"HouseAtlas iCloud backup failed at step '{error.step}'.")
            return 1
        except Exception as error:  # noqa: BLE001 - any crash must still be reported
            failure = {"status": "failed", "step": "unexpected", "detail": repr(error),
                       "at": now().isoformat(timespec="seconds")}
            (state / "last-failure.json").write_text(json.dumps(failure, indent=2) + "\n")
            print(json.dumps(failure), file=sys.stderr)
            report_failure(config, "HouseAtlas iCloud backup failed unexpectedly.")
            return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
