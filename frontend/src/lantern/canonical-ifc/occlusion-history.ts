import { HalfFloatType, NodeMaterial, NodeUpdateType, QuadMesh, RedFormat, RendererUtils, RenderTarget, TempNode, Vector2, type Node, type NodeBuilder, type NodeFrame, type TextureNode } from 'three/webgpu';
import { convertToTexture, Fn, mix, passTexture, texture, uniform, uv } from 'three/tsl';

const size = new Vector2();
/** Renderer state set aside while the history draws; three fills it on first use. */
let saved = undefined as unknown as RendererUtils.RendererState;

/** Averages a still view's contact shading over successive frames. Each frame
 * GTAO samples a different rotation of its kernel; frame n is blended in with
 * weight 1/n, so after `frames` frames the result is the mean of `frames`
 * independent estimates and the grain is gone. Past that it keeps a running
 * average with the same weight. Half-float history, so small weights do not
 * stall on 8-bit rounding. Modelled on three's AfterImageNode. */
export class OcclusionHistory extends TempNode {
  /** Frames averaged so far; set to 0 whenever the view or the scene changes. */
  count = 0;
  private readonly weight = uniform(1);
  private latest = new RenderTarget(1, 1, { depthBuffer: false, format: RedFormat, type: HalfFloatType });
  private previous = new RenderTarget(1, 1, { depthBuffer: false, format: RedFormat, type: HalfFloatType });
  private readonly output: TextureNode;
  private readonly earlier: TextureNode;
  private readonly material = new NodeMaterial();
  private readonly quad = new QuadMesh(this.material);

  constructor(private readonly source: TextureNode, readonly frames: number) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.output = passTexture(this as never, this.latest.texture);
    this.earlier = texture(this.previous.texture);
  }

  getTextureNode(): TextureNode { return this.output; }

  /** Whether another frame would still lower the grain. */
  get settling(): boolean { return this.count < this.frames; }

  override updateBefore(frame: NodeFrame): undefined {
    const renderer = frame.renderer!;
    // Same size as the occlusion pass, which draws at the full drawing buffer.
    const { x: width, y: height } = renderer.getDrawingBufferSize(size);
    if (this.latest.width !== width || this.latest.height !== height) {
      this.latest.setSize(width, height); this.previous.setSize(width, height); this.count = 0;
    }
    this.count = Math.min(this.count + 1, this.frames);
    this.weight.value = 1 / this.count;
    saved = RendererUtils.resetRendererState(renderer, saved);
    this.output.value = this.latest.texture; this.earlier.value = this.previous.texture;
    renderer.setRenderTarget(this.latest); this.quad.render(renderer);
    [this.latest, this.previous] = [this.previous, this.latest];
    RendererUtils.restoreRendererState(renderer, saved);
    return undefined;
  }

  override setup(builder: NodeBuilder): Node {
    this.material.name = 'OcclusionHistory';
    this.material.fragmentNode = Fn(() => mix(this.earlier.sample(uv()).r, this.source.sample(uv()).r, this.weight))();
    // Declared as a child, so the occlusion pass is drawn before this one each frame.
    (builder as NodeBuilder & { getNodeProperties(node: Node): Record<string, unknown> }).getNodeProperties(this).source = this.source;
    return this.output;
  }

  override dispose(): void {
    super.dispose();
    this.latest.dispose(); this.previous.dispose(); this.material.dispose();
  }
}

export const occlusionHistory = (node: Node, frames: number) => new OcclusionHistory(convertToTexture(node), frames);
