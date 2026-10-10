import { useLayoutEffect, useRef } from 'react';
import { MESH_LIMITS } from '../mesh-profile';
import type { RenderScene } from '../mesh-profile';
import type { Projector } from '../../atlas/projection';
export interface DisplayFloor {
  readonly key: string; readonly scene: RenderScene; readonly outlineBuffers: readonly Float32Array[]; readonly scale: number;
  readonly minY: number; readonly height: number; readonly width: number; readonly depth: number;
  readonly centerX: number; readonly centerZ: number; readonly index: number;
}
interface Props {
  readonly owner: object;
  readonly floors: readonly DisplayFloor[]; readonly projector: Projector;
  readonly viewBox: readonly [number, number, number, number]; readonly exploded: number;
  readonly selectedFloorKey: string; readonly plan: boolean; readonly cutaway: boolean;
  readonly onUnavailable: (message: string) => void;
}
const vertexSource = `attribute vec3 position;attribute vec3 normal;
uniform vec4 rotation;uniform vec4 viewport;uniform vec4 floorTransform;uniform vec2 center;uniform vec2 depthRange;
varying float light;varying float height;
void main(){vec3 p=vec3((position.x-center.x)*floorTransform.x, -(position.z-center.y)*floorTransform.x, (position.y-floorTransform.y)*floorTransform.x+floorTransform.z);
float rx=p.x*rotation.x-p.y*rotation.y;float ry=p.x*rotation.y+p.y*rotation.x;
vec2 screen=vec2(rx,ry*rotation.z-p.z*rotation.w)*40.0;
float d=ry*rotation.w+p.z*rotation.z;
gl_Position=vec4((screen.x-viewport.x)/viewport.z*2.0-1.0,1.0-(screen.y-viewport.y)/viewport.w*2.0,-(d-depthRange.x)/depthRange.y,1.0);
height=(position.y-floorTransform.y)*floorTransform.x;
light=0.70+0.30*abs(dot(normalize(normal),normalize(vec3(-0.6,0.8,0.5))));}`;
const fragmentSource = `precision mediump float;uniform vec3 color;uniform float cutHeight;varying float light;varying float height;
void main(){if(cutHeight>=0.0&&height>cutHeight)discard;gl_FragColor=vec4(color*light,1.0);}`;
const unsupportedBounds = 'Display bounds exceed the renderer range.';
function cameraDepthRange(props: Props): readonly [number, number] {
  const finiteFloat = (value: number) => Number.isFinite(value) && Number.isFinite(Math.fround(value));
  const depths: number[] = [];
  if (!props.viewBox.every(finiteFloat) || Math.fround(props.viewBox[2]) <= 0 || Math.fround(props.viewBox[3]) <= 0) throw new Error(unsupportedBounds);
  for (const floor of props.floors) {
    if (props.plan && floor.key !== props.selectedFloorKey) continue;
    const stack = props.plan ? 0 : floor.index * (3.2 + 3.4 * props.exploded);
    const extent = floor.width / 2 + floor.depth / 2 + Math.abs(stack) + floor.height;
    if (![floor.scale, floor.minY, floor.centerX, floor.centerZ, floor.width, floor.depth, floor.height, stack, extent * 40, floor.scale * 160].every(finiteFloat)
      || Math.fround(floor.scale) <= 0 || floor.width < 0 || floor.depth < 0 || floor.height < 0) throw new Error(unsupportedBounds);
    // The full floor bounds include geometry above the optional height cutaway.
    for (const x of [-floor.width / 2, floor.width / 2]) for (const y of [-floor.depth / 2, floor.depth / 2]) for (const z of [stack, stack + floor.height]) {
      const depth = props.projector.depth(x, y, z); if (!finiteFloat(depth)) throw new Error(unsupportedBounds); depths.push(depth);
    }
  }
  if (!depths.length) return [0, 1];
  const minimum = Math.min(...depths), maximum = Math.max(...depths);
  const center = minimum / 2 + maximum / 2, radius = Math.max(1, maximum / 2 - minimum / 2) * 1.1;
  if (![center, radius].every(finiteFloat) || Math.fround(radius) <= 0) throw new Error(unsupportedBounds);
  return [center, radius];
}
/** Bounded actual triangles; presentation transforms only, no textures, network, persistent cache or synthetic walls. */
export function SceneMeshCanvas(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), draw = useRef<(() => void) | null>(null);
  const current = useRef(props); current.current = props;
  useLayoutEffect(() => { draw.current?.(); }, [props.projector, props.viewBox, props.exploded, props.selectedFloorKey, props.plan, props.cutaway]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.floors.length === 0) return;
    const gl = element.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) { if (current.current.owner === props.owner && current.current.floors === props.floors) current.current.onUnavailable('3D rendering is unavailable.'); return; }
    let disposed = false, visible = true, raf: number | null = null;
    const isCurrent = () => !disposed && canvas.current === element && current.current.owner === props.owner && current.current.floors === props.floors;
    const shaders: WebGLShader[] = [], buffers: WebGLBuffer[] = [];
    let program: WebGLProgram | null = null;
    const dispose = () => { if (disposed) return; disposed = true; if (raf !== null) cancelAnimationFrame(raf); raf = null;
      if (draw.current === schedule) draw.current = null; for (const buffer of buffers) gl.deleteBuffer(buffer); for (const shader of shaders) gl.deleteShader(shader);
      gl.deleteProgram(program); element.width = 1; element.height = 1; };
    const fail = (message: string) => { const notify = isCurrent(); dispose(); if (notify) current.current.onUnavailable(message); };
    const contextLost = (event: Event) => { event.preventDefault(); fail('3D context closed. Reopen this view to retry.'); };
    element.addEventListener('webglcontextlost', contextLost);
    const visibility = () => { if (document.hidden && raf !== null) { cancelAnimationFrame(raf); raf = null; } else schedule(); };
    document.addEventListener('visibilitychange', visibility);
    const schedule = () => { if (!isCurrent() || !visible || document.hidden || raf !== null) return;
      raf = requestAnimationFrame(() => { raf = null; if (!isCurrent()) return;
        try { render(); } catch (error) { fail(error instanceof Error && error.message === unsupportedBounds ? unsupportedBounds : 'Source meshes cannot be rendered.'); } }); };
    let position = -1, normal = -1;
    let rotation: WebGLUniformLocation | null = null, viewport: WebGLUniformLocation | null = null,
      floorTransform: WebGLUniformLocation | null = null, center: WebGLUniformLocation | null = null, depthRange: WebGLUniformLocation | null = null,
      color: WebGLUniformLocation | null = null, cutHeight: WebGLUniformLocation | null = null;
    const uploaded: { floor: DisplayFloor; buffer: WebGLBuffer; count: number; name: string; outline: WebGLBuffer | null; outlineCount: number }[] = [];
    const render = () => {
      if (!isCurrent() || !program) return; const p = current.current;
      const fittedDepth = cameraDepthRange(p);
      let w = Math.max(1, Math.round(element.clientWidth * Math.min(devicePixelRatio || 1, 2))), h = Math.max(1, Math.round(element.clientHeight * Math.min(devicePixelRatio || 1, 2)));
      const fit = Math.min(1, Math.sqrt(MESH_LIMITS.canvasPixels / (w * h))); w = Math.floor(w * fit); h = Math.floor(h * fit);
      if (element.width !== w || element.height !== h) { element.width = w; element.height = h; }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.useProgram(program); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform4f(rotation, p.projector.ct, p.projector.st, p.projector.sf, p.projector.cf); gl.uniform4f(viewport, ...p.viewBox);
      gl.uniform2f(depthRange, ...fittedDepth);
      for (const item of uploaded) {
        const f = item.floor; if (p.plan && f.key !== p.selectedFloorKey) continue;
        gl.uniform4f(floorTransform, f.scale, f.minY, p.plan ? 0 : f.index * (3.2 + 3.4 * p.exploded), 0);
        gl.uniform2f(center, f.centerX, f.centerZ);
        const wall = /InnerSide|ExternalWalls/.test(item.name);
        gl.uniform1f(cutHeight, p.cutaway ? f.height * .42 : -1);
        const floor = /WholeFloor|FloorFillerTop/.test(item.name), frame = /[blrt]_frame/.test(item.name);
        const rgb = floor ? [0.89, 0.78, 0.58] : frame ? [0.77, 0.89, 0.93] : wall ? [0.96, 0.94, 0.89] : [0.86, 0.84, 0.78];
        gl.uniform3f(color, rgb[0]!, rgb[1]!, rgb[2]!); gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.drawArrays(gl.TRIANGLES, 0, item.count);
        if (item.outline) { gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindBuffer(gl.ARRAY_BUFFER, item.outline);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(normal); gl.vertexAttrib3f(normal, 0, 1, 0);
          gl.uniform3f(color, .63, .61, .56); gl.drawArrays(gl.LINES, 0, item.outlineCount); }
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
    };
    const resize = new ResizeObserver(schedule); resize.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; schedule(); }); intersection.observe(element);
    try {
      if (props.floors.length > 3 || props.floors.reduce((n, f) => n + f.scene.bytes, 0) > MESH_LIMITS.renderCpuBytes) throw new Error('Scene resource bound');
      const total = props.floors.reduce((n, f) => n + f.scene.meshes.reduce((m, mesh) => m + mesh.vertices.byteLength, 0) + f.outlineBuffers.reduce((m, data) => m + data.byteLength, 0), 0);
      if (total + MESH_LIMITS.canvasPixels * 6 > MESH_LIMITS.gpuBytes) throw new Error('GPU resource bound');
      const compile = (kind: number, source: string) => { const shader = gl.createShader(kind); if (!shader) throw new Error('Shader allocation');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compile'); return shader; };
      program = gl.createProgram(); if (!program) throw new Error('Program allocation');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program link');
      position = gl.getAttribLocation(program, 'position'); normal = gl.getAttribLocation(program, 'normal');
      rotation = gl.getUniformLocation(program, 'rotation'); viewport = gl.getUniformLocation(program, 'viewport'); floorTransform = gl.getUniformLocation(program, 'floorTransform');
      center = gl.getUniformLocation(program, 'center'); depthRange = gl.getUniformLocation(program, 'depthRange'); color = gl.getUniformLocation(program, 'color'); cutHeight = gl.getUniformLocation(program, 'cutHeight');
      if (position < 0 || normal < 0 || !rotation || !viewport || !floorTransform || !center || !depthRange || !color || !cutHeight) throw new Error('Shader inputs');
      for (const floor of props.floors) for (let index = 0; index < floor.scene.meshes.length; index++) {
        const mesh = floor.scene.meshes[index]!, edges = floor.outlineBuffers[index]!;
        const upload = (data: Float32Array) => { const buffer = gl.createBuffer(); if (!buffer) throw new Error('Buffer allocation');
          buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Buffer upload'); return buffer; };
        const buffer = upload(mesh.vertices), outline = edges.length ? upload(edges) : null;
        uploaded.push({ floor, buffer, count: mesh.triangles * 3, name: mesh.sourceName, outline, outlineCount: edges.length / 3 });
      }
      draw.current = schedule; schedule();
    } catch { fail('Source meshes cannot be rendered.'); }
    return () => { dispose(); resize.disconnect(); intersection.disconnect(); element.removeEventListener('webglcontextlost', contextLost); document.removeEventListener('visibilitychange', visibility); };
  }, [props.owner, props.floors]);
  return <canvas ref={canvas} className="scene-mesh-canvas" aria-label="Actual scan meshes with display-only floor spacing" role="img" />;
}
