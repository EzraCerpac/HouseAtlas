import { useLayoutEffect, useRef } from 'react';
import { MESH_LIMITS } from '../mesh-profile';
import type { RenderScene } from '../mesh-profile';
import type { Projector } from '../../atlas/projection';
import { createFloorCompositor } from './floor-compositor';
import type { FloorCompositor } from './floor-compositor';
import { triangulateRoomRing } from './room-region-triangles';
import type { DisplayRoomRegion } from './types';
import { CARD, INK, BIRCH_DARK, LANTERN, ROOM_TINT, mix } from '../../atlas/palette';
export interface DisplayFloor {
  readonly key: string; readonly scene: RenderScene; readonly outlineBuffers: readonly Float32Array[]; readonly scale: number;
  readonly surfaceY: number; readonly minY: number; readonly height: number; readonly width: number; readonly depth: number;
  readonly centerX: number; readonly centerZ: number; readonly index: number;
}
interface Props {
  readonly owner: object;
  readonly floors: readonly DisplayFloor[]; readonly roomRegions: readonly DisplayRoomRegion[]; readonly selectedRoomId: string | null; readonly overlay: string; readonly projector: Projector;
  readonly viewBox: readonly [number, number, number, number]; readonly exploded: number;
  readonly selectedFloorKey: string; readonly plan: boolean; readonly cutaway: boolean;
  readonly onUnavailable: (message: string) => void;
}
const vertexSource = `attribute vec3 position;attribute vec3 normal;
uniform vec4 rotation;uniform vec4 viewport;uniform vec4 floorTransform;uniform vec2 center;uniform vec2 depthRange;
varying vec3 faceNormal;varying float height;
void main(){vec3 p=vec3((position.x-center.x)*floorTransform.x, -(position.z-center.y)*floorTransform.x, (position.y-floorTransform.y)*floorTransform.x+floorTransform.z);
float rx=p.x*rotation.x-p.y*rotation.y;float ry=p.x*rotation.y+p.y*rotation.x;
vec2 screen=vec2(rx,ry*rotation.z-p.z*rotation.w)*40.0;
float d=ry*rotation.w+p.z*rotation.z;
gl_Position=vec4((screen.x-viewport.x)/viewport.z*2.0-1.0,1.0-(screen.y-viewport.y)/viewport.w*2.0,-(d-depthRange.x)/depthRange.y,1.0);
height=(position.y-floorTransform.y)*floorTransform.x;
faceNormal=normalize(normal);}`;
// Original Model.boxFaces shading: fixed south-west light; CARD sides and white tops.
const fragmentSource = `precision mediump float;uniform vec3 color;uniform vec3 shadowColor;uniform vec3 topColor;uniform float opacity;uniform vec2 shadeMix;uniform float cutHeight;varying vec3 faceNormal;varying float height;
void main(){if(cutHeight>=0.0&&height>cutHeight)discard;vec3 n=normalize(faceNormal);float shade=(1.0-dot(vec2(n.x,-n.z),vec2(-0.6,0.8)))*0.5;
vec3 tone=abs(n.y)>0.8?topColor:mix(color,shadowColor,clamp(shadeMix.x+shade*shadeMix.y,0.0,1.0));gl_FragColor=vec4(tone,opacity);}`;
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const unsupportedBounds = 'Display bounds exceed the renderer range.';
function cameraDepthRange(props: Props): readonly [number, number] {
  const finiteFloat = (value: number) => Number.isFinite(value) && Number.isFinite(Math.fround(value));
  const depths: number[] = [];
  if (!props.viewBox.every(finiteFloat) || Math.fround(props.viewBox[2]) <= 0 || Math.fround(props.viewBox[3]) <= 0) throw new Error(unsupportedBounds);
  for (const floor of props.floors) {
    if (props.plan && floor.key !== props.selectedFloorKey) continue;
    const stack = props.plan ? 0 : floor.index * (3.2 + 3.4 * props.exploded);
    const roomHeight = (floor.surfaceY - floor.minY) * floor.scale + .005;
    const height = props.roomRegions.some(region => region.floorKey === floor.key) ? Math.max(floor.height, roomHeight) : floor.height;
    const extent = floor.width / 2 + floor.depth / 2 + Math.abs(stack) + height;
    if (![floor.scale, floor.minY, floor.surfaceY, floor.surfaceY + .005 / floor.scale, roomHeight, height, floor.centerX, floor.centerZ, floor.width, floor.depth, floor.height, stack, extent * 40, floor.scale * 160].every(finiteFloat)
      || Math.fround(floor.scale) <= 0 || floor.width < 0 || floor.depth < 0 || floor.height < 0) throw new Error(unsupportedBounds);
    // The full floor bounds include geometry above the optional height cutaway.
    for (const x of [-floor.width / 2, floor.width / 2]) for (const y of [-floor.depth / 2, floor.depth / 2]) for (const z of [stack, stack + height]) {
      const depth = props.projector.depth(x, y, z); if (!finiteFloat(depth)) throw new Error(unsupportedBounds); depths.push(depth);
    }
  }
  if (!depths.length) return [0, 1];
  const minimum = Math.min(...depths), maximum = Math.max(...depths);
  const center = minimum / 2 + maximum / 2, radius = Math.max(1, maximum / 2 - minimum / 2) * 1.1;
  if (![center, radius].every(finiteFloat) || Math.fround(radius) <= 0) throw new Error(unsupportedBounds);
  return [center, radius];
}
/** Bounded source triangles and local floor compositing. Display transforms establish no physical registration. */
export function SceneMeshCanvas(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), draw = useRef<(() => void) | null>(null);
  const current = useRef(props); current.current = props;
  useLayoutEffect(() => { draw.current?.(); }, [props.projector, props.viewBox, props.exploded, props.selectedFloorKey, props.plan, props.cutaway, props.selectedRoomId, props.overlay]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.floors.length === 0) return;
    const gl = element.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) { if (current.current.owner === props.owner && current.current.floors === props.floors && current.current.roomRegions === props.roomRegions) current.current.onUnavailable('3D rendering is unavailable.'); return; }
    let disposed = false, visible = true, raf: number | null = null;
    const isCurrent = () => !disposed && canvas.current === element && current.current.owner === props.owner && current.current.floors === props.floors && current.current.roomRegions === props.roomRegions;
    const shaders: WebGLShader[] = [], buffers: WebGLBuffer[] = [];
    let program: WebGLProgram | null = null, compositor: FloorCompositor | null = null;
    const dispose = () => { if (disposed) return; disposed = true; if (raf !== null) cancelAnimationFrame(raf); raf = null;
      if (draw.current === schedule) draw.current = null; for (const buffer of buffers) gl.deleteBuffer(buffer); for (const shader of shaders) gl.deleteShader(shader);
      compositor?.dispose(); compositor = null; gl.deleteProgram(program); element.width = 1; element.height = 1; };
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
      color: WebGLUniformLocation | null = null, cutHeight: WebGLUniformLocation | null = null,
      shadowColor: WebGLUniformLocation | null = null, topColor: WebGLUniformLocation | null = null, opacity: WebGLUniformLocation | null = null, shadeMix: WebGLUniformLocation | null = null;
    const uploaded: { floor: DisplayFloor; buffer: WebGLBuffer; count: number; name: string; outline: WebGLBuffer | null; outlineCount: number; room?: DisplayRoomRegion }[] = [];
    const render = () => {
      if (!isCurrent() || !program || !compositor) return; const p = current.current;
      const fittedDepth = cameraDepthRange(p);
      let w = Math.max(1, Math.round(element.clientWidth * Math.min(devicePixelRatio || 1, 2))), h = Math.max(1, Math.round(element.clientHeight * Math.min(devicePixelRatio || 1, 2)));
      const fit = Math.min(1, Math.sqrt(MESH_LIMITS.canvasPixels / (w * h))); w = Math.floor(w * fit); h = Math.floor(h * fit);
      if (element.width !== w || element.height !== h) { element.width = w; element.height = h; }
      compositor.resize(w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.depthMask(true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (const renderedFloor of p.floors) {
        if (p.plan && renderedFloor.key !== p.selectedFloorKey) continue;
        compositor.begin(); gl.disable(gl.CULL_FACE); gl.useProgram(program); gl.polygonOffset(1, 1);
        gl.uniform4f(rotation, p.projector.ct, p.projector.st, p.projector.sf, p.projector.cf); gl.uniform4f(viewport, ...p.viewBox); gl.uniform2f(depthRange, ...fittedDepth);
      for (const item of uploaded) {
        const f = item.floor; if (f.key !== renderedFloor.key) continue;
        gl.uniform4f(floorTransform, f.scale, f.minY, p.plan ? 0 : f.index * (3.2 + 3.4 * p.exploded), 0);
        gl.uniform2f(center, f.centerX, f.centerZ);
        const wall = /InnerSide|ExternalWalls/.test(item.name);
        gl.uniform1f(cutHeight, p.cutaway ? f.height * .42 : -1);
        const floor = /WholeFloor|FloorFillerTop/.test(item.name);
        const planT = Math.max(0, Math.min(1, (Math.asin(p.projector.sf) * 180 / Math.PI - 62) / 24));
        const side = rgb(floor ? '#E8CF9E' : CARD), shade = rgb(floor ? BIRCH_DARK : '#9C8F78');
        const roomTint = item.room ? ROOM_TINT[item.room.displayKind ?? 'service'] : null;
        const roomColor = item.room?.roomId === p.selectedRoomId ? mix(roomTint!, LANTERN, .75) : p.overlay !== 'spaces' && roomTint ? mix(roomTint, '#F3EFE8', .55) : roomTint;
        const top = roomColor ? rgb(roomColor) : floor ? rgb('#E9D7B3') : wall ? rgb(mix('#FFFFFF', INK, planT)) : rgb(CARD);
        gl.uniform3f(color, side[0]!, side[1]!, side[2]!); gl.uniform3f(shadowColor, shade[0]!, shade[1]!, shade[2]!); gl.uniform3f(topColor, top[0]!, top[1]!, top[2]!);
        gl.uniform2f(shadeMix, floor ? .15 : 0, floor ? .55 : .6); gl.uniform1f(opacity, 1); gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
        gl.disable(gl.BLEND); gl.enable(gl.POLYGON_OFFSET_FILL); gl.drawArrays(gl.TRIANGLES, 0, item.count);
        if (item.outline) { gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindBuffer(gl.ARRAY_BUFFER, item.outline);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(normal); gl.vertexAttrib3f(normal, 0, 1, 0);
          gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform3f(topColor, .12, .15, .22); gl.uniform1f(opacity, .12); gl.drawArrays(gl.LINES, 0, item.outlineCount); }
      }
        compositor.composite(!p.plan && p.exploded > .8 && renderedFloor.key !== p.selectedFloorKey ? .4 : 1);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
    };
    const resize = new ResizeObserver(schedule); resize.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; schedule(); }); intersection.observe(element);
    try {
      if (props.floors.length > 3 || props.floors.reduce((n, f) => n + f.scene.bytes, 0) > MESH_LIMITS.renderCpuBytes) throw new Error('Scene resource bound');
      const regionVertices = props.roomRegions.reduce((n, region) => n + region.polygons.reduce((m, ring) => m + ring.length, 0), 0);
      if (props.roomRegions.length > 32 || regionVertices > 8192) throw new Error('Room resource bound');
      const total = regionVertices * 3 * 24 + props.floors.reduce((n, f) => n + f.scene.meshes.reduce((m, mesh) => m + mesh.vertices.byteLength, 0) + f.outlineBuffers.reduce((m, data) => m + data.byteLength, 0), 0);
      if (total > MESH_LIMITS.renderCpuBytes) throw new Error('Scene allocation bound');
      if (total + MESH_LIMITS.canvasPixels * 12 > MESH_LIMITS.gpuBytes) throw new Error('GPU resource bound');
      cameraDepthRange(props);
      const compile = (kind: number, source: string) => { const shader = gl.createShader(kind); if (!shader) throw new Error('Shader allocation');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compile'); return shader; };
      program = gl.createProgram(); if (!program) throw new Error('Program allocation');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program link');
      position = gl.getAttribLocation(program, 'position'); normal = gl.getAttribLocation(program, 'normal');
      rotation = gl.getUniformLocation(program, 'rotation'); viewport = gl.getUniformLocation(program, 'viewport'); floorTransform = gl.getUniformLocation(program, 'floorTransform');
      center = gl.getUniformLocation(program, 'center'); depthRange = gl.getUniformLocation(program, 'depthRange'); color = gl.getUniformLocation(program, 'color'); cutHeight = gl.getUniformLocation(program, 'cutHeight');
      shadowColor = gl.getUniformLocation(program, 'shadowColor'); topColor = gl.getUniformLocation(program, 'topColor'); opacity = gl.getUniformLocation(program, 'opacity'); shadeMix = gl.getUniformLocation(program, 'shadeMix');
      if (position < 0 || normal < 0 || !rotation || !viewport || !floorTransform || !center || !depthRange || !color || !cutHeight || !shadowColor || !topColor || !opacity || !shadeMix) throw new Error('Shader inputs');
      for (const floor of props.floors) for (let index = 0; index < floor.scene.meshes.length; index++) {
        const mesh = floor.scene.meshes[index]!, edges = floor.outlineBuffers[index]!;
        const upload = (data: Float32Array) => { const buffer = gl.createBuffer(); if (!buffer) throw new Error('Buffer allocation');
          buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Buffer upload'); return buffer; };
        const buffer = upload(mesh.vertices), outline = edges.length ? upload(edges) : null;
        uploaded.push({ floor, buffer, count: mesh.triangles * 3, name: mesh.sourceName, outline, outlineCount: edges.length / 3 });
      }
      for(const region of props.roomRegions) {
        const floor=props.floors.find(f=>f.key===region.floorKey); if(!floor) continue;
        for(const ring of region.polygons) {
          const triangles=triangulateRoomRing(ring), data=new Float32Array(triangles.length*6);
          for(let i=0;i<triangles.length;i++) { const v=ring[triangles[i]!]!;
            data.set([floor.centerX+(v[0]-.5)*floor.width/floor.scale, floor.surfaceY+.005/floor.scale, floor.centerZ-(v[1]-.5)*floor.depth/floor.scale,0,1,0],i*6);
          }
          if (!data.every(Number.isFinite)) throw new Error(unsupportedBounds);
          const buffer=gl.createBuffer(); if(!buffer) throw new Error('Room buffer allocation'); buffers.push(buffer);
          gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
          if(gl.getError()!==gl.NO_ERROR) throw new Error('Room buffer upload');
          uploaded.push({floor,buffer,count:triangles.length,name:'ProvisionalRoomDisplayFill',outline:null,outlineCount:0,room:region});
        }
      }
      compositor = createFloorCompositor(gl);
      draw.current = schedule; schedule();
    } catch (error) { fail(error instanceof Error && error.message === unsupportedBounds ? unsupportedBounds : 'Source meshes cannot be rendered.'); }
    return () => { dispose(); resize.disconnect(); intersection.disconnect(); element.removeEventListener('webglcontextlost', contextLost); document.removeEventListener('visibilitychange', visibility); };
  }, [props.owner, props.floors, props.roomRegions]);
  return <canvas ref={canvas} className="scene-mesh-canvas" aria-label="Actual scan meshes with display-only floor spacing" role="img" />;
}
