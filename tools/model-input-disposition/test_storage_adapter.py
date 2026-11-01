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


class FakeStream:
    def __init__(self, owner, handle):
        self.owner, self.handle, self.position = owner, handle, 0
        self.state = owner.stream_states[handle]

    def read_chunk(self, *, max_bytes, budget_ns):
        self.owner.stream_calls.append((max_bytes, budget_ns))
        self.owner.hook("stream_read")
        source = self.owner.stream_data[self.handle]
        if type(source) is tuple:
            pattern, total = source
            count = min(max_bytes, total-self.position)
            chunk = (pattern * (count//len(pattern)+1))[:count]
        else:
            chunk = source[self.position:self.position+max_bytes]
        self.position += len(chunk)
        return chunk

    def close(self):
        self.owner.hook("stream_close")


class FakeOwner:
    def __init__(self):
        self.clock = a.ClockSample(T0, 10**18, "synthetic_clock")
        self.fence = a.Fence(1, "version_claim", "a" * 64, "b" * 64, "c" * 64, False)
        self.original = a.PinnedSource(b'{ "synthetic": "original" }', (("master", b"generated mesh"), ("scene", b"generated scene")))
        self.release = a.PinnedSource(b'{"synthetic":"release"}', (("overview", b"generated transformed mesh"),))
        self.export = a.FrozenExport(self.original, self.release, "synthetic_export", "synthetic_registry", True)
        self.records, self.verifications, self.refs = {}, {}, {}
        self.admissions = {}
        self.boundaries = {}
        self.locked = self.busy = False
        self.allowed = self.complete_history = True
        self.hooks, self.calls, self.effects = {}, [], 0
        self.read_transform = self.verification_transform = lambda raw: raw
        self.ack_durable = self.read_durable = self.read_independent = True
        self.verification_ack_durable = True
        self.reference_route = "synthetic_resolver"
        self.stream_data, self.stream_states, self.stream_calls = {}, {}, []

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

    def stream_state(self, scope, handle, **kw):
        return self.stream_states[handle]

    def open_stream(self, scope, handle, **kw):
        self.hook("stream_open")
        if self.stream_states[handle].sha256 != kw["expected_state"]:
            raise ValueError("synthetic changed stream")
        return FakeStream(self,handle)

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
        return a.WriteAck("synthetic_writer", self.verification_ack_durable)

    def independent_verification_read(self, scope, key, **kw):
        self.hook("verification_read")
        return a.Readback(self.verification_transform(self.verifications[key]), "synthetic_reader", True, True)

    def commit_admission(self, scope, key, proposal, **kw):
        self.hook("admission_write")
        body=a.decode(proposal)
        tail=a.sha(tuple(self.records.values())[-1]) if self.records else None
        registry=a.sha(a.canonical({"label":self.export.label,"original":self.export.original.identity_object(),
                                   "release":self.export.release.identity_object() if self.export.release else None,
                                   "provenance":self.export.provenance,"streams":body["stream_seals"]}))
        if (not self.locked or not self.allowed or self.fence.object()!=body["fence"]
                or self.clock.source!=body["clock_source"] or registry!=body["registry_sha256"]
                or tail!=body["document_sha256"] or a.sha(self.records[key])!=body["document_sha256"]
                or a.sha(self.verifications[key])!=body["verification_sha256"]
                or self.clock.wall_ns<a.parse_ns(body["validated"])
                or self.clock.monotonic_ns<int(body["validated_monotonic_ns"])
                or self.clock.wall_ns>=a.parse_ns(body["wall_deadline"])
                or self.clock.monotonic_ns>=int(body["elapsed_deadline_ns"])
                or any(self.stream_states[h].sha256!=v["state_sha256"] for h,v in body["stream_seals"].items())):
            raise ValueError("synthetic conditional durable admission refused")
        body.update(committed=a.format_ns(self.clock.wall_ns),committed_monotonic_ns=str(self.clock.monotonic_ns))
        encoded=a.canonical(body)
        if key in self.admissions and self.admissions[key]!=encoded:
            raise ValueError("synthetic immutable admission")
        self.admissions[key]=encoded
        self.hook("admission_after_commit")
        return a.WriteAck("synthetic_writer",True)

    def independent_admission_read(self, scope, key, **kw):
        self.calls.append(("admission_read",kw))
        self.hook("admission_read")
        return a.Readback(self.admissions[key],"synthetic_reader",True,True)

    def dispatch_under_fence(self, scope, operation, *, effect, **kw):
        self.hook("dispatch")
        registry=a.sha(a.canonical({"label":self.export.label,"original":self.export.original.identity_object(),
                                   "release":self.export.release.identity_object() if self.export.release else None,
                                   "provenance":self.export.provenance,"streams":kw["stream_seals"]}))
        tail=a.sha(tuple(self.records.values())[-1]) if self.records else None
        streams_ok=all(self.stream_states[handle].sha256 == descriptor["state_sha256"]
                       for handle,descriptor in kw["stream_seals"].items())
        proofs_ok=all(key in self.records and key in self.verifications and key in self.admissions and
                      a.sha(self.records[key])==proof["record"] and
                      a.sha(self.verifications[key])==proof["verification"] and
                      a.sha(self.admissions[key])==proof["admission"]
                      for key,proof in kw["predecessor_proofs"].items())
        if (not proofs_ok or not streams_ok or not self.locked or not self.allowed or registry != kw["registry_sha256"] or tail != kw["dispatch_sha256"]
                or self.fence.object() != kw["fence"]
                or self.clock.source != kw["clock_source"]
                or self.clock.wall_ns >= kw["intent_deadline_ns"]
                or self.clock.monotonic_ns >= kw["elapsed_deadline_ns"]):
            raise ValueError("synthetic conditional dispatch refused")
        self.effects += 1
        try:
            return effect()
        finally:
            event=a.parse_record(tuple(self.records.values())[-1])
            self.boundaries[operation]=a.canonical(dict(
                profile="publication-input-storage-dispatch-boundary-v2",status="settled",
                dispatch_sha256=kw["dispatch_sha256"],settled=a.format_ns(self.clock.wall_ns),
                settled_monotonic_ns=str(self.clock.monotonic_ns),
                **{k:event[k] for k in ("scope","owner","operation","kind","registry_sha256","fence","clock_source")}))

    def independent_dispatch_boundary(self, scope, operation, **kw):
        self.hook("boundary_read")
        return a.Readback(self.boundaries[operation],"synthetic_reader",True,True)

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
                        recorded=a.format_ns(self.clock.wall_ns), clock_source="synthetic_clock", provenance="synthetic_registry",
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
        self.o.tick()
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
                             ("binding", "f" * 64), ("origin", "historical"), ("clock_source", "other_clock")):
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
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-readback"):
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

    def test_completion_requires_original_fence_and_elapsed_lease(self):
        self.prepared()
        fence=self.o.fence
        self.o.fence=replace(fence,policy="e"*64)
        with self.assertRaisesRegex(a.AdapterError,"pinned-state-changed"):
            self.outcome()
        self.o.fence=fence
        self.o.clock=replace(self.o.clock,wall_ns=self.o.clock.wall_ns+1,monotonic_ns=10**18+a.PROPOSED_INTENT_NS+1)
        with self.assertRaisesRegex(a.AdapterError,"intent-expired"):
            self.outcome()
        self.assertNotIn("complete",self.o.records)

    def test_dependent_intent_and_current_view_check_fences_and_elapsed_freshness(self):
        self.completed()
        fence=self.o.fence
        self.o.fence=replace(fence,selection="e"*64)
        with self.assertRaisesRegex(a.AdapterError,"pinned-state-changed"):
            self.intent(operation="new",event_id="new")
        self.o.fence=fence
        self.o.clock=replace(self.o.clock,monotonic_ns=self.o.clock.monotonic_ns+a.PROPOSED_OBSERVATION_NS)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"unknown")

    def test_reconciliation_requires_post_effect_evidence_and_new_readback(self):
        self.prepared()
        self.outcome(phase="unknown",event_id="unknown",references=())
        self.o.tick()
        refs=self.o.evidence(prefix="stale",state="present")
        self.change_evidence(refs,"recorded",a.format_ns(T0))
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-stale"):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",references=refs,reconciles=history)
        self.assertNotIn("reconcile",self.o.records)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"unknown")

    def test_reconciliation_equal_to_latest_capture_is_not_later(self):
        self.prepared()
        self.outcome(phase="unknown",event_id="unknown",references=())
        refs=self.o.evidence(prefix="equal",state="present")
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-stale"):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",references=refs,reconciles=history)

    def streamed(self, data=b"generated streamed bytes", *, limits=None):
        handle="synthetic_stream"
        self.o.stream_data[handle]=data
        state="f"*64
        self.o.stream_states[handle]=a.StreamState(state,"synthetic_reader",True,True)
        if type(data) is tuple:
            pattern,total=data
            digest=a.hashlib.sha256()
            for _ in range(total//len(pattern)):
                digest.update(pattern)
            if total%len(pattern):
                digest.update(pattern[:total%len(pattern)])
            pin=a.StreamPayload("master",handle,total,digest.hexdigest(),state)
        else:
            pin=a.StreamPayload("master",handle,len(data),a.sha(data),state)
        self.o.export=replace(self.o.export,original=a.StreamingSource(b'{ "untouched":true }',(pin,)))
        self.raw=self.o.request()
        self.adapter=a.StorageAdapter(config(stream_limits=limits or a.StreamLimits(1024,2048,4,1024)),self.o)
        return pin

    def test_streaming_hashes_actual_bytes_and_binds_separate_artifact(self):
        self.streamed()
        result=self.completed()
        artifact=a.decode(result["verification"])
        self.assertEqual(artifact["original"],v1.identity(self.o.export.original.identity_object()))
        self.assertEqual(artifact["streams"]["synthetic_stream"]["sha256"],a.sha(b"generated streamed bytes"))
        self.assertTrue(all(size<=4 and budget==a.NS for size,budget in self.o.stream_calls))
        self.assertNotIn(b"generated streamed bytes",result["record"])
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"supported-observation")

    def test_streaming_mismatch_short_read_and_extra_bytes_refused(self):
        pin=self.streamed()
        for actual in (b"changed",b"generated streamed byte",b"generated streamed bytes extra"):
            self.o.stream_data[pin.handle]=actual
            with self.assertRaises(a.AdapterError):
                self.intent()
        self.assertFalse(self.o.records)

    def test_streaming_state_readback_route_and_independence_required(self):
        pin=self.streamed()
        original=self.o.stream_states[pin.handle]
        for state in (replace(original,sha256="e"*64),replace(original,route="other"),
                      replace(original,durable=False),replace(original,independent=False)):
            self.o.stream_states[pin.handle]=state
            with self.assertRaises(a.AdapterError):
                self.intent()
        self.assertFalse(self.o.records)

    def test_streaming_state_changes_during_read_or_dispatch_stop_effect(self):
        pin=self.streamed()
        old=self.o.stream_states[pin.handle]
        self.o.hooks["stream_close"]=lambda o:o.stream_states.update({pin.handle:replace(old,sha256="e"*64)})
        with self.assertRaises(a.AdapterError):
            self.intent()
        self.o.hooks.clear()
        self.o.stream_states[pin.handle]=old
        self.intent()
        self.o.tick()
        self.o.hooks["dispatch"]=lambda o:o.stream_states.update({pin.handle:replace(old,sha256="e"*64)})
        with self.assertRaises(a.AdapterError):
            self.dispatch()
        self.assertEqual(self.o.effects,0)

    def test_streaming_admission_and_chunk_limits_are_enforced_before_effect(self):
        self.streamed(limits=a.StreamLimits(1024,2048,4,1))
        with self.assertRaisesRegex(a.AdapterError,"stream-chunks"):
            self.intent()
        self.assertEqual(len(self.o.stream_calls),1)
        self.adapter=a.StorageAdapter(config(stream_limits=a.StreamLimits(1,2048,4,100)),self.o)
        with self.assertRaisesRegex(a.AdapterError,"stream-admission"):
            self.intent()
        self.adapter=a.StorageAdapter(config(),self.o)
        with self.assertRaisesRegex(a.AdapterError,"stream-admission"):
            self.intent()
        for values in ((True,1,1,1),(1,1,0,1),(2,1,1,1),(1,1,1024**2+1,1)):
            with self.assertRaises(a.AdapterError):
                a.StreamLimits(*values)
        self.assertFalse(self.o.records)

    def test_streaming_opaque_pin_mapping_and_hash_declarations_are_not_trusted(self):
        pin=self.streamed()
        for bad in (replace(pin,name="master.glb"),replace(pin,bytes=True),replace(pin,sha256="A"*64)):
            source=replace(self.o.export.original,payloads=(bad,))
            with self.assertRaises(ValueError):
                source.identity_object()
        self.o.export=replace(self.o.export,original=replace(self.o.export.original,payloads=(replace(pin,sha256="e"*64),)))
        self.raw=self.o.request()
        with self.assertRaisesRegex(a.AdapterError,"stream-pin-changed"):
            self.intent()
        self.assertFalse(self.o.records)

    def test_streaming_large_generated_source_does_not_require_whole_buffer(self):
        # A repeated generated stream exceeds the memory-only source cap; the
        # largest owned chunk is 1 MiB. No source file or actual master is read.
        chunk=b"x"*(1024**2)
        self.streamed((chunk,65*1024**2),limits=a.StreamLimits(70*1024**2,80*1024**2,1024**2,100))
        self.intent()
        self.assertEqual(len(self.o.stream_calls),66)
        self.assertTrue(all(size<=1024**2 for size,_ in self.o.stream_calls))
        self.assertEqual(self.o.effects,0)

    def test_streaming_unbounded_or_mutable_chunks_are_refused(self):
        self.streamed()
        original=FakeStream.read_chunk
        try:
            for bad in (bytearray(b"x"),(x for x in (b"x",)),b"x"*8):
                FakeStream.read_chunk=lambda *args,**kwargs:bad
                with self.assertRaises(a.AdapterError):
                    self.intent()
        finally:
            FakeStream.read_chunk=original
        self.assertFalse(self.o.records)

    def test_reconciled_old_intent_is_not_a_reusable_dispatch_permit(self):
        self.adapter.record_observation(self.raw,operation="observe",event_id="observation",kind="disposition",state="present",
                                        references=self.o.evidence(operation="observe",state="present",prefix="observed"))
        self.o.tick()
        self.intent(operation="old",event_id="old_intent")
        self.o.tick()
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        self.adapter.reconcile_operation(self.raw,operation="observe",event_id="reconcile",kind="disposition",state="present",
                                        references=self.o.evidence(operation="observe",state="present",prefix="reconciled"),reconciles=history)
        with self.assertRaisesRegex(a.AdapterError,"intent-superseded"):
            self.dispatch(operation="old",event_id="old_dispatch")
        self.o.tick()
        self.intent(operation="replacement",event_id="replacement_intent")
        self.o.tick()
        self.dispatch(operation="replacement",event_id="replacement_dispatch")
        with self.assertRaisesRegex(a.AdapterError,"intent-superseded"):
            self.dispatch(operation="old",event_id="old_dispatch")
        self.assertEqual(self.o.effects,1)
        self.assertNotIn("old_dispatch",self.o.records)

    def test_late_completion_after_covering_reconciliation_is_not_current_authority(self):
        self.adapter.record_observation(self.raw,operation="observe",event_id="observation",kind="disposition",state="present",
                                        references=self.o.evidence(operation="observe",state="present",prefix="observed"))
        self.o.tick()
        self.prepared()
        self.o.tick()
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        self.adapter.reconcile_operation(self.raw,operation="observe",event_id="reconcile",kind="disposition",state="present",
                                        references=self.o.evidence(operation="observe",state="present",prefix="reconciled"),reconciles=history)
        self.o.tick()
        with self.assertRaisesRegex(a.AdapterError,"outcome-superseded"):
            self.outcome()
        self.assertNotIn("complete",self.o.records)

    def test_expiry_during_verification_cannot_become_supported_after_restart(self):
        self.prepared()
        self.o.hooks["verification_write"]=lambda o:setattr(o,"clock",replace(o.clock,monotonic_ns=o.clock.monotonic_ns+a.PROPOSED_INTENT_NS))
        with self.assertRaisesRegex(a.AdapterError,"intent-expired"):
            self.outcome()
        self.o.hooks.clear()
        self.assertIn("complete",self.o.records)
        self.assertIn("complete",self.o.verifications)
        self.assertNotIn("complete",self.o.admissions)
        self.adapter=a.StorageAdapter(config(),self.o)
        with self.assertRaises(a.AdapterError):
            self.adapter.project_current(kind="disposition")
        with self.assertRaises(a.AdapterError):
            self.intent(operation="replacement",event_id="replacement")
        self.assertEqual(self.o.effects,1)

    def test_conditional_admission_refuses_expiry_in_final_commit_window(self):
        self.prepared()
        self.o.hooks["admission_write"]=lambda o:setattr(o,"clock",replace(o.clock,monotonic_ns=o.clock.monotonic_ns+a.PROPOSED_INTENT_NS))
        with self.assertRaisesRegex(a.AdapterError,"owner-port-commit_admission"):
            self.outcome()
        self.assertNotIn("complete",self.o.admissions)
        self.o.hooks.clear()
        with self.assertRaises(a.AdapterError):
            a.StorageAdapter(config(),self.o).project_current(kind="disposition")

    def test_unadmitted_completion_can_be_covered_only_by_new_readonly_reconciliation(self):
        self.prepared()
        self.o.hooks["verification_write"]=lambda o:setattr(o,"clock",replace(o.clock,monotonic_ns=o.clock.monotonic_ns+a.PROPOSED_INTENT_NS))
        with self.assertRaises(a.AdapterError):
            self.outcome()
        self.o.hooks.clear()
        self.o.tick()
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        self.adapter=a.StorageAdapter(config(),self.o)
        self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",
                                        references=self.o.evidence(state="present",prefix="post_failure"),reconciles=history)
        view=self.adapter.project_current(kind="disposition")
        self.assertEqual(view["status"],"supported-observation")
        self.assertEqual(sorted(view["covered_history"]),sorted(history))
        self.assertNotIn("complete",self.o.admissions)
        self.intent(operation="new_cycle",event_id="new_intent")
        self.assertEqual(self.o.effects,1)

    def test_post_write_faults_cannot_publish_authority_after_restart(self):
        for fault in ("ack","readback","clock","reversal","fence","registry","authority","stream"):
            with self.subTest(fault=fault):
                self.setUp()
                if fault=="stream":
                    self.streamed()
                self.prepared()
                saved_clock,saved_fence,saved_export=self.o.clock,self.o.fence,self.o.export
                saved_streams=dict(self.o.stream_states)
                def mutate(owner):
                    if fault=="ack":
                        owner.verification_ack_durable=False
                    elif fault=="clock":
                        owner.clock=replace(owner.clock,source="other")
                    elif fault=="reversal":
                        owner.clock=replace(owner.clock,monotonic_ns=0)
                    elif fault=="fence":
                        owner.fence=replace(owner.fence,policy="e"*64)
                    elif fault=="registry":
                        owner.export=replace(owner.export,provenance="other")
                    elif fault=="authority":
                        owner.allowed=False
                    elif fault=="stream":
                        owner.stream_states["synthetic_stream"]=replace(owner.stream_states["synthetic_stream"],sha256="e"*64)
                if fault=="readback":
                    self.o.hooks["verification_read"]=lambda o:((_ for _ in ()).throw(OSError("synthetic readback failure")) if "complete" in o.verifications else None)
                else:
                    self.o.hooks["verification_write"]=mutate
                with self.assertRaises(a.AdapterError):
                    self.outcome()
                self.assertIn("complete",self.o.records)
                self.assertIn("complete",self.o.verifications)
                self.assertNotIn("complete",self.o.admissions)
                self.o.hooks.clear()
                self.o.clock,self.o.fence,self.o.export=saved_clock,saved_fence,saved_export
                self.o.stream_states=saved_streams
                self.o.allowed=self.o.verification_ack_durable=True
                self.adapter=a.StorageAdapter(config(stream_limits=a.StreamLimits(1024,2048,4,1024) if fault=="stream" else None),self.o)
                with self.assertRaises(a.AdapterError):
                    self.adapter.project_current(kind="disposition")
                with self.assertRaises(a.AdapterError):
                    self.intent(operation="escape",event_id="escape")
                self.assertEqual(self.o.effects,1)

    def test_valid_atomic_admission_can_be_recovered_after_lost_commit_reply(self):
        self.prepared()
        self.o.hooks["admission_after_commit"]=lambda _:(_ for _ in ()).throw(TimeoutError("synthetic lost reply"))
        with self.assertRaisesRegex(a.AdapterError,"owner-port-commit_admission"):
            self.outcome()
        self.assertIn("complete",self.o.admissions)
        self.o.hooks.clear()
        self.adapter=a.StorageAdapter(config(),self.o)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"supported-observation")
        with self.assertRaises(a.AdapterError):
            self.dispatch(event_id="retry")
        self.assertEqual(self.o.effects,1)

    def test_admission_readback_failure_does_not_erase_actual_committed_success(self):
        self.prepared()
        self.o.hooks["admission_read"]=lambda o:((_ for _ in ()).throw(TimeoutError("synthetic lost readback")) if "complete" in o.admissions else None)
        with self.assertRaisesRegex(a.AdapterError,"owner-port-independent_admission_read"):
            self.outcome()
        self.assertIn("complete",self.o.admissions)
        self.o.hooks.clear()
        self.adapter=a.StorageAdapter(config(),self.o)
        self.assertEqual(self.adapter.project_current(kind="disposition")["status"],"supported-observation")
        self.assertEqual(self.o.effects,1)

    def test_late_reply_does_not_invalidate_an_on_time_conditional_commit(self):
        self.prepared()
        self.o.hooks["admission_after_commit"]=lambda o:setattr(o,"clock",replace(o.clock,monotonic_ns=o.clock.monotonic_ns+a.PROPOSED_INTENT_NS))
        result=self.outcome()
        marker=a.decode(result["admission"])
        self.assertLess(int(marker["committed_monotonic_ns"]),int(marker["elapsed_deadline_ns"]))
        self.o.hooks.clear()
        self.assertEqual(a.StorageAdapter(config(),self.o).project_current(kind="disposition")["status"],"supported-observation")
        self.assertEqual(self.o.effects,1)

    def test_reconciliation_rejects_evidence_from_dispatch_persistence(self):
        self.intent()
        self.o.tick()
        captured=[]
        def during_dispatch(owner):
            owner.tick()
            captured.extend(owner.evidence(state="present",prefix="pre_effect"))
        self.o.hooks["verification_write"]=during_dispatch
        actual=["present"]
        self.dispatch(effect=lambda:actual.__setitem__(0,"removed"))
        self.assertEqual(actual,["removed"])
        self.o.hooks.clear()
        self.o.tick()
        marker=a.decode(self.o.admissions["dispatch"])
        evidence=a.decode(self.o.refs["pre_effect_outcome"][0].raw)
        self.assertEqual(evidence["recorded"],marker["committed"])
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-dispatch-cut"):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",
                                            references=tuple(captured),reconciles=history)
        self.assertNotIn("reconcile",self.o.records)
        self.assertEqual(self.o.effects,1)

    def test_retained_reconciliation_rejects_dispatch_admission_equal_evidence(self):
        self.intent()
        self.o.tick()
        captured=[]
        def during_dispatch(owner):
            owner.tick()
            captured.extend(owner.evidence(state="present",prefix="retained_pre_effect"))
        self.o.hooks["verification_write"]=during_dispatch
        self.dispatch()
        self.o.hooks.clear()
        self.o.tick()
        prior=a.parse_record(self.o.records["dispatch"])
        recorded=a.decode(self.o.refs["retained_pre_effect_outcome"][0].raw)["recorded"]
        forged=dict(prior,id="forged",phase="reconcile",state="present",mode="observation",
                    recorded=recorded,captured=a.format_ns(self.o.clock.wall_ns),
                    expires=a.format_ns(a.parse_ns(recorded)+a.PROPOSED_OBSERVATION_NS),
                    monotonic_ns=str(self.o.clock.monotonic_ns),evidence=captured,
                    predecessors=[a.sha(self.o.records["dispatch"])],
                    reconciles=sorted(a.sha(raw) for raw in self.o.records.values()))
        self.o.records["forged"]=a.canonical(forged)
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-dispatch-cut"):
            a.StorageAdapter(config(),self.o).project_current(kind="disposition")

    def test_missing_active_predecessor_proofs_block_dependent_dispatch(self):
        for sidecar in ("verifications","admissions"):
            with self.subTest(sidecar=sidecar):
                self.setUp()
                self.completed()
                self.o.tick()
                self.intent(operation="next",event_id="next_intent")
                getattr(self.o,sidecar).pop("complete")
                self.o.tick()
                self.adapter=a.StorageAdapter(config(),self.o)
                with self.assertRaises(a.AdapterError):
                    self.dispatch(operation="next",event_id="next_dispatch")
                self.assertNotIn("next_dispatch",self.o.records)
                self.assertEqual(self.o.effects,1)

    def test_conditional_dispatch_binds_predecessor_proof_loss_and_rebinding(self):
        for stage in ("verification_write","dispatch"):
            for sidecar in ("verifications","admissions"):
                for changed in (False,True):
                    with self.subTest(stage=stage,sidecar=sidecar,changed=changed):
                        self.setUp()
                        self.completed()
                        self.o.tick()
                        self.intent(operation="next",event_id="next_intent")
                        self.o.tick()
                        def lose(owner):
                            data=getattr(owner,sidecar)
                            if changed:
                                data["complete"]=data["complete"]+b" "
                            else:
                                data.pop("complete")
                        self.o.hooks[stage]=lose
                        with self.assertRaises(a.AdapterError):
                            self.dispatch(operation="next",event_id="next_dispatch")
                        self.assertEqual(self.o.effects,1)
                        self.o.hooks.clear()
                        with self.assertRaises(a.AdapterError):
                            a.StorageAdapter(config(),self.o).project_current(kind="disposition")

    def test_evidence_collected_in_invocation_gap_cannot_complete_or_reconcile(self):
        self.intent()
        self.o.tick()
        refs=[]
        def in_gap(owner):
            owner.tick()
            refs.extend(owner.evidence(prefix="gap"))
        self.o.hooks["dispatch"]=in_gap
        self.dispatch(effect=lambda:self.o.tick())
        evidence=a.decode(self.o.refs["gap_outcome"][0].raw)
        self.assertGreater(a.parse_ns(evidence["recorded"]),a.parse_ns(a.decode(self.o.admissions["dispatch"])["committed"]))
        self.assertLess(a.parse_ns(evidence["recorded"]),a.parse_ns(a.decode(self.o.boundaries["op"])["settled"]))
        self.o.hooks.clear()
        self.o.tick()
        with self.assertRaisesRegex(a.AdapterError,"unresolved-dispatch"):
            self.outcome(references=tuple(refs))
        history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
        with self.assertRaisesRegex(a.AdapterError,"reconciliation-dispatch-cut"):
            self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="removed",
                                            references=tuple(refs),reconciles=history)
        self.assertEqual(self.o.effects,1)

    def test_missing_or_rebound_settled_boundary_remains_uncertain(self):
        for bad in ("missing","rebound","unsettled"):
            with self.subTest(bad=bad):
                self.setUp()
                self.prepared()
                if bad=="missing":
                    self.o.boundaries.clear()
                else:
                    body=a.decode(self.o.boundaries["op"])
                    body["operation" if bad=="rebound" else "status"]="other"
                    self.o.boundaries["op"]=a.canonical(body)
                with self.assertRaises(a.AdapterError):
                    self.outcome()
                self.o.tick()
                with self.assertRaises(a.AdapterError):
                    self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="present",
                        references=self.o.evidence(state="present",prefix="new"),
                        reconciles=tuple(sorted(a.sha(raw) for raw in self.o.records.values())))
                self.assertEqual(self.o.effects,1)

    def test_retained_completion_cannot_use_pre_effect_gap_evidence(self):
        self.intent()
        self.o.tick()
        refs=[]
        def in_gap(owner):
            owner.tick()
            refs.extend(owner.evidence(prefix="retained_gap"))
        self.o.hooks["dispatch"]=in_gap
        self.dispatch(effect=lambda:self.o.tick())
        self.o.hooks.clear()
        self.o.tick()
        prior=a.parse_record(self.o.records["dispatch"])
        recorded=a.decode(self.o.refs["retained_gap_outcome"][0].raw)["recorded"]
        forged=dict(prior,id="forged_complete",phase="complete",recorded=recorded,
                    captured=a.format_ns(self.o.clock.wall_ns),monotonic_ns=str(self.o.clock.monotonic_ns),
                    expires=a.format_ns(a.parse_ns(recorded)+a.PROPOSED_OBSERVATION_NS),evidence=refs,
                    predecessors=[a.sha(self.o.records["dispatch"])])
        self.o.records["forged_complete"]=a.canonical(forged)
        with self.assertRaisesRegex(a.AdapterError,"unresolved-dispatch"):
            a.StorageAdapter(config(),self.o).project_current(kind="disposition")

    def test_settled_elapsed_clock_floor_survives_divergent_restart(self):
        for phase in ("complete","reconcile","retained_complete","retained_reconcile"):
            with self.subTest(phase=phase):
                self.setUp()
                self.intent()
                self.o.tick()
                admission_mono=self.o.clock.monotonic_ns
                self.dispatch(effect=lambda:self.o.tick(100))
                self.o.clock=replace(self.o.clock,wall_ns=self.o.clock.wall_ns+1,monotonic_ns=admission_mono+50)
                self.adapter=a.StorageAdapter(config(),self.o)
                refs=self.o.evidence(prefix="after_rollback")
                history=tuple(sorted(a.sha(raw) for raw in self.o.records.values()))
                if phase.startswith("retained"):
                    terminal=phase.split("_")[1]
                    prior=a.parse_record(self.o.records["dispatch"])
                    forged=dict(prior,id="forged",phase=terminal,
                        recorded=a.format_ns(self.o.clock.wall_ns),captured=a.format_ns(self.o.clock.wall_ns),
                        monotonic_ns=str(self.o.clock.monotonic_ns),evidence=list(refs),
                        expires=a.format_ns(self.o.clock.wall_ns+a.PROPOSED_OBSERVATION_NS),
                        mode="observation" if terminal=="reconcile" else "mutation",
                        predecessors=[a.sha(self.o.records["dispatch"])],
                        reconciles=list(history) if terminal=="reconcile" else [])
                    self.o.records["forged"]=a.canonical(forged)
                    with self.assertRaisesRegex(a.AdapterError,"clock-reversal"):
                        self.adapter.project_current(kind="disposition")
                elif phase=="complete":
                    with self.assertRaisesRegex(a.AdapterError,"clock-reversal"):
                        self.outcome(references=refs)
                else:
                    with self.assertRaisesRegex(a.AdapterError,"clock-reversal"):
                        self.adapter.reconcile_operation(self.raw,operation="op",event_id="reconcile",kind="disposition",state="removed",
                            references=refs,reconciles=history)
                self.assertEqual(self.o.effects,1)

    def test_canonical_admission_rebind_cannot_replace_intent_prerequisite(self):
        self.completed()
        self.o.tick()
        self.intent(operation="next",event_id="next_intent")
        intent=a.parse_record(self.o.records["next_intent"])
        pinned=intent["prerequisite_proofs"]["complete"]["admission"]
        body=a.decode(self.o.admissions["complete"])
        body["committed"]=a.format_ns(a.parse_ns(body["committed"])+1)
        body["committed_monotonic_ns"]=str(int(body["committed_monotonic_ns"])+1)
        self.o.admissions["complete"]=a.canonical(body)
        self.assertNotEqual(a.sha(self.o.admissions["complete"]),pinned)
        self.o.tick()
        with self.assertRaisesRegex(a.AdapterError,"prerequisite-proof-changed"):
            a.StorageAdapter(config(),self.o).dispatch(self.raw,operation="next",event_id="next_dispatch",kind="disposition",state="removed",effect=lambda:None)
        self.assertNotIn("next_dispatch",self.o.records)
        self.assertEqual(self.o.effects,1)
        with self.assertRaisesRegex(a.AdapterError,"prerequisite-proof-changed"):
            a.StorageAdapter(config(),self.o).project_current(kind="disposition")

    def test_ten_retained_cycles_reuse_bounded_proof_snapshots(self):
        for cycle in range(10):
            op="cycle"+str(cycle)
            self.intent(operation=op,event_id=op+"_intent")
            self.o.tick()
            self.dispatch(operation=op,event_id=op+"_dispatch")
            self.o.tick()
            self.outcome(operation=op,event_id=op+"_complete",references=self.o.evidence(operation=op,prefix=op))
            self.o.tick()
        self.assertEqual(self.o.effects,10)
        self.assertEqual(a.StorageAdapter(config(),self.o).project_current(kind="disposition")["status"],"supported-observation")

    def test_pure_v1_remains_closed_to_fractional_events(self):
        document=json.loads(self.raw)
        document["events"]=[dict(id="i",operation="op",original=v1.identity(document["original"]),kind="disposition",state="removed",
                                 phase="intent",recorded=a.format_ns(T0),expires=a.format_ns(T0+a.NS),persistence="unknown",evidence=[])]
        with self.assertRaises(v1.InputError):
            a.admit_request(a.canonical(document))


if __name__ == "__main__":
    unittest.main()
