// src/core/utils/resourceHandle.ts
import { ResourceHandle, ResourceType } from "@/core/resources/resourceHandle";
import { Mesh } from "@/core/types/gpu";
import { MaterialInstance } from "../materials/materialInstance";
import { Material } from "../materials/material";
import { PBRMaterial } from "../materials/pbrMaterial";

/**
 * Creates a mesh handle from a cache key.
 */
export function createMeshHandle(key: string): ResourceHandle<Mesh> {
  return ResourceHandle.fromKey<Mesh>(key, ResourceType.Mesh);
}

/**
 * Creates a material handle from a cache key.
 */
export function createMaterialHandle(
  key: string,
): ResourceHandle<MaterialInstance> {
  return ResourceHandle.fromKey<MaterialInstance>(key, ResourceType.Material);
}

/**
 * Creates a material template handle from a cache key.
 */
export function createMaterialTemplateHandle(
  key: string,
): ResourceHandle<Material> {
  return ResourceHandle.fromKey<Material>(key, ResourceType.MaterialTemplate);
}

export function createPBRMaterialTemplateHandle(
  key: string,
): ResourceHandle<PBRMaterial> {
  return ResourceHandle.fromKey<PBRMaterial>(
    key,
    ResourceType.MaterialTemplate,
  );
}

/**
 * Creates a sampler handle from a cache key.
 */
export function createSamplerHandle(key: string): ResourceHandle<GPUSampler> {
  return ResourceHandle.fromKey<GPUSampler>(key, ResourceType.Sampler);
}
