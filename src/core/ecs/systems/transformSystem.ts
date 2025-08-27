// src/core/ecs/systems/transformSystem.ts
import { Mat4, mat4 } from "wgpu-matrix";
import { HierarchyComponent } from "../components/hierarchyComponent";
import { TransformComponent } from "../components/transformComponent";
import { Entity } from "../entity";
import { World } from "../world";

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
      transform.scale[0] === transform.scale[1] &&
      transform.scale[1] === transform.scale[2];
    transform.isUniformlyScaled =
      parentIsUniformlyScaled && isLocalScaleUniform;

    // 4. Mark as clean
    transform.isDirty = false;
  }

  // Recursively update children, forcing an update if the parent was updated
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
