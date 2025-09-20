// src/core/ecs/systems/skeletonSystem.ts
import { mat4 } from "wgpu-matrix";
import { World } from "../world";
import { SkeletonComponent } from "../components/skeletonComponent";
import { TransformComponent } from "../components/transformComponent";
import { SkinnedMeshRendererComponent } from "../components/skinnedMeshRendererComponent";

const skinMatrix = mat4.identity();
const boneMatrices = new Float32Array(100 * 16); // Max 100 bones

/**
 * Updates the skinning matrices for all skeletons in the scene.
 * This system should be run after the `transformSystem` and before the
 * `renderSystem`.
 * @param world The ECS world.
 * @param device The GPU device.
 */
export function skeletonSystem(world: World, device: GPUDevice): void {
  const skeletons = world.query([SkeletonComponent]);

  for (const entity of skeletons) {
    const skeleton = world.getComponent(entity, SkeletonComponent)!;
    const skinnedMeshRenderers = world.query([SkinnedMeshRendererComponent]);

    for (const rendererEntity of skinnedMeshRenderers) {
      const skinnedMesh = world.getComponent(
        rendererEntity,
        SkinnedMeshRendererComponent,
      )!;
      if (skinnedMesh.skeletonRoot === entity) {
        for (let i = 0; i < skeleton.joints.length; i++) {
          const jointEntity = skeleton.joints[i];
          const jointTransform = world.getComponent(
            jointEntity,
            TransformComponent,
          );
          if (jointTransform) {
            mat4.multiply(
              jointTransform.worldMatrix,
              skeleton.inverseBindMatrices[i],
              skinMatrix,
            );
            boneMatrices.set(skinMatrix, i * 16);
          }
        }
        device.queue.writeBuffer(
          skinnedMesh.skinMatricesBuffer,
          0,
          boneMatrices,
          0,
          skeleton.joints.length * 16 * 4,
        );
      }
    }
  }
}
