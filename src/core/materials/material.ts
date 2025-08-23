// src/core/materials/material.ts
import { getLayoutKey } from "@/core/utils/layout";

export abstract class Material {
  /** A cache for pipelines, keyed by mesh layouts. */
  protected pipelineCache = new Map<string, GPURenderPipeline>();
  /** The bind group containing resources specific to this material (textures, uniforms). */
  public bindGroup!: GPUBindGroup;
  /** Does the material require alpha blending. */
  public isTransparent: boolean;

  protected device: GPUDevice;

  constructor(device: GPUDevice, isTransparent = false) {
    this.device = device;
    this.isTransparent = isTransparent;
  }

  /**
   * Retrieves a cached pipeline for the given layouts or creates a new one.
   *
   * This method is implemented by concrete material classes.
   * @param meshLayouts - Array of vertex buffer layouts for the mesh to be rendered.
   * @param instanceDataLayout - The layout for the per-instance data buffer.
   * @param frameBindGroupLayout - The layout for the per-frame bind group (@group(0)).
   * @returns A GPURenderPipeline configured for this material and the given mesh layout.
   */
  public getPipeline(
    meshLayouts: GPUVertexBufferLayout[],
    instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
  ): GPURenderPipeline {
    const layoutKey = getLayoutKey(meshLayouts);
    if (this.pipelineCache.has(layoutKey)) {
      return this.pipelineCache.get(layoutKey)!;
    }

    const pipeline = this.createPipeline(
      meshLayouts,
      instanceDataLayout,
      frameBindGroupLayout,
    );
    this.pipelineCache.set(layoutKey, pipeline);
    return pipeline;
  }

  /**
   * Abstract method that must be implemented by subclasses to create the actual
   * render pipeline.
   */
  protected abstract createPipeline(
    meshLayouts: GPUVertexBufferLayout[],
    instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
  ): GPURenderPipeline;
}
