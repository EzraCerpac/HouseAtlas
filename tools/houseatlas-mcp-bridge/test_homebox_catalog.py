"""Synthetic metadata/capabilities fixtures. No sockets, provider or native data."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('catalog_bridge', Path(__file__).with_name('bridge.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

def uid(n):
    return f'10000000-0000-4000-8000-{n:012d}'

SCOPE = {'workspaceId': uid(1), 'homeId': uid(2)}
CATALOG = {'schemaVersion': 1, 'scope': SCOPE, 'partitions': [
    {'owner': 'homebox', 'sourceInstanceId': uid(8), 'collectionId': 'Synthetic / α + %'}]}

class Owner:
    origin = 'https://catalog.synthetic.invalid'
    def __init__(self):
        self.cookie, self.csrf = 'synthetic-memory-session', 'synthetic-memory-csrf'
        self.calls, self.budgets = [], []
        self.value, self.status = copy.deepcopy(CATALOG), 200
        self.error = None
        self.change = None
        self.clock = None
        self.tick = 0
        self.login_calls = 0
        self.actor = uid(4)
        self.scope = dict(SCOPE)

    def login(self, budget=None):
        self.login_calls += 1
        assert budget is not None
        self.budgets.append(budget)
        self.cookie = 'synthetic-initial-session'
        if self.clock is not None:
            self.clock[0] += self.tick
        return self.actor

    def exchange(self, method, path, body=None, csrf=None, limit=b.MAX_JSON, *,
                 budget=None, metadata_status=False):
        assert method == 'GET' and body is None
        self.calls.append(path)
        if budget is not None:
            self.budgets.append(budget)
            budget.remaining()
        if self.clock is not None:
            self.clock[0] += self.tick
        headers = {'content-type': 'application/json'}
        if path == '/api/atlas/auth/session':
            value = {'schemaVersion': 1, 'actorId': self.actor, 'csrfToken': self.csrf,
                     'expiresAt': '2099-01-01T00:00:00Z'}
        elif path.endswith('/admission' + b.CATALOG_QUERY):
            if self.error:
                raise b.BridgeError('Synthetic uncertain transport')
            if self.status in (401, 429):
                raise b.BridgeError('Synthetic authentication refusal')
            value = self.value
            if self.change == 'cookie': self.cookie = 'synthetic-replaced-session'
            if self.change == 'actor': self.actor = uid(5)
            if self.change == 'scope': self.scope['homeId'] = uid(7)
            if self.change == 'csrf': self.csrf = 'synthetic-replaced-csrf'
        elif path.endswith('/admission'):
            value = {'schemaVersion': 3, 'scope': self.scope,
                     'commandIds': ['homebox.entity.list']}
        else:
            raise AssertionError('No fallback route')
        raw = value if isinstance(value, bytes) else b.compact(value).encode()
        return (headers, raw, self.status) if metadata_status else (headers, raw)

class CatalogCases(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='catalog-synthetic-')
        self.owner = Owner()
        self.journal = b.Journal(self.temporary.name)
        self.bridge = b.Bridge(SCOPE, self.owner, self.journal)

    def tearDown(self):
        self.journal.close()
        self.temporary.cleanup()

    def test_exact_opaque_catalog_and_one_budget(self):
        result = self.bridge.capabilities()
        self.assertEqual(result['homeboxCachedPartitions'], CATALOG)
        self.assertEqual(result['homeboxCachedPartitions']['partitions'][0]['collectionId'], 'Synthetic / α + %')
        self.assertEqual(len({id(value) for value in self.owner.budgets}), 1)
        self.assertIsNone(self.bridge.capabilities_budget)
        self.assertEqual(self.owner.login_calls, 0)
        self.assertEqual(sum(path.endswith(b.CATALOG_QUERY) for path in self.owner.calls), 1)

    def test_old_server_and_unavailable_are_ambiguous_without_fallback(self):
        for status in (403, 404, 405, 410, 501, 503):
            with self.subTest(status=status):
                self.owner.status = status
                self.owner.calls.clear()
                result = self.bridge.capabilities()
                self.assertEqual(result['homeboxCachedPartitions'],
                                 {'status': 'unavailable', 'reason': 'unsupported-or-unavailable'})
                self.assertEqual(sum(path.endswith(b.CATALOG_QUERY) for path in self.owner.calls), 1)
                self.assertTrue(all(path == '/api/atlas/auth/session' or '/admission' in path
                                    for path in self.owner.calls))
        self.assertEqual(self.owner.login_calls, 0)

    def test_authentication_and_uncertain_transport_fail_without_retry(self):
        for status, error in ((401, None), (429, None), (200, True)):
            with self.subTest(status=status, error=error):
                self.owner.status, self.owner.error = status, error
                self.owner.calls.clear()
                with self.assertRaises(b.BridgeError):
                    self.bridge.capabilities()
                self.assertEqual(sum(path.endswith(b.CATALOG_QUERY) for path in self.owner.calls), 1)
                self.assertEqual(self.owner.login_calls, 0)

    def test_changed_session_or_scope_never_releases_catalog(self):
        for change in ('cookie', 'actor', 'csrf', 'scope'):
            with self.subTest(change=change):
                self.owner = Owner()
                self.bridge = b.Bridge(SCOPE, self.owner, self.journal)
                self.owner.change = change
                with self.assertRaises(b.BridgeError):
                    self.bridge.capabilities()
                self.assertEqual(self.owner.login_calls, 0)
        self.owner = Owner()
        self.bridge = b.Bridge(SCOPE, self.owner, self.journal)
        self.owner.status, self.owner.change = 403, 'scope'
        with self.assertRaises(b.BridgeError):
            self.bridge.capabilities()

    def test_malformed_duplicate_and_oversize_success_fail(self):
        malformed = []
        for transform in (
            lambda v: v.update(extra='not allowed'),
            lambda v: v.update(schemaVersion=True),
            lambda v: v['scope'].update(homeId=uid(9)),
            lambda v: v['scope'].update(extra=1),
            lambda v: v['partitions'][0].update(owner='network'),
            lambda v: v['partitions'][0].update(sourceInstanceId=uid(8).replace('10000000', 'A0000000')),
            lambda v: v['partitions'][0].update(collectionId=''),
            lambda v: v['partitions'][0].update(collectionId='x' * 4097),
            lambda v: v['partitions'][0].update(endpoint='synthetic forbidden field'),
            lambda v: v['partitions'].append(copy.deepcopy(v['partitions'][0])),
            lambda v: v.update(partitions=[dict(v['partitions'][0], sourceInstanceId=uid(100 + n)) for n in range(9)]),
        ):
            value = copy.deepcopy(CATALOG)
            transform(value)
            malformed.append(value)
        malformed.extend((b'{"schemaVersion":1,"schemaVersion":1}', b'x' * (b.MAX_CATALOG + 1)))
        for value in malformed:
            with self.subTest(value_type=type(value).__name__):
                self.owner.value = value
                with self.assertRaises(b.BridgeError):
                    self.bridge.capabilities()

    def test_empty_catalog_is_valid_only_as_a_validated_success(self):
        self.owner.value['partitions'] = []
        self.assertEqual(self.bridge.capabilities()['homeboxCachedPartitions']['partitions'], [])

    def test_budget_includes_preparation_and_never_renews(self):
        clock = [0]
        self.owner.clock, self.owner.tick = clock, 11
        with patch.object(b.time, 'monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(b.BridgeError):
                self.bridge.capabilities()
        self.assertEqual(len({id(value) for value in self.owner.budgets}), 1)
        self.owner = Owner()
        self.bridge = b.Bridge(SCOPE, self.owner, self.journal)
        self.owner.cookie, self.owner.clock, self.owner.tick = None, clock, 61
        clock[0] = 0
        with patch.object(b.time, 'monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(b.BridgeError):
                self.bridge.capabilities()
        self.assertEqual(self.owner.login_calls, 1)
        self.assertEqual(self.owner.calls, [])

    def test_cumulative_input_and_final_output_are_bounded(self):
        with patch.object(b, 'MAX_CAPABILITIES_INPUT', 1024):
            self.owner.value['partitions'][0]['collectionId'] = 'x' * 800
            with self.assertRaises(b.BridgeError):
                self.bridge.capabilities()
        self.owner.value = copy.deepcopy(CATALOG)
        with patch.object(b, 'MAX_OUTPUT', 128):
            with self.assertRaises(b.BridgeError):
                self.bridge.capabilities()

    def test_other_admission_does_not_discover_or_use_capabilities_budget(self):
        self.bridge.admission()
        self.assertEqual(self.owner.budgets, [])
        self.assertFalse(any(path.endswith(b.CATALOG_QUERY) for path in self.owner.calls))

class SocketBudgetCases(unittest.TestCase):
    def test_socket_waits_use_remaining_capabilities_time(self):
        clock, waits = [0], []
        class Socket:
            def settimeout(self, value):
                waits.append((value, 60 - clock[0]))
        class Response:
            status = 200
            reads = 0
            def getheaders(self):
                return [('content-type', 'application/json'), ('content-length', '2')]
            def read1(self, _):
                self.reads += 1
                clock[0] += 1
                return b'{}' if self.reads == 1 else b''
        class Connection:
            sock = Socket()
            def __init__(self, *args, **kwargs):
                waits.append((kwargs['timeout'], 60 - clock[0]))
            def request(self, *args, **kwargs):
                clock[0] = 45
            def getresponse(self):
                clock[0] = 55
                return Response()
            def close(self): pass
        with patch.object(b.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(b.http.client, 'HTTPSConnection', Connection):
            budget = b.CapabilitiesBudget()
            owner = b.HTTPSOwner('https://catalog.synthetic.invalid')
            owner.exchange('GET', '/api/atlas/auth/session', budget=budget)
        self.assertTrue(waits)
        self.assertTrue(all(0 < timeout <= min(15, remaining) for timeout, remaining in waits))

if __name__ == '__main__':
    unittest.main()
