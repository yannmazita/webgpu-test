// src/core/utils/material.ts
import { PBRMaterialOptions } from "@/core/types/gpu";

/**
 * Creates a deterministic, unique cache key for a PBR material based on its options.
 *
 * @remarks
 * This function serializes the most important properties of a material into a
 * string, ensuring that materials with the same visual properties map to the
 * same cache key. This is crucial for efficient caching and avoiding
 * redundant GPU resource creation.
 *
 * @param options The PBR material options.
 * @returns A string key suitable for caching.
 */
export function createMaterialCacheKey(options: PBRMaterialOptions): string {
  // Use a sorted list of keys to ensure consistent ordering
  const keys = [
    "albedo",
    "albedoMap",
    "metallic",
    "roughness",
    "metallicRoughnessMap",
    "normalMap",
    "normalIntensity",
    "emissive",
    "emissiveMap",
    "emissiveStrength",
    "emissiveUV",
    "occlusionMap",
    "occlusionStrength",
    "occlusionUV",
    "specularFactor",
    "specularColorFactor",
    "specularFactorMap",
    "specularColorMap",
    "uvScale",
    "albedoUV",
    "metallicRoughnessUV",
    "normalUV",
    "usePackedOcclusion",
  ] as const;

  const parts: string[] = [];
  for (const key of keys) {
    const value = options[key as any];
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        parts.push(`${key}:[${value.join(",")}]`);
      } else if (typeof value === "object") {
        // Handle vec3 or other simple objects
        parts.push(`${key}:{${JSON.stringify(value)}}`);
      } else {
        parts.push(`${key}:${value}`);
      }
    }
  }

  // Sort parts to ensure the key is always the same for the same options
  parts.sort();
  return parts.join("|");
}
