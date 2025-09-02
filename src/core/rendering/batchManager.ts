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
  private readonly INSTANCE_STRIDE_IN_FLOATS = 26; // stride to match renderer

  // Track if batches need rebuilding
  private batchesDirty = true;
  private lastOpaqueSignature: [number, number][] = [];

  // --- Debugging ---
  private readonly DEBUG_BATCHING = false; // Set to true to log rebuilds
  private debugRebuildCounter = 0;

  constructor(initialCapacity = 100) {
    this.instanceDataPoolSize =
      initialCapacity * this.INSTANCE_STRIDE_IN_FLOATS;
    this.instanceDataPool = new Float32Array(this.instanceDataPoolSize);
  }

  /**
   * Generates a stable numeric key from material and mesh IDs.
   */
  private _combineIds(materialId: number, meshId: number): number {
    // Combine two 26-bit safe numbers into one 52-bit safe number.
    // Assumes materialId and meshId are well under 2^26 (67 million).
    return materialId * 67108864 + meshId; // 67108864 = 2^26
  }

  /**
   * Computes a canonical signature of the scene's opaque renderable structure.
   * The signature is a sorted list of [structure_key, count] pairs.
   */
  private _computeOpaqueSignature(
    renderables: Renderable[],
  ): [number, number][] {
    const counts = new Map<number, number>();
    for (const r of renderables) {
      // The `id` property is added dynamically in ResourceManager.
      const key = this._combineIds((r.material as any).id, (r.mesh as any).id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Sort by key for a canonical representation that is easy to compare.
    return Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
  }

  /**
   * Checks if the structure of opaque renderables has changed since last frame.
   */
  public checkIfDirty(opaqueRenderables: Renderable[]): void {
    const newSignature = this._computeOpaqueSignature(opaqueRenderables);

    if (newSignature.length !== this.lastOpaqueSignature.length) {
      this.batchesDirty = true;
    } else {
      let areEqual = true;
      for (let i = 0; i < newSignature.length; i++) {
        if (
          newSignature[i][0] !== this.lastOpaqueSignature[i][0] ||
          newSignature[i][1] !== this.lastOpaqueSignature[i][1]
        ) {
          areEqual = false;
          break;
        }
      }
      this.batchesDirty = !areEqual;
    }

    if (this.batchesDirty) {
      this.lastOpaqueSignature = newSignature;
      if (this.DEBUG_BATCHING) {
        this.debugRebuildCounter++;
        console.log(
          `BatchManager: Rebuilding batches. Count: ${this.debugRebuildCounter}`,
        );
      }
    }
  }

  /**
   * Gets or creates batches for opaque objects.
   */
  public getOpaqueBatches(
    allRenderables: Renderable[],
    getPipeline: (material: Material, mesh: Mesh) => GPURenderPipeline,
  ): Map<GPURenderPipeline, PipelineBatch> {
    const opaqueRenderables = allRenderables.filter(
      (r) => !r.material.isTransparent,
    );
    this.checkIfDirty(opaqueRenderables);

    if (!this.batchesDirty && this.opaqueBatches.size > 0) {
      // Fast path: Just update instance data without recreating batch structure
      this.updateInstanceData(opaqueRenderables);
      return this.opaqueBatches;
    }

    // Slow path: Clear and rebuild batches from scratch
    this.opaqueBatches.clear();

    for (const renderable of opaqueRenderables) {
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
   * Updates only the instance data without recreating batch structures.
   * This is the fast path for when only transforms have changed.
   */
  private updateInstanceData(opaqueRenderables: Renderable[]): void {
    // Build a lookup map for O(1) instance placement
    const instanceLookup = new Map<number, InstanceData[]>();
    for (const batch of this.opaqueBatches.values()) {
      for (const [mesh, instances] of batch.meshMap.entries()) {
        instances.length = 0; // Clear for repopulation
        const key = this._combineIds(
          (batch.material as any).id,
          (mesh as any).id,
        );
        instanceLookup.set(key, instances);
      }
    }

    // Repopulate with current frame data using the lookup
    for (const r of opaqueRenderables) {
      const key = this._combineIds((r.material as any).id, (r.mesh as any).id);
      const instances = instanceLookup.get(key);
      if (instances) {
        instances.push({
          modelMatrix: r.modelMatrix,
          isUniformlyScaled: r.isUniformlyScaled,
          normalMatrix: r.normalMatrix,
        });
      }
    }
  }

  /**
   * Gets a pre-allocated Float32Array for instance data.
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
   * Mark batches as needing rebuild.
   */
  public invalidate(): void {
    this.batchesDirty = true;
  }
}
