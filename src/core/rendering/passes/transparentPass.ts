// src/core/rendering/passes/transparentPass.ts
import { Renderable } from "@/core/types/gpu";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import { Vec3, vec3 } from "wgpu-matrix";
import { Renderer } from "@/core/renderer";

export class TransparentPass {
  private tempVec3A: Vec3 = vec3.create();
  private tempVec3B: Vec3 = vec3.create();
  private tempCameraPos: Vec3 = vec3.create();

  public record(
    passEncoder: GPURenderPassEncoder,
    renderables: Renderable[],
    camera: CameraComponent,
    instanceBuffer: GPUBuffer,
    instanceBufferOffset: number,
    frameInstanceData: Float32Array,
    frameBindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ): number {
    if (renderables.length === 0) return 0;

    this.tempCameraPos[0] = camera.inverseViewMatrix[12];
    this.tempCameraPos[1] = camera.inverseViewMatrix[13];
    this.tempCameraPos[2] = camera.inverseViewMatrix[14];

    renderables.sort((a, b) => {
      this.tempVec3A[0] = a.modelMatrix[12];
      this.tempVec3A[1] = a.modelMatrix[13];
      this.tempVec3A[2] = a.modelMatrix[14];
      this.tempVec3B[0] = b.modelMatrix[12];
      this.tempVec3B[1] = b.modelMatrix[13];
      this.tempVec3B[2] = b.modelMatrix[14];
      const da = vec3.distanceSq(this.tempVec3A, this.tempCameraPos);
      const db = vec3.distanceSq(this.tempVec3B, this.tempCameraPos);
      return db - da;
    });

    const floatsPerInstance = (Renderer as any).INSTANCE_STRIDE_IN_FLOATS;
    const instanceDataView = new Float32Array(
      frameInstanceData.buffer,
      instanceBufferOffset,
      renderables.length * floatsPerInstance,
    );
    const instanceUintView = new Uint32Array(
      instanceDataView.buffer,
      instanceDataView.byteOffset,
    );

    for (let i = 0; i < renderables.length; i++) {
      const { modelMatrix, isUniformlyScaled, receiveShadows } = renderables[i];
      const floatOff = i * floatsPerInstance;
      const uintOff = floatOff;

      instanceDataView.set(modelMatrix, floatOff);

      const flags =
        (isUniformlyScaled ? 1 : 0) | (((receiveShadows ?? true) ? 1 : 0) << 1);
      instanceUintView[uintOff + 16] = flags;
    }

    passEncoder.device.queue.writeBuffer(
      instanceBuffer,
      instanceBufferOffset,
      instanceDataView,
    );

    let drawCalls = 0;
    let i = 0;
    while (i < renderables.length) {
      const { mesh, material } = renderables[i];
      const pipeline = material.material.getPipeline(
        mesh.layouts,
        Renderer.INSTANCE_DATA_LAYOUT,
        frameBindGroupLayout,
        canvasFormat,
        depthFormat,
      );

      let count = 1;
      while (
        i + count < renderables.length &&
        renderables[i + count].mesh === mesh &&
        renderables[i + count].material === material
      ) {
        count++;
      }

      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(1, material.bindGroup);

      for (let j = 0; j < mesh.buffers.length; j++) {
        passEncoder.setVertexBuffer(j, mesh.buffers[j]);
      }

      const groupByteOffset =
        instanceBufferOffset + i * (Renderer as any).INSTANCE_BYTE_STRIDE;
      passEncoder.setVertexBuffer(
        mesh.layouts.length,
        instanceBuffer,
        groupByteOffset,
      );

      if (mesh.indexBuffer) {
        passEncoder.drawIndexed(mesh.indexCount!, count, 0, 0, 0);
      } else {
        passEncoder.draw(mesh.vertexCount, count, 0, 0);
      }

      drawCalls++;
      i += count;
    }

    return drawCalls;
  }
}
