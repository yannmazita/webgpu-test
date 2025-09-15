// src/loaders/gltfLoader.ts

// --- GLTF 2.0 Type Definitions ---
// Based on the official specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

export interface GLTF {
  asset: { version: string; [k: string]: any };
  scenes?: GLTFScene[];
  scene?: number;
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  materials?: GLTFMaterial[];
  accessors?: GLTFAccessor[];
  bufferViews?: GLTFBufferView[];
  buffers?: GLTFBuffer[];
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  samplers?: GLTFSampler[];
  animations?: GLTFAnimation[];
}

export interface GLTFScene {
  name?: string;
  nodes: number[];
}

export interface GLTFNode {
  name?: string;
  mesh?: number;
  camera?: number;
  skin?: number;
  matrix?: number[];
  rotation?: [number, number, number, number]; // Quaternion
  scale?: [number, number, number];
  translation?: [number, number, number];
  children?: number[];
}

export interface GLTFMesh {
  name?: string;
  primitives: GLTFPrimitive[];
}

export interface GLTFPrimitive {
  attributes: { [name: string]: number }; // like { "POSITION": 1, "NORMAL": 2 }
  indices?: number;
  material?: number;
  mode?: number; // 4 = TRIANGLES
}

export interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number; texCoord?: number };
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: { index: number; texCoord?: number };
  };
  normalTexture?: { index: number; scale?: number; texCoord?: number };
  occlusionTexture?: { index: number; strength?: number; texCoord?: number };
  emissiveTexture?: { index: number; texCoord?: number };
  emissiveFactor?: [number, number, number];
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  doubleSided?: boolean;
}

export interface GLTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number; // 5120: BYTE, 5121: UNSIGNED_BYTE, 5122: SHORT, 5123: UNSIGNED_SHORT, 5125: UNSIGNED_INT, 5126: FLOAT
  normalized?: boolean;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
  max?: number[];
  min?: number[];
}

export interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export interface GLTFBuffer {
  uri?: string;
  byteLength: number;
}

export interface GLTFTexture {
  sampler?: number;
  source?: number;
}

export interface GLTFImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

export interface GLTFSampler {
  magFilter?: number; // 9728: NEAREST, 9729: LINEAR
  minFilter?: number; // 9728: NEAREST, 9729: LINEAR, 9984: NEAREST_MIPMAP_NEAREST, etc.
  wrapS?: number; // 10497: REPEAT
  wrapT?: number; // 10497: REPEAT
}

export interface GLTFAnimationSampler {
  input: number; // accessor index (keyframe times)
  output: number; // accessor index (keyframe values)
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
}

export interface GLTFAnimation {
  name?: string;
  channels: GLTFAnimationChannel[];
  samplers: GLTFAnimationSampler[];
}

export interface GLTFAnimationChannel {
  sampler: number; // index into animations.samplers
  target: {
    node?: number; // node index
    path: "translation" | "rotation" | "scale" | "weights";
  };
}

// --- Parser Implementation ---

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN"

export interface ParsedGLTF {
  json: GLTF;
  buffers: ArrayBuffer[];
}

/**
 * Parses a glTF file (.gltf or .glb) from an ArrayBuffer.
 * @param data The ArrayBuffer containing the file data.
 * @param baseUri The base URI for resolving external resources (like .bin files or images).
 * @returns A promise that resolves to the parsed glTF structure.
 */
export async function parseGLTF(
  data: ArrayBuffer,
  baseUri: string,
): Promise<ParsedGLTF> {
  const dataView = new DataView(data);
  const magic = dataView.getUint32(0, true);

  let json: GLTF;
  let binaryBuffer: ArrayBuffer | undefined;

  if (magic === GLB_MAGIC) {
    // --- Parse GLB container format ---
    const version = dataView.getUint32(4, true);
    if (version !== 2) {
      throw new Error("Unsupported GLB version");
    }

    let chunkOffset = 12; // Header size
    // First chunk: JSON
    const jsonChunkLength = dataView.getUint32(chunkOffset, true);
    const jsonChunkType = dataView.getUint32(chunkOffset + 4, true);
    if (jsonChunkType !== CHUNK_TYPE_JSON) {
      throw new Error("First GLB chunk must be JSON");
    }
    const jsonBytes = new Uint8Array(data, chunkOffset + 8, jsonChunkLength);
    const jsonString = new TextDecoder("utf-8").decode(jsonBytes);
    json = JSON.parse(jsonString);
    chunkOffset += 8 + jsonChunkLength;

    // Second chunk (optional): BIN
    if (chunkOffset < dataView.byteLength) {
      const binChunkLength = dataView.getUint32(chunkOffset, true);
      const binChunkType = dataView.getUint32(chunkOffset + 4, true);
      if (binChunkType !== CHUNK_TYPE_BIN) {
        throw new Error("Expected BIN chunk after JSON chunk");
      }
      binaryBuffer = data.slice(
        chunkOffset + 8,
        chunkOffset + 8 + binChunkLength,
      );
    }
  } else {
    // --- Assume .gltf (JSON) file ---
    const jsonString = new TextDecoder("utf-8").decode(data);
    json = JSON.parse(jsonString);
  }

  // --- Load all buffers (external .bin or embedded) ---
  const buffers: ArrayBuffer[] = [];
  if (json.buffers) {
    for (let i = 0; i < json.buffers.length; i++) {
      const bufferInfo = json.buffers[i];
      if (bufferInfo.uri) {
        // External buffer
        const url = new URL(bufferInfo.uri, baseUri).href;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch GLTF buffer: ${url}`);
        }
        buffers.push(await response.arrayBuffer());
      } else if (i === 0 && binaryBuffer) {
        // Embedded GLB buffer
        buffers.push(binaryBuffer);
      } else {
        throw new Error("Unsupported buffer configuration");
      }
    }
  }

  return { json, buffers };
}

// --- Data Accessor Helpers ---

const COMPONENT_TYPE_MAP = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

const TYPE_COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * Retrieves the data for a given accessor as a TypedArray.
 * This function handles both tightly packed and strided buffer views.
 * @param parsedGltf The parsed glTF object.
 * @param accessorIndex The index of the accessor to retrieve data for.
 * @returns A TypedArray containing the accessor's data.
 */
export function getAccessorData(
  parsedGltf: ParsedGLTF,
  accessorIndex: number,
): Float32Array | Uint32Array | Uint16Array {
  const { json, buffers } = parsedGltf;
  const accessor = json.accessors![accessorIndex];

  const TypedArrayConstructor = COMPONENT_TYPE_MAP[accessor.componentType] as
    | typeof Float32Array
    | typeof Uint32Array
    | typeof Uint16Array;
  if (!TypedArrayConstructor) {
    throw new Error(`Unsupported componentType: ${accessor.componentType}`);
  }

  if (accessor.bufferView === undefined) {
    // Sparse accessor or empty accessor. Not supported yet, return empty.
    return new TypedArrayConstructor();
  }

  const bufferView = json.bufferViews![accessor.bufferView];
  const buffer = buffers[bufferView.buffer];
  const numComponents = TYPE_COMPONENT_COUNT[accessor.type];
  const elementSizeInBytes =
    numComponents * TypedArrayConstructor.BYTES_PER_ELEMENT;
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  // Handle strided data
  if (bufferView.byteStride && bufferView.byteStride !== elementSizeInBytes) {
    const destArray = new TypedArrayConstructor(accessor.count * numComponents);
    const srcBytes = new Uint8Array(buffer);
    const destBytes = new Uint8Array(destArray.buffer);
    const stride = bufferView.byteStride;

    for (let i = 0; i < accessor.count; i++) {
      const srcElementOffset = byteOffset + i * stride;
      const destElementOffset = i * elementSizeInBytes;
      const elementData = srcBytes.subarray(
        srcElementOffset,
        srcElementOffset + elementSizeInBytes,
      );
      destBytes.set(elementData, destElementOffset);
    }
    return destArray;
  } else {
    // Tightly packed data
    const elementCount = accessor.count * numComponents;
    return new TypedArrayConstructor(buffer, byteOffset, elementCount);
  }
}

/**
 * Fetches and parses a glTF file.
 * @param url The URL of the .gltf or .glb file.
 * @returns A promise that resolves to the parsed glTF structure and its base URI.
 */
export async function loadGLTF(
  url: string,
): Promise<{ parsedGltf: ParsedGLTF; baseUri: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load GLTF file from ${url}: ${response.statusText}`,
    );
  }
  const data = await response.arrayBuffer();
  // Use the final URL after any redirects as the base for relative paths
  const baseUri = response.url;
  const parsedGltf = await parseGLTF(data, baseUri);
  return { parsedGltf, baseUri };
}
