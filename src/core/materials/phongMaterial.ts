// src/core/materials/phongMaterial.ts
import { Material } from "./material";
import { PhongMaterialOptions } from "@/core/types/gpu";
import shaderCode from "@/core/shaders/phong.wgsl";
import { createGPUBuffer } from "../utils/webgpu";

export class PhongMaterial extends Material {
  private pipelineLayout!: GPUPipelineLayout;
  private materialBindGroupLayout!: GPUBindGroupLayout;
  private shaderModule!: GPUShaderModule;

  constructor(
    device: GPUDevice,
    options: PhongMaterialOptions,
    texture: GPUTexture,
    sampler: GPUSampler,
  ) {
    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    const isTransparent = baseColor[3] < 1.0;
    super(device, isTransparent);

    this.shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.materialBindGroupLayout = this.device.createBindGroupLayout({
      label: "PHONG_MATERIAL_BIND_GROUP_LAYOUT",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    const uniformBuffer = this.createUniformBuffer(
      options,
      !!options.textureUrl,
    );

    this.bindGroup = this.device.createBindGroup({
      label: "PHONG_MATERIAL_BIND_GROUP",
      layout: this.materialBindGroupLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
  }

  private createUniformBuffer(
    options: PhongMaterialOptions,
    hasTexture: boolean,
  ): GPUBuffer {
    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    const specularColor = options.specularColor ?? [1, 1, 1];
    const shininess = options.shininess ?? 32.0;

    const uniformData = new Float32Array(12);
    uniformData.set(baseColor, 0);
    uniformData.set(specularColor, 4);
    uniformData[8] = shininess;
    uniformData[9] = hasTexture ? 1.0 : 0.0;

    return createGPUBuffer(
      this.device,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "PHONG_MATERIAL_UNIFORM_BUFFER",
    );
  }

  protected createPipeline(
    meshLayouts: GPUVertexBufferLayout[],
    instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
  ): GPURenderPipeline {
    if (!this.pipelineLayout) {
      this.pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [
          frameBindGroupLayout, // @group(0)
          this.materialBindGroupLayout, // @group(1)
        ],
      });
    }

    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: "vs_main",
        buffers: [...meshLayouts, instanceDataLayout], // Pass all the layouts
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
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
        // use none to disable culling of back-facing faces and color them
        // in the shader
        cullMode: "back",
      },
      depthStencil: {
        // Transparent objects test against the depth buffer but don't write to it.
        depthWriteEnabled: !this.isTransparent,
        depthCompare: "less",
        format: "depth24plus-stencil8",
      },
    });
  }
}
