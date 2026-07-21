import type { CharacterAnimationGraphOutput, CharacterAnimationState } from "./test-api.js";
import {
  CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION,
  CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
  CharacterAnimationGraph,
  assert,
  createCharacterAnimationBindingOutputBuffer,
  createCharacterAnimationBindingRegistry,
  resolveCharacterAnimationBindings
} from "./test-api.js";

export function runCharacterAnimationBindingTests(): void {
  runRegistryValidationAndFreezeTests();
  runLocomotionPostureAirborneAndActionResolutionTests();
  runBlendTransitionMissingAndMismatchTests();
  runBoundsHostileInputAndOutputReuseTests();
}

function runRegistryValidationAndFreezeTests(): void {
  const registry = createCharacterAnimationBindingRegistry({
    maxIssues: 16,
    clips: [{ id: "clip:idle", loop: true }, { id: "clip:idle" }, { id: "" }, "bad" as never],
    bindings: [
      { requestId: "locomotion:idle", clipId: "clip:idle", layer: "locomotion" },
      { requestId: "locomotion:idle", clipId: "clip:idle", layer: "locomotion" },
      { requestId: "missing-clip", clipId: "clip:missing", layer: "locomotion" },
      { requestId: "bad-layer", clipId: "clip:idle", layer: "bad" as never },
      {
        requestId: "bad-runtime",
        clipId: "clip:idle",
        layer: "locomotion",
        runtime: { laneId: "", fadeSeconds: Number.NaN, maxPlaybackSpeed: 0.5, minPlaybackSpeed: 2 }
      }
    ]
  });

  assert.equal(registry.schemaVersion, CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION);
  assert.ok(Object.isFrozen(registry.clips), "clip registry assets should be frozen");
  assert.ok(Object.isFrozen(registry.bindings), "semantic bindings should be frozen");
  assert.ok(Object.isFrozen(registry.bindings[0]?.runtime), "runtime policy should be frozen");
  assert.deepEqual(
    registry.bindings.map((binding) => binding.requestId),
    ["locomotion:idle", "bad-runtime"],
    "invalid and duplicate bindings should be ignored deterministically"
  );
  assert.ok(registry.issues.some((issue) => issue.code === "duplicate-clip-id"));
  assert.ok(registry.issues.some((issue) => issue.code === "duplicate-binding"));
  assert.ok(registry.issues.some((issue) => issue.code === "missing-clip"));
  assert.ok(registry.issues.some((issue) => issue.field === "bindings.layer"));
  assert.ok(registry.issues.some((issue) => issue.field === "bindings.runtime.maxPlaybackSpeed"));

  const snapshot = registry.snapshot();
  assert.ok(Object.isFrozen(snapshot), "registry snapshot should be frozen");
  assert.equal(snapshot.maxIssues, 16);
}

function runLocomotionPostureAirborneAndActionResolutionTests(): void {
  const registry = makeRegistry();
  const graph = new CharacterAnimationGraph({ airborne: { minRiseSeconds: 0 } });

  const idle = registry.resolve(graph.update(makeAnimationState(), { deltaSeconds: 0.1 }));
  assert.equal(idle.schemaVersion, CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION);
  assert.deepEqual(
    idle.playback.map((request) => [request.requestId, request.clipId, request.laneId, request.loop]),
    [
      ["locomotion:idle", "clip:idle", "base", true],
      ["posture:standing", "clip:stand", "posture", true]
    ],
    "idle and standing requests should map to configured clip assets and lanes"
  );
  assert.equal(idle.playback[0]?.priority, 10, "binding priority should override graph priority when configured");
  assert.equal(idle.playback[0]?.fadeSeconds, 0.2, "binding fade should override graph fade when configured");

  const moving = registry.resolve(
    graph.update(makeAnimationState({ gaitId: "walk", speedRatio: 0.5, moveMagnitude: 0.5, animationSpeed: 1.2 }), {
      deltaSeconds: 0.1
    })
  );
  const gait = moving.playback.find((request) => request.requestId === "locomotion:gait:walk");
  assert.equal(gait?.clipId, "clip:walk");
  assert.equal(gait?.layerId, "base:gait");
  assert.equal(gait?.playbackSpeed, 1.32);
  assert.deepEqual(moving.blends[0]?.from?.clipId, "clip:idle");
  assert.deepEqual(moving.blends[0]?.to?.clipId, "clip:walk");

  const crouching = registry.resolve(
    graph.update(makeAnimationState({ posturePhase: "entering-crouch", crouchAlpha: 0.4 }), { deltaSeconds: 0.1 })
  );
  const postureClips = crouching.playback.filter((request) => request.graphLayer === "posture");
  assert.deepEqual(
    postureClips.map((request) => [request.requestId, request.clipId, request.maskId, request.weight]),
    [
      ["posture:standing", "clip:stand", "mask:posture", 0.6],
      ["posture:crouching", "clip:crouch", "mask:posture", 0.4]
    ],
    "standing/crouching posture blend should resolve both configured bindings"
  );

  const rising = registry.resolve(
    graph.update(makeAnimationState({ locomotionPhase: "rising", verticalSpeed: 2 }), { deltaSeconds: 0.1 })
  );
  assert.equal(rising.playback.find((request) => request.requestId === "airborne:rise")?.clipId, "clip:rise");
  assert.equal(
    rising.playback.find((request) => request.requestId === "airborne:rise")?.playbackSpeed,
    1.25,
    "binding playback clamp should apply after graph airborne speed"
  );

  const falling = registry.resolve(
    graph.update(makeAnimationState({ locomotionPhase: "falling", verticalSpeed: -1 }), { deltaSeconds: 0.1 })
  );
  assert.equal(falling.playback.find((request) => request.requestId === "airborne:fall")?.loop, true);

  const landing = registry.resolve(
    graph.update(makeAnimationState({ locomotionPhase: "landing", verticalSpeed: 0 }), { deltaSeconds: 0.1 })
  );
  assert.equal(landing.playback.find((request) => request.requestId === "airborne:landing")?.loop, false);

  const action = registry.resolve(
    graph.update(
      makeAnimationState({
        events: [{ type: "action-command", tick: 5, command: { commandId: "pickup-1", kind: "pickup" } }]
      }),
      { deltaSeconds: 0.1 }
    )
  );
  assert.deepEqual(action.actions, [
    {
      type: "action",
      requestId: "action:pickup",
      clipId: "clip:pickup",
      graphLayer: "action",
      laneId: "overlay",
      layerId: "action:pickup",
      blendMode: "additive",
      loop: false,
      priority: 310,
      fadeSeconds: 0.05,
      playbackSpeed: 1,
      maskId: "mask:upper-body",
      weight: 1,
      phase: 0,
      command: { commandId: "pickup-1", kind: "pickup" },
      sourceIndex: 0,
      controllerTick: 5
    }
  ]);
}

function runBlendTransitionMissingAndMismatchTests(): void {
  const registry = makeRegistry();
  const graph = new CharacterAnimationGraph();
  const started = registry.resolve(
    graph.update(makeAnimationState({ gaitId: "walk", speedRatio: 0.4, moveMagnitude: 0.4 }), { deltaSeconds: 0.1 })
  );
  assert.deepEqual(
    started.transitions.map((transition) => [transition.from?.clipId, transition.to?.clipId, transition.reason]),
    [["clip:idle", "clip:walk", "locomotion-hysteresis"]],
    "locomotion transition endpoints should resolve to configured clips"
  );

  const missing = createCharacterAnimationBindingRegistry({
    clips: [{ id: "clip:idle" }],
    bindings: [{ requestId: "locomotion:idle", clipId: "clip:idle", layer: "locomotion" }]
  }).resolve({
    ...makeGraphOutput(),
    playback: [
      {
        type: "playback",
        layer: "locomotion",
        requestId: "locomotion:gait:sprint",
        weight: 1,
        playbackSpeed: 1,
        priority: 0,
        loop: true,
        phase: 0,
        transitionSeconds: 0.1,
        reason: "gait"
      }
    ],
    blends: [
      {
        type: "blend",
        layer: "locomotion",
        from: "locomotion:idle",
        to: "locomotion:gait:sprint",
        fromWeight: 0,
        toWeight: 1,
        priority: 0,
        transitionSeconds: 0.1,
        reason: "gait"
      }
    ]
  });
  assert.equal(missing.playback.length, 0, "unbound semantic ids should not silently select clips");
  assert.equal(missing.blends[0]?.from?.clipId, "clip:idle");
  assert.equal(missing.blends[0]?.to, null);
  assert.ok(missing.issues.some((issue) => issue.code === "unbound-request"));

  const mismatch = createCharacterAnimationBindingRegistry({
    clips: [{ id: "clip:walk" }],
    bindings: [{ requestId: "locomotion:gait:walk", clipId: "clip:walk", layer: "posture" }]
  }).resolve({
    ...makeGraphOutput(),
    playback: [
      {
        type: "playback",
        layer: "locomotion",
        requestId: "locomotion:gait:walk",
        weight: 1,
        playbackSpeed: 1,
        priority: 0,
        loop: true,
        phase: 0,
        transitionSeconds: 0.1,
        reason: "gait"
      }
    ]
  });
  assert.equal(mismatch.playback.length, 0);
  assert.ok(mismatch.issues.some((issue) => issue.code === "layer-mismatch"));

  const invalidActionKind = registry.resolve({
    ...makeGraphOutput(),
    playback: [],
    actions: [
      {
        type: "action",
        layer: "action",
        requestId: "action:pickup",
        command: { commandId: "bad-kind-1", kind: "teleport" as never },
        priority: 300,
        fadeSeconds: 0.1
      }
    ]
  });
  assert.equal(invalidActionKind.actions.length, 0, "binding resolver should reject unsupported action kinds");
  assert.ok(invalidActionKind.issues.some((issue) => issue.field === "actions.command.kind"));
}

function runBoundsHostileInputAndOutputReuseTests(): void {
  const registry = makeRegistry({ maxRequestsPerResolve: 2, maxIssues: 32 });
  const output = createCharacterAnimationBindingOutputBuffer();
  const playbackArray = output.playback;
  const hostile = {
    sequence: 42,
    playback: [
      {
        type: "playback",
        layer: "locomotion",
        requestId: "locomotion:idle",
        weight: 1,
        playbackSpeed: 1,
        priority: 0,
        loop: true,
        phase: 0,
        transitionSeconds: 0.1,
        reason: "idle"
      },
      {
        type: "playback",
        layer: "bad",
        requestId: "",
        weight: Number.NaN,
        playbackSpeed: Number.POSITIVE_INFINITY,
        priority: -1,
        loop: "yes",
        phase: 2,
        transitionSeconds: Number.NaN,
        reason: "bad"
      },
      {
        type: "playback",
        layer: "locomotion",
        requestId: "locomotion:gait:walk",
        weight: 1,
        playbackSpeed: 1,
        priority: 0,
        loop: true,
        phase: 0,
        transitionSeconds: 0.1,
        reason: "gait"
      }
    ],
    blends: Array.from({ length: 3 }, () => ({
      type: "blend",
      layer: "locomotion",
      from: "locomotion:idle",
      to: "locomotion:gait:walk",
      fromWeight: 0.5,
      toWeight: 0.5,
      priority: 0,
      transitionSeconds: 0.1,
      reason: "gait"
    })),
    transitions: "not-transitions",
    actions: [
      {
        type: "action",
        layer: "action",
        requestId: "action:missing",
        command: { commandId: "x", kind: "pickup" },
        priority: 300,
        fadeSeconds: 0.1
      }
    ]
  } as never;

  const first = registry.resolve(hostile, { output });
  assert.equal(first, output, "binding resolver should support caller-owned output reuse");
  assert.equal(first.playback, playbackArray, "binding resolver should clear and reuse output arrays");
  assert.deepEqual(
    first.playback.map((request) => request.clipId),
    ["clip:idle"]
  );
  assert.ok(first.issues.some((issue) => issue.type === "input-rejected"));
  assert.ok(first.issues.some((issue) => issue.code === "max-requests"));
  assert.ok(first.issues.some((issue) => issue.code === "unbound-request"));

  const deterministicA = registry.resolve(makeGraphOutput(), { output: createCharacterAnimationBindingOutputBuffer() });
  const deterministicB = registry.resolve(makeGraphOutput(), { output: createCharacterAnimationBindingOutputBuffer() });
  assert.deepEqual(deterministicA, deterministicB, "same graph output should resolve in deterministic order");

  const second = resolveCharacterAnimationBindings(registry, makeGraphOutput(), { output });
  assert.equal(second.playback, playbackArray);
  assert.deepEqual(
    second.playback.map((request) => request.clipId),
    ["clip:idle"],
    "reused output should be cleared before the next resolve"
  );
}

type RegistryOptions = { maxRequestsPerResolve?: number; maxIssues?: number };

function makeRegistry(options: RegistryOptions = {}) {
  return createCharacterAnimationBindingRegistry({
    ...options,
    clips: [
      { id: "clip:idle", loop: true },
      { id: "clip:walk", loop: true },
      { id: "clip:run", loop: true },
      { id: "clip:stand", loop: true },
      { id: "clip:crouch", loop: true },
      { id: "clip:rise", loop: false },
      { id: "clip:fall", loop: true },
      { id: "clip:land", loop: false },
      { id: "clip:pickup", loop: false }
    ],
    bindings: [
      {
        requestId: "locomotion:idle",
        clipId: "clip:idle",
        layer: "locomotion",
        runtime: { laneId: "base", layerId: "base:idle", maskId: "mask:full-body", priority: 10, fadeSeconds: 0.2 }
      },
      {
        requestId: "locomotion:gait:walk",
        clipId: "clip:walk",
        layer: "locomotion",
        runtime: {
          laneId: "base",
          layerId: "base:gait",
          maskId: "mask:full-body",
          priority: 10,
          playbackSpeedScale: 1.1
        }
      },
      {
        requestId: "locomotion:gait:run",
        clipId: "clip:run",
        layer: "locomotion",
        runtime: { laneId: "base", layerId: "base:gait", maskId: "mask:full-body", priority: 10 }
      },
      {
        requestId: "posture:standing",
        clipId: "clip:stand",
        layer: "posture",
        runtime: { laneId: "posture", layerId: "posture", maskId: "mask:posture", priority: 110 }
      },
      {
        requestId: "posture:crouching",
        clipId: "clip:crouch",
        layer: "posture",
        runtime: { laneId: "posture", layerId: "posture", maskId: "mask:posture", priority: 110 }
      },
      {
        requestId: "airborne:rise",
        clipId: "clip:rise",
        layer: "airborne",
        runtime: {
          laneId: "base",
          layerId: "airborne",
          priority: 210,
          loop: false,
          minPlaybackSpeed: 0.75,
          maxPlaybackSpeed: 1.25
        }
      },
      {
        requestId: "airborne:fall",
        clipId: "clip:fall",
        layer: "airborne",
        runtime: { laneId: "base", layerId: "airborne", priority: 210, loop: true }
      },
      {
        requestId: "airborne:landing",
        clipId: "clip:land",
        layer: "airborne",
        runtime: { laneId: "base", layerId: "airborne", priority: 210, loop: false }
      },
      {
        requestId: "action:pickup",
        clipId: "clip:pickup",
        layer: "action",
        runtime: {
          laneId: "overlay",
          layerId: "action:pickup",
          maskId: "mask:upper-body",
          blendMode: "additive",
          priority: 310,
          fadeSeconds: 0.05,
          loop: false
        }
      }
    ]
  });
}

function makeGraphOutput(): CharacterAnimationGraphOutput {
  return {
    schemaVersion: 1,
    sequence: 1,
    deltaSeconds: 0.1,
    locomotionActive: false,
    locomotionWeight: 0,
    postureWeight: 0,
    primaryRequestId: "locomotion:idle",
    playback: [
      {
        type: "playback",
        layer: "locomotion",
        requestId: "locomotion:idle",
        weight: 1,
        playbackSpeed: 1,
        priority: 0,
        loop: true,
        phase: 0,
        transitionSeconds: 0.1,
        reason: "idle"
      }
    ],
    blends: [],
    transitions: [],
    actions: [],
    issues: []
  };
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
