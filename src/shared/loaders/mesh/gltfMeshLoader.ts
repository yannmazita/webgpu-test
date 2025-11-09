// src/loaders/gltfMeshLoader.ts
import { IMeshLoader, MeshLoadResult } from "@/shared/resources/mesh/meshLoader";
import { MeshData } from "@/shared/types/mesh";
import { initMeshopt } from "@/shared/wasm/meshoptimizerModule";
import {
  decodeMeshopt,
  dequantize,
  getAccessorData,
  GLTFPrimitive,
  loadGLTF,
  ParsedGLTF,
} from "@/shared/loaders/gltfLoader";

/**
 * Loader for meshes from glTF files.
 * Caches loaded GLTF files to avoid redundant network requests for the same file.
 */
export class GltfMeshLoader implements IMeshLoader {
  private gltfCache = new Map<string, Promise<ParsedGLTF>>();

  /**
   * Retrieves a parsed GLTF file from cache or loads it.
   *
   * @remarks
   * This method caches the promise of a loaded GLTF file to prevent redundant
   * network requests and parsing for the same file when multiple meshes are requested from it.
   *
   * @param url - The URL of the GLTF file.
   * @returns A promise that resolves to the parsed GLTF data.
   */
  private async getGltf(url: string): Promise<ParsedGLTF | null> {
    if (!this.gltfCache.has(url)) {
      this.gltfCache.set(
        url,
        loadGLTF(url).then((res) => res.parsedGltf),
      );
    }
    return this.gltfCache.get(url) ?? null;
  }

  /**
   * Loads mesh data from a GLTF file.
   *
   * @remarks
   * The path must include a mesh name (ie "url/to/model.gltf#MeshName").
   * This loader will load all primitives associated with the specified mesh.
   * If the mesh has only one primitive, it returns a single MeshData object.
   * If it has multiple primitives, it returns an array of MeshData objects.
   *
   * @param path - The resource path in the format "url#meshName".
   * @returns A promise that resolves to a MeshLoadResult, or null if loading fails.
   * @throws If the path does not include a mesh name.
   */
  public async load(path: string): Promise<MeshLoadResult | null> {
    const [url, meshName] = path.split("#");
    if (!meshName) {
      throw new Error(
        "GLTF mesh handle requires a mesh name: GLTF:url#meshName",
      );
    }

    const gltf = await this.getGltf(url);
    const gltfMesh = gltf?.json.meshes?.find((m) => m.name === meshName);

    if (!gltfMesh || gltfMesh.primitives.length === 0) {
      console.error(
        `Mesh "${meshName}" not found or has no primitives in ${url}`,
      );
      return null;
    }

    // Load ALL primitives for the mesh
    const primitivePromises = gltfMesh.primitives.map((primitive, index) => {
      if (gltf) {
        return this.extractPrimitiveData(
          gltf,
          primitive,
          `${path}-primitive-${index}`,
        );
      }
    });

    const meshDataArray = await Promise.all(primitivePromises);

    // If only one primitive, return it directly to maintain compatibility
    return meshDataArray.length === 1 ? meshDataArray[0] : meshDataArray;
  }

  /**
   * Extracts vertex and index data from a single glTF primitive.
   *
   * @remarks
   * This method handles both compressed (EXT_meshopt_compression) and uncompressed
   * primitives. It also performs dequantization if necessary.
   *
   * @param gltf - The complete parsed glTF asset.
   * @param primitive - The specific glTF primitive to process.
   * @param key - A unique key for debugging and error messages.
   * @returns A promise that resolves to the extracted MeshData.
   * @throws If the primitive is not indexed or missing required attributes.
   */
  private async extractPrimitiveData(
    gltf: ParsedGLTF,
    primitive: GLTFPrimitive,
    key: string,
  ): Promise<MeshData> {
    if (primitive.indices === undefined) {
      throw new Error(`GLTF primitive for mesh "${key}" must be indexed.`);
    }

    let positions: Float32Array | undefined;
    let normals: Float32Array | undefined;
    let texCoords: Float32Array | undefined;
    let texCoords1: Float32Array | undefined;
    let indices: Uint16Array | Uint32Array | undefined;

    const isCompressed = !!primitive.extensions?.EXT_meshopt_compression;

    if (isCompressed) {
      await initMeshopt();
      const decodedData = decodeMeshopt(gltf, primitive);
      indices = decodedData.indexData;
      if (!indices) {
        throw new Error(
          `Failed to decode indices for compressed GLTF primitive in "${key}".`,
        );
      }

      for (const [attributeName, rawData] of Object.entries(
        decodedData.vertexData,
      )) {
        const accessorIndex = primitive.attributes[attributeName];
        if (gltf.json.accessors) {
          const accessor = gltf.json.accessors[accessorIndex];
          let finalData: Float32Array;

          if (accessor.normalized) {
            finalData = dequantize(rawData, accessor);
          } else if (rawData instanceof Float32Array) {
            finalData = rawData;
          } else {
            finalData = new Float32Array(rawData);
          }

          switch (attributeName) {
            case "POSITION":
              positions = finalData;
              break;
            case "NORMAL":
              normals = finalData;
              break;
            case "TEXCOORD_0":
              texCoords = finalData;
              break;
            case "TEXCOORD_1":
              texCoords1 = finalData;
              break;
          }
        }
      }
    } else {
      const getAttribute = (
        attributeName: string,
      ): Float32Array | undefined => {
        const accessorIndex = primitive.attributes[attributeName];
        if (accessorIndex === undefined) return undefined;
        if (gltf.json.accessors) {
          const accessor = gltf.json.accessors[accessorIndex];
          const rawData = getAccessorData(gltf, accessorIndex);
          if (accessor.normalized) return dequantize(rawData, accessor);
          return rawData instanceof Float32Array
            ? rawData
            : new Float32Array(rawData);
        }
        return undefined;
      };

      positions = getAttribute("POSITION");
      normals = getAttribute("NORMAL");
      texCoords = getAttribute("TEXCOORD_0");
      texCoords1 = getAttribute("TEXCOORD_1");
      indices = getAccessorData(gltf, primitive.indices) as
        | Uint16Array
        | Uint32Array;
    }

    if (!positions) {
      throw new Error(
        `GLTF primitive in "${key}" must have POSITION attribute.`,
      );
    }

    return {
      positions: positions,
      normals: normals ?? new Float32Array(),
      texCoords: texCoords ?? new Float32Array(),
      texCoords1: texCoords1 ?? new Float32Array(),
      indices: indices,
    };
  }
}
