// src/core/rendering/passes/clusterPass.ts
import { ClusterBuilder } from "@/core/rendering/clusterBuilder";
import { RendererStats } from "@/core/types/renderer";
import { RenderContext, RenderPass } from "@/core/types/rendering";

/**
 * Manages the clustered forward rendering compute passes.
 *
 * @remarks
 * This pass is responsible for orchestrating the `ClusterBuilder`, which
 * executes compute shaders to assign lights to a 3D grid of clusters in view
 * space. It does not render any geometry itself but prepares the light culling
 * data structures on the GPU that are consumed by the main PBR shader.
 *
 * The assignment shader (`cluster.wgsl`) operates by projecting each light's
 * bounding sphere into view space to determine the range of X, Y, and Z
 * clusters it overlaps. It then uses atomic operations to append the light's
 * index to the lists for all overlapped clusters, allowing for safe parallel
 * execution on the GPU. This culling process dramatically reduces the number of
 * light calculations required in the main PBR fragment shader.
 *
 * The pass's primary responsibilities within the frame are:
 * 1. Updating the cluster grid parameters based on the current camera and viewport.
 * 2. Recording the compute shader dispatches to clear old light lists and
 *    assign current lights to clusters.
 * 3. Periodically reading back cluster statistics for performance monitoring.
 */
export class ClusterPass implements RenderPass {
  private device: GPUDevice;
  private clusterBuilder: ClusterBuilder;

  /**
   * @param device The active GPUDevice.
   */
  constructor(device: GPUDevice) {
    this.device = device;
    this.clusterBuilder = new ClusterBuilder(this.device, {
      gridX: 16,
      gridY: 8,
      gridZ: 64,
      maxPerCluster: 128,
    });
  }

  /**
   * Initializes the pass by creating the underlying ClusterBuilder and its
   * associated GPU resources, such as compute pipelines and buffers.
   *
   * @remarks
   * This must be called before the pass can be executed.
   */
  public async init(): Promise<void> {
    await this.clusterBuilder.init();
  }

  /**
   * Retrieves the underlying ClusterBuilder instance.
   *
   * @remarks
   * This allows the Renderer to access the cluster buffers, which are required
   * for the main frame bind group.
   *
   * @returns The ClusterBuilder instance managed by this pass.
   */
  public getClusterBuilder(): ClusterBuilder {
    return this.clusterBuilder;
  }

  /**
   * Executes the light clustering compute passes for the frame.
   *
   * @remarks
   * This method pulls the necessary information from the `RenderContext`, such
   * as the camera and light data, and directs the `ClusterBuilder` to record
   * its compute commands into the context's command encoder.
   *
   * @param context The immutable render context for the current frame.
   */
  public execute(context: RenderContext): void {
    const lightCount = context.sceneData.lights.length;
    const lightStorageBuffer = context.lightStorageBuffer;

    this.clusterBuilder.updateParams(
      context.camera,
      context.canvasWidth,
      context.canvasHeight,
    );
    this.clusterBuilder.createComputeBindGroup(lightStorageBuffer);
    this.clusterBuilder.record(context.commandEncoder, lightCount);
  }

  /**
   * Updates the provided renderer statistics object with the latest data from
   * the cluster readback.
   *
   * @remarks
   * The statistics are read from the GPU periodically, so they may not be
   * updated every single frame.
   *
   * @param stats The renderer statistics object to populate.
   */
  public updateStats(stats: RendererStats): void {
    const cls = this.clusterBuilder.getLastStats();
    stats.clusterAvgLpcX1000 = cls.avgLpcX1000;
    stats.clusterMaxLpc = cls.maxLpc;
    stats.clusterOverflows = cls.overflow;
  }

  /**
   * Notifies the underlying ClusterBuilder that the frame's command buffers
   * have been submitted.
   *
   * @remarks
   * This is a necessary step to trigger the asynchronous readback of cluster
   * statistics from the GPU without stalling the pipeline.
   */
  public onSubmitted(): void {
    this.clusterBuilder.onSubmitted();
  }
}
