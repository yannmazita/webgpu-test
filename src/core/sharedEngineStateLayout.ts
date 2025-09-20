// src/core/sharedEngineStateLayout.ts

// Header magic/version for schema validation
export const ENGINE_STATE_MAGIC = 0x454e4753; // 'ENGS'
export const ENGINE_STATE_VERSION = 1;

// Offsets (in BYTES) — Int32-aligned header
export const ENGINE_STATE_MAGIC_OFFSET = 0;
export const ENGINE_STATE_VERSION_OFFSET = 4;

// DIRTY FLAGS bitfields (Uint32)
export const ENGINE_STATE_FLAGS0_OFFSET = 8;
// GENERATION counter (Uint32): increments when worker applies any changes
export const ENGINE_STATE_GEN_OFFSET = 12;

// Data starts at 16B
// Fog
export const FOG_ENABLED_OFFSET = 16; // Int32 (0/1)
export const FOG_COLOR_OFFSET = 32; // Float32[4] rgba
export const FOG_PARAMS0_OFFSET = 48; // Float32[4] = [density, height, heightFalloff, inscatteringIntensity]

// Sun
export const SUN_ENABLED_OFFSET = 64; // Int32 (0/1)
export const SUN_CASTS_SHADOWS_OFFSET = 68; // Int32 (0/1)
export const SUN_DIRECTION_OFFSET = 80; // Float32[4] = dir.xyz, pad
export const SUN_COLOR_OFFSET = 96; // Float32[4] = rgb + intensity in w

// Shadows
export const SHADOW_MAP_SIZE_OFFSET = 112; // Int32
export const SHADOW_PARAMS0_OFFSET = 128; // Float32[4] = [slopeScaleBias, constantBias, depthBias, pcfRadius]
export const SHADOW_PARAMS1_OFFSET = 144; // Float32[4] = [orthoHalfExtent, 0, 0, 0]

// Total buffer size (pad to multiple of 16)
export const SHARED_ENGINE_STATE_BUFFER_SIZE = 160;

// DIRTY BITS (FLAGS0)
export const DF_FOG_ENABLED = 1 << 0;
export const DF_FOG_COLOR = 1 << 1;
export const DF_FOG_PARAMS0 = 1 << 2;

export const DF_SUN_ENABLED = 1 << 3;
export const DF_SUN_DIRECTION = 1 << 4;
export const DF_SUN_COLOR = 1 << 5;
export const DF_SUN_CASTS_SHADOWS = 1 << 9;

export const DF_SHADOW_MAP_SIZE = 1 << 6;
export const DF_SHADOW_PARAMS0 = 1 << 7;
export const DF_SHADOW_PARAMS1 = 1 << 8;
