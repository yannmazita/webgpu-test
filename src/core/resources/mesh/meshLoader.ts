// src/core/resources/mesh/meshLoader.ts
import { MeshData } from "@/core/types/mesh";

/**
 * A result that can contain one or more mesh data objects.
 * This allows loaders to return both single-mesh and multi-mesh results.
 */
export type MeshLoadResult = MeshData | MeshData[];

/**
 * Defines the contract for a mesh loader.
 * Loaders are responsible for parsing a resource path and returning raw MeshData.
 */
export interface IMeshLoader {
  /**
   * Loads mesh data from a given resource path or identifier.
   *
   * @remarks
   * The path is the part of the resource key after the prefix (ie "path/to/model.obj" or "cube:size=2").
   * The result can be either a single MeshData or an array of MeshData for multi-primitive meshes like glTF.
   *
   * @param path - The resource path or identifier.
   * @returns A promise that resolves to a MeshLoadResult, or null if loading fails.
   */
  load(path: string): Promise<MeshLoadResult | null>;
}
