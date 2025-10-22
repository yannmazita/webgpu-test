// src/loaders/objMeshLoader.ts
import { IMeshLoader, MeshLoadResult } from "@/core/resources/mesh/meshLoader";
import { MeshData } from "@/core/types/mesh";
import { loadOBJ } from "@/loaders/objLoader";

/**
 * Loader for meshes in .obj format.
 */
export class ObjMeshLoader implements IMeshLoader {
  /**
   * Loads a single mesh from an OBJ file.
   *
   * @remarks
   * OBJ files are typically treated as a single mesh, so this loader
   * always returns a single MeshData object.
   *
   * @param url - The URL of the OBJ file.
   * @returns A promise that resolves to the MeshData for the OBJ file, or null.
   */
  public async load(url: string): Promise<MeshLoadResult | null> {
    const objGeometry = await loadOBJ(url);
    const meshData: MeshData = {
      positions: objGeometry.vertices,
      normals: objGeometry.normals,
      indices: objGeometry.indices,
      texCoords: objGeometry.uvs,
    };
    return meshData;
  }
}
