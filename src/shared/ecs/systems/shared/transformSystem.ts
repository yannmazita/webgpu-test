// src/shared/ecs/systems/transformSystem.ts
import { mat3, Mat3, Mat4, mat4 } from "wgpu-matrix";
import { HierarchyComponent } from "../../components/gameplay/hierarchyComponent";
import { TransformComponent } from "../../components/gameplay/transformComponent";
import { Entity } from "../../entity";
import { World } from "../../world";

/**
 * Updates the local and world matrices for all entities with a
 * TransformComponent.
 *
 * This system is responsible for calculating the final world-space position,
 * rotation, and scale of every object in the scene. It respects the scene
 * hierarchy, ensuring that child transforms are correctly combined with their
 * parent's. It starts from the root nodes of the hierarchy and recursively
 * updates all children. This system should be one of the first to run each
 * frame.
 *
 * @param world The world containing the entities.
 */
export function transformSystem(world: World): void {
  const roots: Entity[] = [];
  const entities = world.query([TransformComponent]);

  // Find all root entities (those without a parent or without a hierarchy component)
  for (const entity of entities) {
    const hierarchy = world.getComponent(entity, HierarchyComponent);
    if (!hierarchy || hierarchy.parent === null) {
      roots.push(entity);
    }
  }

  // Recursively update transforms starting from the roots
  for (const root of roots) {
    updateNodeTransform(world, root, undefined, true, false);
  }
}

function fastMat3Inverse(m: Mat3, out: Mat3): Mat3 {
  const a00 = m[0],
    a01 = m[1],
    a02 = m[2];
  const a10 = m[3],
    a11 = m[4],
    a12 = m[5];
  const a20 = m[6],
    a21 = m[7],
    a22 = m[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  const det = a00 * b01 + a01 * b11 + a02 * b21;

  if (!det) return out;

  const invDet = 1.0 / det;

  out[0] = b01 * invDet;
  out[1] = (-a22 * a01 + a02 * a21) * invDet;
  out[2] = (a12 * a01 - a02 * a11) * invDet;
  out[3] = b11 * invDet;
  out[4] = (a22 * a00 - a02 * a20) * invDet;
  out[5] = (-a12 * a00 + a02 * a10) * invDet;
  out[6] = b21 * invDet;
  out[7] = (-a21 * a00 + a01 * a20) * invDet;
  out[8] = (a11 * a00 - a01 * a10) * invDet;

  return out;
}

function updateNodeTransform(
  world: World,
  entity: Entity,
  parentWorldMatrix: Mat4 | undefined,
  parentIsUniformlyScaled: boolean,
  forceUpdate: boolean,
): void {
  const transform = world.getComponent(entity, TransformComponent);

  if (!transform) {
    return;
  }

  const hierarchy = world.getComponent(entity, HierarchyComponent);
  const needsUpdate = transform.isDirty || forceUpdate;

  if (needsUpdate) {
    // 1. Recompose local matrix from position, rotation, and scale
    mat4.fromQuat(transform.rotation, transform.localMatrix);
    mat4.scale(transform.localMatrix, transform.scale, transform.localMatrix);
    mat4.setTranslation(
      transform.localMatrix,
      transform.position,
      transform.localMatrix,
    );

    // 2. Calculate world matrix
    if (parentWorldMatrix) {
      mat4.multiply(
        parentWorldMatrix,
        transform.localMatrix,
        transform.worldMatrix,
      );
    } else {
      mat4.copy(transform.localMatrix, transform.worldMatrix);
    }

    // 3. Determine if the final scaling is uniform
    const isLocalScaleUniform =
      Math.abs(transform.scale[0] - transform.scale[1]) < 0.001 &&
      Math.abs(transform.scale[1] - transform.scale[2]) < 0.001;
    transform.isUniformlyScaled =
      parentIsUniformlyScaled && isLocalScaleUniform;

    // 4. Pre-compute normal matrix on CPU
    if (!transform.isUniformlyScaled) {
      // Extract upper 3x3 from world matrix
      const mat3Temp = mat3.create(
        transform.worldMatrix[0],
        transform.worldMatrix[1],
        transform.worldMatrix[2],
        transform.worldMatrix[4],
        transform.worldMatrix[5],
        transform.worldMatrix[6],
        transform.worldMatrix[8],
        transform.worldMatrix[9],
        transform.worldMatrix[10],
      );

      // Compute inverse transpose for normal matrix
      fastMat3Inverse(mat3Temp, transform.normalMatrix);
      mat3.transpose(transform.normalMatrix, transform.normalMatrix);
    }

    // 5. Mark as clean
    transform.isDirty = false;
  }

  // Recursively update children
  if (hierarchy) {
    for (const child of hierarchy.children) {
      updateNodeTransform(
        world,
        child,
        transform.worldMatrix,
        transform.isUniformlyScaled,
        needsUpdate,
      );
    }
  }
}
