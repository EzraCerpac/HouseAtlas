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

    def test_restore_fetches_a_blob_that_is_not_local_yet(self):
        store = self.root / "store"
        listed = hb.list_models(self.release())
        hb.store_models(store, listed, "20261001T040000Z")
        models = [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]
        # A legacy placeholder: the blob is absent until the fetch brings it back.
        away = hb.private_dir(self.root / "in-icloud")
        for model in models:
            (store / "blobs" / model["sha256"]).rename(away / model["sha256"])
        fetch = lambda blob: (away / blob.name).rename(blob)
        out = hb.private_dir(self.root / "out")
        hb.restore_models(store, models, out, fetch)
        self.assertEqual((out / "releases/v1/detail.glb").read_bytes(), b"detail")

    def test_new_blobs_round_trip_through_the_icloud_helper(self):
        helper, evicted = self.fake_icloud_helper()
        config = type("C", (), {"icloud_helper": helper, "upload_timeout": 5})()
        store = self.root / "store"
        listed = hb.list_models(self.release())
        stored = hb.store_models(store, listed, "20261001T040000Z")
        models = [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]
        hb.settle_blobs(config, store, models, stored)
        self.assertEqual(len(list(evicted.iterdir())), 3)
        hb.restore_models(store, models, hb.private_dir(self.root / "out"), hb.fetch_from_icloud(config))
        self.assertEqual(list(evicted.iterdir()), [])

    def test_a_reused_blob_that_never_uploaded_stops_the_run(self):
        helper = self.root / "not-uploaded"
        helper.write_text("#!/bin/sh\necho '{\"ubiquitous\": true, \"uploaded\": false}'\n")
        helper.chmod(0o700)
        store = self.root / "store"
        listed = hb.list_models(self.release())
        hb.store_models(store, listed, "20261001T040000Z")
        models = [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]
        # Nothing new this run, but the reused blobs are still checked.
        self.assertEqual(hb.store_models(store, listed, "20261002T040000Z"), [])
        config = type("C", (), {"icloud_helper": helper, "upload_timeout": 0})()
        with self.assertRaises(hb.StepFailed) as failure:
            hb.settle_blobs(config, store, models, [])
        self.assertEqual(failure.exception.step, "iCloud upload")

    def test_restore_command_refuses_an_existing_destination(self):
        store = self.root / "store"
        listed = hb.list_models(self.release())
        hb.store_models(store, listed, "20261001T040000Z")
        report = self.root / "backup-report.json"
        report.write_text(json.dumps({"models": [{k: m[k] for k in ("file", "sha256", "bytes")} for m in listed]}))
        self.assertEqual(hb.restore_models_command(report, store, self.root / "new"), 0)
        self.assertTrue((self.root / "new/releases/v1/detail.glb").is_file())
        self.assertEqual(hb.restore_models_command(report, store, self.root / "new"), 64)
        outside = self.root / "unrelated-synthetic-file"
        outside.write_bytes(b"not a blob")
        for bad in ({"file": "releases/v1/x", "sha256": str(outside), "bytes": 1},
                    {"file": "releases/v1/x", "sha256": "../" + listed[0]["sha256"], "bytes": 1},
                    {"file": "releases/v1/x", "sha256": listed[0]["sha256"].upper(), "bytes": 1},
                    {"file": "/abs", "sha256": listed[0]["sha256"], "bytes": 1},
                    {"file": "releases/v1/x", "sha256": listed[0]["sha256"]}, "not an entry"):
            report.write_text(json.dumps({"models": [bad]}))
            target = self.root / "rejected"
            self.assertEqual(hb.restore_models_command(report, store, target), 1, bad)
            self.assertFalse(target.exists(), bad)


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
        release.server_config = self.root / "server.json"
        release.server_config.write_text(json.dumps({"dataDirectory": str(self.root / "data")}))
        shared = hb.private_dir(self.root / "data" / hb.SHARED_FOLDER)
        (shared / "retention.json").write_text('{"keep": "recent", "nights": 7, "months": 1}')

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
        sidecar = json.loads((icloud / f"{second['archive']}{hb.MODELS_SIDECAR}").read_text())
        self.assertEqual((sidecar["verified"], len(sidecar["blobs"])), (True, 3))
        status = json.loads((shared / "status.json").read_text())
        self.assertEqual(status["lastSuccess"]["finished"], second["finished"])
        self.assertEqual((status["lastFailure"], status["problem"]), (None, None))
        self.assertEqual(status["retention"], {"keep": "recent", "nights": 7, "months": 1})
        self.assertEqual(status["removed"], {"archives": 0, "modelFiles": 0, "bytes": 0})
        self.assertEqual(status["stored"]["archives"], 2)


class RetentionTest(unittest.TestCase):
    """The owner's retention choice from Settings, applied after a verified run."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.icloud = hb.private_dir(self.root / "icloud")
        self.blobs = hb.private_dir(self.icloud / hb.MODEL_STORE / "blobs")
        helper, _ = BackupScriptTest.fake_icloud_helper(self)
        self.config = type("C", (), {"icloud_helper": helper, "upload_timeout": 5,
                                     "icloud_directory": self.icloud})()

    def blob(self, letter):
        (self.blobs / (letter * 64)).write_bytes(letter.encode() * 10)
        return {"file": f"releases/{letter}/overview.glb", "sha256": letter * 64, "bytes": 10}

    def archive(self, stamp, models, sidecar=True, verified=True):
        work = hb.private_dir(self.root / "work" / stamp)
        hb.private_dir(work / "bundle")
        (work / "backup-report.json").write_text(json.dumps(
            {"modelStore": hb.MODEL_STORE, "models": models}))
        target = self.icloud / f"{hb.ARCHIVE_PREFIX}{stamp}.tar.gz"
        hb.pack(work, target)
        (self.icloud / f"{target.name}.sha256").write_text("x\n")
        if sidecar:
            hb.write_models_sidecar(target, models, verified)
        return target

    def names(self):
        return sorted(p.name for p in self.icloud.iterdir() if p.is_file())

    def test_retention_choice_defaults_to_forever(self):
        self.assertEqual(hb.read_retention(None), ({"keep": "forever"}, None))
        self.assertEqual(hb.read_retention(self.root), ({"keep": "forever"}, None))
        for bad in ('{"keep": "recent", "nights": 3, "months": 12}', '{"keep": "recent", "nights": 30}',
                    '{"keep": "recent", "nights": true, "months": 1}', '[]', 'not json'):
            (self.root / "retention.json").write_text(bad)
            choice, problem = hb.read_retention(self.root)
            self.assertEqual(choice, {"keep": "forever"}, bad)
            self.assertIsNotNone(problem, bad)
        (self.root / "retention.json").write_text('{"keep": "recent", "nights": 30, "months": 12}')
        self.assertEqual(hb.read_retention(self.root), ({"keep": "recent", "nights": 30, "months": 12}, None))

    def test_keeps_last_nights_and_first_of_each_month(self):
        days = [dt.date(2026, 8, 20) + dt.timedelta(days=n) for n in range(70)]
        stamps = {d.strftime("%Y%m%dT040000Z"): True for d in days}
        current = max(stamps)
        keep = hb.kept_stamps(stamps, 30, 3, current)
        nights = sorted(stamps)[-30:]
        self.assertEqual(keep, set(nights) | {"20260820T040000Z", "20260901T040000Z"})
        self.assertEqual(hb.kept_stamps(stamps, 30, 2, current), set(nights) | {"20260901T040000Z"})
        self.assertEqual(hb.kept_stamps(stamps, 7, 0, current), set(sorted(stamps)[-7:]))
        # Of two archives on one day the verified one stays, even if older.
        stamps["20261027T100000Z"] = False
        stamps["20261027T040000Z"] = True
        keep = hb.kept_stamps(stamps, 7, 0, current)
        self.assertIn("20261027T040000Z", keep)
        self.assertNotIn("20261027T100000Z", keep)

    def test_recent_retention_deletes_old_archives_and_unused_blobs(self):
        old, legacy, current = self.blob("a"), self.blob("b"), self.blob("c")
        self.blob("d")  # in no archive at all
        (self.icloud / "notes.txt").write_text("not ours")
        (self.blobs / ("e" * 64 + ".partial-x")).write_bytes(b"")
        stamps = [f"202610{day:02d}T040000Z" for day in range(1, 11)]
        for stamp in stamps[:2]:
            self.archive(stamp, [old])
        self.archive(stamps[2], [old], sidecar=False)  # pruned before it is ever opened
        self.archive(stamps[3], [legacy], sidecar=False)  # kept: opened once for its blobs
        for stamp in stamps[4:-1]:
            self.archive(stamp, [legacy])
        target = self.archive(stamps[-1], [current])
        removed = hb.apply_retention(self.config, {"keep": "recent", "nights": 7, "months": 0}, target, [current])
        self.assertEqual((removed["archives"], removed["modelFiles"]), (3, 2))
        self.assertGreater(removed["bytes"], 0)
        kept = [f"{hb.ARCHIVE_PREFIX}{s}.tar.gz" for s in stamps[3:]]
        self.assertEqual(self.names(), sorted(["notes.txt"] + kept + [k + ".sha256" for k in kept]
                                              + [k + hb.MODELS_SIDECAR for k in kept]))
        backfilled = json.loads((self.icloud / (kept[0] + hb.MODELS_SIDECAR)).read_text())
        self.assertEqual((backfilled["verified"], backfilled["blobs"]), (False, ["b" * 64]))
        self.assertEqual(sorted(p.name for p in self.blobs.iterdir()), ["b" * 64, "c" * 64, "e" * 64 + ".partial-x"])
        totals = hb.stored_totals(self.icloud)
        self.assertEqual(totals["archives"], 7)

    def test_forever_and_unreadable_lists_delete_nothing(self):
        blob = self.blob("a")
        self.blob("d")
        stamps = [f"202610{day:02d}T040000Z" for day in range(1, 11)]
        for stamp in stamps[:-1]:
            self.archive(stamp, [blob])
        target = self.archive(stamps[-1], [blob])
        before = self.names(), sorted(p.name for p in self.blobs.iterdir())
        self.assertEqual(hb.apply_retention(self.config, {"keep": "forever"}, target, [blob]),
                         {"archives": 0, "modelFiles": 0, "bytes": 0})
        (self.icloud / f"{hb.ARCHIVE_PREFIX}{stamps[5]}.tar.gz{hb.MODELS_SIDECAR}").write_text('{"blobs": ["../x"]}')
        with self.assertRaises(hb.StepFailed):
            hb.apply_retention(self.config, {"keep": "recent", "nights": 7, "months": 0}, target, [blob])
        self.assertEqual((self.names(), sorted(p.name for p in self.blobs.iterdir())), before)

    def test_an_unverified_current_archive_stops_retention(self):
        blob = self.blob("a")
        target = self.archive("20261001T040000Z", [blob], verified=False)
        with self.assertRaises(hb.StepFailed):
            hb.apply_retention(self.config, {"keep": "recent", "nights": 7, "months": 0}, target, [blob])
        self.assertTrue(target.exists())

    def test_status_keeps_the_last_success_when_a_run_fails(self):
        folder = self.root / "data" / hb.SHARED_FOLDER
        hb.write_status(folder, {"lastSuccess": {"finished": "s"}, "lastFailure": None})
        hb.write_status(folder, {"lastFailure": {"at": "f", "step": "iCloud upload"}})
        status = json.loads((folder / "status.json").read_text())
        self.assertEqual(status, {"schemaVersion": 1, "lastSuccess": {"finished": "s"},
                                  "lastFailure": {"at": "f", "step": "iCloud upload"}})
        self.assertEqual((folder / "status.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["status.json"])

    def test_shared_folder_comes_from_the_server_config(self):
        config = self.root / "server.json"
        config.write_text(json.dumps({"dataDirectory": "/srv/data"}))
        service = type("S", (), {"server_config": config})()
        self.assertEqual(hb.shared_folder(service), Path("/srv/data/backup"))
        config.write_text("{}")
        self.assertIsNone(hb.shared_folder(service))


if __name__ == "__main__":
    unittest.main()
