// src/loaders/objLoader.ts
import { vec3 } from "wgpu-matrix";

/**
 * Defines the structure for geometry data loaded from an OBJ file.
 * All arrays are guaranteed to be present.
 */
export interface OBJGeometry {
  vertices: Float32Array; // Flattened [x,y,z,...]
  normals: Float32Array; // Flattened [nx,ny,nz,...]
  uvs: Float32Array; // Flattened [u,v,...]
  indices: Uint32Array; // Triangle indices
}

/**
 * Parses the text content of an OBJ file.
 *
 * @param text The text content of the .obj file.
 * @returns An OBJGeometry object.
 */
export const parseOBJ = (text: string): OBJGeometry => {
  // Temporary arrays to hold raw data from the file
  const temp_positions: number[][] = [];
  const temp_uvs: number[][] = [];
  const temp_normals: number[][] = [];

  // Final, unrolled arrays for the graphics pipeline
  const final_vertices: number[] = [];
  const final_uvs: number[] = [];
  const final_normals: number[] = [];
  const final_indices: number[] = [];

  // Map to cache unique vertex combinations (v/vt/vn) to a single index
  // This prevents duplicating vertex data unnecessarily for indexed drawing.
  const vertexCache = new Map<string, number>();
  let nextIndex = 0;

  const lines = text.split("\n");

  // First pass: gather all raw data (v, vt, vn)
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const type = parts.shift();

    switch (type) {
      case "v":
        temp_positions.push(parts.map(parseFloat));
        break;
      case "vt":
        temp_uvs.push(parts.map(parseFloat));
        break;
      case "vn":
        temp_normals.push(parts.map(parseFloat));
        break;
    }
  }

  const hasNormals = temp_normals.length > 0;

  // Second pass: process faces ('f') and build the final arrays
  for (const line of lines) {
    if (!line.startsWith("f ")) {
      continue;
    }

    const faceVertexStrings = line.trim().substring(2).split(/\s+/);

    // Triangulate the face if it's a polygon (ex: a quad)
    // using a simple fan triangulation.
    const triangleCount = faceVertexStrings.length - 2;
    for (let i = 0; i < triangleCount; i++) {
      const triangleFace = [
        faceVertexStrings[0],
        faceVertexStrings[i + 1],
        faceVertexStrings[i + 2],
      ];

      if (hasNormals) {
        // Path 1: The OBJ file has normals. Unroll vertices using the cache.
        for (const vertexString of triangleFace) {
          if (vertexCache.has(vertexString)) {
            final_indices.push(vertexCache.get(vertexString)!);
          } else {
            const indices = vertexString
              .split("/")
              .map((s) => parseInt(s, 10) - 1);
            const posIndex = indices[0];
            const uvIndex = indices[1]; // Can be NaN if format is v//vn
            const normIndex = indices[2];

            final_vertices.push(...temp_positions[posIndex]);

            // Handle missing UVs for a vertex (v//vn) or a file without any UVs
            if (temp_uvs.length > 0 && !isNaN(uvIndex)) {
              final_uvs.push(...temp_uvs[uvIndex]);
            } else {
              final_uvs.push(0, 0); // Default UV
            }

            final_normals.push(...temp_normals[normIndex]);

            vertexCache.set(vertexString, nextIndex);
            final_indices.push(nextIndex);
            nextIndex++;
          }
        }
      } else {
        // Path 2: The OBJ file has no normals. Calculate flat normals.
        // No caching is used here as vertices are duplicated for each face.
        const pIndices = triangleFace.map((v) => parseInt(v, 10) - 1);

        const p0 = vec3.fromValues(...temp_positions[pIndices[0]]);
        const p1 = vec3.fromValues(...temp_positions[pIndices[1]]);
        const p2 = vec3.fromValues(...temp_positions[pIndices[2]]);

        const v01 = vec3.subtract(p1, p0);
        const v02 = vec3.subtract(p2, p0);
        const normal = vec3.normalize(vec3.cross(v01, v02));

        final_vertices.push(...p0, ...p1, ...p2);
        final_normals.push(...normal, ...normal, ...normal);
        final_uvs.push(0, 0, 0, 0, 0, 0); // Default UVs
        final_indices.push(nextIndex, nextIndex + 1, nextIndex + 2);
        nextIndex += 3;
      }
    }
  }

  return {
    vertices: new Float32Array(final_vertices),
    normals: new Float32Array(final_normals),
    uvs: new Float32Array(final_uvs),
    indices: new Uint32Array(final_indices),
  };
};

/**
 * Fetches an OBJ file from a URL and parses it into geometry.
 *
 * @param url The URL of the .obj file.
 * @returns A promise that resolves to an OBJGeometry object.
 */
export const loadOBJ = async (url: string): Promise<OBJGeometry> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load OBJ file from ${url}: ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseOBJ(text);
};
