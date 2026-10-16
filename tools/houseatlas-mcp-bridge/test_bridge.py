"""Explicit synthetic cases only; no sockets, native data or external fallback."""
import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import struct
from unittest.mock import patch
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bridge', HERE / 'bridge.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'

SCOPE = {'workspaceId': uid(1), 'homeId': uid(2)}
BUILDING, EVIDENCE, ASSET = uid(3), uid(4), uid(5)


def request(op='atlas.identity.create', n=100):
    kind = op.split('.')[1]
    target = {'authority': 'atlas', 'recordType': kind, 'recordId': uid(n + 1000)}
    payload = {'classification': 'place', 'label': 'Synthetic only', 'evidenceIds': []}
    if op == 'atlas.asset.review':
        payload = {'treatment': 'download-only', 'rendererReceiptId': None, 'evidenceIds': []}
    return {'schemaVersion': 3, 'requestId': uid(n), 'commandId': op, 'context': dict(SCOPE),
            'target': target, 'payload': payload, 'idempotencyKey': uid(n + 2000),
            'reason': 'Generated synthetic transport check', 'approvalReceiptId': None,
            'preconditions': {'target': None if op.endswith('.create') else {'kind': 'atlas', 'value': 9007199254740991}, 'guards': []}}


class FakeOwner:
    origin = 'https://synthetic.invalid'
    def __init__(self):
        self.calls, self.posts = [], []
        self.cookie = 'synthetic-session-memory-only'
        self.lookup_result = None
        self.lookup_calls = []
        self.fail_post, self.change_head, self.wrong_scope = False, False, False
        self.scene_reads = 0
        self.fail_post_session = False
        self.malformed_commit = False
        self.original = b'Synthetic electrical/network documentary evidence only.\n'
        asset_payload = {'owner': 'atlas', 'purpose': 'evidence-original', 'availability': 'available',
                         'previewPolicy': 'download-only', 'contentType': 'text/plain',
                         'evidenceIds': [EVIDENCE], 'sourceLicense': {'status': 'unknown', 'reference': None},
                         'sha256': b.sha(self.original), 'byteSize': len(self.original)}
        self.records = {
            ('evidence', EVIDENCE): {'target': {'authority': 'atlas', 'recordType': 'evidence', 'recordId': EVIDENCE},
                                    'revision': 9007199254740991, 'lifecycle': 'active',
                                    'payload': {'references': [{'kind': 'atlas-asset', 'assetId': ASSET}]}},
            ('asset', ASSET): {'target': {'authority': 'atlas', 'recordType': 'asset', 'recordId': ASSET},
                              'revision': 9007199254740991, 'lifecycle': 'active', 'payload': asset_payload},
        }
        payload = {'buildingId': BUILDING, 'associationVersion': 1,
                   'sourceDocuments': [{'evidenceId': EVIDENCE, 'evidenceRevision': 9007199254740991,
                                        'originalAssetId': ASSET, 'originalAssetRevision': 9007199254740991,
                                        'originalSha256': b.sha(self.original)}], 'sourceFloors': [], 'roomMappings': []}
        self.current = {'status': 'available', 'association': {'recordId': uid(6), 'revision': 7,
                        'recordType': 'scene-association', 'workspaceId': SCOPE['workspaceId'],
                        'homeId': SCOPE['homeId'], 'lifecycle': 'active', 'payload': payload}}
        self.head = {'schema': 'houseatlas.native-scene-head.v1', 'scope': SCOPE, 'buildingId': BUILDING,
                     'status': 'available', 'reason': None, 'head': {'recordId': uid(6), 'revision': 7,
                     'payloadSha256': b.sha(b.scene_canonical(payload).encode())}}

    def login(self):
        self.cookie = 'synthetic-session-memory-only'

    def logout(self, csrf):
        self.cookie = None

    @staticmethod
    def receipt(req, operation=99):
        return {'schemaVersion': 3, 'commandId': req['commandId'], 'requestId': req['requestId'],
                'resolvedScope': SCOPE, 'status': 'committed', 'replayed': False,
                'operationId': uid(operation), 'data': {'requestDigest': b.intent_digest(req),
                'records': [{'target': req['target'], 'revision': 1}], 'auditIds': [uid(operation + 1)]}}

    def retained(self, req, children=()):
        wire = self.receipt(req)
        if children:
            wire['data']['records'] = [r for child in children for r in child['data']['records']]
            wire['data']['auditIds'] = [r for child in children for r in child['data']['auditIds']]
        return {'format': 'atlas-retained-reconciliation/1', 'lookupRequestId': req['requestId'],
                'inspection': {'format': 'atlas-retained-intent-inspection/1', 'resolvedScope': SCOPE,
                'coverage': 'retained-atlas-stock-only', 'outcome': 'retained-commit',
                'retrySafety': 'not-established', 'rootOperationId': uid(99), 'operationId': uid(99),
                'commandId': req['commandId'], 'requestDigest': b.intent_digest(req)},
                'committedResult': {'originalRequestId': req['requestId'], 'wire': wire, 'children': list(children),
                                    'originalMediaRelease': 'not-established', 'originalHttpDelivery': 'not-established'}}

    def exchange(self, method, path, body=None, csrf=None, limit=b.MAX_JSON):
        self.calls.append((method, path))
        if method == 'POST' and path == '/api/atlas/retained-intent':
            self.lookup_calls.append(body)
            result = self.lookup_result
            if result is None:
                req = b.strict_json(body)
                result = self.retained(req)
                result['inspection'].update(outcome='not-retained-at-snapshot', rootOperationId=None, operationId=None)
                result['committedResult'] = None
            return {'content-type': 'application/json'}, b.decimal_json(result).encode()
        if method == 'POST':
            self.posts.append((path, body, csrf))
            if self.fail_post:
                raise b.BridgeError('Synthetic transport failure')
            req = b.strict_json(body)
            result = {'schemaVersion': 3, 'commandId': req['commandId'], 'requestId': req['requestId'],
                      'resolvedScope': SCOPE, 'status': 'committed', 'replayed': False,
                      'operationId': uid(99), 'data': {'requestDigest': b.intent_digest(req),
                      'records': [{'target': req['target'], 'revision': 1}], 'auditIds': [uid(98)]}}
        elif path == '/api/atlas/auth/session':
            if self.fail_post_session and self.posts:
                raise b.BridgeError('Synthetic post-dispatch session failure')
            result = {'schemaVersion': 1, 'actorId': uid(9), 'csrfToken': 'synthetic-only-not-a-real-token',
                      'expiresAt': '2099-01-01T00:00:00Z'}
        elif path.endswith('/admission'):
            result = {'schemaVersion': 3, 'scope': SCOPE, 'commandIds': sorted(b.WRITES | {b.BATCH,
                      'atlas.evidence.get', 'atlas.asset.get', 'atlas.identity.get'}),
                      'nativeCommandIds': ['atlas.asset.create', 'atlas.scene-association.create']}
        elif '/invoke?' in path:
            req = b.strict_json(b.urllib.parse.parse_qs(path.split('?', 1)[1])['request'][0])
            target = req['target']
            row = self.records.get((target['recordType'], target['recordId']),
                                   {'target': target, 'revision': 1, 'lifecycle': 'active', 'payload': {'precise': b.Decimal('0.123456789123456789')}})
            result = {'schemaVersion': 3, 'commandId': req['commandId'], 'requestId': req['requestId'],
                      'resolvedScope': {'workspaceId': uid(50), 'homeId': uid(51)} if self.wrong_scope else SCOPE,
                      'status': 'read', 'replayed': False, 'data': {'sourceStatus': 'current', 'nextCursor': None, 'records': [row]}}
        elif path.endswith('/head'):
            result = copy.deepcopy(self.head)
            if self.change_head and self.scene_reads:
                result['head']['revision'] += 1
        elif path.endswith('/current'):
            self.scene_reads += 1
            result = self.current
        elif '/media/' in path:
            descriptor = b.compact({'assetId': ASSET, 'kind': 'atlas-asset'}).encode()
            assert path.endswith('/' + b.sha(descriptor) + '/download')
            return {'content-type': 'text/plain'}, self.original
        else:
            raise AssertionError('No external fallback; unexpected fake path ' + path)
        if method == 'POST' and self.malformed_commit:
            result['requestId'] = uid(777)
        raw = b.decimal_json(result).encode()
        assert len(raw) <= limit
        return {'content-type': 'application/json'}, raw


class Cases(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='houseatlas-mcp-synthetic-')
        os.chmod(self.tmp.name, 0o700)
        self.owner = FakeOwner()
        self.journal = b.Journal(self.tmp.name)
        self.bridge = b.Bridge(SCOPE, self.owner, self.journal)

    def tearDown(self):
        self.journal.close()
        self.tmp.cleanup()

    def healthy_stdio(self):
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'synthetic', 'version': '1'}}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'houseatlas_capabilities', 'arguments': {}}},
        ]
        out = io.BytesIO()
        b.serve(self.bridge, io.BytesIO(('\n'.join(b.compact(m) for m in messages) + '\n').encode()), out)
        values = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertEqual([x['id'] for x in values], [1, 2, 3])
        self.assertEqual(len(values[1]['result']['tools']), 6)
        cap = b.strict_json(values[2]['result']['content'][0]['text'])
        self.assertEqual(len(cap['admittedWriteForms']), 37)
        self.assertFalse(cap['genericAssetUpload'])
        self.assertEqual(self.owner.posts, [])

    def healthy_stdio_optional_arguments(self):
        session = b.Stdio(self.bridge)
        result = session.handle({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                 'params': {'protocolVersion': '2099-01-01'}})
        self.assertEqual(result['protocolVersion'], '2025-11-25')
        session.handle({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        result = session.handle({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                 'params': {'name': 'houseatlas_capabilities'}})
        self.assertFalse(result['isError'])
        result = session.handle({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                                 'params': {'name': 'houseatlas_operation_status', 'arguments': None}})
        self.assertFalse(result['isError'])
        self.assertEqual(self.owner.posts, [])

    def healthy_escaped_write_frame(self):
        req = request(); req['payload']['label'] = '\\"' * 200000
        raw = b.compact(req)
        self.assertLess(len(raw.encode()), b.MAX_JSON)
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'houseatlas_write', 'arguments': {'requestJson': raw}}},
        ]
        data = ('\n'.join(b.compact(m) for m in messages) + '\n').encode()
        self.assertGreater(len(data), 131072)
        self.assertLess(len(data), b.MAX_MESSAGE)
        out = io.BytesIO(); b.serve(self.bridge, io.BytesIO(data), out)
        results = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertFalse(results[-1]['result']['isError'])
        self.assertEqual(self.owner.posts[0][1], raw.encode())

    def denial_semantic_duplicate_targets(self):
        req = request(b.BATCH); req['preconditions']['target'] = None
        a, c = request('atlas.identity.create', 200), request('atlas.identity.replace', 300)
        c['target'] = dict(reversed(list(a['target'].items())))
        req['payload'] = {'commands': [a, c]}
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        self.assertEqual(self.owner.posts, [])
        self.assertFalse(self.bridge.status()['writeBlocked'])

    def healthy_empty_asset_backlinks(self):
        self.owner.records[('asset', ASSET)]['payload']['evidenceIds'] = []
        result = self.bridge.evidence(BUILDING, EVIDENCE, 0, 262144)
        self.assertTrue(result['directSceneSourceDocument'])
        self.assertTrue(result['revalidated'])
        self.assertEqual(b.base64.b64decode(result['content']), self.owner.original)
        self.assertEqual(self.owner.posts, [])

    def healthy_journal_binding_order(self):
        old = {'actorId': uid(9), 'scope': {'homeId': SCOPE['homeId'], 'workspaceId': SCOPE['workspaceId']},
               'origin': self.owner.origin}
        self.journal.db.execute('INSERT INTO binding VALUES (1,?)', (b.compact(old),))
        self.journal.db.commit()
        self.bridge.capabilities()
        self.journal.bind({'origin': self.owner.origin, 'scope': dict(reversed(list(SCOPE.items()))), 'actorId': uid(9)})
        with self.assertRaises(b.BridgeError):
            self.journal.bind({'origin': self.owner.origin, 'scope': SCOPE, 'actorId': uid(90)})

    def healthy_native_intent_digest(self):
        # RFC8785 Appendix B binary64/ECMAScript vectors; not runtime discovery.
        vectors = {
            '0000000000000000': '0', '8000000000000000': '0',
            '0000000000000001': '5e-324', '8000000000000001': '-5e-324',
            '7fefffffffffffff': '1.7976931348623157e+308',
            'ffefffffffffffff': '-1.7976931348623157e+308',
            '4340000000000000': '9007199254740992',
            '4430000000000000': '295147905179352830000',
            '44b52d02c7e14af5': '9.999999999999997e+22',
            '44b52d02c7e14af6': '1e+23', '44b52d02c7e14af7': '1.0000000000000001e+23',
            '444b1ae4d6e2ef4e': '999999999999999700000',
            '444b1ae4d6e2ef4f': '999999999999999900000',
            '444b1ae4d6e2ef50': '1e+21',
            '3eb0c6f7a0b5ed8c': '9.999999999999997e-7',
            '3eb0c6f7a0b5ed8d': '0.000001',
            '41b3de4355555553': '333333333.3333332',
            '41b3de4355555554': '333333333.33333325',
            '41b3de4355555555': '333333333.3333333',
            '41b3de4355555556': '333333333.3333334',
            '41b3de4355555557': '333333333.33333343',
            'becbf647612f3696': '-0.0000033333333333333333',
            '43143ff3c1cb0959': '1424953923781206.2',
        }
        for bits, expected in vectors.items():
            self.assertEqual(b.ecma_number(struct.unpack('>d', bytes.fromhex(bits))[0]), expected)
        value = b.strict_json('{"\\uE000":1.0,"\\ud83d\\ude00":-0.0,"x":[1e-7,0.000001,1e20,1e21,333333333.33333329]}')
        self.assertEqual(b.intent_canonical(value), '{"x":[1e-7,0.000001,100000000000000000000,1e+21,333333333.3333333],"😀":0,"\ue000":1}')
        root = request(b.BATCH); root['payload'] = {'commands': [request(n=200), request(n=300)]}
        original = b.intent_digest(root)
        root['requestId'], root['approvalReceiptId'] = uid(800), uid(801)
        self.assertEqual(b.intent_digest(root), original)
        root['payload']['commands'][0]['requestId'] = uid(802)
        self.assertNotEqual(b.intent_digest(root), original)
        self.assertEqual(b.intent_canonical(b.strict_json('[0.123456789123456789,1.0,-0.0]')),
                         '[0.12345678912345678,1,0]')

    def failure_intent_digest_correlation(self):
        original_exchange = self.owner.exchange
        def exchange(method, path, *args, **kwargs):
            headers, body = original_exchange(method, path, *args, **kwargs)
            if method == 'POST' and path.endswith('/commands'):
                result = b.strict_json(body); result['data']['requestDigest'] = '0' * 64
                return headers, b.decimal_json(result).encode()
            return headers, body
        self.owner.exchange = exchange
        req = request()
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.owner.lookup_result = self.owner.retained(req)
        self.owner.lookup_result['inspection']['requestDigest'] = '0' * 64
        self.owner.lookup_result['committedResult']['wire']['data']['requestDigest'] = '0' * 64
        with self.assertRaises(b.BridgeError): self.bridge.reconcile_operation(req['requestId'])
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(len(self.owner.posts), 1)

    def failure_evidence_reference_and_pins(self):
        self.owner.records[('asset', ASSET)]['payload']['evidenceIds'] = []
        evidence = self.owner.records[('evidence', EVIDENCE)]
        refs = evidence['payload']['references']
        evidence['payload']['references'] = []
        with self.assertRaises(b.BridgeError): self.bridge.evidence(BUILDING, EVIDENCE, 0, 20)
        evidence['payload']['references'] = refs
        payload = self.owner.current['association']['payload']
        payload['sourceDocuments'][0]['originalAssetRevision'] -= 1
        self.owner.head['head']['payloadSha256'] = b.sha(b.scene_canonical(payload).encode())
        with self.assertRaises(b.BridgeError): self.bridge.evidence(BUILDING, EVIDENCE, 0, 20)
        self.assertEqual(self.owner.posts, [])

    def failure_bridge_sigquit_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='houseatlas-signal-synthetic-') as temp:
            root = Path(temp); root.chmod(0o700)
            config = root / 'bridge.json'
            config.write_text(b.compact({'origin': self.owner.origin, 'scope': SCOPE})); config.chmod(0o600)
            handlers, logouts = {}, []
            original_signal = b.signal.signal
            previous = b.signal.getsignal(b.signal.SIGQUIT)
            def register(number, handler):
                if callable(handler): handlers[number] = handler
                return original_signal(number, handler)
            def interrupted(bridge, source, destination):
                self.assertIn(b.signal.SIGQUIT, handlers)
                bridge.prepare_session()
                handlers[b.signal.SIGQUIT](b.signal.SIGQUIT, None)
            def logout(csrf): logouts.append(csrf); self.owner.cookie = None
            with patch.object(b.sys, 'argv', ['bridge', '--config', str(config), '--state-dir', str(root)]), \
                 patch.object(b, 'HTTPSOwner', return_value=self.owner), patch.object(b, 'serve', interrupted), \
                 patch.object(b.signal, 'signal', register), patch.object(self.owner, 'logout', logout):
                with self.assertRaises(KeyboardInterrupt): b.main()
            self.assertEqual(logouts, ['synthetic-only-not-a-real-token'])
            self.assertIsNone(self.owner.cookie)
            self.assertEqual(b.signal.getsignal(b.signal.SIGQUIT), previous)

    def healthy_write_forms(self):
        self.assertEqual(len(b.WRITES), 37)
        for n, op in enumerate(sorted(b.WRITES - {'atlas.binding.remap'}), 100):
            raw = b.compact(request(op, n))
            result = b.strict_json(self.bridge.write(raw))
            self.assertEqual(result['status'], 'committed')
            self.assertEqual(self.owner.posts[-1][1], raw.encode())
            self.assertEqual(self.owner.posts[-1][2], 'synthetic-only-not-a-real-token')
        self.assertEqual(len(self.owner.posts), 36)
        self.assertEqual(self.journal.pending(), [])

    def healthy_batch(self):
        root = request(b.BATCH)
        root['target'] = {'authority': 'atlas', 'batchId': uid(80)}
        root['preconditions']['target'] = None
        root['payload'] = {'commands': [request('atlas.identity.create', 200), request('atlas.circuit.create', 300)]}
        raw = b.compact(root)
        self.bridge.write(raw)
        self.assertEqual(len(self.owner.posts), 1)
        self.assertEqual(self.owner.posts[0][1], raw.encode())

    def healthy_lossless_read(self):
        req = request('atlas.identity.get')
        for key in ('idempotencyKey', 'reason', 'preconditions', 'approvalReceiptId'):
            req.pop(key)
        req['payload'] = {}
        raw = b.compact(req)
        result = self.bridge.read(raw)
        self.assertIn('0.123456789123456789', result)
        self.assertEqual(self.owner.posts, [])

    def healthy_scene_original(self):
        frame = self.bridge.scene(BUILDING)
        self.assertTrue(frame['revalidated'])
        result = self.bridge.evidence(BUILDING, EVIDENCE, 0, 20)
        self.assertEqual(result['sha256'], b.sha(self.owner.original))
        self.assertEqual(result['evidenceRevision'], 9007199254740991)
        self.assertEqual(result['assetRevision'], 9007199254740991)
        self.assertEqual(result['nextOffset'], 20)
        self.assertTrue(result['directSceneSourceDocument'])
        self.assertEqual(b.base64.b64decode(result['content']), self.owner.original[:20])
        self.assertEqual(self.owner.posts, [])

    def denial_scope_and_routes(self):
        req = request(); req['context'] = {'workspaceId': uid(88), 'homeId': uid(89)}
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        for op in ('atlas.asset.create', 'atlas.scene-association.create', 'homebox.entity.create'):
            req = request(op)
            with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        self.assertEqual(self.owner.posts, [])

    def denial_confirmation_and_batch(self):
        for req in (request('atlas.binding.remap'),):
            req['approvalReceiptId'] = uid(999)
            with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        req = request(b.BATCH); req['preconditions']['target'] = None
        req['payload'] = {'commands': [request('atlas.scene-association.create', 700)]}
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        self.assertEqual(self.owner.posts, [])

    def denial_duplicate_json(self):
        with self.assertRaises(b.BridgeError): self.bridge.write('{"schemaVersion":3,"schemaVersion":3}')
        with self.assertRaises(b.BridgeError): b.strict_json('{"a":NaN}')
        self.assertEqual(self.owner.posts, [])

    def denial_read_correlation(self):
        self.owner.wrong_scope = True
        req = request('atlas.identity.get')
        with self.assertRaises(b.BridgeError): self.bridge.read(b.compact(req))
        self.assertEqual(self.owner.posts, [])

    def failure_unknown_persistence(self):
        self.owner.fail_post = True
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request()))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.journal.close()
        self.journal = b.Journal(self.tmp.name)
        self.bridge = b.Bridge(SCOPE, self.owner, self.journal)
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request(n=400)))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertEqual(len(self.journal.pending()), 1)

    def healthy_retained_reconciliation(self):
        req = request(); raw = b.compact(req)
        self.journal.begin(req, raw)
        self.owner.lookup_result = self.owner.retained(req)
        result = self.bridge.reconcile_operation(req['requestId'])
        self.assertEqual(result['state'], 'committed-reconciled')
        self.assertFalse(result['status']['writeBlocked'])
        self.assertEqual(result['originalHttpDelivery'], 'not-established')
        self.assertEqual(self.owner.lookup_calls, [raw.encode()])
        self.assertEqual(self.owner.posts, [])

    def healthy_retained_batch(self):
        req = request(b.BATCH); req['preconditions']['target'] = None
        req['target'] = {'authority': 'atlas', 'batchId': uid(80)}
        commands = [request('atlas.identity.create', 200), request('atlas.circuit.create', 300)]
        req['payload'] = {'commands': commands}
        raw = b.compact(req); self.journal.begin(req, raw)
        self.owner.lookup_result = self.owner.retained(req, [self.owner.receipt(c, 600 + n * 2) for n, c in enumerate(commands)])
        result = self.bridge.reconcile_operation(req['requestId'])
        self.assertEqual(result['state'], 'committed-reconciled')
        self.assertEqual(self.owner.posts, [])

    def failure_reconcile_absence(self):
        req = request(); self.journal.begin(req, b.compact(req))
        result = self.bridge.reconcile_operation(req['requestId'])
        self.assertEqual(result['state'], 'unknown')
        self.assertTrue(result['status']['writeBlocked'])
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request(n=900)))
        self.assertEqual(self.owner.posts, [])

    def failure_reconcile_correlation(self):
        req = request(); self.journal.begin(req, b.compact(req))
        self.owner.lookup_result = self.owner.retained(req)
        self.owner.lookup_result['committedResult']['originalRequestId'] = uid(999)
        with self.assertRaises(b.BridgeError): self.bridge.reconcile_operation(req['requestId'])
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(self.owner.posts, [])

    def denial_reconcile_byte_bound(self):
        req = request(); raw = ' ' * 17000 + b.compact(req)
        self.journal.begin(req, raw)
        with self.assertRaises(b.BridgeError): self.bridge.reconcile_operation(req['requestId'])
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(self.owner.lookup_calls, [])
        self.assertEqual(self.journal.operation(req['requestId'])[1], raw)

    def healthy_memory_session(self):
        owner = b.HTTPSOwner('https://synthetic.invalid')
        calls = []
        token = 'SYNTHETIC-COOKIE-NOT-A-CREDENTIAL'
        def exchange(method, path, body=None, csrf=None, **kwargs):
            calls.append((method, path, body, csrf))
            if path.endswith('/mode'):
                return {'content-type': 'application/json'}, b'{"schemaVersion":1,"mode":"trusted-proxy"}'
            if path.endswith('/proxy'):
                return {'content-type': 'application/json', 'set-cookie': '__Host-houseatlas-session=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600'}, \
                       b.compact({'schemaVersion': 1, 'actorId': uid(9), 'csrfToken': 'synthetic-csrf', 'expiresAt': '2099-01-01T00:00:00Z'}).encode()
            return {'content-type': 'application/json'}, b'{"schemaVersion":1,"signedOut":true}'
        owner.exchange = exchange
        owner.login()
        self.assertEqual(owner.cookie, '__Host-houseatlas-session=' + token)
        owner.login()  # Healthy native gateway reissuance, not an expiry/revocation control.
        owner.logout('synthetic-csrf')
        self.assertIsNone(owner.cookie)
        self.assertEqual([p for _,p,_,_ in calls], ['/api/atlas/auth/mode', '/api/atlas/auth/proxy',
                         '/api/atlas/auth/mode', '/api/atlas/auth/proxy', '/api/atlas/auth/logout'])

    def failure_session_after_login_cleanup(self):
        owner = b.HTTPSOwner('https://synthetic.invalid')
        self.bridge.owner = owner
        self.bridge.csrf = 'synthetic-old-csrf'
        calls = []
        def exchange(method, path, body=None, csrf=None, **kwargs):
            calls.append((path, csrf))
            if path.endswith('/mode'):
                return {'content-type': 'application/json'}, b'{"schemaVersion":1,"mode":"trusted-proxy"}'
            if path.endswith('/proxy'):
                return {'content-type': 'application/json', 'set-cookie': '__Host-houseatlas-session=SYNTHETIC-NEW-COOKIE-ONLY; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600'}, \
                       b.compact({'schemaVersion': 1, 'actorId': uid(9), 'csrfToken': 'synthetic-new-csrf', 'expiresAt': '2099-01-01T00:00:00Z'}).encode()
            if path.endswith('/session'):
                raise b.BridgeError('Synthetic session read failure after successful issuance')
            return {'content-type': 'application/json'}, b'{"schemaVersion":1,"signedOut":true}'
        owner.exchange = exchange
        with self.assertRaises(b.BridgeError): self.bridge.prepare_session()
        self.bridge.close_session()
        self.assertEqual(calls[-1], ('/api/atlas/auth/logout', 'synthetic-new-csrf'))
        self.assertIsNone(owner.cookie)
        self.assertIsNone(owner.csrf)
        self.assertEqual(self.owner.posts, [])

    def failure_post_dispatch_session(self):
        self.owner.fail_post_session = True
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request()))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertTrue(self.bridge.status()['writeBlocked'])

    def failure_commit_correlation(self):
        self.owner.malformed_commit = True
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request()))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertTrue(self.bridge.status()['writeBlocked'])

    def failure_unknown_keeps_reads(self):
        self.owner.fail_post = True
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request()))
        read = request('atlas.identity.get', 850)
        result = b.strict_json(self.bridge.read(b.compact(read)))
        self.assertEqual(result['status'], 'read')
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(len(self.owner.posts), 1)

    def failure_scene_change(self):
        self.owner.change_head = True
        with self.assertRaises(b.BridgeError): self.bridge.evidence(BUILDING, EVIDENCE, 0, 20)
        self.assertEqual(self.owner.posts, [])

    def failure_original_hash(self):
        self.owner.original += b' synthetic injected mismatch'
        with self.assertRaises(b.BridgeError): self.bridge.evidence(BUILDING, EVIDENCE, 0, 20)
        self.assertEqual(self.owner.posts, [])


HEALTHY = ('healthy_stdio', 'healthy_write_forms', 'healthy_batch', 'healthy_lossless_read', 'healthy_scene_original', 'healthy_retained_reconciliation',
           'healthy_retained_batch', 'healthy_memory_session', 'healthy_stdio_optional_arguments',
           'healthy_escaped_write_frame', 'healthy_empty_asset_backlinks', 'healthy_native_intent_digest')
REGRESSION = ('denial_scope_and_routes', 'denial_confirmation_and_batch', 'denial_duplicate_json',
              'denial_read_correlation', 'failure_unknown_persistence', 'failure_scene_change', 'failure_original_hash', 'failure_post_dispatch_session',
              'failure_commit_correlation', 'failure_unknown_keeps_reads', 'failure_reconcile_absence',
              'failure_reconcile_correlation', 'denial_reconcile_byte_bound', 'failure_session_after_login_cleanup', 'denial_semantic_duplicate_targets', 'failure_intent_digest_correlation', 'failure_evidence_reference_and_pins', 'failure_bridge_sigquit_cleanup', 'healthy_journal_binding_order')
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', choices=HEALTHY + REGRESSION)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([Cases(args.case)]))
    raise SystemExit(0 if result.wasSuccessful() else 1)
