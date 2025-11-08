// src/client/rendering/batchManager.ts
import { Material } from "@/client/rendering/materials/material";
import { InstanceData, Mesh, Renderable } from "@/client/types/gpu";
import { MaterialInstance } from "../materials/materialInstance";

/**
 * A group of objects that can be drawn with a single instanced draw call.
 * They share the same mesh and material instance (and therefore the same pipeline).
 */
interface DrawGroup {
  materialInstance: MaterialInstance;
  mesh: Mesh;
  instances: InstanceData[];
}

/**
 * A collection of draw groups that all share the same render pipeline.
 */
export interface PipelineBatch {
  materialTemplate: Material;
  drawGroups: DrawGroup[];
}

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
  private readonly INSTANCE_STRIDE_IN_FLOATS = 20; // stride to match renderer

  // Track if batches need rebuilding
  private batchesDirty = true;
  private lastOpaqueSignature = new Map<string, number>();

  // --- Debugging ---
  private readonly DEBUG_BATCHING = false; // Set to true to log rebuilds
  private debugRebuildCounter = 0;

  constructor(initialCapacity = 100) {
    this.instanceDataPoolSize =
      initialCapacity * this.INSTANCE_STRIDE_IN_FLOATS;
    this.instanceDataPool = new Float32Array(this.instanceDataPoolSize);
  }

  /**
   * Generates a stable string key from material instance and mesh IDs.
   * This key uniquely identifies a DrawGroup.
   * @param materialInstanceId The ID of the unique material instance.
   * @param meshId The ID of the mesh.
   * @return A unique key for the draw group.
   */
  private _getDrawGroupKey(materialInstanceId: number, meshId: number): string {
    return `${materialInstanceId}-${meshId}`;
  }

  /**
   * Computes a canonical signature of the scene's opaque renderable structure.
   * The signature is a map of unique draw group keys to their instance counts.
   * @param renderables The list of renderables to analyze.
   * @return A map representing the scene structure.
   */
  private _computeOpaqueSignature(
    renderables: Renderable[],
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const r of renderables) {
      if (!r.mesh || !r.material) continue;
      const key = this._getDrawGroupKey(r.material.id, r.mesh.id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Checks if the structure of opaque renderables has changed since the last frame.
   * This is an optimization to avoid rebuilding batch data structures if only
   * object transforms have changed.
   * @param opaqueRenderables A list of opaque renderables.
   */
  public checkIfDirty(opaqueRenderables: Renderable[]): void {
    const newSignature = this._computeOpaqueSignature(opaqueRenderables);

    if (newSignature.size !== this.lastOpaqueSignature.size) {
      this.batchesDirty = true;
    } else {
      let areEqual = true;
      for (const [key, count] of newSignature) {
        if (this.lastOpaqueSignature.get(key) !== count) {
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
   *
   * This method groups renderable objects to optimize rendering performance.
   * It uses the `checkIfDirty` optimization to take a fast path when only
   * instance data (like transforms) needs updating, or a slow path to
   * completely rebuild the batch structure if the scene's composition has changed.
   *
   * @param allRenderables A list of all renderable objects for the frame.
   * @param getPipeline A function that retrieves or creates a render pipeline
   *  for a material and mesh.
   * @return A map of pipelines to their batches.
   */
  public getOpaqueBatches(
    allRenderables: Renderable[],
    getPipeline: (material: Material, mesh: Mesh) => GPURenderPipeline,
  ): Map<GPURenderPipeline, PipelineBatch> {
    const opaqueRenderables = allRenderables.filter(
      (r) => !r.material.material.isTransparent,
    );
    this.checkIfDirty(opaqueRenderables);

    if (!this.batchesDirty && this.opaqueBatches.size > 0) {
      // Fast path: Just update instance data without recreating batch structure.
      this.updateInstanceData(opaqueRenderables);
      return this.opaqueBatches;
    }

    // Slow path: Clear and rebuild batches from scratch.
    this.opaqueBatches.clear();

    for (const renderable of opaqueRenderables) {
      const { mesh, material, modelMatrix, isUniformlyScaled, receiveShadows } =
        renderable;
      const pipeline = getPipeline(material.material, mesh);

      let pipelineBatch = this.opaqueBatches.get(pipeline);
      if (!pipelineBatch) {
        pipelineBatch = {
          materialTemplate: material.material,
          drawGroups: [],
        };
        this.opaqueBatches.set(pipeline, pipelineBatch);
      }

      let drawGroup = pipelineBatch.drawGroups.find(
        (g) => g.mesh === mesh && g.materialInstance === material,
      );

      if (!drawGroup) {
        drawGroup = {
          mesh: mesh,
          materialInstance: material,
          instances: [],
        };
        pipelineBatch.drawGroups.push(drawGroup);
      }

      drawGroup.instances.push({
        modelMatrix,
        isUniformlyScaled,
        receiveShadows: receiveShadows !== false,
      });
    }

    this.batchesDirty = false;
    return this.opaqueBatches;
  }

  /**
   * Updates only the instance data within the existing batch structure.
   *
   * This is the "fast path" used when the scene's structure (the number and
   * type of objects) has not changed since the last frame. It avoids the
   * overhead of recreating the entire batch map and its arrays. The method
   * works by first clearing the `instances` array of each draw group and then
   * efficiently repopulating them with the current frame's transform data.
   *
   * @param opaqueRenderables The list of opaque renderables for the
   *     current frame.
   */
  private updateInstanceData(opaqueRenderables: Renderable[]): void {
    // 1. Clear all instance arrays within the existing batch structure.
    for (const pipelineBatch of this.opaqueBatches.values()) {
      for (const drawGroup of pipelineBatch.drawGroups) {
        drawGroup.instances.length = 0;
      }
    }

    // 2. Create a temporary lookup map for efficient repopulation.
    const groupLookup = new Map<string, DrawGroup>();
    for (const batch of this.opaqueBatches.values()) {
      for (const group of batch.drawGroups) {
        const key = this._getDrawGroupKey(
          group.materialInstance.id,
          (group.mesh as any).id,
        );
        groupLookup.set(key, group);
      }
    }

    // 3. Repopulate the cleared instance arrays with new data.
    for (const renderable of opaqueRenderables) {
      const { mesh, material, modelMatrix, isUniformlyScaled, receiveShadows } =
        renderable;

      const key = this._getDrawGroupKey(material.id, (mesh as any).id);
      const drawGroup = groupLookup.get(key);

      if (!drawGroup) {
        console.error(
          "BatchManager consistency error in updateInstanceData: DrawGroup not found.",
          "This indicates a mismatch with checkIfDirty logic.",
        );
        continue;
      }

      // Add the new instance data to the group.
      drawGroup.instances.push({
        modelMatrix,
        isUniformlyScaled,
        receiveShadows: receiveShadows !== false,
      });
    }
  }

  /**
   * Gets a pre-allocated Float32Array for instance data.
   *
   * @param size The number of instances to allocate space for.
   * @return A Float32Array view with the requested size.
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
   * Marks the batches as dirty, forcing a rebuild on the next frame.
   */
  public invalidate(): void {
    this.batchesDirty = true;
  }
}
