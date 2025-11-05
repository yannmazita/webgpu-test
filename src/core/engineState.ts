// src/core/engineState.ts

/**
 * This module defines a lock-free, low-latency bridge between the main thread
 * (ImGui editor) and the render worker using SharedArrayBuffer. The main thread
 * writes raw values into a shared float/int view and then publishes a "dirty"
 * bit via Atomics.or(). The worker thread consumes those dirty bits using
 * Atomics.exchange(), applies changes to ECS resources, and then bumps a
 * generation counter for observability.
 *
 * Memory ordering pattern:
 * - Writer (main): Write floats/ints → Atomics.or(FLAGS).
 * - Reader (worker): mask = Atomics.exchange(FLAGS, 0) → Read floats/ints.
 *
 * This provides release/acquire visibility across agents without locks.
 */

import {
  ENGINE_STATE_MAGIC,
  ENGINE_STATE_VERSION,
  ENGINE_STATE_MAGIC_OFFSET,
  ENGINE_STATE_VERSION_OFFSET,
  ENGINE_STATE_FLAGS0_OFFSET,
  ENGINE_STATE_GEN_OFFSET,
  // Offsets
  FOG_ENABLED_OFFSET,
  FOG_COLOR_OFFSET,
  FOG_PARAMS0_OFFSET,
  SUN_ENABLED_OFFSET,
  SUN_DIRECTION_OFFSET,
  SUN_COLOR_OFFSET,
  SHADOW_MAP_SIZE_OFFSET,
  SHADOW_PARAMS0_OFFSET,
  SHADOW_PARAMS1_OFFSET,
  // Dirty bits
  DF_FOG_ENABLED,
  DF_FOG_COLOR,
  DF_FOG_PARAMS0,
  DF_SUN_ENABLED,
  DF_SUN_DIRECTION,
  DF_SUN_COLOR,
  DF_SHADOW_MAP_SIZE,
  DF_SHADOW_PARAMS0,
  DF_SHADOW_PARAMS1,
  SUN_CASTS_SHADOWS_OFFSET,
  DF_SUN_CASTS_SHADOWS,
} from "@/core/sharedEngineStateLayout";
import { World } from "@/core/ecs/world";
import { FogComponent } from "@/core/ecs/components/resources/fogComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/resources/sunComponent";

/**
 * Context that wraps typed-array views into the shared editor state buffer.
 *
 * The buffer must be a SharedArrayBuffer. Both views share the same backing
 * memory and are indexed using byte offsets shifted by 2 (>>2). See `idx()`.
 */
export interface EngineStateContext {
  /** Int view for flags and integer fields. */
  i32: Int32Array;
  /** Float view for struct-like field groups (vec4-aligned). */
  f32: Float32Array;
}

/**
 * Converts a byte offset into the 32-bit element index usable by Int32Array/Float32Array views.
 * @param byteOffset Byte offset from the start of the SAB.
 * @returns 32-bit element index (byteOffset >> 2).
 * @private
 */
const idx = (byteOffset: number) => byteOffset >> 2;

/**
 * Creates an engine state context for the given SharedArrayBuffer.
 *
 * No header is written by this function. Call {@link initializeEngineStateHeader}
 * on the writer thread to seed MAGIC/VERSION/GEN.
 *
 * @param buffer A SharedArrayBuffer large enough for the schema.
 * @returns EngineStateContext with int and float views.
 * @throws If a non-SharedArrayBuffer or invalid buffer is passed, later Atomics
 *         usage will fail; this does not validate size upfront.
 */
export function createEngineStateContext(
  buffer: SharedArrayBuffer,
): EngineStateContext {
  return { i32: new Int32Array(buffer), f32: new Float32Array(buffer) };
}

/**
 * Initializes the shared header with MAGIC, VERSION, and resets GENERATION.
 *
 * Writer-only (main thread). Safe to call multiple times; values are idempotent.
 *
 * @param ctx Engine state context with shared views.
 */
export function initializeEngineStateHeader(ctx: EngineStateContext): void {
  try {
    Atomics.store(ctx.i32, idx(ENGINE_STATE_MAGIC_OFFSET), ENGINE_STATE_MAGIC);
    Atomics.store(
      ctx.i32,
      idx(ENGINE_STATE_VERSION_OFFSET),
      ENGINE_STATE_VERSION,
    );
    // Start generation counter at 0; worker will bump after applying changes.
    Atomics.store(ctx.i32, idx(ENGINE_STATE_GEN_OFFSET), 0);
  } catch (e) {
    console.error(
      "[EngineState] Failed to initialize header; is SharedArrayBuffer available?",
      e,
    );
  }
}

/**
 * Checks that a 32-bit integer address (by byte offset) is in-bounds of the i32 view.
 *
 * @param ctx Engine state context
 * @param byteOffset Byte offset to test
 * @returns True if index is a valid Int32 index
 * @private
 */
function inBoundsI32(ctx: EngineStateContext, byteOffset: number): boolean {
  const index = byteOffset >> 2;
  return index >= 0 && index < ctx.i32.length;
}

/**
 * Checks that a ranged Float32 read/write (by byte offset) is in-bounds of the f32 view.
 *
 * @param ctx Engine state context
 * @param byteOffset Starting byte offset
 * @param floatCount Number of float elements to access
 * @returns True if the [start, end) view is valid
 * @private
 */
function inBoundsF32Range(
  ctx: EngineStateContext,
  byteOffset: number,
  floatCount: number,
): boolean {
  const start = byteOffset >> 2;
  const end = start + floatCount;
  return start >= 0 && end <= ctx.f32.length;
}

/* ============================================================================
 * WRITERS (Main thread)
 * The pattern is: write raw values first, then publish with Atomics.or(FLAGS).
 * ==========================================================================*/

/**
 * Publishes fog enable/disable state.
 *
 * @remarks Memory ordering: value is written before the dirty bit is set with Atomics.
 * @param ctx Engine state context
 * @param enabled True to enable fog
 */
export function setFogEnabled(ctx: EngineStateContext, enabled: boolean): void {
  Atomics.store(ctx.i32, idx(FOG_ENABLED_OFFSET), enabled ? 1 : 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_FOG_ENABLED);
}

/**
 * Publishes fog color (RGBA).
 *
 * @param ctx Engine state context
 * @param r Red [0..]
 * @param g Green
 * @param b Blue
 * @param a Alpha
 */
export function setFogColor(
  ctx: EngineStateContext,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  ctx.f32.set([r, g, b, a], idx(FOG_COLOR_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_FOG_COLOR);
}

/**
 * Publishes fog params vector [density, height, heightFalloff, inscatteringIntensity].
 *
 * @param ctx Engine state context
 * @param density Base fog density (non-negative)
 * @param height Reference height (world Y) where fog is densest
 * @param heightFalloff Rate of exponential falloff with altitude (non-negative)
 * @param inscatteringIntensity Sun in-scattering contribution strength (non-negative)
 */
export function setFogParams(
  ctx: EngineStateContext,
  density: number,
  height: number,
  heightFalloff: number,
  inscatteringIntensity: number,
): void {
  ctx.f32.set(
    [density, height, heightFalloff, inscatteringIntensity],
    idx(FOG_PARAMS0_OFFSET),
  );
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_FOG_PARAMS0);
}

/**
 * Publishes sun enable/disable state.
 *
 * @param ctx Engine state context
 * @param enabled True to enable sun light
 */
export function setSunEnabled(ctx: EngineStateContext, enabled: boolean): void {
  Atomics.store(ctx.i32, idx(SUN_ENABLED_OFFSET), enabled ? 1 : 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_ENABLED);
}

export function setSunCastsShadows(
  ctx: EngineStateContext,
  enabled: boolean,
): void {
  Atomics.store(ctx.i32, idx(SUN_CASTS_SHADOWS_OFFSET), enabled ? 1 : 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_CASTS_SHADOWS);
}

/**
 * Publishes sun direction (XYZ), will be normalized by the worker on apply.
 *
 * @param ctx Engine state context
 * @param x X component
 * @param y Y component
 * @param z Z component
 */
export function setSunDirection(
  ctx: EngineStateContext,
  x: number,
  y: number,
  z: number,
): void {
  ctx.f32.set([x, y, z, 0.0], idx(SUN_DIRECTION_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_DIRECTION);
}

/**
 * Publishes sun color (RGB) and intensity (W).
 *
 * @param ctx Engine state context
 * @param r Red
 * @param g Green
 * @param b Blue
 * @param intensity Intensity multiplier (non-negative)
 */
export function setSunColorAndIntensity(
  ctx: EngineStateContext,
  r: number,
  g: number,
  b: number,
  intensity: number,
): void {
  ctx.f32.set([r, g, b, intensity], idx(SUN_COLOR_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_COLOR);
}

/**
 * Publishes requested shadow map resolution (will be snapped to allowed buckets by worker).
 *
 * @param ctx Engine state context
 * @param size Desired size (e.g., 512, 1024...); worker clamps/snap.
 */
export function setShadowMapSize(ctx: EngineStateContext, size: number): void {
  Atomics.store(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET), size | 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SHADOW_MAP_SIZE);
}

/**
 * Publishes shadow raster/compare parameters vector
 * [slopeScaleBias, constantBias, depthBias, pcfRadius].
 *
 * @param ctx Engine state context
 * @param slopeScaleBias Raster slope-scale bias (ramps with slope)
 * @param constantBias Raster constant bias
 * @param depthBias Bias used by compare sampling in FS (0..0.1 typical)
 * @param pcfRadius Kernel radius for 3x3 PCF (texel units, 0..5)
 */
export function setShadowParams0(
  ctx: EngineStateContext,
  slopeScaleBias: number,
  constantBias: number,
  depthBias: number,
  pcfRadius: number,
): void {
  ctx.f32.set(
    [slopeScaleBias, constantBias, depthBias, pcfRadius],
    idx(SHADOW_PARAMS0_OFFSET),
  );
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SHADOW_PARAMS0);
}

/**
 * Publishes shadow ortho camera half-extent (single cascade fit).
 *
 * @param ctx Engine state context
 * @param orthoHalfExtent Orthographic half-extent along X/Y (1..1e4 typical)
 */
export function setShadowOrthoHalfExtent(
  ctx: EngineStateContext,
  orthoHalfExtent: number,
): void {
  ctx.f32.set([orthoHalfExtent, 0, 0, 0], idx(SHADOW_PARAMS1_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SHADOW_PARAMS1);
}

/* ============================================================================
 * READER/SYNC (Worker thread)
 * Reads once per frame; applies only the changed fields and clears flags.
 * ==========================================================================*/

let warnedInvalidFlagsIndex = false;

/**
 * Consumes dirty flags atomically and applies updates to the ECS world.
 *
 * This function is idempotent within a frame: it clears the dirty mask via
 * Atomics.exchange, then reads raw floats/ints and normalizes/clamps as needed.
 * On success (mask != 0), it increments a GENERATION counter to facilitate
 * debugging and observability from the main thread.
 *
 * Safety:
 * - All Atomics operations are guarded by in-bounds checks and try/catch to
 *   avoid RangeError on non-shared or too-small buffers.
 *
 * @param world ECS world containing FogComponent, SceneSunComponent, ShadowSettingsComponent
 * @param ctx Engine state context
 */
export function syncEngineState(world: World, ctx: EngineStateContext): void {
  // Ensure flags index is valid on this typed array
  if (!inBoundsI32(ctx, ENGINE_STATE_FLAGS0_OFFSET)) {
    if (!warnedInvalidFlagsIndex) {
      console.error(
        "[EngineState] FLAGS0 out of bounds or buffer not shared. i32.len=",
        ctx.i32.length,
        "expected >= ",
        (ENGINE_STATE_FLAGS0_OFFSET >> 2) + 1,
      );
      warnedInvalidFlagsIndex = true;
    }
    return;
  }

  let mask = 0;
  try {
    mask = Atomics.exchange(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), 0);
  } catch (e) {
    if (!warnedInvalidFlagsIndex) {
      console.error(
        "[EngineState] Atomics.exchange failed in sync (invalid shared buffer or index). i32.length=",
        ctx.i32.length,
        e,
      );
      warnedInvalidFlagsIndex = true;
    }
    return;
  }
  if (mask === 0) return;

  const fog = world.getResource(FogComponent);
  const sun = world.getResource(SceneSunComponent);
  const shadows = world.getResource(ShadowSettingsComponent);

  // Fog updates
  if (mask & DF_FOG_ENABLED && fog && inBoundsI32(ctx, FOG_ENABLED_OFFSET)) {
    fog.enabled = Atomics.load(ctx.i32, idx(FOG_ENABLED_OFFSET)) !== 0;
  }
  if (
    mask & DF_FOG_COLOR &&
    fog &&
    inBoundsF32Range(ctx, FOG_COLOR_OFFSET, 4)
  ) {
    const base = idx(FOG_COLOR_OFFSET);
    fog.color[0] = ctx.f32[base + 0];
    fog.color[1] = ctx.f32[base + 1];
    fog.color[2] = ctx.f32[base + 2];
    fog.color[3] = ctx.f32[base + 3];
  }
  if (
    mask & DF_FOG_PARAMS0 &&
    fog &&
    inBoundsF32Range(ctx, FOG_PARAMS0_OFFSET, 4)
  ) {
    const base = idx(FOG_PARAMS0_OFFSET);
    fog.density = Math.max(0, ctx.f32[base + 0]);
    fog.height = ctx.f32[base + 1];
    fog.heightFalloff = Math.max(0, ctx.f32[base + 2]);
    fog.inscatteringIntensity = Math.max(0, ctx.f32[base + 3]);
  }

  // Sun updates
  if (mask & DF_SUN_ENABLED && sun && inBoundsI32(ctx, SUN_ENABLED_OFFSET)) {
    sun.enabled = Atomics.load(ctx.i32, idx(SUN_ENABLED_OFFSET)) !== 0;
  }
  if (
    mask & DF_SUN_DIRECTION &&
    sun &&
    inBoundsF32Range(ctx, SUN_DIRECTION_OFFSET, 4)
  ) {
    const base = idx(SUN_DIRECTION_OFFSET);
    const vx = ctx.f32[base + 0];
    const vy = ctx.f32[base + 1];
    const vz = ctx.f32[base + 2];
    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-6) {
      sun.direction[0] = vx / len;
      sun.direction[1] = vy / len;
      sun.direction[2] = vz / len;
    }
  }
  if (
    mask & DF_SUN_COLOR &&
    sun &&
    inBoundsF32Range(ctx, SUN_COLOR_OFFSET, 4)
  ) {
    const base = idx(SUN_COLOR_OFFSET);
    sun.color[0] = Math.max(0, ctx.f32[base + 0]);
    sun.color[1] = Math.max(0, ctx.f32[base + 1]);
    sun.color[2] = Math.max(0, ctx.f32[base + 2]);
    sun.color[3] = Math.max(0, ctx.f32[base + 3]); // intensity
  }
  if (
    mask & DF_SUN_CASTS_SHADOWS &&
    sun &&
    inBoundsI32(ctx, SUN_CASTS_SHADOWS_OFFSET)
  ) {
    sun.castsShadows =
      Atomics.load(ctx.i32, idx(SUN_CASTS_SHADOWS_OFFSET)) !== 0;
  }

  // Shadow updates
  if (shadows) {
    if (mask & DF_SHADOW_MAP_SIZE && inBoundsI32(ctx, SHADOW_MAP_SIZE_OFFSET)) {
      const req = Atomics.load(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET)) | 0;
      shadows.mapSize = clampShadowMapSize(req);
    }
    if (
      mask & DF_SHADOW_PARAMS0 &&
      inBoundsF32Range(ctx, SHADOW_PARAMS0_OFFSET, 4)
    ) {
      const base = idx(SHADOW_PARAMS0_OFFSET);
      shadows.slopeScaleBias = clampFinite(ctx.f32[base + 0], -128, 128);
      shadows.constantBias = clampFinite(ctx.f32[base + 1], 0, 4096);
      shadows.depthBias = clampFinite(ctx.f32[base + 2], 0, 0.1);
      shadows.pcfRadius = clampFinite(ctx.f32[base + 3], 0, 5);
    }
    if (
      mask & DF_SHADOW_PARAMS1 &&
      inBoundsF32Range(ctx, SHADOW_PARAMS1_OFFSET, 1)
    ) {
      const base = idx(SHADOW_PARAMS1_OFFSET);
      shadows.orthoHalfExtent = clampFinite(ctx.f32[base + 0], 1, 1e4);
    }
  }

  // Signal a successful application for observability (optional for UI)
  try {
    Atomics.add(ctx.i32, idx(ENGINE_STATE_GEN_OFFSET), 1);
  } catch {
    // No-op if buffer invalid; earlier guards already emitted a log.
  }
}

/* ============================================================================
 * Snapshot helpers
 * ==========================================================================*/

/**
 * One-time snapshot publisher from the worker after the ECS world has been created.
 *
 * This writes the ECS resources (fog/sun/shadows) into the shared buffer and
 * sets all relevant dirty bits so the main thread can initialize the UI state
 * from the SAB without a separate message payload. Finally, it also
 * initializes the header (MAGIC/VERSION/GEN).
 *
 * @param world ECS world configured with FogComponent, SceneSunComponent, ShadowSettingsComponent
 * @param ctx Engine state context
 */
export function publishSnapshotFromWorld(
  world: World,
  ctx: EngineStateContext,
): void {
  try {
    const fog = world.getResource(FogComponent);
    const sun = world.getResource(SceneSunComponent);
    const shadows = world.getResource(ShadowSettingsComponent);

    if (fog) {
      if (inBoundsI32(ctx, FOG_ENABLED_OFFSET)) {
        Atomics.store(ctx.i32, idx(FOG_ENABLED_OFFSET), fog.enabled ? 1 : 0);
      }
      if (inBoundsF32Range(ctx, FOG_COLOR_OFFSET, 4)) {
        ctx.f32.set(fog.color, idx(FOG_COLOR_OFFSET));
      }
      if (inBoundsF32Range(ctx, FOG_PARAMS0_OFFSET, 4)) {
        ctx.f32.set(
          [
            fog.density,
            fog.height,
            fog.heightFalloff,
            fog.inscatteringIntensity,
          ],
          idx(FOG_PARAMS0_OFFSET),
        );
      }
      Atomics.or(
        ctx.i32,
        idx(ENGINE_STATE_FLAGS0_OFFSET),
        DF_FOG_ENABLED | DF_FOG_COLOR | DF_FOG_PARAMS0,
      );
    }

    if (sun) {
      if (inBoundsI32(ctx, SUN_ENABLED_OFFSET)) {
        Atomics.store(ctx.i32, idx(SUN_ENABLED_OFFSET), sun.enabled ? 1 : 0);
      }
      if (inBoundsF32Range(ctx, SUN_DIRECTION_OFFSET, 4)) {
        ctx.f32.set(
          [sun.direction[0], sun.direction[1], sun.direction[2], 0.0],
          idx(SUN_DIRECTION_OFFSET),
        );
      }
      if (inBoundsF32Range(ctx, SUN_COLOR_OFFSET, 4)) {
        ctx.f32.set(
          [sun.color[0], sun.color[1], sun.color[2], sun.color[3]],
          idx(SUN_COLOR_OFFSET),
        );
      }
      if (inBoundsI32(ctx, SUN_CASTS_SHADOWS_OFFSET)) {
        Atomics.store(
          ctx.i32,
          idx(SUN_CASTS_SHADOWS_OFFSET),
          sun.castsShadows ? 1 : 0,
        );
      }
      Atomics.or(
        ctx.i32,
        idx(ENGINE_STATE_FLAGS0_OFFSET),
        DF_SUN_ENABLED | DF_SUN_DIRECTION | DF_SUN_COLOR | DF_SUN_CASTS_SHADOWS,
      );
    }

    if (shadows) {
      if (inBoundsI32(ctx, SHADOW_MAP_SIZE_OFFSET)) {
        Atomics.store(
          ctx.i32,
          idx(SHADOW_MAP_SIZE_OFFSET),
          shadows.mapSize | 0,
        );
      }
      if (inBoundsF32Range(ctx, SHADOW_PARAMS0_OFFSET, 4)) {
        ctx.f32.set(
          [
            shadows.slopeScaleBias,
            shadows.constantBias,
            shadows.depthBias,
            shadows.pcfRadius,
          ],
          idx(SHADOW_PARAMS0_OFFSET),
        );
      }
      if (inBoundsF32Range(ctx, SHADOW_PARAMS1_OFFSET, 1)) {
        ctx.f32.set(
          [shadows.orthoHalfExtent, 0, 0, 0],
          idx(SHADOW_PARAMS1_OFFSET),
        );
      }
      Atomics.or(
        ctx.i32,
        idx(ENGINE_STATE_FLAGS0_OFFSET),
        DF_SHADOW_MAP_SIZE | DF_SHADOW_PARAMS0 | DF_SHADOW_PARAMS1,
      );
    }

    initializeEngineStateHeader(ctx);
  } catch (e) {
    console.error("[EngineState] publishSnapshotFromWorld failed:", e);
  }
}

/**
 * Reads a non-atomic, coherent snapshot of editor state for initializing the UI.
 *
 * This is intended for the main thread when receiving a READY notification
 * from the worker. It uses Atomics.load for integer header bits (enabled booleans,
 * mapSize), and direct float reads for parameter blocks. Because the worker
 * publishes the snapshot with dirty bits already set and initializes the header
 * last, this is sufficient for initialization reads.
 *
 * @param ctx Engine state context
 * @returns Structured snapshot for Fog, Sun, and Shadow settings
 */
export function readSnapshot(ctx: EngineStateContext): {
  fog: {
    enabled: boolean;
    color: [number, number, number, number];
    density: number;
    height: number;
    heightFalloff: number;
    inscatteringIntensity: number;
  };
  sun: {
    enabled: boolean;
    direction: [number, number, number];
    color: [number, number, number];
    intensity: number;
    castsShadows: boolean;
  };
  shadow: {
    mapSize: number;
    slopeScaleBias: number;
    constantBias: number;
    depthBias: number;
    pcfRadius: number;
    orthoHalfExtent: number;
  };
} {
  // Fog
  const fogEnabled = Atomics.load(ctx.i32, idx(FOG_ENABLED_OFFSET)) !== 0;
  const fcol = [
    ctx.f32[idx(FOG_COLOR_OFFSET) + 0],
    ctx.f32[idx(FOG_COLOR_OFFSET) + 1],
    ctx.f32[idx(FOG_COLOR_OFFSET) + 2],
    ctx.f32[idx(FOG_COLOR_OFFSET) + 3],
  ] as [number, number, number, number];
  const fparBase = idx(FOG_PARAMS0_OFFSET);
  const fog = {
    enabled: fogEnabled,
    color: fcol,
    density: ctx.f32[fparBase + 0],
    height: ctx.f32[fparBase + 1],
    heightFalloff: ctx.f32[fparBase + 2],
    inscatteringIntensity: ctx.f32[fparBase + 3],
  };

  // Sun
  const sunEnabled = Atomics.load(ctx.i32, idx(SUN_ENABLED_OFFSET)) !== 0;
  const sunCasts = Atomics.load(ctx.i32, idx(SUN_CASTS_SHADOWS_OFFSET)) !== 0;
  const sdir = [
    ctx.f32[idx(SUN_DIRECTION_OFFSET) + 0],
    ctx.f32[idx(SUN_DIRECTION_OFFSET) + 1],
    ctx.f32[idx(SUN_DIRECTION_OFFSET) + 2],
  ] as [number, number, number];
  const scolBase = idx(SUN_COLOR_OFFSET);
  const scol = [
    ctx.f32[scolBase + 0],
    ctx.f32[scolBase + 1],
    ctx.f32[scolBase + 2],
  ] as [number, number, number];
  const sint = ctx.f32[scolBase + 3];

  // Shadows
  const smap = Atomics.load(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET)) | 0;
  const spar0Base = idx(SHADOW_PARAMS0_OFFSET);
  const orthoBase = idx(SHADOW_PARAMS1_OFFSET);
  const shadow = {
    mapSize: smap,
    slopeScaleBias: ctx.f32[spar0Base + 0],
    constantBias: ctx.f32[spar0Base + 1],
    depthBias: ctx.f32[spar0Base + 2],
    pcfRadius: ctx.f32[spar0Base + 3],
    orthoHalfExtent: ctx.f32[orthoBase + 0],
  };

  return {
    fog,
    sun: {
      enabled: sunEnabled,
      direction: sdir,
      color: scol,
      intensity: sint,
      castsShadows: sunCasts,
    },
    shadow,
  };
}

/* ============================================================================
 * Utilities
 * ==========================================================================*/

/**
 * Snaps a requested shadow map size to the nearest allowed bucket.
 *
 * Allowed: [256, 512, 1024, 2048, 4096, 8192]
 *
 * @param v Requested size
 * @returns Nearest allowed size
 * @private
 */
function clampShadowMapSize(v: number): number {
  const allowed = [256, 512, 1024, 2048, 4096, 8192];
  const nearest = allowed.reduce(
    (best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best),
    allowed[0],
  );
  return nearest;
}

/**
 * Clamps a finite numeric value to [min, max], returning min if not finite.
 *
 * @param v Input value
 * @param min Minimum
 * @param max Maximum
 * @returns Clamped finite value
 * @private
 */
function clampFinite(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}
