// src/core/ecs/components/animationComponent.ts

import { IComponent } from "@/core/ecs/component";
import { AnimationClip } from "@/core/types/animation";

/**
 * Manages the animation state for an entity.
 *
 * This component holds a list of available animation clips and controls the
 * playback state, such as which clip is active, the current time, playback
 * speed, and looping behavior. The {@link animationSystem} uses this
 * component to drive updates to the entity's transform or skeleton.
 */
export class AnimationComponent implements IComponent {
  /** The list of animation clips available to this entity. */
  public clips: AnimationClip[] = [];
  /** The index of the currently active clip in the `clips` array. */
  public activeClipIndex = 0;
  /** The current playback time of the active animation, in seconds. */
  public time = 0.0;
  /** A multiplier for the animation playback speed. 1.0 is normal speed. */
  public speed = 1.0;
  /** Whether the active animation should loop when it reaches the end. */
  public loop = true;
  /** Whether the animation is currently playing. */
  public playing = true;

  /**
   * Creates an instance of AnimationComponent.
   * @param {AnimationClip[]} [clips] An optional array of animation clips to
   *     initialize the component with.
   */
  constructor(clips?: AnimationClip[]) {
    if (clips && clips.length > 0) {
      this.clips = clips;
    }
  }

  /**
   * Retrieves the currently active animation clip based on `activeClipIndex`.
   *
   * This method safely handles out-of-bounds indices by clamping them to the
   * valid range of the `clips` array.
   *
   * @returns {AnimationClip | null} The active animation clip, or null if no
   *     clips are available.
   */
  public getActiveClip(): AnimationClip | null {
    if (this.clips.length === 0) return null;
    const idx = Math.max(
      0,
      Math.min(this.activeClipIndex, this.clips.length - 1),
    );
    return this.clips[idx] ?? null;
  }
}
