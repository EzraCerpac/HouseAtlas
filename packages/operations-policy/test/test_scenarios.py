"""Disposable AT-05 design scenarios, deliberately not HomeBox/runtime tests."""
import copy
import json
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from acceptance import (Rejected, can_mutate, can_read, load_policy, reopening_allowed,
                        rollback_choice, safe_path, sha256, validate_envelope, verify_bundle)


def uid(number):
    return f"00000000-0000-4000-8000-{number:012d}"


class SyntheticCapture:
    """An illustrative owned SQLite/blob model, not a HomeBox schema."""
    def __init__(self, root):
        self.root = root
        self.live = root / "live"
        self.bundle = root / "bundle"
        self.live.mkdir()
        self.fence = threading.Lock()
        self.scope = {"workspaceId": uid(1), "homeId": uid(2),
                      "sourceInstanceId": uid(10), "collectionId": uid(11)}
        self.identities = {"atlasIds": [uid(200), uid(201)],
                           "reconciliationJournalIds": [uid(600)],
                           "bindingKeys": [
                               {"workspaceId": uid(1), "sourceInstanceId": uid(10),
                                "collectionId": uid(11), "sourceKind": "homebox-entity",
                                "externalId": uid(500), "atlasId": uid(200)},
                               {"workspaceId": uid(1), "sourceInstanceId": uid(12),
                                "collectionId": "inventory", "sourceKind": "network-device",
                                "externalId": "device-a", "atlasId": uid(201)}]}
        self.connections = {}
        for owner in ("atlas", "homebox"):
            directory = self.live / owner
            directory.mkdir()
            blob = (f"synthetic {owner} original before capture").encode()
            (directory / "original.bin").write_bytes(blob)
            conn = sqlite3.connect(directory / "state.sqlite")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE asset (id TEXT PRIMARY KEY, path TEXT, digest TEXT)")
            conn.execute("INSERT INTO asset VALUES (?,?,?)", (uid(701 if owner == "atlas" else 702),
                         f"{owner}/original.bin", sha256(blob)))
            conn.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, payload TEXT)")
            conn.execute("INSERT INTO metadata VALUES (?,?)", ("scope", json.dumps(self.scope)))
            if owner == "atlas":
                conn.execute("INSERT INTO metadata VALUES (?,?)", ("identities", json.dumps(self.identities)))
                conn.execute("INSERT INTO metadata VALUES (?,?)", ("cache", json.dumps({
                    "lastSuccessfulFetchAt": "2026-01-02T12:00:00Z",
                    "retrievedAt": "2026-01-02T11:59:00Z", "status": "stale"})))
            conn.commit()
            self.connections[owner] = conn
            (directory / "config.json").write_text(json.dumps({"synthetic": True, "policyVersion": "1.0.0"}))
            (directory / "permissions.json").write_text(json.dumps({"viewer": uid(800), "editor": uid(801),
                                                                     "revoked": [uid(802)]}))
            (directory / "identity.json").write_text(json.dumps(self.identities if owner == "atlas" else self.scope))

    def close(self):
        for conn in self.connections.values():
            conn.close()

    def capture(self):
        self.bundle.mkdir()
        # Caller controls the write fence. SQLite backup retains committed WAL state.
        for owner, conn in self.connections.items():
            directory = self.bundle / owner
            directory.mkdir()
            with sqlite3.connect(directory / "state.sqlite") as destination:
                conn.backup(destination)
            for filename in ("original.bin", "config.json", "permissions.json", "identity.json"):
                shutil.copyfile(self.live / owner / filename, directory / filename)
        return self.envelope()

    def envelope(self):
        components = []
        assets = []
        names = {"state.sqlite": "database", "original.bin": "blob", "config.json": "configuration",
                 "permissions.json": "permissions", "identity.json": "identity"}
        for owner in ("atlas", "homebox"):
            for name, kind in names.items():
                content = (self.bundle / owner / name).read_bytes()
                component = {"owner": owner, "kind": kind, "bundlePath": f"{owner}/{name}",
                             "sha256": sha256(content), "bytes": len(content)}
                components.append(component)
                if kind == "blob":
                    assets.append({key: value for key, value in component.items() if key != "kind"}
                                  | {"assetId": uid(701 if owner == "atlas" else 702)})
        return {"formatVersion": 1, "state": "complete", "bundleId": uid(900),
                "createdAt": "2026-01-02T12:02:00Z", "scope": self.scope,
                "capture": {"method": "quiesced-sqlite-backup-and-immutable-blobs", "coordinationId": uid(901),
                            "windowStartedAt": "2026-01-02T12:00:00Z", "windowEndedAt": "2026-01-02T12:01:00Z",
                            "allWritersBlocked": True, "inFlightWritesDrained": True, "blobDeletionHeld": True,
                            "mutationEpochBefore": 42, "mutationEpochAfter": 42},
                "compatibility": {"contractVersion": "1.0.0", "recordSchemaVersion": 1,
                                  "atlasRelease": "synthetic-r1", "atlasDbSchemaVersion": 1,
                                  "atlasMinReadableDbSchema": 1, "atlasMaxReadableDbSchema": 1,
                                  "homeboxVersion": "v0.26.2", "runtimeIdentity": "python-sqlite-design-model",
                                  "configVersion": "synthetic-1", "mediaPolicyVersion": "1.0.0"},
                "components": components, "assets": assets, "identityInventory": self.identities,
                "accessRecovery": {"membershipIncluded": True, "currentRevocationsReconciled": False,
                                   "invalidatePriorSessions": True},
                "privateRecoveryReferences": ["private-recovery:synthetic-operator-procedure"],
                "checks": {"databaseIntegrity": True, "allReferencedBlobsVerified": True,
                           "scopeAndIdentityVerified": True,
                           "emptyDirectoryRestoreEvidence": "synthetic-unittest-empty-directory"}}

    def verify_references(self, root):
        # Real AT-15/22 must enumerate the actual app's DB and object references.
        for owner in ("atlas", "homebox"):
            with sqlite3.connect(f"file:{root / owner / 'state.sqlite'}?mode=ro", uri=True) as conn:
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise Rejected("database integrity failed")
                for _, relative, digest in conn.execute("SELECT id,path,digest FROM asset"):
                    path = root / safe_path(relative)
                    if not path.is_file() or sha256(path.read_bytes()) != digest:
                        raise Rejected("database/blob point is incoherent")


class AccessAndRollbackScenarios(unittest.TestCase):
    def test_viewer_can_browse_valid_stale_home_without_upstream(self):
        self.assertTrue(can_read("viewer", True, True, True, "timeout"))

    def test_revoked_principal_and_expired_session_cannot_read_cache(self):
        self.assertFalse(can_read("viewer", False, True, True, "timeout"))
        self.assertFalse(can_read("viewer", True, False, True, "timeout"))

    def test_denied_tenant_and_other_home_fail_closed(self):
        self.assertFalse(can_read("viewer", True, True, True, "access-denied"))
        self.assertFalse(can_read("editor", True, True, False, "available"))

    def test_viewer_direct_mutation_and_receipt_replay_denied(self):
        self.assertFalse(can_mutate("viewer", True, True, "atlas", True))

    def test_editor_cannot_write_homebox_or_network(self):
        for owner in ("homebox", "network"):
            self.assertFalse(can_mutate("editor", True, True, owner, True))

    def test_editor_revision_and_membership_required(self):
        self.assertTrue(can_mutate("editor", True, True, "atlas", True))
        self.assertFalse(can_mutate("editor", True, True, "atlas", False))
        self.assertFalse(can_mutate("editor", False, True, "atlas", True))

    def test_operator_is_not_implicitly_household_reader(self):
        self.assertFalse(can_read("operator", True, True, True, "available"))

    def test_compatible_code_rollback(self):
        self.assertEqual(rollback_choice(2, 1, 2, False), "atlas-code-only")

    def test_incompatible_rollback_requires_coherent_prechange_point(self):
        self.assertEqual(rollback_choice(2, 1, 1, False), "stop")
        self.assertEqual(rollback_choice(2, 1, 1, True), "atlas-coherent-state-restore-with-loss-scope")

    def test_incomplete_template_cannot_be_recovery_point(self):
        template = json.loads((Path(__file__).resolve().parents[1] / "fixtures/recovery-envelope.incomplete.json").read_text())
        with self.assertRaises(Rejected):
            validate_envelope(template)

    def test_design_preserves_mvp_and_unmeasured_status(self):
        policy = load_policy()
        self.assertEqual(policy["integration"]["homeboxMethods"], ["GET"])
        self.assertEqual(policy["integration"]["homeboxEditing"], "verified-native-links-only")
        self.assertFalse(policy["offline"]["disconnectedEditing"])
        self.assertEqual(policy["offline"]["nasOutage"], "no-cold-start-or-private-document-guarantee")
        self.assertFalse(policy["target"]["implicitPlatformInstallAllowed"])
        self.assertFalse(policy["target"]["implicitHostMoveAllowed"])
        self.assertFalse(policy["recovery"]["targetDrillPassed"])
        self.assertFalse(policy["futureAgentAccess"]["enabled"])
        self.assertFalse(policy["futureAgentAccess"]["requiresNewAiServiceForMvp"])
        self.assertTrue(policy["futureAgentAccess"]["sharedApplicationAuthorizationAndValidationRequired"])
        self.assertEqual(policy["gates"]["releasedByThisPackage"], [])


class RecoveryScenarios(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="at05-synthetic-", dir=Path(__file__).parent)
        self.model = SyntheticCapture(Path(self.temp.name))
        with self.model.fence:
            self.manifest = self.model.capture()

    def tearDown(self):
        self.model.close()
        self.temp.cleanup()

    def test_complete_paired_bundle_validates(self):
        verify_bundle(self.manifest, self.model.bundle)
        self.model.verify_references(self.model.bundle)

    def test_empty_directory_restore_retains_ids_multibindings_journals_cache_and_permissions(self):
        verify_bundle(self.manifest, self.model.bundle)
        restored = Path(self.temp.name) / "restored"
        shutil.copytree(self.model.bundle, restored)
        verify_bundle(self.manifest, restored)
        self.model.verify_references(restored)
        with sqlite3.connect(restored / "atlas/state.sqlite") as conn:
            identities = json.loads(conn.execute("SELECT payload FROM metadata WHERE key='identities'").fetchone()[0])
            self.assertEqual(identities, self.model.identities)
            cache = json.loads(conn.execute("SELECT payload FROM metadata WHERE key='cache'").fetchone()[0])
            self.assertEqual(cache["lastSuccessfulFetchAt"], "2026-01-02T12:00:00Z")
        self.assertEqual(json.loads((restored / "atlas/permissions.json").read_text())["revoked"], [uid(802)])

    def test_capture_epoch_change_rejected(self):
        self.manifest["capture"]["mutationEpochAfter"] += 1
        with self.assertRaises(Rejected):
            validate_envelope(self.manifest)

    def test_no_drain_or_deletion_fence_rejected(self):
        for key in ("allWritersBlocked", "inFlightWritesDrained", "blobDeletionHeld"):
            manifest = copy.deepcopy(self.manifest)
            manifest["capture"][key] = False
            with self.assertRaises(Rejected):
                validate_envelope(manifest)

    def test_hashing_an_inconsistent_db_blob_copy_is_not_enough(self):
        (self.model.bundle / "homebox/original.bin").write_bytes(b"new bytes after DB cut")
        # Every manifest digest is regenerated, so file-integrity checks alone pass.
        manifest = self.model.envelope()
        verify_bundle(manifest, self.model.bundle)
        with self.assertRaisesRegex(Rejected, "incoherent"):
            self.model.verify_references(self.model.bundle)

    def test_missing_blob_rejected(self):
        (self.model.bundle / "atlas/original.bin").unlink()
        with self.assertRaises(Rejected):
            verify_bundle(self.manifest, self.model.bundle)

    def test_blob_tamper_rejected(self):
        (self.model.bundle / "atlas/original.bin").write_bytes(b"corrupt")
        with self.assertRaises(Rejected):
            verify_bundle(self.manifest, self.model.bundle)

    def test_db_without_config_permissions_or_identity_rejected(self):
        for kind in ("configuration", "permissions", "identity"):
            manifest = copy.deepcopy(self.manifest)
            manifest["components"] = [c for c in manifest["components"]
                                      if not (c["owner"] == "homebox" and c["kind"] == kind)]
            with self.assertRaises(Rejected):
                validate_envelope(manifest)

    def test_unlisted_private_file_contamination_rejected(self):
        (self.model.bundle / "private.env").write_text("synthetic-placeholder-only")
        with self.assertRaisesRegex(Rejected, "unlisted"):
            verify_bundle(self.manifest, self.model.bundle)

    def test_secret_fields_in_envelope_rejected(self):
        self.manifest["apiKey"] = "synthetic-placeholder-only"
        with self.assertRaises(Rejected):
            validate_envelope(self.manifest)

    def test_traversal_absolute_duplicate_and_symlink_paths_rejected(self):
        for path in (".", "../private", "/etc/passwd", "atlas/../../private", "atlas\\state.sqlite", "atlas//state.sqlite"):
            with self.assertRaises(Rejected):
                safe_path(path)
        duplicate = copy.deepcopy(self.manifest)
        duplicate["components"].append(duplicate["components"][0])
        with self.assertRaises(Rejected):
            validate_envelope(duplicate)
        original = self.model.bundle / "atlas/original.bin"
        original.unlink()
        original.symlink_to(self.model.live / "atlas/original.bin")
        with self.assertRaises(Rejected):
            verify_bundle(self.manifest, self.model.bundle)

    def test_network_database_cannot_enter_owned_restore_scope(self):
        self.manifest["components"][0]["owner"] = "network"
        with self.assertRaises(Rejected):
            validate_envelope(self.manifest)

    def test_wrong_source_scope_and_duplicate_reserved_binding_key_rejected(self):
        wrong_scope = copy.deepcopy(self.manifest)
        wrong_scope["identityInventory"]["bindingKeys"][0]["collectionId"] = uid(999)
        duplicate = copy.deepcopy(self.manifest)
        duplicate["identityInventory"]["bindingKeys"].append(duplicate["identityInventory"]["bindingKeys"][0])
        for manifest in (wrong_scope, duplicate):
            with self.assertRaises(Rejected):
                validate_envelope(manifest)

    def test_unknown_or_incompatible_versions_rejected(self):
        for version, value in (("contractVersion", "2.0.0"), ("atlasRelease", None),
                               ("runtimeIdentity", ""), ("atlasDbSchemaVersion", 2),
                               ("homeboxVersion", "v0.27.0")):
            manifest = copy.deepcopy(self.manifest)
            manifest["compatibility"][version] = value
            with self.assertRaises(Rejected):
                validate_envelope(manifest)

    def test_capture_requires_current_revocations_and_real_auth_before_reopening(self):
        self.assertFalse(reopening_allowed(self.manifest, True, True, True))
        self.manifest["accessRecovery"]["currentRevocationsReconciled"] = True
        self.assertTrue(reopening_allowed(self.manifest, True, True, True))
        self.assertFalse(reopening_allowed(self.manifest, True, True, False))
        self.assertFalse(reopening_allowed(self.manifest, False, True, True))

    def test_writer_waits_for_capture_then_restore_remains_complete_before_state(self):
        # A deterministic concurrency illustration of the fence, not a real service fence.
        shutil.rmtree(self.model.bundle)
        live = self.model.live / "homebox"
        attempted = threading.Event()
        completed = threading.Event()
        errors = []

        def writer():
            try:
                attempted.set()
                with self.model.fence:
                    data = b"synthetic after upload/delete replacement"
                    (live / "original.bin").unlink()
                    (live / "original.bin").write_bytes(data)
                    with sqlite3.connect(live / "state.sqlite") as conn:
                        conn.execute("UPDATE asset SET digest=?", (sha256(data),))
                    completed.set()
            except Exception as error:
                errors.append(error)

        self.model.fence.acquire()
        worker = threading.Thread(target=writer)
        worker.start()
        try:
            self.assertTrue(attempted.wait(1))
            self.assertFalse(completed.is_set())
            self.manifest = self.model.capture()
            verify_bundle(self.manifest, self.model.bundle)
            self.model.verify_references(self.model.bundle)
        finally:
            self.model.fence.release()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(completed.is_set())
        self.model.verify_references(self.model.bundle)
        self.model.verify_references(self.model.live)


if __name__ == "__main__":
    unittest.main()
