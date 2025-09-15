// src/core/ecs/systems/animationSystem.ts

import { World } from "@/core/ecs/world";
import { AnimationComponent } from "@/core/ecs/components/animationComponent";
import { TransformComponent } from "@/core/ecs/components/transformComponent";
import { AnimationChannel, AnimationSampler } from "@/core/types/animation";
import { quat, Quat } from "wgpu-matrix";

/**
 * Finds the index of the keyframe that precedes or is at the given time `t`.
 * This function is a prerequisite for interpolation, as it identifies the two
 * keyframes to interpolate between. It uses a binary search for efficiency.
 * @param times A sorted array of keyframe times.
 * @param t The current animation time to find the keyframe for.
 * @return The index `i` such that `times[i] <= t`.
 * @private
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
 * @private
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

/**
 * Samples an animation sampler at a specific time `t` to get an interpolated
 * value. It handles different interpolation types (STEP, LINEAR).
 * @param  s The sampler to evaluate.
 * @param  t The current animation time.
 * @param  outVec3 Optional. The array to write vec3 results to.
 * @param  outQuat Optional. The array to write quat results to.
 * @private
 */
function sampleSampler(
  s: AnimationSampler,
  t: number,
  outVec3?: Float32Array,
  outQuat?: Float32Array,
): void {
  const times = s.times;
  const idx = findKeyframeIndex(times, t);
  const last = times.length - 1;
  const i0 = idx;
  const i1 = Math.min(idx + 1, last);
  const t0 = times[i0];
  const t1 = times[i1];

  if (s.valueStride === 3) {
    // vec3 channels: translation or scale
    let x: number, y: number, z: number;
    switch (s.interpolation) {
      case "STEP": {
        const base = i0 * 3;
        x = s.values[base + 0];
        y = s.values[base + 1];
        z = s.values[base + 2];
        break;
      }
      case "LINEAR":
      default: {
        [x, y, z] = sampleVec3Linear(s.values, i0, i1, t0, t1, t);
        break;
      }
      // CUBICSPLINE not implemented for vec3 in this first pass
    }
    if (outVec3) {
      outVec3[0] = x;
      outVec3[1] = y;
      outVec3[2] = z;
    }
    return;
  }

  if (s.valueStride === 4) {
    // quat channel: rotation
    switch (s.interpolation) {
      case "STEP": {
        const base = i0 * 4;
        if (outQuat) {
          outQuat[0] = s.values[base + 0];
          outQuat[1] = s.values[base + 1];
          outQuat[2] = s.values[base + 2];
          outQuat[3] = s.values[base + 3];
        }
        break;
      }
      case "LINEAR":
      default: {
        const q = sampleQuatLinear(s.values, i0, i1, t0, t1, t);
        if (outQuat) {
          outQuat[0] = q[0];
          outQuat[1] = q[1];
          outQuat[2] = q[2];
          outQuat[3] = q[3];
        }
        break;
      }
      // CUBICSPLINE for rotation (component-wise) is not implemented in this pass
    }
    return;
  }
}

/**
 * Applies the interpolated value of a single animation channel to its target
 * entity's TransformComponent.
 * @param world The ECS world.
 * @param channel The channel to apply.
 * @param t The current animation time.
 * @param tmpVec3 A temporary vec3 array to avoid allocations.
 * @param tmpQuat A temporary quat array to avoid allocations.
 * @private
 */
function applyChannel(
  world: World,
  channel: AnimationChannel,
  t: number,
  tmpVec3: Float32Array,
  tmpQuat: Float32Array,
): void {
  const transform = world.getComponent(
    channel.targetEntity,
    TransformComponent,
  );
  if (!transform) return;

  if (channel.path === "translation") {
    sampleSampler(channel.sampler, t, tmpVec3, undefined);
    transform.setPosition(tmpVec3[0], tmpVec3[1], tmpVec3[2]);
    return;
  }

  if (channel.path === "scale") {
    sampleSampler(channel.sampler, t, tmpVec3, undefined);
    transform.setScale(tmpVec3[0], tmpVec3[1], tmpVec3[2]);
    return;
  }

  if (channel.path === "rotation") {
    sampleSampler(channel.sampler, t, undefined, tmpQuat);
    transform.setRotation(tmpQuat as unknown as quat);
    return;
  }
}

/**
 * Updates all active animations in the world.
 *
 * This system queries for entities with an `AnimationComponent`, advances their
 * playback time, and applies the interpolated keyframe values from the active
 * animation clip to the `TransformComponent` of the target entities. It should
 * be run before the `transformSystem` to ensure that transform matrices are
 * updated based on the new animated values.
 *
 * @param world The world containing the entities.
 * @param deltaTime The time elapsed since the last frame in seconds.
 */
export function animationSystem(world: World, deltaTime: number): void {
  const entities = world.query([AnimationComponent]);
  if (entities.length === 0) return;

  // Reusable temporaries
  const tmpV = new Float32Array(3);
  const tmpQ = new Float32Array(4);

  for (const e of entities) {
    const anim = world.getComponent(e, AnimationComponent)!;
    const clip = anim.getActiveClip();
    if (!clip || !anim.playing) continue;

    // Advance time
    let t = anim.time + deltaTime * anim.speed;
    if (anim.loop) {
      const dur = clip.duration > 0 ? clip.duration : 0.000001;
      // keep t in [0, dur)
      t = t - Math.floor(t / dur) * dur;
    } else {
      t = Math.min(t, clip.duration);
    }
    anim.time = t;

    // Apply all channels
    for (const ch of clip.channels) {
      applyChannel(world, ch, t, tmpV, tmpQ);
    }
  }
}
