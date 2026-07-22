import type { AnimationClip, SampleRepairDiagnostic } from "./test-api.js";
import {
  AnimationRuntime,
  MotionAccumulator,
  MotionExtractor,
  MotionSampler,
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  blendMotionDeltas,
  computeLocomotionBlendWeights,
  createJointMask,
  createRawAnimation,
  extractRawRootMotion,
  extractRootMotion,
  identityTransform,
  inspectClipAsset,
  invertQuat,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  sampleClipToPose,
  sampleMotionCarrier,
  sampleMotionIntervalDelta,
  sampleMotionTracks,
  sampleMotionTracksIntervalDelta,
  sanitizeQuaternionTrackValues,
  synchronizeLocomotionPlayback,
  toFloat32Array
} from "./test-api.js";
import { createRootMotionTestFixture, quaternionNearlyEqual, vectorNearlyEqual } from "./test-helpers.js";

export async function runMotionRootMotionTests(): Promise<void> {
  const { motionSkeleton, motionClip } = createRootMotionTestFixture();
  const defaultRootMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25);
  assert.equal(defaultRootMotionSample.joint, "root", "motion sampling should default to the skeleton root carrier");
  assert.deepEqual(defaultRootMotionSample.transform.translation, [2.5, 0, 0]);
  const humanoidMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { humanBone: "hips" } });
  assert.equal(humanoidMotionSample.jointIndex, 1, "motion sampling should resolve explicit humanoid carriers");
  assert.deepEqual(humanoidMotionSample.transform.translation, [0, 1, 3]);
  const jointMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { joint: "hips" } });
  assert.deepEqual(
    jointMotionSample.transform.translation,
    humanoidMotionSample.transform.translation,
    "motion sampling should resolve explicit joint-name carriers"
  );
  const indexedMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { jointIndex: 1 } });
  assert.deepEqual(
    indexedMotionSample.transform.translation,
    humanoidMotionSample.transform.translation,
    "motion sampling should resolve explicit joint-index carriers"
  );
  const motionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.2, 0.7);
  assert.deepEqual(
    motionDelta.delta.translation,
    [5, 0, 0],
    "motion interval deltas should report carrier displacement"
  );
  assert.ok(
    quaternionNearlyEqual(motionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
    "motion interval deltas should report carrier rotation"
  );
  const wrappedMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.75, 1.25);
  assert.deepEqual(
    wrappedMotionDelta.delta.translation,
    [5, 0, 0],
    "looped motion intervals should accumulate forward displacement across wrap"
  );
  const negativeMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.7, 0.2, { loop: false });
  assert.ok(
    vectorNearlyEqual(negativeMotionDelta.delta.translation, [-5, 0, 0], 1e-6),
    "non-looping negative motion intervals should preserve signed clamped deltas"
  );
  assert.ok(
    quaternionNearlyEqual(negativeMotionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], -Math.PI / 2), 1e-5),
    "non-looping negative motion intervals should preserve signed clamped rotation deltas"
  );
  const backwardLoopingMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.25, -0.25, {
    loop: true
  });
  assert.ok(
    vectorNearlyEqual(backwardLoopingMotionDelta.delta.translation, [-5, 0, 0], 1e-5),
    "looped clip-carrier motion intervals should support backward playback deltas"
  );
  assert.ok(
    quaternionNearlyEqual(backwardLoopingMotionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], -Math.PI / 2), 1e-5),
    "looped clip-carrier motion intervals should invert rotation for backward playback"
  );
  const largeLoopingMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0, 100.5, { loop: true });
  assert.ok(
    vectorNearlyEqual(largeLoopingMotionDelta.delta.translation, [1005, 0, 0], 1e-4),
    "large looping clip-carrier motion intervals should accumulate full-loop displacement without per-loop drift"
  );
  assert.ok(
    quaternionNearlyEqual(largeLoopingMotionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
    "large looping clip-carrier motion intervals should compose full-loop rotations deterministically"
  );
  const safeMultiLoopingMotionDelta = sampleMotionIntervalDelta(
    motionSkeleton,
    motionClip,
    0,
    Number.MAX_SAFE_INTEGER,
    { loop: true }
  );
  assert.deepEqual(
    safeMultiLoopingMotionDelta.delta.translation,
    [90071992547409920, 0, 0],
    "safe integer clip-carrier loop counts should preserve binary exponentiation behavior"
  );
  const hugeForwardLoopingMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0, 1e16, {
    loop: true
  });
  assert.deepEqual(
    hugeForwardLoopingMotionDelta.delta.translation,
    [1e17, 0, 0],
    "positive finite integral clip-carrier loop counts should preserve represented forward displacement"
  );
  assert.ok(
    hugeForwardLoopingMotionDelta.delta.translation.every(Number.isFinite) &&
      hugeForwardLoopingMotionDelta.delta.rotation.every(Number.isFinite),
    "unsafe finite forward clip-carrier intervals should remain deterministic and finite"
  );
  const hugeReverseLoopingMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 1e16, 0, {
    loop: true
  });
  assert.deepEqual(
    hugeReverseLoopingMotionDelta.delta.translation,
    [-1e17, 0, 0],
    "positive finite integral clip-carrier loop counts should preserve represented reverse displacement"
  );
  assert.ok(
    hugeReverseLoopingMotionDelta.delta.translation.every(Number.isFinite) &&
      hugeReverseLoopingMotionDelta.delta.rotation.every(Number.isFinite),
    "unsafe finite reverse clip-carrier intervals should remain deterministic and finite"
  );
  const subnormalDurationMotionClip: AnimationClip = {
    id: "subnormal-duration-motion",
    duration: Number.MIN_VALUE,
    loop: true,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, Number.MIN_VALUE]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      }
    ]
  };
  const quotientOverflowMotionDelta = sampleMotionIntervalDelta(motionSkeleton, subnormalDurationMotionClip, 0, 1, {
    loop: true
  });
  assert.deepEqual(
    quotientOverflowMotionDelta.delta.translation,
    [Number.MAX_VALUE, 0, 0],
    "finite clip-carrier intervals whose loop quotient overflows should saturate instead of returning identity"
  );
  const signedScaleMotionClip: AnimationClip = {
    id: "signed-scale-motion",
    duration: 1,
    tracks: [
      { joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([-2, 2, -4, -4, 6, 2]) }
    ]
  };
  const signedScaleMotionDelta = sampleMotionIntervalDelta(motionSkeleton, signedScaleMotionClip, 0, 1, {
    loop: false
  });
  assert.deepEqual(
    signedScaleMotionDelta.delta.scale,
    [2, 3, -0.5],
    "motion interval scale deltas should preserve finite negative scale ratios"
  );
  const nonFiniteMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, Number.NaN);
  assert.equal(
    nonFiniteMotionSample.time,
    0,
    "non-finite motion sample times should deterministically sample time zero"
  );
  assert.deepEqual(nonFiniteMotionSample.transform.translation, [0, 0, 0]);
  const invalidCarrierDiagnostics: SampleRepairDiagnostic[] = [];
  const invalidCarrierSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25, {
    carrier: { humanBone: "pelvis" },
    diagnostics: invalidCarrierDiagnostics
  });
  assert.equal(invalidCarrierSample.joint, "root", "invalid motion carriers should fall back to the skeleton root");
  assert.ok(
    invalidCarrierDiagnostics.some(
      (issue) => issue.message === "motion carrier humanoid bone pelvis does not map to skeleton; using root"
    ),
    "invalid motion carriers should report diagnostics when requested"
  );
  const repairedMotionDiagnostics: SampleRepairDiagnostic[] = [];
  const repairedMotionClip: AnimationClip = {
    id: "repaired-root-motion",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 2, Number.NaN, 0, 0, 1])
      }
    ]
  };
  const repairedMotionSample = sampleMotionCarrier(motionSkeleton, repairedMotionClip, 0.5, {
    diagnostics: repairedMotionDiagnostics
  });
  assert.ok(
    repairedMotionSample.transform.rotation.every(Number.isFinite),
    "motion carrier sampling should repair non-finite rotation samples"
  );
  assert.ok(
    Math.abs(Math.hypot(...repairedMotionSample.transform.rotation) - 1) < 1e-6,
    "motion carrier rotations should remain normalized"
  );
  assert.ok(
    repairedMotionDiagnostics.some(
      (issue) =>
        issue.property === "rotation" && issue.message === "rotation track quaternion was normalized during sampling"
    ),
    "motion carrier sampling should preserve rotation repair diagnostics"
  );
  assert.ok(
    repairedMotionDiagnostics.some(
      (issue) =>
        issue.property === "rotation" &&
        issue.message === "rotation track quaternion values were repaired to finite defaults"
    ),
    "motion carrier sampling should report non-finite rotation repairs"
  );

  const extractionClip: AnimationClip = {
    id: "extract-root-motion",
    duration: 1,
    loop: true,
    metadata: { rootMotionPolicy: "preserved" },
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 0.5, 1]),
        values: toFloat32Array([0, 0, 0, 5, 1, 2.5, 10, 2, 5])
      },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      },
      {
        joint: "spine",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0.25, 0])
      }
    ]
  };
  const extractedRootMotion = extractRootMotion(motionSkeleton, extractionClip, {
    reference: "absolute",
    translation: { axes: { x: true, y: false, z: true }, bake: true },
    rotation: { mode: "yaw", bake: true },
    bakedClipId: "extract-root-motion-in-place"
  });
  assert.equal(
    extractedRootMotion.motion.carrier.joint,
    "root",
    "root-motion extraction should report the resolved carrier"
  );
  assert.ok(
    extractedRootMotion.motion.position,
    "root-motion extraction should emit a position motion track by default"
  );
  assert.ok(extractedRootMotion.motion.rotation, "root-motion extraction should emit a yaw motion track by default");
  const extractedHalfMotion = sampleMotionTracks(extractedRootMotion.motion, 0.5);
  assert.ok(
    vectorNearlyEqual(extractedHalfMotion.transform.translation, [5, 0, 2.5], 1e-6),
    "extracted translation should honor the selected axis mask"
  );
  assert.ok(
    quaternionNearlyEqual(extractedHalfMotion.transform.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "extracted rotation should isolate carrier yaw"
  );
  assert.deepEqual(
    Array.from(extractionClip.tracks[0]!.values),
    [0, 0, 0, 5, 1, 2.5, 10, 2, 5],
    "root-motion extraction should not mutate the source clip"
  );
  assert.ok(extractedRootMotion.bakedClip, "baked root-motion extraction should return a cloned in-place clip");
  assert.notEqual(
    extractedRootMotion.bakedClip,
    extractionClip,
    "root-motion baking should clone rather than mutate the source clip"
  );
  const bakedRootTranslation = extractedRootMotion.bakedClip.tracks[0]!;
  assert.deepEqual(
    Array.from(bakedRootTranslation.values),
    [0, 0, 0, 0, 1, 0, 0, 2, 0],
    "baked root-motion translation should remove selected axes and preserve unselected authored motion"
  );
  assert.ok(
    quaternionNearlyEqual(
      sampleClipToPose(motionSkeleton, extractedRootMotion.bakedClip, 1, { loop: false })[0]!.rotation,
      [0, 0, 0, 1],
      1e-5
    ),
    "baked root-motion rotation should remove extracted yaw from the carrier track"
  );
  assert.deepEqual(
    sampleClipToPose(motionSkeleton, extractedRootMotion.bakedClip, 1, { loop: false })[2]!.translation,
    [0, 0.25, 0],
    "root-motion baking should leave unrelated tracks unchanged"
  );

  const stationaryResidualRaw = createRawAnimation({
    id: "stationary-residual-pelvis",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [10, 100, -5] },
          { time: 0.5, value: [20, 103, -7] },
          { time: 1, value: [10.2, 100.1, -5.1] }
        ]
      }
    ]
  });
  const stationaryResidual = extractRawRootMotion(motionSkeleton, stationaryResidualRaw, {
    carrier: { joint: "root" },
    reference: "animation",
    translation: { axes: { x: true, y: true, z: true }, bake: true, bakeMode: "remove-linear-trajectory", loop: true },
    rotation: false
  });
  assert.ok(stationaryResidual.motion.position, "stationary residual extraction should emit pelvis/COM translation");
  assert.ok(
    vectorNearlyEqual(stationaryResidual.rawAnimation.tracks[0]!.translations[0]!.value, [10, 100, -5], 1e-6),
    "stationary residual bake should preserve target rest-relative first pelvis sample"
  );
  assert.ok(
    vectorNearlyEqual(stationaryResidual.rawAnimation.tracks[0]!.translations[1]!.value, [19.9, 102.95, -6.95], 1e-5),
    "stationary residual bake should remove only seam drift, not destroy authored COM X/Y/Z residual"
  );
  assert.ok(
    vectorNearlyEqual(stationaryResidual.rawAnimation.tracks[0]!.translations[2]!.value, [10, 100, -5], 1e-5),
    "stationary residual loop normalization should close the pelvis seam without scene-root travel"
  );

  const rotationBakeTranslationClip: AnimationClip = {
    id: "rotation-bake-translation-compensation",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 1])
      },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  const rotationBakeTranslation = extractRootMotion(motionSkeleton, rotationBakeTranslationClip, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true }
  });
  const rotationBakeTranslationRaw = createRawAnimation({
    id: "raw-rotation-bake-translation-compensation",
    duration: 1,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0, 0, 1] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2) }
        ]
      }
    ]
  });
  const rawRotationBakeTranslation = extractRawRootMotion(motionSkeleton, rotationBakeTranslationRaw, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true }
  });
  const compensatedTranslation = rotateVec3ByQuat(invertQuat(quatFromAxisAngle([0, 1, 0], Math.PI / 2)), [0, 0, 1]);
  assert.ok(rotationBakeTranslation.bakedClip, "rotation-only root-motion baking should still clone an in-place clip");
  assert.ok(
    vectorNearlyEqual(
      sampleClipToPose(motionSkeleton, rotationBakeTranslation.bakedClip, 1, { loop: false })[0]!.translation,
      compensatedTranslation,
      1e-6
    ),
    "clip root-motion rotation baking should compensate carrier translation keys into the baked orientation"
  );
  assert.ok(
    vectorNearlyEqual(
      rawRotationBakeTranslation.rawAnimation.tracks[0]!.translations[1]!.value,
      compensatedTranslation,
      1e-6
    ),
    "raw root-motion rotation baking should document the matching translation compensation"
  );
  const wrappedExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.75, 2.25, { loop: true });
  assert.ok(
    vectorNearlyEqual(wrappedExtractedDelta.delta.translation, [15, 0, 7.5], 1e-5),
    "motion tracks should accumulate multi-loop forward deltas"
  );
  assert.ok(
    quaternionNearlyEqual(wrappedExtractedDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI * 0.75), 1e-5),
    "motion tracks should accumulate multi-loop yaw deltas"
  );
  const backwardExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.25, -0.25, {
    loop: true
  });
  assert.ok(
    vectorNearlyEqual(backwardExtractedDelta.delta.translation, [-5, 0, -2.5], 1e-5),
    "motion tracks should support backward looping intervals"
  );
  assert.ok(
    quaternionNearlyEqual(backwardExtractedDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], -Math.PI / 4), 1e-5),
    "motion tracks should invert rotation for backward intervals"
  );
  const largeExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0, 100.5, { loop: true });
  assert.ok(
    vectorNearlyEqual(largeExtractedDelta.delta.translation, [1005, 0, 502.5], 1e-4),
    "large looping motion intervals should avoid per-loop drift"
  );
  assert.ok(
    largeExtractedDelta.delta.rotation.every(Number.isFinite),
    "large looping motion intervals should keep finite rotations"
  );
  const safeMultiLoopExtractedDelta = sampleMotionTracksIntervalDelta(
    extractedRootMotion.motion,
    0,
    Number.MAX_SAFE_INTEGER,
    { loop: true }
  );
  assert.deepEqual(
    safeMultiLoopExtractedDelta.delta.translation,
    [90071992547409920, 0, 45035996273704960],
    "safe integer motion-track loop counts should preserve binary exponentiation behavior"
  );
  const hugeForwardExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0, 1e16, {
    loop: true
  });
  assert.deepEqual(
    hugeForwardExtractedDelta.delta.translation,
    [1e17, 0, 5e16],
    "positive finite integral motion-track loop counts should preserve represented forward displacement"
  );
  assert.ok(
    hugeForwardExtractedDelta.delta.translation.every(Number.isFinite) &&
      hugeForwardExtractedDelta.delta.rotation.every(Number.isFinite),
    "unsafe finite forward motion-track intervals should remain deterministic and finite"
  );
  const hugeReverseExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 1e16, 0, {
    loop: true
  });
  assert.deepEqual(
    hugeReverseExtractedDelta.delta.translation,
    [-1e17, 0, -5e16],
    "positive finite integral motion-track loop counts should preserve represented reverse displacement"
  );
  assert.ok(
    hugeReverseExtractedDelta.delta.translation.every(Number.isFinite) &&
      hugeReverseExtractedDelta.delta.rotation.every(Number.isFinite),
    "unsafe finite reverse motion-track intervals should remain deterministic and finite"
  );
  const quotientOverflowTrackDelta = sampleMotionTracksIntervalDelta(
    {
      duration: Number.MIN_VALUE,
      loop: true,
      position: extractedRootMotion.motion.position
    },
    0,
    1,
    { loop: true }
  );
  assert.deepEqual(
    quotientOverflowTrackDelta.delta.translation,
    [Number.MAX_VALUE, 0, Number.MAX_VALUE],
    "finite motion-track intervals whose loop quotient overflows should saturate instead of returning identity"
  );
  const clampedBackwardDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.75, 0.25, { loop: false });
  assert.ok(
    vectorNearlyEqual(clampedBackwardDelta.delta.translation, [-5, 0, -2.5], 1e-5),
    "non-looping motion tracks should clamp samples but preserve signed interval deltas"
  );
  const motionSampler = new MotionSampler();
  motionSampler.update(extractedRootMotion.motion, 0, 0.5, { loop: true });
  assert.ok(
    vectorNearlyEqual(motionSampler.current.translation, [5, 0, 2.5], 1e-6),
    "motion sampler should accumulate its first interval"
  );
  motionSampler.update(extractedRootMotion.motion, 0.5, 1.25, { loop: true });
  assert.ok(
    vectorNearlyEqual(motionSampler.current.translation, [12.5, 0, 6.25], 1e-5),
    "motion sampler should keep accumulating across wrapped intervals"
  );
  const motionAccumulator = new MotionAccumulator();
  motionAccumulator.accumulateDelta({
    translation: [2, 0, 0],
    rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4),
    scale: [1, 1, 1]
  });
  motionAccumulator.accumulateDelta({
    translation: [3, 0, 0],
    rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4),
    scale: [1, 1, 1]
  });
  assert.ok(
    vectorNearlyEqual(motionAccumulator.current.translation, [5, 0, 0], 1e-6),
    "motion accumulator should compose translation deltas"
  );
  assert.ok(
    quaternionNearlyEqual(motionAccumulator.current.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
    "motion accumulator should compose rotation deltas"
  );
  const blendedMotion = blendMotionDeltas([
    { weight: 3, delta: { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: 1, delta: { translation: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: -5, delta: { translation: [100, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }
  ]);
  assert.ok(
    vectorNearlyEqual(blendedMotion.translation, [8, 0, 0], 1e-6),
    "motion delta blending should normalize positive weights and ignore negative weights"
  );
  const blendedOpposingMotion = blendMotionDeltas([
    { weight: 3, delta: { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: 1, delta: { translation: [-5, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }
  ]);
  assert.ok(
    vectorNearlyEqual(blendedOpposingMotion.translation, [8.75, 0, 0], 1e-6),
    "motion delta blending should preserve Ozz blended translation length for opposing directions with unequal weights"
  );
  const blendedOrthogonalMotion = blendMotionDeltas([
    { weight: 1, delta: { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: 1, delta: { translation: [0, 0, 10], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }
  ]);
  assert.ok(
    vectorNearlyEqual(blendedOrthogonalMotion.translation, [Math.SQRT1_2 * 10, 0, Math.SQRT1_2 * 10], 1e-6),
    "motion delta blending should restore Ozz blended translation length for orthogonal directions"
  );
  const blendedScaledMotion = blendMotionDeltas([
    { weight: 1, delta: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 3, -4] } },
    { weight: 3, delta: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [4, 7, 8] } }
  ]);
  assert.ok(
    vectorNearlyEqual(blendedScaledMotion.scale, [3.5, 6, 5], 1e-6),
    "motion delta blending should preserve weighted scale deltas"
  );
  assert.deepEqual(
    computeLocomotionBlendWeights(0.25, 3),
    [0.5, 0.5, 0],
    "locomotion blend weights should follow the Ozz walk/jog/run triangular profile"
  );
  assert.deepEqual(
    computeLocomotionBlendWeights(Number.NaN, 3),
    [1, 0, 0],
    "non-finite blend ratios should fall back to the first locomotion layer"
  );
  const synchronizedLocomotion = synchronizeLocomotionPlayback(
    [
      { id: "walk", duration: 1 },
      { id: "jog", duration: 0.5 },
      { id: "run", duration: 0.25 }
    ],
    { blendRatio: 0.25, phase: 0.5 }
  );
  assert.ok(
    Math.abs(synchronizedLocomotion.synchronizedDuration - 0.75) < 1e-6,
    "locomotion speed sync should use weighted clip durations as the shared cycle"
  );
  assert.equal(
    synchronizedLocomotion.activeWeight,
    1,
    "locomotion speed sync should accumulate each active blend weight once"
  );
  assert.deepEqual(
    synchronizedLocomotion.layers.map((layer) => layer.weight),
    [0.5, 0.5, 0],
    "locomotion speed sync should expose deterministic derived weights"
  );
  assert.ok(
    Math.abs(synchronizedLocomotion.layers[0]!.playbackSpeed - 4 / 3) < 1e-6,
    "walk playback should speed up to the synchronized cycle"
  );
  assert.ok(
    Math.abs(synchronizedLocomotion.layers[1]!.playbackSpeed - 2 / 3) < 1e-6,
    "jog playback should slow relative to walk when its authored duration is shorter"
  );
  assert.ok(
    Math.abs(synchronizedLocomotion.layers[0]!.time - 0.5) < 1e-6 &&
      Math.abs(synchronizedLocomotion.layers[1]!.time - 0.25) < 1e-6,
    "synchronized locomotion should report per-clip local times at the shared phase"
  );
  const equallyWeightedLocomotion = synchronizeLocomotionPlayback([
    { id: "walk", duration: 2, weight: 1 },
    { id: "run", duration: 4, weight: 1 }
  ]);
  assert.equal(
    equallyWeightedLocomotion.activeWeight,
    2,
    "two active locomotion layers should contribute two units of active weight"
  );
  assert.ok(
    Math.abs(equallyWeightedLocomotion.synchronizedDuration - 3) < 1e-6,
    "two equally weighted locomotion layers should synchronize to their average duration"
  );
  assert.deepEqual(
    equallyWeightedLocomotion.layers.map((layer) => layer.normalizedWeight),
    [0.5, 0.5],
    "locomotion output normalized weights should remain based on total layer weight"
  );
  const hugeWeightedLocomotion = synchronizeLocomotionPlayback([
    { id: "huge-walk", duration: 2, weight: Number.MAX_VALUE },
    { id: "huge-run", duration: 4, weight: Number.MAX_VALUE }
  ]);
  assert.equal(
    hugeWeightedLocomotion.totalWeight,
    Number.MAX_VALUE,
    "huge locomotion weights should saturate exposed totals instead of overflowing"
  );
  assert.ok(
    Math.abs(hugeWeightedLocomotion.synchronizedDuration - 3) < 1e-6,
    "huge locomotion weights should still produce a finite weighted synchronized duration"
  );
  assert.deepEqual(
    hugeWeightedLocomotion.layers.map((layer) => layer.normalizedWeight),
    [0.5, 0.5],
    "huge locomotion weights should keep normalized layer weights finite"
  );
  const zeroLocomotionSync = synchronizeLocomotionPlayback([
    { id: "zero-duration", duration: 0, weight: 1 },
    { id: "zero-weight", duration: 1, weight: 0 }
  ]);
  assert.equal(zeroLocomotionSync.activeWeight, 0, "inactive locomotion layers should not contribute active weight");
  assert.equal(
    zeroLocomotionSync.synchronizedDuration,
    0,
    "zero-duration and zero-weight locomotion sets should not invent a synchronized cycle"
  );
  assert.deepEqual(
    zeroLocomotionSync.layers.map((layer) => [layer.id, layer.playbackSpeed, layer.active]),
    [
      ["zero-duration", 0, false],
      ["zero-weight", 0, false]
    ],
    "locomotion speed sync should keep zero-duration/zero-weight layers deterministic"
  );

  const rawMotionSource = createRawAnimation({
    id: "raw-motion-source",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 0.5, value: [6, 1, 0] },
          { time: 1, value: [10, 2, 4] }
        ],
        rotations: [
          { time: 0, value: quatFromAxisAngle([0, 1, 0], 0) },
          { time: 0.5, value: quatFromAxisAngle([0, 1, 0], Math.PI) },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 2) }
        ]
      },
      {
        joint: "spine",
        translations: [{ time: 0, value: [0, 0.25, 0] }]
      }
    ]
  });
  const rawMotionSnapshot = JSON.stringify(rawMotionSource);
  const rawMotionExtraction = extractRawRootMotion(motionSkeleton, rawMotionSource, {
    reference: "absolute",
    translation: { axes: { x: true, y: false, z: true }, bake: true, loop: true },
    rotation: { mode: "yaw", bake: true, loop: true },
    rawAnimationId: "raw-motion-in-place"
  });
  assert.equal(rawMotionExtraction.rawAnimation.id, "raw-motion-in-place");
  assert.equal(
    JSON.stringify(rawMotionSource),
    rawMotionSnapshot,
    "raw motion extraction should not mutate editable raw animation input"
  );
  assert.ok(
    vectorNearlyEqual(
      sampleMotionTracks(rawMotionExtraction.motion, 0).transform.translation,
      sampleMotionTracks(rawMotionExtraction.motion, 1).transform.translation,
      1e-6
    ),
    "raw motion loop distribution should make extracted translation endpoints match"
  );
  assert.ok(
    quaternionNearlyEqual(
      sampleMotionTracks(rawMotionExtraction.motion, 0).transform.rotation,
      sampleMotionTracks(rawMotionExtraction.motion, 1).transform.rotation,
      1e-5
    ),
    "raw motion loop distribution should make extracted rotation endpoints match"
  );
  assert.ok(
    vectorNearlyEqual(sampleMotionTracks(rawMotionExtraction.motion, 0.5).transform.translation, [1, 0, -2], 1e-5),
    "raw motion loop distribution should spread endpoint translation error across channel keys"
  );
  assert.ok(
    quaternionNearlyEqual(
      sampleMotionTracks(rawMotionExtraction.motion, 0.5).transform.rotation,
      quatFromAxisAngle([0, 1, 0], Math.PI),
      1e-5
    ),
    "raw motion extraction should preserve the middle yaw channel while loopifying endpoints"
  );
  const unevenLoopDistributionClip: AnimationClip = {
    id: "uneven-loop-distribution",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 0.1, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0, 10, 0, 0])
      }
    ]
  };
  const unevenClipLoopDistribution = extractRootMotion(motionSkeleton, unevenLoopDistributionClip, {
    reference: "absolute",
    translation: { loop: true },
    rotation: false
  });
  assert.ok(
    vectorNearlyEqual(
      sampleMotionTracks(unevenClipLoopDistribution.motion, 0.1).transform.translation,
      [0, 0, 0],
      1e-6
    ),
    "clip root-motion loop distribution should spread endpoint drift by key time instead of key ordinal"
  );
  const loopedRotationBakeClip: AnimationClip = {
    id: "looped-rotation-bake-order",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 0.5, 1]),
        values: sanitizeQuaternionTrackValues([
          0,
          0,
          0,
          1,
          ...quatFromAxisAngle([0, 1, 0], Math.PI / 2),
          ...quatFromAxisAngle([0, 1, 0], Math.PI)
        ])
      }
    ]
  };
  const loopedRotationBake = extractRootMotion(motionSkeleton, loopedRotationBakeClip, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true, loop: true }
  });
  assert.ok(loopedRotationBake.bakedClip, "looped clip root-motion rotation baking should still return a baked clip");
  assert.ok(
    quaternionNearlyEqual(
      sampleClipToPose(motionSkeleton, loopedRotationBake.bakedClip, 0.5, { loop: false })[0]!.rotation,
      [0, 0, 0, 1],
      1e-5
    ),
    "clip root-motion baking should strip the original carrier rotation before loopifying the exported motion track"
  );
  assert.ok(
    quaternionNearlyEqual(sampleMotionTracks(loopedRotationBake.motion, 0.5).transform.rotation, [0, 0, 0, 1], 1e-5),
    "clip root-motion loop distribution should still loopify the returned motion rotation track"
  );
  const unevenRawLoopDistribution = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-uneven-loop-distribution",
      duration: 1,
      tracks: [
        {
          joint: "root",
          translations: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.1, value: [1, 0, 0] },
            { time: 1, value: [10, 0, 0] }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: { loop: true },
      rotation: false
    }
  );
  assert.ok(
    vectorNearlyEqual(sampleMotionTracks(unevenRawLoopDistribution.motion, 0.1).transform.translation, [0, 0, 0], 1e-6),
    "raw root-motion loop distribution should spread endpoint drift by key time instead of key ordinal"
  );

  const residualBakeSource = createRawAnimation({
    id: "raw-residual-trajectory-bake",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 1, 0] },
          { time: 0.25, value: [0.08, 1.05, 2.5] },
          { time: 0.5, value: [0, 0.98, 5] },
          { time: 0.75, value: [-0.08, 1.04, 7.5] },
          { time: 1, value: [0, 1.01, 10] }
        ]
      }
    ]
  });
  const residualBake = extractRawRootMotion(motionSkeleton, residualBakeSource, {
    reference: "absolute",
    translation: {
      axes: { x: false, y: false, z: true },
      bake: true,
      bakeMode: "remove-linear-trajectory",
      loop: true
    },
    rotation: false
  });
  const bakedTranslations = residualBake.rawAnimation.tracks[0]!.translations.map((key) => key.value);
  assert.ok(
    vectorNearlyEqual(bakedTranslations[0]!, [0, 1, 0], 1e-6) &&
      vectorNearlyEqual(bakedTranslations[2]!, [0, 0.98, 0], 1e-6) &&
      vectorNearlyEqual(bakedTranslations[4]!, [0, 1.01, 0], 1e-6),
    "linear trajectory baking should remove cumulative selected-axis path travel without flattening authored vertical values"
  );
  assert.ok(
    vectorNearlyEqual(bakedTranslations[1]!, [0.08, 1.05, 0], 1e-6) &&
      vectorNearlyEqual(bakedTranslations[3]!, [-0.08, 1.04, 0], 1e-6),
    "linear trajectory baking should preserve unselected lateral pelvis sway while removing selected forward travel"
  );
  assert.ok(
    vectorNearlyEqual(sampleMotionTracks(residualBake.motion, 0.25).transform.translation, [0, 0, 0], 1e-6),
    "loop-normalized extracted trajectory should not include cyclic lateral/vertical residual COM motion"
  );
  const rawFullRotationLoopDistribution = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-full-rotation-loop-distribution",
      duration: 1,
      tracks: [
        {
          joint: "root",
          rotations: [
            { time: 0, value: [0, 0, 0, 1] },
            { time: 0.5, value: [0, 0, 0, 1] },
            { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 1.5) }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: false,
      rotation: { mode: "full", loop: true }
    }
  );
  assert.ok(
    quaternionNearlyEqual(
      sampleMotionTracks(rawFullRotationLoopDistribution.motion, 0.5).transform.rotation,
      quatFromAxisAngle([0, 1, 0], Math.PI / 4),
      1e-5
    ),
    "raw full-rotation loop distribution should use the shortest quaternion hemisphere"
  );
  const rawLoopedRotationBakeCompensation = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-looped-rotation-bake-compensation",
      duration: 1,
      tracks: [
        {
          joint: "root",
          translations: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.5, value: [0, 0, 1] },
            { time: 1, value: [0, 0, 1] }
          ],
          rotations: [
            { time: 0, value: [0, 0, 0, 1] },
            { time: 0.5, value: [0, 0, 0, 1] },
            { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 1.5) }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: false,
      rotation: { mode: "full", bake: true, loop: true }
    }
  );
  assert.ok(
    vectorNearlyEqual(
      rawLoopedRotationBakeCompensation.rawAnimation.tracks[0]!.translations[1]!.value,
      [0, 0, 1],
      1e-6
    ),
    "raw rotation baking should compensate translations with authored motion before loop distribution changes the exported motion track"
  );
  assert.deepEqual(
    rawMotionExtraction.rawAnimation.tracks[0]!.translations.map((key) => key.value),
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0]
    ],
    "raw motion baking should remove selected carrier translation axes and preserve unselected local motion"
  );
  assert.ok(
    quaternionNearlyEqual(rawMotionExtraction.rawAnimation.tracks[0]!.rotations[1]!.value, [0, 0, 0, 1], 1e-5),
    "raw motion baking should remove extracted yaw from the raw carrier rotation channel"
  );
  const rawClassExtraction = new MotionExtractor().extractRaw(motionSkeleton, rawMotionSource, {
    translation: false,
    rotation: false
  });
  assert.equal(
    rawClassExtraction.motion.position,
    undefined,
    "MotionExtractor class should expose raw extraction without forcing position tracks"
  );
  assert.equal(
    rawClassExtraction.motion.rotation,
    undefined,
    "MotionExtractor class should expose raw extraction without forcing rotation tracks"
  );
  const preservedExtractionInspection = inspectClipAsset(
    {
      id: "preserved-extracted-root-motion",
      label: "Preserved Extracted Root Motion",
      url: "/preserved-extracted-root-motion.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    extractionClip
  );
  assert.equal(
    preservedExtractionInspection.accepted,
    true,
    "root-motion extraction should not disturb preserved-policy source clips"
  );
  const strippedExtraction = extractRootMotion(motionSkeleton, extractionClip, {
    reference: "absolute",
    translation: true,
    rotation: false,
    bake: true
  });
  const strippedExtractionInspection = inspectClipAsset(
    {
      id: "stripped-extracted-root-motion",
      label: "Stripped Extracted Root Motion",
      url: "/stripped-extracted-root-motion.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    strippedExtraction.bakedClip!
  );
  assert.equal(
    strippedExtractionInspection.accepted,
    true,
    "baked all-axis root motion should satisfy stripped-to-in-place policy validation"
  );
}

export async function runMotionRuntimeRootMotionTests(): Promise<void> {
  const { motionSkeleton, motionClip } = createRootMotionTestFixture();
  const runtimeRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeRootMotion.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true });
  const runtimeRootMotionUpdate = runtimeRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    runtimeRootMotionUpdate.rootMotionDelta.translation,
    [5, 0, 0],
    "runtime root motion should collect root carrier interval translation"
  );
  assert.ok(
    quaternionNearlyEqual(
      runtimeRootMotionUpdate.rootMotionDelta.rotation,
      quatFromAxisAngle([0, 1, 0], Math.PI / 2),
      1e-5
    ),
    "runtime root motion should collect root carrier interval rotation"
  );
  assert.equal(runtimeRootMotionUpdate.rootMotionLayers[0]?.carrier.joint, "root");
  assert.equal(
    runtimeRootMotion.evaluate().localPose[0]!.translation[0],
    5,
    "root-motion collection should not strip or separately apply pose motion"
  );

  const runtimeLoopingTime = new AnimationRuntime(motionSkeleton);
  runtimeLoopingTime.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.75 });
  const runtimeLoopingTimeUpdate = runtimeLoopingTime.update(2.5, { collectRootMotion: true });
  assert.equal(
    runtimeLoopingTime.evaluate().activeLayers[0]?.time,
    0.25,
    "looping runtime layers should store wrapped clip time after update"
  );
  assert.equal(
    runtimeLoopingTimeUpdate.rootMotionLayers[0]?.fromTime,
    0.75,
    "root-motion diagnostics should keep the unwrapped interval start"
  );
  assert.equal(
    runtimeLoopingTimeUpdate.rootMotionLayers[0]?.toTime,
    3.25,
    "root-motion diagnostics should keep the unwrapped interval end"
  );
  assert.deepEqual(
    runtimeLoopingTimeUpdate.rootMotionDelta.translation,
    [25, 0, 0],
    "multi-loop runtime root motion should accumulate the full update span"
  );

  const runtimeLoopBoundary = new AnimationRuntime(motionSkeleton);
  runtimeLoopBoundary.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.5 });
  runtimeLoopBoundary.update(0.5);
  assert.equal(
    runtimeLoopBoundary.evaluate().activeLayers[0]?.time,
    0,
    "looping runtime layers should wrap exact duration endpoints to zero"
  );

  const runtimeNonLoopingTime = new AnimationRuntime(motionSkeleton);
  runtimeNonLoopingTime.setLayer("move-once", motionClip, { weight: 1, targetWeight: 1, loop: false, time: 0.75 });
  runtimeNonLoopingTime.update(2.5);
  assert.equal(
    runtimeNonLoopingTime.evaluate().activeLayers[0]?.time,
    1,
    "non-looping runtime layers should clamp to finite clip duration"
  );

  const runtimeZeroDurationClip: AnimationClip = { id: "runtime-zero-duration", duration: 0, loop: true, tracks: [] };
  const runtimeNonFiniteDurationClip: AnimationClip = {
    id: "runtime-non-finite-duration",
    duration: Number.NaN,
    loop: true,
    tracks: []
  };
  const runtimeInvalidDurationTime = new AnimationRuntime(motionSkeleton);
  runtimeInvalidDurationTime.setLayer("zero", runtimeZeroDurationClip, {
    weight: 1,
    targetWeight: 1,
    loop: true,
    time: 0.25
  });
  runtimeInvalidDurationTime.setLayer("nan", runtimeNonFiniteDurationClip, {
    weight: 1,
    targetWeight: 1,
    loop: true,
    time: 0.25
  });
  runtimeInvalidDurationTime.update(0.5);
  assert.deepEqual(
    runtimeInvalidDurationTime.evaluate().activeLayers.map((layer) => [layer.id, layer.time]),
    [
      ["nan", 0.75],
      ["zero", 0.75]
    ],
    "invalid-duration runtime layers should keep finite advanced times instead of wrapping through invalid durations"
  );
  const runtimeInvalidDurationRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeInvalidDurationRootMotion.setLayer("zero", runtimeZeroDurationClip, {
    weight: 1,
    targetWeight: 1,
    loop: true
  });
  const invalidDurationRootMotionUpdate = runtimeInvalidDurationRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    invalidDurationRootMotionUpdate.rootMotionDelta,
    identityTransform(),
    "invalid-duration runtime layers should not invent root-motion deltas"
  );
  assert.equal(
    invalidDurationRootMotionUpdate.rootMotionLayers.length,
    0,
    "invalid-duration runtime layers should not emit root-motion diagnostics"
  );

  const runtimeMalformedLayerState = new AnimationRuntime(motionSkeleton);
  const malformedLayer = runtimeMalformedLayerState.setLayer("malformed", motionClip, {
    weight: 1,
    targetWeight: 1,
    time: 0.75
  });
  (malformedLayer as unknown as { blendMode: string; loop: unknown }).blendMode = "legacy-override";
  (malformedLayer as unknown as { blendMode: string; loop: unknown }).loop = "yes";
  const malformedLayerUpdate = runtimeMalformedLayerState.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    malformedLayerUpdate.rootMotionDelta.translation,
    [5, 0, 0],
    "runtime update should recover malformed blend/loop state before root-motion collection"
  );
  assert.deepEqual(
    runtimeMalformedLayerState.evaluate().activeLayers.map((layer) => [layer.id, layer.time, layer.blendMode]),
    [["malformed", 0.25, "override"]],
    "runtime evaluation should expose sanitized scheduling state after malformed layer recovery"
  );

  const runtimeOverflowStep = new AnimationRuntime(motionSkeleton);
  runtimeOverflowStep.setLayer("overflow", motionClip, {
    weight: 1,
    targetWeight: 1,
    loop: true,
    time: 0.25,
    speed: Number.MAX_VALUE
  });
  const overflowStepUpdate = runtimeOverflowStep.update(Number.MAX_VALUE, { collectRootMotion: true });
  assert.equal(
    runtimeOverflowStep.evaluate().activeLayers[0]?.time,
    0.25,
    "overflowing runtime time steps should hold the previous finite clock"
  );
  assert.equal(
    overflowStepUpdate.rootMotionLayers.length,
    0,
    "overflowing runtime time steps should not emit unsafe root-motion intervals"
  );

  const runtimeHumanoidRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeHumanoidRootMotion.setLayer("hips-move", motionClip, {
    weight: 1,
    targetWeight: 1,
    motionCarrier: { humanBone: "hips" }
  });
  const runtimeHumanoidMotionUpdate = runtimeHumanoidRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    runtimeHumanoidMotionUpdate.rootMotionDelta.translation,
    [0, 0, 3],
    "runtime root motion should support explicit humanoid carriers"
  );
  assert.equal(runtimeHumanoidMotionUpdate.rootMotionLayers[0]?.carrier.joint, "hips");

  const runtimeCarrierReplacement = new AnimationRuntime(motionSkeleton);
  runtimeCarrierReplacement.setLayer("move", motionClip, {
    weight: 1,
    targetWeight: 1,
    motionCarrier: { humanBone: "hips" }
  });
  runtimeCarrierReplacement.crossfade(
    "move",
    {
      id: "replacement-root-carrier",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 10, 0, 0])
        }
      ]
    },
    { weight: 1, targetWeight: 1, resetTime: true }
  );
  const carrierReplacementUpdate = runtimeCarrierReplacement.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    carrierReplacementUpdate.rootMotionDelta.translation,
    [5, 0, 0],
    "crossfading a layer to a different clip should not inherit stale explicit motion-carrier metadata"
  );
  assert.equal(carrierReplacementUpdate.rootMotionLayers[0]?.carrier.joint, "root");

  const sourceBasisClipA: AnimationClip = {
    id: "source-basis-a",
    duration: 1,
    tracks: [
      {
        humanBone: "hips",
        property: "rotation",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0]),
        values: sanitizeQuaternionTrackValues([...quatFromAxisAngle([1, 0, 0], Math.PI / 2)])
      }
    ]
  };
  const sourceBasisClipB: AnimationClip = { ...sourceBasisClipA, id: "source-basis-b" };
  const runtimeSourceBasisReplacement = new AnimationRuntime(motionSkeleton);
  runtimeSourceBasisReplacement.setLayer("pose", sourceBasisClipA, {
    weight: 1,
    targetWeight: 1,
    sourceBasisQuaternion: () => quatFromAxisAngle([0, 1, 0], Math.PI / 2)
  });
  runtimeSourceBasisReplacement.crossfade("pose", sourceBasisClipB, { weight: 1, targetWeight: 1, resetTime: true });
  assert.ok(
    quaternionNearlyEqual(
      runtimeSourceBasisReplacement.evaluate().localPose[1]!.rotation,
      quatFromAxisAngle([1, 0, 0], Math.PI / 2),
      1e-6
    ),
    "crossfading a layer to a different clip should not inherit stale source-basis retarget metadata"
  );

  const runtimeInvalidRootMotion = new AnimationRuntime(motionSkeleton);
  const runtimeInvalidLayer = runtimeInvalidRootMotion.setLayer("invalid", motionClip, {
    weight: 1,
    targetWeight: 1,
    loop: true
  });
  runtimeInvalidLayer.time = Number.POSITIVE_INFINITY;
  runtimeInvalidLayer.speed = Number.POSITIVE_INFINITY;
  const invalidRootMotionUpdate = runtimeInvalidRootMotion.update(Number.NaN, { collectRootMotion: true });
  assert.deepEqual(
    invalidRootMotionUpdate.rootMotionDelta,
    identityTransform(),
    "non-finite root-motion update input should produce identity motion"
  );
  assert.equal(
    invalidRootMotionUpdate.rootMotionLayers.length,
    0,
    "non-finite root-motion update input should not emit unsafe layer deltas"
  );

  const runtimeZeroWeightRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeZeroWeightRootMotion.setLayer("zero", motionClip, { weight: 0, targetWeight: 0, loop: true });
  const zeroWeightRootMotionUpdate = runtimeZeroWeightRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    zeroWeightRootMotionUpdate.rootMotionDelta,
    identityTransform(),
    "zero-weight root-motion layers should produce identity motion"
  );
  assert.equal(
    zeroWeightRootMotionUpdate.rootMotionLayers.length,
    0,
    "zero-weight root-motion layers should not emit diagnostics"
  );

  const maskedMotionPoseClip: AnimationClip = {
    id: "masked-motion-pose",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      },
      {
        joint: "spine",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0.5, 0])
      }
    ]
  };
  const runtimeMaskedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeMaskedRootMotion.setLayer("upper-body", maskedMotionPoseClip, {
    weight: 1,
    targetWeight: 1,
    mask: createJointMask(motionSkeleton, 0, { spine: 1 })
  });
  const maskedRootMotionUpdate = runtimeMaskedRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    maskedRootMotionUpdate.rootMotionDelta,
    identityTransform(),
    "masked-out root carrier should not contribute root motion"
  );
  assert.equal(
    maskedRootMotionUpdate.rootMotionLayers.length,
    0,
    "masked-out root carrier should not emit root-motion diagnostics"
  );
  assert.deepEqual(
    runtimeMaskedRootMotion.evaluate().localPose[2]!.translation,
    [0, 0.25, 0],
    "root-motion masking should still allow the layer to own unmasked pose joints"
  );

  const weightedMotionA: AnimationClip = {
    id: "weighted-motion-a",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      }
    ]
  };
  const weightedMotionB: AnimationClip = {
    id: "weighted-motion-b",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 2, 0, 0])
      }
    ]
  };
  const runtimeWeightedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeWeightedRootMotion.setLayer("motion-a", weightedMotionA, { weight: 3, targetWeight: 3, priority: 2 });
  runtimeWeightedRootMotion.setLayer("motion-b", weightedMotionB, { weight: 1, targetWeight: 1, priority: 2 });
  const weightedRootMotionUpdate = runtimeWeightedRootMotion.update(0.5, { collectRootMotion: true });
  assert.ok(
    Math.abs(weightedRootMotionUpdate.rootMotionDelta.translation[0] - 4) < 1e-6,
    "same-priority root motion should normalize positive override weights"
  );
  assert.ok(
    weightedRootMotionUpdate.rootMotionDelta.translation.every(Number.isFinite),
    "weighted root motion should stay finite"
  );
  assert.deepEqual(
    weightedRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
    [
      ["motion-a", 0.75],
      ["motion-b", 0.25]
    ],
    "weighted root-motion diagnostics should be deterministic"
  );
  const scaledMotionA: AnimationClip = {
    id: "scaled-motion-a",
    duration: 1,
    tracks: [
      { joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 1, 1, 2, 3, 4]) }
    ]
  };
  const scaledMotionB: AnimationClip = {
    id: "scaled-motion-b",
    duration: 1,
    tracks: [
      { joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 1, 1, 4, 7, 8]) }
    ]
  };
  const runtimeScaledRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeScaledRootMotion.setLayer("scaled-a", scaledMotionA, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeScaledRootMotion.setLayer("scaled-b", scaledMotionB, { weight: 3, targetWeight: 3, priority: 2 });
  const scaledRootMotionUpdate = runtimeScaledRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(scaledRootMotionUpdate.rootMotionDelta.scale, [3.5, 6, 7], 1e-6),
    "runtime root-motion blending should preserve weighted carrier scale deltas"
  );

  const runtimeSteadyIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeSteadyIntervalRootMotion.setLayer("steady", weightedMotionA, { weight: 0.5, targetWeight: 0.5, fadeSpeed: 8 });
  const steadyIntervalRootMotionUpdate = runtimeSteadyIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(steadyIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 5) < 1e-6,
    "steady root-motion weights should preserve the existing threshold-scaled behavior"
  );
  assert.deepEqual(
    steadyIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["steady", 0.5, 1]],
    "steady root-motion diagnostics should report the unchanged effective weight"
  );

  const runtimeFadeInIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeFadeInIntervalRootMotion.setLayer("fade-in", weightedMotionA, {
    weight: 0,
    targetWeight: 1,
    fadeSpeed: Math.log(4)
  });
  const fadeInIntervalRootMotionUpdate = runtimeFadeInIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fadeInIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 3.75) < 1e-6,
    "fade-in root motion should use interval-average weight instead of applying the endpoint weight to the whole interval"
  );
  assert.deepEqual(
    fadeInIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["fade-in", 0.375, 1]],
    "fade-in root-motion diagnostics should expose the interval effective weight"
  );

  const runtimeFadeOutIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeFadeOutIntervalRootMotion.setLayer("fade-out", weightedMotionA, {
    weight: 1,
    targetWeight: 0,
    fadeSpeed: Math.log(4)
  });
  const fadeOutIntervalRootMotionUpdate = runtimeFadeOutIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fadeOutIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 6.25) < 1e-6,
    "fade-out root motion should use interval-average weight symmetrically"
  );
  assert.deepEqual(
    fadeOutIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["fade-out", 0.625, 1]],
    "fade-out root-motion diagnostics should expose the interval effective weight"
  );

  const runtimeFractionalMaskedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeFractionalMaskedRootMotion.setLayer("masked-motion-a", weightedMotionA, {
    weight: 1,
    targetWeight: 1,
    priority: 2,
    mask: createJointMask(motionSkeleton, 0, { root: 0.5 })
  });
  runtimeFractionalMaskedRootMotion.setLayer("motion-b", weightedMotionB, { weight: 1, targetWeight: 1, priority: 2 });
  const fractionalMaskedRootMotionUpdate = runtimeFractionalMaskedRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fractionalMaskedRootMotionUpdate.rootMotionDelta.translation[0] - 14 / 3) < 1e-6,
    "fractional carrier mask weight should attenuate root-motion blend weight"
  );
  assert.deepEqual(
    fractionalMaskedRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [
      ["masked-motion-a", 0.5, 1 / 3],
      ["motion-b", 1, 2 / 3]
    ],
    "fractional carrier masks should be reflected in root-motion diagnostics"
  );

  const runtimeHugeRootMotionWeights = new AnimationRuntime(motionSkeleton);
  const hugeMask = createJointMask(motionSkeleton, 0, { root: 3e38 });
  runtimeHugeRootMotionWeights.setLayer("huge-a", weightedMotionA, {
    weight: Number.MAX_VALUE,
    targetWeight: Number.MAX_VALUE,
    priority: 2
  });
  runtimeHugeRootMotionWeights.setLayer("huge-b", weightedMotionB, {
    weight: Number.MAX_VALUE,
    targetWeight: Number.MAX_VALUE,
    priority: 2,
    mask: hugeMask
  });
  const hugeRootMotionWeightsUpdate = runtimeHugeRootMotionWeights.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(hugeRootMotionWeightsUpdate.rootMotionDelta.translation, [6, 0, 0], 1e-6),
    "huge finite root-motion weights should normalize without overflowing the blended delta"
  );
  assert.ok(
    hugeRootMotionWeightsUpdate.rootMotionLayers.every((layer) => Number.isFinite(layer.normalizedWeight)),
    "huge finite root-motion weights should keep diagnostics normalized and finite"
  );

  const runtimeMaskedFadeIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeMaskedFadeIntervalRootMotion.setLayer("masked-fade-in", weightedMotionA, {
    weight: 0,
    targetWeight: 1,
    fadeSpeed: Math.log(4),
    mask: createJointMask(motionSkeleton, 0, { root: 0.5 })
  });
  const maskedFadeIntervalRootMotionUpdate = runtimeMaskedFadeIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(maskedFadeIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 1.875) < 1e-6,
    "masked fade-in root motion should average the masked effective weights across the traversed interval"
  );
  assert.deepEqual(
    maskedFadeIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [
      layer.id,
      layer.weight,
      layer.normalizedWeight
    ]),
    [["masked-fade-in", 0.1875, 1]],
    "masked fade-in root-motion diagnostics should report the interval masked effective weight"
  );

  const weakPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
  weakPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
  weakPriorityRootMotion.setLayer("weak-override-motion", weightedMotionB, {
    weight: 0.05,
    targetWeight: 0.05,
    priority: 1
  });
  const weakPriorityRootMotionUpdate = weakPriorityRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(weakPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 6) < 1e-6,
    "under-threshold higher-priority root motion should partially blend with lower-priority fallback motion"
  );
  assert.deepEqual(
    weakPriorityRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
    [
      ["base-motion", 1],
      ["weak-override-motion", 1]
    ],
    "priority fallback root-motion diagnostics should preserve per-group normalized weights"
  );

  const thresholdPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
  thresholdPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
  thresholdPriorityRootMotion.setLayer("threshold-override-motion", weightedMotionB, {
    weight: 0.1,
    targetWeight: 0.1,
    priority: 1
  });
  const thresholdPriorityRootMotionUpdate = thresholdPriorityRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(thresholdPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 2) < 1e-6,
    "at-threshold higher-priority root motion should fully replace lower-priority fallback motion"
  );

  const oppositeMotionA: AnimationClip = {
    id: "opposite-motion-a",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      }
    ]
  };
  const oppositeMotionB: AnimationClip = {
    id: "opposite-motion-b",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, -10, 0, 0])
      }
    ]
  };
  const runtimeOppositeRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeOppositeRootMotion.setLayer("opposite-a", oppositeMotionA, { weight: 1, targetWeight: 1, priority: 3 });
  runtimeOppositeRootMotion.setLayer("opposite-b", oppositeMotionB, { weight: 1, targetWeight: 1, priority: 3 });
  const oppositeRootMotionUpdate = runtimeOppositeRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    oppositeRootMotionUpdate.rootMotionDelta.translation,
    [0, 0, 0],
    "opposite equal root-motion directions should cancel instead of sequentially accumulating length"
  );
  assert.deepEqual(
    oppositeRootMotionUpdate.rootMotionDelta.scale,
    [1, 1, 1],
    "blended root-motion deltas should keep identity scale"
  );

  const orthogonalMotionA: AnimationClip = {
    id: "orthogonal-motion-a",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      }
    ]
  };
  const orthogonalMotionB: AnimationClip = {
    id: "orthogonal-motion-b",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 10])
      }
    ]
  };
  const runtimeOrthogonalRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeOrthogonalRootMotion.setLayer("orthogonal-a", orthogonalMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeOrthogonalRootMotion.setLayer("orthogonal-b", orthogonalMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  const orthogonalRootMotionUpdate = runtimeOrthogonalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(orthogonalRootMotionUpdate.rootMotionDelta.translation, [5, 0, 5], 1e-6),
    "orthogonal equal root-motion deltas should use Ozz component weighted-average translation"
  );

  const rotationOrderMotionA: AnimationClip = {
    id: "rotation-order-motion-a",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 10])
      },
      {
        joint: "root",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  const rotationOrderMotionB: AnimationClip = {
    id: "rotation-order-motion-b",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      },
      {
        joint: "root",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 2)])
      }
    ]
  };
  const runtimeRootMotionOrderA = new AnimationRuntime(motionSkeleton);
  runtimeRootMotionOrderA.setLayer("first", rotationOrderMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeRootMotionOrderA.setLayer("second", rotationOrderMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  const rootMotionOrderUpdateA = runtimeRootMotionOrderA.update(0.5, { collectRootMotion: true });
  const runtimeRootMotionOrderB = new AnimationRuntime(motionSkeleton);
  runtimeRootMotionOrderB.setLayer("z-second", rotationOrderMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeRootMotionOrderB.setLayer("a-first", rotationOrderMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  const rootMotionOrderUpdateB = runtimeRootMotionOrderB.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    rootMotionOrderUpdateA.rootMotionDelta.translation,
    rootMotionOrderUpdateB.rootMotionDelta.translation,
    "same-priority root-motion translation should be independent of layer id/order"
  );
  assert.ok(
    quaternionNearlyEqual(
      rootMotionOrderUpdateA.rootMotionDelta.rotation,
      rootMotionOrderUpdateB.rootMotionDelta.rotation,
      1e-6
    ),
    "same-priority root-motion rotation should be independent of layer id/order"
  );

  const runtimeAdditiveRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeAdditiveRootMotion.setLayer("base", weightedMotionB, { weight: 1, targetWeight: 1 });
  runtimeAdditiveRootMotion.setLayer("additive-motion", weightedMotionA, {
    weight: 1,
    targetWeight: 1,
    blendMode: "additive"
  });
  const additiveRootMotionUpdate = runtimeAdditiveRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(
    additiveRootMotionUpdate.rootMotionDelta.translation,
    [1, 0, 0],
    "additive layers should not contribute to runtime root motion"
  );
  assert.deepEqual(
    additiveRootMotionUpdate.rootMotionLayers.map((layer) => layer.id),
    ["base"]
  );
}
