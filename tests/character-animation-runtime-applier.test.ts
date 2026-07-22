import type { AnimationClip, CharacterAnimationBindingOutput } from "./test-api.js";
import {
  ReferenceAnimationRuntime,
  CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION,
  assert,
  createCharacterAnimationRuntimeApplier,
  createCharacterAnimationRuntimeApplyResultBuffer,
  createJointMask,
  createSkeleton,
  resolveCharacterAnimationRuntimeApplierConfig,
  toFloat32Array
} from "./test-api.js";

export function runCharacterAnimationRuntimeApplierTests(): void {
  runIdleToGaitCrossfadeAndGaitChangeTests();
  runRepeatedApplyPreservesRuntimeTimeTests();
  runFadingLayerReactivationTests();
  runPostureBlendAndMaskTests();
  runRuntimeLayerMaskReplacementTests();
  runAirborneRiseFallLandingTests();
  runActionOverlayIdentitySnapshotAndReplayTests();
  runMissingClipMaskConflictAndIsolationTests();
  runMalformedHostileBoundedInputTests();
}

function runIdleToGaitCrossfadeAndGaitChangeTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  const idleResult = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 0 }), { clips, masks });
  assert.equal(idleResult.schemaVersion, CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION);
  assert.deepEqual(
    idleResult.applied
      .filter((layer) => layer.graphLayer === "locomotion")
      .map((layer) => [layer.runtimeLayerId, layer.clipId, layer.targetWeight, layer.time]),
    [["test:base:base:idle", "clip:idle", 1, 0]],
    "idle graph output should apply the resolved idle runtime layer"
  );

  const walkResult = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, gait: "walk", phase: 0.25 }), {
    clips,
    masks
  });
  assert.deepEqual(
    walkResult.applied
      .filter((layer) => layer.graphLayer === "locomotion")
      .map((layer) => [layer.runtimeLayerId, layer.clipId, layer.targetWeight, layer.time]),
    [["test:base:base:gait", "clip:walk", 1, 0.5]],
    "full gait blend should apply the gait endpoint once with phase-derived clip time"
  );
  assert.deepEqual(
    walkResult.faded.map((layer) => [layer.runtimeLayerId, layer.reason]),
    [["test:base:base:idle", "transition"]],
    "idle layer should retire through the explicit graph transition rather than runtime-wide fading"
  );
  runtime.update(0.1);
  const afterWalk = runtime.evaluate().activeLayers;
  assert.ok(afterWalk.some((layer) => layer.id === "test:base:base:gait" && layer.targetWeight === 1));
  const gaitLayerBefore = afterWalk.find((layer) => layer.id === "test:base:base:gait");
  assert.ok(gaitLayerBefore && gaitLayerBefore.time > 0.5, "runtime owns time advancement after application");

  const runResult = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, gait: "run", phase: 0.5 }), {
    clips,
    masks
  });
  assert.deepEqual(
    runResult.applied
      .filter((layer) => layer.graphLayer === "locomotion")
      .map((layer) => [layer.runtimeLayerId, layer.clipId, layer.resetTime, layer.time]),
    [["test:base:base:gait", "clip:run", true, 0.4]],
    "gait id changes should replace the same owned gait layer with the new clip and phase-derived time"
  );
  assert.equal(runResult.faded.length, 0, "same runtime layer gait replacement should not stale-fade itself");
}

function runRepeatedApplyPreservesRuntimeTimeTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, gait: "walk", phase: 0.25 }), { clips, masks });
  runtime.update(0.25);
  const advancedTime = runtime.evaluate().activeLayers.find((layer) => layer.id === "test:base:base:gait")?.time;
  assert.ok(advancedTime !== undefined && advancedTime > 0.5, "runtime should advance the applied gait layer time");

  const repeat = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, gait: "walk", phase: 0 }), {
    clips,
    masks
  });
  assert.deepEqual(
    repeat.applied
      .filter((layer) => layer.runtimeLayerId === "test:base:base:gait")
      .map((layer) => [layer.resetTime, layer.time]),
    [[false, undefined]],
    "reapplying the same clip should refresh weight/fade metadata without re-seeding phase time"
  );
  assert.equal(
    runtime.evaluate().activeLayers.find((layer) => layer.id === "test:base:base:gait")?.time,
    advancedTime,
    "applier refreshes must not stomp AnimationRuntime-owned layer time for an unchanged clip"
  );
}

function runFadingLayerReactivationTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  applier.apply(runtime, makeBindingOutput({ locomotionWeight: 0, phase: 0.2 }), { clips, masks });
  runtime.update(0.4);
  applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, phase: 0.3 }), { clips, masks });
  runtime.update(0.03);
  const fadingIdle = runtime.evaluate().activeLayers.find((layer) => layer.id === "test:base:base:idle");
  assert.ok(fadingIdle && fadingIdle.weight > 0, "retired idle layer should still be fading inside runtime");

  const reactivated = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 0, phase: 0.9 }), { clips, masks });
  assert.deepEqual(
    reactivated.applied
      .filter((layer) => layer.runtimeLayerId === "test:base:base:idle")
      .map((layer) => [layer.resetTime, layer.time]),
    [[false, undefined]],
    "reactivating a still-fading owned layer should reuse runtime time instead of restarting it"
  );
  assert.equal(
    runtime.evaluate().activeLayers.find((layer) => layer.id === "test:base:base:idle")?.time,
    fadingIdle.time,
    "reactivated fading layers should preserve their runtime-owned local time"
  );

  const snapshot = applier.snapshot();
  assert.equal(
    snapshot.retiringLayers?.length,
    1,
    "snapshot should retain fading stale-layer handles for deterministic restore"
  );
  const restored = createCharacterAnimationRuntimeApplier({ namespace: "test" });
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot, "retiring layer handles should round-trip through snapshot/restore");

  applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1, phase: 0.1 }), { clips, masks });
  runtime.update(2);
  const freshIdle = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 0, phase: 0.4 }), { clips, masks });
  assert.deepEqual(
    freshIdle.applied
      .filter((layer) => layer.runtimeLayerId === "test:base:base:idle")
      .map((layer) => [layer.resetTime, layer.time]),
    [[true, 0.4]],
    "retiring handles should be pruned once the runtime has removed the faded layer"
  );
}

function runPostureBlendAndMaskTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  const result = applier.apply(runtime, makeBindingOutput({ postureWeight: 0.35 }), { clips, masks });
  const posture = result.applied.filter((layer) => layer.graphLayer === "posture");
  assert.deepEqual(
    posture.map((layer) => [layer.requestId, layer.targetWeight, layer.maskId]),
    [
      ["posture:crouching", 0.35, "mask:posture"],
      ["posture:standing", 0.65, "mask:posture"]
    ],
    "posture graph blends should apply both endpoints with caller-resolved masks"
  );
  assert.equal(result.issues.length, 0);
  runtime.update(0.2);
  const activePosture = runtime.evaluate().activeLayers.filter((layer) => layer.id.startsWith("test:posture"));
  assert.equal(activePosture.length, 2);
}

function runRuntimeLayerMaskReplacementTests(): void {
  const { clips, masks } = makeResources();
  clips.set("clip:masked-full", makeFullBodyTranslationClip("clip:masked-full", 1, 1));
  clips.set("clip:unmasked-full", makeFullBodyTranslationClip("clip:unmasked-full", 1, 2));
  masks.set("mask:head-only", createJointMask(testSkeleton, 0, { head: 1 }));
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  applier.apply(runtime, makeSinglePlaybackOutput("clip:masked-full", { maskId: "mask:head-only", fadeSeconds: 0 }), {
    clips,
    masks
  });
  runtime.update(0);
  const maskedPose = runtime.evaluate().localPose;
  assert.equal(maskedPose[2]?.translation[0], 1);
  assert.equal(maskedPose[4]?.translation[0], 0, "the first masked apply should not affect unmasked leg joints");

  const unmasked = applier.apply(runtime, makeSinglePlaybackOutput("clip:unmasked-full", { fadeSeconds: 0 }), {
    clips,
    masks
  });
  assert.deepEqual(
    unmasked.applied.map((layer) => [layer.runtimeLayerId, layer.maskId]),
    [["test:base:shared", undefined]],
    "unmasked replacement should report no mask ownership"
  );
  runtime.update(0);
  const unmaskedPose = runtime.evaluate().localPose;
  assert.equal(unmaskedPose[2]?.translation[0], 2);
  assert.equal(
    unmaskedPose[4]?.translation[0],
    2,
    "replacing a masked owned layer with an unmasked command must clear the stale runtime mask"
  );
}

function runAirborneRiseFallLandingTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });

  const rise = applier.apply(runtime, makeBindingOutput({ airborne: "rise", airbornePhase: 0.2 }), { clips, masks });
  assert.deepEqual(
    rise.applied
      .filter((layer) => layer.graphLayer === "airborne")
      .map((layer) => [layer.clipId, layer.loop, layer.time]),
    [["clip:rise", false, 0.2]],
    "rise request should apply the airborne layer without inventing root-motion policy"
  );

  const fall = applier.apply(runtime, makeBindingOutput({ airborne: "fall", airbornePhase: 0.5 }), { clips, masks });
  assert.deepEqual(
    fall.applied
      .filter((layer) => layer.graphLayer === "airborne")
      .map((layer) => [layer.clipId, layer.loop, layer.time]),
    [["clip:fall", true, 0.5]],
    "fall transition should replace the same airborne layer deterministically"
  );

  const landing = applier.apply(runtime, makeBindingOutput({ airborne: "landing", airbornePhase: 1 }), {
    clips,
    masks
  });
  assert.deepEqual(
    landing.applied
      .filter((layer) => layer.graphLayer === "airborne")
      .map((layer) => [layer.clipId, layer.loop, layer.time]),
    [["clip:land", false, 0.4]],
    "landing transition should apply a non-looping landing clip on the owned airborne layer"
  );
}

function runActionOverlayIdentitySnapshotAndReplayTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test" });
  const actionOutput = makeBindingOutput({ actionCommandId: "pickup-1" });

  const first = applier.apply(runtime, actionOutput, { clips, masks });
  const actionLayer = first.applied.find((layer) => layer.source === "action");
  assert.ok(actionLayer, "action request should apply as a unique runtime overlay layer");
  assert.equal(actionLayer.requestId, "action:pickup");
  assert.equal(actionLayer.maskId, "mask:upper-body");
  assert.match(actionLayer.runtimeLayerId, /^test:overlay:action:pickup:action:/);

  const duplicate = applier.apply(runtime, actionOutput, { clips, masks });
  assert.equal(
    duplicate.applied.some((layer) => layer.source === "action"),
    false
  );
  assert.ok(duplicate.issues.some((issue) => issue.code === "duplicate-command"));

  const snapshot = applier.snapshot();
  const replayRuntime = new ReferenceAnimationRuntime(testSkeleton);
  const replayApplier = createCharacterAnimationRuntimeApplier({ namespace: "test" });
  replayApplier.restore(snapshot);
  const replayDuplicate = replayApplier.apply(replayRuntime, actionOutput, { clips, masks });
  assert.equal(
    replayDuplicate.applied.some((layer) => layer.source === "action"),
    false
  );
  assert.ok(replayDuplicate.issues.some((issue) => issue.code === "duplicate-command"));

  const completed = applier.apply(runtime, makeBindingOutput(), { clips, masks }, { deltaSeconds: 2 });
  assert.ok(
    completed.faded.some(
      (layer) => layer.runtimeLayerId === actionLayer.runtimeLayerId && layer.reason === "action-complete"
    ),
    "stateful applier should retire one-shot actions after bounded caller-supplied elapsed time"
  );
}

function runMissingClipMaskConflictAndIsolationTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test", staleFadeSeconds: 0.05 });
  runtime.setLayer("foreign:base", clips.get("clip:foreign")!, { weight: 1, targetWeight: 1, priority: 999 });

  const missingClip = applier.apply(runtime, makeBindingOutput({ missingClip: true }), { clips, masks });
  assert.ok(missingClip.issues.some((issue) => issue.type === "missing-clip"));
  assert.equal(
    runtime.evaluate().activeLayers.some((layer) => layer.id === "foreign:base"),
    true,
    "unrelated runtime layers must remain untouched when application reports missing resources"
  );

  const missingMaskResources = { clips, masks: new Map(masks) };
  missingMaskResources.masks.delete("mask:posture");
  const missingMask = applier.apply(runtime, makeBindingOutput({ postureWeight: 0.5 }), missingMaskResources);
  assert.ok(missingMask.issues.some((issue) => issue.type === "missing-mask"));
  assert.equal(
    missingMask.applied.some((layer) => layer.graphLayer === "posture"),
    false,
    "masked layers should not substitute an arbitrary mask when the configured mask id is missing"
  );

  const throwingClip = createCharacterAnimationRuntimeApplier({ namespace: "test" }).apply(
    new ReferenceAnimationRuntime(testSkeleton),
    makeBindingOutput({ locomotionWeight: 1 }),
    {
      clips: () => {
        throw new Error("clip lookup failed");
      },
      masks
    }
  );
  assert.ok(
    throwingClip.issues.some((issue) => issue.field === "clips" && issue.code === "resolver-threw"),
    "throwing clip resolvers should report invalid-resource issues instead of escaping apply()"
  );

  const throwingMask = createCharacterAnimationRuntimeApplier({ namespace: "test" }).apply(
    new ReferenceAnimationRuntime(testSkeleton),
    makeBindingOutput({ postureWeight: 0.5 }),
    {
      clips,
      masks: () => {
        throw new Error("mask lookup failed");
      }
    }
  );
  assert.equal(
    throwingMask.applied.some((layer) => layer.graphLayer === "posture"),
    false,
    "throwing mask resolvers should not apply masked posture layers"
  );
  assert.ok(throwingMask.issues.some((issue) => issue.field === "masks" && issue.code === "resolver-threw"));

  const conflict = applier.apply(runtime, makeBindingOutput({ conflict: true }), { clips, masks });
  assert.ok(conflict.issues.some((issue) => issue.type === "layer-conflict"));

  applier.apply(runtime, makeBindingOutput({ locomotionWeight: 1 }), { clips, masks });
  const idleAgain = applier.apply(runtime, makeBindingOutput({ locomotionWeight: 0 }), { clips, masks });
  assert.ok(idleAgain.faded.some((layer) => layer.runtimeLayerId === "test:base:base:gait"));
  assert.equal(
    runtime.evaluate().activeLayers.some((layer) => layer.id === "foreign:base"),
    true
  );
}

function runMalformedHostileBoundedInputTests(): void {
  const { clips, masks } = makeResources();
  const runtime = new ReferenceAnimationRuntime(testSkeleton);
  const applier = createCharacterAnimationRuntimeApplier({ namespace: "test", maxRecordsPerApply: 1, maxIssues: 16 });
  const output = createCharacterAnimationRuntimeApplyResultBuffer();

  const hostile = {
    schemaVersion: 1,
    sequence: 7,
    playback: [
      { ...playback("locomotion:idle", "clip:idle", "locomotion", "base", "base:idle", 1), playbackSpeed: Number.NaN },
      playback("locomotion:gait:walk", "clip:walk", "locomotion", "base", "base:gait", 1)
    ],
    blends: "bad",
    transitions: [],
    actions: []
  } as unknown as CharacterAnimationBindingOutput;

  const result = applier.apply(runtime, hostile, { clips, masks }, { output, deltaSeconds: Number.POSITIVE_INFINITY });
  assert.equal(result, output, "caller-owned apply output buffer should be reused");
  assert.equal(result.sequence, 7);
  assert.equal(result.applied.length, 0);
  assert.ok(result.issues.some((issue) => issue.field === "playback.playbackSpeed"));
  assert.ok(result.issues.some((issue) => issue.field === "blends"));
  assert.ok(result.issues.some((issue) => issue.field === "deltaSeconds"));

  assert.throws(
    () => resolveCharacterAnimationRuntimeApplierConfig({ maxRecordsPerApply: Number.NaN }),
    /maxRecordsPerApply/,
    "applier config should reject non-finite bounds"
  );

  const invalidActionKind = applier.apply(
    runtime,
    {
      schemaVersion: 1,
      sequence: 8,
      playback: [],
      blends: [],
      transitions: [],
      actions: [{ ...action("invalid-kind-1"), command: { commandId: "invalid-kind-1", kind: "teleport" as never } }],
      issues: []
    },
    { clips, masks }
  );
  assert.equal(
    invalidActionKind.applied.some((layer) => layer.source === "action"),
    false,
    "runtime applier should reject resolved actions with unsupported public action kinds"
  );
  assert.ok(invalidActionKind.issues.some((issue) => issue.field === "actions.command.kind"));

  const invalidActionOptionalId = applier.apply(
    runtime,
    {
      schemaVersion: 1,
      sequence: 9,
      playback: [],
      blends: [],
      transitions: [],
      actions: [
        {
          ...action("invalid-optional-1"),
          command: { commandId: "invalid-optional-1", kind: "pickup", itemId: 42 as never }
        }
      ],
      issues: []
    },
    { clips, masks }
  );
  assert.equal(
    invalidActionOptionalId.applied.some((layer) => layer.source === "action"),
    false,
    "runtime applier should reject malformed optional action ids instead of silently dropping them"
  );
  assert.ok(invalidActionOptionalId.issues.some((issue) => issue.field === "actions.command.itemId"));
}

const testSkeleton = createSkeleton([
  { name: "hips", humanoid: "hips" },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "head", parentName: "spine", humanoid: "head" },
  { name: "leftUpperArm", parentName: "spine", humanoid: "leftUpperArm" },
  { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg" }
]);

type BindingOutputOptions = {
  locomotionWeight?: number;
  gait?: "walk" | "run";
  phase?: number;
  postureWeight?: number;
  airborne?: "rise" | "fall" | "landing";
  airbornePhase?: number;
  actionCommandId?: string;
  missingClip?: boolean;
  conflict?: boolean;
};

function makeResources(): { clips: Map<string, AnimationClip>; masks: Map<string, Float32Array> } {
  const clips = new Map<string, AnimationClip>([
    ["clip:idle", makeClip("clip:idle", 1)],
    ["clip:walk", makeClip("clip:walk", 2)],
    ["clip:run", makeClip("clip:run", 0.8)],
    ["clip:stand", makeClip("clip:stand", 1)],
    ["clip:crouch", makeClip("clip:crouch", 1)],
    ["clip:rise", makeClip("clip:rise", 1)],
    ["clip:fall", makeClip("clip:fall", 1)],
    ["clip:land", makeClip("clip:land", 0.4)],
    ["clip:pickup", makeClip("clip:pickup", 0.75)],
    ["clip:foreign", makeClip("clip:foreign", 1)]
  ]);
  const masks = new Map<string, Float32Array>([
    ["mask:full-body", createJointMask(testSkeleton, 1)],
    ["mask:posture", createJointMask(testSkeleton, 0, { spine: 1, head: 1 })],
    ["mask:upper-body", createJointMask(testSkeleton, 0, { spine: 1, head: 1, leftUpperArm: 1 })]
  ]);
  return { clips, masks };
}

function makeClip(id: string, duration: number): AnimationClip {
  return {
    id,
    duration,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, duration]),
        values: toFloat32Array([0, 0, 0, duration, 0, 0])
      }
    ]
  };
}

function makeFullBodyTranslationClip(id: string, duration: number, x: number): AnimationClip {
  return {
    id,
    duration,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, duration]),
        values: toFloat32Array([x, 0, 0, x, 0, 0])
      },
      {
        humanBone: "leftUpperLeg",
        property: "translation",
        times: toFloat32Array([0, duration]),
        values: toFloat32Array([x, 0, 0, x, 0, 0])
      }
    ]
  };
}

function makeSinglePlaybackOutput(
  clipId: string,
  options: { maskId?: string; fadeSeconds?: number } = {}
): CharacterAnimationBindingOutput {
  return {
    schemaVersion: 1,
    sequence: 1,
    playback: [playback("locomotion:gait:walk", clipId, "locomotion", "base", "shared", 1, options)],
    blends: [],
    transitions: [],
    actions: [],
    issues: []
  };
}

function makeBindingOutput(options: BindingOutputOptions = {}): CharacterAnimationBindingOutput {
  const locomotionWeight = options.locomotionWeight ?? 0;
  const gait = options.gait ?? "walk";
  const phase = options.phase ?? 0;
  const postureWeight = options.postureWeight ?? 0;
  const playbackRecords = [
    playback("locomotion:idle", "clip:idle", "locomotion", "base", "base:idle", 1 - locomotionWeight, { phase }),
    playback(`locomotion:gait:${gait}`, `clip:${gait}`, "locomotion", "base", "base:gait", locomotionWeight, { phase }),
    playback("posture:standing", "clip:stand", "posture", "posture", "posture:standing", 1 - postureWeight, {
      maskId: "mask:posture"
    }),
    playback("posture:crouching", "clip:crouch", "posture", "posture", "posture:crouching", postureWeight, {
      maskId: "mask:posture",
      phase: postureWeight
    })
  ];
  if (options.airborne) {
    playbackRecords.push(
      playback(`airborne:${options.airborne}`, airborneClipId(options.airborne), "airborne", "base", "airborne", 1, {
        phase: options.airbornePhase ?? 0,
        loop: options.airborne === "fall",
        priority: 210,
        fadeSeconds: options.airborne === "landing" ? 0.1 : 0.08
      })
    );
  }
  if (options.missingClip) {
    playbackRecords.push(playback("locomotion:gait:missing", "clip:missing", "locomotion", "base", "missing", 1));
  }
  if (options.conflict) {
    playbackRecords.push(playback("locomotion:gait:run", "clip:run", "locomotion", "base", "base:idle", 1));
  }

  return {
    schemaVersion: 1,
    sequence: 1,
    playback: playbackRecords,
    blends: [
      {
        type: "blend",
        layer: "locomotion",
        from: endpoint("locomotion:idle", "clip:idle", "locomotion", "base", "base:idle", 1 - locomotionWeight, {
          phase
        }),
        to: endpoint(`locomotion:gait:${gait}`, `clip:${gait}`, "locomotion", "base", "base:gait", locomotionWeight, {
          phase
        }),
        fromWeight: 1 - locomotionWeight,
        toWeight: locomotionWeight,
        priority: 10,
        fadeSeconds: 0.15,
        reason: "gait",
        sourceIndex: 0
      },
      {
        type: "blend",
        layer: "posture",
        from: endpoint("posture:standing", "clip:stand", "posture", "posture", "posture:standing", 1 - postureWeight, {
          maskId: "mask:posture"
        }),
        to: endpoint("posture:crouching", "clip:crouch", "posture", "posture", "posture:crouching", postureWeight, {
          maskId: "mask:posture",
          phase: postureWeight
        }),
        fromWeight: 1 - postureWeight,
        toWeight: postureWeight,
        priority: 110,
        fadeSeconds: 0.16,
        reason: "posture",
        sourceIndex: 1
      }
    ],
    transitions: transitionRecords(options),
    actions: options.actionCommandId ? [action(options.actionCommandId)] : [],
    issues: []
  };
}

function transitionRecords(options: BindingOutputOptions): CharacterAnimationBindingOutput["transitions"] {
  const transitions: CharacterAnimationBindingOutput["transitions"] = [];
  if ((options.locomotionWeight ?? 0) > 0) {
    transitions.push({
      type: "transition",
      layer: "locomotion",
      from: baseEndpoint("locomotion:idle", "clip:idle", "locomotion", "base", "base:idle"),
      to: baseEndpoint(
        `locomotion:gait:${options.gait ?? "walk"}`,
        `clip:${options.gait ?? "walk"}`,
        "locomotion",
        "base",
        "base:gait"
      ),
      priority: 10,
      fadeSeconds: 0.15,
      reason: "locomotion-hysteresis",
      sourceIndex: 0
    });
  } else {
    transitions.push({
      type: "transition",
      layer: "locomotion",
      from: baseEndpoint("locomotion:gait:walk", "clip:walk", "locomotion", "base", "base:gait"),
      to: baseEndpoint("locomotion:idle", "clip:idle", "locomotion", "base", "base:idle"),
      priority: 10,
      fadeSeconds: 0.15,
      reason: "locomotion-hysteresis",
      sourceIndex: 0
    });
  }
  if (options.airborne) {
    transitions.push({
      type: "transition",
      layer: "airborne",
      from: null,
      to: baseEndpoint(
        `airborne:${options.airborne}`,
        airborneClipId(options.airborne),
        "airborne",
        "base",
        "airborne",
        {
          loop: options.airborne === "fall",
          priority: 210
        }
      ),
      priority: 210,
      fadeSeconds: options.airborne === "landing" ? 0.1 : 0.08,
      reason: "airborne-phase",
      sourceIndex: 1
    });
  }
  return transitions;
}

function playback(
  requestId: string,
  clipId: string,
  graphLayer: "locomotion" | "posture" | "airborne" | "action",
  laneId: string,
  layerId: string,
  weight: number,
  options: { phase?: number; maskId?: string; loop?: boolean; priority?: number; fadeSeconds?: number } = {}
): CharacterAnimationBindingOutput["playback"][number] {
  return {
    ...baseEndpoint(requestId, clipId, graphLayer, laneId, layerId, options),
    type: "playback",
    weight,
    phase: options.phase ?? 0,
    reason:
      graphLayer === "locomotion" && requestId.includes("gait")
        ? "gait"
        : graphLayer === "posture"
          ? "posture"
          : graphLayer === "airborne"
            ? "airborne"
            : "idle",
    sourceIndex: 0
  };
}

function endpoint(
  requestId: string,
  clipId: string,
  graphLayer: "locomotion" | "posture" | "airborne" | "action",
  laneId: string,
  layerId: string,
  weight: number,
  options: { phase?: number; maskId?: string; loop?: boolean; priority?: number; fadeSeconds?: number } = {}
): CharacterAnimationBindingOutput["blends"][number]["from"] {
  return { ...baseEndpoint(requestId, clipId, graphLayer, laneId, layerId, options), weight };
}

function baseEndpoint(
  requestId: string,
  clipId: string,
  graphLayer: "locomotion" | "posture" | "airborne" | "action",
  laneId: string,
  layerId: string,
  options: { maskId?: string; loop?: boolean; priority?: number; fadeSeconds?: number } = {}
) {
  return {
    requestId,
    clipId,
    graphLayer,
    laneId,
    layerId,
    blendMode: graphLayer === "action" ? "additive" : "override",
    loop: options.loop ?? true,
    priority:
      options.priority ??
      (graphLayer === "posture" ? 110 : graphLayer === "airborne" ? 210 : graphLayer === "action" ? 310 : 10),
    fadeSeconds: options.fadeSeconds ?? 0.15,
    playbackSpeed: 1,
    ...(options.maskId !== undefined ? { maskId: options.maskId } : {})
  } as const;
}

function action(commandId: string): CharacterAnimationBindingOutput["actions"][number] {
  return {
    ...baseEndpoint("action:pickup", "clip:pickup", "action", "overlay", "action:pickup", {
      maskId: "mask:upper-body",
      loop: false,
      priority: 310,
      fadeSeconds: 0.05
    }),
    type: "action",
    weight: 1,
    phase: 0,
    command: { commandId, kind: "pickup" },
    sourceIndex: 0,
    controllerTick: 5
  };
}

function airborneClipId(airborne: "rise" | "fall" | "landing"): string {
  return airborne === "landing" ? "clip:land" : `clip:${airborne}`;
}
