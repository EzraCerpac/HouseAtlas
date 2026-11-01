"""Generated in-memory claims only: no files, transports, consumers or receipts."""

import copy
import json
import unittest

from disposition import InputError, MAX_BYTES, classify, format_evidence, identity, parse, validate

NOW = "2026-01-02T00:00:00Z"


def source(letter="a"):
    return {"manifest": {"sha256": letter * 64, "bytes": 12},
            "payloads": [{"name": "synthetic_mesh", "sha256": "b" * 64, "bytes": 24}]}


def document():
    return {"version": 1, "profile": "publication-input-claims-v1", "label": "synthetic_export",
            "original": source(), "release": source("c"), "events": []}


def event(doc, kind="disposition", state="removed", phase="complete"):
    binding = identity(doc["original"] if kind in {"disposition", "recovery"} else doc["release"])
    return {"id": "event_" + kind, "operation": "operation_" + kind,
            "original": identity(doc["original"]), "kind": kind, "state": state,
            "phase": phase, "recorded": "2026-01-01T00:00:00Z",
            "expires": "2026-01-03T00:00:00Z", "persistence": "stored-readback",
            "evidence": [{"id": kind + "_" + role, "sha256": "d" * 64,
                          "binding": binding, "role": role}
                         for role in ("outcome", "persistence", "readback")]}


def dimension(doc, kind="disposition", **kwargs):
    return classify([doc], as_of=kwargs.get("as_of", NOW))["dimensions"][kind]


class DispositionTests(unittest.TestCase):
    def test_round_trip_detached(self):
        doc = document()
        parsed = parse(json.dumps(doc).encode())
        self.assertEqual(parsed, doc)
        parsed["original"]["manifest"]["bytes"] = 1
        self.assertEqual(doc["original"]["manifest"]["bytes"], 12)

    def test_duplicate_keys_nested_and_root(self):
        for raw in (b'{"version":1,"version":1}', b'{"nested":{"a":1,"a":2}}'):
            with self.assertRaisesRegex(InputError, "duplicate-key"):
                parse(raw)

    def test_input_limits_and_encoding(self):
        for raw in (b" " * (MAX_BYTES + 1), b"\xff", b"[" * 13 + b"]" * 13,
                    b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e9999}'):
            with self.assertRaises(InputError):
                parse(raw)

    def test_closed_contract(self):
        for field, bad in (("version", True), ("version", 2), ("profile", "future")):
            doc = document()
            doc[field] = bad
            with self.assertRaises(InputError):
                validate(doc)
        for target in ("root", "manifest", "event", "reference"):
            doc = document()
            doc["events"] = [event(doc)]
            obj = {"root": doc, "manifest": doc["original"]["manifest"],
                   "event": doc["events"][0], "reference": doc["events"][0]["evidence"][0]}[target]
            obj["unexpected"] = "synthetic"
            with self.assertRaises(InputError):
                validate(doc)

    def test_hash_and_count_bounds(self):
        for field, values in (("sha256", ["A" * 64, "a" * 63, "g" * 64, 1]),
                              ("bytes", [-1, True, 1.0, 9_007_199_254_740_992])):
            for bad in values:
                doc = document()
                doc["original"]["manifest"][field] = bad
                with self.assertRaises(InputError):
                    validate(doc)

    def test_no_path_like_or_control_tokens(self):
        for bad in ("../mesh", "/mesh", "C:\\mesh", "mesh.txt", "a/b", "a\n", "a:b", "", "x" * 65):
            doc = document()
            doc["label"] = bad
            with self.assertRaises(InputError):
                validate(doc)

    def test_payloads_are_unique_bounded_and_ordered(self):
        for payloads in ([], [source()["payloads"][0]] * 2,
                         [dict(source()["payloads"][0], name="z"),
                          dict(source()["payloads"][0], name="a")],
                         [source()["payloads"][0]] * 129):
            doc = document()
            doc["original"]["payloads"] = payloads
            with self.assertRaises(InputError):
                validate(doc)

    def test_same_label_different_content_refused(self):
        doc, changed = document(), document()
        changed["original"]["payloads"][0]["sha256"] = "e" * 64
        with self.assertRaisesRegex(InputError, "label-conflict"):
            classify([doc, changed], as_of=NOW)
        changed["label"] = "other_label"
        with self.assertRaisesRegex(InputError, "ambiguous-original"):
            classify([doc, changed], as_of=NOW)

    def test_absence_and_intent_are_unknown(self):
        doc = document()
        self.assertEqual(dimension(doc)["status"], "unknown")
        doc["events"] = [event(doc, phase="intent")]
        self.assertEqual(dimension(doc)["status"], "unknown")

    def test_completion_is_only_an_unverified_claim(self):
        doc = document()
        doc["events"] = [event(doc)]
        result = classify([doc], as_of=NOW)
        self.assertEqual(result["authority"], "unverified")
        self.assertEqual(result["dimensions"]["disposition"]["status"], "claimed-complete")
        self.assertEqual(result["dimensions"]["recovery"]["status"], "unknown")

    def test_failure_interruption_and_unknown_never_complete(self):
        for phase in ("failed", "interrupted", "unknown"):
            doc = document()
            doc["events"] = [event(doc, phase=phase)]
            self.assertEqual(dimension(doc)["status"], "unknown")
            complete = event(doc)
            complete["id"] = "later_event"
            doc["events"].append(complete)
            self.assertEqual(dimension(doc)["status"], "unknown")

    def test_missing_evidence_and_persistence(self):
        for role in ("outcome", "persistence", "readback"):
            doc = document()
            claim = event(doc)
            claim["evidence"] = [ref for ref in claim["evidence"] if ref["role"] != role]
            doc["events"] = [claim]
            self.assertIn("missing-evidence", dimension(doc)["reasons"])
        for persistence in ("unknown", "failed"):
            doc = document()
            claim = event(doc)
            claim["persistence"] = persistence
            doc["events"] = [claim]
            self.assertEqual(dimension(doc)["status"], "unknown")

    def test_time_window_is_explicit(self):
        doc = document()
        doc["events"] = [event(doc)]
        for now in ("2025-12-31T00:00:00Z", "2026-01-03T00:00:00Z"):
            self.assertIn("outside-evidence-window", dimension(doc, as_of=now)["reasons"])
        for bad in ("2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T00:00:00+00:00"):
            with self.assertRaises(InputError):
                classify([doc], as_of=bad)

    def test_event_replay_is_idempotent_without_mutation(self):
        doc = document()
        doc["events"] = [event(doc)]
        before = copy.deepcopy(doc)
        once = classify([doc], as_of=NOW)
        doc["events"].append(copy.deepcopy(doc["events"][0]))
        self.assertEqual(classify([doc, doc], as_of=NOW), once)
        self.assertEqual(doc["events"][0], before["events"][0])
        changed = copy.deepcopy(doc)
        changed["events"][0]["phase"] = "failed"
        with self.assertRaisesRegex(InputError, "conflicting-event"):
            classify([before, changed], as_of=NOW)

    def test_conflicts_preserve_both_claims(self):
        doc = document()
        removed, present = event(doc), event(doc, state="present")
        present["id"] = "present_event"
        doc["events"] = [removed, present]
        result = dimension(doc)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(len(result["claims"]), 2)
        self.assertIn("conflicting-claims", result["reasons"])

    def test_reference_rebinding_across_snapshots_refused(self):
        doc = document()
        doc["events"] = [event(doc)]
        changed = copy.deepcopy(doc)
        changed["events"][0]["id"] = "new_event"
        changed["events"][0]["evidence"][0]["sha256"] = "e" * 64
        with self.assertRaisesRegex(InputError, "conflicting-reference"):
            classify([doc, changed], as_of=NOW)

    def test_original_and_release_are_not_interchangeable(self):
        doc = document()
        claim = event(doc, kind="recovery", state="recoverable")
        claim["evidence"][0]["binding"] = identity(doc["release"])
        doc["events"] = [claim]
        with self.assertRaisesRegex(InputError, "evidence-binding"):
            validate(doc)
        claim["evidence"][0]["binding"] = identity(doc["original"])
        claim["original"] = identity(doc["release"])
        with self.assertRaisesRegex(InputError, "original-binding"):
            validate(doc)

    def test_dimensions_remain_independent(self):
        doc = document()
        for kind, state in (("disposition", "removed"), ("recovery", "recoverable"),
                            ("qualification", "unqualified"), ("selection", "selected")):
            doc["events"].append(event(doc, kind, state))
        result = classify([doc], as_of=NOW)["dimensions"]
        self.assertTrue(all(value["status"] == "claimed-complete" for value in result.values()))
        self.assertEqual(result["qualification"]["claims"][0]["state"], "unqualified")
        self.assertEqual(result["recovery"]["claims"][0]["release"], None)
        self.assertEqual(result["selection"]["claims"][0]["release"], identity(doc["release"]))

    def test_release_conflict_does_not_change_original_recovery(self):
        doc = document()
        doc["events"] = [event(doc, "selection", "selected"), event(doc, "recovery", "recoverable")]
        changed = copy.deepcopy(doc)
        changed["release"] = source("e")
        changed["events"] = [event(changed, "selection", "selected")]
        changed["events"][0]["id"] = "new_selection"
        changed["events"][0]["operation"] = "new_operation"
        for ref in changed["events"][0]["evidence"]:
            ref["id"] = "new_" + ref["id"]
        result = classify([doc, changed], as_of=NOW)["dimensions"]
        self.assertEqual(result["selection"]["status"], "unknown")
        self.assertEqual(result["recovery"]["status"], "claimed-complete")

    def test_operation_rebinding_refused(self):
        doc = document()
        first, second = event(doc), event(doc, "recovery", "recoverable")
        second["operation"] = first["operation"]
        doc["events"] = [first, second]
        with self.assertRaisesRegex(InputError, "operation-binding"):
            classify([doc], as_of=NOW)

    def test_event_and_batch_limits(self):
        doc = document()
        doc["events"] = [event(doc)] * 257
        with self.assertRaisesRegex(InputError, "event-limit"):
            validate(doc)
        for documents in ([], [document()] * 33):
            with self.assertRaisesRegex(InputError, "document-limit"):
                classify(documents, as_of=NOW)
        doc = document()
        claim = event(doc)
        claim["evidence"] *= 3
        doc["events"] = [claim]
        with self.assertRaisesRegex(InputError, "evidence-limit"):
            validate(doc)

    def test_closed_event_enums_and_time_order(self):
        for field, bad in (("kind", "future"), ("state", "accepted"),
                           ("phase", "success"), ("persistence", "saved"),
                           ("expires", "2026-01-01T00:00:00Z")):
            doc = document()
            claim = event(doc)
            claim[field] = bad
            doc["events"] = [claim]
            with self.assertRaises(InputError):
                validate(doc)

    def test_intent_with_failed_persistence_does_not_disappear(self):
        doc = document()
        intent, complete = event(doc, phase="intent"), event(doc)
        intent["id"] = "intent_event"
        intent["persistence"] = "failed"
        doc["events"] = [intent, complete]
        self.assertIn("persistence-failed", dimension(doc)["reasons"])

    def test_completion_cannot_mask_another_operation_intent(self):
        doc = document()
        complete, intent = event(doc), event(doc, phase="intent")
        intent.update(id="other_intent", operation="other_operation",
                      persistence="unknown", evidence=[])
        doc["events"] = [complete, intent]
        self.assertEqual(dimension(doc)["status"], "unknown")
        self.assertIn("unresolved-intent", dimension(doc)["reasons"])

    def test_same_operation_requires_completion_after_every_intent(self):
        for intent_time in ("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"):
            doc = document()
            complete, intent = event(doc), event(doc, phase="intent")
            intent.update(id="later_intent", recorded=intent_time,
                          persistence="unknown", evidence=[])
            # Input order must not establish chronology, including equal times.
            for claims in ([complete, intent], [intent, complete]):
                doc["events"] = claims
                self.assertEqual(dimension(doc)["status"], "unknown")
                self.assertIn("unresolved-intent", dimension(doc)["reasons"])

    def test_later_supported_completion_correlates_to_each_operation(self):
        doc = document()
        for suffix in ("a", "b"):
            intent, complete = event(doc, phase="intent"), event(doc)
            intent.update(id="intent_" + suffix, operation="operation_" + suffix,
                          persistence="unknown", evidence=[])
            complete.update(id="complete_" + suffix, operation="operation_" + suffix,
                            recorded="2026-01-01T01:00:00Z")
            doc["events"].extend([complete, intent])
        self.assertEqual(dimension(doc)["status"], "claimed-complete")
        replay = copy.deepcopy(doc)
        self.assertEqual(classify([doc, replay], as_of=NOW), classify([doc], as_of=NOW))

    def test_later_unsupported_completion_does_not_resolve_intent(self):
        for defect in ("evidence", "persistence", "future", "expired"):
            doc = document()
            intent, complete = event(doc, phase="intent"), event(doc)
            intent.update(id="intent_event", persistence="unknown", evidence=[])
            complete["recorded"] = "2026-01-01T01:00:00Z"
            if defect == "evidence":
                complete["evidence"] = []
            elif defect == "persistence":
                complete["persistence"] = "unknown"
            elif defect == "future":
                complete["recorded"] = "2026-01-02T01:00:00Z"
            else:
                complete["expires"] = NOW
            doc["events"] = [intent, complete]
            self.assertEqual(dimension(doc)["status"], "unknown")
            self.assertIn("unresolved-intent", dimension(doc)["reasons"])

    def test_missing_release_cannot_support_selection(self):
        doc = document()
        doc["events"] = [event(doc, "selection", "selected")]
        doc["release"] = None
        with self.assertRaisesRegex(InputError, "evidence-binding"):
            validate(doc)
        doc["events"][0]["evidence"] = []
        self.assertEqual(dimension(doc, "selection")["status"], "unknown")

    def test_formatter_deterministic_evidence_only(self):
        doc = document()
        doc["events"] = [event(doc)]
        before = copy.deepcopy(doc)
        text = format_evidence([doc], as_of=NOW)
        self.assertEqual(json.loads(text), classify([doc], as_of=NOW))
        self.assertEqual(text, format_evidence([doc, doc], as_of=NOW))
        self.assertEqual(doc, before)
        self.assertNotIn("verified-complete", text)
        output = json.loads(text)
        self.assertEqual(output["original_identity"], doc["original"])
        self.assertEqual(output["event_claims"][0]["event"], doc["events"][0])
        self.assertEqual(output["release_identities"][identity(doc["release"])], doc["release"])


if __name__ == "__main__":
    unittest.main()
