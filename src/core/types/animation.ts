// src/core/types/animation.ts

import { Entity } from "@/core/ecs/entity";

/**
 * The interpolation method to use between keyframes.
 * - `LINEAR`: Linear interpolation. For quaternions, this implies Spherical
 *   Linear Interpolation (SLERP).
 * - `STEP`: No interpolation; the value of the previous keyframe is held
 *   until the next keyframe.
 * - `CUBICSPLINE`: Cubic spline interpolation. The `values` array will
 *   contain triplets of [in-tangent, value, out-tangent].
 */
export type AnimationInterpolation = "LINEAR" | "STEP" | "CUBICSPLINE";

/**
 * The property of a TransformComponent that an animation channel targets.
 */
export type AnimationPath = "translation" | "rotation" | "scale";

/**
 * Stores keyframe data for a single animated property (ex: translation).
 * This is a runtime representation of a glTF animation sampler.
 */
export interface AnimationSampler {
  /**
   * An array of keyframe timestamps, in seconds. Each time corresponds to a
   * value in the "values" array. The array must be strictly increasing.
   */
  times: Float32Array;
  /**
   * A flattened array of keyframe values. The layout depends on the `path`
   * and `interpolation` method. For example, for a `rotation` path with
   * `LINEAR` interpolation, this will be a sequence of quaternions
   * `[x, y, z, w, x, y, z, w, ...]`.
   */
  values: Float32Array;
  /** The interpolation method to use between keyframes. */
  interpolation: AnimationInterpolation;
  /**
   * The number of floats that represent a single keyframe's value.
   * For example, 3 for `translation` (vec3), 4 for `rotation` (quat).
   */
  valueStride: number;
}

/**
 * Connects an animation sampler to a specific property of a target entity.
 * This is a runtime representation of a glTF animation channel.
 */
export interface AnimationChannel {
  /** The entity whose `TransformComponent` will be modified by this channel. */
  targetEntity: Entity;
  /** Which property of the transform (`translation`, `rotation`, or `scale`) to modify. */
  path: AnimationPath;
  /** The sampler containing the keyframe data for this channel. */
  sampler: AnimationSampler;
}

/**
 * A collection of animation channels that together define a complete animation.
 * This is a runtime representation of a glTF animation.
 */
export interface AnimationClip {
  /** The name of the animation clip (ex: "Run", "Idle", "Jump"). */
  name: string;
  /** The total duration of the animation clip in seconds. */
  duration: number;
  /** The set of channels that make up this animation. */
  channels: AnimationChannel[];
}
