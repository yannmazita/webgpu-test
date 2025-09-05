// src/loaders/stlLoader.ts
import { Vec3, vec3 } from "wgpu-matrix";

export interface STLGeometry {
  vertices: Float32Array; // flattened [x,y,z,...]
  normals: Float32Array; // flattened [nx,ny,nz,...]
  indices: Uint32Array; // triangle indices
}

/**
 * Parses the contents of an STL file.
 *
 * This function detects whether the STL file is in ASCII or binary format
 * and calls the appropriate parser.
 *
 * @param arrayBuffer The contents of the STL file.
 * @returns The parsed STL geometry.
 */
export const parseSTL = (arrayBuffer: ArrayBuffer): STLGeometry => {
  const dv = new DataView(arrayBuffer);

  const isASCII = (): boolean => {
    const decoder = new TextDecoder("utf-8");
    const header = decoder.decode(dv.buffer.slice(0, 80));
    return header.toLowerCase().includes("solid");
  };

  return isASCII()
    ? parseASCII(new TextDecoder("utf-8").decode(arrayBuffer))
    : parseBinary(dv);
};

const parseBinary = (dv: DataView): STLGeometry => {
  const triangles = dv.getUint32(80, true);
  let offset = 84;

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < triangles; i++) {
    // Normal
    const nx = dv.getFloat32(offset, true);
    const ny = dv.getFloat32(offset + 4, true);
    const nz = dv.getFloat32(offset + 8, true);
    offset += 12;

    const baseIndex = vertices.length / 3;

    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(offset, true);
      const y = dv.getFloat32(offset + 4, true);
      const z = dv.getFloat32(offset + 8, true);
      vertices.push(x, y, z);
      normals.push(nx, ny, nz);
      indices.push(baseIndex + v);
      offset += 12;
    }

    // Skip attribute byte count
    offset += 2;
  }

  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
};

const parseASCII = (text: string): STLGeometry => {
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const vertexPattern =
    /vertex\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)/g;
  const facetPattern =
    /facet\s+normal\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)/g;

  let vertexMatch: RegExpExecArray | null;
  let facetMatch: RegExpExecArray | null;

  let currentNormal: Vec3 = vec3.create();

  while ((facetMatch = facetPattern.exec(text)) !== null) {
    currentNormal = vec3.fromValues(
      parseFloat(facetMatch[1]),
      parseFloat(facetMatch[2]),
      parseFloat(facetMatch[3]),
    );

    // collect 3 vertices for this facet
    const baseIndex = vertices.length / 3;
    for (let i = 0; i < 3; i++) {
      vertexMatch = vertexPattern.exec(text);
      if (!vertexMatch) break;

      vertices.push(
        parseFloat(vertexMatch[1]),
        parseFloat(vertexMatch[2]),
        parseFloat(vertexMatch[3]),
      );
      normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
      indices.push(baseIndex + i);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
};

/**
 * Fetches an STL file from a URL and parses it into geometry.
 * @param url The URL of the .stl file.
 * @returns A promise that resolves to the parsed STL geometry.
 */
export const loadSTL = async (url: string): Promise<STLGeometry> => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return parseSTL(buffer);
};
