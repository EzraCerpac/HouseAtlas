"""Generated input only; no source, service, credential or reviewed-record write."""
import importlib.util
import json
import hashlib
import stat
import tempfile
from unittest.mock import patch
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("network_candidates", Path(__file__).resolve().parents[1] / "network-device-review" / "candidates.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
    def test_suggestions_never_review_or_match_names(self):
        snapshot = {"network": {"devices": [{"id": "device-a"}, {"id": "other", "label": "Same name"}]}}
        cached = {"workspaceId": "synthetic-workspace", "homeId": "synthetic-home",
                  "sourceInstanceId": "synthetic-source", "collectionId": "inventory",
                  "devices": [{"externalId": "device-a", "value": {"name": "Same name"}}], "interfaces": []}
        scope = {k: cached[k] for k in ("workspaceId", "homeId", "sourceInstanceId", "collectionId")}
        cached["devices"][0].update(scope)
        result = module.candidates(b"synthetic snapshot bytes", snapshot, cached)
        self.assertEqual(len(result["devices"][0]["candidates"]), 1)
        self.assertEqual(result["devices"][1]["candidates"], [])
        link = result["unreviewedLinkTemplate"]["links"][0]
        self.assertEqual(link["reviewStatus"], "unreviewed")
        self.assertIsNone(link["reviewer"])
        self.assertIsNone(link["reviewedAt"])
        cached["interfaces"] = [{**scope, "value": {"deviceId": "device-a", "mac": "02-00-00-00-00-01"}}]
        evidence = {"profile": "houseatlas.network-device-hardware-evidence.v1",
                    "sceneOriginalSha256": hashlib.sha256(b"synthetic snapshot bytes").hexdigest(),
                    "devices": [{"documentaryDeviceId": "other", "hardwareAddresses": ["02:00:00:00:00:01"],
                                 "evidenceReference": "synthetic:hardware-evidence"}]}
        self.assertEqual(module.candidates(b"synthetic snapshot bytes", snapshot, cached)["devices"][1]["candidates"], [])
        result = module.candidates(b"synthetic snapshot bytes", snapshot, cached, evidence)
        self.assertEqual(result["devices"][1]["candidates"][0]["evidence"][0]["kind"], "shared-explicit-hardware-address")
        self.assertEqual(result["unreviewedLinkTemplate"]["links"][1]["sceneOriginalSha256"], evidence["sceneOriginalSha256"])
        with self.assertRaises(ValueError):
            module.candidates(b"different snapshot bytes", snapshot, cached, evidence)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            snapshot_file, export_file, output_file = (folder / name for name in ("snapshot.json", "cached.json", "candidates.json"))
            snapshot_file.write_text(json.dumps(snapshot))
            export_file.write_text(json.dumps(cached))
            with patch("sys.argv", ["candidates.py", str(snapshot_file), str(export_file), str(output_file)]):
                module.main()
                self.assertEqual(stat.S_IMODE(output_file.stat().st_mode), 0o600)
                self.assertEqual(json.loads(output_file.read_text())["profile"], "houseatlas.network-device-review-candidates.v1")
                with self.assertRaises(FileExistsError):
                    module.main()
            self.assertEqual(json.loads(snapshot_file.read_text()), snapshot)
        with self.assertRaises(ValueError):
            module.unique_object([("x", 1), ("x", 2)])


if __name__ == "__main__":
    unittest.main()
