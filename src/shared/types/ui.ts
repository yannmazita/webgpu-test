// src/shared/types/ui.ts
export interface UITexture {
  texture: GPUTexture;
  width: number;
  height: number;
}

export interface UITextureAtlas {
  texture: GPUTexture;
  regions: Map<string, { x: number; y: number; w: number; h: number }>;
  width: number;
  height: number;
}
