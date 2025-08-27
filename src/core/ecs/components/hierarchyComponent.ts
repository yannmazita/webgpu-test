// src/core/ecs/components/hierarchyComponent.ts
import { IComponent } from "../component";
import { Entity } from "../entity";

export class HierarchyComponent implements IComponent {
  public parent: Entity | null = null;
  public children: Entity[] = [];
}
