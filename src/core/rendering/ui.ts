// src/core/rendering/ui.ts
import shaderUrl from "@/core/shaders/ui.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { UIResourceManager } from "@/core/resources/ui/uiResourceManager";
import { World } from "@/core/ecs/world";

export class UISubsystem {
  private device: GPUDevice;
  private preprocessor: ShaderPreprocessor;
  private pipeline?: GPURenderPipeline;
  private quadVertexBuffer?: GPUBuffer;
  private instanceBuffer?: GPUBuffer;
  private instanceCapacity = 100;
  private screenUniformBuffer?: GPUBuffer;
  private textureBindGroup?: GPUBindGroup;
  private textureBindGroupLayout?: GPUBindGroupLayout;
  private canvasFormat: GPUTextureFormat;
  private uiResourceManager: UIResourceManager;

  // dependencies for ECS UI
  private world?: World;

  constructor(
    device: GPUDevice,
    preprocessor: ShaderPreprocessor,
    canvasFormat: GPUTextureFormat,
    uiResourceManager: UIResourceManager,
    world: World,
  ) {
    this.device = device;
    this.preprocessor = new ShaderPreprocessor();
    {
      this.device = device;
      this.preprocessor = preprocessor;
      this.canvasFormat = canvasFormat;
      this.uiResourceManager = uiResourceManager;
      this.world = world;
    }
  }
}
