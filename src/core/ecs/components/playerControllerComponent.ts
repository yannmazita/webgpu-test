// src/core/ecs/components/playerControllerComponent.ts
import { IComponent } from "@/core/ecs/component";
import { vec3, Vec3 } from "wgpu-matrix";

export class PlayerControllerComponent implements IComponent {
  public moveSpeed = 5.0;
  public jumpForce = 7.5; // m/s upward impulse
  public sensitivity = 0.002;

  public pitch = 0;
  public yaw = 0;

  /**
   * True if player is on ground (synced from physics snapshot).
   * Used to prevent mid-air jumps.
   */
  public onGround = false;

  /**
   * Stores the player's intent to jump, decoupling the single-frame input
   * from the physics state.
   */
  public jumpRequested = false;

  /**
   * Controller parameters (passed to Rapier on create).
   * slopeAngle: Max climbable slope (radians, default PI/4 = 45°).
   * maxStepHeight: Max step to auto-climb (meters, default 0.5).
   * slideEnabled: Allow sliding on steep slopes (default true).
   * maxSlopeForGround: Angle to consider "ground" (radians, default PI/3 = 60°).
   */
  public slopeAngle = Math.PI / 4;
  public maxStepHeight = 0.5;
  public slideEnabled = true;
  public maxSlopeForGround = Math.PI / 3;

  /**
   * Manual velocity tracking (for air control/gravity in kinematic mode).
   * Synced from physics; unused in v1 (simple jump).
   */
  public velocity: Vec3 = vec3.create();
}
