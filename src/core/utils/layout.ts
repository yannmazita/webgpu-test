// src/core/utils/layout.ts

/**
 * Generates a stable, unique string key from a GPUVertexBufferLayout object.
 * This is used for caching pipelines, as object references cannot be reliably
 * used as map keys when layouts are created dynamically.
 *
 * @param layout - The vertex buffer layout to serialize.
 * @returns A unique string representation of the layout.
 */
export const getLayoutKey = (layout: GPUVertexBufferLayout): string => {
  const attributes: string[] = [];
  if (layout.attributes) {
    for (const attr of layout.attributes) {
      attributes.push(`${attr.shaderLocation}:${attr.format}:${attr.offset}`);
    }
  }
  const attributesKey = attributes.join(",");

  // Also handle optional stepMode, which defaults to "vertex".
  return `${layout.arrayStride}:${layout.stepMode ?? "vertex"}:${attributesKey}`;
};
