"""Synthetic injected owner ports only. No filesystem payloads or real transport."""
from dataclasses import replace
import json
import unittest

import disposition as v1
import storage_adapter as a

T0 = a.parse_ns("2026-01-01T00:00:00.000000001Z")


class FakeLease:
    def __init__(self, owner):
        self.owner = owner

    def snapshot(self):
        self.owner.hook("fence")
        return self.owner.fence

    def close(self):
        self.owner.locked = False


class FakeOwner:
    def __init__(self):
        self.clock = a.ClockSample(T0, 10**18, "synthetic_clock")
        self.fence = a.Fence(1, "version_claim", "a" * 64, "b" * 64, "c" * 64, False)
        self.original = a.PinnedSource(b'{ "synthetic": "original" }', (("master", b"generated mesh"), ("scene", b"generated scene")))
        self.release = a.PinnedSource(b'{"synthetic":"release"}', (("overview", b"generated transformed mesh"),))
        self.export = a.FrozenExport(self.original, self.release, "synthetic_export", "synthetic_registry", True)
        self.records, self.verifications, self.refs = {}, {}, {}
        self.locked = self.busy = False
        self.allowed = self.complete_history = True
        self.hooks, self.calls, self.effects = {}, [], 0
        self.read_transform = self.verification_transform = lambda raw: raw
        self.ack_durable = self.read_durable = self.read_independent = True
        self.reference_route = "synthetic_resolver"

    def hook(self, stage):
        callback = self.hooks.get(stage)
        if callback:
            callback(self)

    def tick(self, ns=1):
        self.clock = replace(self.clock, wall_ns=self.clock.wall_ns + ns, monotonic_ns=self.clock.monotonic_ns + ns)

    def now(self, **kw):
        self.hook("clock")
        return self.clock

    def authorize(self, *args, **kw):
        self.hook("authorize")
        return self.allowed

    def try_acquire(self, *args, **kw):
        if self.locked or self.busy:
            return None
        self.locked = True
        return FakeLease(self)

    def frozen_export(self, *args, **kw):
        self.hook("registry")
        return self.export

    def ledger(self, *args, **kw):
        self.calls.append(("ledger", kw))
        self.hook("ledger")
        raws = tuple(self.records.values())
        return a.LedgerSnapshot(raws, a.sha(raws[-1]) if raws else None, self.complete_history, "synthetic_registry")

    def resolve(self, scope, ref, **kw):
        self.calls.append(("resolve", kw))
        self.hook("resolve")
        return self.refs.get(ref, [])

    def append(self, scope, key, raw, expected_tail, **kw):
        self.hook("append")
        tail = a.sha(tuple(self.records.values())[-1]) if self.records else None
        if tail != expected_tail or key in self.records:
            raise ValueError("synthetic exclusive append refused")
        self.records[key] = raw
        self.hook("after_append")
        return a.WriteAck("synthetic_writer", self.ack_durable)

    def independent_read(self, scope, key, **kw):
        self.calls.append(("read", kw))
        self.hook("read")
        raw = self.read_transform(self.records[key])
        return a.Readback(raw, "synthetic_reader", self.read_durable, self.read_independent)

    def append_verification(self, scope, key, raw, **kw):
        self.hook("verification_write")
        if key in self.verifications and self.verifications[key] != raw:
            raise ValueError("synthetic immutable artifact")
        self.verifications[key] = raw
        return a.WriteAck("synthetic_writer", True)

    def independent_verification_read(self, scope, key, **kw):
        self.hook("verification_read")
        return a.Readback(self.verification_transform(self.verifications[key]), "synthetic_reader", True, True)

    def dispatch_under_fence(self, scope, operation, *, effect, **kw):
        self.hook("dispatch")
        registry=a.sha(a.canonical({"label":self.export.label,"original":self.export.original.identity_object(),
                                   "release":self.export.release.identity_object() if self.export.release else None,
                                   "provenance":self.export.provenance}))
        tail=a.sha(tuple(self.records.values())[-1]) if self.records else None
        if (not self.locked or not self.allowed or registry != kw["registry_sha256"] or tail != kw["dispatch_sha256"]
                or self.fence.object() != kw["fence"]
                or self.clock.source != kw["clock_source"]
                or self.clock.wall_ns >= kw["intent_deadline_ns"]
                or self.clock.monotonic_ns >= kw["elapsed_deadline_ns"]):
            raise ValueError("synthetic conditional dispatch refused")
        self.effects += 1
        return effect()

    def request(self):
        return a.canonical(dict(version=1, profile="publication-input-claims-v1", label=self.export.label,
                                original=self.export.original.identity_object(),
                                release=self.export.release.identity_object() if self.export.release else None, events=[]))

    def evidence(self, *, operation="op", kind="disposition", state="removed", prefix="ref", cloud="not_applicable"):
        source = self.export.original if kind in ("disposition", "recovery") else self.export.release
        binding = v1.identity(source.identity_object())
        refs = []
        for role in ("outcome", "persistence", "readback"):
            name = prefix + "_" + role
            body = dict(profile=a.EVIDENCE_PROFILE, scope="synthetic_scope", owner="synthetic_owner",
                        operation=operation, kind=kind, state=state, binding=binding, role=role,
                        recorded=a.format_ns(self.clock.wall_ns), provenance="synthetic_registry",
                        origin="prospective", cloud_status=cloud,
                        carriers=["d" * 64] if kind == "recovery" else [])
            raw = a.canonical(body)
            self.refs[name] = [a.ResolvedReference(raw, self.reference_route, True, role == "readback")]
            refs.append(dict(id=name, sha256=a.sha(raw), binding=binding, role=role))
        return tuple(refs)


def config(**changes):
    values = dict(scope="synthetic_scope", owner="synthetic_owner", clock_source="synthetic_clock",
                  registry_provenance="synthetic_registry", write_route="synthetic_writer", read_route="synthetic_reader",
                  reference_routes=("synthetic_resolver",), kinds=("disposition", "recovery", "qualification", "selection"),
                  horizons=a.Horizons(a.PROPOSED_INTENT_NS, a.PROPOSED_OBSERVATION_NS), callback_budget_ns=a.NS)
    values.update(changes)
    return a.OwnerConfig(**values)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.o = FakeOwner()
        self.adapter = a.StorageAdapter(config(), self.o)
        self.raw = self.o.request()

    def intent(self, **changes):
        args = dict(operation="op", event_id="intent", kind="disposition", state="removed")
        args.update(changes)
        return self.adapter.capture_intent(self.raw, **args)

    def dispatch(self, effect=lambda: "synthetic result", **changes):
        args = dict(operation="op", event_id="dispatch", kind="disposition", state="removed", effect=effect)
        args.update(changes)
        return self.adapter.dispatch(self.raw, **args)

    def outcome(self, **changes):
        args = dict(operation="op", event_id="complete", kind="disposition", state="removed", phase="complete",
                    references=changes.get("references") if "references" in changes else self.o.evidence())
        args.update(changes)
        return self.adapter.record_outcome(self.raw, **args)

    def prepared(self):
        self.intent()
        self.o.tick()
        self.dispatch()
        self.o.tick()

    def completed(self):
        self.prepared()
        return self.outcome()

    def test_precision_one_ns_across_boundaries(self):
        for value in ("2026-01-01T00:00:00.999999999Z", "2026-01-01T23:59:59.999999999Z", "2026-12-31T23:59:59.999999999Z"):
            stamp = a.parse_ns(value)
            self.assertEqual(a.format_ns(stamp), value)
            self.assertEqual(a.parse_ns(a.format_ns(stamp + 1)), stamp + 1)

    def test_precision_refuses_rounding_offsets_floats_and_invalid_dates(self):
        for value in ("2026-02-30T00:00:00.000000000Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.1Z",
                      "2026-01-01T00:00:00.000000000+00:00", "2026-01-01T00:00:60.000000000Z", True, 1.0):
            with self.assertRaises(a.AdapterError):
                a.parse_ns(value)
        for value in (True, -1, 1.0, 10**30):
            with self.assertRaises(a.AdapterError):
                a.format_ns(value)

    def test_raw_v1_admission_first(self):
        for raw in (b'{"version":1,"version":1}', self.raw.replace(b'"version":1', b'"extra":true,"version":1')):
            with self.assertRaises(ValueError):
                self.adapter.capture_intent(raw, operation="op", event_id="intent", kind="disposition", state="removed")
        self.assertFalse(self.o.records)

    def test_original_bytes_pins_and_changed_payload_identity(self):
        pin = self.o.original.identity_object()
        self.assertEqual(pin["manifest"]["sha256"], a.sha(self.o.original.manifest))
        changed = replace(self.o.original, payloads=(("master", b"changed"), ("scene", b"generated scene")))
        self.assertNotEqual(v1.identity(pin), v1.identity(changed.identity_object()))
        self.o.export = replace(self.o.export, original=changed)
        with self.assertRaisesRegex(a.AdapterError, "original-changed"):
            self.intent()

    def test_registry_sorted_unique_safe_tokens_and_bounds(self):
        for rows in ((("scene", b"x"), ("master", b"y")), (("master", b"x"), ("master", b"y")), (("mesh.glb", b"x"),), ()):
            with self.assertRaises(ValueError):
                a.PinnedSource(b"manifest", rows).identity_object()
        with self.assertRaises(ValueError):
            v1.validate(dict(json.loads(self.raw), original={"manifest": {"sha256": "a" * 64, "bytes": True}, "payloads": []}))

    def test_idempotent_intent_preserves_exact_bytes_and_artifact(self):
        first = self.intent()
        self.o.tick()
        self.assertEqual(self.intent(), first)
        self.assertEqual(len(self.o.records), 1)
        self.assertEqual(len(self.o.verifications), 1)
        record = a.parse_record(first["record"])
        self.assertIsInstance(record["monotonic_ns"], str)
        self.assertEqual(record["monotonic_ns"], str(10**18))

    def test_event_and_operation_rebinding_refused(self):
        self.intent()
        for args in (dict(state="present"), dict(operation="another"), dict(kind="recovery", state="recoverable")):
            with self.assertRaises(a.AdapterError):
                self.intent(**args)
        with self.assertRaisesRegex(a.AdapterError, "operation-exists"):
            self.intent(event_id="new_intent")

    def test_restart_cannot_redispatch_or_evasion_by_new_operation(self):
        self.prepared()
        self.adapter = a.StorageAdapter(config(), self.o)
        self.intent()  # An idempotent storage replay, not a reusable permit.
        with self.assertRaisesRegex(a.AdapterError, "dispatch-once"):
            self.dispatch(event_id="another_dispatch")
        with self.assertRaisesRegex(a.AdapterError, "reconcile-first"):
            self.intent(operation="escape", event_id="escape_intent")
        self.assertEqual(self.o.effects, 1)

    def test_unknown_effect_and_lost_reply_preserve_dispatch(self):
        self.intent()
        self.o.tick()
        def lost_reply():
            raise TimeoutError("synthetic private locator must not escape")
        with self.assertRaisesRegex(a.AdapterError, "^uncertain-effect$"):
            self.dispatch(effect=lost_reply)
        self.assertEqual(self.o.effects, 1)
        self.assertEqual(a.parse_record(self.o.records["dispatch"])["phase"], "dispatch")
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"], "unknown")

    def test_completion_failure_after_effect_blocks_new_cycle(self):
        self.prepared()
        self.o.hooks["append"] = lambda _: (_ for _ in ()).throw(OSError("synthetic private locator"))
        with self.assertRaisesRegex(a.AdapterError, "^owner-port-append$"):
            self.outcome()
        self.o.hooks.clear()
        with self.assertRaisesRegex(a.AdapterError, "reconcile-first"):
            self.intent(operation="escape", event_id="escape")
        self.assertEqual(self.o.effects, 1)

    def test_intent_durability_stages_fail_closed(self):
        for field in ("ack_durable", "read_durable", "read_independent"):
            owner = FakeOwner()
            setattr(owner, field, False)
            adapter = a.StorageAdapter(config(), owner)
            with self.assertRaises(a.AdapterError):
                adapter.capture_intent(owner.request(), operation="op", event_id="i", kind="disposition", state="removed")
            owner.tick()
            with self.assertRaises(a.AdapterError):
                adapter.dispatch(owner.request(), operation="op", event_id="d", kind="disposition", state="removed", effect=lambda: None)
            self.assertEqual(owner.effects, 0)

    def test_changed_valid_short_duplicate_and_read_errors(self):
        for change in (lambda b: b[:-1], lambda b: b.replace(b'"removed"', b'"present"'),
                       lambda b: b'{"id":"x","id":"x"}', lambda b: b" "+b):
            owner = FakeOwner()
            owner.read_transform = change
            with self.assertRaises(a.AdapterError):
                a.StorageAdapter(config(), owner).capture_intent(owner.request(), operation="op", event_id="i", kind="disposition", state="removed")
            self.assertEqual(owner.effects, 0)
        self.o.hooks["read"] = lambda _: (_ for _ in ()).throw(OSError("synthetic private path"))
        with self.assertRaisesRegex(a.AdapterError, "^owner-port-independent_read$"):
            self.intent()

    def test_missing_or_changed_verification_artifact_never_unlocks_dispatch(self):
        self.intent()
        self.o.verifications.clear()
        self.o.tick()
        with self.assertRaises(a.AdapterError):
            self.dispatch()
        self.assertEqual(self.o.effects, 0)
        self.o.verifications["intent"] = b'{"document":{"sha256":"' + b"a" * 64 + b'"}}'
        with self.assertRaises(a.AdapterError):
            self.dispatch()

    def test_completion_artifact_failure_prevents_projection_and_next_intent(self):
        self.prepared()
        self.o.hooks["verification_write"] = lambda _: (_ for _ in ()).throw(OSError("synthetic failure"))
        with self.assertRaises(a.AdapterError):
            self.outcome()
        self.o.hooks.clear()
        self.assertIn("complete", self.o.records)
        with self.assertRaises(a.AdapterError):
            self.adapter.project_current(kind="disposition")
        with self.assertRaises(a.AdapterError):
            self.intent(operation="escape", event_id="escape")

    def test_lock_busy_and_unfenced_actor(self):
        for change in (lambda o: setattr(o, "busy", True), lambda o: setattr(o, "fence", replace(o.fence, independent_actor=True))):
            owner = FakeOwner()
            change(owner)
            with self.assertRaises(a.AdapterError):
                a.StorageAdapter(config(), owner).capture_intent(owner.request(), operation="op", event_id="i", kind="disposition", state="removed")
            self.assertFalse(owner.records)

    def test_protected_state_change_during_readback_stops(self):
        self.o.hooks["read"] = lambda o: setattr(o, "fence", replace(o.fence, policy="d" * 64))
        with self.assertRaisesRegex(a.AdapterError, "fence-changed"):
            self.intent()
        self.assertEqual(self.o.effects, 0)

    def test_conditional_owner_dispatch_catches_final_race(self):
        self.intent()
        self.o.tick()
        self.o.hooks["dispatch"] = lambda o: setattr(o, "fence", replace(o.fence, selection="e" * 64))
        with self.assertRaisesRegex(a.AdapterError, "uncertain-effect"):
            self.dispatch()
        self.assertEqual(self.o.effects, 0)
        self.assertIn("dispatch", self.o.records)

    def test_clock_reversal_missing_provenance_and_restart_reset(self):
        self.intent()
        base=a.ClockSample(T0+1,10**18+1,"synthetic_clock")
        for clock in (replace(base, wall_ns=T0-1), replace(base, monotonic_ns=0),
                      replace(base, source="other_clock")):
            self.o.clock = clock
            with self.assertRaises(a.AdapterError):
                a.StorageAdapter(config(), self.o).dispatch(self.raw, operation="op", event_id="d", kind="disposition", state="removed", effect=lambda: None)
        self.assertEqual(self.o.effects, 0)

    def test_clock_reversal_during_persistence(self):
        self.o.hooks["after_append"] = lambda o: setattr(o, "clock", replace(o.clock, wall_ns=T0-1))
        with self.assertRaisesRegex(a.AdapterError, "clock-reversal"):
            self.intent()
        self.assertFalse(self.o.verifications)

    def test_intent_expiry_at_dispatch_and_elapsed_limit(self):
        for wall, mono in ((T0+a.PROPOSED_INTENT_NS, 10**18+a.PROPOSED_INTENT_NS),
                           (T0+1, 10**18+a.PROPOSED_INTENT_NS)):
            owner = FakeOwner()
            adapter = a.StorageAdapter(config(), owner)
            adapter.capture_intent(owner.request(), operation="op", event_id="i", kind="disposition", state="removed")
            owner.clock = replace(owner.clock, wall_ns=wall, monotonic_ns=mono)
            with self.assertRaises(a.AdapterError):
                adapter.dispatch(owner.request(), operation="op", event_id="d", kind="disposition", state="removed", effect=lambda: None)
            self.assertEqual(owner.effects, 0)

    def test_expiry_during_effect_requires_reconciliation(self):
        self.intent()
        self.o.tick()
        self.dispatch(effect=lambda: self.o.tick(a.PROPOSED_INTENT_NS))
        with self.assertRaisesRegex(a.AdapterError, "intent-expired"):
            self.outcome()
        self.assertNotIn("complete", self.o.records)
        self.assertEqual(self.o.effects, 1)

    def test_equal_earlier_or_other_operation_completion_refused(self):
        self.prepared()
        for when in (T0, T0+1):
            self.o.clock = replace(self.o.clock, wall_ns=T0+2)
            refs = self.o.evidence(prefix="same")
            self.change_evidence(refs, "recorded", a.format_ns(when))
            with self.assertRaises(a.AdapterError):
                self.outcome(references=refs)
        with self.assertRaises(a.AdapterError):
            self.outcome(operation="other", references=self.o.evidence(operation="other"))

    def change_evidence(self, refs, field, value):
        for ref in refs:
            resolved = self.o.refs[ref["id"]][0]
            body = a.decode(resolved.raw)
            body[field] = value
            raw = a.canonical(body)
            self.o.refs[ref["id"]] = [replace(resolved, raw=raw)]
            ref["sha256"] = a.sha(raw)

    def test_reference_missing_ambiguous_changed_routes_and_provenance(self):
        self.prepared()
        refs = self.o.evidence()
        key = refs[0]["id"]
        saved = self.o.refs[key]
        for replacement in ([], saved*2, [replace(saved[0], raw=b"changed")],
                            [replace(saved[0], route="untrusted")], [replace(saved[0], durable=False)]):
            self.o.refs[key] = replacement
            with self.assertRaises(a.AdapterError):
                self.outcome(references=refs)
        self.o.refs[key] = saved
        self.change_evidence(refs, "provenance", "other_registry")
        with self.assertRaises(a.AdapterError):
            self.outcome(references=refs)

    def test_reference_role_operation_owner_binding_and_history(self):
        self.prepared()
        for field, value in (("role", "persistence"), ("operation", "other"), ("owner", "other"),
                             ("binding", "f" * 64), ("origin", "historical")):
            refs = self.o.evidence()
            self.change_evidence(refs, field, value)
            with self.assertRaises(a.AdapterError):
                self.outcome(references=refs)
        refs = self.o.evidence()
        readback = refs[-1]["id"]
        self.o.refs[readback] = [replace(self.o.refs[readback][0], independent=False)]
        with self.assertRaises(a.AdapterError):
            self.outcome(references=refs)

    def test_missing_roles_and_evidence_bounds(self):
        self.prepared()
        refs = self.o.evidence()
        for bad in (refs[:2], refs*3, (r for r in refs)):
            with self.assertRaises(a.AdapterError):
                self.outcome(references=bad)
        key=refs[0]["id"]
        raw=b" "*(a.MAX_BYTES+1)
        self.o.refs[key]=[a.ResolvedReference(raw, "synthetic_resolver", True, False)]
        refs[0]["sha256"]=a.sha(raw)
        with self.assertRaises(a.AdapterError):
            self.outcome(references=refs)

    def test_recovery_pending_error_conflict_never_cloud_completion(self):
        for cloud in ("pending", "error", "conflict"):
            with self.assertRaises(a.AdapterError):
                self.adapter.record_observation(self.raw, operation="recovery", event_id="r", kind="recovery", state="recoverable",
                                                references=self.o.evidence(operation="recovery", kind="recovery", state="recoverable", cloud=cloud))
        self.assertFalse(self.o.records)

    def test_release_evidence_and_kind_authority_are_independent(self):
        custody = a.StorageAdapter(config(kinds=("disposition", "recovery")), self.o)
        with self.assertRaises(a.AdapterError):
            custody.record_observation(self.raw, operation="selection", event_id="s", kind="selection", state="selected",
                                       references=self.o.evidence(operation="selection", kind="selection", state="selected"))
        self.o.export=replace(self.o.export, release=self.o.original)
        with self.assertRaises(a.AdapterError):
            self.adapter.capture_intent(self.o.request(), operation="selection", event_id="s", kind="selection", state="selected")
        self.o.export=replace(self.o.export, release=None)
        with self.assertRaises(a.AdapterError):
            self.adapter.capture_intent(self.o.request(), operation="selection", event_id="s", kind="selection", state="selected")

    def test_readonly_observation_does_not_establish_mutation_completion(self):
        result=self.adapter.record_observation(self.raw, operation="observe", event_id="o", kind="disposition", state="present",
                                              references=self.o.evidence(operation="observe", state="present"))
        self.assertEqual(a.parse_record(result["record"])["phase"], "observation")
        self.assertEqual(self.o.effects, 0)
        with self.assertRaises(a.AdapterError):
            self.adapter.record_outcome(self.raw, operation="observe", event_id="complete", kind="disposition", state="present", phase="complete",
                                        references=self.o.evidence(operation="observe", state="present"))
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"], "supported-observation")
        self.assertEqual(a.StorageAdapter.diagnose_v1(self.raw, as_of="2026-01-01T00:00:00Z")["authority"], "unverified")

    def test_failed_interrupted_and_unknown_preserved_without_automatic_erasure(self):
        for phase in ("failed", "interrupted", "unknown"):
            owner=FakeOwner()
            adapter=a.StorageAdapter(config(),owner)
            raw=owner.request()
            adapter.capture_intent(raw,operation="op",event_id="i",kind="disposition",state="removed")
            owner.tick()
            adapter.dispatch(raw,operation="op",event_id="d",kind="disposition",state="removed",effect=lambda: None)
            owner.tick()
            adapter.record_outcome(raw,operation="op",event_id="f",kind="disposition",state="removed",phase=phase)
            with self.assertRaises(a.AdapterError):
                adapter.record_outcome(raw,operation="op",event_id="c",kind="disposition",state="removed",phase="complete",references=owner.evidence())
            self.assertEqual(adapter.project_current(kind="disposition")["status"],"unknown")
            self.assertEqual(a.parse_record(owner.records["f"])["phase"],phase)

    def test_reconciliation_covers_all_history_and_retains_failure(self):
        self.prepared()
        self.outcome(phase="unknown", event_id="unknown", references=())
        self.o.tick()
        refs=self.o.evidence(state="present",prefix="reconciled")
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        with self.assertRaises(a.AdapterError):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",references=refs,reconciles=history[:-1])
        self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",references=refs,reconciles=history)
        view=self.adapter.project_current(kind="disposition")
        self.assertEqual(view["status"],"supported-observation")
        self.assertEqual(len(view["history"]),4)
        self.assertIn("unknown",self.o.records)
        self.o.tick()
        self.intent(operation="new_cycle",event_id="new_intent",state="removed")
        self.assertEqual(self.o.effects,1)

    def test_frontier_cas_rejects_append_during_commit(self):
        def race(owner):
            owner.records["concurrent"] = b"synthetic competing bytes"
        self.o.hooks["append"]=race
        with self.assertRaisesRegex(a.AdapterError,"owner-port-append"):
            self.intent()
        self.assertNotIn("intent",self.o.records)
        self.assertEqual(self.o.effects,0)

    def test_incomplete_history_forks_and_wire_bounds(self):
        self.o.complete_history=False
        with self.assertRaisesRegex(a.AdapterError,"history-incomplete"):
            self.intent()
        self.o.complete_history=True
        saved=self.intent()["record"]
        fork=a.decode(saved)
        fork["id"]="fork"
        self.o.records["fork"]=a.canonical(fork)
        with self.assertRaises(a.AdapterError):
            self.adapter.project_current(kind="disposition")
        for raw in (b" "*(a.MAX_BYTES+1),b"["*13+b"]"*13,b'{"a":1,"a":2}'):
            with self.assertRaises(a.AdapterError):
                a.parse_record(raw)

    def test_observation_expiry_requires_new_reconciliation_not_timestamp_rewrite(self):
        result=self.completed()
        before=result["record"]
        self.o.tick(a.PROPOSED_OBSERVATION_NS)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"unknown")
        self.assertEqual(self.o.records["complete"],before)
        with self.assertRaises(a.AdapterError):
            self.intent(operation="refresh",event_id="refresh")
        self.assertEqual(self.o.effects,1)

    def test_changed_registry_and_clock_at_final_dispatch(self):
        self.intent()
        self.o.tick()
        self.o.hooks["dispatch"]=lambda o:setattr(o,"export",replace(o.export,original=replace(o.original,manifest=b"changed at dispatch")))
        with self.assertRaises(a.AdapterError):
            self.dispatch()
        self.assertEqual(self.o.effects,0)

    def test_callbacks_receive_explicit_bounds_and_budget(self):
        self.completed()
        self.adapter.project_current(kind="disposition")
        for name,kw in self.o.calls:
            self.assertEqual(kw["budget_ns"],a.NS)
            self.assertIn("max_bytes",kw)
        for horizons in ((True,1),(0,1),(1,86401*a.NS)):
            with self.assertRaises(a.AdapterError):
                a.Horizons(*horizons)

    def test_stale_or_cross_operation_verification_is_not_rebound(self):
        self.intent()
        original=self.o.verifications["intent"]
        for field,value in (("event","another"),("operation","another"),("registry_sha256","a"*64)):
            body=a.decode(original)
            body[field]=value
            self.o.verifications["intent"]=a.canonical(body)
            with self.assertRaises(a.AdapterError):
                self.adapter.verify_durable_readback(self.o.records["intent"])
        self.o.verifications["intent"]=original
        self.assertEqual(self.adapter.verify_durable_readback(self.o.records["intent"])["sha256"],a.sha(self.o.records["intent"]))

    def test_reference_rebinding_rejected_before_ledger_append(self):
        self.completed()
        self.o.tick()
        refs=self.o.evidence(state="present")  # Reuses IDs with changed bytes.
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        before=dict(self.o.records)
        with self.assertRaisesRegex(a.AdapterError,"reference-rebound"):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",references=refs,reconciles=history)
        self.assertEqual(self.o.records,before)

    def test_completion_preserves_distinct_verification_bytes(self):
        result=self.completed()
        artifact=a.decode(result["verification"])
        record=a.parse_record(result["record"])
        self.assertNotEqual(result["verification"],result["record"])
        self.assertEqual(artifact["document"]["sha256"],a.sha(result["record"]))
        self.assertEqual(artifact["recorded"],record["recorded"])
        self.assertEqual(len(artifact["references"]),3)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"supported-observation")

    def test_changed_source_label_cannot_escape_retained_history(self):
        self.completed()
        self.o.export=replace(self.o.export,label="new_label",original=replace(self.o.original,manifest=b"changed manifest"))
        with self.assertRaisesRegex(a.AdapterError,"history-source"):
            self.adapter.capture_intent(self.o.request(),operation="new",event_id="new",kind="disposition",state="removed")

    def test_expired_reconciliation_cannot_refresh_by_replay(self):
        self.completed()
        self.o.tick()
        refs=self.o.evidence(state="present",prefix="renewed")
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        result=self.adapter.reconcile_operation(self.raw,operation="op",event_id="renew",kind="disposition",state="present",references=refs,reconciles=history)
        self.o.tick(a.PROPOSED_OBSERVATION_NS)
        self.assertEqual(self.adapter.reconcile_operation(self.raw,operation="op",event_id="renew",kind="disposition",state="present",references=refs,reconciles=history),result)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"unknown")
        self.assertEqual(self.o.effects,1)

    def test_mutable_caller_reference_container_is_frozen(self):
        self.prepared()
        refs=self.o.evidence()
        original=dict(refs[0])
        self.o.hooks["resolve"]=lambda _:refs[0].update(sha256="e"*64)
        result=self.outcome(references=refs)
        self.assertEqual(a.parse_record(result["record"])["evidence"][0],original)

    def test_missing_authority_or_retained_original_stops_before_intent(self):
        self.o.allowed=False
        with self.assertRaisesRegex(a.AdapterError,"authorization"):
            self.intent()
        self.o.allowed=True
        self.o.export=replace(self.o.export,retained=False)
        with self.assertRaisesRegex(a.AdapterError,"registry"):
            self.intent()
        self.assertFalse(self.o.records)

    def test_prospective_record_rejects_extra_fields_and_unsafe_monotonic_numbers(self):
        record=a.parse_record(self.intent()["record"])
        for field,value in (("unexpected",True),("monotonic_ns",10**18),("monotonic_ns",True),
                            ("profile","future"),("recorded","2026-01-01T00:00:00Z")):
            bad=dict(record)
            bad[field]=value
            with self.assertRaises(a.AdapterError):
                a.parse_record(a.canonical(bad))

    def test_pure_v1_remains_closed_to_fractional_events(self):
        document=json.loads(self.raw)
        document["events"]=[dict(id="i",operation="op",original=v1.identity(document["original"]),kind="disposition",state="removed",
                                 phase="intent",recorded=a.format_ns(T0),expires=a.format_ns(T0+a.NS),persistence="unknown",evidence=[])]
        with self.assertRaises(v1.InputError):
            a.admit_request(a.canonical(document))


if __name__ == "__main__":
    unittest.main()
