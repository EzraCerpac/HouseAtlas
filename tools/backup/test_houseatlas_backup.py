"""Synthetic checks for the parts of the backup script that need no service,
backend binary or iCloud: plist parsing, packing and local pruning."""
import os
import plistlib
import sys
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
        hb.private_dir(work / "model")
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

    def test_model_copy_hashes_every_file_and_detects_changes(self):
        publication = hb.private_dir(self.root / "release" / "publication")
        (publication / "publication.json").write_text("{}")
        (publication / "overview.glb").write_bytes(b"glb")
        service = type("S", (), {"models": [(publication / "publication.json", None)]})()
        out = hb.private_dir(self.root / "model")
        models = hb.copy_models(service, out)
        self.assertEqual(sorted(m["file"] for m in models), [
            "release/publication/overview.glb", "release/publication/publication.json",
        ])
        (out / "release/publication/overview.glb").write_bytes(b"changed")
        with self.assertRaises(hb.StepFailed):
            hb.check_models(out, models)


if __name__ == "__main__":
    unittest.main()
