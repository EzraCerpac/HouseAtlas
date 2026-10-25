#!/usr/bin/env python3
"""Nightly HouseAtlas backup to iCloud Drive with a proven restore.

One run:
  1. stops the HouseAtlas launchd service, runs the native `backup` CLI against
     the live data directory, and starts the service again (seconds of downtime);
  2. copies the served model release next to the bundle and checks its hashes;
  3. restores the bundle into a fresh folder with `restore-check`;
  4. packs everything into one archive and copies it to iCloud Drive;
  5. waits until iCloud reports the upload done, evicts the local copy,
     downloads it again from iCloud, compares the bytes, and repeats the
     restore check on the downloaded copy.

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


def copy_models(service: Service, destination: Path) -> list[dict]:
    """Copy each served publication folder and record every file's hash, after
    checking the manifests against the hashes the service was started with."""
    folders: list[Path] = []
    for manifest, expected in service.models:
        if expected and sha256_file(manifest) != expected:
            raise StepFailed("model release", f"{manifest.name} hash differs from the service")
        check_pinned_original(manifest)
        if manifest.parent not in folders:
            folders.append(manifest.parent)
    copied = []
    for folder in folders:
        name = Path(folder.parent.name) / folder.name
        shutil.copytree(folder, destination / name, symlinks=False)
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            copied.append({"file": str(name / path.relative_to(folder)), "sha256": sha256_file(path)})
    check_models(destination, copied)
    return copied


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
        for name in ("bundle", "model", "backup-report.json"):
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
    models = timed("modelSeconds", copy_models, service, private_dir(work / "model"))
    local_restore = timed(
        "localRestoreSeconds", restore_check, restore_binary, work / "bundle",
        work / "restore-local", "restore check (local)",
    )
    report = {
        "format": "houseatlas-icloud-backup-report/1",
        "recoveryPoint": started.isoformat(timespec="seconds"),
        "serverBinarySha256": sha256_file(service.binary),
        "capture": capture_report,
        "models": models,
    }
    (work / "backup-report.json").write_text(json.dumps(report, indent=2) + "\n")

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
    check_models(verify / "model", models)

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
        "timings": timings,
        "finished": now().isoformat(timespec="seconds"),
    }
    (state / "last-success.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", required=True, type=Path)
    config = Config(parser.parse_args().config)
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
