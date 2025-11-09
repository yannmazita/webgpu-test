// src/shared/types/basis.d.ts
// This declaration file provides the necessary types for the dynamically loaded
// basis_transcoder.js script.

declare module "basis-universal" {
  interface KTX2File {
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

  interface BasisFile {
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

  // This is the main module object that is initialized.
  export interface BasisModule {
    onRuntimeInitialized?: () => void;
    locateFile?: (path: string, prefix: string) => string;

    // The enum-like object for texture formats
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

    // The constructors are properties on the module object.
    KTX2File: new (data: Uint8Array) => KTX2File;
    BasisFile: new (data: Uint8Array) => BasisFile;
  }

  // Factory function type
  type BasisFactory = (config: Partial<BasisModule>) => Promise<BasisModule>;
}

// Extend Window to include the global BASIS factory
declare global {
  interface Window {
    BASIS?: (
      config: Partial<import("basis-universal").BasisModule>,
    ) => Promise<import("basis-universal").BasisModule>;
  }
}
