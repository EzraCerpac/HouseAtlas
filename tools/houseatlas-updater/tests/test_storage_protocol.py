"""Exact memory-only storage-mapping cases; no native state or runtime ports.

The deliberately legacy tuple models an older unvalidated in-process value so
whole-equality cannot admit bool/int aliases. No process, filesystem mutation,
transport, authentication or controller transaction is exercised here.
"""

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

from houseatlas_updater.model import STORAGE_MAPPING_PROTOCOL_V1, Runtime, Storage, UpdateError
from houseatlas_updater.release_bundle import ReleaseBundleV1
from houseatlas_updater.validation import bundle, compatible, installed, runtime


ATLAS = ("houseatlas-persistent-server/1", "houseatlas-server-state/2", 1, "atlas", 5, 1)
FULL = ("houseatlas-persistent-full-geodata-server/1", "houseatlas-server-state/2", 1,
        "full-geodata", 1, 1)


def legacy(**changes):
    """Prior code allowed these owner-normalized scalar values unchanged."""
    value = object.__new__(Storage)
    for name, item in (asdict(Storage(*ATLAS)) | changes).items():
        object.__setattr__(value, name, item)
    return value


class StorageProtocolSourceCases(unittest.TestCase):
    def assert_incompatible(self, call):
        with self.assertRaises(UpdateError) as raised:
            call()
        self.assertEqual(raised.exception.code, "state-incompatible")

    def test_two_explicit_profiles_preserve_field_meanings(self):
        self.assertIs(type(STORAGE_MAPPING_PROTOCOL_V1), int)
        self.assertEqual(STORAGE_MAPPING_PROTOCOL_V1, 1)
        for fields in (ATLAS, FULL):
            with self.subTest(profile=fields[3]):
                value = Storage(*fields)
                Storage.validate(value)
                self.assertEqual(tuple(asdict(value).values()), fields)
        # Profile definitions share a mapping revision, not receipt/schema
        # versions. Their Atlas outer schemas remain deliberately distinct.
        self.assertEqual(Storage(*ATLAS).atlas_schema, 5)
        self.assertEqual(Storage(*FULL).atlas_schema, 1)

    def test_missing_ambiguous_and_unsupported_protocols_rejected(self):
        for protocol in (None, False, True, 1.0, "1", 0, -1, 2):
            with self.subTest(protocol=repr(protocol)):
                self.assert_incompatible(lambda: Storage(*ATLAS[:-1], protocol))

    def test_mixed_profiles_and_loosely_typed_schemas_rejected(self):
        cases = [dict(receipt_format=FULL[0]), dict(config_digest_format="houseatlas-server-state/1"),
                 dict(access_schema=True), dict(access_schema=1.0), dict(access_schema=2),
                 dict(atlas_profile="unknown"), dict(atlas_schema=True), dict(atlas_schema=5.0),
                 dict(atlas_schema=1), dict(atlas_profile="full-geodata")]
        for changes in cases:
            with self.subTest(changes=changes):
                self.assert_incompatible(lambda: Storage(**(asdict(Storage(*ATLAS)) | changes)))
        self.assert_incompatible(lambda: Storage(*FULL[:4], 5, FULL[-1]))

    def test_packaging_owner_map_requires_typed_supported_storage(self):
        schema = (Path(__file__).resolve().parents[2] / "release/bundle.schema.json").read_bytes()
        for mapping in (None, ["4" * 64], ("4" * 64,), {"4" * 64}, {}, {"not-a-digest": Storage(*ATLAS)}):
            with self.subTest(mapping=repr(mapping)):
                self.assert_incompatible(lambda: ReleaseBundleV1(schema, mapping, "3" * 64))
        for value in (None, asdict(Storage(*ATLAS)), 1, legacy(protocol=True), legacy(protocol=None)):
            with self.subTest(value=repr(value)):
                self.assert_incompatible(lambda: ReleaseBundleV1(schema, {"4" * 64: value}, "3" * 64))
        verifier = ReleaseBundleV1(schema, {"4" * 64: Storage(*ATLAS), "5" * 64: Storage(*FULL)}, "3" * 64)
        self.assertEqual(len(verifier.storage_contracts), 2)

    def test_selected_map_is_revalidated_before_bundle_normalization(self):
        root = Path(__file__).resolve().parents[2] / "release"
        verifier = ReleaseBundleV1((root / "bundle.schema.json").read_bytes(),
                                   {"4" * 64: Storage(*ATLAS)}, "3" * 64)
        # Use the checked-in generated manifest only up to its selected storage
        # gate. It creates no archive, acquisition, controller or host action.
        from houseatlas_updater.model import Acquired, Producer, Selection
        manifest = json.loads((root / "fixtures/bundle.manifest.json").read_bytes())
        manifest["build"]["kind"] = "github-actions"
        manifest["compatibility"].update(status="reviewed", requiredStorageContractSha256="4" * 64,
                                          resultingStorageContractSha256="4" * 64, codeRollbackCompatible=True)
        selected = Selection(manifest["version"], manifest["source"]["commit"], manifest["source"]["tree"],
                             10, 20, manifest["archive"]["name"], manifest["archive"]["sha256"], "9" * 64)
        producer = Producer(manifest["source"]["repository"], manifest["build"]["workflow"],
                            manifest["build"]["ref"], selected.commit, selected.tree,
                            int(manifest["build"]["runId"]), manifest["build"]["runAttempt"])
        raw = (json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode()
        payload = bytes(manifest["archive"]["bytes"])
        policy = SimpleNamespace(max_manifest_bytes=262144, repository=producer.repository)
        verifier.storage_contracts["4" * 64] = legacy(protocol=None)
        self.assert_incompatible(lambda: verifier.verify(Acquired(selected, raw, payload, producer), policy))

    def test_equal_legacy_tuples_cannot_pass_admission_or_compatibility(self):
        ordinary = Storage(*ATLAS)
        for changes in (dict(protocol=True), dict(access_schema=True), dict(atlas_schema=5.0),
                        dict(protocol=None), dict(protocol=2)):
            with self.subTest(changes=changes):
                old = legacy(**changes)
                if changes in (dict(protocol=True), dict(access_schema=True), dict(atlas_schema=5.0)):
                    self.assertEqual(old, ordinary)  # The original equality trap.
                state = Runtime(old, b"generated", (("generated", 1, 1),), b"generated")
                before = SimpleNamespace(storage=old)
                candidate = SimpleNamespace(storage=old)
                self.assert_incompatible(lambda: runtime(state))
                self.assert_incompatible(lambda: installed(before, None))
                self.assert_incompatible(lambda: bundle(candidate, None, before, state, None))
                self.assertFalse(compatible(state, state))
        state = Runtime(ordinary, b"generated", (("generated", 1, 1),), b"generated")
        runtime(state)
        self.assertTrue(compatible(state, state))

