import { useEffect, useRef, useState } from 'react';
import { MESH_LIMITS, prepareMeshRender } from './mesh-profile';
import type { MeshProfile, RenderScene } from './mesh-profile';

export type MeshCanvasFailure = 'webgl-unavailable' | 'context-lost' | 'render-unavailable';
interface Props {
  readonly profile: MeshProfile; readonly viewKey: string;
  readonly selectedSourceId: string | null;
  readonly onPick: (sourceObjectId: string | null) => void;
  readonly onUnavailable: (reason: MeshCanvasFailure) => void;
}
interface Commands { reset(): void; top(): void; zoom(factor: number): void; }
type GpuMesh = { vertices: WebGLBuffer; lines: WebGLBuffer; count: number; };
const vertexShader = `attribute vec3 position;attribute vec3 normal;uniform mat4 camera;varying float light;
void main(){gl_Position=camera*vec4(position,1.0);light=0.46+0.54*abs(dot(normalize(normal),normalize(vec3(0.4,0.8,0.5))));}`;
const fragmentShader = `precision mediump float;uniform vec3 color;uniform bool picking;varying float light;
void main(){gl_FragColor=vec4(color*(picking?1.0:light),1.0);}`;
const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const normal = (a: readonly number[]): number[] => { const length = Math.hypot(...a); return a.map(value => value / length); };
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
function cameraMatrix(yaw: number, pitch: number, zoom: number, aspect: number): Float32Array {
  const distance = 2.8 / zoom, eye = [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)];
  const z = normal(eye), x = normal(cross([0, 1, 0], z)), y = cross(z, x);
  const view = [x[0]!, y[0]!, z[0]!, 0, x[1]!, y[1]!, z[1]!, 0, x[2]!, y[2]!, z[2]!, 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const near = 0.01, far = 100, f = 1 / Math.tan(Math.PI / 8);
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const out = new Float32Array(16);
  // Column-major camera boundary. Authored row-major matrices stay in profile.
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++)
    out[col * 4 + row]! += projection[k * 4 + row]! * view[col * 4 + k]!;
  return out;
}

/** Single active canvas; no scene library, network, texture decoding or cache. */
export function MeshCanvas({ profile, viewKey, selectedSourceId, onPick, onUnavailable }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null), commands = useRef<Commands | null>(null);
  const selection = useRef(selectedSourceId), callbacks = useRef({ onPick, onUnavailable });
  const rendered = useRef({ profile, viewKey }); rendered.current = { profile, viewKey };
  selection.current = selectedSourceId; callbacks.current = { onPick, onUnavailable };
  const redraw = useRef<(() => void) | null>(null);
  const [wireframe, setWireframe] = useState(false), [showExternal, setShowExternal] = useState(true);
  const options = useRef({ wireframe, showExternal }); options.current = { wireframe, showExternal };
  const [ready, setReady] = useState<{ profile: MeshProfile; viewKey: string } | null>(null);
  const isReady = ready?.profile === profile && ready.viewKey === viewKey;
  useEffect(() => { redraw.current?.(); }, [selectedSourceId, wireframe, showExternal]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const abort = new AbortController(); let disposed = false, lost = false, frame: number | null = null;
    let scene: RenderScene | null = null, gpu: GpuMesh[] = [];
    let program: WebGLProgram | null = null, shaders: WebGLShader[] = [];
    let framebuffer: WebGLFramebuffer | null = null, texture: WebGLTexture | null = null, depth: WebGLRenderbuffer | null = null;
    let yaw = -0.7, pitch = 0.7, zoom = 1, intersecting = true;
    let drag: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
    const current = (): boolean => !disposed && !lost && !abort.signal.aborted
      && rendered.current.profile === profile && rendered.current.viewKey === viewKey;
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false, alpha: false });
    if (!gl) { callbacks.current.onUnavailable('webgl-unavailable'); return () => { disposed = true; abort.abort(); }; }
    const dispose = (): void => {
      if (disposed) return; disposed = true; abort.abort();
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      redraw.current = null; commands.current = null; scene = null; drag = null;
      for (const mesh of gpu) { gl.deleteBuffer(mesh.vertices); gl.deleteBuffer(mesh.lines); } gpu = [];
      gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); gl.deleteRenderbuffer(depth);
      gl.deleteProgram(program); for (const shader of shaders) gl.deleteShader(shader); shaders = [];
      framebuffer = null; texture = null; depth = null; program = null;
      // Drop browser drawing buffers on close/unmount as well as explicit GPU handles.
      canvas.width = 1; canvas.height = 1;
    };
    const fail = (reason: MeshCanvasFailure): void => {
      const notify = current(); dispose(); if (notify) callbacks.current.onUnavailable(reason);
    };
    const contextLost = (event: Event): void => {
      event.preventDefault(); const notify = current(); lost = true; dispose();
      if (notify) callbacks.current.onUnavailable('context-lost');
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    // Restoration never resurrects stale data. The owning panel must reread.
    const contextRestored = (): void => { dispose(); };
    canvas.addEventListener('webglcontextrestored', contextRestored);
    let position = -1, normalLocation = -1;
    let camera: WebGLUniformLocation | null = null, color: WebGLUniformLocation | null = null, picking: WebGLUniformLocation | null = null;
    const size = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      let width = Math.max(1, Math.min(2048, Math.round(canvas.clientWidth * ratio))), height = Math.max(1, Math.min(2048, Math.round(canvas.clientHeight * ratio)));
      const fit = Math.min(1, Math.sqrt(MESH_LIMITS.canvasPixels / (width * height)));
      width = Math.max(1, Math.floor(width * fit)); height = Math.max(1, Math.floor(height * fit));
      if (canvas.width === width && canvas.height === height) return;
      if ((scene?.bytes ?? 0) + width * height * 6 > MESH_LIMITS.gpuBytes) throw new RangeError('GPU allocation estimate exceeded');
      canvas.width = width; canvas.height = height;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Picking framebuffer unavailable');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    const draw = (pick = false): void => {
      if (!current() || !scene || !program || document.hidden || !intersecting) return;
      size(); gl.bindFramebuffer(gl.FRAMEBUFFER, pick ? framebuffer : null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.063, 0.102, 0.133, 1); if (pick) gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); if (pick) gl.disable(gl.DITHER); else gl.enable(gl.DITHER);
      gl.useProgram(program); gl.uniformMatrix4fv(camera, false, cameraMatrix(yaw, pitch, zoom, canvas.width / canvas.height)); gl.uniform1i(picking, pick ? 1 : 0);
      scene.meshes.forEach((mesh, index) => {
        if (!options.current.showExternal && mesh.sourceName === 'ExternalWalls') return;
        const buffer = gpu[index]!, wire = options.current.wireframe && !pick;
        gl.bindBuffer(gl.ARRAY_BUFFER, wire ? buffer.lines : buffer.vertices); gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, wire ? 0 : 24, 0);
        if (wire) { gl.disableVertexAttribArray(normalLocation); gl.vertexAttrib3f(normalLocation, 0, 1, 0); }
        else { gl.enableVertexAttribArray(normalLocation); gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 24, 12); }
        const id = index + 1;
        gl.uniform3f(color, pick ? (id & 255) / 255 : selection.current === mesh.sourceObjectId ? 1 : 0.55,
          pick ? ((id >> 8) & 255) / 255 : selection.current === mesh.sourceObjectId ? 0.64 : 0.63,
          pick ? 0 : selection.current === mesh.sourceObjectId ? 0.22 : 0.66);
        gl.drawArrays(wire ? gl.LINES : gl.TRIANGLES, 0, buffer.count * (wire ? 6 : 3));
      });
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL rendering unavailable');
    };
    const schedule = (): void => {
      if (!current() || document.hidden || !intersecting || frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; try { draw(); } catch { fail('render-unavailable'); } });
    };
    redraw.current = schedule;
    commands.current = { reset: () => { if (!current()) return; yaw = -0.7; pitch = 0.7; zoom = 1; schedule(); },
      top: () => { if (!current()) return; pitch = 1.54; schedule(); },
      zoom: factor => { if (!current()) return; zoom = Math.max(0.4, Math.min(8, zoom * factor)); schedule(); } };
    const down = (event: PointerEvent): void => {
      if (!current() || event.button !== 0 || !scene) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      if (!current() || !drag || drag.id !== event.pointerId) return;
      yaw -= (event.clientX - drag.x) * 0.008; pitch = Math.max(-1.4, Math.min(1.54, pitch + (event.clientY - drag.y) * 0.008));
      drag.x = event.clientX; drag.y = event.clientY; schedule();
    };
    const up = (event: PointerEvent): void => {
      if (!current() || !drag || drag.id !== event.pointerId) return;
      const click = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5; drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (click && scene && !document.hidden && intersecting) {
        try {
          draw(true); const rect = canvas.getBoundingClientRect(), pixel = new Uint8Array(4);
          const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) / rect.width * canvas.width)));
          const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((rect.bottom - event.clientY) / rect.height * canvas.height)));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Mesh picking unavailable');
          const id = pixel[0]! + (pixel[1]! << 8) - 1;
          if (current()) callbacks.current.onPick(pixel[2] === 0 ? scene.meshes[id]?.sourceObjectId ?? null : null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } catch { fail('render-unavailable'); }
      }
      schedule();
    };
    const cancel = (): void => { drag = null; };
    const wheel = (event: WheelEvent): void => { if (!current()) return; event.preventDefault(); commands.current?.zoom(Math.exp(-event.deltaY * 0.001)); };
    const key = (event: KeyboardEvent): void => {
      if (!current() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') yaw -= 0.1; if (event.key === 'ArrowRight') yaw += 0.1;
      if (event.key === 'ArrowUp') pitch = Math.min(1.54, pitch + 0.1); if (event.key === 'ArrowDown') pitch = Math.max(-1.4, pitch - 0.1);
      if (event.key === '+' || event.key === '=') commands.current?.zoom(1.1); if (event.key === '-') commands.current?.zoom(1 / 1.1); schedule();
    };
    const visibility = (): void => { if (document.hidden && frame !== null) { cancelAnimationFrame(frame); frame = null; drag = null; } else schedule(); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('lostpointercapture', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(schedule); resize.observe(canvas);
    const intersection = new IntersectionObserver(entries => {
      intersecting = entries[0]?.isIntersecting ?? false;
      if (!intersecting && frame !== null) { cancelAnimationFrame(frame); frame = null; drag = null; } else schedule();
    }); intersection.observe(canvas);
    void prepareMeshRender(profile, abort.signal).then(prepared => {
      if (!current()) return; scene = prepared;
      const compile = (type: number, source: string): WebGLShader => {
        const shader = gl.createShader(type); if (!shader) throw new Error('Shader allocation unavailable');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unavailable'); return shader;
      };
      program = gl.createProgram(); if (!program) throw new Error('Program allocation unavailable');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program unavailable');
      position = gl.getAttribLocation(program, 'position'); normalLocation = gl.getAttribLocation(program, 'normal');
      camera = gl.getUniformLocation(program, 'camera'); color = gl.getUniformLocation(program, 'color'); picking = gl.getUniformLocation(program, 'picking');
      if (position < 0 || normalLocation < 0 || !camera || !color || !picking) throw new Error('Shader inputs unavailable');
      const upload = (data: Float32Array): WebGLBuffer => {
        const buffer = gl.createBuffer(); if (!buffer) throw new Error('GPU buffer unavailable');
        // Register immediately so partial preparation is disposed on an exception.
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteBuffer(buffer); throw new Error('GPU buffer unavailable'); } return buffer;
      };
      for (const mesh of prepared.meshes) {
        const vertices = upload(mesh.vertices);
        try { gpu.push({ vertices, lines: upload(mesh.lines), count: mesh.triangles }); }
        catch (error) { gl.deleteBuffer(vertices); throw error; }
      }
      framebuffer = gl.createFramebuffer(); texture = gl.createTexture(); depth = gl.createRenderbuffer();
      if (!framebuffer || !texture || !depth) throw new Error('Picking allocation unavailable');
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (current()) { setReady({ profile, viewKey }); schedule(); }
    }).catch(() => { if (current()) fail('render-unavailable'); });
    return () => {
      dispose(); resize.disconnect(); intersection.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', cancel);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility);
    };
  }, [profile, viewKey]);
  return <div className="scan-mesh-view">
    <div role="group" aria-label="Scan view controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" disabled={!isReady} onClick={() => commands.current?.reset()}>Reset view</button>
      <button type="button" disabled={!isReady} onClick={() => commands.current?.top()}>Top view</button>
      <button type="button" disabled={!isReady} onClick={() => commands.current?.zoom(1.1)}>Zoom in</button>
      <button type="button" disabled={!isReady} onClick={() => commands.current?.zoom(1 / 1.1)}>Zoom out</button>
      <label><input type="checkbox" checked={wireframe} onChange={event => setWireframe(event.target.checked)} /> Wireframe</label>
      {profile.meshes.some(mesh => mesh.sourceName === 'ExternalWalls') && <label><input type="checkbox" checked={showExternal} onChange={event => setShowExternal(event.target.checked)} /> Show ExternalWalls meshes</label>}
    </div>
    <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={`${profile.source.floorLabel} source meshes. Drag or use arrow keys to orbit; plus and minus to zoom.`}
      style={{ display: 'block', width: '100%', height: 'min(60vh, 480px)', minHeight: 240, background: '#101a22', touchAction: 'none', marginTop: 8 }} />
    {!isReady && <p role="status">Preparing source meshes…</p>}
  </div>;
}
