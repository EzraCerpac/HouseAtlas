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
  /** Faded, depth-tested and never-written cutaway: null fades the whole mesh,
   * a height fades only what lies above it. Drawn even when hidden by hiddenKeys. */
  readonly ghosts?: ReadonlyMap<string, number | null> | undefined;
  /** Colour overrides (hex); omitted entries keep the default tones. */
  readonly palette?: Partial<MeshPalette> | undefined;
  /** Share of the light every face keeps, 0–1; faces turned from the light get the rest by angle. */
  readonly ambient?: number | undefined;
  /** Opt-in architectural lighting of uncut back faces; other viewers retain cut tones. */
  readonly twoSided?: boolean | undefined;
  /** With twoSided only: faces turned from the light fall toward this tone (hex) instead of black. */
  readonly shade?: string | undefined;
  /** With twoSided only: unit direction toward the light in the model frame, replacing the fixed upper-left light. */
  readonly light?: readonly [number, number, number] | undefined;
  /** With twoSided only: upward-sloping faces of unbound, unselected geometry
   * (between flat tops and walls) take this tone (hex), lit like walls. A
   * presentation tone for the face's slope, never a material. */
  readonly pitch?: string | undefined;
  readonly onUnavailable: (message: string) => void;
}
export interface MeshPalette {
  readonly paper: string; readonly wall: string; readonly top: string; readonly cut: string;
  readonly room: string; readonly selected: string; readonly context: string; readonly ghost: string;
}
export const DEFAULT_MESH_PALETTE: MeshPalette = Object.freeze({
  paper: '#ECEEE9', wall: '#FBF9F4', top: '#EEE5D2', cut: '#2B3650', room: '#F4E8CC', selected: '#FFD25E', context: '#FCE7A6', ghost: '#FBF9F4',
});
const GHOST_ALPHA = .14, DEFAULT_AMBIENT = .6;

/** Explicit renderer bounds: drawing-buffer pixels and uploaded vertex bytes. */
export const RENDER_LIMITS = Object.freeze({ pixels: 4_194_304, uploadBytes: 64 * 1024 * 1024 });
const vertexSource = `attribute vec3 position;attribute vec3 normal;
uniform vec4 rot;uniform vec3 center;uniform vec4 frame;uniform vec2 viewport;uniform float lift;
varying vec3 vNormal;varying float vY;
void main(){vec3 p=position-center;p.y+=lift;float rx=p.x*rot.x-p.z*rot.y;float rz=p.x*rot.y+p.z*rot.x;
float sx=frame.y+frame.x*rx;float sy=frame.z+frame.x*(rz*rot.z-p.y*rot.w);float d=rz*rot.w+p.y*rot.z;
gl_Position=vec4(sx/viewport.x*2.0-1.0,1.0-sy/viewport.y*2.0,clamp(-d/frame.w,-1.0,1.0),1.0);vNormal=normal;vY=position.y;}`;
// Architectural two-sided lighting is opt-in. Other callers keep the original
// opaque back-face cut colour and normal handling.
const fragmentSource = `precision highp float;
uniform vec3 baseColor;uniform vec3 topColor;uniform vec3 cutColor;uniform float clipY;uniform float useClip;
uniform float alpha;uniform float floorY;uniform float useFloor;uniform float ambient;uniform float twoSided;uniform vec3 shadeColor;
uniform vec3 lightDir;uniform float usePitch;uniform vec3 pitchColor;
varying vec3 vNormal;varying float vY;
void main(){if(useClip>0.5&&vY>clipY)discard;if(useFloor>0.5&&vY<floorY)discard;
if(!gl_FrontFacing&&alpha>0.99&&(twoSided<0.5||useClip>0.5)){gl_FragColor=vec4(cutColor,1.0);return;}
vec3 n=normalize(vNormal);if(twoSided>0.5&&!gl_FrontFacing)n=-n;
float light=clamp(ambient+(1.0-ambient)*dot(n,lightDir),0.0,1.0);
vec3 face=usePitch>0.5?(n.y>=0.97?topColor:mix(shadeColor,n.y>0.2?pitchColor:baseColor,light)):(n.y>0.8?topColor:mix(shadeColor,baseColor,light));
gl_FragColor=vec4(face*alpha,alpha);}`;

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => v + (b[i]! - v) * t) as Rgb;
const REFERENCE = rgb('#C3CED6'), REFERENCE_TOP = rgb('#D7DFE4');
const FIXED_LIGHT = ((x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as Rgb; })(-.45, .8, .55);
const tones = (palette: Partial<MeshPalette> | undefined) => {
  const own = { ...DEFAULT_MESH_PALETTE, ...palette };
  return { PAPER: rgb(own.paper), WALL: rgb(own.wall), TOP: rgb(own.top), CUT: rgb(own.cut), ROOM: rgb(own.room),
    LANTERN: rgb(own.selected), CONTEXT: rgb(own.context), GHOST: rgb(own.ghost) };
};

/** Shared-frame orthographic WebGL renderer. Draws on demand only; owns and
 * releases every GL object, listener and frame callback it creates. */
export function MeshLayer(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props); latest.current = props;
  const redraw = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { redraw.current?.(); },
    [props.projection, props.rules, props.currentFloorId, props.selectedOccurrenceId, props.contextOccurrenceIds, props.tints, props.hidden, props.referenceKeys,
      props.hiddenKeys, props.selectedKeys, props.lifts, props.clips, props.dims, props.ghosts, props.palette, props.ambient, props.twoSided, props.shade, props.light, props.pitch]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element || props.meshes.length === 0) return;
    let creationReason = '';
    const creationFailed = (event: Event) => {
      creationReason = (event as WebGLContextEvent).statusMessage?.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240) ?? '';
    };
    element.addEventListener('webglcontextcreationerror', creationFailed);
    let gl: WebGLRenderingContext | null;
    try {
      gl = element.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch {
      element.removeEventListener('webglcontextcreationerror', creationFailed);
      props.onUnavailable('3D context creation threw an exception (context-exception).'); return;
    }
    element.removeEventListener('webglcontextcreationerror', creationFailed);
    if (!gl) {
      props.onUnavailable(`3D context creation returned no context (context-null).${creationReason ? ` ${creationReason}` : ' No browser reason was provided.'}`); return;
    }
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
      gl.uniform1f(uniforms.alpha!, 1); gl.uniform1f(uniforms.useFloor!, 0); gl.uniform1f(uniforms.floorY!, 0);
      gl.uniform1f(uniforms.ambient!, Math.min(1, Math.max(0, p.ambient ?? DEFAULT_AMBIENT)));
      gl.uniform1f(uniforms.twoSided!, p.twoSided ? 1 : 0);
      // Black shade is the plain lit tone (base × light); a shade tone is Atlas lighting only.
      const SHADE: Rgb = p.twoSided && p.shade ? rgb(p.shade) : [0, 0, 0];
      gl.uniform3f(uniforms.shadeColor!, ...SHADE);
      gl.uniform3f(uniforms.lightDir!, ...(p.twoSided && p.light ? [...p.light] as Rgb : FIXED_LIGHT));
      gl.uniform1f(uniforms.usePitch!, 0);
      const PITCH = p.twoSided && p.pitch ? rgb(p.pitch) : null;
      const { PAPER, WALL, TOP, CUT, ROOM, LANTERN, CONTEXT, GHOST } = tones(p.palette);
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
          let top: Rgb, base: Rgb, cut: Rgb, pitch: Rgb | null = null, shade = SHADE;
          if (p.selectedKeys?.has(mesh.meshKey)) { top = LANTERN; base = LANTERN; cut = mix(LANTERN, CUT, .18); }
          else if (kind === 'reference') { top = REFERENCE_TOP; base = REFERENCE; cut = mix(REFERENCE, CUT, .3); }
          else if (mesh.occurrenceId !== null) {
            const tint = mesh.occurrenceId === p.selectedOccurrenceId ? LANTERN : p.contextOccurrenceIds.includes(mesh.occurrenceId) ? CONTEXT
              : p.tints.has(mesh.occurrenceId) ? rgb(p.tints.get(mesh.occurrenceId)!) : ROOM;
            top = mesh.occurrenceId === p.selectedOccurrenceId ? tint : mix(tint, PAPER, dim);
            base = top; cut = mix(top, CUT, .18);
            // With a pitch tone, a room's own faces fall toward a deeper shade of its tint, never a drab one.
            if (PITCH) shade = mix(SHADE, base, .45);
          } else {
            top = mix(TOP, PAPER, dim); base = mix(WALL, PAPER, dim); cut = mix(CUT, PAPER, dim * .8);
            if (PITCH) pitch = mix(PITCH, PAPER, dim);
          }
          gl.uniform3f(uniforms.topColor!, ...top); gl.uniform3f(uniforms.baseColor!, ...base); gl.uniform3f(uniforms.cutColor!, ...cut);
          gl.uniform1f(uniforms.usePitch!, pitch ? 1 : 0); gl.uniform3f(uniforms.pitchColor!, ...(pitch ?? base)); gl.uniform3f(uniforms.shadeColor!, ...shade);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles * 3);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      if (p.ghosts && p.ghosts.size > 0) {
        // Faded cutaway last: behind nothing opaque, writing no depth, so it never covers or blocks what is drawn.
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.uniform1f(uniforms.alpha!, GHOST_ALPHA); gl.uniform1f(uniforms.useClip!, 0); gl.uniform1f(uniforms.usePitch!, 0); gl.uniform3f(uniforms.shadeColor!, ...SHADE);
        gl.uniform3f(uniforms.topColor!, ...GHOST); gl.uniform3f(uniforms.baseColor!, ...GHOST); gl.uniform3f(uniforms.cutColor!, ...GHOST);
        for (const { mesh, buffer } of uploaded) {
          if (!p.ghosts.has(mesh.meshKey) || !drawsFloor(p.rules, mesh.floorId)) continue;
          const above = p.ghosts.get(mesh.meshKey) ?? null;
          gl.uniform1f(uniforms.useFloor!, above === null ? 0 : 1); gl.uniform1f(uniforms.floorY!, above ?? 0);
          gl.uniform1f(uniforms.lift!, p.lifts?.get(mesh.meshKey) ?? 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles * 3);
        }
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
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
      for (const name of ['rot', 'center', 'frame', 'viewport', 'lift', 'baseColor', 'topColor', 'cutColor', 'clipY', 'useClip', 'alpha', 'floorY', 'useFloor', 'ambient', 'twoSided', 'shadeColor', 'lightDir', 'usePitch', 'pitchColor'])
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
