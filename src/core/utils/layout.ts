// src/core/utils/layout.ts

/**
 * Generates a stable, unique string key from an array of GPUVertexBufferLayout objects.
 * This is used for caching pipelines, as object references cannot be reliably
 * used as map keys when layouts are created dynamically.
 *
 * @param layouts - The array of vertex buffer layouts to serialize.
 * @returns A unique string representation of the layouts.
 */
export const getLayoutKey = (layouts: GPUVertexBufferLayout[]): string => {
  const layoutKeys: string[] = [];
  for (const layout of layouts) {
    const attributes: string[] = [];
    if (layout.attributes) {
      for (const attr of layout.attributes) {
        attributes.push(`${attr.shaderLocation}:${attr.format}:${attr.offset}`);
      }
    }
    const attributesKey = attributes.join(",");
    layoutKeys.push(
      `${layout.arrayStride}:${layout.stepMode ?? "vertex"}:${attributesKey}`,
    );
  }
  return layoutKeys.join("|");
};
