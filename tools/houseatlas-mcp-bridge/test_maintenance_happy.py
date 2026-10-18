"""One explicitly generated maintenance composition; no native/server process."""

import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from houseatlas_updater.controller import Controller
from maintenance_owner import MaintenanceOwner


ROOT = Path(__file__).resolve().parents[2]


def source_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge = source_module('generated_maintenance_bridge', ROOT / 'tools/houseatlas-mcp-bridge/bridge.py')
generated = source_module('generated_updater_world', ROOT / 'tools/houseatlas-updater/tests/synthetic.py')


class MaintenanceHappyPath(unittest.TestCase):
    def test_mcp_generated_check_apply_and_retained_status(self):
        with tempfile.TemporaryDirectory(prefix='houseatlas-mcp-maintenance-generated-') as name:
            world = generated.World(Path(name))
            controller = Controller(world.policy, world, world.fixture_manifest, world, world, world)
            before, native = world.installed, generated.native_cut(world.root / 'native')
            selected = world.add(generated.artifact('0.2.0', 2))
            approved = []

            def authorize(command, raw):
                approved.append((command, raw))
                return True  # Generated maintenance owner only; no native Editor owner.

            owner = MaintenanceOwner(controller, authorize=authorize)
            status_request = json.dumps({'format': 'houseatlas.updater.status-request.v1', 'operationId': None}).encode()
            requests = [('check', generated.packet('check', selected, before, 1)),
                        ('apply', generated.packet('apply', selected, before, 2)),
                        ('status', status_request)]
            messages = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': bridge.PROTOCOLS[0]}},
                {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
                *[{'jsonrpc': '2.0', 'id': 3 + at, 'method': 'tools/call', 'params': {
                    'name': 'houseatlas_update_' + command, 'arguments': {'requestJson': raw.decode()}}}
                  for at, (command, raw) in enumerate(requests)],
            ]
            output = io.BytesIO()
            # object() deliberately has no native login/read/write methods.
            bridge.serve(object(), io.BytesIO(b''.join((json.dumps(row) + '\n').encode() for row in messages)),
                         output, maintenance=owner)
            replies = [json.loads(line) for line in output.getvalue().splitlines()]
            catalog = replies[1]['result']['tools']
            self.assertEqual([row['name'] for row in catalog],
                             [row['name'] for row in bridge.TOOLS] + [row['name'] for row in owner.catalog()])
            self.assertEqual(len(bridge.Stdio(object()).maintenance_tools), 0,
                             'Existing bridge config/main installs no maintenance capability')
            results = [json.loads(reply['result']['content'][0]['text']) for reply in replies[2:]]
            self.assertEqual([value['status']['phase'] for value in results], ['checked', 'succeeded', 'succeeded'])
            self.assertTrue(all(value['ok'] for value in results))
            self.assertTrue(all(not reply['result']['isError'] for reply in replies[2:]))
            self.assertTrue(results[1]['status']['healthVerified'])
            self.assertEqual(results[1]['status'], results[2]['status'])
            self.assertEqual(approved, requests)
            self.assertEqual(world.calls.count('stop'), 1)
            self.assertEqual(world.calls.count('publish'), 1)
            self.assertEqual(world.calls.count('start'), 1)
            self.assertEqual(world.calls.count('health'), 1)
            self.assertEqual(generated.native_cut(world.root / 'native'), native)
            self.assertTrue(before.binary.is_file())
            self.assertTrue(before.frontend.is_dir())
            self.assertNotIn(str(world.root), output.getvalue().decode())


if __name__ == '__main__':
    unittest.main()
