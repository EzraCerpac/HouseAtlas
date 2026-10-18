"""Narrow generated JSON-input regressions: memory-only, no runtime boundaries."""

import io
import json
import unittest

from houseatlas_updater.cli import run
from houseatlas_updater.model import UpdateError
from houseatlas_updater.validation import json_object


class RecordingStatusController:
    def __init__(self):
        self.calls = []

    def status(self, identifier):
        self.calls.append(identifier)
        return None


class JsonInputRegression(unittest.TestCase):
    def test_nonfinite_constants_are_rejected_at_all_depths(self):
        for constant in (b"NaN", b"Infinity", b"-Infinity"):
            for prefix, suffix in ((b'{"value":', b'}'),
                                   (b'{"value":{"nested":', b'}}'),
                                   (b'{"value":[', b']}')):
                with self.subTest(constant=constant, prefix=prefix):
                    with self.assertRaises(UpdateError) as raised:
                        json_object(prefix + constant + suffix, 4096)
                    self.assertEqual(raised.exception.code, "invalid-request")

    def test_cli_nonfinite_status_selector_never_reads_latest(self):
        for constant in (b"NaN", b"Infinity", b"-Infinity"):
            with self.subTest(constant=constant):
                controller = RecordingStatusController()
                source = io.BytesIO(b'{"format":"houseatlas.updater.status-request.v1","operationId":'
                                    + constant + b'}')
                output = io.StringIO()
                self.assertEqual(run(controller, source, output), 1)
                self.assertEqual(json.loads(output.getvalue()), {
                    "format": "houseatlas.updater.result.v1", "ok": False,
                    "code": "invalid-request", "status": None,
                })
                self.assertEqual(controller.calls, [])

    def test_valid_json_and_null_status_selector_are_preserved(self):
        valid = b'{"integer":42,"decimal":-1.25,"nil":null,"boolean":true,"text":"NaN","nested":[0,{"value":"Infinity"}]}'
        self.assertEqual(json_object(valid, 4096), {
            "integer": 42, "decimal": -1.25, "nil": None, "boolean": True,
            "text": "NaN", "nested": [0, {"value": "Infinity"}],
        })
        for identifier in (None, "00000000-0000-4000-8000-000000000001"):
            with self.subTest(identifier=identifier):
                controller = RecordingStatusController()
                source = io.BytesIO(json.dumps({
                    "format": "houseatlas.updater.status-request.v1", "operationId": identifier,
                }).encode())
                output = io.StringIO()
                self.assertEqual(run(controller, source, output), 0)
                self.assertEqual(json.loads(output.getvalue()), {
                    "format": "houseatlas.updater.result.v1", "ok": True,
                    "code": "none", "status": None,
                })
                self.assertEqual(controller.calls, [identifier])
