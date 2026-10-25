"""Synthetic checks for the parts of the backup script that need no service,
backend binary or iCloud: plist parsing, packing, local pruning, and the
content-addressed model store (with a fake iCloud helper)."""
import datetime as dt
import json
import os
import plistlib
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import houseatlas_backup as hb  # noqa: E402


class BackupScriptTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()

    def test_service_reads_binary_config_and_models_from_plist(self):
        plist = self.root / "service.plist"
        plist.write_bytes(plistlib.dumps({"ProgramArguments": [
            "/opt/houseatlas", "serve", "--server-config", "/etc/server.json",
            "--model-overview-manifest", "/m/v1/publication/publication.json",
            "--model-overview-manifest-sha256", "abc",
            "--atlas-scene-manifest", "/m/v1/publication/atlas-scene.json",
        ]}))
        config = self.root / "config.json"
        config.write_text(
            '{"serviceLabel": "x", "servicePlist": "%s", "stateDirectory": "/s",'
            ' "icloudDirectory": "/i", "icloudHelper": "/h"}' % plist
        )
        service = hb.Service(hb.Config(config))
        self.assertEqual(service.binary, Path("/opt/houseatlas"))
        self.assertEqual(service.server_config, Path("/etc/server.json"))
        self.assertEqual(service.models, [
            (Path("/m/v1/publication/publication.json"), "abc"),
            (Path("/m/v1/publication/atlas-scene.json"), None),
        ])

    def test_pack_and_unpack_keep_private_modes(self):
        work = hb.private_dir(self.root / "work")
        bundle = hb.private_dir(work / "bundle")
        originals = hb.private_dir(bundle / "originals")
        (originals / "0.blob").write_bytes(b"original")
        (originals / "0.blob").chmod(0o400)
        (work / "backup-report.json").write_text("{}")
        archive = self.root / "a.tar.gz"
        hb.pack(work, archive)
        out = hb.private_dir(self.root / "out")
        hb.unpack(archive, out)
        self.assertEqual((out / "bundle/originals/0.blob").read_bytes(), b"original")
        self.assertEqual((out / "bundle/originals/0.blob").stat().st_mode & 0o777, 0o400)
        self.assertEqual((out / "bundle").stat().st_mode & 0o777, 0o700)

    def test_prune_keeps_newest_local_archives_only(self):
        for stamp in ("20261001T040000Z", "20261002T040000Z", "20261003T040000Z"):
            (self.root / f"{hb.ARCHIVE_PREFIX}{stamp}.tar.gz").write_bytes(b"")
        (self.root / "other.tar.gz").write_bytes(b"")
        hb.prune_local(self.root, 2)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [
            f"{hb.ARCHIVE_PREFIX}20261002T040000Z.tar.gz",
            f"{hb.ARCHIVE_PREFIX}20261003T040000Z.tar.gz",
            "other.tar.gz",
        ])

    def test_failed_stop_still_restarts_service(self):
        calls = []

        class FakeService:
            binary = Path("/bin/false")
            server_config = Path("/nonexistent")

            def pid(self):
                return 1

            def stop(self):
                calls.append("stop")
                raise hb.StepFailed("stop service", "timed out")

            def start(self):
                calls.append("start")

        config = type("C", (), {"health_url": None})()
        with self.assertRaises(hb.StepFailed):
            hb.capture(FakeService(), config, self.root / "bundle")
        self.assertEqual(calls, ["stop", "start"])

    def fake_icloud_helper(self):
        """Every file counts as uploaded; evict and download flip a marker."""
        helper = self.root / "icloud-helper"
        evicted = hb.private_dir(self.root / "evicted")
        helper.write_text(f"""#!/bin/sh
marker="{evicted}/$(basename "$2")"
case "$1" in evict) touch "$marker";; download) rm -f "$marker";; esac
if [ -e "$marker" ]; then status=NotDownloaded; else status=NSURLUbiquitousItemDownloadingStatusCurrent; fi
printf '{{"ubiquitous": true, "uploaded": true, "downloadingStatus": "%s"}}\\n' "$status"
""")
        helper.chmod(0o700)
        return helper, evicted

    def release(self, name="v1", detail=b"detail"):
        publication = hb.private_dir(self.root / "releases" / name)
        (publication / "overview.glb").write_bytes(b"glb " + name.encode())
        (publication / "detail.glb").write_bytes(detail)
        pin = lambda file: {"file": file, "bytes": (publication / file).stat().st_size,
                            "sha256": hb.sha256_file(publication / file)}
        (publication / "publication.json").write_text(json.dumps(
            {"original": pin("overview.glb"), "detail": pin("detail.glb")}))
        return type("S", (), {"models": [(publication / "publication.json", None)]})()

    def test_model_listing_hashes_every_file_and_checks_both_pins(self):
        service = self.release()
        models = hb.list_models(service)
        self.assertEqual([m["file"] for m in models], [
            "releases/v1/detail.glb", "releases/v1/overview.glb", "releases/v1/publication.json",
        ])
        self.assertEqual(models[0]["bytes"], 6)
        (self.root / "releases/v1/detail.glb").write_bytes(b"other!")
        with self.assertRaises(hb.StepFailed):
            hb.list_models(service)
        (self.root / "releases/v1/detail.glb").write_bytes(b"detail")
        (self.root / "releases/v1/overview.glb").write_bytes(b"bad")
        with self.assertRaises(hb.StepFailed):
            hb.list_models(service)

    def test_unchanged_release_is_stored_once_and_shared_files_are_reused(self):
        store = self.root / "icloud" / hb.MODEL_STORE
        first = hb.store_models(store, hb.list_models(self.release()), "20261001T040000Z")
        self.assertEqual(len(first), 3)
        self.assertEqual(hb.store_models(store, hb.list_models(self.release()), "20261002T040000Z"), [])
        # A new release that keeps the detail model stores only what changed.
        changed = hb.list_models(self.release("v2"))
        second = hb.store_models(store, changed, "20261003T040000Z")
        self.assertEqual(sorted(b.name for b in second), sorted(
            m["sha256"] for m in changed if not m["file"].endswith("detail.glb")))
        self.assertEqual(len(list((store / "blobs").iterdir())), 5)
        self.assertEqual(list((store / "blobs").glob("*.partial-*")), [])

    def test_store_refuses_a_source_that_changed_after_listing(self):
        listed = hb.list_models(self.release())
        (self.root / "releases/v1/detail.glb").write_bytes(b"later!")
        with self.assertRaises(hb.StepFailed):
            hb.store_models(self.root / "store", listed, "20261001T040000Z")
        self.assertEqual(list((self.root / "store/blobs").iterdir()), [])

    def test_restore_rebuilds_the_full_release_folder_from_blobs(self):
        store = self.root / "store"
        listed = hb.list_models(self.release())
        hb.store_models(store, listed, "20261001T040000Z")
        models = [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]
        fetched = []
        out = hb.private_dir(self.root / "restored")
        hb.restore_models(store, models, out, fetched.append)
        self.assertEqual(len(fetched), 3)
        for model in listed:
            self.assertEqual((out / model["file"]).read_bytes(), model["source"].read_bytes())
            self.assertEqual((out / model["file"]).stat().st_mode & 0o777, 0o600)
        self.assertEqual((out / "releases/v1").stat().st_mode & 0o777, 0o700)
        self.assertEqual((out / "releases").stat().st_mode & 0o777, 0o700)
        blob = store / "blobs" / models[0]["sha256"]
        blob.chmod(0o600)
        blob.write_bytes(b"rotten")
        with self.assertRaises(hb.StepFailed):
            hb.restore_models(store, models, hb.private_dir(self.root / "again"))
        with self.assertRaises(hb.StepFailed):
            hb.restore_models(store, [dict(models[1], file="../escape")], hb.private_dir(self.root / "third"))

    def test_new_blobs_round_trip_through_the_icloud_helper(self):
        helper, evicted = self.fake_icloud_helper()
        config = type("C", (), {"icloud_helper": helper, "upload_timeout": 5})()
        store = self.root / "store"
        listed = hb.list_models(self.release())
        stored = hb.store_models(store, listed, "20261001T040000Z")
        hb.settle_new_blobs(config, stored)
        self.assertEqual(len(list(evicted.iterdir())), 3)
        models = [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]
        hb.restore_models(store, models, hb.private_dir(self.root / "out"), hb.fetch_from_icloud(config))
        self.assertEqual(list(evicted.iterdir()), [])

    def test_restore_command_refuses_an_existing_destination(self):
        store = self.root / "store"
        listed = hb.list_models(self.release())
        hb.store_models(store, listed, "20261001T040000Z")
        report = self.root / "backup-report.json"
        report.write_text(json.dumps({"models": [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]}))
        self.assertEqual(hb.restore_models_command(report, store, self.root / "new"), 0)
        self.assertTrue((self.root / "new/releases/v1/detail.glb").is_file())
        self.assertEqual(hb.restore_models_command(report, store, self.root / "new"), 64)


    def test_two_nights_with_one_release_upload_the_model_once(self):
        helper, _ = self.fake_icloud_helper()
        icloud = self.root / "icloud"
        config_file = self.root / "config.json"
        config_file.write_text(json.dumps({
            "serviceLabel": "x", "servicePlist": "/unused", "stateDirectory": str(self.root / "state"),
            "icloudDirectory": str(icloud), "icloudHelper": str(helper), "uploadTimeoutSeconds": 5,
        }))
        config = hb.Config(config_file)
        release = self.release()
        release.binary = helper

        def capture(service, config, bundle):
            hb.private_dir(bundle)
            (bundle / "database.sqlite").write_bytes(b"db")
            return {}

        restore = {"assetRecordCount": 0, "restoredOriginalCount": 0, "databaseSha256": "d"}
        patches = {"Service": lambda config: release, "capture": capture,
                   "restore_check": lambda *args: restore}
        saved = {name: getattr(hb, name) for name in patches}
        stamps = iter([dt.datetime(2026, 10, day, 4, tzinfo=dt.timezone.utc) for day in (1, 1, 2, 2)])
        saved["now"] = hb.now
        try:
            for name, value in patches.items():
                setattr(hb, name, value)
            hb.now = lambda: next(stamps)
            first = hb.backup(config)
            second = hb.backup(config)
        finally:
            for name, value in saved.items():
                setattr(hb, name, value)
        self.assertEqual((first["modelBlobsStored"], second["modelBlobsStored"]), (3, 0))
        self.assertEqual(second["modelBytesStored"], 0)
        self.assertEqual(second["modelFileCount"], 3)
        archive = icloud / second["archive"]
        with tarfile.open(archive) as tar:
            names = tar.getnames()
        self.assertFalse(any(name.startswith("model") for name in names))
        self.assertIn("backup-report.json", names)


if __name__ == "__main__":
    unittest.main()
