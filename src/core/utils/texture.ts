// src/core/utils/texture.ts
import { getBasisModule, initBasis } from "@/core/wasm/basisModule";
import { BasisModule } from "basis-universal";

/**
 * Loads an image from a URL and creates a GPUTexture from it.
 *
 * @param device The GPU device.
 * @param imageUrl The URL of the image to load.
 * @returns A promise that resolves to the created GPUTexture.
 */
export const createTextureFromImage = async (
  device: GPUDevice,
  imageUrl: string,
  format: GPUTextureFormat = "rgba8unorm",
): Promise<GPUTexture> => {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const imgBitmap = await createImageBitmap(blob);

  const textureDescriptor: GPUTextureDescriptor = {
    size: { width: imgBitmap.width, height: imgBitmap.height },
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  };

  const texture = device.createTexture(textureDescriptor);

  device.queue.copyExternalImageToTexture(
    { source: imgBitmap },
    { texture },
    textureDescriptor.size,
  );

  return texture;
};

/**
 * Defines the preferred transcoding format based on device support and use case.
 */
interface TranscodeTarget {
  format: GPUTextureFormat;
  basisFormat: number; // Corresponds to BasisUniversal.TranscoderTextureFormat
}

/**
 * Selects the best transcoding target for a given texture type (e.g., color, normal map)
 * based on the available GPU features.
 *
 * @param supportedFormats A Set of GPUTextureFormat strings supported by the device.
 * @param isNormalMap A boolean indicating if the texture is a normal map, which
 *     benefits from two-channel formats like BC5 or EAC_RG11.
 * @returns The selected TranscodeTarget, or null if no suitable compressed format is found.
 */
function selectTranscodeTarget(
  supportedFormats: Set<GPUTextureFormat>,
  isNormalMap: boolean,
): TranscodeTarget | null {
  const BASIS: BasisModule | null = getBasisModule();
  if (!BASIS) return null;

  // Highest Quality: ASTC (Modern Mobile, some Desktops)
  if (supportedFormats.has("astc-4x4-unorm-srgb")) {
    return {
      format: isNormalMap ? "astc-4x4-unorm" : "astc-4x4-unorm-srgb",
      basisFormat: BASIS.TranscoderTextureFormat.ASTC_4x4_RGBA,
    };
  }

  // High Quality: BC7/BC5 (Desktop)
  if (supportedFormats.has("bc7-rgba-unorm-srgb")) {
    if (isNormalMap && supportedFormats.has("bc5-rg-unorm")) {
      return {
        format: "bc5-rg-unorm",
        basisFormat: BASIS.TranscoderTextureFormat.BC5_RG,
      };
    }
    return {
      format: "bc7-rgba-unorm-srgb",
      basisFormat: BASIS.TranscoderTextureFormat.BC7_RGBA,
    };
  }

  // Fallback: ETC2 (Older Mobile)
  if (supportedFormats.has("etc2-rgba8unorm-srgb")) {
    if (isNormalMap && supportedFormats.has("eac-rg11unorm")) {
      return {
        format: "eac-rg11unorm",
        basisFormat: BASIS.TranscoderTextureFormat.ETC2_EAC_RG11,
      };
    }
    return {
      format: "etc2-rgba8unorm-srgb",
      basisFormat: BASIS.TranscoderTextureFormat.ETC2_RGBA,
    };
  }

  // No suitable compressed format found
  return null;
}

/**
 * Returns the size in bytes of a single 4x4 compressed block for a given
 * Basis Universal texture format.
 *
 * @param basisFormat The format enum from the Basis Universal module.
 * @returns The block size in bytes (typically 8 or 16).
 */
function getBasisFormatBlockSize(basisFormat: number): number {
  const BASIS: BasisModule | null = getBasisModule();
  if (!BASIS) {
    throw new Error(
      "getBasisFormatBlockSize called before Basis module was initialized.",
    );
  }

  switch (basisFormat) {
    // 8-byte formats (4 bits per pixel)
    case BASIS.TranscoderTextureFormat.ETC1_RGB:
    case BASIS.TranscoderTextureFormat.BC1_RGB:
    case BASIS.TranscoderTextureFormat.BC4_R:
    case BASIS.TranscoderTextureFormat.ETC2_EAC_R11:
      return 8;

    // 16-byte formats (8 bits per pixel)
    case BASIS.TranscoderTextureFormat.ETC2_RGBA:
    case BASIS.TranscoderTextureFormat.BC3_RGBA:
    case BASIS.TranscoderTextureFormat.BC5_RG:
    case BASIS.TranscoderTextureFormat.BC7_RGBA:
    case BASIS.TranscoderTextureFormat.ASTC_4x4_RGBA:
    case BASIS.TranscoderTextureFormat.ETC2_EAC_RG11:
      return 16;

    default:
      throw new Error(`Unknown or unsupported Basis format: ${basisFormat}`);
  }
}

/**
 * Loads a .ktx2 file, transcodes it to a GPU-compatible compressed format,
 * and creates a GPUTexture.
 *
 * @param device The GPU device.
 * @param supportedFormats A Set of GPUTextureFormat strings supported by the device.
 * @param imageUrl The URL of the .ktx2 file.
 * @param isNormalMap Hints that the texture is a normal map to select an optimal format.
 * @returns A promise that resolves to the created GPUTexture.
 */
export const createTextureFromBasis = async (
  device: GPUDevice,
  supportedFormats: Set<GPUTextureFormat>,
  imageUrl: string,
  isNormalMap = false,
): Promise<GPUTexture> => {
  // Ensure the WASM module is ready before proceeding.
  await initBasis();
  const BASIS: BasisModule | null = getBasisModule();
  if (!BASIS) {
    throw new Error("Basis transcoder module is not initialized.");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Basis texture: ${imageUrl}`);
  }
  const fileData = new Uint8Array(await response.arrayBuffer());

  const ktx2File = new BASIS.KTX2File(fileData);

  if (!ktx2File.isValid()) {
    ktx2File.close();
    throw new Error(`Invalid KTX2 file: ${imageUrl}`);
  }

  const width = ktx2File.getWidth();
  const height = ktx2File.getHeight();
  const levels = ktx2File.getLevels();

  const target = selectTranscodeTarget(supportedFormats, isNormalMap);

  // Fallback to uncompressed if no suitable format is found
  if (!target) {
    console.warn(
      `No supported compressed format for ${imageUrl}, falling back to RGBA8. ` +
        `This will attempt to load a .png version of the file.`,
    );
    ktx2File.close();
    return createTextureFromImage(
      device,
      imageUrl.replace(".ktx2", ".png"),
      isNormalMap ? "rgba8unorm" : "rgba8unorm-srgb",
    );
  }

  if (!ktx2File.startTranscoding()) {
    ktx2File.close();
    throw new Error(`Failed to start transcoding KTX2 file: ${imageUrl}`);
  }

  const textureDescriptor: GPUTextureDescriptor = {
    size: { width, height },
    format: target.format,
    mipLevelCount: levels,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  };
  const texture = device.createTexture(textureDescriptor);

  for (let level = 0; level < levels; level++) {
    const levelInfo = ktx2File.getImageLevelInfo(level, 0, 0);
    const dst = new Uint8Array(levelInfo.totalBlocks * 16); // Max size

    const transcodeResult = ktx2File.transcodeImage(
      dst,
      level,
      0,
      0,
      target.basisFormat,
      0,
      -1,
      -1,
    );

    if (!transcodeResult) {
      ktx2File.close();
      throw new Error(`Failed to transcode level ${level} for ${imageUrl}`);
    }

    const blockByteLength = getBasisFormatBlockSize(target.basisFormat);
    const unpaddedBytesPerRow = levelInfo.numBlocksX * blockByteLength;

    if (unpaddedBytesPerRow % 256 === 0) {
      // Fast path: data is already aligned.
      // We must slice the data from the view returned by the WASM module
      // into a new, standard ArrayBuffer that writeTexture can accept.
      const dataCopy = transcodeResult.slice();

      device.queue.writeTexture(
        { texture, mipLevel: level },
        dataCopy, // Use the copied data
        {
          bytesPerRow: unpaddedBytesPerRow,
          rowsPerImage: levelInfo.numBlocksY,
        },
        { width: levelInfo.origWidth, height: levelInfo.origHeight },
      );
    } else {
      // Slow path: copy to a padded buffer to meet 256-byte alignment.
      const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      const paddedData = new Uint8Array(
        paddedBytesPerRow * levelInfo.numBlocksY,
      );

      for (let y = 0; y < levelInfo.numBlocksY; y++) {
        const srcOffset = y * unpaddedBytesPerRow;
        const dstOffset = y * paddedBytesPerRow;
        paddedData.set(
          transcodeResult.subarray(srcOffset, srcOffset + unpaddedBytesPerRow),
          dstOffset,
        );
      }

      device.queue.writeTexture(
        { texture, mipLevel: level },
        paddedData,
        {
          bytesPerRow: paddedBytesPerRow,
          rowsPerImage: levelInfo.numBlocksY,
        },
        { width: levelInfo.origWidth, height: levelInfo.origHeight },
      );
    }
  }

  ktx2File.close();
  return texture;
};
