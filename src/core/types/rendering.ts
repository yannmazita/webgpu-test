// src/core/types/rendering.ts
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { ClusterBuilder } from "@/core/rendering/clusterBuilder";
import { InstanceAllocations } from "@/core/rendering/instanceBufferManager";
import { ShadowSubsystem } from "@/core/rendering/shadow";
import { IBLComponent } from "@/core/ecs/components/iblComponent";
import { MaterialInstance } from "@/core/materials/materialInstance";
import { Light, Renderable } from "@/core/types/gpu";
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

  // Optional particle data for the particle pass
  readonly particleBuffer?: GPUBuffer;
  readonly particleCount?: number;

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
   */
  execute(context: RenderContext, passEncoder?: GPURenderPassEncoder): void;
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
