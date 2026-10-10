import { MESH_LIMITS } from '../mesh-profile';

export interface FloorCompositor {
  /** Allocated RGBA8 color texture plus DEPTH_COMPONENT16 storage. */
  readonly allocationBytes: number;
  resize(width: number, height: number): void;
  begin(): void;
  composite(opacity: number): void;
  dispose(): void;
}

const vertexSource = `attribute vec2 position;attribute vec2 texCoord;varying vec2 uv;
void main(){uv=texCoord;gl_Position=vec4(position,0.0,1.0);}`;
const fragmentSource = `precision mediump float;uniform sampler2D floorTexture;uniform float opacity;varying vec2 uv;
void main(){vec4 color=texture2D(floorTexture,uv);gl_FragColor=vec4(color.rgb,color.a*opacity);}`;

function requireObject<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Floor compositor ${label} allocation failed.`);
  return value;
}

function requireNoError(gl: WebGLRenderingContext, label: string): void {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`Floor compositor ${label} failed (${error}).`);
}

/** One bounded RGBA/depth target, reused for each floor before group compositing. */
export function createFloorCompositor(gl: WebGLRenderingContext): FloorCompositor {
  let framebuffer: WebGLFramebuffer | null = null;
  let colorTexture: WebGLTexture | null = null;
  let depthBuffer: WebGLRenderbuffer | null = null;
  let quadBuffer: WebGLBuffer | null = null;
  let program: WebGLProgram | null = null;
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let width = 0;
  let height = 0;
  let disposed = false;
  let positionLocation = -1;
  let texCoordLocation = -1;
  let textureLocation: WebGLUniformLocation | null = null;
  let opacityLocation: WebGLUniformLocation | null = null;

  const free = () => {
    if (disposed) return;
    disposed = true;
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (colorTexture) gl.deleteTexture(colorTexture);
    if (depthBuffer) gl.deleteRenderbuffer(depthBuffer);
    if (quadBuffer) gl.deleteBuffer(quadBuffer);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    framebuffer = null;
    colorTexture = null;
    depthBuffer = null;
    quadBuffer = null;
    program = null;
    vertexShader = null;
    fragmentShader = null;
    width = 0;
    height = 0;
  };

  const compile = (kind: number, source: string, label: string): WebGLShader => {
    const shader = requireObject(gl.createShader(kind), `${label} shader`);
    if (label === 'vertex') vertexShader = shader;
    else fragmentShader = shader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Floor compositor ${label} shader compilation failed.`);
    requireNoError(gl, `${label} shader compilation`);
    return shader;
  };

  try {
    if (gl.isContextLost()) throw new Error('Floor compositor WebGL context is lost.');

    vertexShader = compile(gl.VERTEX_SHADER, vertexSource, 'vertex');
    fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource, 'fragment');
    program = requireObject(gl.createProgram(), 'program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Floor compositor program link failed.');
    requireNoError(gl, 'program link');

    positionLocation = gl.getAttribLocation(program, 'position');
    texCoordLocation = gl.getAttribLocation(program, 'texCoord');
    textureLocation = gl.getUniformLocation(program, 'floorTexture');
    opacityLocation = gl.getUniformLocation(program, 'opacity');
    if (positionLocation < 0 || texCoordLocation < 0 || !textureLocation || !opacityLocation) {
      throw new Error('Floor compositor shader inputs are unavailable.');
    }

    quadBuffer = requireObject(gl.createBuffer(), 'quad buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    requireNoError(gl, 'quad buffer setup');

    colorTexture = requireObject(gl.createTexture(), 'color texture');
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    requireNoError(gl, 'color texture setup');

    depthBuffer = requireObject(gl.createRenderbuffer(), 'depth renderbuffer');
    framebuffer = requireObject(gl.createFramebuffer(), 'framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    requireNoError(gl, 'framebuffer attachment setup');
  } catch (error) {
    free();
    throw error;
  }

  const assertActive = () => {
    if (disposed) throw new Error('Floor compositor has been disposed.');
    if (gl.isContextLost()) throw new Error('Floor compositor WebGL context is lost.');
  };

  return {
    get allocationBytes() {
      return width * height * 6;
    },

    resize(nextWidth: number, nextHeight: number) {
      assertActive();
      if (!Number.isSafeInteger(nextWidth) || !Number.isSafeInteger(nextHeight) || nextWidth < 1 || nextHeight < 1) {
        throw new Error('Floor compositor dimensions must be positive integers.');
      }
      const pixels = nextWidth * nextHeight;
      if (!Number.isSafeInteger(pixels) || pixels > MESH_LIMITS.canvasPixels) {
        throw new Error('Floor compositor pixel bound exceeded.');
      }
      const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      if (nextWidth > maxTextureSize || nextHeight > maxTextureSize || nextWidth > maxRenderbufferSize || nextHeight > maxRenderbufferSize) {
        throw new Error('Floor compositor dimensions exceed the WebGL device bound.');
      }
      if (nextWidth === width && nextHeight === height) return;

      try {
        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nextWidth, nextHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, nextWidth, nextHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('Floor compositor framebuffer is incomplete.');
        }
        requireNoError(gl, 'target resize');
        width = nextWidth;
        height = nextHeight;
      } catch (error) {
        free();
        throw error;
      }
    },

    begin() {
      assertActive();
      if (width < 1 || height < 1) throw new Error('Floor compositor must be resized before begin.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      requireNoError(gl, 'target clear');
    },

    composite(opacity: number) {
      assertActive();
      if (width < 1 || height < 1) throw new Error('Floor compositor must be resized before composite.');
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Floor compositor opacity must be between 0 and 1.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.uniform1i(textureLocation, 0);
      gl.uniform1f(opacityLocation, opacity);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requireNoError(gl, 'floor composite');
    },

    dispose() {
      free();
    },
  };
}
