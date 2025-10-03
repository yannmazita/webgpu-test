// src/core/types/basis.d.ts
// This declaration file provides the necessary types for the dynamically loaded
// basis_transcoder.js script.

declare module "basis-universal" {
  export interface BasisModule {
    onRuntimeInitialized?: () => void;
    locateFile?: (path: string, prefix: string) => string;
    // This is the enum-like object for texture formats
    TranscoderTextureFormat: {
      ETC1_RGB: number;
      ETC2_RGBA: number;
      BC1_RGB: number;
      BC3_RGBA: number;
      BC4_R: number;
      BC5_RG: number;
      BC7_RGBA: number;
      PVRTC1_4_RGB: number;
      PVRTC1_4_RGBA: number;
      ASTC_4x4_RGBA: number;
      ATC_RGB: number;
      ATC_RGBA: number;
      FXT1_RGB: number;
      RGBA32: number;
      RGB565: number;
      BGR565: number;
      RGBA4444: number;
      ETC2_EAC_R11: number;
      ETC2_EAC_RG11: number;
    };
  }

  export class BasisFile {
    constructor(data: Uint8Array);
    close(): void;
    getHasAlpha(): boolean;
    getNumImages(): number;
    getNumLevels(imageIndex: number): number;
    getImageWidth(imageIndex: number, levelIndex: number): number;
    getImageHeight(imageIndex: number, levelIndex: number): number;
    getImageTranscodedSizeInBytes(
      imageIndex: number,
      levelIndex: number,
      format: number,
    ): number;
    startTranscoding(): boolean;
    transcodeImage(
      dst: Uint8Array,
      imageIndex: number,
      levelIndex: number,
      format: number,
      unused: number,
      getAlphaForOpaqueFormats: number,
    ): Uint8Array | null;
    destroy(): void;
  }

  export interface KTX2ImageLevelInfo {
    levelIndex: number;
    layerIndex: number;
    faceIndex: number;
    origWidth: number;
    origHeight: number;
    width: number;
    height: number;
    numBlocksX: number;
    numBlocksY: number;
    totalBlocks: number;
    alphaFlag: boolean;
    iframeFlag: boolean;
  }

  export class KTX2File {
    constructor(data: Uint8Array);
    close(): void;
    isValid(): boolean;
    getWidth(): number;
    getHeight(): number;
    getLayers(): number;
    getLevels(): number;
    getFaces(): number;
    getFormat(): number;
    hasAlpha(): boolean;
    isUASTC(): boolean;
    startTranscoding(): boolean;
    getImageLevelInfo(
      level: number,
      layer: number,
      face: number,
    ): KTX2ImageLevelInfo;
    transcodeImage(
      dst: Uint8Array,
      level: number,
      layer: number,
      face: number,
      format: number,
      decodeFlags: number,
      channel0: number,
      channel1: number,
    ): Uint8Array | null;
    destroy(): void;
  }

  export function BasisTranscoder(module: Partial<BasisModule>): Promise<void>;
}
