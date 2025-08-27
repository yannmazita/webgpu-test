// src/core/ecs/systems/transformSystem.ts
import { Mat4, mat4 } from "wgpu-matrix";
import { HierarchyComponent } from "../components/hierarchyComponent";
import { TransformComponent } from "../components/transformComponent";
import { Entity } from "../entity";
import { World } from "../world";

// src/core/ecs/systems/transformSystem.ts

// ...
export function transformSystem(world: World): void {
  const roots: Entity[] = [];
  const entities = world.query([TransformComponent]);

  // Find all root entities (those without a parent or without a hierarchy component)
  for (const entity of entities) {
    const hierarchy = world.getComponent(entity, HierarchyComponent);
    if (hierarchy?.parent === null) {
      roots.push(entity);
    }
  }

  // Recursively update transforms starting from the roots
  for (const root of roots) {
    updateNodeTransform(world, root, undefined, true, false);
  }
}

/**
 * A recursive helper function to update an entity's transform and its children.
 * @param world The world.
 * @param entity The entity to update.
 * @param parentWorldMatrix The world matrix of the parent.
 * @param parentIsUniformlyScaled Whether the parent has uniform scaling.
 * @param forceUpdate If true, update even if not dirty (e.g., because parent was dirty).
 */
function updateNodeTransform(
  world: World,
  entity: Entity,
  parentWorldMatrix: Mat4 | undefined,
  parentIsUniformlyScaled: boolean,
  forceUpdate: boolean,
): void {
  const transform = world.getComponent(entity, TransformComponent)!;
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
