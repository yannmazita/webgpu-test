// src/core/materials/material.ts
import { getLayoutKey } from "@/core/utils/layout";
import { Shader } from "@/core/shaders/shader";

export class Material {
  private static nextId = 0;
  public readonly id: number;
  /** A cache for pipelines, keyed by mesh layouts. */
  protected pipelineCache = new Map<string, GPURenderPipeline>();
  /** The bind group containing resources specific to this material (textures, uniforms). */
  public bindGroup: GPUBindGroup;
  /** Does the material require alpha blending. */
  public isTransparent: boolean;
  public shader: Shader;
  public materialBindGroupLayout: GPUBindGroupLayout;

  protected device: GPUDevice;

  constructor(
    device: GPUDevice,
    shader: Shader,
    layout: GPUBindGroupLayout,
    bindGroup: GPUBindGroup,
    isTransparent = false,
  ) {
    this.id = Material.nextId++;
    this.device = device;
    this.shader = shader;
    this.materialBindGroupLayout = layout;
    this.bindGroup = bindGroup;
    this.isTransparent = isTransparent;
  }

  /**
   * Retrieves or creates a render pipeline for this material.
   *
   * This method ensures that a unique pipeline is created for each combination
   * of mesh layout, canvas format, and depth format. It uses a cache to avoid
   * creating duplicate pipelines, which is a significant performance
   * optimization.
   *
   * @param meshLayouts The vertex buffer layouts of the mesh.
   * @param instanceDataLayout The vertex buffer layout for instance data.
   * @param frameBindGroupLayout The bind group layout for frame-level
   *     uniforms.
   * @param canvasFormat The format of the canvas texture.
   * @param depthFormat The format of the depth texture.
   * @returns A render pipeline compatible with this material and the given
   *     parameters.
   */
  public getPipeline(
    meshLayouts: GPUVertexBufferLayout[],
    instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): GPURenderPipeline {
    const layoutKey = `${getLayoutKey(
      meshLayouts,
    )}|${canvasFormat}|${depthFormat}`;
    if (this.pipelineCache.has(layoutKey)) {
      return this.pipelineCache.get(layoutKey)!;
    }

    const pipeline = this.createPipeline(
      meshLayouts,
      instanceDataLayout,
      frameBindGroupLayout,
      canvasFormat,
      depthFormat,
    );
    this.pipelineCache.set(layoutKey, pipeline);
    return pipeline;
  }

  protected createPipeline(
    meshLayouts: GPUVertexBufferLayout[],
    instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): GPURenderPipeline {
    // Validate that mesh layouts have expected shader locations
    const expectedLocations = new Set<number>();
    for (let bufferIdx = 0; bufferIdx < meshLayouts.length; bufferIdx++) {
      const layout = meshLayouts[bufferIdx];
      for (const attr of layout.attributes) {
        if (expectedLocations.has(attr.shaderLocation)) {
          throw new Error(
            `Duplicate shader location ${attr.shaderLocation} in buffer ${bufferIdx}`,
          );
        }
        expectedLocations.add(attr.shaderLocation);
      }
    }

    // Log the vertex state configuration for debugging
    console.log(`[Material ${this.id}] Creating pipeline with vertex state:`);
    for (let i = 0; i < meshLayouts.length; i++) {
      const layout = meshLayouts[i];
      const locations = layout.attributes
        .map((a) => `@location(${a.shaderLocation})`)
        .join(", ");
      console.log(
        `  Buffer ${i}: stride=${layout.arrayStride}, locations=[${locations}]`,
      );
    }
    console.log(`  Buffer ${meshLayouts.length}: Instance data`);

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        frameBindGroupLayout, // @group(0)
        this.materialBindGroupLayout, // @group(1)
      ],
    });

    // Create vertex buffers array with explicit ordering
    const vertexBuffers: GPUVertexBufferLayout[] = [];

    // First, add all mesh vertex buffers in order
    for (let i = 0; i < meshLayouts.length; i++) {
      vertexBuffers[i] = meshLayouts[i];
    }

    // Then add instance data buffer at the end
    vertexBuffers[meshLayouts.length] = instanceDataLayout;

    return this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.shader.module,
        entryPoint: this.shader.vertexEntryPoint,
        buffers: vertexBuffers, // Use explicit array instead of spread
      },
      fragment: {
        module: this.shader.module,
        entryPoint: this.shader.fragmentEntryPoint,
        targets: [
          {
            format: canvasFormat,
            blend: this.isTransparent
              ? {
                  color: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                }
              : undefined,
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
        frontFace: "ccw",
        cullMode: "back",
      },
      depthStencil: {
        depthWriteEnabled: !this.isTransparent,
        depthCompare: "less",
        format: depthFormat,
      },
    });
  }
}
