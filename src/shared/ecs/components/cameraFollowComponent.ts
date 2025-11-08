// src/shared/ecs/components/cameraFollowComponent.ts
import { IComponent } from "@/shared/ecs/component";
import { Entity } from "@/shared/ecs/entity";
import { Vec3, vec3 } from "wgpu-matrix";

/**
 * A component that makes its entity's transform follow another target entity.
 * Typically used on a camera to follow the player.
 */
export class CameraFollowComponent implements IComponent {
  /** The entity to follow. */
  public target: Entity;

  /** The position offset from the target's position. */
  public positionOffset: Vec3 = vec3.create(0, 0, 0);

  /**
   * If true, the component will not only match the target's position (with offset)
   * but also its rotation. If false, it only follows position.
   * For an FPS camera, this should be false, as the camera's pitch is
   * controlled independently from the player body's rotation.
   */
  public followRotation = false;

  constructor(target: Entity, offset: Vec3 = vec3.create(0, 0, 0)) {
    this.target = target;
    vec3.copy(offset, this.positionOffset);
  }
}
