// src/core/utils/texture.ts

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
): Promise<GPUTexture> => {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const imgBitmap = await createImageBitmap(blob);

  const textureDescriptor: GPUTextureDescriptor = {
    size: { width: imgBitmap.width, height: imgBitmap.height },
    format: "rgba8unorm",
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
