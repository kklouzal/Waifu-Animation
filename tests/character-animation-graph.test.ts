import type { CharacterAnimationState } from "./test-api.js";
import {
  CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION,
  CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
  CharacterAnimationGraph,
  CharacterController,
  assert,
  createCharacterAnimationGraphOutputBuffer,
  createFlatGroundCharacterWorld,
  resolveCharacterAnimationGraphConfig
} from "./test-api.js";

export function runCharacterAnimationGraphTests(): void {
  runConfigAndIdleRequestTests();
  runLocomotionHysteresisAndGaitTransitionTests();
  runPostureAirborneAndLandingPrecedenceTests();
  runActionForwardingBoundsAndBufferReuseTests();
  runSnapshotRestoreAndFiniteHardeningTests();
}

function runConfigAndIdleRequestTests(): void {
  const resolved = resolveCharacterAnimationGraphConfig({ locomotion: { idleRequestId: "semantic:idle" } });
  assert.ok(Object.isFrozen(resolved), "graph config should be frozen");
  assert.ok(Object.isFrozen(resolved.locomotion), "locomotion config should be frozen");
  assert.equal(resolved.locomotion.idleRequestId, "semantic:idle");
  assert.throws(
    () => resolveCharacterAnimationGraphConfig({ locomotion: { startSpeedRatio: Number.NaN } }),
    /startSpeedRatio/
  );
  assert.throws(
    () => resolveCharacterAnimationGraphConfig({ locomotion: { startSpeedRatio: 0.1, stopSpeedRatio: 0.2 } }),
    /stopSpeedRatio/
  );
  assert.throws(
    () => resolveCharacterAnimationGraphConfig({ locomotion: { gaitRequestIdPrefix: "g".repeat(160) } }),
    /gaitRequestIdPrefix/,
    "gait prefixes must leave room for at least one gait id character"
  );
  assert.throws(
    () => resolveCharacterAnimationGraphConfig({ action: { requestIdPrefix: "a".repeat(158) } }),
    /action.requestIdPrefix/,
    "action prefixes must leave room for at least one supported action kind suffix"
  );

  const graph = new CharacterAnimationGraph({ locomotion: { idleRequestId: "semantic:idle" } });
  const output = graph.update(makeAnimationState(), { deltaSeconds: 1 / 60 });
  assert.equal(output.schemaVersion, CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION);
  assert.equal(output.primaryRequestId, "semantic:idle");
  assert.equal(output.locomotionActive, false);
  assert.deepEqual(
    output.playback.map((request) => [request.layer, request.requestId, request.weight, request.reason]),
    [
      ["locomotion", "semantic:idle", 1, "idle"],
      ["posture", "posture:standing", 1, "posture"]
    ],
    "idle graph output should be semantic request ids, not app clip names"
  );
  assert.deepEqual(output.blends[0], {
    type: "blend",
    layer: "locomotion",
    from: "semantic:idle",
    to: "locomotion:gait:walk",
    fromWeight: 1,
    toWeight: 0,
    priority: 0,
    transitionSeconds: 0.15,
    reason: "gait"
  });
}

function runLocomotionHysteresisAndGaitTransitionTests(): void {
  const graph = new CharacterAnimationGraph({
    locomotion: { startSpeedRatio: 0.2, stopSpeedRatio: 0.1, gaitFadeSeconds: 0.07 }
  });

  const belowStart = graph.update(makeAnimationState({ speedRatio: 0.15, moveMagnitude: 0.15 }), {
    deltaSeconds: 0.1
  });
  assert.equal(belowStart.locomotionActive, false, "locomotion should not chatter on below-start speed");
  assert.equal(belowStart.transitions.length, 0);

  const started = graph.update(
    makeAnimationState({ gaitId: "walk", speedRatio: 0.3, moveMagnitude: 0.3, planarSpeed: 0.42, desiredSpeed: 1.4 }),
    { deltaSeconds: 0.1 }
  );
  assert.equal(started.locomotionActive, true);
  assert.equal(started.primaryRequestId, "locomotion:gait:walk");
  assert.deepEqual(started.transitions[0], {
    type: "transition",
    layer: "locomotion",
    from: "locomotion:idle",
    to: "locomotion:gait:walk",
    fadeSeconds: 0.15,
    priority: 0,
    reason: "locomotion-hysteresis"
  });

  const held = graph.update(
    makeAnimationState({ gaitId: "walk", speedRatio: 0.12, moveMagnitude: 0.12, planarSpeed: 0.16, desiredSpeed: 1.4 }),
    { deltaSeconds: 0.1 }
  );
  assert.equal(held.locomotionActive, true, "active gait should hold until stop threshold");
  assert.equal(held.transitions.length, 0);

  const gaitChanged = graph.update(
    makeAnimationState({
      gaitId: "run",
      speedRatio: 0.6,
      moveMagnitude: 1,
      animationSpeed: 1.25,
      planarSpeed: 2.4,
      desiredSpeed: 4
    }),
    { deltaSeconds: 0.1 }
  );
  assert.equal(gaitChanged.transitions[0]?.reason, "gait-change");
  assert.equal(gaitChanged.transitions[0]?.from, "locomotion:gait:walk");
  assert.equal(gaitChanged.transitions[0]?.to, "locomotion:gait:run");
  assert.equal(gaitChanged.transitions[0]?.fadeSeconds, 0.07);
  assert.equal(gaitChanged.playback.find((request) => request.reason === "gait")?.playbackSpeed, 1.25);

  const stopped = graph.update(makeAnimationState({ gaitId: "run", speedRatio: 0.05, moveMagnitude: 0.05 }), {
    deltaSeconds: 0.1
  });
  assert.equal(stopped.locomotionActive, false);
  assert.equal(stopped.transitions[0]?.from, "locomotion:gait:run");
  assert.equal(stopped.transitions[0]?.to, "locomotion:idle");
}

function runPostureAirborneAndLandingPrecedenceTests(): void {
  const graph = new CharacterAnimationGraph({
    airborne: { minRiseSeconds: 0.06, landingHoldSeconds: 0.05 }
  });

  const crouch = graph.update(
    makeAnimationState({
      posturePhase: "entering-crouch",
      crouchAlpha: 0.25,
      transitions: [{ type: "posture", tick: 10, from: "standing", to: "entering-crouch" }]
    }),
    { deltaSeconds: 0.02 }
  );
  assert.deepEqual(crouch.transitions[0], {
    type: "transition",
    layer: "posture",
    from: "posture:standing",
    to: "posture:crouching",
    fadeSeconds: 0.16,
    priority: 100,
    reason: "posture-phase",
    controllerTick: 10
  });
  assert.deepEqual(crouch.blends[1], {
    type: "blend",
    layer: "posture",
    from: "posture:standing",
    to: "posture:crouching",
    fromWeight: 0.75,
    toWeight: 0.25,
    priority: 100,
    transitionSeconds: 0.16,
    reason: "posture"
  });

  const rising = graph.update(
    makeAnimationState({
      locomotionPhase: "rising",
      verticalSpeed: 2,
      transitions: [{ type: "locomotion", tick: 11, from: "grounded", to: "rising" }]
    }),
    { deltaSeconds: 0.02 }
  );
  assert.equal(rising.primaryRequestId, "airborne:rise", "airborne request should take primary precedence");
  assert.equal(rising.transitions[0]?.layer, "airborne");
  assert.equal(rising.transitions[0]?.to, "airborne:rise");
  assert.equal(rising.transitions[0]?.controllerTick, 11);

  const debouncedFall = graph.update(makeAnimationState({ locomotionPhase: "falling", verticalSpeed: -0.1 }), {
    deltaSeconds: 0.02
  });
  assert.equal(debouncedFall.primaryRequestId, "airborne:rise", "falling should debounce until minRiseSeconds elapses");
  assert.ok(!debouncedFall.transitions.some((request) => request.to === "airborne:fall"));

  const falling = graph.update(
    makeAnimationState({
      locomotionPhase: "falling",
      verticalSpeed: -1,
      transitions: [{ type: "locomotion", tick: 12, from: "rising", to: "falling" }]
    }),
    { deltaSeconds: 0.05 }
  );
  assert.equal(falling.primaryRequestId, "airborne:fall");
  assert.equal(falling.transitions[0]?.to, "airborne:fall");

  const landing = graph.update(
    makeAnimationState({
      locomotionPhase: "landing",
      verticalSpeed: 0,
      transitions: [{ type: "locomotion", tick: 13, from: "falling", to: "landing" }]
    }),
    { deltaSeconds: 0.01 }
  );
  assert.equal(landing.primaryRequestId, "airborne:landing");
  assert.equal(landing.playback.find((request) => request.layer === "airborne")?.loop, false);

  const heldLanding = graph.update(makeAnimationState({ locomotionPhase: "grounded" }), { deltaSeconds: 0.01 });
  assert.equal(
    heldLanding.primaryRequestId,
    "airborne:landing",
    "landing hold should survive the first grounded frame"
  );

  const grounded = graph.update(makeAnimationState({ locomotionPhase: "grounded" }), { deltaSeconds: 0.1 });
  assert.equal(
    grounded.primaryRequestId,
    "airborne:landing",
    "landing hold is capped to one deterministic output frame"
  );
  const cleared = graph.update(makeAnimationState({ locomotionPhase: "grounded" }), { deltaSeconds: 0.01 });
  assert.equal(cleared.primaryRequestId, "locomotion:idle");
  assert.equal(cleared.transitions[0]?.from, "airborne:landing");
  assert.equal(cleared.transitions[0]?.to, null);
}

function runActionForwardingBoundsAndBufferReuseTests(): void {
  const controller = new CharacterController({ fixedStepSeconds: 0.1 }, createFlatGroundCharacterWorld());
  const controllerResult = controller.update(0.1, {
    action: { commandId: "pickup-1", kind: "pickup", itemId: "mug", socketId: "right-hand" }
  });
  const graph = new CharacterAnimationGraph();
  const forwarded = graph.update(controllerResult.animation, { deltaSeconds: 0.1 });
  assert.deepEqual(forwarded.actions, [
    {
      type: "action",
      layer: "action",
      requestId: "action:pickup",
      command: { commandId: "pickup-1", kind: "pickup", itemId: "mug", socketId: "right-hand" },
      priority: 300,
      fadeSeconds: 0.08,
      controllerTick: 0
    }
  ]);

  const repeated = graph.update(controllerResult.animation, { deltaSeconds: 0.1 });
  assert.equal(repeated.actions.length, 0, "graph should not refire an already forwarded action command id");

  const longActionPrefix = new CharacterAnimationGraph({ action: { requestIdPrefix: "a".repeat(157) } });
  const overlongAction = longActionPrefix.update(
    makeAnimationState({
      events: [{ type: "action-command", tick: 3, command: { commandId: "overlong", kind: "pickup" } }]
    }),
    { deltaSeconds: 0.1 }
  );
  assert.equal(overlongAction.actions.length, 0, "graph should not emit overlong composed action request ids");
  assert.ok(overlongAction.issues.some((issue) => issue.field === "events.action-command.requestId"));
  const shortAction = longActionPrefix.update(
    makeAnimationState({
      events: [{ type: "action-command", tick: 4, command: { commandId: "short", kind: "use" } }]
    }),
    { deltaSeconds: 0.1 }
  );
  assert.equal(shortAction.actions[0]?.requestId.length, 160, "bounded composed action request ids should still emit");

  const multiActionGraph = new CharacterAnimationGraph({ action: { maxActionRequestsPerUpdate: 2 } });
  const multiActionState = makeAnimationState({
    events: [
      { type: "action-command", tick: 5, command: { commandId: "multi-a", kind: "pickup" } },
      { type: "action-command", tick: 6, command: { commandId: "multi-b", kind: "drop" } }
    ]
  });
  assert.deepEqual(
    multiActionGraph
      .update(multiActionState, { deltaSeconds: 0.1 })
      .actions.map((request) => request.command.commandId),
    ["multi-a", "multi-b"]
  );
  assert.equal(
    multiActionGraph.update(multiActionState, { deltaSeconds: 0.1 }).actions.length,
    0,
    "stale animation states should not refire any already forwarded action command ids"
  );

  const bounded = new CharacterAnimationGraph({ action: { maxActionRequestsPerUpdate: 1 } });
  const outputBuffer = createCharacterAnimationGraphOutputBuffer();
  const first = bounded.update(
    makeAnimationState({
      events: [
        { type: "action-command", tick: 1, command: { commandId: "a", kind: "pickup" } },
        { type: "action-command", tick: 2, command: { commandId: "b", kind: "drop" } }
      ]
    }),
    { output: outputBuffer, deltaSeconds: 0.1 }
  );
  assert.equal(first, outputBuffer, "callers may reuse the output object");
  const playbackArray = first.playback;
  assert.equal(first.actions.length, 1);
  assert.ok(first.issues.some((issue) => issue.code === "max-actions"));

  const retriedDropped = bounded.update(
    makeAnimationState({
      events: [{ type: "action-command", tick: 2, command: { commandId: "b", kind: "drop" } }]
    }),
    { output: outputBuffer, deltaSeconds: 0.1 }
  );
  assert.deepEqual(
    retriedDropped.actions.map((request) => request.command.commandId),
    ["b"],
    "action commands discarded by maxActionRequestsPerUpdate should not be marked as forwarded"
  );

  const second = bounded.update(makeAnimationState(), { output: outputBuffer, deltaSeconds: 0 });
  assert.equal(
    second.playback,
    playbackArray,
    "hot path should clear and reuse output arrays instead of allocating new ones"
  );
  assert.equal(second.actions.length, 0);
}

function runSnapshotRestoreAndFiniteHardeningTests(): void {
  const graph = new CharacterAnimationGraph({ maxDeltaSeconds: 0.05, maxControllerEventsPerUpdate: 1 });
  graph.update(makeAnimationState({ gaitId: "run", speedRatio: 0.5, moveMagnitude: 0.5 }), { deltaSeconds: 0.05 });
  const snapshot = graph.snapshot();
  const restored = new CharacterAnimationGraph({ maxDeltaSeconds: 0.05, maxControllerEventsPerUpdate: 1 });
  restored.restore(snapshot);
  assert.throws(() => restored.restore({ ...snapshot, playbackPhase: Number.NaN }), /playbackPhase/);
  assert.throws(
    () =>
      restored.restore({
        ...snapshot,
        locomotionActive: true,
        locomotionRequestId: "locomotion:idle"
      }),
    /request ids/,
    "snapshot restore should reject locomotionActive/requestId mismatches"
  );
  assert.throws(
    () =>
      restored.restore({
        ...snapshot,
        locomotionRequestId: `locomotion:gait:${"x".repeat(200)}`,
        gaitId: "x".repeat(200)
      }),
    /gaitId|RequestId|requestId|request ids/,
    "snapshot restore should reject request ids that cannot be emitted by the graph contract"
  );

  const next = makeAnimationState({
    gaitId: "run",
    speedRatio: 0.8,
    moveMagnitude: 1,
    events: [
      { type: "action-command", tick: 3, command: { commandId: "x", kind: "custom" } },
      { type: "action-command", tick: 4, command: { commandId: "y", kind: "use" } }
    ]
  });
  assert.deepEqual(
    restored.update(next, { deltaSeconds: 0.05 }),
    graph.update(next, { deltaSeconds: 0.05 }),
    "snapshot restore should replay graph decisions deterministically"
  );

  const hostile = graph.update(
    {
      ...makeAnimationState(),
      gaitId: "",
      planarSpeed: Number.POSITIVE_INFINITY,
      speedRatio: Number.NaN,
      animationSpeed: Number.NaN,
      moveMagnitude: 2,
      desiredSpeed: -1,
      locomotionPhase: "bad" as never,
      posturePhase: "bad" as never,
      crouchAlpha: Number.NaN,
      events: "not-events" as never,
      transitions: "not-transitions" as never
    },
    { deltaSeconds: Number.POSITIVE_INFINITY }
  );
  assert.ok(hostile.issues.length >= 8, "hostile animation state should be rejected without poisoning output");
  assert.ok(hostile.issues.some((issue) => issue.field === "deltaSeconds"));
  assert.ok(hostile.issues.some((issue) => issue.field === "animation.events"));
  assert.ok(hostile.issues.some((issue) => issue.field === "animation.transitions"));
  assert.ok(
    hostile.playback.every((request) => Number.isFinite(request.weight) && Number.isFinite(request.playbackSpeed))
  );
}

function makeAnimationState(overrides: Partial<CharacterAnimationState> = {}): CharacterAnimationState {
  return {
    coordinateSystem: CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    yaw: 0,
    facingForward: [0, 0, 1],
    planarSpeed: 0,
    verticalSpeed: 0,
    speedRatio: 0,
    animationSpeed: 1,
    moveMagnitude: 0,
    desiredSpeed: 0,
    gaitId: "walk",
    grounded: true,
    groundNormal: [0, 1, 0],
    locomotionPhase: "grounded",
    posture: "standing",
    posturePhase: "standing",
    crouchAlpha: 0,
    events: [],
    transitions: [],
    ...overrides
  };
}
