"""Synthetic source cases. No provider, native preparation or authority handles."""

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from report import InputError, MAX_INPUT, MAX_ORIGINAL, MAX_REPORT, build_report


HERE = Path(__file__).resolve().parent


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def uid(value):
    return f"00000000-0000-4000-8000-{value:012d}"


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((HERE / "fixtures.json").read_bytes())
        self.one = copy.deepcopy(self.fixture)
        self.one["rows"] = [self.one["rows"][1]]
        self.one["observations"] = [self.one["observations"][1]]

    def report(self, data):
        return json.loads(build_report(encode(data)))

    def rejection(self, raw, code):
        with self.assertRaisesRegex(InputError, "^" + code + "$"):
            build_report(raw)

    def test_mixed_rows_and_exact_unchanged_input(self):
        raw = (HERE / "fixtures.json").read_bytes()
        with patch("socket.socket", side_effect=AssertionError("no transport")), patch(
                "builtins.open", side_effect=AssertionError("no input acquisition")):
            encoded = build_report(raw)
        report = json.loads(encoded)
        self.assertEqual(report["execution"], "report-only")
        self.assertEqual([r["rowId"] for r in report["rows"]],
                         [r["rowId"] for r in self.fixture["rows"]])
        self.assertEqual([r["outcome"] for r in report["rows"]],
                         ["unchanged", "proposed-update", "blocked", "blocked", "blocked"])
        self.assertEqual([r["reasons"] for r in report["rows"]],
                         [[], [], ["baseline-conflict"], ["missing-observation"],
                          ["ambiguous-observation"]])
        self.assertEqual([r["observationIndexes"] for r in report["rows"]],
                         [[0], [1], [2], [], [3, 4]])
        for index in [0, 2, 3, 4]:
            self.assertIsNone(report["rows"][index]["proposal"])
        proposal = report["rows"][1]["proposal"]
        self.assertEqual(set(proposal), {"operation", "target", "desired"})
        self.assertEqual(proposal["operation"], "homebox.entity.quantity.set")
        self.assertEqual(proposal["desired"], {"quantity": 2})
        self.assertEqual(proposal["target"]["resourceId"], uid(501))
        self.assertEqual(set(proposal["target"]), {
            "context", "authority", "sourceInstanceId", "collectionId", "resourceKind", "resourceId"})
        self.assertEqual(report["inputDigest"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(raw, (HERE / "fixtures.json").read_bytes())
        self.assertNotIn(b"Same fictional label", encoded)

    def test_digest_serialization_and_determinism(self):
        raw = encode(self.one)
        encoded = build_report(raw)
        self.assertEqual(encoded, build_report(raw))
        report = json.loads(encoded)
        digest = report.pop("reportDigest")
        payload = (json.dumps(report, sort_keys=True, ensure_ascii=True, allow_nan=False,
                              separators=(",", ":")) + "\n").encode("ascii")
        self.assertEqual(digest, hashlib.sha256(payload).hexdigest())
        full = dict(report, reportDigest=digest)
        self.assertEqual(encoded, (json.dumps(full, sort_keys=True, ensure_ascii=True,
                                             separators=(",", ":")) + "\n").encode("ascii"))
        padded = json.loads(build_report(b" \n" + raw + b"\n"))
        self.assertNotEqual(padded["inputDigest"], report["inputDigest"])
        self.assertNotEqual(padded["reportDigest"], digest)

    def test_duplicate_target_blocks_all_rows_without_deduplication(self):
        other = copy.deepcopy(self.one["rows"][0])
        other["rowId"] = "second-correlation"
        self.one["rows"].append(other)
        for row in self.report(self.one)["rows"]:
            self.assertEqual(row["reasons"], ["duplicate-manifest-target"])
            self.assertIsNone(row["proposal"])
        self.one["rows"][1]["rowId"] = self.one["rows"][0]["rowId"]
        self.rejection(encode(self.one), "duplicate-row-id")

    def test_multiple_observations_are_ambiguous_even_if_identical(self):
        for quantity in [1, 3]:
            with self.subTest(quantity=quantity):
                data = copy.deepcopy(self.one)
                other = copy.deepcopy(data["observations"][0])
                native = json.loads(other["originalJsonUtf8"])
                native["quantity"] = quantity
                other["originalJsonUtf8"] = encode(native).decode()
                data["observations"].append(other)
                for observations in [data["observations"], list(reversed(data["observations"]))]:
                    data["observations"] = observations
                    row = self.report(data)["rows"][0]
                    self.assertEqual(row["reasons"], ["ambiguous-observation"])
                    self.assertEqual(row["observationIndexes"], [0, 1])
                    self.assertIsNone(row["proposal"])

    def test_batch_scope_and_profile_declarations_are_not_ignored(self):
        changes = [("context", "workspaceId", uid(80)), ("context", "homeId", uid(81)),
                   ("partition", "sourceInstanceId", uid(82)),
                   ("partition", "collectionId", uid(83)),
                   ("sourceProfile", "dialect", "unsupported-dialect")]
        for group, key, value in changes:
            with self.subTest(group=group, key=key):
                data = copy.deepcopy(self.one)
                data["observationSource"][group][key] = value
                row = self.report(data)["rows"][0]
                self.assertIn("observation-source-mismatch", row["reasons"])
                self.assertEqual(row["observationIndexes"], [])
                self.assertIsNone(row["proposal"])
        for key in ["owner", "resourceKind", "providerVersion", "dialect"]:
            data = copy.deepcopy(self.one)
            data["sourceProfile"][key] = "unsupported"
            data["observationSource"]["sourceProfile"] = copy.deepcopy(data["sourceProfile"])
            self.assertEqual(self.report(data)["rows"][0]["reasons"], ["unsupported-source-profile"])
        self.one["contractVersion"] = "unsupported"
        self.assertEqual(self.report(self.one)["rows"][0]["reasons"], ["unsupported-source-profile"])

    def test_opaque_collection_is_preserved_and_blocked(self):
        for collection in ["synthetic opaque shelf", "é" * 4096,
                           "abcdefab-0000-4000-8000-000000000011".upper(), "0" * 32]:
            data = copy.deepcopy(self.one)
            data["partition"]["collectionId"] = collection
            data["observationSource"]["partition"]["collectionId"] = collection
            row = self.report(data)["rows"][0]
            self.assertEqual(row["target"]["collectionId"], collection)
            self.assertEqual(row["reasons"], ["unsupported-target"])
            self.assertIsNone(row["proposal"])

    def test_baseline_checked_before_equal_desired_and_timestamp_is_lexical(self):
        self.one["rows"][0]["expected"]["quantity"] = 9
        self.one["rows"][0]["desired"]["quantity"] = 1
        self.assertEqual(self.report(self.one)["rows"][0]["reasons"], ["baseline-conflict"])
        self.one["rows"][0]["expected"]["quantity"] = 1
        self.one["rows"][0]["expected"]["updatedAt"] = "2026-01-02T01:04:05.1200Z"
        self.assertEqual(self.report(self.one)["rows"][0]["reasons"], ["baseline-conflict"])

    def test_native_id_and_missing_observation_never_promote_a_label(self):
        native = json.loads(self.one["observations"][0]["originalJsonUtf8"])
        native["id"] = uid(500)
        self.one["observations"][0]["originalJsonUtf8"] = encode(native).decode()
        self.assertEqual(self.report(self.one)["rows"][0]["reasons"], ["observation-identity-mismatch"])
        self.one["observations"][0]["resourceId"] = uid(500)
        self.assertEqual(self.report(self.one)["rows"][0]["reasons"], ["missing-observation"])

    def test_numeric_token_spellings_in_every_quantity_position(self):
        for token in ["-0", "-1", "1.0", "1e0", "1E+0", "true", "false", '"1"',
                      "9007199254740992", "null", "[]", "{}"]:
            for position in ["expected", "desired", "native"]:
                with self.subTest(token=token, position=position):
                    data = copy.deepcopy(self.one)
                    if position == "native":
                        raw = data["observations"][0]["originalJsonUtf8"]
                        native = json.loads(raw)
                        native["quantity"] = "TOKEN"
                        data["observations"][0]["originalJsonUtf8"] = (
                            encode(native).decode().replace('"TOKEN"', token))
                        # Arrays/objects in native scalar fields are malformed.
                        if token in ["[]", "{}"]:
                            self.rejection(encode(data), "invalid-native-scalar")
                            continue
                    else:
                        data["rows"][0][position]["quantity"] = "TOKEN"
                    raw_input = encode(data).replace(b'"TOKEN"', token.encode())
                    row = json.loads(build_report(raw_input))["rows"][0]
                    code = "unsupported-observation-quantity" if position == "native" else "unsupported-quantity"
                    self.assertIn(code, row["reasons"])
                    self.assertIsNone(row["proposal"])
        for quantity in [0, 9007199254740991]:
            self.one["rows"][0]["desired"]["quantity"] = quantity
            self.assertEqual(self.report(self.one)["rows"][0]["proposal"]["desired"],
                             {"quantity": quantity})

    def test_complete_input_rejections(self):
        raw = encode(self.one)
        self.rejection(b"\xff", "invalid-utf8")
        self.rejection(raw + b"{}", "malformed-json")
        self.rejection(b"{" + raw[1:-1] + b',"rows":[]}', "duplicate-property")
        self.rejection(raw.replace(b'"quantity":2', b'"quantity":NaN'), "non-finite-number")
        for mutate in [lambda d: d.update(extra=True),
                       lambda d: d["rows"][0].update(extra=True),
                       lambda d: d["observationSource"].update(extra=True)]:
            data = copy.deepcopy(self.one)
            mutate(data)
            self.rejection(encode(data), "invalid-object-shape")
        data = copy.deepcopy(self.one)
        data["observations"][0]["originalJsonUtf8"] = '{"id":1,"id":2}'
        self.rejection(encode(data), "duplicate-property")
        data["observations"][0]["originalJsonUtf8"] = '{"unknownNativeProperty":1}'
        self.rejection(encode(data), "unknown-native-property-or-shape")
        for row_id in ["", "x" * 65, " space", "é", "a/b"]:
            data = copy.deepcopy(self.one)
            data["rows"][0]["rowId"] = row_id
            self.rejection(encode(data), "invalid-row-id")

    def test_timestamp_and_string_bounds(self):
        for stamp in ["2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T24:00:00Z",
                      "2026-01-01T00:00:00+24:00", "x" * 65, "é"]:
            data = copy.deepcopy(self.one)
            data["rows"][0]["expected"]["updatedAt"] = stamp
            self.rejection(encode(data), "invalid-timestamp")
        data = copy.deepcopy(self.one)
        data["observations"][0]["observedAt"] = "2026-01-01T23:59:60Z"
        self.assertEqual(self.report(data)["rows"][0]["outcome"], "proposed-update")
        data["partition"]["collectionId"] = "x" * 4097
        self.rejection(encode(data), "string-limit")
        self.rejection(encode(self.one).replace(b'"change"', b'"\\ud800"'), "invalid-unicode")

    def test_size_and_depth_limits_without_truncation(self):
        raw = encode(self.one)
        self.assertEqual(len(b" " * (MAX_INPUT - len(raw)) + raw), MAX_INPUT)
        build_report(b" " * (MAX_INPUT - len(raw)) + raw)
        self.rejection(b" " * (MAX_INPUT + 1), "input-byte-limit-or-type")
        data = copy.deepcopy(self.one)
        data["observations"][0]["originalJsonUtf8"] = " " * (MAX_ORIGINAL + 1)
        self.rejection(encode(data), "original-json-limit")
        for field in ["rows", "observations"]:
            data = copy.deepcopy(self.one)
            data[field] *= 101
            self.rejection(encode(data), "array-limit-or-type")
        self.rejection(b"[" * 33 + b"0" + b"]" * 33, "nesting-limit")
        data = copy.deepcopy(self.one)
        data["observations"][0]["originalJsonUtf8"] = "[" * 33 + "0" + "]" * 33
        self.rejection(encode(data), "nesting-limit")
        data = copy.deepcopy(self.one)
        data["partition"]["collectionId"] = "é" * 4096
        data["observationSource"]["partition"]["collectionId"] = "é" * 4096
        data["rows"] = [dict(copy.deepcopy(data["rows"][0]), rowId=f"row{i}", resourceId=uid(1000 + i))
                        for i in range(100)]
        self.rejection(encode(data), "report-byte-limit")
        self.assertLessEqual(len(build_report(raw)), MAX_REPORT)

    def test_exact_bounds_and_known_native_facts_are_retained_in_input_only(self):
        data = copy.deepcopy(self.one)
        data["rows"][0]["rowId"] = "a" * 64
        observation = data["observations"][0]
        native = json.loads(observation["originalJsonUtf8"])
        native["notes"] = "é" * 4096
        native["fields"] = [{"id": uid(800), "name": "Fictional source field",
                             "type": "number", "numberValue": 12}]
        nested = {}
        for _ in range(30):
            nested = {"parent": nested}
        native["parent"] = nested
        original = json.dumps(native, ensure_ascii=False, separators=(",", ":"))
        original += " " * (MAX_ORIGINAL - len(original.encode("utf-8")))
        observation["originalJsonUtf8"] = original
        self.assertEqual(len(original.encode("utf-8")), MAX_ORIGINAL)
        raw = encode(data)
        report = json.loads(build_report(raw))
        self.assertEqual(report["rows"][0]["outcome"], "proposed-update")
        self.assertEqual(report["inputDigest"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(data["observations"][0]["originalJsonUtf8"], original)
        self.assertNotIn(b"Fictional source field", build_report(raw))
        data = copy.deepcopy(self.one)
        data["rows"] = [dict(copy.deepcopy(data["rows"][0]), rowId=f"row{i}", resourceId=uid(1000 + i))
                        for i in range(100)]
        data["observations"] *= 100
        self.assertEqual(len(self.report(data)["rows"]), 100)

    def test_cli_rejects_without_stdout_or_raw_input_in_errors(self):
        completed = subprocess.run([sys.executable, str(HERE / "cli.py"), "-"],
                                   input=b'{"private-looking-value":', capture_output=True, check=False)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"quantity-seed-report: malformed-json\n")
        good = subprocess.run([sys.executable, str(HERE / "cli.py"), "-"],
                              input=encode(self.one), capture_output=True, check=False)
        self.assertEqual(good.returncode, 0)
        self.assertEqual(good.stdout, build_report(encode(self.one)))


if __name__ == "__main__":
    unittest.main()
