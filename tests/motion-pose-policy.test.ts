import {
  AUTHORED_BASE_SOURCE_TRACK_POLICY,
  AUTHORED_BASE_TRACK_POLICY,
  AnimationClip,
  AnimationRuntime,
  BASE_PROCEDURAL_SOURCE_TRACK_POLICY,
  BASE_PROCEDURAL_TRACK_POLICY,
  DEFAULT_BLEND_THRESHOLD,
  additiveDeltaPose,
  applyAdditivePose,
  applySourceTrackPolicy,
  assert,
  blendPoses,
  clonePose,
  cloneTransform,
  createJointMask,
  createSkeleton,
  createSubtreeJointMask,
  filterTracksByNamePolicy,
  normalizeQuat,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  validatePose
} from "./test-api.js";
import {
  makeAuthoredLoopClip,
  makeTransformTrack,
  sampleNodPose,
  skeleton
} from "./test-helpers.js";

export async function runMotionPosePolicyTests(): Promise<void> {
  const sampled = sampleNodPose();
  const mask = createJointMask(skeleton, 0, { head: 1 });
  const blended = blendPoses(skeleton, [
    { pose: skeleton.restPose, weight: 1 },
    { pose: sampled, weight: 1, mask }
  ]);
  assert.ok(blended[2]!.rotation[0] > 0.05);
  assert.equal(blended[1]!.rotation[3], 1);

  const ozzStyleMask = createJointMask(skeleton, 1.25, {
    hips: -2,
    head: 2.5,
    leftUpperArm: Number.NaN,
    missingJoint: 7
  });
  assert.equal(ozzStyleMask[0], 0, "createJointMask should clamp negative named entries to zero");
  assert.equal(ozzStyleMask[1], 1.25, "createJointMask should preserve positive default weights above 1");
  assert.equal(ozzStyleMask[2], 2.5, "createJointMask should preserve positive named weights above 1");
  assert.equal(ozzStyleMask[3], 0, "createJointMask should sanitize non-finite named entries to zero");

  const negativeDefaultMask = createJointMask(skeleton, -1, { spine: 0.5 });
  assert.equal(negativeDefaultMask[0], 0, "createJointMask should clamp negative defaults to zero");
  assert.equal(negativeDefaultMask[1], 0.5, "createJointMask should still apply finite entries over negative defaults");

  const nonFiniteDefaultMask = createJointMask(skeleton, Number.POSITIVE_INFINITY, {
    head: Number.NEGATIVE_INFINITY,
    leftUpperArm: 1.5
  });
  assert.deepEqual(
    Array.from(nonFiniteDefaultMask),
    [0, 0, 0, 1.5],
    "createJointMask should sanitize non-finite defaults and entries without clamping positive overweight entries"
  );

  const subtreeMaskSkeleton = createSkeleton([
    { name: "root" },
    { name: "torso", parentName: "root", humanoid: "spine" },
    { name: "head", parentName: "torso", humanoid: "head" },
    { name: "leftArm", parentName: "torso", humanoid: "leftUpperArm" },
    { name: "rightArm", parentName: "torso", humanoid: "rightUpperArm" },
    { name: "prop", parentName: "root" }
  ]);
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "leftArm")),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should select the named root without selecting parents or siblings"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "torso", { defaultWeight: 0.25, weight: 2 })),
    [0.25, 2, 2, 2, 2, 0.25],
    "createSubtreeJointMask should select a named root and all descendants"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "leftUpperArm")),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should resolve humanoid bone roots"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, ["head", "rightUpperArm"])),
    [0, 0, 1, 0, 1, 0],
    "createSubtreeJointMask should compose multiple roots"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, ["missing", "leftArm"], { defaultWeight: Number.NaN, weight: Number.POSITIVE_INFINITY })),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should ignore missing roots and sanitize malformed weights"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "missing", { defaultWeight: -1, weight: -2 })),
    [0, 0, 0, 0, 0, 0],
    "createSubtreeJointMask should return a sanitized default-only mask when no roots resolve"
  );

  const malformedMaskPose = clonePose(skeleton.restPose);
  malformedMaskPose[0]!.translation = [5, 1, 0];
  malformedMaskPose[1]!.translation = [4, 0, 0];
  malformedMaskPose[2]!.translation = [20, 0, 0];
  malformedMaskPose[3]!.translation = [8, 0, 0];
  const armSubtreeBlend = blendPoses(skeleton, [{ pose: malformedMaskPose, weight: 1, mask: createSubtreeJointMask(skeleton, "leftUpperArm") }], { threshold: 0.01 });
  assert.equal(armSubtreeBlend[1]!.translation[0], 0, "subtree masks should leave unselected parents on fallback pose");
  assert.equal(armSubtreeBlend[2]!.translation[0], 0, "subtree masks should leave unselected siblings on fallback pose");
  assert.equal(armSubtreeBlend[3]!.translation[0], 8, "subtree masks should allow selected joints to own the blended pose");
  const malformedPartialMask = new Float32Array([1, Number.NaN]);
  const malformedMaskedBlend = blendPoses(skeleton, [{ pose: malformedMaskPose, weight: 1, mask: malformedPartialMask }], { threshold: 0.01 });
  assert.equal(malformedMaskedBlend[0]!.translation[0], 5, "finite mask entries should still own their joints");
  assert.equal(malformedMaskedBlend[1]!.translation[0], 0, "NaN mask entries should not affect override blending");
  assert.equal(malformedMaskedBlend[2]!.translation[0], 0, "missing mask entries should not affect override blending");
  assert.equal(malformedMaskedBlend[3]!.translation[0], 0, "short partial masks should leave unspecified joints on fallback pose");

  const shortOverridePose = clonePose(skeleton.restPose);
  shortOverridePose[0]!.translation = [6, 0, 0];
  shortOverridePose[1]!.translation = [7, 0, 0];
  shortOverridePose.length = 2;
  const shortOverrideBlend = blendPoses(skeleton, [{ pose: shortOverridePose, weight: 1 }], { threshold: 0.01 });
  assert.equal(shortOverrideBlend[0]!.translation[0], 6, "short override poses should still blend available joints");
  assert.equal(shortOverrideBlend[1]!.translation[0], 7, "short override poses should still blend available child joints");
  assert.deepEqual(shortOverrideBlend[2]!.translation, skeleton.restPose[2]!.translation, "short override poses should fall back missing joints to rest pose");
  assert.deepEqual(shortOverrideBlend[3]!.translation, skeleton.restPose[3]!.translation, "short override poses should keep trailing missing joints on rest pose");

  const shortFallbackPose = clonePose(skeleton.restPose);
  shortFallbackPose[0]!.translation = [9, 0, 0];
  shortFallbackPose.length = 1;
  const shortFallbackBlend = blendPoses(skeleton, [], { threshold: 0.01, fallbackPose: shortFallbackPose });
  assert.equal(shortFallbackBlend[0]!.translation[0], 9, "valid fallback joints should still be used when fallback pose is short");
  assert.deepEqual(shortFallbackBlend[1]!.translation, skeleton.restPose[1]!.translation, "short fallback poses should use skeleton rest pose for missing joints");
  assert.deepEqual(shortFallbackBlend[2]!.translation, skeleton.restPose[2]!.translation, "short fallback poses should use skeleton rest pose for missing threshold fallback");

  const invalidFallbackPose = clonePose(skeleton.restPose);
  invalidFallbackPose[0]!.translation = [Number.NaN, 9, 9];
  invalidFallbackPose[0]!.rotation = [0, 0, 0, 0];
  invalidFallbackPose[0]!.scale = [Number.POSITIVE_INFINITY, 2, 3];
  invalidFallbackPose[1]!.translation = [8, 0, 0];
  const invalidFallbackBlend = blendPoses(skeleton, [], { threshold: 0.01, fallbackPose: invalidFallbackPose });
  assert.deepEqual(
    invalidFallbackBlend[0]!,
    skeleton.restPose[0]!,
    "invalid fallback transforms should fall back per joint to skeleton rest pose"
  );
  assert.equal(invalidFallbackBlend[1]!.translation[0], 8, "valid fallback joints should still be used when neighboring fallback joints are invalid");

  const overweightMask = new Float32Array(skeleton.joints.length);
  overweightMask[2] = 2;
  const overweightMaskedBlend = blendPoses(
    skeleton,
    [
      { pose: skeleton.restPose, weight: 1 },
      { pose: malformedMaskPose, weight: 1, mask: overweightMask }
    ],
    { threshold: 0.01 }
  );
  assert.ok(Math.abs(overweightMaskedBlend[2]!.translation[0] - 40 / 3) < 1e-6, "positive mask weights above 1 should remain supported");

  const nonZeroFallbackPose = clonePose(skeleton.restPose);
  nonZeroFallbackPose[0]!.translation = [3, 2, 1];
  nonZeroFallbackPose[1]!.translation = [4, 5, 6];
  nonZeroFallbackPose[1]!.rotation = normalizeQuat([0, 0.4, 0, 0.9]);
  nonZeroFallbackPose[1]!.scale = [1.5, 1.25, 0.75];
  const invalidLayerPose = clonePose(skeleton.restPose);
  invalidLayerPose[1]!.translation = [Number.NaN, 100, 100];
  invalidLayerPose[1]!.rotation = [0, 0, 0, 0];
  invalidLayerPose[1]!.scale = [Number.POSITIVE_INFINITY, 0.2, 0.3];
  assert.ok(
    validatePose(skeleton, invalidLayerPose).some((issue) => issue.index === 1 && issue.message === "transform is not finite or quaternion is invalid"),
    "validatePose should still report malformed layer transforms"
  );
  const invalidBlend = blendPoses(skeleton, [{ pose: invalidLayerPose, weight: 1 }], { threshold: 0.01, fallbackPose: nonZeroFallbackPose });
  assert.ok(
    invalidBlend[1]!.translation.every((value, index) => Math.abs(value - nonZeroFallbackPose[1]!.translation[index]!) < 1e-6),
    "invalid layer transforms should not wipe non-zero fallback translations"
  );
  assert.ok(
    invalidBlend[1]!.scale.every((value, index) => Math.abs(value - nonZeroFallbackPose[1]!.scale[index]!) < 1e-6),
    "invalid layer transforms should not wipe non-zero fallback scales"
  );
  assert.ok(Math.abs(invalidBlend[1]!.rotation[1] - nonZeroFallbackPose[1]!.rotation[1]) < 1e-12, "invalid layer transforms should keep fallback rotations");
  assert.ok(
    [invalidBlend[1]!.translation, invalidBlend[1]!.rotation, invalidBlend[1]!.scale].flat().every(Number.isFinite),
    "invalid layer transforms should still produce finite output"
  );
  assert.ok(Math.abs(Math.hypot(...invalidBlend[1]!.rotation) - 1) < 1e-12, "invalid layer output rotations should stay normalized");

  const validSameJointPose = clonePose(skeleton.restPose);
  validSameJointPose[1]!.translation = [10, 5, 0];
  validSameJointPose[1]!.rotation = normalizeQuat([0.2, 0, 0, 0.98]);
  validSameJointPose[1]!.scale = [2, 3, 4];
  const mixedValidityBlend = blendPoses(
    skeleton,
    [
      { pose: invalidLayerPose, weight: 3 },
      { pose: validSameJointPose, weight: 1 }
    ],
    { threshold: 0.01, fallbackPose: nonZeroFallbackPose }
  );
  assert.deepEqual(mixedValidityBlend[1]!.translation, validSameJointPose[1]!.translation, "valid same-joint layers should still own joints ignored from malformed layers");
  assert.deepEqual(mixedValidityBlend[1]!.scale, validSameJointPose[1]!.scale, "valid same-joint layers should still blend scale normally");
  assert.ok(Math.abs(mixedValidityBlend[1]!.rotation[0] - validSameJointPose[1]!.rotation[0]) < 1e-12, "valid same-joint layers should still blend rotations normally");
  for (const transform of mixedValidityBlend) {
    assert.ok(
      transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite),
      "malformed override layers should not produce non-finite transforms"
    );
    assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-12, "malformed override layers should not produce denormalized rotations");
  }

  const malformedAdditiveDelta = clonePose(skeleton.restPose);
  malformedAdditiveDelta[0]!.translation = [Number.NaN, 0, 0];
  malformedAdditiveDelta[1]!.translation = [4, 0, 0];
  malformedAdditiveDelta[2]!.translation = [20, 0, 0];
  malformedAdditiveDelta[3]!.translation = [8, 0, 0];
  const malformedAdditiveMask = new Float32Array([Number.NaN, Number.NaN]);
  const malformedAdditivePose = applyAdditivePose(skeleton.restPose, malformedAdditiveDelta, 1, malformedAdditiveMask);
  assert.equal(malformedAdditivePose[0]!.translation[0], 0, "NaN mask entries should block non-finite additive deltas");
  assert.equal(malformedAdditivePose[1]!.translation[0], 0, "NaN mask entries should not affect additive pose application");
  assert.equal(malformedAdditivePose[2]!.translation[0], 0, "missing mask entries should not affect additive pose application");
  assert.equal(malformedAdditivePose[3]!.translation[0], 0, "short additive masks should leave unspecified joints unchanged");
  for (const transform of malformedAdditivePose) {
    assert.ok(
      transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite),
      "malformed additive masks should not produce non-finite transforms"
    );
  }
  const invalidUnmaskedAdditiveDelta = clonePose(skeleton.restPose);
  invalidUnmaskedAdditiveDelta[1]!.translation = [Number.NaN, 0, 0];
  invalidUnmaskedAdditiveDelta[1]!.rotation = [0, 0, 0, 0];
  invalidUnmaskedAdditiveDelta[1]!.scale = [1, Number.POSITIVE_INFINITY, 1];
  const invalidUnmaskedAdditivePose = applyAdditivePose(skeleton.restPose, invalidUnmaskedAdditiveDelta, 1);
  assert.deepEqual(
    invalidUnmaskedAdditivePose[1],
    skeleton.restPose[1],
    "invalid unmasked additive deltas should leave the base joint unchanged instead of leaking non-finite output"
  );
  assert.ok(
    invalidUnmaskedAdditivePose.every((transform) => transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite)),
    "invalid unmasked additive deltas should not produce non-finite transforms"
  );

  const shortAdditiveSample = clonePose(skeleton.restPose);
  shortAdditiveSample[0]!.translation = [3, 0, 0];
  shortAdditiveSample.length = 1;
  const shortAdditiveDelta = additiveDeltaPose(skeleton.restPose, shortAdditiveSample);
  const shortAdditivePose = applyAdditivePose(skeleton.restPose, shortAdditiveDelta, 1);
  assert.equal(shortAdditivePose[0]!.translation[0], 3, "short additive samples should apply available deltas");
  assert.deepEqual(shortAdditivePose[1]!.translation, skeleton.restPose[1]!.translation, "short additive samples should use rest deltas for missing joints");
  assert.deepEqual(shortAdditivePose[2]!.translation, skeleton.restPose[2]!.translation, "short additive samples should leave trailing missing joints unchanged");
  assert.throws(
    () => additiveDeltaPose(skeleton.restPose, [...clonePose(skeleton.restPose), cloneTransform(skeleton.restPose[0]!)]),
    /additive delta pose length mismatch/,
    "oversized additive samples should still fail clearly"
  );
  const signedScaleRestPose = [cloneTransform({ scale: [-2, 2, -4] })];
  const signedScaleSamplePose = [cloneTransform({ scale: [-4, 6, 2] })];
  const signedScaleDeltaPose = additiveDeltaPose(signedScaleRestPose, signedScaleSamplePose);
  assert.deepEqual(signedScaleDeltaPose[0]!.scale, [2, 3, -0.5], "additive scale deltas should preserve finite negative rest-scale ratios");
  const signedScaleAppliedPose = applyAdditivePose(signedScaleRestPose, signedScaleDeltaPose, 1);
  assert.deepEqual(signedScaleAppliedPose[0]!.scale, signedScaleSamplePose[0]!.scale, "positive additive scale weights should apply signed scale ratios");
  const signedScaleSubtractedPose = applyAdditivePose(signedScaleSamplePose, signedScaleDeltaPose, -1);
  assert.deepEqual(signedScaleSubtractedPose[0]!.scale, signedScaleRestPose[0]!.scale, "negative additive scale weights should invert signed scale ratios");

  const tinyWeightBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }]);
  assert.ok(tinyWeightBlend[2]!.rotation[0] > 0);
  assert.ok(tinyWeightBlend[2]!.rotation[0] < sampled[2]!.rotation[0]);

  const nanThresholdBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], { threshold: Number.NaN });
  assert.ok(nanThresholdBlend[2]!.rotation[0] > 0, "NaN thresholds should not discard finite weak layer influence");
  assert.ok(nanThresholdBlend[2]!.rotation[0] < sampled[2]!.rotation[0], "NaN thresholds should preserve rest-pose fallback for tiny weights");

  const weakFallbackPose = clonePose(skeleton.restPose);
  weakFallbackPose[2]!.translation = [Number.NaN, 7, 7];
  weakFallbackPose[2]!.rotation = [0, 0, 0, 0];
  weakFallbackPose[2]!.scale = [Number.NaN, 2, 3];
  const weakLayerPose = clonePose(skeleton.restPose);
  weakLayerPose[2]!.translation = [10, 0, 0];
  const weakInvalidFallbackBlend = blendPoses(skeleton, [{ pose: weakLayerPose, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], {
    fallbackPose: weakFallbackPose
  });
  assert.ok(
    Math.abs(weakInvalidFallbackBlend[2]!.translation[0] - 5) < 1e-6,
    "invalid fallback transforms should not contaminate weak-layer threshold blending"
  );
  assert.ok(
    weakInvalidFallbackBlend[2]!.translation.every(Number.isFinite) &&
      weakInvalidFallbackBlend[2]!.rotation.every(Number.isFinite) &&
      weakInvalidFallbackBlend[2]!.scale.every(Number.isFinite),
    "weak-layer blending with an invalid fallback transform should stay finite"
  );

  const infiniteThresholdBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], { threshold: Number.POSITIVE_INFINITY });
  assert.ok(infiniteThresholdBlend[2]!.rotation[0] > 0, "infinite thresholds should not discard finite weak layer influence");
  assert.ok(infiniteThresholdBlend[2]!.rotation[0] < sampled[2]!.rotation[0], "infinite thresholds should preserve rest-pose fallback for tiny weights");

  const weightedPoseA = sampleClipToPose(
    skeleton,
    {
      id: "weighted-a",
      duration: 1,
      tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: sanitizeQuaternionTrackValues([0.2, 0, 0, 0.98]) }]
    },
    0
  );
  const weightedPoseB = sampleClipToPose(
    skeleton,
    {
      id: "weighted-b",
      duration: 1,
      tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: sanitizeQuaternionTrackValues([0, 0.2, 0, 0.98]) }]
    },
    0
  );
  const weightedBlend = blendPoses(skeleton, [{ pose: weightedPoseA, weight: 2 }, { pose: weightedPoseB, weight: 1 }], { threshold: 0.01 });
  assert.ok(weightedBlend[2]!.rotation[0] > weightedBlend[2]!.rotation[1], "higher layer weights should influence normalized blend more");
  assert.ok(Math.abs(Math.hypot(...weightedBlend[2]!.rotation) - 1) < 1e-5);

  const lowerPriorityTranslateClip: AnimationClip = {
    id: "lower-priority-translate",
    duration: 1,
    tracks: [
      { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([4, 0, 0]) },
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([10, 0, 0]) }
    ]
  };
  const highPriorityHeadClip: AnimationClip = {
    id: "high-priority-head",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([20, 0, 0]) }]
  };
  const samePriorityTranslateClip: AnimationClip = {
    id: "same-priority-translate",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }]
  };
  const runtimeSamePriority = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeSamePriority.setLayer("weighted-a", lowerPriorityTranslateClip, { weight: 3, targetWeight: 3, priority: 2 });
  runtimeSamePriority.setLayer("weighted-b", samePriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 2 });
  const samePriorityRuntimePose = runtimeSamePriority.evaluate().localPose;
  const samePriorityExpectedPose = blendPoses(
    skeleton,
    [
      { pose: sampleClipToPose(skeleton, lowerPriorityTranslateClip, 0), weight: 3 },
      { pose: sampleClipToPose(skeleton, samePriorityTranslateClip, 0), weight: 1 }
    ],
    { threshold: 0.01 }
  );
  assert.equal(samePriorityRuntimePose[2]!.translation[0], samePriorityExpectedPose[2]!.translation[0], "same-priority override layers should keep weighted blending");

  const runtimeMaskedPriority = new AnimationRuntime(skeleton);
  runtimeMaskedPriority.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0 });
  runtimeMaskedPriority.setLayer("head", highPriorityHeadClip, { weight: 1, targetWeight: 1, priority: 10, mask });
  const maskedPriorityPose = runtimeMaskedPriority.evaluate().localPose;
  assert.ok(Math.abs(maskedPriorityPose[1]!.translation[0] - 4) < 1e-6, "higher-priority masked layers should leave unowned joints on the lower-priority pose");
  assert.ok(Math.abs(maskedPriorityPose[2]!.translation[0] - 20) < 1e-6, "higher-priority masked layers should own masked joints");

  const runtimeWeakPriority = new AnimationRuntime(skeleton, { blendThreshold: 0.1 });
  runtimeWeakPriority.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeWeakPriority.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const weakPriorityPose = runtimeWeakPriority.evaluate().localPose;
  assert.ok(Math.abs(weakPriorityPose[2]!.translation[0] - 15) < 1e-6, "weak higher-priority layers should blend over the lower-priority fallback until threshold is reached");

  const runtimeNaNThreshold = new AnimationRuntime(skeleton, { blendThreshold: Number.NaN });
  runtimeNaNThreshold.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeNaNThreshold.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const nanThresholdRuntimePose = runtimeNaNThreshold.evaluate().localPose;
  assert.ok(Math.abs(nanThresholdRuntimePose[2]!.translation[0] - 15) < 1e-6, "runtime NaN blend thresholds should preserve weak-layer fallback behavior");

  const runtimeInfiniteThreshold = new AnimationRuntime(skeleton, { blendThreshold: Number.POSITIVE_INFINITY });
  runtimeInfiniteThreshold.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeInfiniteThreshold.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const infiniteThresholdRuntimePose = runtimeInfiniteThreshold.evaluate().localPose;
  assert.ok(Math.abs(infiniteThresholdRuntimePose[2]!.translation[0] - 15) < 1e-6, "runtime infinite blend thresholds should preserve weak-layer fallback behavior");

  const crossfadeOldClip: AnimationClip = {
    id: "crossfade-old",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [2, 0, 0])]
  };
  const crossfadeNewClip: AnimationClip = {
    id: "crossfade-new",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [10, 0, 0])]
  };
  const runtimeCrossfade = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfade.setLayer("old", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeCrossfade.crossfade("new", crossfadeNewClip, { priority: 4, fadeSpeed: 1 });
  runtimeCrossfade.update(Math.log(2));
  const midCrossfade = runtimeCrossfade.evaluate();
  assert.ok(midCrossfade.activeLayers.some((layer) => layer.id === "old" && Math.abs(layer.weight - 0.5) < 1e-6));
  assert.ok(midCrossfade.activeLayers.some((layer) => layer.id === "new" && Math.abs(layer.weight - 0.5) < 1e-6));
  assert.ok(Math.abs(midCrossfade.localPose[2]!.translation[0] - 6) < 1e-6, "in-progress crossfade should normalize same-priority override weights");
  runtimeCrossfade.update(20);
  const finishedCrossfade = runtimeCrossfade.evaluate();
  assert.equal(finishedCrossfade.activeLayers.some((layer) => layer.id === "old"), false, "crossfade should remove fully faded source layers");
  assert.ok(Math.abs(finishedCrossfade.localPose[2]!.translation[0] - 10) < 1e-4, "crossfade target should dominate after fade completion");

  const additiveNudgeClip: AnimationClip = {
    id: "additive-nudge",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [1, 0, 0])]
  };
  const runtimeCrossfadeAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeAdditive.setLayer("old", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeCrossfadeAdditive.setLayer("additive", additiveNudgeClip, { weight: 1, targetWeight: 1, priority: 2, blendMode: "additive" });
  runtimeCrossfadeAdditive.crossfade("new", crossfadeNewClip, { priority: 2, fadeSpeed: 8 });
  runtimeCrossfadeAdditive.update(20);
  const additiveCrossfadePose = runtimeCrossfadeAdditive.evaluate();
  const additiveLayer = additiveCrossfadePose.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(additiveLayer?.blendMode, "additive", "override crossfade should not fade additive layers implicitly");
  assert.ok(Math.abs(additiveLayer!.targetWeight - 1) < 1e-6);
  assert.ok(Math.abs(additiveCrossfadePose.localPose[2]!.translation[0] - 11) < 1e-4);

  const runtimeCrossfadeToAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeToAdditive.setLayer("base", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeCrossfadeToAdditive.crossfade("additive", additiveNudgeClip, { priority: 2, fadeSpeed: 1, blendMode: "additive" });
  runtimeCrossfadeToAdditive.update(Math.log(2));
  const midAdditiveTargetCrossfade = runtimeCrossfadeToAdditive.evaluate();
  const baseDuringAdditiveTarget = midAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "base");
  const additiveTargetDuringFade = midAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "additive");
  assert.ok(baseDuringAdditiveTarget, "additive crossfade should leave same-priority override base layers active");
  assert.equal(baseDuringAdditiveTarget!.targetWeight, 1, "additive crossfade should not retarget same-priority override base layers");
  assert.equal(baseDuringAdditiveTarget!.weight, 1, "additive crossfade should not fade same-priority override base influence");
  assert.ok(additiveTargetDuringFade, "additive crossfade target should become active while fading in");
  assert.equal(additiveTargetDuringFade!.blendMode, "additive");
  assert.ok(Math.abs(additiveTargetDuringFade!.weight - 0.5) < 1e-6, "additive crossfade target should fade in independently");
  assert.ok(Math.abs(midAdditiveTargetCrossfade.localPose[2]!.translation[0] - 2.5) < 1e-6, "additive crossfade target should compose on top of the base pose while fading");
  runtimeCrossfadeToAdditive.update(20);
  const finishedAdditiveTargetCrossfade = runtimeCrossfadeToAdditive.evaluate();
  const baseAfterAdditiveTarget = finishedAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "base");
  const additiveTargetAfterFade = finishedAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(baseAfterAdditiveTarget?.targetWeight, 1, "additive crossfade should keep base target weight after completion");
  assert.ok(Math.abs(additiveTargetAfterFade!.weight - 1) < 1e-4, "additive crossfade target should finish fading in");
  assert.ok(Math.abs(finishedAdditiveTargetCrossfade.localPose[2]!.translation[0] - 3) < 1e-4, "additive crossfade target should compose fully on top of the base pose");

  const runtimeReplaceExistingAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeReplaceExistingAdditive.setLayer("base", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeReplaceExistingAdditive.setLayer("additive", additiveNudgeClip, { weight: 1, targetWeight: 1, priority: 2, blendMode: "additive" });
  runtimeReplaceExistingAdditive.crossfade(
    "additive",
    { id: "additive-replacement", duration: 1, tracks: [makeTransformTrack("head", "translation", [4, 0, 0])] },
    { resetTime: true, fadeSpeed: 1 }
  );
  runtimeReplaceExistingAdditive.update(Math.log(2));
  const replacedExistingAdditive = runtimeReplaceExistingAdditive.evaluate();
  const baseDuringExistingAdditiveReplace = replacedExistingAdditive.activeLayers.find((layer) => layer.id === "base");
  const replacedExistingAdditiveLayer = replacedExistingAdditive.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(replacedExistingAdditiveLayer?.blendMode, "additive", "crossfading an existing additive layer should preserve its blend mode by default");
  assert.equal(baseDuringExistingAdditiveReplace?.targetWeight, 1, "replacing an additive layer should not implicitly fade same-priority override layers");
  assert.ok(Math.abs(replacedExistingAdditiveLayer!.weight - 0.5) < 1e-6, "replaced additive layers should still honor resetTime fade-in");
  assert.ok(Math.abs(replacedExistingAdditive.localPose[2]!.translation[0] - 4) < 1e-6, "replaced additive layers should compose over the base pose instead of replacing it");

  const runtimeSubtractiveAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeSubtractiveAdditive.setLayer("base", crossfadeNewClip, { weight: 1, targetWeight: 1 });
  runtimeSubtractiveAdditive.setLayer("subtract", additiveNudgeClip, { weight: -2, targetWeight: -2, blendMode: "additive" });
  const subtractiveAdditiveEvaluation = runtimeSubtractiveAdditive.evaluate();
  assert.ok(Math.abs(subtractiveAdditiveEvaluation.localPose[2]!.translation[0] - 8) < 1e-6, "negative additive runtime weights should subtract from the base pose");
  assert.equal(subtractiveAdditiveEvaluation.activeLayers.find((layer) => layer.id === "subtract")?.weight, -2);

  const runtimeAdditiveNegativeFade = new AnimationRuntime(skeleton);
  runtimeAdditiveNegativeFade.setLayer("fade-subtract", additiveNudgeClip, { weight: 0, targetWeight: -1, fadeSpeed: 1, blendMode: "additive" });
  runtimeAdditiveNegativeFade.update(Math.log(2));
  const additiveNegativeFadeEvaluation = runtimeAdditiveNegativeFade.evaluate();
  const additiveNegativeFadeLayer = additiveNegativeFadeEvaluation.activeLayers.find((layer) => layer.id === "fade-subtract");
  assert.ok(additiveNegativeFadeLayer, "additive layers should remain active while fading toward a negative target");
  assert.ok(Math.abs(additiveNegativeFadeLayer!.weight + 0.5) < 1e-6, "additive targetWeight should fade toward negative values");
  assert.equal(additiveNegativeFadeLayer!.targetWeight, -1);
  assert.ok(Math.abs(additiveNegativeFadeEvaluation.localPose[2]!.translation[0] + 0.5) < 1e-6);

  const runtimeNegativeOverride = new AnimationRuntime(skeleton);
  runtimeNegativeOverride.setLayer("negative-override", crossfadeNewClip, { weight: -1, targetWeight: -1 });
  const negativeOverrideEvaluation = runtimeNegativeOverride.evaluate();
  assert.equal(negativeOverrideEvaluation.activeLayers.length, 0, "negative override weights should sanitize to no influence");
  assert.equal(negativeOverrideEvaluation.localPose[2]!.translation[0], skeleton.restPose[2]!.translation[0]);

  const runtimeCrossfadeMasked = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeMasked.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0 });
  runtimeCrossfadeMasked.setLayer("old", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 5 });
  runtimeCrossfadeMasked.crossfade("head", highPriorityHeadClip, { priority: 5, mask, fadeSpeed: 8 });
  runtimeCrossfadeMasked.update(20);
  const maskedCrossfadePose = runtimeCrossfadeMasked.evaluate().localPose;
  assert.ok(Math.abs(maskedCrossfadePose[1]!.translation[0] - 4) < 1e-6, "masked crossfade should keep unowned joints on lower-priority fallback pose");
  assert.ok(Math.abs(maskedCrossfadePose[2]!.translation[0] - 20) < 1e-4, "masked crossfade target should own masked joints after fade completion");

  assert.deepEqual(
    filterTracksByNamePolicy(
      [{ name: "hips.position" }, { name: "head.quaternion" }, { name: "leftThumbProximal.quaternion" }],
      { exclude: [/hips\.position$/, /thumb/i] }
    ).map((track) => track.name),
    ["head.quaternion"]
  );
  const globalThumbMaskRule = /thumb/gi;
  assert.deepEqual(
    filterTracksByNamePolicy(
      [{ name: "leftThumbProximal.quaternion" }, { name: "rightThumbDistal.quaternion" }, { name: "head.quaternion" }],
      { exclude: [globalThumbMaskRule] }
    ).map((track) => track.name),
    ["head.quaternion"],
    "global regex track masks should not leak lastIndex state between tracks"
  );
  assert.equal(globalThumbMaskRule.lastIndex, 0, "global regex track masks should leave caller regex state deterministic");

  assert.deepEqual(
    filterTracksByNamePolicy(
      [
        { name: "hips.position" },
        { name: "spine.quaternion" },
        { name: "leftShoulder.quaternion" },
        { name: "leftUpperArm.quaternion" },
        { name: "rightLowerArm.quaternion" },
        { name: "rightHand.quaternion" },
        { name: "leftUpperLeg.quaternion" }
      ],
      AUTHORED_BASE_TRACK_POLICY
    ).map((track) => track.name),
    [
      "hips.position",
      "spine.quaternion",
      "leftShoulder.quaternion",
      "leftUpperArm.quaternion",
      "rightLowerArm.quaternion",
      "rightHand.quaternion",
      "leftUpperLeg.quaternion"
    ],
    "authored base policy should preserve source-driven arm and leg rotations"
  );

  const baseAuthoredClip = makeAuthoredLoopClip("base-authored-upper", ["hips.position", "spine", "leftShoulder", "rightUpperArm", "leftHand", "rightIndexProximal", "leftUpperLeg"]);
  const sourcePropertyPolicyClip: AnimationClip = {
    id: "source-property-policy",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  assert.deepEqual(
    applySourceTrackPolicy(sourcePropertyPolicyClip, { include: [/^head\.quaternion$/] }).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    ["head.rotation"],
    "source track regex rules should match Three-facing quaternion source names before UUID binding"
  );
  assert.deepEqual(
    applySourceTrackPolicy(sourcePropertyPolicyClip, { exclude: [/^head\.position$/] }).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    ["head.rotation", "hips.translation"],
    "source track regex rules should distinguish properties on the same source bone"
  );
  assert.deepEqual(
    applySourceTrackPolicy(baseAuthoredClip, AUTHORED_BASE_SOURCE_TRACK_POLICY).tracks.map((track) => track.humanBone ?? track.joint),
    ["hips", "spine", "leftShoulder", "rightUpperArm", "leftHand", "leftUpperLeg"],
    "authored base source policy should keep arm tracks before Three track names become UUID based"
  );
  assert.deepEqual(
    filterTracksByNamePolicy(
      [
        { name: "leftShoulder.quaternion" },
        { name: "leftUpperArm.quaternion" },
        { name: "rightLowerArm.quaternion" },
        { name: "rightHand.quaternion" },
        { name: "leftIndexProximal.quaternion" },
        { name: "leftUpperLeg.quaternion" }
      ],
      BASE_PROCEDURAL_TRACK_POLICY
    ).map((track) => track.name),
    ["leftShoulder.quaternion", "leftUpperArm.quaternion", "rightLowerArm.quaternion", "rightHand.quaternion", "leftUpperLeg.quaternion"],
    "legacy base policy alias should no longer underdrive authored arms"
  );
  assert.deepEqual(
    applySourceTrackPolicy(baseAuthoredClip, BASE_PROCEDURAL_SOURCE_TRACK_POLICY).tracks.map((track) => track.humanBone ?? track.joint),
    ["hips", "spine", "leftShoulder", "rightUpperArm", "leftHand", "leftUpperLeg"],
    "legacy base source policy alias should no longer underdrive authored arms"
  );

}
