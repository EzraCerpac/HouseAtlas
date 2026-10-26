// Healthy generated checks for Settings → Backups: decoding the server's
// answer, the sentences the section shows, and the save exchange (session
// read for CSRF, then the POST). A generated server; no browser or network.
import assert from 'node:assert/strict';
import { chooseRetention, decodeBackupSettings, describeRetention, describeStatus, formatBytes, readSettings, saveRetention } from '../src/lantern/backups.ts';

assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');

const success = { finished: '2026-10-27T04:01:10+00:00', recoveryPoint: '2026-10-27T04:00:00+00:00', archiveBytes: 2_400_000, modelBytesStored: 0, offlineSeconds: 7 };

// Decoding: the choice must be exact; odd parts of the job's summary drop out.
{
  const view = decodeBackupSettings({ schemaVersion: 1, retention: { keep: 'recent', nights: 30, months: 12 },
    status: { lastSuccess: success, lastFailure: null, removed: { archives: 2, modelFiles: 1, bytes: 150_000_000 },
      stored: { archives: 42, bytes: 1_400_000_000 }, problem: null, laterField: 1 } });
  assert.deepEqual(view.retention, { keep: 'recent', nights: 30, months: 12 });
  assert.deepEqual(view.status.lastSuccess, { finished: success.finished, archiveBytes: 2_400_000 });
  assert.deepEqual(decodeBackupSettings({ schemaVersion: 1, retention: { keep: 'forever' }, status: null }),
    { retention: { keep: 'forever' }, status: null });
  const odd = decodeBackupSettings({ schemaVersion: 1, retention: { keep: 'forever' },
    status: { lastSuccess: { finished: 'yesterday' }, stored: { archives: -1, bytes: 0 }, problem: '' } });
  assert.deepEqual(odd.status, { lastSuccess: null, lastFailure: null, removed: null, stored: null, problem: null });
  for (const bad of [null, {}, { schemaVersion: 2, retention: { keep: 'forever' } }, { schemaVersion: 1, retention: { keep: 'never' } },
    { schemaVersion: 1, retention: { keep: 'recent', nights: 1.5, months: 0 } }])
    assert.throws(() => decodeBackupSettings(bad), TypeError, JSON.stringify(bad));
}

// What the section says.
{
  assert.equal(describeRetention({ keep: 'forever' }), 'Every nightly iCloud backup is kept.');
  assert.equal(describeRetention({ keep: 'recent', nights: 30, months: 12 }),
    'Keeps the last 30 nightly backups and the first one of each of the last 12 months. The next nightly backup deletes older ones from iCloud.');
  assert.equal(describeRetention({ keep: 'recent', nights: 7, months: 0 }),
    'Keeps the last 7 nightly backups. The next nightly backup deletes older ones from iCloud.');
  assert.deepEqual(describeStatus(null), ['No nightly backup has reported yet.']);
  const lines = describeStatus({ lastSuccess: { finished: success.finished, archiveBytes: 2_400_000 }, lastFailure: null,
    removed: { archives: 2, modelFiles: 1, bytes: 150_000_000 }, stored: { archives: 42, bytes: 1_400_000_000 }, problem: null });
  assert.deepEqual(lines, [
    'Last backup 27 Oct 2026, 04:01 UTC, 2.4 MB, checked by restoring the copy from iCloud.',
    'iCloud holds 42 backups, 1.4 GB in all. The last run deleted 2 older backups and 1 unused model file (150 MB).',
  ]);
  const failed = describeStatus({ lastSuccess: { finished: success.finished, archiveBytes: 1 },
    lastFailure: { at: '2026-10-28T04:02:00+00:00', step: 'iCloud upload' }, removed: null, stored: null, problem: 'Older backups were not cleaned up this time.' });
  assert.deepEqual(failed, [
    'The backup on 28 Oct 2026, 04:02 UTC stopped at “iCloud upload”. The newest good one is from 27 Oct 2026, 04:01 UTC.',
    'Older backups were not cleaned up this time.',
  ]);
  // A failure older than the last success is history, not news.
  assert.match(describeStatus({ lastSuccess: { finished: success.finished, archiveBytes: 1 },
    lastFailure: { at: '2026-10-26T04:02:00+00:00', step: 'x' }, removed: null, stored: null, problem: null })[0], /^Last backup/);
  assert.deepEqual([formatBytes(999), formatBytes(1500), formatBytes(23_000_000), formatBytes(4_560_000_000_000_000)],
    ['999 bytes', '1.5 KB', '23 MB', '4560 TB']);
}

// The exchange with a generated server.
{
  const calls = [];
  let retention = { keep: 'forever' }, denied = false, online = true;
  const transport = async (path, init) => {
    if (!online) throw new TypeError('Generated network unavailable');
    calls.push([init.method, path]);
    assert.equal(init.credentials, 'same-origin');
    if (path === '/api/atlas/auth/session')
      return Response.json({ schemaVersion: 1, actorId: 'a1', csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00Z' });
    assert.equal(path, '/api/atlas/backup/v1/settings');
    if (init.method === 'POST') {
      assert.equal(init.headers['X-Atlas-CSRF'], 'csrf-1');
      assert.equal(init.headers['Content-Type'], 'application/json');
      if (denied) return Response.json({ code: 'CAPABILITY_DENIED' }, { status: 403 });
      retention = JSON.parse(init.body);
    }
    return Response.json({ schemaVersion: 1, retention, status: null });
  };
  assert.deepEqual(await readSettings(transport), { kind: 'ready', view: { retention: { keep: 'forever' }, status: null } });
  const saved = await saveRetention({ keep: 'recent', nights: 30, months: 12 }, transport);
  assert.deepEqual(saved.retention, { keep: 'recent', nights: 30, months: 12 });
  assert.deepEqual(calls.slice(1), [['GET', '/api/atlas/auth/session'], ['POST', '/api/atlas/backup/v1/settings']]);
  denied = true;
  await assert.rejects(saveRetention({ keep: 'forever' }, transport), /denied/);
  assert.deepEqual(retention, { keep: 'recent', nights: 30, months: 12 });
  online = false;
  await assert.rejects(readSettings(transport), TypeError);
  assert.deepEqual(await readSettings(async () => new Response(null, { status: 404 })), { kind: 'absent' });

  // A save whose answer is lost: the choice is read again, never assumed.
  online = true;
  denied = false;
  let lose = true;
  const lossy = async (path, init) => {
    const response = await transport(path, init);
    if (init.method === 'POST' && lose) throw new TypeError('Generated answer lost');
    return response;
  };
  assert.deepEqual(await chooseRetention({ keep: 'forever' }, lossy),
    { load: { kind: 'ready', view: { retention: { keep: 'forever' }, status: null } }, error: null });
  const unwritten = async (path, init) => init.method === 'POST' ? new Response(null, { status: 500 }) : transport(path, init);
  assert.deepEqual(await chooseRetention({ keep: 'recent', nights: 7, months: 0 }, unwritten),
    { load: { kind: 'ready', view: { retention: { keep: 'forever' }, status: null } }, error: 'not-saved' });
  online = false;
  assert.deepEqual(await chooseRetention({ keep: 'recent', nights: 7, months: 0 }, transport), { load: { kind: 'unreachable' }, error: null });
  online = true;
  denied = true;
  await assert.rejects(chooseRetention({ keep: 'recent', nights: 7, months: 0 }, transport), /denied/);
}

console.log('PASS backup settings: strict decoding, tolerant job summary, retention and status sentences, CSRF save exchange, a lost answer re-read, denial and absent route');
