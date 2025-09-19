// src/core/rendering/passes/shadowPass.ts
import { ShadowSubsystem } from "@/core/rendering/shadow";
import { Renderer } from "@/core/renderer";
import { Renderable } from "@/core/types/gpu";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

export class ShadowPass {
  private device: GPUDevice;
  private shadowSubsystem: ShadowSubsystem;

  constructor(device: GPUDevice) {
    this.device = device;
    this.shadowSubsystem = new ShadowSubsystem(this.device);
  }

  public async init(): Promise<void> {
    await this.shadowSubsystem.init(
      [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
        },
        {
          arrayStride: 16,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 9, offset: 0, format: "float32x2" }],
        },
      ],
      Renderer.INSTANCE_DATA_LAYOUT,
      "depth32float",
    );
  }

  public getShadowSubsystem(): ShadowSubsystem {
    return this.shadowSubsystem;
  }

  public updatePerFrame(
    camera: CameraComponent,
    sun?: SceneSunComponent,
    shadowSettings?: ShadowSettingsComponent,
  ): void {
    if (sun && sun.enabled && shadowSettings) {
      this.shadowSubsystem.updatePerFrame(camera, sun, shadowSettings);
    } else {
      this.shadowSubsystem.writeDisabled();
    }
  }

  public record(
    commandEncoder: GPUCommandEncoder,
    shadowCasters: Renderable[],
    shadowSettings: ShadowSettingsComponent,
    instanceBuffer: GPUBuffer,
    frameInstanceData: Float32Array,
  ): void {
    const shadowCasterCount = shadowCasters.length;
    if (shadowCasterCount === 0) {
      return;
    }

    const floatsPerInstance = (Renderer as any).INSTANCE_STRIDE_IN_FLOATS;
    const u32 = new Uint32Array(frameInstanceData.buffer);
    for (let i = 0; i < shadowCasterCount; i++) {
      const floatOffset = i * floatsPerInstance;
      frameInstanceData.set(shadowCasters[i].modelMatrix, floatOffset);
      const flags =
        (shadowCasters[i].isUniformlyScaled ? 1 : 0) |
        ((shadowCasters[i].receiveShadows !== false ? 1 : 0) << 1);
      u32[floatOffset + 16] = flags;
    }
    this.device.queue.writeBuffer(
      instanceBuffer,
      0,
      frameInstanceData.buffer,
      0,
      shadowCasterCount * (Renderer as any).INSTANCE_BYTE_STRIDE,
    );

    this.shadowSubsystem.recordShadowPass(
      commandEncoder,
      shadowSettings.mapSize,
      shadowCasters,
      instanceBuffer,
    );
  }
}
