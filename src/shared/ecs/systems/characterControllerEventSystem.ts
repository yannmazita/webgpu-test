// src/shared/ecs/systems/characterControllerEventSystem.ts
import { World } from "@/shared/ecs/world";
import { PhysicsContext } from "@/shared/state/physicsState";
import { EventManager } from "@/shared/ecs/events/eventManager";
import {
  CHAR_CONTROLLER_EVENTS_HEAD_OFFSET,
  CHAR_CONTROLLER_EVENTS_RING_CAPACITY,
  CHAR_CONTROLLER_EVENTS_SLOT_OFFSET,
  CHAR_CONTROLLER_EVENTS_SLOT_SIZE,
  CHAR_CONTROLLER_EVENTS_TAIL_OFFSET,
  CHAR_EVENT_PHYS_ID_OFFSET,
  CHAR_EVENT_TYPE_OFFSET,
  CHAR_EVENT_DATA1_X_OFFSET,
  CHAR_EVENT_DATA1_Y_OFFSET,
  CHAR_EVENT_DATA1_Z_OFFSET,
  CHAR_EVENT_DATA2_OFFSET,
  CHAR_EVENT_GROUND_ENTITY_OFFSET,
  CHAR_EVENT_GROUNDED,
  CHAR_EVENT_AIRBORNE,
  CHAR_EVENT_WALL_CONTACT,
  CHAR_EVENT_STEP_CLIMBED,
  CHAR_EVENT_CEILING_HIT,
  CHAR_EVENT_SLIDE_START,
  CHAR_EVENT_SLIDE_STOP,
} from "@/shared/state/sharedPhysicsLayout";
import { int32BitsToFloat, toIndex } from "@/shared/utils/bitConversion";
import { vec3 } from "wgpu-matrix";

/**
 * System that processes character controller events from the physics worker and
 * republishes them as structured ECS events.
 *
 * @remarks
 * The character-controller layout stores offsets in bytes. Each offset is converted
 * with `toIndex` before indexing into the shared Int32Array so that normals, heights, and
 * referenced entity IDs remain accurate.
 */
export class CharacterControllerEventSystem {
  constructor(
    private world: World,
    private physCtx: PhysicsContext,
    private eventManager: EventManager,
  ) {}

  /**
   * Reads and processes all available character controller events from the shared buffer.
   */
  public update(): void {
    const view = this.physCtx.charControllerEventsI32;
    if (!view) return;

    let tail = Atomics.load(view, toIndex(CHAR_CONTROLLER_EVENTS_TAIL_OFFSET));
    const head = Atomics.load(
      view,
      toIndex(CHAR_CONTROLLER_EVENTS_HEAD_OFFSET),
    );

    let processedAny = false;

    while (tail !== head) {
      const slotIndex = tail % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        toIndex(CHAR_CONTROLLER_EVENTS_SLOT_OFFSET) +
        slotIndex * toIndex(CHAR_CONTROLLER_EVENTS_SLOT_SIZE);

      // Read event data
      const physId = Atomics.load(
        view,
        slotBaseI32 + toIndex(CHAR_EVENT_PHYS_ID_OFFSET),
      );
      const eventType = Atomics.load(
        view,
        slotBaseI32 + toIndex(CHAR_EVENT_TYPE_OFFSET),
      );

      // Read additional data (interpretation depends on event type)
      const data1X = int32BitsToFloat(
        Atomics.load(view, slotBaseI32 + toIndex(CHAR_EVENT_DATA1_X_OFFSET)),
      );
      const data1Y = int32BitsToFloat(
        Atomics.load(view, slotBaseI32 + toIndex(CHAR_EVENT_DATA1_Y_OFFSET)),
      );
      const data1Z = int32BitsToFloat(
        Atomics.load(view, slotBaseI32 + toIndex(CHAR_EVENT_DATA1_Z_OFFSET)),
      );
      const data2 = int32BitsToFloat(
        Atomics.load(view, slotBaseI32 + toIndex(CHAR_EVENT_DATA2_OFFSET)),
      );
      const groundEntity = Atomics.load(
        view,
        slotBaseI32 + toIndex(CHAR_EVENT_GROUND_ENTITY_OFFSET),
      );

      // Dispatch based on event type
      switch (eventType) {
        case CHAR_EVENT_GROUNDED:
          this.eventManager.publish({
            type: "ground-state-changed",
            payload: {
              entity: physId,
              isGrounded: true,
              groundEntity: groundEntity !== -1 ? groundEntity : undefined,
            },
          });
          break;

        case CHAR_EVENT_AIRBORNE:
          this.eventManager.publish({
            type: "ground-state-changed",
            payload: {
              entity: physId,
              isGrounded: false,
            },
          });
          break;

        case CHAR_EVENT_WALL_CONTACT:
          this.eventManager.publish({
            type: "wall-contact",
            payload: {
              entity: physId,
              wallNormal: vec3.create(data1X, data1Y, data1Z),
              wallEntity: groundEntity !== -1 ? groundEntity : undefined,
            },
          });
          break;

        case CHAR_EVENT_STEP_CLIMBED:
          this.eventManager.publish({
            type: "step-climbed",
            payload: {
              entity: physId,
              stepHeight: data2,
            },
          });
          break;

        case CHAR_EVENT_CEILING_HIT:
          this.eventManager.publish({
            type: "ceiling-hit",
            payload: {
              entity: physId,
              ceilingEntity: groundEntity !== -1 ? groundEntity : undefined,
            },
          });
          break;

        case CHAR_EVENT_SLIDE_START:
          this.eventManager.publish({
            type: "sliding-state-changed",
            payload: {
              entity: physId,
              isSliding: true,
            },
          });
          break;

        case CHAR_EVENT_SLIDE_STOP:
          this.eventManager.publish({
            type: "sliding-state-changed",
            payload: {
              entity: physId,
              isSliding: false,
            },
          });
          break;
      }

      tail = (tail + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      processedAny = true;
    }

    if (processedAny) {
      Atomics.store(view, toIndex(CHAR_CONTROLLER_EVENTS_TAIL_OFFSET), tail);
    }
  }
}
