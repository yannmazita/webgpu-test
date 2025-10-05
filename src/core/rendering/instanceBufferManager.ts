// src/core/rendering/instanceBufferManager.ts
import { Renderable } from "@/core/types/gpu";
import { Renderer } from "@/core/rendering/renderer";

export interface InstanceAllocation {
  offset: number; // in instances
  count: number;
}

export interface InstanceAllocations {
  shadows: InstanceAllocation;
  opaques: InstanceAllocation;
  transparents: InstanceAllocation;
  total: number;
}

/**
 * Manages the allocation, packing, and uploading of per-instance data to a
 * single GPU buffer for an entire frame.
 *
 * This class centralizes instance data handling to ensure a single owner and a
 * single GPU upload per frame, which is more efficient than multiple writes
 * from different render passes.
 */
export class InstanceBufferManager {
  private device: GPUDevice;
  private buffer!: GPUBuffer;
  private cpuBuffer!: Float32Array;
  private capacityInInstances = 0; // Current capacity of the buffers

  constructor(device: GPUDevice, initialCapacity = 1024) {
    this.device = device;
    this.ensureCapacity(initialCapacity);
  }

  /**
   * Returns the underlying GPU buffer.
   */
  public getBuffer(): GPUBuffer {
    return this.buffer;
  }

  /**
   * Ensures the CPU and GPU buffers are large enough for the required number of instances.
   * Recreates buffers if the required capacity exceeds the current capacity.
   * @param requiredInstances The total number of instances needed for the frame.
   */
  private ensureCapacity(requiredInstances: number): void {
    if (requiredInstances <= this.capacityInInstances) {
      return;
    }

    if (this.buffer) {
      this.buffer.destroy();
    }

    // Grow capacity with a 1.5x factor to reduce frequent reallocations
    this.capacityInInstances = Math.ceil(
      Math.max(requiredInstances, this.capacityInInstances) * 1.5,
    );

    const newByteSize =
      this.capacityInInstances * Renderer.INSTANCE_BYTE_STRIDE;
    this.buffer = this.device.createBuffer({
      label: "INSTANCE_DATA_BUFFER",
      size: newByteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.cpuBuffer = new Float32Array(
      this.capacityInInstances * Renderer.INSTANCE_STRIDE_IN_FLOATS,
    );
  }

  /**
   * Packs instance data for a list of renderables into the CPU buffer at a given offset.
   * @param renderables The list of renderables to pack.
   * @param instanceOffset The starting offset in the CPU buffer (in instances).
   */
  private packGroup(renderables: Renderable[], instanceOffset: number): void {
    const u32View = new Uint32Array(this.cpuBuffer.buffer);

    for (let i = 0; i < renderables.length; i++) {
      const renderable = renderables[i];
      const floatOffset =
        (instanceOffset + i) * Renderer.INSTANCE_STRIDE_IN_FLOATS;

      // Pack model matrix (16 floats)
      this.cpuBuffer.set(renderable.modelMatrix, floatOffset);

      // Pack flags (u32)
      const flags =
        (renderable.isUniformlyScaled ? 1 : 0) |
        ((renderable.receiveShadows !== false ? 1 : 0) << 1);
      u32View[floatOffset + 16] = flags;
    }
  }

  /**
   * Packs all instance data for the frame from categorized renderable lists
   * into a single CPU-side buffer and then uploads it to the GPU in one operation.
   *
   * @param shadows A list of renderables that cast shadows.
   * @param opaques A list of opaque renderables.
   * @param transparents A list of transparent renderables.
   * @returns An object containing the offset and count for each category.
   */
  public packAndUpload(
    shadows: Renderable[],
    opaques: Renderable[],
    transparents: Renderable[],
  ): InstanceAllocations {
    const totalInstances =
      shadows.length + opaques.length + transparents.length;
    this.ensureCapacity(totalInstances);

    let currentOffset = 0;

    // Pack shadows
    this.packGroup(shadows, currentOffset);
    const shadowAlloc: InstanceAllocation = {
      offset: currentOffset,
      count: shadows.length,
    };
    currentOffset += shadows.length;

    // Pack opaques
    this.packGroup(opaques, currentOffset);
    const opaqueAlloc: InstanceAllocation = {
      offset: currentOffset,
      count: opaques.length,
    };
    currentOffset += opaques.length;

    // Pack transparents
    this.packGroup(transparents, currentOffset);
    const transparentAlloc: InstanceAllocation = {
      offset: currentOffset,
      count: transparents.length,
    };

    // Perform a single upload to the GPU
    if (totalInstances > 0) {
      this.device.queue.writeBuffer(
        this.buffer,
        0,
        this.cpuBuffer.buffer,
        0,
        totalInstances * Renderer.INSTANCE_BYTE_STRIDE,
      );
    }

    return {
      shadows: shadowAlloc,
      opaques: opaqueAlloc,
      transparents: transparentAlloc,
      total: totalInstances,
    };
  }
}
