// src/loaders/primitiveMeshLoader.ts
import { IMeshLoader, MeshLoadResult } from "@/core/resources/mesh/meshLoader";
import {
  createConeMeshData,
  createCubeMeshData,
  createCylinderMeshData,
  createIcosphereMeshData,
  createPlaneMeshData,
  createTorusMeshData,
  createUvSphereMeshData,
} from "@/core/utils/primitives";

/**
 * Parses parameters from a primitive handle key.
 * Example: "size=2.5,sub=3" -> Map { "size": 2.5, "sub": 3 }
 */
function parsePrimParams(key: string): Map<string, number> {
  const params = new Map<string, number>();
  if (!key) return params;

  key.split(",").forEach((part) => {
    const [name, value] = part.split("=");
    if (name && value) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        params.set(name.trim(), numValue);
      }
    }
  });
  return params;
}

/**
 * Loader for procedural primitive meshes like cubes, spheres, etc.
 */
export class PrimitiveMeshLoader implements IMeshLoader {
  /**
   * Loads a single procedural primitive mesh.
   *
   * @remarks
   * This loader always returns a single MeshData object, which is compatible
   * with the MeshLoadResult type.
   *
   * @param path - The primitive definition (e.g., "cube:size=2").
   * @returns A promise that resolves to the MeshData for the primitive, or null.
   */
  public async load(path: string): Promise<MeshLoadResult | null> {
    const name = path.substring(0, path.indexOf(":"));
    const params = parsePrimParams(path.substring(path.indexOf(":") + 1));

    switch (name) {
      case "cube": {
        const size = params.get("size") ?? 1.0;
        return createCubeMeshData(size);
      }
      case "plane": {
        const size = params.get("size") ?? 1.0;
        return createPlaneMeshData(size);
      }
      case "icosphere": {
        const r = params.get("r") ?? 0.5;
        const sub = params.get("sub") ?? 2;
        return createIcosphereMeshData(r, sub);
      }
      case "uvsphere": {
        const r = params.get("r") ?? 0.5;
        const sub = params.get("sub") ?? 16;
        return createUvSphereMeshData(r, sub);
      }
      case "cylinder": {
        const r = params.get("r") ?? 0.5;
        const h = params.get("h") ?? 1.0;
        const sub = params.get("sub") ?? 32;
        return createCylinderMeshData(r, h, sub);
      }
      case "cone": {
        const r = params.get("r") ?? 0.5;
        const h = params.get("h") ?? 1.0;
        const sub = params.get("sub") ?? 32;
        return createConeMeshData(r, h, sub);
      }
      case "torus": {
        const r = params.get("r") ?? 0.5;
        const tube = params.get("tube") ?? 0.2;
        const rseg = params.get("rseg") ?? 16;
        const tseg = params.get("tseg") ?? 32;
        return createTorusMeshData(r, tube, rseg, tseg);
      }
      default:
        console.error(`[PrimitiveMeshLoader] Unknown primitive type: ${name}`);
        return null;
    }
  }
}
