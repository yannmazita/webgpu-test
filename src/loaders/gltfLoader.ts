// src/loaders/gltfLoader.ts
import { TypedArray } from "@/core/types/gpu";
import { getMeshoptDecoder } from "@/core/wasm/meshoptimizerModule";

/**
 * Decodes a glTF primitive compressed with the EXT_meshopt_compression
 * extension.
 *
 * @remarks
 * This function targets primitives that have been processed with the
 * meshoptimizer tool. It reads the single compressed data stream referenced by
 * the extension and uses the meshoptimizer WASM library to decompress all
 * vertex attributes and indices.
 *
 * It is a prerequisite that `initMeshopt()` has been successfully called and
 * awaited before invoking this function. The returned vertex data is raw and
 * may still be quantized (e.g., as `Int8Array` for normals). The caller is
 * responsible for any subsequent dequantization.
 *
 * @param gltf The parsed glTF asset, containing the JSON structure and binary
 *     buffers.
 * @param primitive The glTF primitive object that includes the
 *     `EXT_meshopt_compression` extension.
 * @returns The decoded mesh data, with properties for `indexData` and `vertexData`.
 * @throws If the meshoptimizer decoder has not been initialized, if the
 *     provided primitive does not contain the required extension, or if the glTF
 *     data is malformed.
 */
export function decodeMeshopt(
  gltf: ParsedGLTF,
  primitive: GLTFPrimitive,
): {
  indexData: Uint16Array | Uint32Array | undefined;
  vertexData: Record<string, TypedArray>;
} {
  const meshoptDecoder = getMeshoptDecoder();
  if (!meshoptDecoder) {
    throw new Error(
      "Meshopt decoder is not available. Was initMeshopt() called and awaited?",
    );
  }

  // Ensure extension and required glTF arrays exist
  const extension = primitive.extensions?.EXT_meshopt_compression;
  if (!extension) {
    throw new Error(
      "Called decodeMeshopt on a primitive without EXT_meshopt_compression extension.",
    );
  }
  if (!gltf.json.bufferViews) {
    throw new Error("gltf.json.bufferViews is missing, cannot decode mesh.");
  }
  if (!gltf.json.accessors) {
    throw new Error("gltf.json.accessors is missing, cannot decode mesh.");
  }

  const bufferView = gltf.json.bufferViews[extension.buffer];
  if (!bufferView) {
    throw new Error(
      `Invalid bufferView index ${extension.buffer} in Meshopt extension.`,
    );
  }

  const buffer = gltf.buffers[bufferView.buffer];
  const source = new Uint8Array(
    buffer,
    (bufferView.byteOffset ?? 0) + (extension.byteOffset ?? 0),
    extension.byteLength,
  );

  const result: {
    indexData: Uint16Array | Uint32Array | undefined;
    vertexData: Record<string, TypedArray>;
  } = {
    indexData: undefined,
    vertexData: {},
  };

  // Decode indices if present
  if (primitive.indices !== undefined) {
    const indicesAccessor = gltf.json.accessors[primitive.indices];
    if (!indicesAccessor) {
      throw new Error(`Invalid indices accessor index ${primitive.indices}.`);
    }
    const indexCount = indicesAccessor.count;
    const indexType =
      indicesAccessor.componentType === 5123 ? Uint16Array : Uint32Array;
    const decodedIndices = new indexType(indexCount);

    // The decoder writes raw bytes. We provide a Uint8Array view of the
    // target buffer, and the original typed array can then interpret the results.
    meshoptDecoder.decodeIndexBuffer(
      new Uint8Array(decodedIndices.buffer),
      indexCount,
      indexType.BYTES_PER_ELEMENT,
      source,
    );
    result.indexData = decodedIndices;
  }

  // Decode attributes
  for (const [attributeName, accessorIndex] of Object.entries(
    primitive.attributes,
  )) {
    const accessor = gltf.json.accessors[accessorIndex];
    if (accessor?.bufferView === undefined) {
      throw new Error(
        `Invalid accessor index ${accessorIndex} for attribute ${attributeName}.`,
      );
    }

    const attrBufferView = gltf.json.bufferViews[accessor.bufferView];
    if (attrBufferView?.byteStride === undefined) {
      throw new Error(
        `Invalid or non-strided bufferView for compressed attribute ${attributeName}.`,
      );
    }

    const componentType = COMPONENT_TYPE_MAP.get(accessor.componentType);
    if (!componentType) {
      throw new Error(
        `Unsupported componentType ${accessor.componentType} for attribute ${attributeName}.`,
      );
    }

    const numComponents = TYPE_COMPONENT_COUNT[accessor.type];
    const stride = attrBufferView.byteStride;
    const filter = extension.filter ?? "NONE";

    const decodedAttribute = new componentType(accessor.count * numComponents);

    // As with indices, provide a Uint8Array view for the decoder to write into.
    meshoptDecoder.decodeVertexBuffer(
      new Uint8Array(decodedAttribute.buffer),
      accessor.count,
      stride,
      source,
      filter,
    );
    result.vertexData[attributeName] = decodedAttribute;
  }

  return result;
}

// --- GLTF 2.0 Type Definitions ---
// Based on the official specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

export interface GLTF {
  asset: { version: string; [k: string]: unknown };
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
  extensionsUsed?: string[];
  extensionsRequired?: string[];
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

export interface GLTFPrimitiveExtensions {
  EXT_meshopt_compression?: {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    count: number;
    mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
    filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL";
    [key: string]: unknown;
  };
  KHR_mesh_quantization?: Record<string, never>;
  [key: string]: unknown;
}

export interface GLTFPrimitive {
  attributes: Record<string, number>; // like { "POSITION": 1, "NORMAL": 2 }
  indices?: number;
  material?: number;
  mode?: number; // 4 = TRIANGLES
  extensions?: GLTFPrimitiveExtensions;
}

export interface GLTFMaterialExtensions {
  // optional scalar emissive strength
  KHR_materials_emissive_strength?: {
    emissiveStrength?: number; // default 1.0
  };
  // KHR_materials_specular
  KHR_materials_specular?: {
    specularFactor?: number; // default 1.0
    specularTexture?: { index: number; texCoord?: number };
    specularColorFactor?: [number, number, number]; // default [1,1,1]
    specularColorTexture?: { index: number; texCoord?: number };
  };
  // marker extension (no params)
  KHR_materials_unlit?: Record<string, never>;
  // Allow other extensions without breaking types
  [key: string]: unknown;
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
  extensions?: GLTFMaterialExtensions;
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
  target: GLTFAnimationChannelTarget;
}

export interface GLTFAnimationChannelTarget {
  node?: number; // node index
  path: "translation" | "rotation" | "scale" | "weights";
  extensions?: {
    KHR_animation_pointer?: {
      pointer: string;
    };
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

// A type alias for the constructors we'll be storing.
type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor;

const COMPONENT_TYPE_MAP = new Map<number, TypedArrayConstructor>([
  [5120, Int8Array],
  [5121, Uint8Array],
  [5122, Int16Array],
  [5123, Uint16Array],
  [5125, Uint32Array],
  [5126, Float32Array],
]);

export const TYPE_COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * Retrieves the raw data for a glTF accessor as a correctly typed TypedArray.
 *
 * @remarks
 * This function is a low-level utility for accessing the binary data referenced
 * by a glTF accessor. It interprets the accessor's properties
 * (like `componentType`, `type`, `count`, `byteOffset`) and the associated
 * bufferView's properties (like `byteStride`) to extract the data from the
 * underlying ArrayBuffer. It handles both tightly packed and interleaved
 * (strided) vertex data, returning a new TypedArray with the exact data for
 * the specified accessor. This function does not perform any dequantization;
 * it returns the raw integer data if the accessor is quantized.
 *
 * @param parsedGltf The parsed glTF object, containing both the JSON
 *     structure and an array of loaded binary buffers.
 * @param accessorIndex The index of the accessor within the glTF's `accessors`
 *     array whose data should be retrieved.
 * @returns A TypedArray (ie Float32Array, Uint16Array) containing the
 *     accessor's data. The specific type is determined by the accessor's
 *     `componentType`.
 * @throws If the accessorIndex is out of bounds, or if it references an
 *     invalid bufferView, or if the accessor's componentType is unsupported.
 */
export function getAccessorData(
  parsedGltf: ParsedGLTF,
  accessorIndex: number,
): TypedArray;
export function getAccessorData(
  parsedGltf: ParsedGLTF,
  accessorIndex: number,
): TypedArray {
  const { json, buffers } = parsedGltf;
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) {
    throw new Error(`Accessor ${accessorIndex} not found.`);
  }

  const TypedArrayConstructor = COMPONENT_TYPE_MAP.get(accessor.componentType);
  if (!TypedArrayConstructor) {
    throw new Error(`Unsupported componentType: ${accessor.componentType}`);
  }

  if (accessor.bufferView === undefined) {
    return new TypedArrayConstructor();
  }

  const bufferView = json.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    throw new Error(`BufferView ${accessor.bufferView} not found.`);
  }
  const buffer = buffers[bufferView.buffer];
  const numComponents = TYPE_COMPONENT_COUNT[accessor.type];
  const elementSizeInBytes =
    numComponents * TypedArrayConstructor.BYTES_PER_ELEMENT;
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

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
    const elementCount = accessor.count * numComponents;
    return new TypedArrayConstructor(buffer, byteOffset, elementCount);
  }
}

/**
 * Dequantizes vertex data from a normalized integer format to Float32.
 *
 * @remarks
 * This function implements the dequantization formula specified by glTF for
 * accessors with `normalized: true`. It converts component types like BYTE,
 * UNSIGNED_BYTE, SHORT, and UNSIGNED_SHORT into standard -1.0 to 1.0 or 0.0
 * to 1.0 floating-point ranges.
 *
 * @param data The raw TypedArray (e.g., Int8Array, Uint16Array) to dequantize.
 * @param accessor The glTF accessor describing the data, which must have
 *     `normalized: true`.
 * @returns A new Float32Array containing the dequantized data.
 */
export function dequantize(
  data: TypedArray,
  accessor: GLTFAccessor,
): Float32Array {
  if (!accessor.normalized) {
    console.warn(
      `[dequantize] Called on an accessor that is not normalized. Returning as-is.`,
    );
    if (data instanceof Float32Array) return data.slice();
    return new Float32Array(data);
  }

  const numComponents = TYPE_COMPONENT_COUNT[accessor.type];
  const totalComponents = accessor.count * numComponents;
  const float32Data = new Float32Array(totalComponents);

  let divisor: number;

  switch (accessor.componentType) {
    case 5120: // BYTE
      divisor = 127.0;
      for (let i = 0; i < totalComponents; ++i) {
        float32Data[i] = Math.max(data[i] / divisor, -1.0);
      }
      break;
    case 5121: // UNSIGNED_BYTE
      divisor = 255.0;
      for (let i = 0; i < totalComponents; ++i) {
        float32Data[i] = data[i] / divisor;
      }
      break;
    case 5122: // SHORT
      divisor = 32767.0;
      for (let i = 0; i < totalComponents; ++i) {
        float32Data[i] = Math.max(data[i] / divisor, -1.0);
      }
      break;
    case 5123: // UNSIGNED_SHORT
      divisor = 65535.0;
      for (let i = 0; i < totalComponents; ++i) {
        float32Data[i] = data[i] / divisor;
      }
      break;
    default:
      console.error(
        `[dequantize] Unsupported component type for dequantization: ${accessor.componentType}`,
      );
      return new Float32Array(data); // Fallback
  }

  return float32Data;
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
