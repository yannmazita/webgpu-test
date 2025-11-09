// src/shared/types/material.ts
import { PBRMaterialOptions } from "@/client/types/gpu";

/**
 * Defines the declarative specification for a PBR material.
 *
 * @remarks
 * This interface is used for creating materials from scene files or code,
 * providing a high-level description that can be resolved into a concrete
 * MaterialInstance.
 */
export interface PBRMaterialSpec {
  type: "PBR";
  options: PBRMaterialOptions;
}
