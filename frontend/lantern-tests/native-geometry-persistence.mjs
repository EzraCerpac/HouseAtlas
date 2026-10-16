/** SOURCE ONLY until Root registers this exact command. Healthy synthetic cold
 * reopen transitions of the persistent scan cache through the actual read
 * client, scan cache and verifying mesh reader. Every step is a new simulated
 * process with fresh module, client and cache memory; only a SYNTHETIC
 * IndexedDB disk carries stored bytes between them. Counts are actual GETs
 * received by an owned loopback listener: the descriptor is read on every open,
 * and only changed, evicted, refreshed or foreign-partition meshes are
 * downloaded again. No browser, credential, user data, denial or failure
 * control; the quota case lives in native-geometry-persistence-quota.mjs. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  actorA, actorB, buildingId, createProcesses, CSRF_MARKER, derivative, floorKey, homeA, homeB, startSyntheticOwner, workspaceId,
} from './native-geometry-persistence-harness.mjs';
import { createSyntheticDisk, syntheticRecords } from './synthetic-indexeddb.mjs';

export async function runHealthyNativeGeometryPersistence() {
  const meshA = await derivative('Synthetic export A'), meshB = await derivative('Synthetic export B');
  assert.notEqual(meshA.sha, meshB.sha);
  const owner = await startSyntheticOwner({ mesh: meshA }), results = [];
  try {
    const openProcess = await createProcesses(owner);
    const probe = await openProcess({ disk: createSyntheticDisk(), actorId: actorA, homeId: homeA });
    const { database, limits } = probe; await probe.close();
    assert.equal(limits.entries, 16); assert.equal(limits.bytes, 64 * 1024 * 1024);
    const entries = disk => syntheticRecords(disk, database, 'entries');
    const record = (label, counts, expected) => {
      assert.deepEqual(counts, expected, label);
      results.push(`${label}: ${counts.descriptors} descriptor, ${counts.meshes} mesh GET`);
    };
    // One simulated process: open the scans once, then close the page.
    const cold = async (label, session, expected, options, order) => {
      const process = await openProcess(session);
      try { record(label, await process.open(options, order), expected); } finally { await process.close(); }
    };

    {
      const disk = createSyntheticDisk();
      const a = { disk, actorId: actorA, homeId: homeA };
      await cold('first open', a, { descriptors: 1, meshes: 1 });
      assert.equal(entries(disk).length, 1);
      await cold('cold reopen, unchanged scan', a, { descriptors: 1, meshes: 0 });
      owner.state.viewKey = '7'.repeat(64);
      await cold('cold reopen after an unrelated home edit', a, { descriptors: 1, meshes: 0 });

      const refreshing = await openProcess(a);
      try {
        record('explicit refresh after a cold reopen', await refreshing.open({ refresh: true }), { descriptors: 1, meshes: 1 });
        record('remount after refresh', await refreshing.open(), { descriptors: 1, meshes: 0 });
      } finally { await refreshing.close(); }
      await cold('cold reopen after refresh', a, { descriptors: 1, meshes: 0 });

      Object.assign(owner.state, { viewKey: '6'.repeat(64), revision: '4', mesh: meshB });
      await cold('cold reopen after a derivative version update', a, { descriptors: 1, meshes: 1 });
      assert.equal(entries(disk).length, 1, 'The superseded version of the floor is removed');
      await cold('cold reopen after the version update', a, { descriptors: 1, meshes: 0 });
      owner.state.license = { status: 'permitted', reference: 'Synthetic fixture permission, second wording' };
      await cold('cold reopen after a derivative licence update', a, { descriptors: 1, meshes: 1 });
      assert.equal(entries(disk).length, 1);

      await cold('other actor, same home and identical offer', { disk, actorId: actorB, homeId: homeA }, { descriptors: 1, meshes: 1 });
      await cold('first actor again', a, { descriptors: 1, meshes: 0 });
      assert.equal(entries(disk).length, 2, 'Each actor has its own record');
      await cold('first actor, other home', { disk, actorId: actorA, homeId: homeB }, { descriptors: 1, meshes: 1 });
      assert.equal(entries(disk).length, 3);

      // Storage holds digests and verified bytes only, in its own database.
      assert.deepEqual([...disk.databases.keys()], [database]);
      const rows = entries(disk), text = JSON.stringify(rows);
      for (const value of [actorA, actorB, CSRF_MARKER, workspaceId, homeA, homeB, buildingId, floorKey(0, owner.state)])
        assert(!text.includes(value), 'No identity, scope, token or offer field is stored in readable form');
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ['bytes', 'id', 'partition', 'slot', 'usedAt']);
        for (const field of ['id', 'partition', 'slot']) assert.match(row[field], /^[0-9a-f]{64}$/);
      }
      for (const blob of syntheticRecords(disk, database, 'blobs'))
        assert.deepEqual(new Uint8Array(blob.data), meshB.bytes, 'Only verified derivative bytes are stored');
      results.push('stored rows: digests and verified derivative bytes only; no actor, scope, token or descriptor');

      // Sign-out clears the cache through the same call the integration makes.
      const signingOut = await openProcess(a);
      try { await signingOut.cache.clear(); } finally { await signingOut.close(); }
      assert.equal(entries(disk).length, 0);
      await cold('cold reopen after sign-out cleared the cache', a, { descriptors: 1, meshes: 1 });
    }

    {
      // The entry bound removes the least recently used floor.
      const disk = createSyntheticDisk(), floors = limits.entries + 1, session = { disk, actorId: actorA, homeId: homeA };
      owner.state.floors = floors;
      await cold(`first open of ${floors} floors`, session, { descriptors: 1, meshes: floors });
      assert.equal(entries(disk).length, limits.entries);
      await cold(`cold reopen, ${limits.entries} most recent floors`, session, { descriptors: 1, meshes: 0 }, undefined,
        Array.from({ length: limits.entries }, (_, index) => index + 1));
      await cold('cold reopen, least recently used floor', session, { descriptors: 1, meshes: 1 }, undefined, [0]);
      assert.equal(owner.reads.at(-1).key, floorKey(0, owner.state));
    }

    {
      // A tightened byte bound of two and a half meshes keeps the two most recent.
      const disk = createSyntheticDisk(), session = { disk, actorId: actorA, homeId: homeA,
        limits: { bytes: Math.floor(meshB.bytes.byteLength * 2.5) } };
      owner.state.floors = 3;
      await cold('first open of 3 floors under a 2.5-mesh byte bound', session, { descriptors: 1, meshes: 3 });
      assert.equal(entries(disk).length, 2);
      await cold('cold reopen, two most recent floors', session, { descriptors: 1, meshes: 0 }, undefined, [1, 2]);
      await cold('cold reopen, floor beyond the byte bound', session, { descriptors: 1, meshes: 1 }, undefined, [0]);
      assert.equal(owner.reads.at(-1).key, floorKey(0, owner.state));
    }
  } finally { await owner.close(); }
  for (const line of results) console.log(`PASS ${line}`);
  console.log('PASS healthy persistent scan-cache cold reopen transitions; synthetic IndexedDB model, loopback GETs; not browser or iOS proof');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runHealthyNativeGeometryPersistence();
