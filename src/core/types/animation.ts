// src/core/types/animation.ts

import { Entity } from "@/core/ecs/entity";
import { ComponentConstructor } from "@/core/ecs/component";

export type AnimationInterpolation = "LINEAR" | "STEP" | "CUBICSPLINE";

/**
 * Defines the target property of an animation channel.
 * For transforms, property is "translation", "rotation", or "scale".
 * For materials, it's a glTF JSON Pointer path like "pbrMetallicRoughness/baseColorFactor".
 */
export interface AnimationPath {
  component: ComponentConstructor;
  property: string;
}

export interface AnimationSampler {
  // Keyframe times in seconds (strictly increasing)
  times: Float32Array;
  // Flattened values array:
  // - translation/scale: vec3 (stride 3)
  // - rotation: quat (stride 4)
  // - CUBICSPLINE (not fully implemented yet): [inTangent, value, outTangent] per key
  values: Float32Array;
  interpolation: AnimationInterpolation;
  // Number of floats per output "value": 3 for vec3, 4 for quat
  valueStride: number;
}

export interface AnimationChannel {
  targetEntity: Entity; // The entity whose component to drive
  path: AnimationPath; // Which component and property this channel modifies
  sampler: AnimationSampler; // Keyframe sampler
}

export interface AnimationClip {
  name: string;
  duration: number; // In seconds
  channels: AnimationChannel[];
}
