import type { PreparedMesh } from './geometry';
import type { EmbeddedTexture } from './embedded-png-material';

/** Explicit renderer bounds: drawing-buffer pixels and uploaded vertex bytes. */
export const RENDER_LIMITS = Object.freeze({ pixels: 4_194_304, uploadBytes: 64 * 1024 * 1024,
  /** A publication's detail model on Full quality (DETAIL_GLB_LIMITS.gpuBytes). */
  detailUploadBytes: 384 * 1024 * 1024 });

/** Actual per-mesh-set GPU reservation, before creating any GPU resource.
 * Exact image/sampler/colour-role resources are shared by this owner only. */
export function materialGpuResources(meshes: readonly PreparedMesh[], enabled: boolean, uploadBytes: number = RENDER_LIMITS.uploadBytes) {
  const textures = new Map<string, EmbeddedTexture>(); let bytes = 0;
  for (const mesh of meshes) {
    bytes += mesh.vertices.byteLength;
    if (!enabled || !mesh.sourceMaterial) continue;
    if (!mesh.materialVertices || mesh.materialVertices.length !== mesh.triangles * 27) throw new Error('Required texture attributes unavailable');
    bytes += mesh.materialVertices.byteLength;
    for (const texture of [mesh.sourceMaterial.baseColorTexture, mesh.sourceMaterial.normalTexture, mesh.sourceMaterial.metallicRoughnessTexture]) {
      if (!texture) continue;
      const prior = textures.get(texture.key);
      if (prior) { if (prior.image !== texture.image || prior.colorRole !== texture.colorRole) throw new Error('Texture owner identity collision'); continue; }
      const image = texture.image;
      if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
        || image.width > 1024 || image.height > 1024 || image.rgba.length !== image.width * image.height * 4) throw new Error('Required decoded pixels unavailable');
      let w = image.width, h = image.height;
      do { bytes += w * h * 4; if (w === 1 && h === 1) break; w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2)); } while (true);
      textures.set(texture.key, texture);
    }
  }
  if (bytes > uploadBytes) throw new Error('Model exceeds the unchanged GPU budget');
  return { bytes, textures };
}
