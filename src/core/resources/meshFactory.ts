// src/core/resources/meshFactory.ts
import { AABB, Mesh } from "@/core/types/gpu";
import { MeshData } from "@/core/types/mesh";
import { createGPUBuffer } from "@/core/utils/webgpu";
import {
  initMikkTSpace,
  getMikkTSpaceModule,
} from "@/core/wasm/mikkTSpaceModule";
import { vec3 } from "wgpu-matrix";

const DEBUG_MESH_VALIDATION = true;

/**
 * Computes the axis-aligned bounding box from vertex positions.
 * @param positions Flattened array of vertex positions [x,y,z,x,y,z,...]
 * @returns AABB with min and max corners
 */
function computeAABB(positions: Float32Array): AABB {
  if (positions.length === 0) {
    return { min: vec3.create(0, 0, 0), max: vec3.create(0, 0, 0) };
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: vec3.create(minX, minY, minZ),
    max: vec3.create(maxX, maxY, maxZ),
  };
}

function validateMeshData(
  key: string,
  data: {
    positions: Float32Array;
    normals?: Float32Array;
    texCoords?: Float32Array;
    texCoords1?: Float32Array;
    tangents?: Float32Array;
    indices?: Uint16Array | Uint32Array;
  },
  vertexCount: number,
): void {
  if (!DEBUG_MESH_VALIDATION) return;
  console.group(`[MeshFactory] Validating mesh data for "${key}"`);

  // Check positions
  console.log(
    `Positions: ${data.positions.length} floats (${
      data.positions.length / 3
    } vertices)`,
  );
  if (data.positions.length !== vertexCount * 3) {
    console.error(
      `Position count mismatch! Expected ${vertexCount * 3}, got ${
        data.positions.length
      }`,
    );
  }

  // Check normals
  if (data.normals) {
    console.log(`Normals: ${data.normals.length} floats`);
    if (data.normals.length !== vertexCount * 3) {
      console.error(
        `Normal count mismatch! Expected ${vertexCount * 3}, got ${
          data.normals.length
        }`,
      );
    }
  }

  // Check UVs
  if (data.texCoords) {
    console.log(`TexCoords0: ${data.texCoords.length} floats`);
    if (data.texCoords.length !== vertexCount * 2) {
      console.error(
        `TexCoord0 count mismatch! Expected ${vertexCount * 2}, got ${
          data.texCoords.length
        }`,
      );
    }
  }

  // Check UV1s
  if (data.texCoords1 && data.texCoords1.length > 0) {
    console.log(`TexCoords1: ${data.texCoords1.length} floats`);
    if (data.texCoords1.length !== vertexCount * 2) {
      console.error(
        `TexCoord1 count mismatch! Expected ${vertexCount * 2}, got ${
          data.texCoords1.length
        }`,
      );
    }
  } else {
    console.log(`TexCoords1: Not provided.`);
  }

  // Check tangents
  if (data.tangents) {
    console.log(`Tangents: ${data.tangents.length} floats`);
    if (data.tangents.length !== vertexCount * 4) {
      console.error(
        `Tangent count mismatch! Expected ${vertexCount * 4}, got ${
          data.tangents.length
        }`,
      );
    }
  }

  // Check indices
  if (data.indices) {
    console.log(`Indices: ${data.indices.length}`);
    const maxIndex = Math.max(
      ...Array.from(data.indices.slice(0, Math.min(100, data.indices.length))),
    );
    if (maxIndex >= vertexCount) {
      console.error(
        `Index out of bounds! Max index ${maxIndex} >= vertex count ${vertexCount}`,
      );
    }
  }

  console.groupEnd();
}

/**
 * A stateless factory for creating Mesh objects from raw data.
 *
 * @remarks
 * It handles tangent generation using MikkTSpace, mesh validation, and the
 * creation of all necessary GPU vertex and index buffers. This class centralizes
 * the complex logic of converting abstract mesh data into a renderable format.
 */
export class MeshFactory {
  /**
   * Creates a new mesh from the given mesh data.
   *
   * @remarks
   * This is a low-level method that takes raw mesh data, processes it, and
   * creates the necessary GPU buffers. The processing includes:
   * - De-indexing geometry for MikkTSpace tangent generation.
   * - Generating tangents.
   * - Re-indexing the geometry to optimize vertex count.
   * - Creating and populating all required GPU vertex buffers.
   *
   * @param device The WebGPU device.
   * @param key A unique key to identify the mesh for debugging.
   * @param data The mesh data, including positions, normals, etc.
   * @returns A promise that resolves to the created mesh.
   */
  public static async createMesh(
    device: GPUDevice,
    key: string,
    data: MeshData,
  ): Promise<Mesh> {
    const hasTexCoords = data.texCoords && data.texCoords.length > 0;
    const hasNormals = data.normals && data.normals.length > 0;
    let canGenerateTangents =
      hasTexCoords && hasNormals && data.positions.length > 0;

    let finalPositions = data.positions;
    let finalNormals = data.normals;
    let finalTexCoords = data.texCoords;
    const finalTexCoords1 = data.texCoords1;
    let finalTangents: Float32Array | undefined;
    let finalIndices: Uint16Array | Uint32Array | undefined = data.indices;
    let finalVertexCount = data.positions.length / 3;

    if (canGenerateTangents) {
      const vertexCount = data.positions.length / 3;
      const hasValidNormals = data.normals?.length === vertexCount * 3;
      const hasValidTexCoords = data.texCoords?.length === vertexCount * 2;

      if (!hasValidNormals || !hasValidTexCoords) {
        console.warn(
          `[MeshFactory] Mesh "${key}" has invalid vertex data. Skipping tangent generation.`,
        );
        canGenerateTangents = false;
      } else if (data.indices && data.indices.length > 0) {
        // MikkTSpace requires de-indexed geometry.
        const indexCount = data.indices.length;
        const deindexedPositions = new Float32Array(indexCount * 3);
        const deindexedNormals = new Float32Array(indexCount * 3);
        const deindexedTexCoords = new Float32Array(indexCount * 2);

        for (let i = 0; i < indexCount; i++) {
          const index = data.indices[i];
          if (index >= vertexCount) {
            console.error(
              `[MeshFactory] Invalid index ${index} in mesh "${key}" (vertex count: ${vertexCount})`,
            );
            continue;
          }
          deindexedPositions.set(
            data.positions.subarray(index * 3, index * 3 + 3),
            i * 3,
          );
          deindexedNormals.set(
            data.normals!.subarray(index * 3, index * 3 + 3),
            i * 3,
          );
          deindexedTexCoords.set(
            data.texCoords!.subarray(index * 2, index * 2 + 2),
            i * 2,
          );
        }

        try {
          await initMikkTSpace();
          const MIKKTSPACE = getMikkTSpaceModule();
          if (!MIKKTSPACE) throw new Error("MikkTSpace library not available.");

          console.log(`[MeshFactory] Generating tangents for mesh "${key}"...`);
          const deindexedTangents = MIKKTSPACE.generateTangents(
            deindexedPositions,
            deindexedNormals,
            deindexedTexCoords,
          );

          // Re-index the geometry to reduce vertex count
          const vertexMap = new Map<string, number>();
          const uniquePositions: number[] = [];
          const uniqueNormals: number[] = [];
          const uniqueTexCoords: number[] = [];
          const uniqueTangents: number[] = [];
          const newIndices: number[] = [];

          for (let i = 0; i < indexCount; i++) {
            const p = deindexedPositions.subarray(i * 3, i * 3 + 3);
            const n = deindexedNormals.subarray(i * 3, i * 3 + 3);
            const t = deindexedTexCoords.subarray(i * 2, i * 2 + 2);
            const tan = deindexedTangents.subarray(i * 4, i * 4 + 4);

            const vertexKey =
              `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)},` +
              `${n[0].toFixed(4)},${n[1].toFixed(4)},${n[2].toFixed(4)},` +
              `${t[0].toFixed(6)},${t[1].toFixed(6)},` +
              `${tan[0].toFixed(4)},${tan[1].toFixed(4)},${tan[2].toFixed(
                4,
              )},${tan[3].toFixed(4)}`;

            let vertexIndex = vertexMap.get(vertexKey);
            if (vertexIndex === undefined) {
              vertexIndex = uniquePositions.length / 3;
              vertexMap.set(vertexKey, vertexIndex);
              uniquePositions.push(...p);
              uniqueNormals.push(...n);
              uniqueTexCoords.push(...t);
              uniqueTangents.push(...tan);
            }
            newIndices.push(vertexIndex);
          }

          finalPositions = new Float32Array(uniquePositions);
          finalNormals = new Float32Array(uniqueNormals);
          finalTexCoords = new Float32Array(uniqueTexCoords);
          finalTangents = new Float32Array(uniqueTangents);
          finalIndices =
            newIndices.length > 65536
              ? new Uint32Array(newIndices)
              : new Uint16Array(newIndices);
          finalVertexCount = finalPositions.length / 3;
        } catch (e) {
          console.error(
            `MikkTSpace failed for mesh "${key}". Falling back.`,
            e,
          );
          finalTangents = undefined;
        }
      } else {
        // Non-indexed geometry
        try {
          await initMikkTSpace();
          const MIKKTSPACE = getMikkTSpaceModule();
          if (MIKKTSPACE) {
            finalTangents = MIKKTSPACE.generateTangents(
              data.positions,
              data.normals!,
              data.texCoords!,
            );
          }
        } catch (e) {
          console.error(`MikkTSpace failed for non-indexed mesh "${key}".`, e);
        }
      }
    }

    if (!finalTangents) {
      console.warn(
        `[MeshFactory] Mesh "${key}" has no tangents. Creating default [1,0,0,1].`,
      );
      finalTangents = new Float32Array(finalVertexCount * 4);
      for (let i = 0; i < finalVertexCount; i++) {
        finalTangents.set([1.0, 0.0, 0.0, 1.0], i * 4);
      }
    }

    validateMeshData(
      key,
      {
        positions: finalPositions,
        normals: finalNormals,
        texCoords: finalTexCoords,
        texCoords1: finalTexCoords1,
        tangents: finalTangents,
        indices: finalIndices,
      },
      finalVertexCount,
    );

    const buffers: (GPUBuffer | undefined)[] = new Array(5);
    const layouts: (GPUVertexBufferLayout | undefined)[] = new Array(5);
    const aabb = computeAABB(data.positions);

    // Buffer 0: Position (shaderLocation: 0)
    buffers[0] = createGPUBuffer(
      device,
      finalPositions,
      GPUBufferUsage.VERTEX,
      `${key}-positions`,
    );
    layouts[0] = {
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex",
      attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
    };

    // Buffer 1: Normal (shaderLocation: 1)
    let normals = finalNormals;
    if (!normals || normals.length === 0) {
      normals = new Float32Array(finalVertexCount * 3);
      for (let i = 0; i < finalVertexCount; i++) normals[i * 3 + 1] = 1.0;
    }
    buffers[1] = createGPUBuffer(
      device,
      normals,
      GPUBufferUsage.VERTEX,
      `${key}-normals`,
    );
    layouts[1] = {
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex",
      attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
    };

    // Buffer 2: TexCoord0 (shaderLocation: 2)
    let texCoords = finalTexCoords;
    if (!texCoords || texCoords.length === 0) {
      texCoords = new Float32Array(finalVertexCount * 2);
    }
    buffers[2] = createGPUBuffer(
      device,
      texCoords,
      GPUBufferUsage.VERTEX,
      `${key}-texCoords0`,
    );
    layouts[2] = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex",
      attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
    };

    // Buffer 3: Tangent (shaderLocation: 3)
    buffers[3] = createGPUBuffer(
      device,
      finalTangents,
      GPUBufferUsage.VERTEX,
      `${key}-tangents`,
    );
    layouts[3] = {
      arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex",
      attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }],
    };

    // Buffer 4: TexCoord1 (shaderLocation: 9)
    let texCoords1 = finalTexCoords1;
    if (!texCoords1 || texCoords1.length === 0) {
      texCoords1 = new Float32Array(finalVertexCount * 2);
    }
    buffers[4] = createGPUBuffer(
      device,
      texCoords1,
      GPUBufferUsage.VERTEX,
      `${key}-texCoords1`,
    );
    layouts[4] = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      stepMode: "vertex",
      attributes: [{ shaderLocation: 9, offset: 0, format: "float32x2" }],
    };

    const finalBuffers = buffers.filter((b) => b !== undefined);
    const finalLayouts = layouts.filter((l) => l !== undefined);

    if (finalBuffers.length !== 5 || finalLayouts.length !== 5) {
      throw new Error(
        `[MeshFactory] Mesh "${key}" must have exactly 5 vertex buffers, got ${finalBuffers.length}`,
      );
    }

    console.log(`[MeshFactory] Created mesh "${key}" with vertex layout:`);
    for (let i = 0; i < finalLayouts.length; i++) {
      const layout = finalLayouts[i];
      const attrStr = layout.attributes
        .map((a) => `@location(${a.shaderLocation}) ${a.format}`)
        .join(", ");
      console.log(
        `  Buffer ${i}: stride=${layout.arrayStride}, attrs=[${attrStr}]`,
      );
    }

    const indexBuffer = finalIndices
      ? createGPUBuffer(
          device,
          finalIndices,
          GPUBufferUsage.INDEX,
          `${key}-indices`,
        )
      : undefined;

    return {
      buffers: finalBuffers,
      layouts: finalLayouts,
      vertexCount: finalVertexCount,
      indexBuffer,
      indexCount: finalIndices?.length,
      indexFormat: finalIndices instanceof Uint16Array ? "uint16" : "uint32",
      aabb,
    };
  }
}
