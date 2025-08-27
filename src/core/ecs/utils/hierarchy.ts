// src/core/ecs/utils/hierarchy.ts
import { HierarchyComponent } from "../components/hierarchyComponent";
import { Entity } from "../entity";
import { World } from "../world";

/**
 * Sets the parent of a child entity, correctly updating both the child's
 * and the parent's HierarchyComponents.
 * @param world The world containing the entities.
 * @param child The entity to become the child.
 * @param parent The entity to become the parent. Pass null to un-parent.
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
