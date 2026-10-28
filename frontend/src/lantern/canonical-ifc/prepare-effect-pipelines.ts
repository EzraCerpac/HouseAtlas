import { ColorManagement, NoToneMapping, QuadMesh, RendererUtils, REVISION, type Node, type NodeMaterial, type RenderPipeline, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { OcclusionHistory } from './occlusion-history';

/** Private access is confined to the locked Three 0.186.1 implementation.
 * Recheck this adapter when that dependency changes: compilation must use the
 * same fullscreen vertex node, builder context and attachments as the draw. */
interface PipelineAccess {
  _update(): void;
  _quadMesh: QuadMesh;
  _contextData: { onBeforePipelineCallbacks: unknown[]; onAfterPipelineCallbacks: unknown[] };
}
interface OcclusionAccess { _material: NodeMaterial; _aoRenderTarget: RenderTarget }
interface ContextAccess {
  _renderContexts: { get(target?: RenderTarget | null, mrt?: unknown, depth?: number): unknown };
}

/** Temporarily replace an instance member, preserving inherited methods too. */
function replaceMember(owner: object, key: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(owner, key);
  Object.defineProperty(owner, key, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(owner, key, original);
    else Reflect.deleteProperty(owner, key);
  };
}

/** QuadMesh supplies its fullscreen vertex node only inside render(). Capture
 * that exact node through its synchronous setup, with a recording sink instead
 * of the renderer. This performs no renderer call, warm draw or history update. */
function quadVertex(quad: QuadMesh) {
  const material = quad.material as NodeMaterial, original = material.vertexNode;
  let vertex = original, captured = false;
  try {
    quad.render({ render() { vertex = material.vertexNode; captured = true; } } as unknown as WebGPURenderer);
  } finally { material.vertexNode = original; }
  if (!captured || vertex == null) throw new Error('Unsupported Three fullscreen vertex setup');
  return vertex;
}

/** Ahead-of-time preparation on a renderer which is still owned by build().
 * No scene/frame is drawn, and the history stays at its initial zero count.
 * Keeping updateBeforeType unchanged retains the runtime dependency lists;
 * returning false from the deferred hooks leaves NodeFrame's update stamps
 * untouched, so the first real shaded frame still performs every update. */
export async function prepareEffectPipelines(renderer: WebGPURenderer, effects: {
  pipeline: RenderPipeline; relit: RenderPipeline; occlusion: Node; history: OcclusionHistory; passes: readonly Node[];
}, nextSlice: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (REVISION !== '186') throw new Error('Effect preparation requires review for this Three revision');
  if (effects.history.count !== 0) throw new Error('Effect preparation must precede history rendering');
  signal?.throwIfAborted();
  const contexts = (renderer as unknown as ContextAccess)._renderContexts;
  if (!contexts || typeof contexts.get !== 'function') throw new Error('Unsupported Three render-context preparation');
  const restoreUpdates: (() => void)[] = [];
  try {
    for (const node of new Set([...effects.passes, effects.occlusion, effects.history])) {
      if (typeof node.updateBefore !== 'function') throw new Error('Unsupported effect update hook');
      restoreUpdates.push(replaceMember(node, 'updateBefore', () => false));
    }

    const compileQuad = async (quad: QuadMesh, target: RenderTarget | null, depth: 0 | 1, reset: boolean) => {
      signal?.throwIfAborted();
      const material = quad.material as NodeMaterial;
      if (!quad.isQuadMesh || !material.isNodeMaterial || material.fragmentNode == null)
        throw new Error('Effect graph was not initialized before preparation');
      const vertex = material.vertexNode, culled = quad.frustumCulled;
      const saved = RendererUtils.saveRendererState(renderer), xr = renderer.xr.enabled;
      // compileAsync otherwise always selects depth 0. AO/history draw inside
      // the output quad at depth 1, and that context identity is in the builder
      // cache key. Preparing depth 0 would rebuild their graph on the first draw.
      const get = contexts.get;
      const restoreContext = replaceMember(contexts, 'get', function(this: typeof contexts,
        at?: RenderTarget | null, mrt?: unknown, level = depth) { return get.call(this, at, mrt, level); });
      try {
        if (reset) {
          RendererUtils.resetRendererState(renderer, saved);
          renderer.toneMapping = NoToneMapping; renderer.outputColorSpace = ColorManagement.workingColorSpace; renderer.xr.enabled = false;
        }
        renderer.setRenderTarget(target);
        material.vertexNode = quadVertex(quad); quad.frustumCulled = false;
        await renderer.compileAsync(quad, quad.camera);
        signal?.throwIfAborted();
      } finally {
        material.vertexNode = vertex; quad.frustumCulled = culled;
        restoreContext(); RendererUtils.restoreRendererState(renderer, saved); renderer.xr.enabled = xr;
      }
      await nextSlice(); signal?.throwIfAborted();
    };

    const compileOutput = async (pipeline: RenderPipeline) => {
      const access = pipeline as unknown as PipelineAccess;
      if (pipeline.renderer !== renderer || typeof access._update !== 'function' || !access._quadMesh)
        throw new Error('Unsupported Three output-pipeline preparation');
      access._update();
      const checkCallbacks = () => {
        if (!access._contextData || access._contextData.onBeforePipelineCallbacks.length
          || access._contextData.onAfterPipelineCallbacks.length)
          throw new Error('Effect preparation does not support pipeline callbacks');
      };
      checkCallbacks();
      const tone = renderer.toneMapping, color = renderer.outputColorSpace, xr = renderer.xr.enabled;
      try {
        // The same output state RenderPipeline.render supplies around its quad.
        renderer.toneMapping = NoToneMapping; renderer.outputColorSpace = ColorManagement.workingColorSpace; renderer.xr.enabled = false;
        await compileQuad(access._quadMesh, null, 0, false);
        checkCallbacks();
      } finally { renderer.toneMapping = tone; renderer.outputColorSpace = color; renderer.xr.enabled = xr; }
    };

    // Building the actual output graph runs GTAO.setup and history.setup, which
    // initialize their real materials without running their drawing hooks.
    await compileOutput(effects.pipeline);
    await effects.history.prepareQuad((quad, target) => compileQuad(quad, target, 1, true));
    // History's graph can initialize GTAO's shared context again. Prepare AO
    // after that, against its final material and native RedFormat target.
    const ao = effects.occlusion as unknown as OcclusionAccess;
    if (!ao._material?.isNodeMaterial || !ao._aoRenderTarget?.isRenderTarget)
      throw new Error('Unsupported Three AO preparation');
    await compileQuad(new QuadMesh(ao._material), ao._aoRenderTarget, 1, true);
    await compileOutput(effects.relit);
    if (effects.history.count !== 0) throw new Error('Effect preparation advanced the history');
  } finally {
    for (const restore of restoreUpdates.reverse()) restore();
  }
}
