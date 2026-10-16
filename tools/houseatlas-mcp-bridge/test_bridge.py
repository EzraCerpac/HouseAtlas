"""Explicit synthetic cases only; no sockets, native data or external fallback."""
import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
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

    def exchange(self, method, path, body=None, csrf=None, limit=b.MAX_JSON):
        self.calls.append((method, path))
        if method == 'POST':
            self.posts.append((path, body, csrf))
            if self.fail_post:
                raise b.BridgeError('Synthetic transport failure')
            req = b.strict_json(body)
            result = {'schemaVersion': 3, 'commandId': req['commandId'], 'requestId': req['requestId'],
                      'resolvedScope': SCOPE, 'status': 'committed', 'replayed': False,
                      'operationId': uid(99), 'data': {'requestDigest': 'a' * 64,
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
        self.assertEqual(self.owner.calls, [])

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


HEALTHY = ('healthy_stdio', 'healthy_write_forms', 'healthy_batch', 'healthy_lossless_read', 'healthy_scene_original')
REGRESSION = ('denial_scope_and_routes', 'denial_confirmation_and_batch', 'denial_duplicate_json',
              'denial_read_correlation', 'failure_unknown_persistence', 'failure_scene_change', 'failure_original_hash', 'failure_post_dispatch_session',
              'failure_commit_correlation', 'failure_unknown_keeps_reads')
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', choices=HEALTHY + REGRESSION)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([Cases(args.case)]))
    raise SystemExit(0 if result.wasSuccessful() else 1)
