// src/core/rendering/batchManager.ts
import { Material } from "@/core/materials/material";
import {
  InstanceData,
  Mesh,
  PipelineBatch,
  Renderable,
} from "@/core/types/gpu";

/**
 * Manages batching of renderables to minimize draw calls and allocations.
 * Caches batch structures across frames to reduce GC pressure.
 */
export class BatchManager {
  // Cache for opaque batches, cleared only when needed
  private opaqueBatches = new Map<GPURenderPipeline, PipelineBatch>();
  // Pre-allocated arrays for instance data to avoid per-frame allocations
  private instanceDataPool: Float32Array;
  private instanceDataPoolSize: number;
  private readonly INSTANCE_STRIDE_IN_FLOATS = 20;

  // Track if batches need rebuilding
  private batchesDirty = true;
  private lastRenderableCount = 0;
  private renderableHashes = new WeakMap<Renderable, number>();

  constructor(initialCapacity = 100) {
    this.instanceDataPoolSize =
      initialCapacity * this.INSTANCE_STRIDE_IN_FLOATS;
    this.instanceDataPool = new Float32Array(this.instanceDataPoolSize);
  }

  /**
   * Checks if renderables have changed since last frame
   */
  public checkIfDirty(renderables: Renderable[]): void {
    if (renderables.length !== this.lastRenderableCount) {
      this.batchesDirty = true;
      this.lastRenderableCount = renderables.length;
      return;
    }

    // Quick hash check for changes
    for (const renderable of renderables) {
      const hash = this.computeRenderableHash(renderable);
      const lastHash = this.renderableHashes.get(renderable);
      if (lastHash !== hash) {
        this.batchesDirty = true;
        this.renderableHashes.set(renderable, hash);
        return;
      }
    }
  }

  private computeRenderableHash(renderable: Renderable): number {
    const mid = ((renderable.material as any).id ?? 0) >>> 0;
    const aid = ((renderable.mesh as any).id ?? 0) >>> 0;
    // Simple mix to reduce collisions; still very cheap
    return ((mid * 2654435761) ^ (aid * 97531)) >>> 0;
  }

  /**
   * Gets or creates batches for opaque objects
   */
  public getOpaqueBatches(
    renderables: Renderable[],
    getPipeline: (material: Material, mesh: Mesh) => GPURenderPipeline,
  ): Map<GPURenderPipeline, PipelineBatch> {
    this.checkIfDirty(renderables);

    if (!this.batchesDirty && this.opaqueBatches.size > 0) {
      // Just update instance data without recreating batch structure
      this.updateInstanceData(this.opaqueBatches, renderables);
      return this.opaqueBatches;
    }

    // Clear and rebuild batches only when necessary
    this.opaqueBatches.clear();

    for (const renderable of renderables) {
      const { mesh, material, modelMatrix, isUniformlyScaled, normalMatrix } =
        renderable;
      const pipeline = getPipeline(material, mesh);

      if (!this.opaqueBatches.has(pipeline)) {
        this.opaqueBatches.set(pipeline, {
          material: material,
          meshMap: new Map<Mesh, InstanceData[]>(),
        });
      }

      const pipelineBatch = this.opaqueBatches.get(pipeline)!;
      if (!pipelineBatch.meshMap.has(mesh)) {
        pipelineBatch.meshMap.set(mesh, []);
      }

      pipelineBatch.meshMap.get(mesh)!.push({
        modelMatrix,
        isUniformlyScaled,
        normalMatrix,
      });
    }

    this.batchesDirty = false;
    return this.opaqueBatches;
  }

  /**
   * Updates only the instance data without recreating batch structures
   */
  private updateInstanceData(
    batches: Map<GPURenderPipeline, PipelineBatch>,
    renderables: Renderable[],
  ): void {
    // Clear existing instance data
    for (const batch of batches.values()) {
      for (const instances of batch.meshMap.values()) {
        instances.length = 0;
      }
    }

    // Repopulate with current frame data
    for (const renderable of renderables) {
      const { mesh, material, modelMatrix, isUniformlyScaled, normalMatrix } =
        renderable;

      // Find the matching batch
      for (const batch of batches.values()) {
        if (batch.material === material && batch.meshMap.has(mesh)) {
          batch.meshMap.get(mesh)!.push({
            modelMatrix,
            isUniformlyScaled,
            normalMatrix,
          });
          break;
        }
      }
    }
  }

  /**
   * Gets a pre-allocated Float32Array for instance data
   */
  public getInstanceDataArray(size: number): Float32Array {
    const requiredSize = size * this.INSTANCE_STRIDE_IN_FLOATS;

    if (requiredSize > this.instanceDataPoolSize) {
      // Grow the pool
      this.instanceDataPoolSize = Math.ceil(requiredSize * 1.5);
      this.instanceDataPool = new Float32Array(this.instanceDataPoolSize);
    }

    // Return a view of the pool
    return new Float32Array(this.instanceDataPool.buffer, 0, requiredSize);
  }

  /**
   * Mark batches as needing rebuild
   */
  public invalidate(): void {
    this.batchesDirty = true;
  }
}
