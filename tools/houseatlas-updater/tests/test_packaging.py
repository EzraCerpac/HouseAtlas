"""Two exact happy paths against the independently pinned packaging source.

No subprocess/network. The optional path selects a read-only source checkout
for this explicit test only; production caller protocols accept no such path.
"""

import importlib.util
import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from houseatlas_updater.controller import Controller
from houseatlas_updater.model import Acquired, Producer, Selection
from houseatlas_updater.release_bundle import (
    FIXTURE_SHA256, SCHEMA_SHA256, ReleaseBundleV1, validate_schema,
)
from houseatlas_updater.validation import sha256
from .synthetic import STORAGE, World, macho, native_cut, packet


def packaging_source():
    return Path(os.environ.get("HOUSEATLAS_PACKAGING_SOURCE",
                               str(Path(__file__).resolve().parents[2] / "release")))


def load_source(path: Path, name: str):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class PackagingHappyPaths(unittest.TestCase):
    def test_pinned_packaging_fixture_schema(self):
        source = packaging_source()
        schema_bytes = (source / "bundle.schema.json").read_bytes()
        fixture_bytes = (source / "fixtures/bundle.manifest.json").read_bytes()
        self.assertEqual(sha256(schema_bytes), SCHEMA_SHA256)
        self.assertEqual(sha256(fixture_bytes), FIXTURE_SHA256)
        validate_schema(json.loads(fixture_bytes), json.loads(schema_bytes))
        self.assertEqual(json.loads(fixture_bytes)["runtimeQualification"], "not-established")

    def test_packaging_generated_bundle_apply(self):
        source = packaging_source()
        schema_bytes = (source / "bundle.schema.json").read_bytes()
        self.assertEqual(sha256(schema_bytes), SCHEMA_SHA256)
        # These exact source pins were reviewed before importing the helper.
        self.assertEqual(sha256((source / "bundle.py").read_bytes()),
                         "b215dac5ef4ef37607d2883cfb38c82f94d7cab3f6007e96679902ae35a535c4")
        self.assertEqual(sha256((source / "fixtures.py").read_bytes()),
                         "73cb43a2e183a5c6137d068cda43b24c471e2df2e38ade7a7089a12c7a8be8dc")
        packaging = load_source(source / "bundle.py", "houseatlas_reviewed_packaging")
        fixtures = load_source(source / "fixtures.py", "houseatlas_reviewed_packaging_fixtures")
        with tempfile.TemporaryDirectory(prefix="houseatlas-updater-packaging-generated-") as scratch:
            root = Path(scratch)
            world = World(root)
            before = world.installed
            native = native_cut(root / "native")
            payload = fixtures.payload(root / "generated-payload")
            (payload / "bin/houseatlas").write_bytes(macho(b"generated contract header only"))
            metadata = fixtures.metadata()
            metadata["compatibility"].update(status="reviewed", requiredStorageContractSha256="4" * 64,
                                              resultingStorageContractSha256="4" * 64,
                                              codeRollbackCompatible=True)
            output = root / "generated-bundle"
            manifest = packaging.pack(payload, metadata, output)
            raw_manifest = (output / "manifest.json").read_bytes()
            selected = Selection(manifest["version"], manifest["source"]["commit"], manifest["source"]["tree"],
                                 10, 20, manifest["archive"]["name"], manifest["archive"]["sha256"],
                                 sha256(raw_manifest))
            producer = Producer("EzraCerpac/HouseAtlas", ".github/workflows/release-bundle.yml",
                                "refs/heads/main", selected.commit, selected.tree, 1, 1)
            world.add(Acquired(selected, raw_manifest, (output / selected.asset_name).read_bytes(), producer))
            world.policy = replace(world.policy, backend_entry="bin/houseatlas", os_version="15.0",
                                   available_abi=("apple-darwin",), bundle_contract="houseatlas.release-bundle.v1")
            verifier = ReleaseBundleV1(schema_bytes, {"4" * 64: STORAGE}, "3" * 64, synthetic_only=True)
            controller = Controller(world.policy, world, verifier, world, world, world)
            status = controller.execute(packet("apply", selected, before))
            self.assertEqual(status["phase"], "succeeded")
            self.assertEqual(status["bundleContract"], "houseatlas.release-bundle.v1")
            self.assertEqual(status["active"]["frontendShellIdentity"], "a" * 64)
            self.assertEqual(native_cut(root / "native"), native)
            self.assertEqual(world.installed.binary.name, "houseatlas")
            self.assertTrue((world.installed.release_directory / "licenses/synthetic-LICENSE.txt").is_file())
