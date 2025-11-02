// src/core/resources/ui/uiResourceManager.ts
import { ResourceManager } from "@/core/resources/resourceManager";
import { UITextureFactory } from "@/core/resources/uiTextureFactory";
import { UITexture } from "@/core/types/ui";
import { UITextComponent } from "@/core/ecs/components/ui/uiRenderComponent";

/**
 * High-level manager for UI texture operations.
 * Coordinates between ResourceManager and UITextureFactory for common UI tasks.
 */
export class UIResourceManager {
  private resourceManager: ResourceManager;

  constructor(resourceManager: ResourceManager) {
    this.resourceManager = resourceManager;
  }

  /**
   * Loads an image texture for UI use.
   */
  public async loadImage(key: string, url: string): Promise<UITexture> {
    return this.resourceManager.resolveUITexture(key, url);
  }

  /**
   * Generates a texture from text.
   */
  public generateText(textComponent: UITextComponent): UITexture {
    return this.resourceManager.resolveTextTexture(textComponent);
  }

  /**
   * Creates or retrieves a solid color texture.
   */
  public getSolidColor(r: number, g: number, b: number, a = 255): UITexture {
    const key = `SOLID_${r}_${g}_${b}_${a}`;

    // Check cache first
    const cached = this.resourceManager.getUITextureByKey(key);
    if (cached) return cached;

    // Create via factory (not cached in ResourceManager since it's trivial)
    return UITextureFactory.createSolidColor(
      this.resourceManager.getRenderer().device,
      r,
      g,
      b,
      a,
    );
  }

  /**
   * Gets a texture by its key.
   */
  public getTexture(key: string): UITexture | null {
    return this.resourceManager.getUITextureByKey(key);
  }

  /**
   * Preloads multiple UI images.
   */
  public async preloadImages(
    images: { key: string; url: string }[],
  ): Promise<void> {
    await Promise.all(images.map(({ key, url }) => this.loadImage(key, url)));
  }
}
