import type {
  CharacterControllerInput,
  CharacterControllerSnapshot,
  CharacterGroundQuery,
  CharacterMovementQuery,
  CharacterWorldAdapter,
  Vec3
} from "./test-api.js";
import {
  CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
  CharacterController,
  assert,
  createFlatGroundCharacterWorld,
  resolveCharacterControllerConfig
} from "./test-api.js";

export function runCharacterControllerTests(): void {
  runDeterministicReplayAndSubdivisionTests();
  runMovementTurningAndStopTests();
  runJumpBufferCoyoteAndLandingTests();
  runJumpBufferZeroAndNoSubstepTests();
  runCrouchProgressionTests();
  runInvalidConfigAndInputTests();
  runAdapterGroundingContractTests();
  runAdapterFailureAndBoundsTests();
  runStateRestoreTests();
  runConfigSnapshotAndImmutabilityTests();
  runActionEventOrderingTests();
}

function runDeterministicReplayAndSubdivisionTests(): void {
  const config = {
    fixedStepSeconds: 1 / 60,
    maxSubSteps: 10,
    gaits: [{ id: "run", speed: 4, acceleration: 12, deceleration: 16 }],
    defaultGaitId: "run"
  };
  const world = createFlatGroundCharacterWorld({ y: 0, surfaceId: "floor" });
  const input: CharacterControllerInput = {
    movement: { planarDirection: [0, 0, 1], magnitude: 1, gait: "run", facing: { policy: "movement" } }
  };
  const a = new CharacterController(config, world);
  const b = new CharacterController(config, world);
  const c = new CharacterController(config, world);

  for (let i = 0; i < 30; i += 1) a.update(1 / 60, input);
  for (let i = 0; i < 10; i += 1) b.update(3 / 60, input);
  for (let i = 0; i < 30; i += 1) c.update(1 / 60, input);

  assertSnapshotNearlyEqual(a.snapshot(), b.snapshot(), 1e-10, "subdivision should match fixed steps");
  assert.deepEqual(a.snapshot(), c.snapshot(), "replay with identical fixed inputs should be byte-stable");
}

function runMovementTurningAndStopTests(): void {
  const controller = new CharacterController(
    {
      fixedStepSeconds: 0.1,
      acceleration: 2,
      deceleration: 4,
      turnSpeedRadians: Math.PI / 2,
      gaits: [
        { id: "walk", speed: 1, acceleration: 2, deceleration: 4, animationSpeed: 0.75 },
        { id: "run", speed: 4, acceleration: 8, deceleration: 8 }
      ],
      defaultGaitId: "walk"
    },
    createFlatGroundCharacterWorld()
  );

  let result = controller.update(0.1, {
    movement: { planarDirection: [0, 0, 1], magnitude: 1, gait: "walk", facing: { policy: "movement" } }
  });
  assert.ok(
    nearlyEqual(result.state.velocity[2], 0.2, 1e-9),
    "walk acceleration should be bounded by gait acceleration"
  );
  assert.equal(result.animation.animationSpeed, 0.75, "active gait animationSpeed should reach animation output");
  assert.equal(result.state.yaw, 0);

  for (let i = 0; i < 10; i += 1) {
    result = controller.update(0.1, {
      movement: { planarDirection: [0, 0, 1], magnitude: 1, gait: "walk", facing: { policy: "movement" } }
    });
  }
  assert.ok(nearlyEqual(result.state.velocity[2], 1, 1e-9), "walk should settle at gait speed");

  result = controller.update(0.1, {
    movement: { planarDirection: [1, 0, 0], magnitude: 1, gait: "run", facing: { policy: "movement" } }
  });
  assert.ok(result.state.velocity[0] > 0, "run request should accelerate laterally");
  assert.ok(nearlyEqual(result.state.yaw, Math.PI / 20, 1e-9), "turn speed should limit yaw change per fixed step");

  for (let i = 0; i < 10; i += 1) result = controller.update(0.1, {});
  assert.ok(planarSpeed(result.state.velocity) < 0.01, "stop input should decelerate to rest");
}

function runJumpBufferCoyoteAndLandingTests(): void {
  const world = createLedgeWorld(0.05);
  const controller = new CharacterController(
    {
      fixedStepSeconds: 0.02,
      maxSubSteps: 20,
      coyoteTimeSeconds: 0.12,
      jumpBufferSeconds: 0.1,
      landingDurationSeconds: 0.04,
      jumpSpeed: 3,
      gravity: 10,
      gaits: [{ id: "walk", speed: 1, acceleration: 50, deceleration: 50 }]
    },
    world
  );

  controller.update(0.02, { movement: { planarDirection: [1, 0, 0], magnitude: 1 } });
  controller.update(0.04, { movement: { planarDirection: [1, 0, 0], magnitude: 1 } });
  assert.equal(controller.snapshot().locomotionPhase, "falling", "leaving the ledge should enter falling phase");

  const coyoteJump = controller.update(0.02, { jump: { commandId: "jump-coyote" } });
  assert.ok(
    coyoteJump.events.map((event) => event.type).includes("jump-started"),
    "jump inside coyote time should start on its edge command"
  );
  assert.equal(coyoteJump.state.locomotionPhase, "rising");

  let landed = coyoteJump;
  for (let i = 0; i < 80 && !landed.events.some((event) => event.type === "landed"); i += 1) {
    landed = controller.update(0.02, {});
  }
  assert.ok(
    landed.events.some((event) => event.type === "landed"),
    "fall should emit a landing event"
  );
  assert.equal(landed.state.locomotionPhase, "landing", "first grounded frame should expose landing phase");

  const buffered = new CharacterController(
    {
      fixedStepSeconds: 0.02,
      maxSubSteps: 20,
      jumpBufferSeconds: 0.2,
      landingDurationSeconds: 0.02,
      gravity: 10,
      jumpSpeed: 4,
      initialPosition: [0, 0.1, 0],
      initialGrounded: false
    },
    createFlatGroundCharacterWorld({ y: 0 })
  );
  const queued = buffered.update(0.02, { jump: { commandId: "jump-buffered" } });
  assert.deepEqual(
    queued.events.map((event) => event.type),
    ["jump-buffered"],
    "airborne jump command should buffer but not start until grounded"
  );
  let bufferedResult = queued;
  for (let i = 0; i < 30 && !bufferedResult.events.some((event) => event.type === "jump-started"); i += 1) {
    bufferedResult = buffered.update(0.02, {});
  }
  assert.ok(
    bufferedResult.events.some((event) => event.type === "jump-started"),
    "buffered jump should fire on landing"
  );
  assert.ok(bufferedResult.state.velocity[1] > 0, "buffered jump should own upward velocity");
}

function runJumpBufferZeroAndNoSubstepTests(): void {
  const immediate = new CharacterController(
    { fixedStepSeconds: 0.1, jumpBufferSeconds: 0, jumpSpeed: 3, gravity: 10 },
    createFlatGroundCharacterWorld()
  );
  const jumped = immediate.update(0.1, { jump: { commandId: "jump-now" } });
  assert.ok(
    jumped.events.some((event) => event.type === "jump-started"),
    "zero-second jump buffer should still allow an immediate grounded jump"
  );
  assert.equal(
    jumped.events.filter((event) => event.type === "left-ground").length,
    1,
    "grounded jump should emit exactly one left-ground edge"
  );
  assert.equal(jumped.state.locomotionPhase, "rising");

  const noSubstep = new CharacterController(
    { fixedStepSeconds: 0.1, jumpBufferSeconds: 0, jumpSpeed: 3 },
    createFlatGroundCharacterWorld()
  );
  const edgeOnly = noSubstep.update(0.05, { jump: { commandId: "edge-only" } });
  assert.equal(edgeOnly.substeps, 0, "partial updates should not run fixed-step locomotion");
  assert.deepEqual(
    edgeOnly.events.map((event) => event.type),
    ["jump-buffered"],
    "jump edge should be reported even when no fixed step runs"
  );
  assert.equal(edgeOnly.state.jumpBufferSeconds, 0, "zero-second jump buffers do not expose timer persistence");
  assert.equal(edgeOnly.state.pendingJumpEdge, true, "jump edge should latch until the next fixed substep");
  const restoredNoSubstep = new CharacterController(
    { fixedStepSeconds: 0.1, jumpBufferSeconds: 0, jumpSpeed: 3 },
    createFlatGroundCharacterWorld()
  );
  restoredNoSubstep.restore(edgeOnly.state);
  const later = noSubstep.update(0.05, {});
  assert.ok(
    later.events.some((event) => event.type === "jump-started"),
    "zero-second no-substep jump edge should fire on the next fixed substep"
  );
  assert.deepEqual(
    later.events.map((event) => event.type),
    ["jump-started", "left-ground"],
    "pending zero-buffer jump edge should preserve deterministic fixed-step event order"
  );
  assert.ok(
    restoredNoSubstep.update(0.05, {}).events.some((event) => event.type === "jump-started"),
    "pending jump edge should survive snapshot/restore"
  );
}

function runCrouchProgressionTests(): void {
  const controller = new CharacterController(
    { fixedStepSeconds: 0.1, crouchDurationSeconds: 0.4, crouchSpeedMultiplier: 0.5 },
    createFlatGroundCharacterWorld()
  );

  const start = controller.update(0.1, { posture: { crouch: true } });
  assert.deepEqual(
    start.events.map((event) => event.type),
    ["posture-transition-start"],
    "crouch command should emit a transition-start edge before completion"
  );
  assert.equal(start.state.posturePhase, "entering-crouch");
  assert.ok(nearlyEqual(start.state.crouchAlpha, 0.25, 1e-9));

  let result = start;
  for (let i = 0; i < 3; i += 1) result = controller.update(0.1, { posture: { crouch: true } });
  assert.equal(result.state.posture, "crouching");
  assert.equal(result.state.posturePhase, "crouching");
  assert.ok(result.events.some((event) => event.type === "posture-transition-complete"));

  result = controller.update(0.1, {
    posture: { crouch: false },
    movement: { planarDirection: [0, 0, 1], magnitude: 1, gait: "walk" }
  });
  assert.equal(result.state.posturePhase, "exiting-crouch");
  assert.ok(result.state.desiredSpeed < 1.4, "partial crouch should still reduce desired speed");
}

function runInvalidConfigAndInputTests(): void {
  assert.throws(() => new CharacterController({ fixedStepSeconds: 0 }), /fixedStepSeconds/);
  assert.throws(() => new CharacterController({ maxSubSteps: 1.5 }), /maxSubSteps/);
  assert.throws(() => new CharacterController({ gaits: [{ id: "bad", speed: Number.NaN }] }), /gaits\[0\]\.speed/);
  assert.throws(() => resolveCharacterControllerConfig({ defaultGaitId: "missing" }), /defaultGaitId/);

  const controller = new CharacterController(undefined, createFlatGroundCharacterWorld());
  const result = controller.update(Number.NaN, {
    movement: {
      planarDirection: [Number.POSITIVE_INFINITY, 0, 0],
      magnitude: Number.NaN,
      gait: "missing",
      facing: { policy: "target-direction", direction: [0, 0, 0] }
    },
    posture: { crouch: "yes" as never },
    jump: { commandId: "" },
    action: { commandId: "", kind: "pickup" }
  });
  assert.equal(result.substeps, 0);
  assert.deepEqual(
    result.events.map((event) => [event.type, event.field]),
    [
      ["input-rejected", "movement.planarDirection"],
      ["input-rejected", "movement.magnitude"],
      ["input-rejected", "movement.gait"],
      ["input-rejected", "movement.facing.direction"],
      ["input-rejected", "posture.crouch"],
      ["input-rejected", "jump.commandId"],
      ["input-rejected", "action.commandId"],
      ["input-rejected", "deltaSeconds"]
    ],
    "invalid inputs should be rejected in stable order"
  );
}

function runAdapterGroundingContractTests(): void {
  const resolveOnlyWorld: CharacterWorldAdapter = {
    resolveMovement(query: CharacterMovementQuery) {
      const position: Vec3 = [
        query.desiredPosition[0],
        Math.max(0, query.desiredPosition[1]),
        query.desiredPosition[2]
      ];
      const velocity: Vec3 = [query.velocity[0], position[1] <= 0 ? 0 : query.velocity[1], query.velocity[2]];
      return {
        position,
        velocity,
        ground: {
          grounded: position[1] <= 0,
          point: [position[0], 0, position[2]],
          normal: [0, 1, 0],
          distance: position[1],
          surfaceId: "resolver-floor"
        }
      };
    }
  };
  const resolverOnly = new CharacterController(
    { fixedStepSeconds: 0.1, gravity: 10, initialGrounded: false, initialPosition: [0, 0.05, 0] },
    resolveOnlyWorld
  );
  const resolvedLanding = resolverOnly.update(0.1, {});
  assert.equal(
    resolvedLanding.state.grounded.grounded,
    true,
    "resolveMovement-only ground should survive post-move refresh"
  );
  assert.equal(resolvedLanding.state.grounded.surfaceId, "resolver-floor");
  assert.ok(
    resolvedLanding.events.some((event) => event.type === "landed"),
    "resolveMovement ground should land"
  );

  const sweepOnlyWorld: CharacterWorldAdapter = {
    sweepCapsule(query) {
      const x = query.from[0] + query.displacement[0];
      const z = query.from[2] + query.displacement[2];
      return {
        position: [x, 0, z],
        normal: [0, 1, 0],
        surfaceId: "sweep-floor",
        platformVelocity: [0.25, 0, 0]
      };
    }
  };
  const sweepOnly = new CharacterController(
    { fixedStepSeconds: 0.1, gravity: 10, initialGrounded: false, initialPosition: [0, 0.05, 0] },
    sweepOnlyWorld
  );
  const sweepLanding = sweepOnly.update(0.1, {});
  assert.equal(sweepLanding.state.grounded.grounded, true, "sweepCapsule-only support hit should ground");
  assert.equal(sweepLanding.state.grounded.surfaceId, "sweep-floor");
  assert.deepEqual(sweepLanding.state.grounded.platformVelocity, [0.25, 0, 0]);

  const conflictingQueryWorld: CharacterWorldAdapter = {
    resolveMovement(query) {
      return {
        position: [query.desiredPosition[0], 0, query.desiredPosition[2]],
        velocity: [query.velocity[0], 0, query.velocity[2]],
        ground: { grounded: true, point: [query.desiredPosition[0], 0, query.desiredPosition[2]], normal: [0, 1, 0] }
      };
    },
    queryGround() {
      return { grounded: false };
    }
  };
  const conflicted = new CharacterController({ fixedStepSeconds: 0.1 }, conflictingQueryWorld).update(0.1, {});
  assert.equal(conflicted.state.grounded.grounded, false, "valid queryGround miss should override movement ground");

  const invalidQueryFallbackWorld: CharacterWorldAdapter = {
    resolveMovement(query) {
      return {
        position: [query.desiredPosition[0], 0, query.desiredPosition[2]],
        velocity: [query.velocity[0], 0, query.velocity[2]],
        ground: { grounded: true, point: [query.desiredPosition[0], 0, query.desiredPosition[2]], normal: [0, 1, 0] }
      };
    },
    queryGround() {
      return { grounded: true, point: [0, Number.NaN, 0] as Vec3, normal: [0, 1, 0] };
    }
  };
  const invalidQueryFallback = new CharacterController({ fixedStepSeconds: 0.1 }, invalidQueryFallbackWorld).update(
    0.1,
    {}
  );
  assert.equal(
    invalidQueryFallback.state.grounded.grounded,
    true,
    "invalid queryGround data should not overwrite valid movement-resolved ground"
  );
  assert.ok(
    invalidQueryFallback.events.some(
      (event) => event.type === "world-adapter-failed" && event.field === "queryGround.point"
    )
  );

  const hostileOptionalGround: CharacterWorldAdapter = {
    resolveMovement(query) {
      return {
        position: [query.desiredPosition[0], 0, query.desiredPosition[2]],
        velocity: [0, 0, 0],
        ground: {
          grounded: true,
          point: [query.desiredPosition[0], 0, query.desiredPosition[2]],
          normal: [0, 1, 0],
          platformVelocity: [Number.NaN, 0, 0]
        }
      };
    }
  };
  const hostile = new CharacterController({ fixedStepSeconds: 0.1 }, hostileOptionalGround).update(0.1, {});
  assert.ok(
    hostile.events.some(
      (event) => event.type === "world-adapter-failed" && event.field === "resolveMovement.ground.platformVelocity"
    ),
    "non-finite movement-resolved ground fields should be rejected explicitly"
  );
  assert.ok(Number.isFinite(hostile.state.position[1]), "hostile optional ground data should not poison state");
}

function runAdapterFailureAndBoundsTests(): void {
  const throwingWorld: CharacterWorldAdapter = {
    resolveMovement() {
      throw new Error("resolver exploded");
    },
    queryGround() {
      return { grounded: true, point: [0, Number.NaN, 0] as Vec3, normal: [0, 1, 0] };
    }
  };
  const controller = new CharacterController({ fixedStepSeconds: 0.1, maxSubSteps: 2 }, throwingWorld);
  const failure = controller.update(0.1, { movement: { planarDirection: [0, 0, 1], magnitude: 1 } });
  assert.ok(failure.events.some((event) => event.type === "world-adapter-failed" && event.field === "world"));
  assert.ok(
    failure.events.some((event) => event.type === "world-adapter-failed" && event.field === "queryGround.point")
  );
  assert.ok(Number.isFinite(failure.state.position[2]), "adapter failure should fall back to finite integration");

  const bounded = controller.update(10, {});
  assert.equal(bounded.substeps, 2, "catch-up should be bounded by maxSubSteps");
  assert.equal(bounded.state.tick, 3);
  assert.ok(bounded.events.some((event) => event.type === "catch-up-capped"));
  assert.ok(bounded.remainderSeconds <= 1e-9);
}

function runStateRestoreTests(): void {
  const config = { fixedStepSeconds: 0.05, maxSubSteps: 10, gaits: [{ id: "run", speed: 3 }] };
  const world = createFlatGroundCharacterWorld({ y: 0 });
  const baseline = new CharacterController(config, world);
  const restored = new CharacterController(config, world);
  const input: CharacterControllerInput = {
    movement: { planarDirection: [1, 0, 0], magnitude: 1, gait: "run", facing: { policy: "movement" } }
  };

  for (let i = 0; i < 5; i += 1) baseline.update(0.05, input);
  restored.restore(baseline.snapshot());
  assert.throws(
    () => restored.restore({ ...baseline.snapshot(), position: [0, Number.NaN, 0] }),
    /snapshot position/,
    "restore should reject non-finite snapshots"
  );

  for (let i = 0; i < 10; i += 1) {
    baseline.update(0.05, input);
    restored.update(0.05, input);
  }
  assert.deepEqual(restored.snapshot(), baseline.snapshot(), "restored snapshot should replay deterministically");
}

function runConfigSnapshotAndImmutabilityTests(): void {
  assert.throws(() => new CharacterController({ radius: 0.6, height: 1 }), /height/);
  assert.throws(
    () => new CharacterController({ height: 1, stepHeight: 0.8, groundProbeDistance: 0.3 }),
    /stepHeight plus groundProbeDistance/
  );
  assert.throws(() => new CharacterController({ maxSubSteps: 241 }), /maxSubSteps/);

  const resolved = resolveCharacterControllerConfig({ gaits: [{ id: "walk", speed: 2 }] });
  assert.ok(Object.isFrozen(resolved), "resolved config should be frozen");
  assert.ok(Object.isFrozen(resolved.gaits), "resolved gaits array should be frozen");
  assert.ok(Object.isFrozen(resolved.gaits[0]), "resolved gait records should be frozen");

  try {
    (CHARACTER_CONTROLLER_COORDINATE_SYSTEM.up as unknown as Vec3)[1] = 99;
  } catch {
    // Frozen coordinate constants throw in ESM strict mode; either way, the value must not change.
  }
  assert.deepEqual(CHARACTER_CONTROLLER_COORDINATE_SYSTEM.up, [0, 1, 0], "coordinate constants should be immutable");

  const controller = new CharacterController({ fixedStepSeconds: 0.1 }, createFlatGroundCharacterWorld());
  const snapshot = controller.snapshot();
  assert.throws(() => controller.restore({ ...snapshot, accumulatorSeconds: 0.2 }), /accumulatorSeconds/);
  assert.throws(() => controller.restore({ ...snapshot, yaw: Math.PI * 2 }), /yaw/);
  assert.throws(() => controller.restore({ ...snapshot, moveMagnitude: 2 }), /moveMagnitude/);
  assert.throws(
    () =>
      controller.restore({
        ...snapshot,
        posturePhase: "crouching",
        crouchTarget: "crouching",
        crouchAlpha: 1
      }),
    /posture/
  );
  assert.throws(() => controller.restore({ ...snapshot, locomotionPhase: "rising" }), /locomotionPhase/);
}

function runActionEventOrderingTests(): void {
  const controller = new CharacterController({ fixedStepSeconds: 0.1 }, createFlatGroundCharacterWorld());
  const result = controller.update(0.1, {
    action: { commandId: "pickup-1", kind: "pickup", itemId: "mug", socketId: "right-hand" },
    jump: { commandId: "jump-1" },
    posture: { crouch: true },
    movement: { planarDirection: [0, 0, 1], magnitude: 1 }
  });
  assert.deepEqual(
    result.events.slice(0, 5).map((event) => event.type),
    ["action-command", "jump-buffered", "posture-transition-start", "jump-started", "left-ground"],
    "edge commands should be emitted before fixed-step locomotion events in deterministic order"
  );
  assert.equal(result.events[0]?.command?.itemId, "mug");

  const repeated = controller.update(0.1, {
    action: { commandId: "pickup-1", kind: "pickup", itemId: "mug" },
    jump: { commandId: "jump-1" }
  });
  assert.ok(
    !repeated.events.some((event) => event.type === "action-command"),
    "same action command id should not repeat"
  );
  assert.ok(!repeated.events.some((event) => event.type === "jump-buffered"), "same jump command id should not repeat");
}

function createLedgeWorld(edgeX: number): CharacterWorldAdapter {
  return {
    queryGround(query: CharacterGroundQuery) {
      const groundY = query.position[0] > edgeX ? -0.2 : 0;
      const distance = query.position[1] - groundY;
      return {
        grounded: distance <= query.probeDistance && distance >= -query.stepHeight,
        point: [query.position[0], groundY, query.position[2]],
        normal: [0, 1, 0],
        distance,
        slopeAngleRadians: 0
      };
    },
    resolveMovement(query: CharacterMovementQuery) {
      const position: Vec3 = [query.desiredPosition[0], query.desiredPosition[1], query.desiredPosition[2]];
      const velocity: Vec3 = [query.velocity[0], query.velocity[1], query.velocity[2]];
      if (position[0] <= edgeX && position[1] < 0) {
        position[1] = 0;
        velocity[1] = 0;
      }
      if (position[1] < -0.2) {
        position[1] = -0.2;
        velocity[1] = 0;
      }
      return { position, velocity };
    }
  };
}

function planarSpeed(value: Vec3): number {
  return Math.hypot(value[0], value[2]);
}

function nearlyEqual(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

function assertSnapshotNearlyEqual(
  a: CharacterControllerSnapshot,
  b: CharacterControllerSnapshot,
  epsilon: number,
  message: string
): void {
  assert.equal(a.tick, b.tick, message);
  assert.ok(vecNearlyEqual(a.position, b.position, epsilon), `${message}: position`);
  assert.ok(vecNearlyEqual(a.velocity, b.velocity, epsilon), `${message}: velocity`);
  assert.ok(nearlyEqual(a.yaw, b.yaw, epsilon), `${message}: yaw`);
  assert.equal(a.locomotionPhase, b.locomotionPhase, message);
  assert.equal(a.posturePhase, b.posturePhase, message);
  assert.ok(nearlyEqual(a.crouchAlpha, b.crouchAlpha, epsilon), `${message}: crouch`);
}

function vecNearlyEqual(a: Vec3, b: Vec3, epsilon: number): boolean {
  return nearlyEqual(a[0], b[0], epsilon) && nearlyEqual(a[1], b[1], epsilon) && nearlyEqual(a[2], b[2], epsilon);
}
