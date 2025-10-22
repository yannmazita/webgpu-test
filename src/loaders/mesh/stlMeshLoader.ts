// src/loaders/stlMeshLoader.ts
import { IMeshLoader, MeshLoadResult } from "@/core/resources/mesh/meshLoader";
import { MeshData } from "@/core/types/mesh";
import { loadSTL } from "@/loaders/stlLoader";

/**
 * Loader for meshes in .stl format.
 */
export class StlMeshLoader implements IMeshLoader {
  /**
   * Loads a single mesh from an STL file.
   *
   * @remarks
   * STL files are always a single mesh, so this loader
   * always returns a single MeshData object.
   *
   * @param url - The URL of the STL file.
   * @returns A promise that resolves to the MeshData for the STL file, or null.
   */
  public async load(url: string): Promise<MeshLoadResult | null> {
    const stlGeometry = await loadSTL(url);
    const meshData: MeshData = {
      positions: stlGeometry.vertices,
      normals: stlGeometry.normals,
      indices: stlGeometry.indices,
    };
    return meshData;
  }
}
