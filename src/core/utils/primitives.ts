// src/core/utils/primitives.ts
import { MeshData } from "@/core/types/mesh";

/**
 * Creates the mesh data for a cube.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a cube of a given size.
 *
 * @param size The size of the cube.
 * @returns The mesh data for the cube.
 */
export function createCubeMeshData(size = 1.0): MeshData {
  const s = size / 2;

  // prettier-ignore
  const positions = new Float32Array([
    // Front face
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    // Back face
    -s, -s, -s, -s, s, -s, s, s, -s, s, -s, -s,
    // Top face
    -s, s, -s, -s, s, s, s, s, s, s, s, -s,
    // Bottom face
    -s, -s, -s, s, -s, -s, s, -s, s, -s, -s, s,
    // Right face
    s, -s, -s, s, s, -s, s, s, s, s, -s, s,
    // Left face
    -s, -s, -s, -s, -s, s, -s, s, s, -s, s, -s,
  ]);

  // prettier-ignore
  const normals = new Float32Array([
    // Front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  // prettier-ignore
  const texCoords = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1, // front
    0, 0, 1, 0, 1, 1, 0, 1, // back
    0, 0, 1, 0, 1, 1, 0, 1, // top
    0, 0, 1, 0, 1, 1, 0, 1, // bottom
    0, 0, 1, 0, 1, 1, 0, 1, // right
    0, 0, 1, 0, 1, 1, 0, 1, // left
  ]);

  // prettier-ignore
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // front
    4, 5, 6, 4, 6, 7, // back
    8, 9, 10, 8, 10, 11, // top
    12, 13, 14, 12, 14, 15, // bottom
    16, 17, 18, 16, 18, 19, // right
    20, 21, 22, 20, 22, 23, // left
  ]);

  return { positions, normals, texCoords, indices };
}

/**
 * Creates the mesh data for a plane.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a plane of a given size.
 *
 * @param size The size of the plane.
 * @returns The mesh data for the plane.
 */
export function createPlaneMeshData(size = 1.0): MeshData {
  const s = size / 2;

  // prettier-ignore
  const positions = new Float32Array([
    -s, 0, -s,  s, 0, -s,  s, 0, s,  -s, 0, s
  ]);

  // All normals point up
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);

  // UV mapping
  const texCoords = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

  // Indices
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  return { positions, normals, texCoords, indices };
}

/**
 * Creates the mesh data for a UV sphere.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a UV sphere of a given radius and number of subdivisions.
 *
 * @param radius The radius of the sphere.
 * @param subdivisions The number of subdivisions.
 * @returns The mesh data for the sphere.
 */
export function createUvSphereMeshData(
  radius = 0.5,
  subdivisions = 16,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= subdivisions; y++) {
    const v = y / subdivisions;
    const theta = v * Math.PI;

    for (let x = 0; x <= subdivisions; x++) {
      const u = x / subdivisions;
      const phi = u * Math.PI * 2;

      const px = -radius * Math.cos(phi) * Math.sin(theta);
      const py = radius * Math.cos(theta);
      const pz = radius * Math.sin(phi) * Math.sin(theta);

      positions.push(px, py, pz);
      normals.push(px / radius, py / radius, pz / radius);
      texCoords.push(u, v);
    }
  }

  for (let y = 0; y < subdivisions; y++) {
    for (let x = 0; x < subdivisions; x++) {
      const i0 = y * (subdivisions + 1) + x;
      const i1 = i0 + 1;
      const i2 = i0 + (subdivisions + 1);
      const i3 = i2 + 1;

      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
  };
}

/**
 * Creates the mesh data for an icosphere.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for an icosphere of a given radius and number of subdivisions.
 * An icosphere is a sphere made of triangles that are more evenly distributed
 * than in a UV sphere.
 *
 * @param radius The radius of the sphere.
 * @param subdivisions The number of subdivisions.
 * @returns The mesh data for the sphere.
 */
export function createIcosphereMeshData(
  radius = 0.5,
  subdivisions = 2,
): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;

  // Initial icosahedron vertices
  const verts: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];

  // Normalize to unit sphere
  function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  const vertices = verts.map((v) => normalize(v));

  // Initial icosahedron faces
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  // Midpoint cache to avoid duplicate vertices
  const midpointCache = new Map<string, number>();
  function getMidpoint(a: number, b: number): number {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (midpointCache.has(key)) return midpointCache.get(key)!;

    const va = vertices[a];
    const vb = vertices[b];
    const mid: [number, number, number] = normalize([
      (va[0] + vb[0]) / 2,
      (va[1] + vb[1]) / 2,
      (va[2] + vb[2]) / 2,
    ]);

    const index = vertices.length;
    vertices.push(mid);
    midpointCache.set(key, index);
    return index;
  }

  // Subdivide faces
  for (let i = 0; i < subdivisions; i++) {
    const newFaces: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);

      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }

  // Build mesh data
  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const indices: number[] = [];

  for (const v of vertices) {
    const nx = v[0],
      ny = v[1],
      nz = v[2];
    positions.push(nx * radius, ny * radius, nz * radius);
    normals.push(nx, ny, nz);

    // crude spherical UV projection
    const u = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
    const vTex = 0.5 - Math.asin(ny) / Math.PI;
    texCoords.push(u, vTex);
  }

  for (const [a, b, c] of faces) {
    indices.push(a, b, c);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
  };
}

/**
 * Creates the mesh data for a cylinder.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a cylinder of a given radius, height, and number of
 * subdivisions.
 *
 * @param radius The radius of the cylinder.
 * @param height The height of the cylinder.
 * @param subdivisions The number of subdivisions.
 * @returns The mesh data for the cylinder.
 */
export function createCylinderMeshData(
  radius = 0.5,
  height = 1.0,
  subdivisions = 32,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const indices: number[] = [];

  const halfHeight = height / 2;

  for (let i = 0; i <= subdivisions; i++) {
    const theta = (i / subdivisions) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const x = cos * radius;
    const z = sin * radius;

    // Top vertex
    positions.push(x, halfHeight, z);
    normals.push(cos, 0, sin);
    texCoords.push(i / subdivisions, 1);

    // Bottom vertex
    positions.push(x, -halfHeight, z);
    normals.push(cos, 0, sin);
    texCoords.push(i / subdivisions, 0);
  }

  for (let i = 0; i < subdivisions * 2; i += 2) {
    indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
  };
}

/**
 * Creates the mesh data for a cone.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a cone of a given radius, height, and number of
 * subdivisions.
 *
 * @param radius The radius of the cone.
 * @param height The height of the cone.
 * @param subdivisions The number of subdivisions.
 * @returns The mesh data for the cone.
 */
export function createConeMeshData(
  radius = 0.5,
  height = 1.0,
  subdivisions = 32,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const indices: number[] = [];

  const halfHeight = height / 2;

  // Tip vertex
  positions.push(0, halfHeight, 0);
  normals.push(0, 1, 0);
  texCoords.push(0.5, 1);

  for (let i = 0; i <= subdivisions; i++) {
    const theta = (i / subdivisions) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const x = cos * radius;
    const z = sin * radius;

    positions.push(x, -halfHeight, z);
    normals.push(cos, 0, sin);
    texCoords.push(i / subdivisions, 0);
  }

  for (let i = 1; i <= subdivisions; i++) {
    indices.push(0, i, i + 1);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
  };
}

/**
 * Creates the mesh data for a torus.
 *
 * This function generates the vertex positions, normals, texture coordinates,
 * and indices for a torus of a given radius, tube radius, and number of
 * segments.
 *
 * @param radius The radius of the torus.
 * @param tube The radius of the tube.
 * @param radialSegments The number of radial segments.
 * @param tubularSegments The number of tubular segments.
 * @returns The mesh data for the torus.
 */
export function createTorusMeshData(
  radius = 0.5,
  tube = 0.2,
  radialSegments = 16,
  tubularSegments = 32,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * Math.PI * 2;
    const cosV = Math.cos(v);
    const sinV = Math.sin(v);

    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * Math.PI * 2;

      const cosU = Math.cos(u);
      const sinU = Math.sin(u);

      const x = (radius + tube * cosV) * cosU;
      const y = (radius + tube * cosV) * sinU;
      const z = tube * sinV;

      positions.push(x, z, y);

      const nx = cosU * cosV;
      const ny = sinU * cosV;
      const nz = sinV;
      normals.push(nx, nz, ny);

      texCoords.push(i / tubularSegments, j / radialSegments);
    }
  }

  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
  };
}
