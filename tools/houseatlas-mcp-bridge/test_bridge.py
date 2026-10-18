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
            'preconditions': {'target': None if op.endswith('.create') else {'kind': 'atlas', 'value': 9007199254740990}, 'guards': []}}


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
        expected = b.committed_record_expectations(req)
        return {'schemaVersion': 3, 'commandId': req['commandId'], 'requestId': req['requestId'],
                'resolvedScope': SCOPE, 'status': 'committed', 'replayed': False,
                'operationId': uid(operation), 'data': {'requestDigest': b.intent_digest(req),
                'records': [{'target': target, 'revision': revision, 'lifecycle': lifecycle, 'payload': {}}
                            for target, revision, lifecycle in expected],
                'auditIds': [uid(operation + i + 1) for i in range(len(expected))]}}

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
            result = self.receipt(req)
        elif path == '/api/atlas/auth/session':
            if self.fail_post_session and self.posts:
                raise b.BridgeError('Synthetic post-dispatch session failure')
            result = {'schemaVersion': 1, 'actorId': uid(9), 'csrfToken': 'synthetic-only-not-a-real-token',
                      'expiresAt': '2099-01-01T00:00:00Z'}
        elif path.endswith('/admission'):
            result = {'schemaVersion': 3, 'scope': SCOPE, 'commandIds': sorted(b.WRITES | {b.BATCH,
                      'atlas.evidence.get', 'atlas.asset.get', 'atlas.identity.get',
                      'atlas.geometry.list', 'atlas.identity.list'}),
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

    def healthy_integral_revisions(self):
        self.assertEqual(b.decimal_json(b.strict_json('{"revision":10e-1}')), '{"revision":10e-1}')
        original = self.owner.exchange
        def exchange(method, path, *args, **kwargs):
            headers, body = original(method, path, *args, **kwargs)
            if method == 'POST' and path.endswith('/commands'):
                result = b.strict_json(body)
                for record in result['data']['records']:
                    record['revision'] = b.Decimal(str(record['revision']) + '.0')
                body = b.decimal_json(result).encode()
            return headers, body
        self.owner.exchange = exchange
        for index, (token, expected) in enumerate((('1.0', 2), ('1e0', 2), ('10e-1', 2),
                                                  ('9007199254740990.0', 9007199254740991))):
            req = request('atlas.identity.replace', 1200 + index)
            raw = b.compact(req).replace('9007199254740990', token)
            result = b.strict_json(self.bridge.write(raw), b.MAX_COMMIT)
            self.assertEqual(result['data']['records'][0]['revision'], expected)
            self.assertEqual(self.owner.posts[-1][1], raw.encode())
            retained = self.journal.operation(req['requestId'])
            self.assertEqual(retained[1], raw)
            self.assertEqual(retained[3], 'committed')
        # Ordered batch children use the same exact CAS semantics and bytes.
        req = request(b.BATCH, 1300); req['preconditions']['target'] = None
        req['target'] = {'authority': 'atlas', 'batchId': uid(1301)}
        req['payload'] = {'commands': [request('atlas.identity.replace', 1400),
                                      request('atlas.circuit.restore', 1500)]}
        raw = b.compact(req).replace('9007199254740990', '1e0')
        result = b.strict_json(self.bridge.write(raw), b.MAX_COMMIT)
        self.assertEqual([r['revision'] for r in result['data']['records']], [2, 2])
        self.assertEqual(self.owner.posts[-1][1], raw.encode())

    def denial_integral_revision_bounds(self):
        tokens = ('1.01', '9007199254740990.999999999999999', '9007199254740991',
                  '9007199254740992', 'true', '-0.0', '1e-4096', '0e4097', '"1"')
        for token in tokens:
            raw = b.compact(request('atlas.identity.replace')).replace('9007199254740990', token)
            with self.assertRaises(b.BridgeError): self.bridge.write(raw)
        self.assertEqual(self.owner.posts, [])
        self.assertEqual(self.journal.pending(), [])
        # Native lexical work bounds are checked before conversion, not rounded.
        valid = '1.' + '0' * 4094
        self.assertEqual(b.native_integer(b.strict_json(valid)), 1)
        for token in (valid + '0', '0e4097', '0.0e-4096'):
            with self.assertRaises(b.BridgeError): b.native_integer(b.strict_json(token))
        self.assertEqual(b.native_integer(b.strict_json('0e4096')), 0)

    def healthy_integral_read_carriers(self):
        for row in self.owner.records.values(): row['revision'] = b.Decimal('9007199254740991.0')
        self.owner.records[('asset', ASSET)]['payload']['byteSize'] = b.Decimal(str(len(self.owner.original)) + '.0')
        self.owner.head['head']['revision'] = b.Decimal('7.0')
        self.owner.current['association']['revision'] = b.Decimal('7e0')
        payload = self.owner.current['association']['payload']
        payload['associationVersion'] = b.Decimal('1.0')
        for doc in payload['sourceDocuments']:
            doc['evidenceRevision'] = doc['originalAssetRevision'] = b.Decimal('9007199254740991.0')
        self.owner.head['head']['payloadSha256'] = b.sha(b.scene_canonical(payload).encode())
        session = b.Stdio(self.bridge)
        session.handle({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                        'params': {'protocolVersion': '2025-11-25'}})
        session.handle({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        result = session.handle({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {
            'name': 'houseatlas_source_evidence', 'arguments': {'buildingId': BUILDING,
            'evidenceId': EVIDENCE, 'offset': b.Decimal('0.0'), 'count': b.Decimal('12e0')}}})
        self.assertFalse(result['isError'])
        value = b.strict_json(result['content'][0]['text'])
        self.assertEqual(value['bytesReturned'], 12)
        self.assertEqual(value['evidenceRevision'], 9007199254740991)
        self.assertTrue(value['revalidated'])
        self.assertEqual(self.owner.posts, [])

    def healthy_integral_page_size(self):
        req, body, limits = self.large_page_fixture()
        raw = b.compact(req).replace('"pageSize":1', '"pageSize":1e0')
        self.assertIn('"pageSize":1e0', raw)
        self.assertEqual(self.bridge.read(raw), body.decode())
        self.assertEqual(limits, [b.MAX_READ])
        self.assertEqual(self.owner.posts, [])

    def large_receipt_fixture(self, count=280, fill='x'):
        # Existing reviewed geometry shape; schema mappings have no maxItems.
        _, page, _ = self.large_page_fixture()
        payload = b.strict_json(page, b.MAX_READ)['data']['records'][0]['payload']
        payload['mappings'] = [{'producerRoomId': (str(n) + fill * 4096)[:4096],
                                'atlasId': uid(1000 + n), 'homeboxEntity': None,
                                'reviewStatus': 'accepted', 'evidenceIds': [EVIDENCE]}
                               for n in range(count)]
        req = request('atlas.geometry.tombstone', 1600)
        req['payload'] = {}; req['preconditions']['target']['value'] = 1
        receipt = self.owner.receipt(req)
        receipt['data']['records'][0]['payload'] = payload
        return req, receipt

    def receipt_transport(self, responses):
        # Run the real bounded HTTPS reader against an in-memory connection.
        # No HTTP socket, native request, credential or executable can escape.
        original = self.owner.exchange
        transport = b.HTTPSOwner(self.owner.origin)
        calls = []
        class Connection:
            def request(_self, method, path, body=None, headers=None):
                kind = 'retained' if path == '/api/atlas/retained-intent' else 'commands'
                _self.raw = responses[kind]
                calls.append((kind, body))
            def getresponse(_self):
                raw = _self.raw
                return type('Response', (), {'status': 200,
                    'getheaders': lambda _: [('Content-Type', 'application/json'), ('Content-Length', str(len(raw)))],
                    'read1': io.BytesIO(raw).read1})()
            def close(_self): pass
        def exchange(method, path, body=None, csrf=None, limit=b.MAX_JSON):
            if method == 'POST' and (path.endswith('/commands') or path == '/api/atlas/retained-intent'):
                if path.endswith('/commands'): self.owner.posts.append((path, body, csrf))
                else: self.owner.lookup_calls.append(body)
                calls.append(('limit', limit))
                return transport.exchange(method, path, body, csrf, limit)
            return original(method, path, body, csrf, limit)
        self.owner.exchange = exchange
        return calls, patch.object(b.http.client, 'HTTPSConnection', return_value=Connection())

    def tool_stdio(self, name, arguments):
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'ping'}]
        source = io.BytesIO(('\n'.join(b.compact(m) for m in messages) + '\n').encode())
        output = io.BytesIO(); b.serve(self.bridge, source, output)
        lines = output.getvalue().splitlines()
        self.assertTrue(all(len(line) + 1 <= b.MAX_OUTPUT for line in lines))
        values = [b.strict_json(line, b.MAX_OUTPUT) for line in lines]
        self.assertEqual(values[-1]['result'], {})
        self.assertFalse(values[1]['result']['isError'])
        return values[1]['result']['content'][0]['text']

    def healthy_large_commit_receipt(self):
        req, receipt = self.large_receipt_fixture()
        raw, body = b.compact(req), b.decimal_json(receipt).encode()
        self.assertGreater(len(body), b.MAX_JSON); self.assertLess(len(body), b.MAX_COMMIT)
        calls, transport = self.receipt_transport({'commands': body})
        with transport:
            result = self.tool_stdio('houseatlas_write', {'requestJson': raw})
        self.assertEqual(result.encode(), body)
        retained = self.journal.operation(req['requestId'])
        self.assertEqual((retained[1], retained[3], retained[4]), (raw, 'committed', body.decode()))
        self.assertIn(('limit', b.MAX_COMMIT), calls)
        self.assertEqual(len(self.owner.posts), 1)

    def retained_receipt_fixture(self, count=280, fill='x'):
        child, receipt = self.large_receipt_fixture(count, fill)
        receipt['operationId'] = uid(600); receipt['data']['auditIds'] = [uid(601)]
        req = request(b.BATCH, 1700); req['preconditions']['target'] = None
        req['target'] = {'authority': 'atlas', 'batchId': uid(1701)}
        other = request('atlas.identity.create', 1800)
        req['payload'] = {'commands': [child, other]}
        result = self.owner.retained(req, [receipt, self.owner.receipt(other, 602)])
        raw, body = b.compact(req), b.decimal_json(result).encode()
        self.assertLess(len(raw), 16384)
        self.assertGreater(len(body), b.MAX_COMMIT); self.assertLess(len(body), b.MAX_RETAINED)
        self.journal.begin(req, raw)
        return req, raw, body

    def healthy_commit_response_boundary(self):
        req = request(); raw = b.compact(req)
        # Valid JSON response whitespace makes the transport byte border exact;
        # no claim that the native serializer adds this optional whitespace.
        body = b.decimal_json(self.owner.receipt(req)).encode().ljust(b.MAX_COMMIT, b' ')
        _, transport = self.receipt_transport({'commands': body})
        with transport:
            self.assertEqual(self.bridge.write(raw).encode(), body)
        self.assertEqual(self.journal.operation(req['requestId'])[4].encode(), body)

    def denial_receipt_parser_borders(self):
        # Pure JSON processing borders, not native domain/payload qualification.
        for nodes, limit, depth in ((b.MAX_NODES, b.MAX_COMMIT, 64),
                                     (b.MAX_RETAINED_NODES, b.MAX_RETAINED, 68)):
            raw = ('[' + ','.join('0' for _ in range(nodes - 1)) + ']').encode()
            self.assertLess(len(raw), limit)
            self.assertEqual(len(b.strict_json(raw, limit, nodes, depth)), nodes - 1)
            with self.assertRaises(b.BridgeError): b.strict_json(raw[:-1] + b',0]', limit, nodes, depth)
            exact = ('[' * depth + '0' + ']' * depth).encode()
            b.strict_json(exact, limit, nodes, depth)
            with self.assertRaises(b.BridgeError): b.strict_json(b'[' + exact + b']', limit, nodes, depth)
        self.assertEqual(self.owner.posts, [])

    def healthy_large_retained_receipt(self):
        req, raw, body = self.retained_receipt_fixture()
        calls, transport = self.receipt_transport({'retained': body})
        with transport:
            value = b.strict_json(self.tool_stdio('houseatlas_operation_status', {'requestId': req['requestId']}), b.MAX_OUTPUT)
        self.assertEqual(value['state'], 'committed-reconciled')
        self.assertEqual(value['nativeReconciliationJson'].encode(), body)
        self.assertEqual(self.journal.operation(req['requestId'])[4].encode(), body)
        self.assertIn(('limit', b.MAX_RETAINED), calls)
        self.assertEqual(self.owner.lookup_calls, [raw.encode()])
        self.assertEqual(self.owner.posts, [])

    def healthy_bounded_reconciliation_output(self):
        req, raw, body = self.retained_receipt_fixture(160, '\\')
        _, transport = self.receipt_transport({'retained': body})
        with transport:
            value = b.strict_json(self.tool_stdio('houseatlas_operation_status', {'requestId': req['requestId']}))
        self.assertEqual(value['state'], 'committed-reconciled')
        self.assertNotIn('nativeReconciliationJson', value)
        self.assertIn('MCP result budget', value['nativeReconciliationOmitted'])
        self.assertEqual(value['nativeReconciliationSha256'], b.sha(body))
        self.assertEqual(value['nativeReconciliationBytes'], len(body))
        self.assertEqual(self.journal.operation(req['requestId'])[4].encode(), body)
        self.assertFalse(value['status']['writeBlocked'])
        self.assertEqual(self.owner.posts, [])

    def denial_commit_receipt_profile(self):
        req, receipt = self.large_receipt_fixture(520)
        raw, body = b.compact(req), b.decimal_json(receipt).encode()
        self.assertGreater(len(body), b.MAX_COMMIT)
        retained = self.owner.retained(req); retained['committedResult']['wire'] = receipt
        reconciliation = b.decimal_json(retained).encode()
        self.assertLess(len(reconciliation), b.MAX_RETAINED)
        calls, transport = self.receipt_transport({'commands': body, 'retained': reconciliation})
        with transport:
            with self.assertRaises(b.BridgeError): self.bridge.write(raw)
            with self.assertRaises(b.BridgeError): self.bridge.reconcile_operation(req['requestId'])
            with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request(n=1900)))
        saved = self.journal.operation(req['requestId'])
        self.assertEqual((saved[1], saved[3], saved[4]), (raw, 'unknown', None))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertEqual(self.owner.lookup_calls, [raw.encode()])
        self.assertEqual([v for kind, v in calls if kind == 'limit'], [b.MAX_COMMIT, b.MAX_RETAINED])

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

    def failure_committed_record_correlation(self):
        # Exact malformed owner-return carriers, never native writes or controls.
        malformed = (
            [None],
            [{'target': {'authority': 'atlas', 'recordType': 'identity', 'recordId': uid(999)},
              'revision': 1, 'lifecycle': 'active', 'payload': {}}],
            [{'target': request()['target'], 'revision': 2, 'lifecycle': 'active', 'payload': {}}],
            [{'target': request()['target'], 'revision': 1, 'lifecycle': 'tombstoned', 'payload': {}}],
            [{'target': request()['target'], 'revision': 1, 'lifecycle': 'active', 'payload': None}],
        )
        for index, records in enumerate(malformed):
            with self.subTest(index=index), tempfile.TemporaryDirectory(prefix='houseatlas-record-receipt-') as temp:
                os.chmod(temp, 0o700)
                owner, journal = FakeOwner(), b.Journal(temp)
                bridge = b.Bridge(SCOPE, owner, journal)
                req = request()
                original = owner.exchange
                def exchange(method, path, *args, **kwargs):
                    headers, body = original(method, path, *args, **kwargs)
                    if method == 'POST' and path.endswith('/commands'):
                        result = b.strict_json(body); result['data']['records'] = records
                        return headers, b.decimal_json(result).encode()
                    return headers, body
                owner.exchange = exchange
                try:
                    with self.assertRaises(b.BridgeError): bridge.write(b.compact(req))
                    self.assertTrue(bridge.status()['writeBlocked'])
                    owner.lookup_result = owner.retained(req)
                    owner.lookup_result['committedResult']['wire']['data']['records'] = records
                    with self.assertRaises(b.BridgeError): bridge.reconcile_operation(req['requestId'])
                    self.assertTrue(bridge.status()['writeBlocked'])
                    self.assertEqual(len(owner.posts), 1)
                finally: journal.close()
        batch = request(b.BATCH); batch['payload'] = {'commands': [request(n=200), request(n=300)]}
        receipt = self.owner.receipt(batch)
        receipt['data']['records'].reverse()
        with self.assertRaises(b.BridgeError): self.bridge.commit_receipt(receipt, batch)
        receipt = self.owner.receipt(batch); receipt['data']['records'][1] = copy.deepcopy(receipt['data']['records'][0])
        with self.assertRaises(b.BridgeError): self.bridge.commit_receipt(receipt, batch)
        receipt = self.owner.receipt(batch); receipt['data']['auditIds'][1] = receipt['data']['auditIds'][0]
        with self.assertRaises(b.BridgeError): self.bridge.commit_receipt(receipt, batch)
        remap = request('atlas.binding.remap')
        remap['payload'] = {'oldBindingId': remap['target']['recordId'], 'newBindingId': uid(501), 'journalId': uid(502)}
        receipt = self.owner.receipt(remap)
        self.bridge.commit_receipt(receipt, remap)  # Pure3entry correlation, no approval/dispatch.
        self.assertEqual([r['target']['recordType'] for r in receipt['data']['records']],
                         ['binding', 'binding', 'reconciliation'])
        receipt['data']['records'][1]['revision'] = 2
        with self.assertRaises(b.BridgeError): self.bridge.commit_receipt(receipt, remap)
        self.assertEqual(self.owner.posts, [])

    def denial_decimal_exponent_frame(self):
        invalid = b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"n":1e9999999999999999999999999999999}}\n'
        healthy = b'{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n'
        out = io.BytesIO(); b.serve(self.bridge, io.BytesIO(invalid + healthy), out)
        results = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertEqual(results[0]['id'], None)
        self.assertEqual(results[0]['error']['code'], -32700)
        self.assertEqual(results[1]['id'], 2)
        self.assertIn('result', results[1])
        self.assertEqual(self.owner.posts, [])
        exchange = self.owner.exchange
        def malformed_native(method, path, *args, **kwargs):
            headers, body = exchange(method, path, *args, **kwargs)
            if method == 'POST' and path.endswith('/commands'):
                return headers, b'{"n":1e9999999999999999999999999999999}'
            return headers, body
        self.owner.exchange = malformed_native
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(request()))
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(len(self.owner.posts), 1)

    def denial_jsonrpc_frame_response(self):
        messages = [b'{bad}', b'[]', b'{"jsonrpc":"1.0","method":"ping"}',
                    b'{"jsonrpc":"2.0","id":[],"method":"ping"}',
                    b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}',
                    b'{"jsonrpc":"2.0","method":"notifications/initialized"}',
                    b'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":[]}}',
                    b'{"jsonrpc":"2.0","method":"notifications/unknown"}',
                    b'{"jsonrpc":"2.0","id":3,"method":"ping"}']
        out = io.BytesIO(); b.serve(self.bridge, io.BytesIO(b'\n'.join(messages)+b'\n'), out)
        results = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertEqual([r['id'] for r in results], [None,None,None,None,1,2,3])
        self.assertEqual([r['error']['code'] for r in results[:4]], [-32700,-32600,-32600,-32600])
        self.assertEqual(results[5]['error']['code'], -32602)
        self.assertEqual(results[-1]['result'], {})
        self.assertEqual(self.owner.posts, [])

    def notification_frames(self, messages):
        source = io.BytesIO(('\n'.join(b.compact(m) for m in messages) + '\n').encode())
        output = io.BytesIO(); b.serve(self.bridge, source, output)
        return [b.strict_json(line, b.MAX_OUTPUT) for line in output.getvalue().splitlines()]

    def diagnostic_frames(self, messages, diagnostics=None):
        class NoNative:
            def __getattr__(self, name):
                raise AssertionError('Diagnostic fixture invoked native/tool owner: ' + name)
        source = io.BytesIO(('\n'.join(b.compact(m) for m in messages) + '\n').encode())
        output = io.BytesIO()
        with patch('socket.socket', side_effect=AssertionError('Socket forbidden')), \
             patch('socket.create_connection', side_effect=AssertionError('Socket forbidden')):
            b.serve(NoNative(), source, output, diagnostics)
        return output.getvalue()

    def healthy_initialize_diagnostic_categories(self):
        valid = {'protocolVersion': '2025-11-25'}
        initialize = lambda n, params: {'jsonrpc': '2.0', 'id': n, 'method': 'initialize', 'params': params}
        ready = {'jsonrpc': '2.0', 'method': 'notifications/initialized'}
        cases = [
            ([], {}, 'protocol_version_required'),
            ([], None, 'params_object_required'),
            ([], {**valid, '_meta': None}, 'request_metadata_object_required'),
        ]
        for prefix, params, category in cases:
            with self.subTest(category=category):
                messages = [*prefix, {'jsonrpc': '2.0', 'id': 2, 'method': 'server/discover'},
                            initialize(3, params), initialize(4, params)]
                if not prefix:
                    messages += [initialize(5, valid), ready]
                messages += [{'jsonrpc': '2.0', 'id': 6, 'method': 'ping'},
                             {'jsonrpc': '2.0', 'id': 7, 'method': 'tools/list'}]
                baseline = self.diagnostic_frames(messages)
                stderr = io.StringIO()
                actual = self.diagnostic_frames(messages, b.InitializeDiagnostics(stderr))
                self.assertEqual(actual, baseline)
                self.assertEqual([json.loads(line) for line in stderr.getvalue().splitlines()],
                                 [{'ordinal': 1, 'category': category}, {'ordinal': 2, 'category': category}])
                self.assertLessEqual(len(stderr.getvalue().encode()), 160)
                self.assertEqual(len(json.loads(actual.splitlines()[-1])['result']['tools']), 6)
        # Historical category remains an allowlisted classifier value; valid
        # repeated initialization no longer produces this rejection.
        legacy = io.StringIO()
        b.InitializeDiagnostics(legacy).rejection(b.BridgeError('Already initialized'))
        self.assertEqual(legacy.getvalue(), '{"ordinal":1,"category":"already_initialized"}\n')

    def healthy_repeated_initialize_stdio(self):
        initialize = lambda n, version: {'jsonrpc': '2.0', 'id': n, 'method': 'initialize',
                                        'params': {'protocolVersion': version}}
        ready = {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {'_meta': {}}}
        messages = [initialize(1, '2025-11-25'), ready,
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'server/discover'},
                    initialize(3, '2024-11-05'),
                    {'jsonrpc': '2.0', 'id': 40, 'method': 'tools/call',
                     'params': {'name': 'houseatlas_write', 'arguments': {'requestJson': 'generated-never-dispatched'}}},
                    {'jsonrpc': '2.0', 'id': 41, 'method': 'ping'},
                    {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/list'}, ready,
                    {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/list'},
                    initialize(6, 'generated-unsupported-version'),
                    {'jsonrpc': '2.0', 'id': 7, 'method': 'tools/list'}, ready,
                    {'jsonrpc': '2.0', 'id': 8, 'method': 'tools/list'},
                    {'jsonrpc': '2.0', 'id': 9, 'method': 'ping'}]
        stderr = io.StringIO()
        actual = self.diagnostic_frames(messages, b.InitializeDiagnostics(stderr))
        self.assertEqual(actual, self.diagnostic_frames(messages))
        results = [json.loads(line) for line in actual.splitlines()]
        self.assertEqual([r['id'] for r in results], [1, 2, 3, 40, 41, 4, 5, 6, 7, 8, 9])
        by_id = {r['id']: r for r in results}
        self.assertEqual(by_id[2]['error']['code'], -32601)
        self.assertEqual(by_id[3]['result']['protocolVersion'], '2024-11-05')
        self.assertEqual(by_id[40]['error']['message'], 'Initialization notification required')
        self.assertEqual(by_id[41]['result'], {})
        self.assertEqual(by_id[4]['error']['message'], 'Initialization notification required')
        self.assertEqual(len(by_id[5]['result']['tools']), 6)
        self.assertEqual(by_id[6]['result']['protocolVersion'], b.PROTOCOLS[0])
        self.assertEqual(by_id[7]['error']['code'], -32602)
        self.assertEqual(len(by_id[8]['result']['tools']), 6)
        self.assertEqual(by_id[9]['result'], {})
        self.assertEqual(stderr.getvalue(), '')

    def denial_repeated_initialize_validation(self):
        initialize = lambda n, params: {'jsonrpc': '2.0', 'id': n, 'method': 'initialize', 'params': params}
        ready = {'jsonrpc': '2.0', 'method': 'notifications/initialized'}
        invalid = [(None, 'MCP params object required'), ([], 'MCP params object required'),
                   ({}, 'MCP protocol version required'),
                   ({'protocolVersion': None}, 'MCP protocol version required'),
                   ({'protocolVersion': 2025}, 'MCP protocol version required'),
                   ({'protocolVersion': '2025-11-25', '_meta': None}, 'MCP request metadata object required')]
        for ready_before in (False, True):
            for params, message in invalid:
                with self.subTest(ready=ready_before, message=message, params=params):
                    messages = [initialize(1, {'protocolVersion': '2025-11-25'}),
                            *([ready] if ready_before else []),
                            initialize(2, params),
                            {'jsonrpc': '2.0', 'method': 'initialize',
                             'params': {'protocolVersion': '2024-11-05'}},
                            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/list'}]
                    results = [json.loads(line) for line in self.diagnostic_frames(messages).splitlines()]
                    self.assertEqual([r['id'] for r in results], [1, 2, 3])
                    self.assertEqual(results[1]['error'], {'code': -32602, 'message': message})
                    if ready_before:
                        self.assertEqual(len(results[2]['result']['tools']), 6)
                    else:
                        self.assertEqual(results[2]['error']['message'], 'Initialization notification required')

    def healthy_repeated_initialize_state(self):
        retained = request(n=3100); raw = b.compact(retained)
        self.journal.begin(retained, raw)
        self.bridge.actor, self.bridge.csrf, self.bridge.session_expiry = uid(9000), 'synthetic-csrf', 9999999999
        self.owner.csrf = 'synthetic-owner-csrf'
        self.bridge.approval_owner = object()
        before = (self.journal.operation(retained['requestId']), dict(self.bridge.scope),
                  self.bridge.actor, self.bridge.csrf, self.bridge.session_expiry, self.owner.cookie,
                  self.owner.csrf, self.bridge.action_depth, self.bridge.owner, self.bridge.journal,
                  self.bridge.approval_owner)
        session = b.Stdio(self.bridge)
        def forbidden(*_args, **_kwargs): raise AssertionError('Handshake invoked native custody')
        with patch.multiple(self.bridge, prepare_session=forbidden, close_session=forbidden,
                            session=forbidden, capabilities=forbidden, read=forbidden, write=forbidden,
                            reconcile_operation=forbidden, scene=forbidden, evidence=forbidden), \
             patch.multiple(self.owner, login=forbidden, logout=forbidden, exchange=forbidden), \
             patch.multiple(self.journal, bind=forbidden, close=forbidden):
            for version in ('2025-11-25', '2025-11-25', '2024-11-05', 'generated-unsupported-version'):
                response = session.handle({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                       'params': {'protocolVersion': version, 'clientInfo': {'name': 'generated-only'}}})
                self.assertEqual(response['protocolVersion'], version if version in b.PROTOCOLS else b.PROTOCOLS[0])
                self.assertFalse(session.ready)
                session.handle({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
                self.assertTrue(session.ready)
                self.assertIs(session.bridge, self.bridge)
        after = (self.journal.operation(retained['requestId']), dict(self.bridge.scope),
                 self.bridge.actor, self.bridge.csrf, self.bridge.session_expiry, self.owner.cookie,
                 self.owner.csrf, self.bridge.action_depth, self.bridge.owner, self.bridge.journal,
                 self.bridge.approval_owner)
        self.assertEqual(after, before)
        self.assertTrue(self.bridge.status()['writeBlocked'])
        self.assertEqual(self.owner.calls, [])
        self.assertEqual(self.owner.posts, [])

    def denial_initialize_diagnostic_filter_and_bound(self):
        marker = 'SYNTHETIC-DO-NOT-LOG'
        message = lambda method, params: {'jsonrpc': '2.0', 'id': marker, 'method': method, 'params': params}
        messages = [message('server/discover', {'arbitrary': marker}),
                    message('ping', None),
                    {'jsonrpc': '2.0', 'method': 'initialize', 'params': None},
                    {**message('initialize', None), 'jsonrpc': 'invalid'},
                    message('initialize', {'protocolVersion': None, '_meta': {'arbitrary': marker}}),
                    message('initialize', {'protocolVersion': marker, '_meta': marker}),
                    *[message('initialize', None) for _ in range(8)]]
        stderr = io.StringIO(); diagnostic = b.InitializeDiagnostics(stderr)
        actual = self.diagnostic_frames(messages, diagnostic)
        self.assertEqual(actual, self.diagnostic_frames(messages))
        self.assertEqual(stderr.getvalue(),
                         '{"ordinal":1,"category":"protocol_version_required"}\n'
                         '{"ordinal":2,"category":"request_metadata_object_required"}\n')
        self.assertNotIn(marker, stderr.getvalue())
        self.assertNotIn('MCP ', stderr.getvalue())
        ignored = io.StringIO(); b.InitializeDiagnostics(ignored).rejection(b.BridgeError(marker))
        self.assertEqual(ignored.getvalue(), '')

    def denial_initialize_diagnostic_sink(self):
        messages = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'initialize', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'initialize',
                     'params': {'protocolVersion': '2025-11-25'}},
                    {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                    {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/list'}]
        baseline = self.diagnostic_frames(messages)
        for failing_operation in ('write', 'flush'):
            with self.subTest(failing_operation=failing_operation):
                class Sink:
                    attempts = 0
                    def write(self, _value):
                        self.attempts += 1
                        if failing_operation == 'write': raise OSError('SYNTHETIC-SINK-DETAIL-NEVER-LOG')
                    def flush(self):
                        raise ValueError('SYNTHETIC-CLOSED-SINK-DETAIL-NEVER-LOG')
                sink = Sink(); diagnostic = b.InitializeDiagnostics(sink)
                self.assertEqual(self.diagnostic_frames(messages, diagnostic), baseline)
                self.assertEqual(sink.attempts, 1)
                self.assertEqual(diagnostic.ordinal, diagnostic.LIMIT)

    def denial_initialize_diagnostic_final_response(self):
        large = {'jsonrpc': '2.0', 'id': '', 'method': 'initialize', 'params': {}}
        overhead = len((b.compact(large) + '\n').encode())
        large['id'] = 'Z' * (b.MAX_MESSAGE - overhead)
        self.assertEqual(len((b.compact(large) + '\n').encode()), b.MAX_MESSAGE)
        messages = [large,
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'initialize', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'initialize', 'params': None},
                    {'jsonrpc': '2.0', 'id': 4, 'method': 'initialize',
                     'params': {'protocolVersion': '2025-11-25'}},
                    {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                    {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/list'}]
        stderr = io.StringIO(); diagnostic = b.InitializeDiagnostics(stderr)
        actual = self.diagnostic_frames(messages, diagnostic)
        self.assertEqual(actual, self.diagnostic_frames(messages))
        results = [json.loads(line) for line in actual.splitlines()]
        self.assertEqual(results[0]['error']['code'], -32000)
        self.assertIsNone(results[0]['id'])
        self.assertEqual([r['error']['code'] for r in results[1:3]], [-32602, -32602])
        self.assertEqual(stderr.getvalue(),
                         '{"ordinal":1,"category":"protocol_version_required"}\n'
                         '{"ordinal":2,"category":"params_object_required"}\n')
        self.assertEqual(diagnostic.ordinal, 2)
        self.assertEqual(len(results[-1]['result']['tools']), 6)

    def healthy_initialize_diagnostic_config(self):
        config = {'origin': 'https://synthetic.invalid', 'scope': SCOPE}
        stderr = io.StringIO()
        self.assertIsNone(b.initialize_diagnostics(config, stderr))
        self.assertIsNone(b.initialize_diagnostics({**config, 'initializeDiagnostics': False}, stderr))
        self.assertIsInstance(b.initialize_diagnostics({**config, 'initializeDiagnostics': True}, stderr),
                              b.InitializeDiagnostics)
        messages = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}}]
        for settings in (config, {**config, 'initializeDiagnostics': False}):
            self.diagnostic_frames(messages, b.initialize_diagnostics(settings, stderr))
        self.assertEqual(stderr.getvalue(), '')
        for invalid in (None, 0, 1, 'true', [], {}):
            with self.assertRaises(b.BridgeError):
                b.initialize_diagnostics({**config, 'initializeDiagnostics': invalid}, stderr)

    def healthy_idless_notifications(self):
        initialize = {'jsonrpc': '2.0', 'method': 'initialize',
                      'params': {'protocolVersion': '2025-11-25'}}
        messages = [initialize, {'jsonrpc': '2.0', 'method': 'ping'},
                    {'jsonrpc': '2.0', 'method': 'extension/unsupported', 'params': {}},
                    {**initialize, 'id': 1},
                    {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                    {'jsonrpc': '2.0', 'method': 'ping'},
                    {'jsonrpc': '2.0', 'method': 'extension/unsupported', 'params': {}},
                    initialize,
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'ping'}]
        result = self.notification_frames(messages)
        self.assertEqual([r['id'] for r in result], [1, 2, 3])
        self.assertIn('serverInfo', result[0]['result'])
        self.assertEqual(len(result[1]['result']['tools']), 6)
        self.assertEqual(result[2]['result'], {})
        self.assertEqual(self.owner.calls, [])

    def denial_idless_initialized_guards(self):
        messages = [
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': []},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/list'}]
        result = self.notification_frames(messages)
        self.assertEqual([r['id'] for r in result], [1, 2, 3, 4])
        self.assertEqual(result[0]['error']['code'], -32602)
        self.assertIn('serverInfo', result[1]['result'])
        self.assertEqual(result[2]['error']['code'], -32602)
        self.assertEqual(len(result[3]['result']['tools']), 6)
        self.assertEqual(self.owner.calls, [])

    def denial_idless_tool_dispatch(self):
        retained = request(n=2100); raw = b.compact(retained)
        self.journal.begin(retained, raw)
        before = self.journal.operation(retained['requestId'])
        arguments = [
            ('houseatlas_capabilities', {}),
            ('houseatlas_read', {'requestJson': b.compact(request('atlas.identity.get', 2200))}),
            ('houseatlas_write', {'requestJson': b.compact(request(n=2300))}),
            ('houseatlas_operation_status', {}),
            ('houseatlas_operation_status', {'requestId': retained['requestId']}),
            ('houseatlas_scene', {'buildingId': BUILDING}),
            ('houseatlas_source_evidence', {'buildingId': BUILDING, 'evidenceId': EVIDENCE,
                                            'offset': 0, 'count': 12})]
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            *[{'jsonrpc': '2.0', 'method': 'tools/call', 'params': {'name': name, 'arguments': args}}
              for name, args in arguments],
            {'jsonrpc': '2.0', 'id': 2, 'method': 'ping'}]
        def forbidden(*_args, **_kwargs): raise AssertionError('Id-less tool/native dispatch')
        with patch.multiple(self.bridge, capabilities=forbidden, read=forbidden, write=forbidden,
                            status=forbidden, reconcile_operation=forbidden, scene=forbidden, evidence=forbidden):
            result = self.notification_frames(messages)
        self.assertEqual([r['id'] for r in result], [1, 2])
        self.assertEqual(result[-1]['result'], {})
        self.assertEqual(self.owner.calls, [])
        self.assertEqual(self.journal.operation(retained['requestId']), before)
        self.assertTrue(self.bridge.status()['writeBlocked'])

    def denial_native_reason_bound(self):
        # Stock4096 schema does not supersede frozen native Mutation1024.
        req = request(); req['reason'] = '界' * 1024
        raw = b.compact(req); self.bridge.write(raw)
        self.assertEqual(self.owner.posts[-1][1], raw.encode())
        req = request(n=900); req['reason'] = '界' * 1025
        with self.assertRaises(b.BridgeError): self.bridge.write(b.compact(req))
        self.assertEqual(len(self.owner.posts), 1)
        self.assertFalse(self.bridge.status()['writeBlocked'])

    def healthy_stdio_request_metadata(self):
        req = request(); raw = b.compact(req)
        metadata = {'progressToken': 'synthetic-progress', 'homeId': uid(999)}
        messages = [
            {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','_meta':metadata}},
            {'jsonrpc':'2.0','method':'notifications/initialized','params':{'_meta':metadata}},
            {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{'_meta':metadata}},
            {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'houseatlas_write','arguments':{'requestJson':raw},'_meta':metadata}},
        ]
        out = io.BytesIO(); b.serve(self.bridge, io.BytesIO(('\n'.join(b.compact(m) for m in messages)+'\n').encode()), out)
        results = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertFalse(results[-1]['result']['isError'])
        self.assertEqual(self.owner.posts[0][1], raw.encode())
        self.assertEqual(b.strict_json(self.owner.posts[0][1])['context'], SCOPE)

    def denial_rpc_method_codes(self):
        messages = [
            {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}},
            {'jsonrpc':'2.0','method':'notifications/initialized'},
            {'jsonrpc':'2.0','id':2,'method':'resources/list','params':{}},
            {'jsonrpc':'2.0','method':'notifications/unknown'},
            {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'houseatlas_operation_status','_meta':[]}},
            {'jsonrpc':'2.0','id':4,'method':'ping'},
        ]
        out = io.BytesIO(); b.serve(self.bridge, io.BytesIO(('\n'.join(b.compact(m) for m in messages)+'\n').encode()), out)
        results = [b.strict_json(line) for line in out.getvalue().splitlines()]
        self.assertEqual([r['id'] for r in results], [1,2,3,4])
        self.assertEqual(results[1]['error']['code'], -32601)
        self.assertEqual(results[2]['error']['code'], -32602)
        self.assertEqual(results[3]['result'], {})
        self.assertEqual(self.owner.posts, [])

    def failure_retained_child_operation_ids(self):
        req = request(b.BATCH); req['preconditions']['target'] = None
        req['target'] = {'authority':'atlas','batchId':uid(80)}
        children = [request(n=200),request(n=300)]; req['payload'] = {'commands':children}
        self.journal.begin(req,b.compact(req))
        valid = self.owner.retained(req,[self.owner.receipt(c,600+2*n) for n,c in enumerate(children)])
        for bad in (600,99):
            self.owner.lookup_result = copy.deepcopy(valid)
            self.owner.lookup_result['committedResult']['children'][1]['operationId'] = uid(bad)
            with self.assertRaises(b.BridgeError): self.bridge.reconcile_operation(req['requestId'])
            self.assertTrue(self.bridge.status()['writeBlocked'])
        self.owner.lookup_result = valid
        result = self.bridge.reconcile_operation(req['requestId'])
        self.assertEqual(result['state'],'committed-reconciled')
        self.assertEqual(self.owner.posts, [])

    def large_page_fixture(self):
        req = request('atlas.geometry.list')
        for key in ('idempotencyKey','reason','preconditions','approvalReceiptId'): req.pop(key)
        req['target'] = {'authority':'atlas','recordType':'geometry'}
        req['payload'] = {'cursor':None,'pageSize':1,'includeArchived':False}
        geometry = {'producer':'magicplan','producerVersion':'synthetic','exportFormat':'synthetic',
                    'originalAssetId':ASSET,'importedAt':'2026-01-01T00:00:00Z','coordinateUnits':'m',
                    'scale':None,'transform':None,'geometryVersion':1,'previousGeometryId':None,
                    'mappings':[{'producerRoomId':('R'+str(n)).ljust(4096,'x'),'atlasId':uid(1000+n),
                                 'homeboxEntity':None,'reviewStatus':'accepted','evidenceIds':[EVIDENCE]}
                                for n in range(280)],'evidenceIds':[EVIDENCE]}
        result = {'schemaVersion':3,'commandId':req['commandId'],'requestId':req['requestId'],
                  'resolvedScope':SCOPE,'status':'read','replayed':False,
                  'data':{'records':[{'target':{'authority':'atlas','recordType':'geometry','recordId':uid(500)},
                                     'revision':1,'lifecycle':'active','payload':geometry}],
                          'nextCursor':'opaque-synthetic-cursor','sourceStatus':'current'}}
        body = b.compact(result).encode()
        self.assertGreater(len(body),b.MAX_JSON); self.assertLess(len(body),b.MAX_READ)
        original = self.owner.exchange
        limits = []
        def exchange(method,path,*args,**kwargs):
            if '/invoke?' in path:
                limits.append(kwargs.get('limit')); return {'content-type':'application/json'},body
            return original(method,path,*args,**kwargs)
        self.owner.exchange = exchange
        return req,body,limits

    def healthy_large_read_page(self):
        req,body,limits = self.large_page_fixture(); raw = b.compact(req)
        self.assertEqual(self.bridge.read(raw),body.decode())
        self.assertEqual(limits,[b.MAX_READ])
        self.assertEqual(b.strict_json(body,b.MAX_READ)['data']['nextCursor'],'opaque-synthetic-cursor')
        self.assertEqual(self.owner.posts, [])

    def denial_read_profile_bounds(self):
        req = request('atlas.identity.list'); req['payload'] = {'cursor':None,'pageSize':9,'includeArchived':False}
        with self.assertRaises(b.BridgeError): self.bridge.read(b.compact(req))
        self.assertFalse(any('/invoke?' in path for _,path in self.owner.calls))
        original = self.owner.exchange
        def oversized(method,path,*args,**kwargs):
            if '/invoke?' in path:return {'content-type':'application/json'},b' '*(b.MAX_READ+1)
            return original(method,path,*args,**kwargs)
        self.owner.exchange = oversized
        with self.assertRaises(b.BridgeError): self.bridge.read(b.compact(request('atlas.identity.get')))
        self.owner.exchange = original
        self.assertEqual(b.strict_json(self.bridge.read(b.compact(request('atlas.identity.get'))))['status'],'read')
        self.assertFalse(self.bridge.status()['writeBlocked'])
        self.assertEqual(self.owner.posts, [])

    def denial_stdio_output_budget(self):
        req,body,_ = self.large_page_fixture()
        large_id = 'synthetic-' + 'x'*(7*1024*1024)
        messages = [
            {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}},
            {'jsonrpc':'2.0','method':'notifications/initialized'},
            {'jsonrpc':'2.0','id':large_id,'method':'tools/call','params':{'name':'houseatlas_read','arguments':{'requestJson':b.compact(req)}}},
            {'jsonrpc':'2.0','id':2,'method':'ping'},
        ]
        data = ('\n'.join(b.compact(m) for m in messages)+'\n').encode()
        out = io.BytesIO(); b.serve(self.bridge,io.BytesIO(data),out)
        lines = out.getvalue().splitlines()
        self.assertTrue(all(len(line)+1 <= b.MAX_OUTPUT for line in lines))
        results = [b.strict_json(line,b.MAX_OUTPUT) for line in lines]
        self.assertEqual(results[1]['id'],large_id)
        self.assertEqual(results[1]['error']['code'],-32000)
        self.assertEqual(results[-1]['result'],{})
        self.assertEqual(self.owner.posts, [])

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
           'healthy_escaped_write_frame', 'healthy_empty_asset_backlinks', 'healthy_native_intent_digest', 'healthy_stdio_request_metadata', 'healthy_large_read_page')
REGRESSION = ('denial_scope_and_routes', 'denial_confirmation_and_batch', 'denial_duplicate_json',
              'denial_read_correlation', 'failure_unknown_persistence', 'failure_scene_change', 'failure_original_hash', 'failure_post_dispatch_session',
              'failure_commit_correlation', 'failure_unknown_keeps_reads', 'failure_reconcile_absence',
              'failure_reconcile_correlation', 'denial_reconcile_byte_bound', 'failure_session_after_login_cleanup', 'denial_semantic_duplicate_targets', 'failure_intent_digest_correlation', 'failure_evidence_reference_and_pins', 'failure_bridge_sigquit_cleanup', 'healthy_journal_binding_order', 'failure_committed_record_correlation', 'denial_decimal_exponent_frame', 'denial_jsonrpc_frame_response', 'denial_native_reason_bound', 'denial_rpc_method_codes', 'failure_retained_child_operation_ids', 'denial_read_profile_bounds', 'denial_stdio_output_budget')
HEALTHY += ('healthy_integral_revisions', 'healthy_integral_read_carriers', 'healthy_integral_page_size',
            'healthy_large_commit_receipt', 'healthy_commit_response_boundary', 'healthy_large_retained_receipt',
            'healthy_bounded_reconciliation_output')
REGRESSION += ('denial_integral_revision_bounds', 'denial_commit_receipt_profile', 'denial_receipt_parser_borders')
HEALTHY += ('healthy_idless_notifications',)
HEALTHY += ('healthy_initialize_diagnostic_categories', 'healthy_initialize_diagnostic_config')
REGRESSION += ('denial_initialize_diagnostic_filter_and_bound', 'denial_initialize_diagnostic_sink')
REGRESSION += ('denial_initialize_diagnostic_final_response',)
HEALTHY += ('healthy_repeated_initialize_stdio', 'healthy_repeated_initialize_state')
REGRESSION += ('denial_repeated_initialize_validation',)
REGRESSION += ('denial_idless_initialized_guards', 'denial_idless_tool_dispatch')
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', choices=HEALTHY + REGRESSION)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([Cases(args.case)]))
    raise SystemExit(0 if result.wasSuccessful() else 1)
