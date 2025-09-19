// src/core/rendering/passes/clusterPass.ts
import { ClusterBuilder } from "@/core/rendering/clusterBuilder";
import { RendererStats } from "@/core/types/renderer";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";

export class ClusterPass {
  private device: GPUDevice;
  private clusterBuilder: ClusterBuilder;

  constructor(device: GPUDevice) {
    this.device = device;
    this.clusterBuilder = new ClusterBuilder(this.device, {
      gridX: 16,
      gridY: 8,
      gridZ: 64,
      maxPerCluster: 128,
    });
  }

  public async init(): Promise<void> {
    await this.clusterBuilder.init();
  }

  public getClusterBuilder(): ClusterBuilder {
    return this.clusterBuilder;
  }

  public record(
    commandEncoder: GPUCommandEncoder,
    lightCount: number,
    camera: CameraComponent,
    canvasWidth: number,
    canvasHeight: number,
    lightStorageBuffer: GPUBuffer,
  ): void {
    this.clusterBuilder.updateParams(camera, canvasWidth, canvasHeight);
    this.clusterBuilder.createComputeBindGroup(lightStorageBuffer);
    this.clusterBuilder.record(commandEncoder, lightCount);
  }

  public updateStats(stats: RendererStats): void {
    const cls = this.clusterBuilder.getLastStats();
    stats.clusterAvgLpcX1000 = cls.avgLpcX1000;
    stats.clusterMaxLpc = cls.maxLpc;
    stats.clusterOverflows = cls.overflow;
  }

  public onSubmitted(): void {
    this.clusterBuilder.onSubmitted();
  }
}
