// src/core/utils/primitives.ts
import { MeshData } from "@/core/types/mesh";

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

export function createSphereMeshData(
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

      const nx = px / radius;
      const ny = py / radius;
      const nz = pz / radius;
      normals.push(nx, ny, nz);

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
