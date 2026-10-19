"""Three named static/memory positives; no native state, SQL or runtime ports."""

from dataclasses import astuple
import hashlib
import json
from pathlib import Path
import unittest

from houseatlas_updater.model import Storage
from houseatlas_updater.release_bundle import ReleaseBundleV1
from houseatlas_updater.storage_contracts import trusted_storage_contracts


ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "tools/houseatlas-updater/contracts"
PREIMAGES = (
    ("storage-access-atlas.draft.v2.json", 2175,
     "b226413460ca7a57ba6fb245c65e415f87814d2e96227024b8a0146ad03bdd2d"),
    ("storage-access-full-geodata.draft.v2.json", 2343,
     "ef8517886be6bb1d6836c01fc3c606f326b53c2d4e604b46031761921e566900"),
)


class TrustedStorageContractSourceCases(unittest.TestCase):
    def test_registered_preimages_are_exact_canonical_source_contracts(self):
        registry = trusted_storage_contracts()
        self.assertEqual(set(registry), {pin for _, _, pin in PREIMAGES})
        for name, size, pin in PREIMAGES:
            with self.subTest(name=name):
                raw = (CONTRACTS / name).read_bytes()
                self.assertEqual(len(raw), size)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), pin)
                value = json.loads(raw)
                self.assertEqual(raw, (json.dumps(value, sort_keys=True, separators=(",", ":"),
                                                  ensure_ascii=True, allow_nan=False) + "\n").encode("ascii"))
                self.assertEqual(value["format"], "houseatlas.storage-access-contract-draft/1")
                self.assertEqual(value["contractVersion"], 1)
                self.assertIs(type(value["protocol"]), int)
                self.assertEqual(value["protocol"], 1)
                normalized = Storage(value["receiptFormat"], value["configurationDigestFormat"],
                                     value["access"]["schema"], value["atlas"]["profile"],
                                     value["atlas"]["schema"], value["protocol"])
                self.assertEqual(astuple(registry[pin]), astuple(normalized))
                self.assertEqual(value["atlas"]["sqliteUserVersion"], 5)
                self.assertEqual(value["atlas"]["schema"],
                                 1 if value["atlas"]["profile"] == "full-geodata" else 5)

    def test_persistent_schema_pins_match_current_public_source(self):
        pins = {}
        for name, _, _ in PREIMAGES:
            value = json.loads((CONTRACTS / name).read_bytes())
            rows = value["coreMigrations"] + [{"path": "backend/src/access/schema.sql",
                                              "sha256": value["access"]["schemaSqlSha256"]}]
            if value["atlas"]["extensionMigration"] is not None:
                rows.append(value["atlas"]["extensionMigration"])
            for row in rows:
                previous = pins.setdefault(row["path"], row["sha256"])
                self.assertEqual(previous, row["sha256"])
                self.assertEqual(hashlib.sha256((ROOT / row["path"]).read_bytes()).hexdigest(), row["sha256"])
        self.assertEqual(len(pins), 7)

    def test_fresh_registry_is_inert_and_adapter_requires_explicit_input(self):
        profile = ROOT / "tools/release/release-profile.json"
        before = profile.read_bytes()
        first, second = trusted_storage_contracts(), trusted_storage_contracts()
        self.assertIsNot(first, second)
        for key in first:
            self.assertEqual(first[key], second[key])
            self.assertIsNot(first[key], second[key])
        first.clear()
        self.assertEqual(len(second), 2)
        # Synthetic native marker: constructor admission only, no manifest,
        # selected target, transaction, compatibility flag or runtime action.
        verifier = ReleaseBundleV1((ROOT / "tools/release/bundle.schema.json").read_bytes(),
                                   second, "3" * 64)
        second.clear()
        self.assertEqual(len(verifier.storage_contracts), 2)
        self.assertFalse(verifier.synthetic_only)
        self.assertEqual(profile.read_bytes(), before)
        compatibility = json.loads(before)["compatibility"]
        self.assertEqual(compatibility["status"], "unqualified")
        self.assertIsNone(compatibility["requiredStorageContractSha256"])
        self.assertIsNone(compatibility["resultingStorageContractSha256"])
        self.assertFalse(compatibility["codeRollbackCompatible"])
