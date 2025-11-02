// src/core/utils/material.ts
import { PBRMaterialSpec } from "@/core/types/material";

/**
 * Creates a stable, canonical string key from a PBR material specification.
 *
 * @remarks
 * This function is used to generate a unique key for caching material instances.
 * It sorts texture keys and serializes all options to ensure that two
 * identical specs produce the same key, regardless of property order.
 *
 * @param spec - The PBR material specification.
 * @returns A unique string key for caching.
 */
export function createMaterialSpecKey(spec: PBRMaterialSpec): string {
  const { options } = spec;
  const parts: string[] = ["PBR"];

  // Sort keys to ensure canonical representation
  const sortedKeys = Object.keys(options).sort() as (keyof typeof options)[];

  for (const key of sortedKeys) {
    const value = options[key];
    if (value !== undefined) {
      if (Array.isArray(value)) {
        parts.push(`${key}:${value.join(",")}`);
      } else {
        parts.push(`${key}:${value}`);
      }
    }
  }

  return parts.join("|");
}
