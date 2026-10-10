/** Healthy synthetic camera examples only. No provider, private scan, listener or native mutation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { loadScanProfileSource, syntheticMeshFixture } from './scan-mesh-read.mjs';

const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative) {
  const file = new URL(relative, import.meta.url);
  const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  return dataURL(code);
}
const cameraURL = await sourceURL('../src/lantern/atlas/projection.ts');
const file = new URL('../src/lantern/scans/presentation/scan-projection.ts', import.meta.url);
let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
assert(code.includes('"../../atlas/projection"'));
code = code.replaceAll('"../../atlas/projection"', JSON.stringify(cameraURL));
const { makeScanProjector, SCAN_PLAN_Y_TO_CAMERA } = await import(dataURL(code));
const { prepareMeshRender } = await import(await loadScanProfileSource());
const close = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const area = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const plan = [[.2, .3], [1.4, .35], [.45, 1.7]]; // An asymmetric authored CCW landmark triple.
assert(area(plan) > 0);
let examples = 0;
for (const upAxis of ['X', 'Y', 'Z']) {
  const fixture = syntheticMeshFixture(`Synthetic ${upAxis}-up floor`);
  fixture.authoredCoordinates.upAxis = upAxis;
  fixture.nodes[0].operations[0].matrixTokens = fixture.nodes[0].localMatrixTokens =
    fixture.meshes[0].composedLocalToStageMatrixTokens = ['1','0','0','0','0','1','0','0','0','0','1','0','0','0','0','1'];
  // All three declared up axes resolve to the same Y-up (x, height, -planY) basis.
  fixture.meshes[0].positionsLocalTokens = plan.flatMap(([x, y]) =>
    (upAxis === 'Z' ? [x, y, 0] : upAxis === 'X' ? [0, -x, -y] : [x, 0, -y]).map(String));
  const original = JSON.stringify(fixture);
  const rendered = await prepareMeshRender(fixture, new AbortController().signal);
  assert.equal(JSON.stringify(fixture), original, 'Rendering must not rewrite authored tokens or mappings');
  const vertices = rendered.meshes[0].vertices;
  const meshPlan = [0, 6, 12].map(i => [vertices[i], -vertices[i + 2]]);
  assert(area(meshPlan) > 0, 'Proper up-axis rotation must preserve source plan chirality');
  for (const yaw of [0, -32, 57, 180]) for (const pitch of [18, 36, 64, 90]) {
    const projector = makeScanProjector({ yaw, pitch, explode: 0 }, [0, 0]);
    const projected = meshPlan.map(([x, y]) => projector.p(x, y, 0));
    assert(area(projected) < 0, 'A source +Y-up plan must retain its shape when screen +Y points down');
    for (let i = 0; i < 3; i++) {
      const offset = i * 6;
      // Independent evaluation of the actual vertex shader camera equations.
      const x = vertices[offset], cameraY = -vertices[offset + 2] * SCAN_PLAN_Y_TO_CAMERA;
      const height = vertices[offset + 1];
      const rx = x * projector.ct - cameraY * projector.st;
      const ry = x * projector.st + cameraY * projector.ct;
      const gpuScreen = [rx * 40, (ry * projector.sf - height * projector.cf) * 40];
      const svgRoomOrAnchor = projector.p(meshPlan[i][0], meshPlan[i][1], height);
      close(gpuScreen[0], svgRoomOrAnchor[0]); close(gpuScreen[1], svgRoomOrAnchor[1]);
      close(ry * projector.cf + height * projector.sf,
        projector.depth(meshPlan[i][0], meshPlan[i][1], height));
    }
    examples++;
  }
}
const top = makeScanProjector({ yaw: 0, pitch: 90, explode: 0 }, [1.25, -2], 37);
assert(top.p(1.25, -1, 0)[1] < top.p(1.25, -2, 0)[1], 'Source top/window wall stays above its room');
assert(top.p(2.25, -2, 0)[0] > top.p(1.25, -2, 0)[0], 'Source right/hallway doorway stays on the right');
assert(top.dir(0, 1)[1] < 0);
for (const yaw of [-32, 0, 57]) {
  const p = makeScanProjector({ yaw, pitch: 36, explode: 0 }, [1.25, -2], 37);
  const m = p.planeMatrix(.8).match(/matrix\(([^)]+)\)/)[1].split(' ').map(Number);
  const [x, y] = [2.4, -.7], q = p.p(x, y, .8);
  close(m[0] * x + m[2] * y + m[4], q[0], .006);
  close(m[1] * x + m[3] * y + m[5], q[1], .006);
  assert(m[0] * m[3] - m[1] * m[2] < 0);
}
// The mounted SVG and GL consumers must both use the same audited source basis.
const house = readFileSync(new URL('../src/lantern/scans/presentation/HouseScanScene.tsx', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../src/lantern/scans/presentation/SceneMeshCanvas.tsx', import.meta.url), 'utf8');
assert(house.includes('makeScanProjector(cam, [0, 0])'));
assert(canvas.includes('-(position.z-center.y)*floorTransform.x*${SCAN_PLAN_Y_TO_CAMERA.toFixed(1)}'));
console.log(`PASS ${examples} healthy asymmetric up-axis/yaw/pitch examples; source preservation, top/right orientation and SVG/GL/depth agreement`);
