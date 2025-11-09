// src/client/types/rendering.ts
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/shared/ecs/components/resources/sunComponent";
import { CameraComponent } from "@/shared/ecs/components/clientOnly/cameraComponent";
import { ClusterBuilder } from "@/client/rendering/clusterBuilder";
import { InstanceAllocations } from "@/client/rendering/instanceBufferManager";
import { ShadowSubsystem } from "@/client/rendering/shadow";
import { IBLComponent } from "@/shared/ecs/components/resources/iblComponent";
import { MaterialInstance } from "@/client/rendering/materials/materialInstance";
import { Renderable } from "@/client/types/gpu";
import { Light } from "@/shared/types/geometry";
import { vec4, Vec4 } from "wgpu-matrix";

/**
 * An interface representing the data properties of the scene to be rendered.
 * This is used in the RenderContext to provide an immutable snapshot of the scene data.
 */
export interface ISceneRenderData {
  readonly renderables: readonly Renderable[];
  readonly lights: readonly Light[];
  readonly skyboxMaterial?: MaterialInstance;
  readonly iblComponent?: IBLComponent;
  readonly prefilteredMipLevels: number;
  readonly fogEnabled: boolean;
  readonly fogColor: Vec4;
  readonly fogDensity: number;
  readonly fogHeight: number;
  readonly fogHeightFalloff: number;
  readonly fogInscatteringIntensity: number;
}

/**
 * A context object containing all necessary data and resources for a single
 * frame's render passes. It is passed immutably to each pass's `execute` method.
 */
export interface RenderContext {
  // Immutable scene data for the frame
  readonly sceneData: ISceneRenderData;
  readonly camera: CameraComponent;
  readonly sun?: SceneSunComponent;
  readonly shadowSettings?: ShadowSettingsComponent;

  // Core GPU resources (read-only references)
  readonly device: GPUDevice;
  readonly commandEncoder: GPUCommandEncoder;
  readonly canvasView: GPUTextureView;
  readonly depthView: GPUTextureView;
  readonly canvasFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;

  // Shared frame resources
  readonly frameBindGroup: GPUBindGroup;
  readonly frameBindGroupLayout: GPUBindGroupLayout;
  readonly lightStorageBuffer: GPUBuffer;

  // Instance data (prepared once per frame)
  readonly instanceBuffer: GPUBuffer;
  readonly instanceAllocations: InstanceAllocations;

  // Subsystems (for passes that need direct access)
  readonly clusterBuilder: ClusterBuilder;
  readonly shadowSubsystem: ShadowSubsystem;

  // Canvas dimensions
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/**
 * Interface for a self-contained rendering pass.
 */
export interface RenderPass {
  /**
   * Executes the render pass.
   * @param context The immutable render context for the frame.
   * @param passEncoder An optional encoder for passes that render into the main scene render pass.
   * @param callback Optional callback for custom drawing (debug UI, external libraries etc)
   */
  execute(
    context: RenderContext,
    passEncoder?: GPURenderPassEncoder,
    callback?: (passEncoder: GPURenderPassEncoder) => void,
  ): void;
}

/**
 * A container for all the data required by the Renderer to render a single frame.
 * This is a class with pre-allocated arrays to avoid GC pressure.
 */
export class SceneRenderData implements ISceneRenderData {
  public renderables: Renderable[] = [];
  public lights: Light[] = [];
  public skyboxMaterial?: MaterialInstance;
  public iblComponent?: IBLComponent;
  public prefilteredMipLevels = 0;

  // fog parameters
  public fogEnabled = false;
  public fogColor: Vec4 = vec4.fromValues(0.5, 0.6, 0.7, 1.0);
  public fogDensity = 0.02;
  public fogHeight = 0.0;
  public fogHeightFalloff = 0.1;
  public fogInscatteringIntensity = 0.8;

  public clear(): void {
    this.renderables.length = 0;
    this.lights.length = 0;
    this.skyboxMaterial = undefined;
    this.iblComponent = undefined;
    this.prefilteredMipLevels = 0;
    this.fogEnabled = false; // Reset per frame
  }
}
