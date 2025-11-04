// src/core/ecs/components/resources/materialSpecComponent.ts
import { IComponent } from "@/core/ecs/component";
import { PBRMaterialSpec } from "@/core/types/material";

/**
 * A component that holds the declarative specification for a PBR material.
 *
 * @remarks
 * This component is paired with a `MaterialResourceComponent` on an entity.
 * The `ResourceLoadingSystem` queries for this component to know what material
 * to load and instantiate.
 */
export class PBRMaterialSpecComponent implements IComponent {
  public spec: PBRMaterialSpec;

  /**
   * @param spec - The PBR material specification.
   */
  constructor(spec: PBRMaterialSpec) {
    this.spec = spec;
  }
}
