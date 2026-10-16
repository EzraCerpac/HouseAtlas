import { useLayoutEffect, useRef } from 'react';
import { drawsFloor, type DrawRules, type PreparedMesh, type Projection } from './geometry';

interface Props {
  readonly meshes: readonly PreparedMesh[];
  readonly projection: Projection;
  readonly rules: DrawRules;
  readonly currentFloorId: string | null;
  readonly selectedOccurrenceId: string | null;
  /** Other occurrences of the selected logical room. */
  readonly contextOccurrenceIds: readonly string[];
  /** Occurrence token -> overlay tint (hex). */
  readonly tints: ReadonlyMap<string, string>;
  readonly hidden: boolean;
  /** Mesh keys of a separate reference layer: drawn in a muted reference tone
   * behind the building so coincident surfaces never cover it. */
  readonly referenceKeys?: ReadonlySet<string> | undefined;
  /** Mesh keys left out of the drawing (presentation only; uploads are kept). */
  readonly hiddenKeys?: ReadonlySet<string> | undefined;
  /** Mesh keys of an explicit selection, drawn in the lantern tone. */
  readonly selectedKeys?: ReadonlySet<string> | undefined;
  /** Per-mesh display lift in metres (presentation only, such as exploded floors). */
  readonly lifts?: ReadonlyMap<string, number> | undefined;
  /** Per-mesh section height in the mesh's own source frame; overrides rules.clipY. */
  readonly clips?: ReadonlyMap<string, number | null> | undefined;
  /** Per-mesh dimming toward paper (0–1); replaces current-floor dimming when given. */
  readonly dims?: ReadonlyMap<string, number> | undefined;
  readonly onUnavailable: (message: string) => void;
}

/** Explicit renderer bounds: drawing-buffer pixels and uploaded vertex bytes. */
export const RENDER_LIMITS = Object.freeze({ pixels: 4_194_304, uploadBytes: 64 * 1024 * 1024 });
const vertexSource = `attribute vec3 position;attribute vec3 normal;
uniform vec4 rot;uniform vec3 center;uniform vec4 frame;uniform vec2 viewport;uniform float lift;
varying vec3 vNormal;varying float vY;
void main(){vec3 p=position-center;p.y+=lift;float rx=p.x*rot.x-p.z*rot.y;float rz=p.x*rot.y+p.z*rot.x;
float sx=frame.y+frame.x*rx;float sy=frame.z+frame.x*(rz*rot.z-p.y*rot.w);float d=rz*rot.w+p.y*rot.z;
gl_Position=vec4(sx/viewport.x*2.0-1.0,1.0-sy/viewport.y*2.0,clamp(-d/frame.w,-1.0,1.0),1.0);vNormal=normal;vY=position.y;}`;
const fragmentSource = `precision highp float;
uniform vec3 baseColor;uniform vec3 topColor;uniform vec3 cutColor;uniform float clipY;uniform float useClip;
varying vec3 vNormal;varying float vY;
void main(){if(useClip>0.5&&vY>clipY)discard;
if(!gl_FrontFacing){gl_FragColor=vec4(cutColor,1.0);return;}
vec3 n=normalize(vNormal);float light=clamp(0.6+0.4*dot(n,normalize(vec3(-0.45,0.8,0.55))),0.0,1.0);
gl_FragColor=vec4(n.y>0.8?topColor:baseColor*light,1.0);}`;

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => v + (b[i]! - v) * t) as Rgb;
const PAPER = rgb('#ECEEE9'), WALL = rgb('#FBF9F4'), TOP = rgb('#EEE5D2'), CUT = rgb('#2B3650');
const ROOM = rgb('#F4E8CC'), LANTERN = rgb('#FFD25E'), CONTEXT = rgb('#FCE7A6');
const REFERENCE = rgb('#C3CED6'), REFERENCE_TOP = rgb('#D7DFE4');

/** Shared-frame orthographic WebGL renderer. Draws on demand only; owns and
 * releases every GL object, listener and frame callback it creates. */
export function MeshLayer(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props); latest.current = props;
  const redraw = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { redraw.current?.(); },
    [props.projection, props.rules, props.currentFloorId, props.selectedOccurrenceId, props.contextOccurrenceIds, props.tints, props.hidden, props.referenceKeys,
      props.hiddenKeys, props.selectedKeys, props.lifts, props.clips, props.dims]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.meshes.length === 0) return;
    const gl = element.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) { props.onUnavailable('3D rendering is unavailable in this browser.'); return; }
    let disposed = false, frame: number | null = null, program: WebGLProgram | null = null;
    const shaders: WebGLShader[] = [], uploaded: { mesh: PreparedMesh; buffer: WebGLBuffer }[] = [];
    const schedule = () => {
      if (disposed || frame !== null || document.hidden) return;
      frame = requestAnimationFrame(() => { frame = null; try { render(); } catch { fail('The 3D model cannot be rendered.'); } });
    };
    const release = () => {
      if (disposed) return; disposed = true;
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      if (redraw.current === schedule) redraw.current = null;
      if (!gl.isContextLost()) { for (const item of uploaded) gl.deleteBuffer(item.buffer); for (const shader of shaders) gl.deleteShader(shader); gl.deleteProgram(program); }
      uploaded.length = 0; element.width = 1; element.height = 1;
    };
    const fail = (message: string) => { const live = !disposed; release(); if (live) latest.current.onUnavailable(message); };
    const lost = (event: Event) => { event.preventDefault(); fail('3D view closed by the browser. Reopen the viewer to retry.'); };
    const visibility = () => { if (!document.hidden) schedule(); };
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    let position = -1, normal = -1;
    const render = () => {
      if (disposed || !program) return;
      const p = latest.current; if (p.hidden) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.max(1, Math.round(element.clientWidth * dpr)), h = Math.max(1, Math.round(element.clientHeight * dpr));
      const fit = Math.min(1, Math.sqrt(RENDER_LIMITS.pixels / (w * h))); w = Math.max(1, Math.floor(w * fit)); h = Math.max(1, Math.floor(h * fit));
      if (element.width !== w || element.height !== h) { element.width = w; element.height = h; }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(program);
      const q = p.projection;
      gl.uniform4f(uniforms.rot!, q.ct, q.st, q.sf, q.cf);
      gl.uniform3f(uniforms.center!, q.center[0], q.center[1], q.center[2]);
      gl.uniform4f(uniforms.frame!, q.k, q.ox, q.oy, q.depthRadius);
      gl.uniform2f(uniforms.viewport!, q.viewport.width, q.viewport.height);
      gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(normal);
      for (const pass of ['reference', 'unbound', 'bound'] as const) {
        if (pass === 'unbound') gl.disable(gl.POLYGON_OFFSET_FILL);
        else { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(pass === 'bound' ? -2 : 2, pass === 'bound' ? -2 : 2); }
        for (const { mesh, buffer } of uploaded) {
          const kind = p.referenceKeys?.has(mesh.meshKey) ? 'reference' : mesh.occurrenceId !== null ? 'bound' : 'unbound';
          if (kind !== pass || !drawsFloor(p.rules, mesh.floorId) || p.hiddenKeys?.has(mesh.meshKey)) continue;
          const dim = p.dims ? p.dims.get(mesh.meshKey) ?? 0 : mesh.floorId !== p.currentFloorId ? .55 : 0;
          const clip = p.clips?.has(mesh.meshKey) ? p.clips.get(mesh.meshKey) ?? null : p.rules.clipY;
          gl.uniform1f(uniforms.useClip!, clip === null ? 0 : 1); gl.uniform1f(uniforms.clipY!, clip ?? 0);
          gl.uniform1f(uniforms.lift!, p.lifts?.get(mesh.meshKey) ?? 0);
          let top: Rgb, base: Rgb, cut: Rgb;
          if (p.selectedKeys?.has(mesh.meshKey)) { top = LANTERN; base = LANTERN; cut = mix(LANTERN, CUT, .18); }
          else if (kind === 'reference') { top = REFERENCE_TOP; base = REFERENCE; cut = mix(REFERENCE, CUT, .3); }
          else if (mesh.occurrenceId !== null) {
            const tint = mesh.occurrenceId === p.selectedOccurrenceId ? LANTERN : p.contextOccurrenceIds.includes(mesh.occurrenceId) ? CONTEXT
              : p.tints.has(mesh.occurrenceId) ? rgb(p.tints.get(mesh.occurrenceId)!) : ROOM;
            top = mesh.occurrenceId === p.selectedOccurrenceId ? tint : mix(tint, PAPER, dim);
            base = top; cut = mix(top, CUT, .18);
          } else { top = mix(TOP, PAPER, dim); base = mix(WALL, PAPER, dim); cut = mix(CUT, PAPER, dim * .8); }
          gl.uniform3f(uniforms.topColor!, ...top); gl.uniform3f(uniforms.baseColor!, ...base); gl.uniform3f(uniforms.cutColor!, ...cut);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles * 3);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
    };
    element.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(schedule); resize.observe(element);
    try {
      if (props.meshes.reduce((sum, mesh) => sum + mesh.vertices.byteLength, 0) > RENDER_LIMITS.uploadBytes) throw new Error('bound');
      const compile = (kind: number, source: string) => {
        const shader = gl.createShader(kind); if (!shader) throw new Error('shader'); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('compile'); return shader;
      };
      program = gl.createProgram(); if (!program) throw new Error('program');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
      position = gl.getAttribLocation(program, 'position'); normal = gl.getAttribLocation(program, 'normal');
      for (const name of ['rot', 'center', 'frame', 'viewport', 'lift', 'baseColor', 'topColor', 'cutColor', 'clipY', 'useClip'])
        uniforms[name] = gl.getUniformLocation(program, name);
      if (position < 0 || normal < 0 || Object.values(uniforms).some(value => value === null)) throw new Error('inputs');
      for (const mesh of props.meshes) {
        const buffer = gl.createBuffer(); if (!buffer) throw new Error('buffer');
        uploaded.push({ mesh, buffer }); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('upload');
      redraw.current = schedule; schedule();
    } catch { fail('The 3D model cannot be rendered.'); }
    return () => {
      release(); resize.disconnect();
      element.removeEventListener('webglcontextlost', lost); document.removeEventListener('visibilitychange', visibility);
    };
    // The GL scene is owned by one prepared mesh set; other props redraw only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.meshes]);
  return <canvas ref={canvas} className="cifc-canvas" hidden={props.hidden} aria-hidden="true" />;
}
