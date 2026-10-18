"""One generated successful producer union and real pack/verify roundtrip only."""

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from bundle import closure, file_digest, pack, verify_bundle
from fixtures import metadata, payload
from frontend_retention import ApprovedProducer, PriorClosure, assemble_frontend


def generated_metadata(version, commit, tree, run):
    value = metadata()
    value["version"] = version
    value["source"].update(commit=commit * 40, tree=tree * 40)
    # Generated declarations only, never independent GitHub producer evidence.
    value["build"].update(kind="github-actions", workflowCommit=commit * 40, runId=str(run))
    return value


def bytes_cut(root):
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*") if path.is_file()}


class FrontendRetentionHappyPaths(unittest.TestCase):
    def test_generated_prior_assets_union_pack_and_verify(self):
        with tempfile.TemporaryDirectory(prefix="houseatlas-frontend-retention-generated-") as temporary:
            root = Path(temporary)
            prior_payload = payload(root / "prior-payload")
            legacy = prior_payload / "frontend/assets/previous-a1b2c3d4.js"
            legacy.write_bytes(b'export const previous="generated old release";\n')
            nested = prior_payload / "frontend/assets/nested/font-a1b2c3d4.woff2"
            nested.parent.mkdir()
            nested.write_bytes(b"generated old font; not a valid font\n")
            prior_meta = generated_metadata("1.0.0", "1", "2", 11)
            prior_manifest = pack(prior_payload, prior_meta, root / "prior-bundle")
            prior_pin = file_digest(root / "prior-bundle/manifest.json")
            prior_source_cut = bytes_cut(prior_payload)
            prior_bundle_cut = bytes_cut(root / "prior-bundle")
            approval = ApprovedProducer(
                "EzraCerpac/HouseAtlas", "1" * 40, "2" * 40,
                ".github/workflows/release-bundle.yml", "refs/heads/main", "11", 1,
                101, 201, prior_manifest["archive"]["sha256"], "7" * 64)
            prior = PriorClosure(root / "prior-bundle", prior_pin,
                                 prior_manifest["frontend"]["closureSha256"], approval)
            current_payload = payload(root / "current-payload")
            (current_payload / "frontend/assets/current-b1c2d3e4.js").write_bytes(
                b'export const current="generated new release";\n')
            # Current mutable entries remain current; no prior entry or worker
            # is copied into their place by the asset-only assembly.
            current_index = b'<html><div id="root">Generated current entry</div></html>\n'
            (current_payload / "frontend/index.html").write_bytes(current_index)
            shell = "b" * 64
            (current_payload / "frontend/saved/index.html").write_bytes(
                f'<html><head><meta name="houseatlas-saved-shell-build" content="{shell}"></head></html>\n'.encode())
            (current_payload / "frontend/saved/service-worker.js").write_bytes(
                f'const BUILD="{shell}", TABLE=[];\n'.encode())
            current_meta = generated_metadata("2.0.0", "5", "6", 22)
            current_cut = bytes_cut(current_payload)
            result = assemble_frontend(current_payload / "frontend", (prior,), root / "union-frontend",
                                       current_metadata=current_meta)
            receipt = json.loads(result.provenance_receipt)
            self.assertEqual(receipt["currentEntrypoints"]["source"], current_meta["source"])
            self.assertEqual(receipt["priorInputs"][0]["source"], prior_meta["source"])
            self.assertEqual(receipt["priorInputs"][0]["approvedProducer"]["evidence_sha256"], "7" * 64)
            self.assertEqual(receipt["priorInputs"][0]["manifestSha256"], prior_pin)
            expected_assets = [row for row in prior_manifest["files"]
                               if row["path"].startswith("frontend/assets/")]
            self.assertEqual(receipt["priorInputs"][0]["retainedAssets"], expected_assets)
            self.assertLessEqual(len(result.provenance_receipt), 262_144)
            self.assertNotIn(str(root).encode(), result.provenance_receipt)
            self.assertEqual((result.frontend_directory / "index.html").read_bytes(), current_index)
            self.assertEqual((result.frontend_directory / "saved/service-worker.js").read_bytes(),
                             current_cut["frontend/saved/service-worker.js"])
            self.assertEqual((result.frontend_directory / "assets/previous-a1b2c3d4.js").read_bytes(),
                             legacy.read_bytes())
            self.assertEqual((result.frontend_directory / "assets/nested/font-a1b2c3d4.woff2").read_bytes(),
                             nested.read_bytes())
            # Feed the union as the frontend of a separate software-only payload
            # before invoking the unchanged actual packer. No installed tree is
            # opened or mutated, and the final archive declares every asset.
            assembled_payload = root / "assembled-payload"
            assembled_payload.mkdir()
            shutil.copytree(current_payload / "bin", assembled_payload / "bin")
            shutil.copytree(current_payload / "licenses", assembled_payload / "licenses")
            shutil.copytree(result.frontend_directory, assembled_payload / "frontend")
            manifest = pack(assembled_payload, current_meta, root / "current-bundle")
            actual = verify_bundle(root / "current-bundle", file_digest(root / "current-bundle/manifest.json"))
            self.assertEqual(actual, manifest)
            self.assertEqual(actual["components"]["frontend"]["action"], "replace")
            self.assertEqual(actual["frontend"]["closureSha256"], result.closure_sha256)
            self.assertEqual(closure([row for row in actual["files"] if row["path"].startswith("frontend/")]),
                             result.closure_sha256)
            self.assertEqual(actual["frontend"]["shellBuildSha256"], shell)
            self.assertTrue(all(row in actual["files"] for row in expected_assets))
            self.assertEqual(bytes_cut(prior_payload), prior_source_cut)
            self.assertEqual(bytes_cut(root / "prior-bundle"), prior_bundle_cut)
            self.assertEqual(bytes_cut(current_payload), current_cut)


if __name__ == "__main__":
    unittest.main()
