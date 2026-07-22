import type { AnimationClip } from "./test-api.js";
import {
  runMotionAttachmentTests,
  runMotionRuntimeDiagnosticTests,
  runMotionThreeRuntimeUtilityTests
} from "./motion-attachments-runtime.test.js";
import { runMotionPosePolicyTests } from "./motion-pose-policy.test.js";
import { runMotionPoseSamplingTests } from "./motion-pose-sampling.test.js";
import { runMotionRootMotionTests, runMotionRuntimeRootMotionTests } from "./motion-root-motion.test.js";
import { runMotionSkinningGeometryTests } from "./motion-skinning-geometry.test.js";
import {
  ReferenceAnimationRuntime,
  assert,
  identityTransform,
  synchronizeLocomotionPlayback,
  toFloat32Array
} from "./test-api.js";
import { createRootMotionTestFixture, skeleton, vectorNearlyEqual } from "./test-helpers.js";

export async function runMotionRuntimeTests(): Promise<void> {
  runRuntimeSchedulingCompositionRegressionTests();
  await runMotionRootMotionTests();
  await runMotionPoseSamplingTests();
  await runMotionSkinningGeometryTests();
  await runMotionAttachmentTests();
  await runMotionPosePolicyTests();
  await runMotionThreeRuntimeUtilityTests();
  await runMotionRuntimeRootMotionTests();
  await runMotionRuntimeDiagnosticTests();
}

function runRuntimeSchedulingCompositionRegressionTests(): void {
  const oldClip = createHeadTranslationClip("runtime-crossfade-old", 2);
  const newClip = createHeadTranslationClip("runtime-crossfade-new", 10);

  const malformedSetLayerRuntime = new ReferenceAnimationRuntime(skeleton);
  const malformedSetLayer = malformedSetLayerRuntime.setLayer("bad-mode", oldClip, {
    weight: 1,
    targetWeight: 1,
    blendMode: "legacy-mode" as never,
    loop: "yes" as never
  });
  assert.equal(malformedSetLayer.blendMode, "override", "runtime layers should sanitize malformed blend modes");
  assert.equal(malformedSetLayer.loop, false, "runtime layers should ignore malformed loop flags");

  const hugeLocomotion = synchronizeLocomotionPlayback([
    { id: "slow", duration: 1, weight: Number.MAX_VALUE },
    { id: "fast", duration: 3, weight: Number.MAX_VALUE }
  ]);
  assert.equal(hugeLocomotion.totalWeight, Number.MAX_VALUE);
  assert.equal(hugeLocomotion.activeWeight, Number.MAX_VALUE);
  assert.ok(
    Math.abs(hugeLocomotion.synchronizedDuration - 2) < 1e-6,
    "locomotion sync should average huge finite weights without overflowing to NaN"
  );
  assert.deepEqual(
    hugeLocomotion.layers.map((layer) => layer.normalizedWeight),
    [0.5, 0.5]
  );

  const malformedCrossfadeRuntime = new ReferenceAnimationRuntime(skeleton, { blendThreshold: 0.01 });
  const malformedSource = malformedCrossfadeRuntime.setLayer("old", oldClip, {
    weight: 1,
    targetWeight: 1,
    priority: 0
  });
  malformedSource.blendMode = "legacy-mode" as never;
  malformedSource.priority = Number.NaN;
  malformedCrossfadeRuntime.crossfade("new", newClip, { priority: 0, fadeSpeed: 1 });
  malformedCrossfadeRuntime.update(Math.log(2));
  const malformedCrossfade = malformedCrossfadeRuntime.evaluate();
  const fadedSource = malformedCrossfade.activeLayers.find((layer) => layer.id === "old");
  assert.equal(fadedSource?.blendMode, "override", "update/evaluate should repair corrupted layer blend modes");
  assert.equal(fadedSource?.targetWeight, 0, "crossfade should still fade corrupted override-compatible sources");
  assert.ok(Math.abs((fadedSource?.weight ?? 0) - 0.5) < 1e-6);
  assert.ok(Math.abs(malformedCrossfade.localPose[2]!.translation[0] - 6) < 1e-6);

  const deterministicOrderRuntime = new ReferenceAnimationRuntime(skeleton);
  deterministicOrderRuntime.setLayer("a", oldClip, { weight: 1, targetWeight: 1, priority: 2 });
  deterministicOrderRuntime.setLayer("B", newClip, { weight: 1, targetWeight: 1, priority: 2 });
  assert.deepEqual(
    deterministicOrderRuntime.evaluate().activeLayers.map((layer) => layer.id),
    ["B", "a"],
    "same-priority runtime layer metadata should use locale-independent id ordering"
  );

  const overflowTimeRuntime = new ReferenceAnimationRuntime(skeleton);
  overflowTimeRuntime.setLayer(
    "unbounded-time",
    { id: "unbounded-time", duration: 0, tracks: [] },
    {
      weight: 1,
      targetWeight: 1,
      time: Number.MAX_VALUE,
      speed: Number.MAX_VALUE,
      loop: true
    }
  );
  overflowTimeRuntime.update(2);
  assert.equal(
    overflowTimeRuntime.evaluate().activeLayers.find((layer) => layer.id === "unbounded-time")?.time,
    Number.MAX_VALUE,
    "overflowing time advances should preserve the last finite layer time instead of resetting"
  );

  const { motionSkeleton } = createRootMotionTestFixture();
  const zeroDurationMotion: AnimationClip = {
    id: "zero-duration-runtime-motion",
    duration: 0,
    loop: true,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([10, 0, 0]) }]
  };
  const zeroDurationRuntime = new ReferenceAnimationRuntime(motionSkeleton);
  zeroDurationRuntime.setLayer("zero-duration", zeroDurationMotion, { weight: 1, targetWeight: 1, loop: true });
  const zeroDurationUpdate = zeroDurationRuntime.update(1, { collectRootMotion: true });
  assert.deepEqual(
    zeroDurationUpdate.rootMotionDelta,
    identityTransform(),
    "zero-duration clips should not emit runtime root motion"
  );
  assert.equal(zeroDurationUpdate.rootMotionLayers.length, 0);

  const pausedRootMotion = createRootTranslationClip("paused-root-motion", 10);
  const pausedRuntime = new ReferenceAnimationRuntime(motionSkeleton);
  pausedRuntime.setLayer("paused", pausedRootMotion, { weight: 1, targetWeight: 1, time: 0.25, speed: 0 });
  const pausedUpdate = pausedRuntime.update(0.5, { collectRootMotion: true });
  assert.deepEqual(pausedUpdate.rootMotionDelta, identityTransform(), "paused layers should not emit interval motion");
  assert.equal(pausedUpdate.rootMotionLayers.length, 0, "paused layers should not emit root-motion diagnostics");
  assert.equal(pausedRuntime.evaluate().activeLayers.find((layer) => layer.id === "paused")?.time, 0.25);

  const pausedFadeRuntime = new ReferenceAnimationRuntime(motionSkeleton);
  pausedFadeRuntime.setLayer("paused-fade", pausedRootMotion, {
    weight: 1,
    targetWeight: 0,
    fadeSpeed: Math.log(2),
    time: 0.25,
    speed: 0
  });
  const pausedFadeUpdate = pausedFadeRuntime.update(1, { collectRootMotion: true });
  assert.deepEqual(
    pausedFadeUpdate.rootMotionDelta,
    identityTransform(),
    "paused fading layers should not emit interval motion"
  );
  assert.equal(
    pausedFadeUpdate.rootMotionLayers.length,
    0,
    "paused fading layers should not emit root-motion diagnostics"
  );
  const pausedFadeLayer = pausedFadeRuntime.evaluate().activeLayers.find((layer) => layer.id === "paused-fade");
  assert.equal(pausedFadeLayer?.time, 0.25, "paused fading layers should keep their local clock");
  assert.ok(
    pausedFadeLayer && Math.abs(pausedFadeLayer.weight - 0.5) < 1e-6,
    "paused fading layers should continue fading even when root motion is skipped"
  );

  const cappedLoopRuntime = new ReferenceAnimationRuntime(motionSkeleton);
  cappedLoopRuntime.setLayer("capped-loop", createRootTranslationClip("capped-loop-motion", 10), {
    weight: 1,
    targetWeight: 1,
    loop: true,
    speed: 10001
  });
  const cappedLoopUpdate = cappedLoopRuntime.update(1, { collectRootMotion: true });
  assert.deepEqual(
    cappedLoopUpdate.rootMotionDelta,
    identityTransform(),
    "pathological multi-loop spans should use identity root-motion fallback instead of unbounded sampling"
  );
  assert.deepEqual(
    cappedLoopUpdate.rootMotionLayers.map((layer) => [layer.id, layer.delta]),
    [["capped-loop", identityTransform()]]
  );

  const hugeRootMotionRuntime = new ReferenceAnimationRuntime(motionSkeleton);
  hugeRootMotionRuntime.setLayer("huge-a", createRootTranslationClip("huge-root-motion-a", 10), {
    weight: Number.MAX_VALUE,
    targetWeight: Number.MAX_VALUE,
    priority: 3
  });
  hugeRootMotionRuntime.setLayer("huge-b", createRootTranslationClip("huge-root-motion-b", 2), {
    weight: Number.MAX_VALUE,
    targetWeight: Number.MAX_VALUE,
    priority: 3
  });
  const hugeRootMotionUpdate = hugeRootMotionRuntime.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(hugeRootMotionUpdate.rootMotionDelta.translation, [6, 0, 0], 1e-6),
    "huge same-priority root-motion weights should be normalized without overflow"
  );
  assert.deepEqual(
    hugeRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
    [
      ["huge-a", 0.5],
      ["huge-b", 0.5]
    ]
  );

  const sanitizedThresholdRuntime = new ReferenceAnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
  sanitizedThresholdRuntime.blendThreshold = Number.POSITIVE_INFINITY;
  sanitizedThresholdRuntime.setLayer("base-motion", createRootTranslationClip("threshold-base-motion", 10), {
    weight: 1,
    targetWeight: 1,
    priority: 0
  });
  sanitizedThresholdRuntime.setLayer("weak-motion", createRootTranslationClip("threshold-weak-motion", 2), {
    weight: 0.05,
    targetWeight: 0.05,
    priority: 1
  });
  const sanitizedThresholdUpdate = sanitizedThresholdRuntime.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(sanitizedThresholdUpdate.rootMotionDelta.translation, [6, 0, 0], 1e-6),
    "mutable non-finite runtime blend thresholds should be sanitized during root-motion composition"
  );
}

function createHeadTranslationClip(id: string, x: number): AnimationClip {
  return {
    id,
    duration: 1,
    tracks: [
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([x, 0, 0]) }
    ]
  };
}

function createRootTranslationClip(id: string, x: number): AnimationClip {
  return {
    id,
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, x, 0, 0])
      }
    ]
  };
}
