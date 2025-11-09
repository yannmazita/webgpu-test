// src/shared/ecs/systems/clientOnly/animationSystem.ts
import { World } from "@/shared/ecs/world";
import { AnimationComponent } from "@/shared/ecs/components/gameplay/animationComponent";
import { TransformComponent } from "@/shared/ecs/components/gameplay/transformComponent";
import {
  AnimationChannel,
  AnimationPath,
  AnimationSampler,
} from "@/shared/types/animation";
import { quat, Quat } from "wgpu-matrix";
import { MeshRendererComponent } from "@/shared/ecs/components/clientOnly/meshRendererComponent";
import { ResourceCacheComponent } from "@/shared/ecs/components/resources/resourceCacheComponent";

/**
 * Finds the index of the keyframe that precedes or is at the given time `t`.
 * This function is a prerequisite for interpolation, as it identifies the two
 * keyframes to interpolate between. It uses a binary search for efficiency.
 * @param times A sorted array of keyframe times.
 * @param t The current animation time to find the keyframe for.
 * @return The index `i` such that `times[i] <= t`.
 */
function findKeyframeIndex(times: Float32Array, t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]) return 0;
  if (t >= times[n - 1]) return n - 1;

  // Binary search
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Performs linear interpolation between two vec3 values from a sampler's
 * values array.
 * @param values The flattened array of keyframe values.
 * @param i0 The index of the first keyframe.
 * @param i1 The index of the second keyframe.
 * @param t0 The time of the first keyframe.
 * @param t1 The time of the second keyframe.
 * @param t The current animation time.
 * @return The interpolated vec3 value.
 */
function sampleVec3Linear(
  values: Float32Array,
  i0: number,
  i1: number,
  t0: number,
  t1: number,
  t: number,
): [number, number, number] {
  const base0 = i0 * 3;
  const base1 = i1 * 3;
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;

  const x = values[base0 + 0] + (values[base1 + 0] - values[base0 + 0]) * u;
  const y = values[base0 + 1] + (values[base1 + 1] - values[base0 + 1]) * u;
  const z = values[base0 + 2] + (values[base1 + 2] - values[base0 + 2]) * u;
  return [x, y, z];
}

/**
 * Performs spherical linear interpolation (slerp) between two quaternion
 * values from a sampler's values array.
 * @param values The flattened array of keyframe values.
 * @param i0 The index of the first keyframe.
 * @param i1 The index of the second keyframe.
 * @param t0 The time of the first keyframe.
 * @param t1 The time of the second keyframe.
 * @param t The current animation time.
 * @return The interpolated quaternion value.
 * @private
 */
function sampleQuatLinear(
  values: Float32Array,
  i0: number,
  i1: number,
  t0: number,
  t1: number,
  t: number,
): Quat {
  const base0 = i0 * 4;
  const base1 = i1 * 4;
  const q0 = quat.fromValues(
    values[base0],
    values[base0 + 1],
    values[base0 + 2],
    values[base0 + 3],
  );
  const q1 = quat.fromValues(
    values[base1],
    values[base1 + 1],
    values[base1 + 2],
    values[base1 + 3],
  );
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  const out = quat.create();
  quat.slerp(q0, q1, u, out);
  return out;
}

function sampleSampler(
  s: AnimationSampler,
  path: AnimationPath,
  t: number,
  outValue: Float32Array,
): void {
  const times = s.times;
  const idx = findKeyframeIndex(times, t);
  const last = times.length - 1;
  const i0 = idx;
  const i1 = Math.min(idx + 1, last);
  const t0 = times[i0];
  const t1 = times[i1];

  if (s.valueStride === 3) {
    // vec3
    let x: number, y: number, z: number;
    switch (s.interpolation) {
      case "STEP": {
        const base = i0 * 3;
        x = s.values[base + 0];
        y = s.values[base + 1];
        z = s.values[base + 2];
        break;
      }
      default: {
        // LINEAR
        [x, y, z] = sampleVec3Linear(s.values, i0, i1, t0, t1, t);
        break;
      }
    }
    outValue[0] = x;
    outValue[1] = y;
    outValue[2] = z;
    return;
  }

  if (s.valueStride === 4) {
    // quat or vec4
    switch (s.interpolation) {
      case "STEP": {
        const base = i0 * 4;
        outValue[0] = s.values[base + 0];
        outValue[1] = s.values[base + 1];
        outValue[2] = s.values[base + 2];
        outValue[3] = s.values[base + 3];
        break;
      }
      default: {
        // LINEAR
        // Check if it's a quaternion or just a vec4 (like color)
        if (path.property === "rotation") {
          const q = sampleQuatLinear(s.values, i0, i1, t0, t1, t);
          outValue[0] = q[0];
          outValue[1] = q[1];
          outValue[2] = q[2];
          outValue[3] = q[3];
        } else {
          // Linear interpolate vec4
          const base0 = i0 * 4;
          const base1 = i1 * 4;
          const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
          for (let i = 0; i < 4; ++i) {
            outValue[i] =
              s.values[base0 + i] +
              (s.values[base1 + i] - s.values[base0 + i]) * u;
          }
        }
        break;
      }
    }
    return;
  }
}

function applyChannel(
  world: World,
  channel: AnimationChannel,
  t: number,
  tmpValue: Float32Array,
): void {
  const path = channel.path;
  const component = world.getComponent(channel.targetEntity, path.component);
  if (!component) return;

  sampleSampler(channel.sampler, path, t, tmpValue);

  if (component instanceof TransformComponent) {
    switch (path.property) {
      case "translation":
        component.setPosition(tmpValue[0], tmpValue[1], tmpValue[2]);
        break;
      case "rotation":
        component.setRotation(tmpValue as unknown as Quat);
        break;
      case "scale":
        component.setScale(tmpValue[0], tmpValue[1], tmpValue[2]);
        break;
    }
  } else if (component instanceof MeshRendererComponent) {
    const cache = world.getResource(ResourceCacheComponent);
    if (!cache) return;

    // Resolve the material handle from the cache
    const material = cache.getMaterial(component.materialHandle.key);

    // If the material is loaded, update its uniform.
    if (material) {
      material.updateUniform(path.property, tmpValue);
    }
  }
}

/**
 * Updates all active animations in the world.
 *
 * @remarks
 * This system queries for entities with an `AnimationComponent`, advances their
 * playback time, and applies the interpolated keyframe values from the active
 * animation clip to the target components. It should be run before the
 * `transformSystem` to ensure that transform matrices are updated based on the
 * new animated values.
 *
 * @param world - The world containing the entities.
 * @param deltaTime - The time elapsed since the last frame in seconds.
 */
export function animationSystem(world: World, deltaTime: number): void {
  const entities = world.query([AnimationComponent]);
  if (entities.length === 0) return;

  // Reusable temporaries
  const tmpValue = new Float32Array(4); // Max stride is 4 (quat/vec4)

  for (const e of entities) {
    const anim = world.getComponent(e, AnimationComponent);
    if (!anim) continue;
    const clip = anim.getActiveClip();
    if (!clip || !anim.playing) continue;

    // Advance time
    let t = anim.time + deltaTime * anim.speed;
    if (anim.loop) {
      const dur = clip.duration > 0 ? clip.duration : 1e-6;
      t = t % dur;
    } else {
      t = Math.min(t, clip.duration);
    }
    anim.time = t;

    // Apply all channels
    for (const ch of clip.channels) {
      applyChannel(world, ch, t, tmpValue);
    }
  }
}
