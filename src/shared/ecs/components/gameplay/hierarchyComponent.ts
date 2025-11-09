// src/shared/ecs/components/gameplay/hierarchyComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { Entity } from "@/shared/ecs/entity";

export class HierarchyComponent implements IComponent {
  public parent: Entity | null = null;
  public children: Entity[] = [];
}
