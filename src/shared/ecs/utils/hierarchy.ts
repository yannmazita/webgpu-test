// src/shared/ecs/utils/hierarchy.ts
import { HierarchyComponent } from "../components/gameplay/hierarchyComponent";
import { Entity } from "../entity";
import { World } from "../world";

/**
 * Establishes a parent-child relationship between two entities.
 *
 * This utility function correctly manages the `HierarchyComponent` on both the
 * child and parent entities. It handles adding `HierarchyComponent`s if they
' * don't exist, removing the child from its previous parent's list, and
 * adding it to the new parent's list. This ensures the scene graph remains
 * consistent.
 *
 * @param world The world containing the entities.
 * @param child The entity to be parented.
 * @param parent The entity to become the parent. If null, the child will be
 *     un-parented and become a root entity.
 */
export function setParent(
  world: World,
  child: Entity,
  parent: Entity | null,
): void {
  // Ensure child has a HierarchyComponent
  let childHierarchy = world.getComponent(child, HierarchyComponent);
  if (!childHierarchy) {
    childHierarchy = new HierarchyComponent();
    world.addComponent(child, childHierarchy);
  }

  // Remove from old parent's children list, if it exists
  if (childHierarchy.parent !== null) {
    const oldParentHierarchy = world.getComponent(
      childHierarchy.parent,
      HierarchyComponent,
    );
    if (oldParentHierarchy) {
      const index = oldParentHierarchy.children.indexOf(child);
      if (index > -1) {
        oldParentHierarchy.children.splice(index, 1);
      }
    }
  }

  // Set the new parent
  childHierarchy.parent = parent;

  // Add to new parent's children list
  if (parent !== null) {
    let parentHierarchy = world.getComponent(parent, HierarchyComponent);
    if (!parentHierarchy) {
      parentHierarchy = new HierarchyComponent();
      world.addComponent(parent, parentHierarchy);
    }
    if (!parentHierarchy.children.includes(child)) {
      parentHierarchy.children.push(child);
    }
  }
}
