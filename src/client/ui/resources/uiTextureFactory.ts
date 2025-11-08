// src/client/ui/resources/uiTextureFactory.ts
import { UITexture } from "@/shared/types/ui";
import { UITextComponent } from "@/shared/ecs/components/ui/uiRenderComponent";

/**
 * A stateless factory for creating UI textures.
 * It handles image loading, text rendering, and GPU texture creation.
 */
export class UITextureFactory {
  /**
   * Creates a GPU texture from an image URL
   * @param device The WebGPU device
   * @param url The image URL or data URI
   * @returns A promise resolving to a UITexture
   */
  public static async createFromURL(
    device: GPUDevice,
    url: string,
  ): Promise<UITexture> {
    const imageBitmap = await this.fetchImage(url);
    return this.createFromBitmap(device, imageBitmap);
  }

  /**
   * Creates a GPU texture from an ImageBitmap
   */
  public static createFromBitmap(
    device: GPUDevice,
    imageBitmap: ImageBitmap,
  ): UITexture {
    const texture = device.createTexture({
      label: `UI_IMAGE_${imageBitmap.width}x${imageBitmap.height}`,
      size: [imageBitmap.width, imageBitmap.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture },
      [imageBitmap.width, imageBitmap.height],
    );

    return {
      texture,
      width: imageBitmap.width,
      height: imageBitmap.height,
    };
  }

  /**
   * Creates a solid color texture
   */
  public static createSolidColor(
    device: GPUDevice,
    r: number,
    g: number,
    b: number,
    a = 255,
    size = 1,
  ): UITexture {
    const texture = device.createTexture({
      label: `UI_SOLID_${r}_${g}_${b}_${a}`,
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4 + 0] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
    }

    device.queue.writeTexture({ texture }, data, { bytesPerRow: size * 4 }, [
      size,
      size,
    ]);

    return { texture, width: size, height: size };
  }

  /**
   * Renders text to a GPU texture using Canvas2D
   */
  public static createFromText(
    device: GPUDevice,
    textComponent: UITextComponent,
    canvas?: OffscreenCanvas | HTMLCanvasElement,
  ): UITexture {
    const { canvas: textCanvas, context } = this.ensureCanvas(canvas);

    // Setup font
    const font = this.buildFontString(textComponent);
    context.font = font;
    context.textBaseline = "top";

    // Measure text
    const metrics = this.measureText(context, textComponent);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = Math.ceil(metrics.height);

    // Calculate texture size (power of 2)
    const texWidth = Math.min(2048, this.nextPowerOfTwo(textWidth + 4));
    const texHeight = Math.min(2048, this.nextPowerOfTwo(textHeight + 4));

    // Resize canvas if needed
    if (textCanvas.width !== texWidth || textCanvas.height !== texHeight) {
      textCanvas.width = texWidth;
      textCanvas.height = texHeight;
      context.font = font;
      context.textBaseline = "top";
    }

    // Clear and render
    context.clearRect(0, 0, texWidth, texHeight);

    // Apply text alignment
    const x = this.getAlignmentX(textComponent, textWidth, texWidth);
    const y = 2;

    // Draw text
    context.fillStyle = this.colorToRGBA(textComponent.color);

    if (textComponent.maxWidth) {
      this.drawWrappedText(
        context,
        textComponent.text,
        x,
        y,
        textComponent.maxWidth,
        textComponent.lineHeight * textComponent.fontSize,
      );
    } else {
      context.fillText(textComponent.text, x, y);
    }

    // Create GPU texture
    const texture = device.createTexture({
      label: `UI_TEXT_${textComponent.text.substring(0, 20)}`,
      size: [texWidth, texHeight],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: textCanvas },
      { texture },
      [texWidth, texHeight],
    );

    return {
      texture,
      width: textWidth,
      height: textHeight,
    };
  }

  /**
   * Generates a cache key for a text component
   */
  public static generateTextCacheKey(textComponent: UITextComponent): string {
    return (
      `TEXT:${textComponent.text}:` +
      `${textComponent.fontSize}:` +
      `${textComponent.fontFamily}:` +
      `${textComponent.fontWeight}:` +
      `${textComponent.color.join(",")}`
    );
  }

  // Private helpers

  private static ensureCanvas(
    existingCanvas?: OffscreenCanvas | HTMLCanvasElement,
  ): {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  } {
    let canvas: OffscreenCanvas | HTMLCanvasElement;

    if (existingCanvas) {
      canvas = existingCanvas;
    } else if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(1024, 512);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;
    }

    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });

    return { canvas, context };
  }

  private static buildFontString(textComponent: UITextComponent): string {
    return `${textComponent.fontWeight} ${textComponent.fontSize}px ${textComponent.fontFamily}`;
  }

  private static measureText(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    textComponent: UITextComponent,
  ): { width: number; height: number } {
    const metrics = ctx.measureText(textComponent.text);
    return {
      width: metrics.width,
      height: textComponent.fontSize * textComponent.lineHeight,
    };
  }

  private static getAlignmentX(
    textComponent: UITextComponent,
    textWidth: number,
    canvasWidth: number,
  ): number {
    switch (textComponent.alignment) {
      case "center":
        return (canvasWidth - textWidth) / 2;
      case "right":
        return canvasWidth - textWidth - 2;
      case "left":
      default:
        return 2;
    }
  }

  private static colorToRGBA(color: number[] | Float32Array): string {
    const r = Math.round(color[0] * 255);
    const g = Math.round(color[1] * 255);
    const b = Math.round(color[2] * 255);
    const a = color[3];
    return `rgba(${r},${g},${b},${a})`;
  }

  private static drawWrappedText(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): void {
    const words = text.split(" ");
    let line = "";
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + " ";
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = words[i] + " ";
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  private static async fetchImage(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${url} (${response.status})`);
    }
    const blob = await response.blob();
    return createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "premultiply",
    });
  }

  private static nextPowerOfTwo(n: number): number {
    return Math.pow(2, Math.ceil(Math.log2(n)));
  }
}
