// src/core/materials/skyboxMaterial.ts
import { Material } from "./material";
import skyboxShaderUrl from "@/core/shaders/skybox.wgsl?url";
import { Shader } from "@/core/shaders/shader";
import { ShaderPreprocessor } from "../shaders/preprocessor";
import { MaterialInstance } from "./materialInstance";

export class SkyboxMaterial extends Material {
  private static shader: Shader | null = null;
  private static layout: GPUBindGroupLayout | null = null;

  public static async initialize(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
  ): Promise<void> {
    if (this.shader) return;

    this.shader = await Shader.fromUrl(
      device,
      preprocessor,
      skyboxShaderUrl,
      "SKYBOX_SHADER",
    );

    this.layout = device.createBindGroupLayout({
      label: "SKYBOX_MATERIAL_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "cube" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
  }

  private constructor(device: GPUDevice) {
    if (!SkyboxMaterial.shader || !SkyboxMaterial.layout) {
      throw new Error(
        "SkyboxMaterial not initialized. Call SkyboxMaterial.initialize() first.",
      );
    }
    // Skybox is not transparent
    super(device, SkyboxMaterial.shader, SkyboxMaterial.layout, false);
  }

  public static createTemplate(device: GPUDevice): SkyboxMaterial {
    return new SkyboxMaterial(device);
  }

  public createInstance(
    cubemapTexture: GPUTexture,
    sampler: GPUSampler,
  ): MaterialInstance {
    const bindGroup = this.device.createBindGroup({
      label: "SKYBOX_MATERIAL_INSTANCE_BIND_GROUP",
      layout: this.materialBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: cubemapTexture.createView({ dimension: "cube" }),
        },
        { binding: 1, resource: sampler },
      ],
    });

    // Skybox has no uniform buffer that needs updating.
    const dummyUniformBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM,
    });

    return new MaterialInstance(
      this.device,
      this,
      dummyUniformBuffer,
      bindGroup,
    );
  }

  // Override createPipeline for the skybox's special needs
  protected createPipeline(
    _meshLayouts: GPUVertexBufferLayout[],
    _instanceDataLayout: GPUVertexBufferLayout,
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): GPURenderPipeline {
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        frameBindGroupLayout, // @group(0)
        this.materialBindGroupLayout, // @group(1)
      ],
    });

    return this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.shader.module,
        entryPoint: this.shader.vertexEntryPoint,
        // No buffers needed for the fullscreen triangle trick
      },
      fragment: {
        module: this.shader.module,
        entryPoint: this.shader.fragmentEntryPoint,
        targets: [{ format: canvasFormat }],
      },
      // Render the skybox "inside" the cube
      primitive: {
        topology: "triangle-list",
        frontFace: "cw", // Flipped from ccw
        cullMode: "none",
      },
      // Skybox should be drawn behind everything, so we use a special depth test.
      depthStencil: {
        depthWriteEnabled: false, // Don't write to the depth buffer
        depthCompare: "less-equal", // Draw if at the far plane (z=1)
        format: depthFormat,
      },
    });
  }
}
