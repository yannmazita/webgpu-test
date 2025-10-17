// src/app/physicsWorker/events.ts
import { state } from "@/app/physicsWorker/state";
import {
  CHAR_CONTROLLER_EVENTS_HEAD_OFFSET,
  CHAR_CONTROLLER_EVENTS_TAIL_OFFSET,
  CHAR_CONTROLLER_EVENTS_RING_CAPACITY,
  CHAR_CONTROLLER_EVENTS_SLOT_OFFSET,
  CHAR_CONTROLLER_EVENTS_SLOT_SIZE,
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
  COLLISION_EVENTS_HEAD_OFFSET,
  COLLISION_EVENTS_RING_CAPACITY,
  COLLISION_EVENTS_SLOT_OFFSET,
  COLLISION_EVENTS_SLOT_SIZE,
  COLLISION_EVENTS_TAIL_OFFSET,
  COLLISION_EVENT_FLAG_STARTED,
  COLLISION_EVENT_FLAG_ENDED,
  COLLISION_EVENT_FLAG_SENSOR_ENTERED,
  COLLISION_EVENT_FLAG_SENSOR_EXITED,
  COLLISION_EVENT_PHYS_ID_A_OFFSET,
  COLLISION_EVENT_PHYS_ID_B_OFFSET,
  COLLISION_EVENT_FLAGS_OFFSET,
  COLLISION_EVENT_CONTACT_X_OFFSET,
  COLLISION_EVENT_CONTACT_Y_OFFSET,
  COLLISION_EVENT_CONTACT_Z_OFFSET,
  COLLISION_EVENT_NORMAL_X_OFFSET,
  COLLISION_EVENT_NORMAL_Y_OFFSET,
  COLLISION_EVENT_NORMAL_Z_OFFSET,
  COLLISION_EVENT_IMPULSE_OFFSET,
  COLLISION_EVENT_PENETRATION_OFFSET,
  COLLISION_EVENT_RESERVED_0_OFFSET,
  COLLISION_EVENTS_GEN_OFFSET,
  CHAR_CONTROLLER_EVENTS_GEN_OFFSET,
  CHAR_EVENT_RESERVED_0_OFFSET,
  CHAR_EVENT_RESERVED_1_OFFSET,
} from "@/core/sharedPhysicsLayout";
import {
  getRapierModule,
  KinematicCharacterController,
  RigidBody,
  TempContactForceEvent,
} from "@/core/wasm/rapierModule";
import { floatToInt32Bits } from "@/core/utils/bitConversion";

function checkWallContact(
  controller: KinematicCharacterController,
  body: RigidBody,
): { isContact: boolean; normal: { x: number; y: number; z: number } } {
  const RAPIER = getRapierModule();
  if (!RAPIER || !state.world)
    return { isContact: false, normal: { x: 1, y: 0, z: 0 } };

  const pos = body.translation();
  const velocity = body.linvel();
  const isMovingHorizontally =
    Math.abs(velocity.x) > 0.1 || Math.abs(velocity.z) > 0.1;

  if (!isMovingHorizontally || controller.computedGrounded()) {
    return { isContact: false, normal: { x: 1, y: 0, z: 0 } };
  }

  const moveDir = { x: velocity.x, y: 0, z: velocity.z };
  const moveLength = Math.sqrt(moveDir.x * moveDir.x + moveDir.z * moveDir.z);

  if (moveLength > 0.01) {
    moveDir.x /= moveLength;
    moveDir.z /= moveLength;

    const ray = new RAPIER.Ray(pos, moveDir);
    const hit = state.world.castRay(
      ray,
      0.5,
      true,
      undefined,
      undefined,
      undefined,
      body,
    );

    if (hit && hit.timeOfImpact < 0.3) {
      const hitPoint = ray.pointAt(hit.timeOfImpact);
      const toHit = {
        x: hitPoint.x - pos.x,
        y: hitPoint.y - pos.y,
        z: hitPoint.z - pos.z,
      };
      const length = Math.sqrt(
        toHit.x * toHit.x + toHit.y * toHit.y + toHit.z * toHit.z,
      );

      if (length > 0.01) {
        return {
          isContact: true,
          normal: {
            x: -toHit.x / length,
            y: -toHit.y / length,
            z: -toHit.z / length,
          },
        };
      }
    }
  }

  return { isContact: false, normal: { x: 1, y: 0, z: 0 } };
}

function checkStepClimbed(
  controller: KinematicCharacterController,
  body: RigidBody,
): number {
  const physId = state.bodyToEntity.get(body);
  if (!physId) return 0;

  const prevPos = (
    body.userData as { prevPos?: { x: number; y: number; z: number } }
  )?.prevPos;
  const currPos = body.translation();

  body.userData ??= {};
  (body.userData as { prevPos: { x: number; y: number; z: number } }).prevPos =
    { ...currPos };

  if (prevPos && controller.computedGrounded()) {
    const deltaY = currPos.y - prevPos.y;
    if (deltaY > 0.05 && deltaY < 0.5) {
      return deltaY;
    }
  }

  return 0;
}

function checkCeilingHit(
  controller: KinematicCharacterController,
  body: RigidBody,
): boolean {
  const RAPIER = getRapierModule();
  if (!RAPIER || !state.world) return false;

  const velocity = body.linvel();
  const isTryingToMoveUp = velocity.y > 0.1;

  if (!isTryingToMoveUp) return false;

  const pos = body.translation();
  const ray = new RAPIER.Ray(pos, { x: 0, y: 1, z: 0 });
  const hit = state.world.castRay(
    ray,
    0.5,
    true,
    undefined,
    undefined,
    undefined,
    body,
  );

  return hit !== null && hit.timeOfImpact < 0.3;
}

function getSlideData(
  controller: KinematicCharacterController,
  body: RigidBody,
): { x: number; y: number; z: number; w: number } {
  const velocity = body.linvel();
  const horizontalSpeed = Math.sqrt(
    velocity.x * velocity.x + velocity.z * velocity.z,
  );

  if (horizontalSpeed > 0.01) {
    return {
      x: velocity.x / horizontalSpeed,
      y: 0,
      z: velocity.z / horizontalSpeed,
      w: horizontalSpeed,
    };
  }

  return { x: 0, y: 0, z: 0, w: 0 };
}

function checkSlidingState(
  controller: KinematicCharacterController,
  body: RigidBody,
): { isSliding: boolean; slopeNormal?: { x: number; y: number; z: number } } {
  const RAPIER = getRapierModule();
  if (!RAPIER || !state.world || !controller.computedGrounded()) {
    return { isSliding: false };
  }

  const pos = body.translation();
  const ray = new RAPIER.Ray(pos, { x: 0, y: -1, z: 0 });
  const hit = state.world.castRay(
    ray,
    1.0,
    true,
    undefined,
    undefined,
    undefined,
    body,
  );

  if (hit) {
    const groundNormal = { x: 0, y: 1, z: 0 };
    const slopeAngle = Math.acos(Math.max(-1, Math.min(1, groundNormal.y)));
    const maxSlopeAngle = controller.maxSlopeClimbAngle();
    const isSliding = slopeAngle > maxSlopeAngle;

    return { isSliding, slopeNormal: groundNormal };
  }

  return { isSliding: false };
}

export function publishCharacterControllerEvents(): void {
  const eventsI32 = state.charControllerEventsI32;
  const eventsF32 = state.charControllerEventsF32;

  if (
    !state.world ||
    !eventsI32 ||
    !eventsF32 ||
    state.entityToController.size === 0
  ) {
    return;
  }

  const writeEventVec3 = (
    slotBaseI32: number,
    x: number,
    y: number,
    z: number,
  ): void => {
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_X_OFFSET >> 2)] = x;
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_Y_OFFSET >> 2)] = y;
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA1_Z_OFFSET >> 2)] = z;
  };

  const writeEventData2 = (slotBaseI32: number, value: number): void => {
    eventsF32[slotBaseI32 + (CHAR_EVENT_DATA2_OFFSET >> 2)] = value;
  };

  let head = Atomics.load(eventsI32, CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2);
  const tail = Atomics.load(eventsI32, CHAR_CONTROLLER_EVENTS_TAIL_OFFSET >> 2);
  let eventsPublished = 0;

  state.entityToController.forEach((controller, physId) => {
    const body = state.entityToBody.get(physId);
    if (!body) return;

    const grounded = controller.computedGrounded();
    const prevOnGround = state.playerOnGround.get(physId) ?? 0.0;
    const currOnGround = grounded ? 1.0 : 0.0;

    if (prevOnGround !== currOnGround) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        currOnGround > 0.5 ? CHAR_EVENT_GROUNDED : CHAR_EVENT_AIRBORNE,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, 0.0, 0.0);
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const wallContact = checkWallContact(controller, body);
    if (wallContact.isContact) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_WALL_CONTACT,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(
        slotBaseI32,
        wallContact.normal.x,
        wallContact.normal.y,
        wallContact.normal.z,
      );
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const stepHeight = checkStepClimbed(controller, body);
    if (stepHeight > 0) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_STEP_CLIMBED,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, 0.0, 0.0);
      writeEventData2(slotBaseI32, stepHeight);

      head = nextHead;
      eventsPublished++;
    }

    if (checkCeilingHit(controller, body)) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        CHAR_EVENT_CEILING_HIT,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );
      writeEventVec3(slotBaseI32, 0.0, -1.0, 0.0);
      writeEventData2(slotBaseI32, 0.0);

      head = nextHead;
      eventsPublished++;
    }

    const slidingState = checkSlidingState(controller, body);
    const prevSliding = state.playerSliding.get(physId) ?? false;
    const currSliding = slidingState.isSliding;

    if (prevSliding !== currSliding) {
      const nextHead = (head + 1) % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      if (nextHead === tail) return;

      const slotIndex = head % CHAR_CONTROLLER_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (CHAR_CONTROLLER_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (CHAR_CONTROLLER_EVENTS_SLOT_SIZE >> 2);

      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_PHYS_ID_OFFSET >> 2),
        physId,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_TYPE_OFFSET >> 2),
        currSliding ? CHAR_EVENT_SLIDE_START : CHAR_EVENT_SLIDE_STOP,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_GROUND_ENTITY_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );
      Atomics.store(
        eventsI32,
        slotBaseI32 + (CHAR_EVENT_RESERVED_1_OFFSET >> 2),
        0,
      );

      const slideData = getSlideData(controller, body);
      writeEventVec3(slotBaseI32, slideData.x, slideData.y, slideData.z);
      writeEventData2(slotBaseI32, slideData.w);

      head = nextHead;
      eventsPublished++;
    }

    state.playerOnGround.set(physId, currOnGround);
    state.playerSliding.set(physId, currSliding);
  });

  if (eventsPublished > 0) {
    Atomics.store(eventsI32, CHAR_CONTROLLER_EVENTS_HEAD_OFFSET >> 2, head);
    Atomics.add(eventsI32, CHAR_CONTROLLER_EVENTS_GEN_OFFSET >> 2, 1);
  }
}

export function publishCollisionEvents(): void {
  if (!state.world || !state.eventQueue || !state.collisionEventsI32) {
    return;
  }

  let head = Atomics.load(
    state.collisionEventsI32,
    COLLISION_EVENTS_HEAD_OFFSET >> 2,
  );
  const tail = Atomics.load(
    state.collisionEventsI32,
    COLLISION_EVENTS_TAIL_OFFSET >> 2,
  );

  let eventsPublished = 0;

  const collisionEvents = new Map<
    string,
    {
      started: boolean;
      handle1: number;
      handle2: number;
      physIdA?: number;
      physIdB?: number;
      isSensor: boolean;
    }
  >();

  state.eventQueue.drainCollisionEvents(
    (handle1: number, handle2: number, started: boolean) => {
      const collider1 = state.world?.colliders.get(handle1);
      const collider2 = state.world?.colliders.get(handle2);
      if (!collider1 || !collider2) return;

      const body1 = collider1.parent();
      const body2 = collider2.parent();
      if (!body1 || !body2) return;

      const physIdA = state.bodyToEntity.get(body1);
      const physIdB = state.bodyToEntity.get(body2);
      if (!physIdA || !physIdB) return;

      const key = `${handle1}-${handle2}`;
      collisionEvents.set(key, {
        started,
        handle1,
        handle2,
        physIdA,
        physIdB,
        isSensor: collider1.isSensor() || collider2.isSensor(),
      });
    },
  );

  state.eventQueue.drainContactForceEvents(
    (tempContactForceEvent: TempContactForceEvent) => {
      const handle1 = tempContactForceEvent.collider1();
      const handle2 = tempContactForceEvent.collider2();

      const key1 = `${handle1}-${handle2}`;
      const key2 = `${handle2}-${handle1}`;
      const collision = collisionEvents.get(key1) ?? collisionEvents.get(key2);

      if (!collision) {
        const collider1 = state.world?.colliders.get(handle1);
        const collider2 = state.world?.colliders.get(handle2);
        if (!collider1 || !collider2) return;

        const body1 = collider1.parent();
        const body2 = collider2.parent();
        if (!body1 || !body2) return;

        const physIdA = state.bodyToEntity.get(body1);
        const physIdB = state.bodyToEntity.get(body2);
        if (!physIdA || !physIdB) return;

        collisionEvents.set(key1, {
          started: true,
          handle1,
          handle2,
          physIdA,
          physIdB,
          isSensor: collider1.isSensor() || collider2.isSensor(),
        });
      }

      const nextHead = (head + 1) % COLLISION_EVENTS_RING_CAPACITY;
      if (nextHead === tail) {
        return;
      }

      const slotIndex = head % COLLISION_EVENTS_RING_CAPACITY;
      const slotBaseI32 =
        (COLLISION_EVENTS_SLOT_OFFSET >> 2) +
        slotIndex * (COLLISION_EVENTS_SLOT_SIZE >> 2);

      const physIdA =
        state.bodyToEntity.get(
          state.world?.colliders.get(handle1)?.parent() ?? null,
        ) ?? 0;
      const physIdB =
        state.bodyToEntity.get(
          state.world?.colliders.get(handle2)?.parent() ?? null,
        ) ?? 0;

      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PHYS_ID_A_OFFSET >> 2),
        physIdA,
      );
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PHYS_ID_B_OFFSET >> 2),
        physIdB,
      );

      let flags = COLLISION_EVENT_FLAG_STARTED;
      if (
        state.world?.colliders.get(handle1)?.isSensor() ||
        state.world?.colliders.get(handle2)?.isSensor()
      ) {
        flags = COLLISION_EVENT_FLAG_SENSOR_ENTERED;
      }
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_FLAGS_OFFSET >> 2),
        flags,
      );

      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_RESERVED_0_OFFSET >> 2),
        0,
      );

      const maxForceDirection = tempContactForceEvent.maxForceDirection();
      const maxForceMagnitude = tempContactForceEvent.maxForceMagnitude();

      const collider1 = state.world?.colliders.get(handle1);
      const collider2 = state.world?.colliders.get(handle2);

      let contactPoint = { x: 0, y: 0, z: 0 };
      if (collider1 && collider2) {
        const pos1 = collider1.translation();
        const pos2 = collider2.translation();
        contactPoint = {
          x: (pos1.x + pos2.x) / 2,
          y: (pos1.y + pos2.y) / 2,
          z: (pos1.z + pos2.z) / 2,
        };
      }

      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_X_OFFSET >> 2),
        floatToInt32Bits(contactPoint.x),
      );
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_Y_OFFSET >> 2),
        floatToInt32Bits(contactPoint.y),
      );
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_CONTACT_Z_OFFSET >> 2),
        floatToInt32Bits(contactPoint.z),
      );

      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_X_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.x),
      );
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_Y_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.y),
      );
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_NORMAL_Z_OFFSET >> 2),
        floatToInt32Bits(maxForceDirection.z),
      );

      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_IMPULSE_OFFSET >> 2),
        floatToInt32Bits(maxForceMagnitude),
      );

      const estimatedPenetration = Math.min(maxForceMagnitude / 1000.0, 0.1);
      Atomics.store(
        state.collisionEventsI32,
        slotBaseI32 + (COLLISION_EVENT_PENETRATION_OFFSET >> 2),
        floatToInt32Bits(estimatedPenetration),
      );

      tempContactForceEvent.free();

      head = nextHead;
      eventsPublished++;
    },
  );

  collisionEvents.forEach((collision, key) => {
    const nextHead = (head + 1) % COLLISION_EVENTS_RING_CAPACITY;
    if (nextHead === tail) return;

    const slotIndex = head % COLLISION_EVENTS_RING_CAPACITY;
    const slotBaseI32 =
      (COLLISION_EVENTS_SLOT_OFFSET >> 2) +
      slotIndex * (COLLISION_EVENTS_SLOT_SIZE >> 2);

    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PHYS_ID_A_OFFSET >> 2),
      collision.physIdA,
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PHYS_ID_B_OFFSET >> 2),
      collision.physIdB,
    );

    let flags = collision.started
      ? COLLISION_EVENT_FLAG_STARTED
      : COLLISION_EVENT_FLAG_ENDED;
    if (collision.isSensor) {
      flags = collision.started
        ? COLLISION_EVENT_FLAG_SENSOR_ENTERED
        : COLLISION_EVENT_FLAG_SENSOR_EXITED;
    }
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_FLAGS_OFFSET >> 2),
      flags,
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_RESERVED_0_OFFSET >> 2),
      0,
    );

    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_X_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_Y_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_CONTACT_Z_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_X_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_Y_OFFSET >> 2),
      floatToInt32Bits(1.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_NORMAL_Z_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_IMPULSE_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );
    Atomics.store(
      state.collisionEventsI32,
      slotBaseI32 + (COLLISION_EVENT_PENETRATION_OFFSET >> 2),
      floatToInt32Bits(0.0),
    );

    head = nextHead;
    eventsPublished++;
  });

  if (eventsPublished > 0) {
    Atomics.store(
      state.collisionEventsI32,
      COLLISION_EVENTS_HEAD_OFFSET >> 2,
      head,
    );
    Atomics.add(state.collisionEventsI32, COLLISION_EVENTS_GEN_OFFSET >> 2, 1);
  }
}
