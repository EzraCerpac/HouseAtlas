"""Authorized generated happy-path packaging only: no server or native runtime."""
import copy
import contextlib
import io
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from bundle import HERE, canonical, closure, digest, file_digest, pack, read_json, validate, validate_manifest, verify_bundle
from fixtures import metadata, payload
import workflow


class HappyPackaging(unittest.TestCase):
    def test_exact_generated_fixture_and_roundtrip(self):
        with tempfile.TemporaryDirectory(prefix="houseatlas-release-test-") as scratch:
            root = Path(scratch)
            manifest = pack(payload(root / "payload"), metadata(), root / "bundle")
            self.assertEqual(canonical(manifest), (HERE / "fixtures/bundle.manifest.json").read_bytes())
            self.assertEqual(manifest, verify_bundle(root / "bundle", file_digest(root / "bundle/manifest.json")))
            self.assertEqual(len(manifest["files"]), 6)
            self.assertEqual(manifest["build"]["kind"], "synthetic-fixture")
            self.assertEqual(manifest["runtimeQualification"], "not-established")
            self.assertEqual(sorted(p.name for p in (root / "bundle").iterdir()),
                             sorted([manifest["archive"]["name"], "manifest.json", "SHA256SUMS"]))

    def test_reproducible_across_roots_mtime_and_creation_modes(self):
        with tempfile.TemporaryDirectory(prefix="houseatlas-release-repeat-") as scratch:
            root = Path(scratch)
            for index in range(2):
                source = payload(root / f"source-{index}")
                for path in source.rglob("*"):
                    if path.is_file():
                        os.utime(path, (1000 + index, 1000 + index))
                        path.chmod(0o600 if index else 0o644)
                pack(source, metadata(), root / f"bundle-{index}")
            first, second = root / "bundle-0", root / "bundle-1"
            self.assertEqual({p.name: p.read_bytes() for p in first.iterdir()},
                             {p.name: p.read_bytes() for p in second.iterdir()})

    def test_explicit_retained_backend_contract(self):
        manifest = copy.deepcopy(read_json(HERE / "fixtures/bundle.manifest.json"))
        binary = manifest["files"].pop(0)
        manifest["archive"]["unpackedBytes"] -= binary["bytes"]
        manifest["components"]["backend"] = {"action": "retain", "identitySha256": binary["sha256"],
                                             "requiredInstalledSha256": binary["sha256"]}
        self.assertEqual(validate_manifest(manifest)["components"]["backend"]["action"], "retain")
        self.assertEqual(manifest["frontend"]["closureSha256"],
                         closure([r for r in manifest["files"] if r["path"].startswith("frontend/")]))

    def test_explicit_reviewed_storage_declaration(self):
        manifest = copy.deepcopy(read_json(HERE / "fixtures/bundle.manifest.json"))
        manifest["compatibility"].update(status="reviewed", requiredStorageContractSha256="4" * 64,
                                         resultingStorageContractSha256="4" * 64, codeRollbackCompatible=True)
        self.assertTrue(validate_manifest(manifest)["compatibility"]["codeRollbackCompatible"])

    def test_checked_in_profile_has_explicit_qualification(self):
        profile = read_json(HERE / "release-profile.json")
        validate(profile, {"$ref": "#/$defs/releaseProfile"}, "profile")
        workflow.check_compatibility(profile["compatibility"])
        if profile["native"]["status"] == "unqualified":
            self.assertIsNone(profile["native"]["sourceInputsSha256"])
        else:
            self.assertTrue(all(profile["native"][key] is not None for key in
                                ["sourceInputsSha256", "minimumMacos", "runnerImage", "sdkVersion", "xcodeBuild"]))


class HappyWorkflow(unittest.TestCase):
    @staticmethod
    def run_record():
        return {"id": 1, "run_attempt": 1, "repository": {"full_name": workflow.REPOSITORY},
                "head_repository": {"full_name": workflow.REPOSITORY}, "path": workflow.WORKFLOW,
                "event": "workflow_dispatch", "head_branch": "main", "head_sha": "1" * 40,
                "status": "completed", "conclusion": "success"}

    def test_exact_successful_producer_identity(self):
        workflow.verify_run(self.run_record(), commit="1" * 40, run_id="1", attempt=1)

    def test_fake_local_publication_preserves_built_bytes_and_publishes_last(self):
        # All acquisition/publication boundaries are local fakes. No GH command,
        # listener, credential, native binary or service is used by this test.
        with tempfile.TemporaryDirectory(prefix="houseatlas-release-promote-") as scratch:
            root = Path(scratch)
            info = metadata()
            info["compatibility"].update(status="reviewed", requiredStorageContractSha256="4" * 64,
                                          resultingStorageContractSha256="4" * 64, codeRollbackCompatible=True)
            reviewed_profile = copy.deepcopy(workflow.profile())
            reviewed_profile["native"].update(status="reviewed", minimumMacos="15.0", sourceInputsSha256="5" * 64,
                                                runnerImage="synthetic", sdkVersion="15.0", xcodeBuild="synthetic")
            reviewed_profile["compatibility"] = copy.deepcopy(info["compatibility"])
            profile_pin = digest(canonical(reviewed_profile))
            info["build"].update(kind="github-actions", nativeProfileSha256=profile_pin)
            manifest = pack(payload(root / "payload"), info, root / "built")
            pin = file_digest(root / "built/manifest.json")
            calls, uploaded = [], {}

            def fake_api(path):
                if path == "":
                    return {"visibility": "public"}
                if path == "actions/runs/1":
                    return self.run_record()
                if path == "actions/runs/1/artifacts?per_page=100":
                    return {"artifacts": [{"name": "release-bundle-1-1", "expired": False, "size_in_bytes": 1024}]}
                if path == "git/commits/" + "1" * 40:
                    return {"tree": {"sha": "2" * 40}}
                if path.startswith("git/ref/tags/"):
                    return {"object": {"type": "commit", "sha": "1" * 40}}
                if path.startswith("releases/tags/"):
                    return {"draft": True, "assets": [{"name": name, "size": len(data), "digest": "sha256:" + digest(data)}
                                                       for name, data in uploaded.items()]}
                self.fail("Unexpected fake API read")

            def fake_command(args, cwd=workflow.ROOT):
                calls.append(args)
                if args[:3] == ["gh", "run", "download"]:
                    shutil.copytree(root / "built", Path(args[args.index("--dir") + 1]))
                elif args[:3] == ["gh", "release", "upload"]:
                    for name in args[4:args.index("--repo")]:
                        path = Path(name)
                        uploaded[path.name] = path.read_bytes()
                elif args[:3] == ["gh", "release", "download"]:
                    destination = Path(args[args.index("--dir") + 1])
                    destination.mkdir()
                    for name, data in uploaded.items():
                        (destination / name).write_bytes(data)
                else:
                    self.assertIn(args[:3], [["gh", "release", "create"], ["gh", "release", "edit"]])
                return ""

            original_file_digest = workflow.file_digest
            def fake_file_digest(path):
                return profile_pin if path == HERE / "release-profile.json" else original_file_digest(path)

            with patch.object(workflow, "api", side_effect=fake_api), patch.object(workflow, "command", side_effect=fake_command), \
                    patch.object(workflow, "source_identity", return_value=manifest["source"]), \
                    patch.object(workflow, "profile", return_value=reviewed_profile), \
                    patch.object(workflow, "file_digest", side_effect=fake_file_digest), \
                    patch.dict(os.environ, {"RUNNER_TEMP": scratch}), contextlib.redirect_stdout(io.StringIO()) as output:
                workflow.promote("1", 1, pin, manifest["version"])
            self.assertIn(pin, output.getvalue())
            self.assertEqual(uploaded, {p.name: p.read_bytes() for p in (root / "built").iterdir()})
            self.assertEqual([call[:3] for call in calls], [["gh", "run", "download"], ["gh", "release", "create"],
                             ["gh", "release", "upload"], ["gh", "release", "download"], ["gh", "release", "edit"]])
            self.assertIn("--verify-tag", calls[1])
            self.assertIn("--draft", calls[1])
            self.assertIn("--prerelease", calls[1])
            self.assertIn("--draft=false", calls[-1])


if __name__ == "__main__":
    unittest.main()
