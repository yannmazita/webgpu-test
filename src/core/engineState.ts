// src/core/engineState.ts
import {
  ENGINE_STATE_MAGIC,
  ENGINE_STATE_VERSION,
  ENGINE_STATE_MAGIC_OFFSET,
  ENGINE_STATE_VERSION_OFFSET,
  ENGINE_STATE_FLAGS0_OFFSET,
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
} from "@/core/sharedEngineStateLayout";
import { World } from "@/core/ecs/world";
import { FogComponent } from "@/core/ecs/components/fogComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";

export interface EngineStateContext {
  i32: Int32Array;
  f32: Float32Array;
}

const idx = (byteOffset: number) => byteOffset >> 2;

export function createEngineStateContext(
  buffer: SharedArrayBuffer,
): EngineStateContext {
  return { i32: new Int32Array(buffer), f32: new Float32Array(buffer) };
}

export function initializeEngineStateHeader(ctx: EngineStateContext): void {
  Atomics.store(ctx.i32, idx(ENGINE_STATE_MAGIC_OFFSET), ENGINE_STATE_MAGIC);
  Atomics.store(
    ctx.i32,
    idx(ENGINE_STATE_VERSION_OFFSET),
    ENGINE_STATE_VERSION,
  );
}

// Writer helpers (MAIN thread)
export function setFogEnabled(ctx: EngineStateContext, enabled: boolean): void {
  Atomics.store(ctx.i32, idx(FOG_ENABLED_OFFSET), enabled ? 1 : 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_FOG_ENABLED);
}
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

export function setSunEnabled(ctx: EngineStateContext, enabled: boolean): void {
  Atomics.store(ctx.i32, idx(SUN_ENABLED_OFFSET), enabled ? 1 : 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_ENABLED);
}
export function setSunDirection(
  ctx: EngineStateContext,
  x: number,
  y: number,
  z: number,
): void {
  ctx.f32.set([x, y, z, 0.0], idx(SUN_DIRECTION_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SUN_DIRECTION);
}
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

export function setShadowMapSize(ctx: EngineStateContext, size: number): void {
  Atomics.store(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET), size | 0);
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SHADOW_MAP_SIZE);
}
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
export function setShadowOrthoHalfExtent(
  ctx: EngineStateContext,
  orthoHalfExtent: number,
): void {
  ctx.f32.set([orthoHalfExtent, 0, 0, 0], idx(SHADOW_PARAMS1_OFFSET));
  Atomics.or(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), DF_SHADOW_PARAMS1);
}

// Reader/sync (WORKER thread)
export function syncEngineState(world: World, ctx: EngineStateContext): void {
  const mask = Atomics.exchange(ctx.i32, idx(ENGINE_STATE_FLAGS0_OFFSET), 0);
  if (mask === 0) return;

  const fog = world.getResource(FogComponent);
  const sun = world.getResource(SceneSunComponent);
  const shadows = world.getResource(ShadowSettingsComponent);

  if (mask & DF_FOG_ENABLED && fog) {
    fog.enabled = Atomics.load(ctx.i32, idx(FOG_ENABLED_OFFSET)) !== 0;
  }
  if (mask & DF_FOG_COLOR && fog) {
    const base = idx(FOG_COLOR_OFFSET);
    fog.color[0] = ctx.f32[base + 0];
    fog.color[1] = ctx.f32[base + 1];
    fog.color[2] = ctx.f32[base + 2];
    fog.color[3] = ctx.f32[base + 3];
  }
  if (mask & DF_FOG_PARAMS0 && fog) {
    const base = idx(FOG_PARAMS0_OFFSET);
    fog.density = Math.max(0, ctx.f32[base + 0]);
    fog.height = ctx.f32[base + 1];
    fog.heightFalloff = Math.max(0, ctx.f32[base + 2]);
    fog.inscatteringIntensity = Math.max(0, ctx.f32[base + 3]);
  }

  if (mask & DF_SUN_ENABLED && sun) {
    sun.enabled = Atomics.load(ctx.i32, idx(SUN_ENABLED_OFFSET)) !== 0;
  }
  if (mask & DF_SUN_DIRECTION && sun) {
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
  if (mask & DF_SUN_COLOR && sun) {
    const base = idx(SUN_COLOR_OFFSET);
    sun.color[0] = Math.max(0, ctx.f32[base + 0]);
    sun.color[1] = Math.max(0, ctx.f32[base + 1]);
    sun.color[2] = Math.max(0, ctx.f32[base + 2]);
    sun.color[3] = Math.max(0, ctx.f32[base + 3]); // intensity in w
  }

  if (shadows) {
    if (mask & DF_SHADOW_MAP_SIZE) {
      const req = Atomics.load(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET)) | 0;
      const clamped = clampShadowMapSize(req);
      shadows.mapSize = clamped;
    }
    if (mask & DF_SHADOW_PARAMS0) {
      const base = idx(SHADOW_PARAMS0_OFFSET);
      shadows.slopeScaleBias = clampFinite(ctx.f32[base + 0], -128, 128);
      shadows.constantBias = clampFinite(ctx.f32[base + 1], 0, 4096);
      // depthBias stored in Shadow uniforms (params0.w in shader)
      shadows.depthBias = clampFinite(ctx.f32[base + 2], 0, 0.1);
      shadows.pcfRadius = clampFinite(ctx.f32[base + 3], 0, 5);
    }
    if (mask & DF_SHADOW_PARAMS1) {
      const base = idx(SHADOW_PARAMS1_OFFSET);
      shadows.orthoHalfExtent = clampFinite(ctx.f32[base + 0], 1, 1e4);
    }
  }
}

function clampShadowMapSize(v: number): number {
  const allowed = [256, 512, 1024, 2048, 4096, 8192];
  const nearest = allowed.reduce(
    (best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best),
    allowed[0],
  );
  return nearest;
}
function clampFinite(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

// Publish a one-time snapshot after world init (WORKER)
export function publishSnapshotFromWorld(
  world: World,
  ctx: EngineStateContext,
): void {
  const fog = world.getResource(FogComponent);
  const sun = world.getResource(SceneSunComponent);
  const shadows = world.getResource(ShadowSettingsComponent);

  if (fog) {
    Atomics.store(ctx.i32, idx(FOG_ENABLED_OFFSET), fog.enabled ? 1 : 0);
    ctx.f32.set(fog.color, idx(FOG_COLOR_OFFSET));
    ctx.f32.set(
      [fog.density, fog.height, fog.heightFalloff, fog.inscatteringIntensity],
      idx(FOG_PARAMS0_OFFSET),
    );
    Atomics.or(
      ctx.i32,
      idx(ENGINE_STATE_FLAGS0_OFFSET),
      DF_FOG_ENABLED | DF_FOG_COLOR | DF_FOG_PARAMS0,
    );
  }
  if (sun) {
    Atomics.store(ctx.i32, idx(SUN_ENABLED_OFFSET), sun.enabled ? 1 : 0);
    ctx.f32.set(
      [sun.direction[0], sun.direction[1], sun.direction[2], 0.0],
      idx(SUN_DIRECTION_OFFSET),
    );
    ctx.f32.set(
      [sun.color[0], sun.color[1], sun.color[2], sun.color[3]],
      idx(SUN_COLOR_OFFSET),
    );
    Atomics.or(
      ctx.i32,
      idx(ENGINE_STATE_FLAGS0_OFFSET),
      DF_SUN_ENABLED | DF_SUN_DIRECTION | DF_SUN_COLOR,
    );
  }
  if (shadows) {
    Atomics.store(ctx.i32, idx(SHADOW_MAP_SIZE_OFFSET), shadows.mapSize | 0);
    ctx.f32.set(
      [
        shadows.slopeScaleBias,
        shadows.constantBias,
        shadows.depthBias,
        shadows.pcfRadius,
      ],
      idx(SHADOW_PARAMS0_OFFSET),
    );
    ctx.f32.set([shadows.orthoHalfExtent, 0, 0, 0], idx(SHADOW_PARAMS1_OFFSET));
    Atomics.or(
      ctx.i32,
      idx(ENGINE_STATE_FLAGS0_OFFSET),
      DF_SHADOW_MAP_SIZE | DF_SHADOW_PARAMS0 | DF_SHADOW_PARAMS1,
    );
  }

  // Write header (last) for visibility diagnostics
  initializeEngineStateHeader(ctx);
}

// Read-only snapshot helper (MAIN thread)
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

  const sunEnabled = Atomics.load(ctx.i32, idx(SUN_ENABLED_OFFSET)) !== 0;
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
    },
    shadow,
  };
}
