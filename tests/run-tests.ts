import assert from "node:assert/strict";
import { AnimationMixer, LoopOnce, Object3D, Vector3 } from "three";
import {
  AnimationRuntime,
  type AnimationManifest,
  type AnimationClip,
  BlinkScheduler,
  FacialExpressionMixer,
  finiteSigned,
  limitVisemeStack,
  PresencePlanner,
  WAIFU_ANIMATION_BINARY_FORMAT,
  VisemeMixer,
  applyAdditivePose,
  applyThreeFootPlantResult,
  applyThreeLocomotionUpperBodyPosture,
  applyThreePresenceTargets,
  calculateThreeBaseLoopSeamWindow,
  calculateThreeBaseLoopTransitionWeights,
  calculateThreeOverlayFade,
  calculateThreeRuntimeStartTime,
  clearThreeFootPlantOffsets,
  blendPoses,
  breathingWeight,
  clamp01,
  createThreeLocomotionUpperBodyTargets,
  createJointMask,
  DEFAULT_BLEND_THRESHOLD,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  calculateThreeRuntimeInfluence,
  decodeAnimationBinary,
  encodeAnimationBinary,
  readActiveThreeRuntimeClipSnapshots,
  readThreeRuntimeClipSnapshot,
  prepareThreeRuntimeAction,
  additiveDeltaPose,
  createSkeleton,
  clonePose,
  cloneTransform,
  distributeLookAt,
  applySourceTrackPolicy,
  filterTracksByNamePolicy,
  BASE_PROCEDURAL_TRACK_POLICY,
  BASE_PROCEDURAL_SOURCE_TRACK_POLICY,
  LOCOMOTION_BASE_SOURCE_TRACK_POLICY,
  ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY,
  inspectAnimationAsset,
  inspectClipAsset,
  identityTransform,
  localToModelPose,
  normalizeQuat,
  normalizeTransform,
  normalizeVec3,
  poseRotationMetric,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  multiplyQuat,
  invertQuat,
  retargetQuaternionSample,
  retargetQuaternionTrackValues,
  sampleClipToPose,
  sampleTrack,
  sanitizeQuaternionTrackValues,
  solveFootPlant,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  toFloat32Array,
  rejectedAnimationReport,
  usableManifestClips,
  validateAnimationManifestAssets,
  validateClip,
  validateManifest,
  validateSkeleton,
  validatePose,
  validateAnimationInputs,
  zeroVisemes
} from "../src/index.js";

const skeleton = createSkeleton([
  { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "head", parentName: "spine", humanoid: "head" },
  { name: "leftUpperArm", parentName: "spine", humanoid: "leftUpperArm" }
]);

const nodClip: AnimationClip = {
  id: "nod",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0, 0.5, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0.15, 0, 0, 0.9887, 0, 0, 0, 1])
    }
  ]
};

const invalidValidationStatusManifestEntry = {
  id: "typo-status",
  label: "Typo Status",
  url: "/typo-status.waifuanim.bin",
  format: WAIFU_ANIMATION_BINARY_FORMAT,
  validation: { status: "acceptted" } as unknown as { status: "accepted" }
};

const quarantinedManifestEntry = {
  id: "quarantined",
  label: "Quarantined",
  url: "/quarantined.waifuanim.bin",
  format: WAIFU_ANIMATION_BINARY_FORMAT,
  validation: { status: "quarantined", reason: "manual hold" }
};

assert.equal(clamp01(2), 1);
assert.equal(finiteSigned(-0.75, 1), -0.75);
assert.equal(finiteSigned(Number.NaN, 1), 1);
assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [1, 0, 0]), [1, 0, 0]);
assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [2, 0, 0]), [1, 0, 0]);
assert.deepEqual(normalizeVec3([Infinity, 0, 0], [0, 1, 0]), [0, 1, 0]);
assert.deepEqual(normalizeVec3([0, 0, 0], [Number.NaN, 0, 0]), [0, 0, 1]);
const finiteQuatFallback = normalizeQuat([Number.NaN, 0, 0, 1], [0, 0, 0.5, 0.5]);
assert.ok(Math.abs(finiteQuatFallback[2] - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(finiteQuatFallback[3] - Math.SQRT1_2) < 1e-12);
assert.deepEqual(normalizeQuat([Infinity, 0, 0, 1], [0, 0, 0, 2]), [0, 0, 0, 1]);
assert.deepEqual(normalizeQuat([0, 0, 0, 0], [Number.NaN, 0, 0, 0]), [0, 0, 0, 1]);
assert.deepEqual(invertQuat([Number.POSITIVE_INFINITY, 0, 0, 1]), [0, 0, 0, 1]);
assert.deepEqual(
  Array.from(sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, -1])),
  [0, 0, 0, 1, -0, -0, -0, 1],
  "quaternion track sanitization should keep equivalent samples in the shortest hemisphere"
);
const repairedTransform = normalizeTransform({
  translation: [Number.NaN, 2, Infinity],
  rotation: [0, 0, 0, 0],
  scale: [1.5, Number.NEGATIVE_INFINITY, Number.NaN]
});
assert.deepEqual(repairedTransform.translation, [0, 2, 0]);
assert.deepEqual(repairedTransform.rotation, [0, 0, 0, 1]);
assert.deepEqual(repairedTransform.scale, [1.5, 1, 1]);
const clonedTransform = cloneTransform({
  translation: [-3, Number.NaN, 4],
  rotation: [0, Number.POSITIVE_INFINITY, 0, 1],
  scale: [Number.NaN, 2, Number.NEGATIVE_INFINITY]
});
assert.deepEqual(clonedTransform.translation, [-3, 0, 4]);
assert.deepEqual(clonedTransform.rotation, [0, 0, 0, 1]);
assert.deepEqual(clonedTransform.scale, [1, 2, 1]);
assert.deepEqual(identityTransform(), cloneTransform(undefined));
const repairedRestSkeleton = createSkeleton([{ name: "root", rest: { translation: [Number.NaN, 5, Infinity], scale: [Number.NaN, 3, -Infinity] } }]);
assert.deepEqual(repairedRestSkeleton.restPose[0]!.translation, [0, 5, 0]);
assert.deepEqual(repairedRestSkeleton.restPose[0]!.scale, [1, 3, 1]);
assert.throws(
  () =>
    createSkeleton([
      { name: "hips", humanoid: "hips" },
      { name: "pelvis", humanoid: "hips" }
    ]),
  /duplicate humanoid bone hips on joints hips and pelvis/,
  "createSkeleton should reject duplicate humanoid bone assignments"
);
const duplicateHumanoidSkeleton = {
  ...skeleton,
  joints: skeleton.joints.map((joint, index) => (index === 3 ? { ...joint, humanoid: "head" as const } : joint))
};
assert.ok(
  validateSkeleton(duplicateHumanoidSkeleton).some(
    (issue) => issue.index === 3 && issue.joint === "leftUpperArm" && issue.message === "duplicate humanoid bone head also assigned to head"
  ),
  "validateSkeleton should report duplicate humanoid bone assignments on malformed skeletons"
);
const nonIntegerParentSkeleton = {
  ...skeleton,
  joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, parentIndex: Number.NaN } : joint))
};
assert.ok(
  validateSkeleton(nonIntegerParentSkeleton).some(
    (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "parent index must be an integer"
  ),
  "validateSkeleton should report non-integer parent indices on malformed skeletons"
);
const duplicateJointNameSkeleton = {
  ...skeleton,
  joints: skeleton.joints.map((joint, index) => (index === 3 ? { ...joint, name: "head" } : joint))
};
assert.ok(
  validateSkeleton(duplicateJointNameSkeleton).some(
    (issue) => issue.index === 3 && issue.joint === "head" && issue.message === "duplicate joint name also assigned to index 2"
  ),
  "validateSkeleton should report duplicate joint names on externally mutated skeletons"
);
const staleParentsSkeleton = {
  ...skeleton,
  parents: Int16Array.from([-1, 0, 0, 1])
};
assert.ok(
  validateSkeleton(staleParentsSkeleton).some(
    (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "parents entry does not match joint parent"
  ),
  "validateSkeleton should report stale parents arrays"
);
const shortParentsSkeleton = {
  ...skeleton,
  parents: Int16Array.from([-1, 0])
};
assert.ok(
  validateSkeleton(shortParentsSkeleton).some((issue) => issue.message === "parents length does not match joints"),
  "validateSkeleton should report parents length mismatches"
);
const staleRestPoseSkeleton = {
  ...skeleton,
  restPose: skeleton.restPose.map((transform, index) => (index === 2 ? { ...cloneTransform(transform), translation: [0, 99, 0] as [number, number, number] } : cloneTransform(transform)))
};
assert.ok(
  validateSkeleton(staleRestPoseSkeleton).some(
    (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "rest pose entry does not match joint rest"
  ),
  "validateSkeleton should report stale rest pose entries"
);
const shortRestPoseSkeleton = {
  ...skeleton,
  restPose: skeleton.restPose.slice(0, 2)
};
assert.ok(
  validateSkeleton(shortRestPoseSkeleton).some((issue) => issue.message === "rest pose length does not match joints"),
  "validateSkeleton should report rest pose length mismatches"
);
const staleNameToIndexSkeleton = {
  ...skeleton,
  nameToIndex: new Map([
    ["hips", 0],
    ["spine", 1],
    ["head", 3],
    ["leftUpperArm", 3],
    ["stale", 1]
  ])
};
const staleNameToIndexIssues = validateSkeleton(staleNameToIndexSkeleton);
assert.ok(
  staleNameToIndexIssues.some((issue) => issue.index === 2 && issue.joint === "head" && issue.message === "nameToIndex entry does not match joint index"),
  "validateSkeleton should report mismatched nameToIndex lookups"
);
assert.ok(
  staleNameToIndexIssues.some((issue) => issue.message === "nameToIndex entry stale is stale"),
  "validateSkeleton should report stale nameToIndex entries"
);
const staleHumanoidSkeleton = {
  ...skeleton,
  humanoid: new Map([
    ["hips", 0],
    ["spine", 1],
    ["head", 3],
    ["leftUpperArm", 3],
    ["rightHand", 1]
  ])
};
const staleHumanoidIssues = validateSkeleton(staleHumanoidSkeleton);
assert.ok(
  staleHumanoidIssues.some((issue) => issue.index === 2 && issue.joint === "head" && issue.message === "humanoid map entry head does not match joint index"),
  "validateSkeleton should report mismatched humanoid map lookups"
);
assert.ok(
  staleHumanoidIssues.some((issue) => issue.message === "humanoid map entry rightHand is stale"),
  "validateSkeleton should report stale humanoid map entries"
);
assert.equal(validateAnimationInputs(skeleton, nodClip).accepted, true);
assert.equal(inspectClipAsset({ id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, nodClip).accepted, true);

const malformedValidationStatusManifest = {
  version: 1,
  clips: [
    { id: "valid", label: "Valid", url: "/valid.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
    invalidValidationStatusManifestEntry,
    { id: "numeric-status", label: "Numeric Status", url: "/numeric-status.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: 1 } },
    quarantinedManifestEntry,
    { id: "rejected", label: "Rejected", url: "/rejected.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: "rejected" } },
    { id: "accepted", label: "Accepted", url: "/accepted.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: "accepted" } }
  ]
} as unknown as AnimationManifest;
const malformedValidationStatusIssues = validateManifest(malformedValidationStatusManifest);
assert.ok(
  malformedValidationStatusIssues.includes("typo-status has invalid validation status acceptted"),
  "validateManifest should report typo validation.status values from runtime JSON"
);
assert.ok(
  malformedValidationStatusIssues.includes("numeric-status has invalid validation status 1"),
  "validateManifest should report non-string validation.status values from runtime JSON"
);
assert.deepEqual(
  usableManifestClips(malformedValidationStatusManifest).map((entry) => entry.id),
  ["valid", "accepted"],
  "usableManifestClips should exclude malformed, rejected, and quarantined validation statuses"
);
assert.deepEqual(
  rejectedAnimationReport(malformedValidationStatusManifest).map((entry) => [entry.id, entry.reason]),
  [
    ["typo-status", "invalid validation status acceptted"],
    ["numeric-status", "invalid validation status 1"],
    ["quarantined", "manual hold"],
    ["rejected", "manifest marks clip rejected"]
  ],
  "rejectedAnimationReport should surface malformed validation status through the existing rejected logging path"
);
const invalidValidationStatusClipInspection = inspectClipAsset(
  invalidValidationStatusManifestEntry,
  nodClip
);
assert.equal(invalidValidationStatusClipInspection.accepted, false);
assert.ok(
  invalidValidationStatusClipInspection.issues.some((issue) => issue.message === "invalid validation status acceptted"),
  "inspectClipAsset should reject malformed validation.status metadata"
);
const invalidValidationStatusAssetInspection = inspectAnimationAsset(
  invalidValidationStatusManifestEntry,
  nodClip,
  skeleton
);
assert.equal(invalidValidationStatusAssetInspection.status, "rejected");
assert.equal(invalidValidationStatusAssetInspection.accepted, false);
assert.ok(
  invalidValidationStatusAssetInspection.issues.some((issue) => issue.message === "invalid validation status acceptted"),
  "inspectAnimationAsset should reject malformed validation.status metadata"
);
const quarantinedAssetInspection = inspectAnimationAsset(
  quarantinedManifestEntry,
  nodClip,
  skeleton
);
assert.equal(quarantinedAssetInspection.status, "quarantined");
assert.equal(quarantinedAssetInspection.accepted, false);
assert.ok(
  quarantinedAssetInspection.issues.some((issue) => issue.message === "manual hold"),
  "inspectAnimationAsset should preserve manifest quarantine reasons as validation issues"
);
const quarantinedAssetValidationReport = await validateAnimationManifestAssets(
  {
    version: 1,
    clips: [quarantinedManifestEntry]
  },
  async () => encodeAnimationBinary(nodClip),
  { skeleton, now: new Date("2026-01-01T00:00:00.000Z") }
);
assert.equal(quarantinedAssetValidationReport.accepted, 0);
assert.equal(quarantinedAssetValidationReport.rejected, 0);
assert.equal(quarantinedAssetValidationReport.quarantined, 1);
assert.equal(quarantinedAssetValidationReport.entries[0]!.status, "quarantined");
assert.equal(quarantinedAssetValidationReport.entries[0]!.accepted, false);

const duplicateResolvedChannelClip: AnimationClip = {
  id: "duplicate-resolved-channel",
  duration: 1,
  tracks: [
    { humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
    { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
  ]
};
const duplicateResolvedChannelReport = validateAnimationInputs(skeleton, duplicateResolvedChannelClip);
assert.equal(duplicateResolvedChannelReport.accepted, false);
assert.ok(
  duplicateResolvedChannelReport.clipIssues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")),
  "validateAnimationInputs should reject joint/humanBone aliases that resolve to one rotation channel"
);
const duplicateResolvedAsset = inspectAnimationAsset(
  { id: "duplicate-resolved-channel", label: "Duplicate Resolved Channel", url: "/duplicate-resolved-channel.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
  duplicateResolvedChannelClip,
  skeleton
);
assert.equal(duplicateResolvedAsset.status, "rejected");
assert.ok(
  duplicateResolvedAsset.issues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")),
  "inspectAnimationAsset should surface duplicate resolved target channels"
);

const duplicateDeclaredChannelClip: AnimationClip = {
  id: "duplicate-declared-channel",
  duration: 1,
  tracks: [
    { joint: "head", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
    { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
  ]
};
const duplicateDeclaredInspection = inspectClipAsset(
  { id: "duplicate-declared-channel", label: "Duplicate Declared Channel", url: "/duplicate-declared-channel.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
  duplicateDeclaredChannelClip
);
assert.equal(duplicateDeclaredInspection.accepted, false);
assert.ok(
  duplicateDeclaredInspection.issues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head.translation")),
  "inspectClipAsset should reject obvious duplicate declared channels without a skeleton"
);

const distinctPropertyClip: AnimationClip = {
  id: "distinct-properties",
  duration: 1,
  tracks: [
    { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
    { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
    { joint: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([1, 1, 1]) }
  ]
};
assert.equal(validateAnimationInputs(skeleton, distinctPropertyClip).accepted, true, "distinct transform properties on one joint should remain valid");
assert.equal(
  inspectClipAsset({ id: "distinct-properties", label: "Distinct Properties", url: "/distinct-properties.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, distinctPropertyClip)
    .accepted,
  true,
  "declared channels with distinct normalized properties should remain valid"
);

const validSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("valid-source-rest-quaternion");
assert.equal(validateAnimationInputs(skeleton, validSourceRestQuaternionClip).accepted, true, "valid source rest metadata on quaternion tracks should remain accepted");
const decodedSourceRestQuaternionClip = decodeAnimationBinary(encodeAnimationBinary(validSourceRestQuaternionClip), "valid-source-rest-quaternion");
assert.deepEqual(
  Array.from(decodedSourceRestQuaternionClip.tracks[0]!.sourceRestQuaternion ?? []),
  [0, 0, 0, 1],
  "binary roundtrips should preserve source rest quaternion metadata"
);
assert.throws(
  () => encodeAnimationBinary({ ...validSourceRestQuaternionClip, tracks: [{ ...validSourceRestQuaternionClip.tracks[0]!, sourceRestQuaternion: toFloat32Array([0, 0, 1]) }] }),
  /animation track head\.quaternion sourceRestQuaternion must contain exactly 4 values/,
  "binary encoding should reject malformed source rest quaternion metadata before writing a corrupt payload"
);

const invalidZeroSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("invalid-zero-source-rest-quaternion", { sourceRestQuaternion: [0, 0, 0, 0] });
const invalidZeroSourceRestQuaternionReport = validateAnimationInputs(skeleton, invalidZeroSourceRestQuaternionClip);
assert.equal(invalidZeroSourceRestQuaternionReport.accepted, false);
assert.ok(
  invalidZeroSourceRestQuaternionReport.clipIssues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "quaternion" &&
      issue.message === "sourceRestQuaternion must be normalizable"
  ),
  "validateAnimationInputs should reject zero-length source rest quaternion metadata"
);

const invalidNonUnitSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("invalid-non-unit-source-rest-quaternion", { sourceRestQuaternion: [0, 0, 0, 2] });
const invalidNonUnitSourceRestQuaternionInspection = inspectClipAsset(
  {
    id: "invalid-non-unit-source-rest-quaternion",
    label: "Invalid Non Unit Source Rest Quaternion",
    url: "/invalid-non-unit-source-rest-quaternion.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  invalidNonUnitSourceRestQuaternionClip
);
assert.equal(invalidNonUnitSourceRestQuaternionInspection.accepted, false);
assert.ok(
  invalidNonUnitSourceRestQuaternionInspection.issues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "quaternion" &&
      issue.message === "sourceRestQuaternion must be normalized"
  ),
  "inspectClipAsset should reject non-unit source rest quaternion metadata"
);

const invalidSourceRestQuaternionShapeClip: AnimationClip = {
  id: "invalid-source-rest-quaternion-shape",
  duration: 1,
  tracks: [
    makeSourceRestQuaternionTrack({ sourceRestQuaternion: [0, 0, 1] }),
    makeSourceRestQuaternionTrack({ humanBone: "spine", property: "rotation", sourceRestQuaternion: [0, Number.NaN, 0, 1] })
  ]
};
const invalidSourceRestQuaternionShapeReport = validateAnimationInputs(skeleton, invalidSourceRestQuaternionShapeClip);
assert.equal(invalidSourceRestQuaternionShapeReport.accepted, false);
assert.ok(
  invalidSourceRestQuaternionShapeReport.clipIssues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "quaternion" &&
      issue.message === "sourceRestQuaternion must contain exactly 4 values"
  ),
  "validateAnimationInputs should reject source rest quaternions with the wrong component count"
);
assert.ok(
  invalidSourceRestQuaternionShapeReport.clipIssues.some(
    (issue) =>
      issue.track === 1 &&
      issue.joint === "spine" &&
      issue.property === "rotation" &&
      issue.message === "sourceRestQuaternion values must be finite"
  ),
  "validateAnimationInputs should reject non-finite source rest quaternion components"
);

const invalidSourceRestQuaternionPropertyClip: AnimationClip = makeSourceRestQuaternionClip("invalid-source-rest-quaternion-property", {
  joint: "head",
  property: "translation",
  values: [0, 0, 0]
});
const invalidSourceRestQuaternionPropertyInspection = inspectClipAsset(
  {
    id: "invalid-source-rest-quaternion-property",
    label: "Invalid Source Rest Quaternion Property",
    url: "/invalid-source-rest-quaternion-property.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  invalidSourceRestQuaternionPropertyClip
);
assert.equal(invalidSourceRestQuaternionPropertyInspection.accepted, false);
assert.ok(
  invalidSourceRestQuaternionPropertyInspection.issues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "translation" &&
      issue.message === "sourceRestQuaternion is only valid on rotation tracks"
  ),
  "inspectClipAsset should reject source rest quaternion metadata on non-rotation tracks"
);

const invalidZeroRotationSampleClip: AnimationClip = {
  id: "invalid-zero-rotation-sample",
  duration: 1,
  tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }]
};
const invalidZeroRotationSampleReport = validateAnimationInputs(skeleton, invalidZeroRotationSampleClip);
assert.equal(invalidZeroRotationSampleReport.accepted, false);
assert.ok(
  invalidZeroRotationSampleReport.clipIssues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "quaternion" &&
      issue.message === "rotation track quaternions must be normalizable"
  ),
  "validateAnimationInputs should reject zero-length rotation samples"
);

const invalidNonUnitRotationSampleInspection = inspectClipAsset(
  {
    id: "invalid-non-unit-rotation-sample",
    label: "Invalid Non Unit Rotation Sample",
    url: "/invalid-non-unit-rotation-sample.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  {
    id: "invalid-non-unit-rotation-sample",
    duration: 1,
    tracks: [{ joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }]
  }
);
assert.equal(invalidNonUnitRotationSampleInspection.accepted, false);
assert.ok(
  invalidNonUnitRotationSampleInspection.issues.some(
    (issue) =>
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.property === "rotation" &&
      issue.message === "rotation track quaternions must be normalized"
  ),
  "inspectClipAsset should reject materially non-normalized rotation samples"
);

const duplicateTrackTimeClip: AnimationClip = {
  id: "duplicate-track-time",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 0]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
};
assert.equal(validateAnimationInputs(skeleton, duplicateTrackTimeClip).accepted, false);
assert.ok(
  validateAnimationInputs(skeleton, duplicateTrackTimeClip).clipIssues.some((issue) => issue.message === "track times must be sorted"),
  "equal track times should be rejected"
);

const negativeTrackTimeClip: AnimationClip = {
  id: "negative-track-time",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([-0.1, 0.5]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
};
assert.equal(validateAnimationInputs(skeleton, negativeTrackTimeClip).accepted, false);
assert.ok(
  validateAnimationInputs(skeleton, negativeTrackTimeClip).clipIssues.some((issue) => issue.message === "track time must be within clip duration"),
  "negative track times should be rejected"
);

const overDurationTrackTimeClip: AnimationClip = {
  id: "over-duration-track-time",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1.1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
};
assert.equal(validateAnimationInputs(skeleton, overDurationTrackTimeClip).accepted, false);
assert.ok(
  validateAnimationInputs(skeleton, overDurationTrackTimeClip).clipIssues.some((issue) => issue.message === "track time must be within clip duration"),
  "track times beyond clip duration should be rejected"
);

const endpointTrackTimeClip: AnimationClip = {
  id: "endpoint-track-time",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
};
assert.equal(validateAnimationInputs(skeleton, endpointTrackTimeClip).accepted, true, "endpoint track times should remain accepted");

const decodedNodClip = decodeAnimationBinary(encodeAnimationBinary(nodClip), "nod");
assert.equal(decodedNodClip.id, "nod");
assert.equal(decodedNodClip.tracks.length, 1);
assert.deepEqual(Array.from(decodedNodClip.tracks[0]!.times), [0, 0.5, 1]);
assert.ok(decodedNodClip.tracks[0]!.values instanceof Float32Array);
const invalidTargetKindBinary = encodeAnimationBinary(nodClip);
new DataView(invalidTargetKindBinary).setUint32(32, 99, true);
assert.throws(
  () => decodeAnimationBinary(invalidTargetKindBinary, "invalid-target-kind"),
  /animation track 0 target kind is invalid/,
  "decodeAnimationBinary should reject unknown target kinds instead of treating them as joint tracks"
);
assert.throws(
  () => decodeAnimationBinary(invalidTargetKindBinary.slice(0, invalidTargetKindBinary.byteLength - 1), "misaligned-floats"),
  /animation binary float data is misaligned/,
  "decodeAnimationBinary should reject payloads whose float table is not 4-byte aligned"
);

const rootMotionRotationOnlyClip: AnimationClip = {
  ...nodClip,
  id: "root-motion-walk"
};
assert.equal(
  inspectClipAsset({ id: "root-motion-walk", label: "Root Motion Walk", url: "/root-motion-walk.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, rootMotionRotationOnlyClip)
    .accepted,
  false
);
assert.equal(
  inspectClipAsset(
    {
      id: "root-motion-walk",
      label: "Root Motion Walk",
      url: "/root-motion-walk.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    rootMotionRotationOnlyClip
  ).accepted,
  true
);
const preservedRootMotionHeadOnlyClip: AnimationClip = {
  id: "root-motion-head-only",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.1, 0]) }]
};
const preservedRootMotionHeadOnlyInspection = inspectClipAsset(
  {
    id: "root-motion-head-only",
    label: "Root Motion Head Only",
    url: "/root-motion-head-only.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "preserved" } }
  },
  preservedRootMotionHeadOnlyClip
);
assert.equal(preservedRootMotionHeadOnlyInspection.accepted, false);
assert.ok(
  preservedRootMotionHeadOnlyInspection.issues.some((issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"),
  "preserved root-motion clips should not accept arbitrary non-root translation tracks"
);
const preservedRootMotionHipsClip: AnimationClip = {
  id: "root-motion-hips",
  duration: 1,
  tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 1]) }]
};
assert.equal(
  inspectClipAsset(
    {
      id: "root-motion-hips",
      label: "Root Motion Hips",
      url: "/root-motion-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    preservedRootMotionHipsClip
  ).accepted,
  true,
  "preserved root-motion clips should accept hips translation tracks"
);
const invalidRootMotionPolicyInspection = inspectAnimationAsset(
  {
    id: "root-motion-walk",
    label: "Root Motion Walk",
    url: "/root-motion-walk.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "keep-everything" } }
  },
  rootMotionRotationOnlyClip
);
assert.equal(invalidRootMotionPolicyInspection.status, "rejected");
assert.equal(invalidRootMotionPolicyInspection.rootMotionPolicy, "none");
assert.ok(
  invalidRootMotionPolicyInspection.issues.some((issue) => issue.message === "root-motion clip must declare source.rootMotion.policy"),
  "asset validation should use the same root-motion policy interpretation as manifest inspection"
);
assert.equal(
  inspectAnimationAsset(
    { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true, states: ["idle"], source: { category: "idle", posture: "standing" } },
    nodClip,
    skeleton
  ).status,
  "accepted"
);

const loopEndpointWarning = "loop endpoints differ; crossfade or seam blending is required";
const oppositeQuaternionEndpointClip: AnimationClip = {
  id: "opposite-quaternion-endpoints",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0, 1]),
      values: toFloat32Array([0, 0, 0, 1, 0, 0, 0, -1])
    }
  ]
};
const oppositeQuaternionEndpointInspection = inspectAnimationAsset(
  {
    id: "opposite-quaternion-endpoints",
    label: "Opposite Quaternion Endpoints",
    url: "/opposite-quaternion-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true
  },
  oppositeQuaternionEndpointClip,
  skeleton
);
assert.equal(oppositeQuaternionEndpointInspection.status, "accepted", "sign-opposite normalized rotation endpoints should remain valid");
assert.equal(
  oppositeQuaternionEndpointInspection.issues.some((issue) => issue.message === loopEndpointWarning),
  false,
  "looping rotation endpoints should compare quaternion-equivalent signs"
);

const mismatchedTranslationEndpointClip: AnimationClip = {
  id: "mismatched-translation-endpoints",
  duration: 1,
  loop: true,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0.25, 0, 0]) }]
};
assert.equal(
  inspectAnimationAsset(
    {
      id: "mismatched-translation-endpoints",
      label: "Mismatched Translation Endpoints",
      url: "/mismatched-translation-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    mismatchedTranslationEndpointClip,
    skeleton
  ).issues.some((issue) => issue.message === loopEndpointWarning),
  true,
  "translation loop endpoint validation should keep raw component behavior"
);

const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
assert.ok(sampled[2]!.rotation[0] > 0.1);

const coreRetargetSourceRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const coreRetargetTargetRest = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const coreRetargetDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
const coreRetargetSourceSample = multiplyQuat(coreRetargetSourceRest, coreRetargetDelta);
const coreRetargetSkeleton = createSkeleton([
  { name: "root" },
  { name: "upper", parentName: "root", humanoid: "leftUpperArm", rest: { rotation: coreRetargetTargetRest } }
]);
const coreRetargetClip: AnimationClip = {
  id: "core-source-rest-retarget",
  duration: 1,
  tracks: [
    {
      humanBone: "leftUpperArm",
      property: "quaternion",
      sourceRestQuaternion: toFloat32Array(coreRetargetSourceRest),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([...coreRetargetSourceRest, ...coreRetargetSourceSample])
    }
  ]
};
const coreRetargetExpected = retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceSample);
const coreRetargetPose = sampleClipToPose(coreRetargetSkeleton, coreRetargetClip, 1);
assert.ok(
  !quaternionNearlyEqual(coreRetargetSourceSample, coreRetargetExpected, 1e-4),
  "core retarget fixture should distinguish raw source-basis rotations from target-rest rotations"
);
assert.ok(
  quaternionNearlyEqual(coreRetargetPose[1]!.rotation, coreRetargetExpected, 1e-5),
  "sampleClipToPose should retarget source-rest rotation tracks into the skeleton rest basis"
);
const coreRetargetRuntime = new AnimationRuntime(coreRetargetSkeleton);
coreRetargetRuntime.setLayer("retargeted", coreRetargetClip, { weight: 1, targetWeight: 1, time: 1 });
const coreRetargetEvaluation = coreRetargetRuntime.evaluate();
assert.ok(
  quaternionNearlyEqual(coreRetargetEvaluation.localPose[1]!.rotation, coreRetargetExpected, 1e-5),
  "AnimationRuntime.evaluate should use the retargeted core sampling path"
);

const malformedFallbackClip: AnimationClip = {
  id: "malformed-fallbacks",
  duration: 1,
  tracks: [
    { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([]) },
    { humanBone: "spine", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([]) },
    { humanBone: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([]) },
    { humanBone: "leftUpperArm", property: "scale", times: toFloat32Array([]), values: toFloat32Array([]) }
  ]
};
const malformedFallbackPose = sampleClipToPose(skeleton, malformedFallbackClip, 0);
assert.deepEqual(malformedFallbackPose[0]!.translation, [0, 0, 0], "missing translation samples should fall back to zero translation");
assert.deepEqual(malformedFallbackPose[1]!.rotation, [0, 0, 0, 1], "missing rotation samples should fall back to identity rotation");
assert.deepEqual(malformedFallbackPose[2]!.scale, [1, 1, 1], "missing scale samples should fall back to identity scale");
assert.deepEqual(malformedFallbackPose[3]!.scale, [1, 1, 1], "empty scale tracks should fall back to identity scale");
const shortSamplingRestPose = sampleClipToPose(skeleton, { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] }, 0, { restPose: [] });
assert.deepEqual(shortSamplingRestPose[2]!.translation, skeleton.restPose[2]!.translation, "short sampling rest poses should fall back missing base joints to skeleton rest pose");
const invalidSamplingRestPose = clonePose(skeleton.restPose);
invalidSamplingRestPose[2]!.translation = [Number.NaN, 7, 7];
invalidSamplingRestPose[2]!.rotation = [0, 0, 0, 0];
invalidSamplingRestPose[2]!.scale = [Number.POSITIVE_INFINITY, 2, 3];
const invalidSamplingRestFallback = sampleClipToPose(skeleton, { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] }, 0, {
  restPose: invalidSamplingRestPose
});
assert.deepEqual(invalidSamplingRestFallback[2]!.translation, skeleton.restPose[2]!.translation, "invalid sampling rest transforms should fall back per joint to skeleton rest pose");

const unsupportedPropertyClip = {
  id: "unsupported-property",
  duration: 1,
  tracks: [{ humanBone: "hips", property: "visibility", times: toFloat32Array([0]), values: toFloat32Array([1, 1, 1]) }]
} as unknown as AnimationClip;
const unsupportedPropertyIssues = validateClip(unsupportedPropertyClip, skeleton);
assert.equal(
  unsupportedPropertyIssues.some(
    (issue) => issue.track === 0 && issue.property === "visibility" && issue.message === "track property is unsupported"
  ),
  true,
  "unsupported external track properties should be reported instead of treated as 3-float transform channels"
);
assert.throws(
  () => sampleTrack(unsupportedPropertyClip.tracks[0]!, 0),
  /unsupported animation track property visibility/,
  "unsupported external track properties should fail during direct sampling"
);
assert.throws(
  () => sampleClipToPose(skeleton, unsupportedPropertyClip, 0),
  /unsupported animation track property visibility/,
  "unsupported mapped track properties should not be silently ignored during pose sampling"
);
const unsupportedPropertyRuntime = new AnimationRuntime(skeleton);
unsupportedPropertyRuntime.setLayer("external-invalid", unsupportedPropertyClip, { weight: 1, targetWeight: 1 });
const unsupportedPropertyRuntimeEvaluation = unsupportedPropertyRuntime.evaluate();
assertFiniteEvaluation(unsupportedPropertyRuntimeEvaluation);
assert.equal(unsupportedPropertyRuntimeEvaluation.diagnostics, undefined, "runtime diagnostics should stay opt-in for unsupported external tracks");
const unsupportedPropertyRuntimeDiagnostics = unsupportedPropertyRuntime.evaluate({ diagnostics: true });
assertFiniteEvaluation(unsupportedPropertyRuntimeDiagnostics);
assert.ok(
  unsupportedPropertyRuntimeDiagnostics.diagnostics!.some(
    (issue) =>
      issue.stage === "sample" &&
      issue.layerId === "external-invalid" &&
      issue.clipId === "unsupported-property" &&
      issue.track === 0 &&
      issue.property === "visibility" &&
      issue.joint === "hips" &&
      issue.index === 0 &&
      issue.message === "track property is unsupported"
  ),
  "runtime diagnostics should report unsupported external track properties with layer/clip/track context"
);

const models = localToModelPose(skeleton, sampled);
assert.equal(models.length, skeleton.joints.length);
assert.equal(models[0]![13], 1);

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

const malformedMaskPose = clonePose(skeleton.restPose);
malformedMaskPose[0]!.translation = [5, 1, 0];
malformedMaskPose[1]!.translation = [4, 0, 0];
malformedMaskPose[2]!.translation = [20, 0, 0];
malformedMaskPose[3]!.translation = [8, 0, 0];
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
    BASE_PROCEDURAL_TRACK_POLICY
  ).map((track) => track.name),
  ["hips.position", "spine.quaternion", "leftUpperLeg.quaternion"],
  "base procedural policy should leave arms to procedural posture instead of source-loop rest poses"
);

const baseAuthoredClip = makeAuthoredLoopClip("base-authored-upper", ["hips.position", "spine", "leftShoulder", "rightUpperArm", "leftHand", "rightIndexProximal", "leftUpperLeg"]);
assert.deepEqual(
  applySourceTrackPolicy(baseAuthoredClip, BASE_PROCEDURAL_SOURCE_TRACK_POLICY).tracks.map((track) => track.humanBone ?? track.joint),
  ["hips", "spine", "leftUpperLeg"],
  "base source policy should strip authored arm and finger tracks before Three track names become UUID based"
);

const locomotionAuthoredClip = makeAuthoredLoopClip("locomotion-authored-upper", [
  "hips.position",
  "spine",
  "leftShoulder",
  "leftUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftIndexProximal",
  "rightThumbDistal",
  "leftUpperLeg",
  "leftLowerLeg",
  "rightFoot"
]);
const locomotionBaseClip = applySourceTrackPolicy(locomotionAuthoredClip, LOCOMOTION_BASE_SOURCE_TRACK_POLICY);
assert.deepEqual(
  locomotionBaseClip.tracks.map((track) => track.humanBone ?? track.joint),
  ["hips", "spine", "leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "rightFoot"],
  "locomotion base policy should keep authored full-body tracks while stripping finger detail"
);
assert.deepEqual(
  applySourceTrackPolicy(locomotionBaseClip, ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
  [
    "spine.quaternion",
    "leftShoulder.quaternion",
    "leftUpperArm.quaternion",
    "rightLowerArm.quaternion",
    "rightHand.quaternion",
    "leftUpperLeg.quaternion",
    "leftLowerLeg.quaternion",
    "rightFoot.quaternion"
  ],
  "source root translation policy should remove hips translation before runtime tracks are renamed to UUIDs"
);
assert.equal(locomotionAuthoredClip.tracks.length, 11, "source track policy should not mutate the original clip");

const locomotionRuntimeRoot = new Object3D();
const locomotionRuntimeBones = new Map<string, Object3D>();
for (const name of ["hips", "spine", "leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand", "leftIndexProximal", "rightThumbDistal", "leftUpperLeg", "leftLowerLeg", "rightFoot"]) {
  const bone = new Object3D();
  bone.name = name;
  locomotionRuntimeRoot.add(bone);
  locomotionRuntimeBones.set(name, bone);
}
const locomotionThreeClip = createThreeAnimationClip(locomotionBaseClip, {
  resolveBone: (bone) => locomotionRuntimeBones.get(bone)
});
assert.deepEqual(
  locomotionThreeClip.tracks.map((track) => track.name.split(".").at(-1)),
  ["position", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion"],
  "runtime clip creation should consume source-filtered locomotion tracks"
);
assert.equal(
  locomotionThreeClip.tracks.some((track) =>
    ["leftIndexProximal", "rightThumbDistal"].some((name) => track.name.includes(locomotionRuntimeBones.get(name)!.uuid))
  ),
  false,
  "runtime locomotion clip should not contain authored finger tracks after policy filtering"
);
assert.equal(
  locomotionThreeClip.tracks.some((track) =>
    ["leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand"].some((name) => track.name.includes(locomotionRuntimeBones.get(name)!.uuid))
  ),
  true,
  "runtime locomotion clip should retain authored shoulder, arm, and hand tracks"
);

const locomotionUpperBodyTargets = createThreeLocomotionUpperBodyTargets({ influence: 1.5, phase: 0.25, speed: 20 });
assert.deepEqual(
  locomotionUpperBodyTargets.map((target) => target.bone),
  ["leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand"],
  "locomotion posture helper should expose a reusable full arm target set"
);
assert.equal(locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.influence, 1, "locomotion posture influence should clamp");
assert.ok(
  (locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.rotation[2] ?? 0) > 1,
  "locomotion posture should roll the left upper arm down from a horizontal source-stripped pose"
);
assert.ok(
  (locomotionUpperBodyTargets.find((target) => target.bone === "rightUpperArm")?.rotation[2] ?? 0) < -1,
  "locomotion posture should roll the right upper arm down from a horizontal source-stripped pose"
);
assert.ok(
  (locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.rotation[0] ?? 0) >
    (createThreeLocomotionUpperBodyTargets({ influence: 1, phase: 0.75 }).find((target) => target.bone === "leftUpperArm")?.rotation[0] ?? 0),
  "locomotion posture should phase arm swing"
);

const locomotionPostureBones = new Map<string, Object3D>();
const locomotionPostureRoot = new Object3D();
for (const name of locomotionUpperBodyTargets.map((target) => target.bone)) {
  const bone = new Object3D();
  bone.name = name;
  locomotionPostureBones.set(name, bone);
}
const locomotionPostureHips = new Object3D();
locomotionPostureHips.name = "hips";
locomotionPostureBones.set("hips", locomotionPostureHips);
locomotionPostureRoot.add(locomotionPostureHips);
attachArmChain(locomotionPostureRoot, locomotionPostureBones, "left", 1);
attachArmChain(locomotionPostureRoot, locomotionPostureBones, "right", -1);
const locomotionPostureResult = applyThreeLocomotionUpperBodyPosture({
  resolveBone: (bone) => locomotionPostureBones.get(bone),
  deltaSeconds: 1,
  phase: 0,
  influence: 1,
  speed: 100
});
assert.equal(locomotionPostureResult.applied, true, "locomotion posture should apply through the same target path as presence");
locomotionPostureRoot.updateMatrixWorld(true);
const leftPostureRoot = locomotionPostureBones.get("leftUpperArm")!.getWorldPosition(new Vector3());
const leftPostureJoint = locomotionPostureBones.get("leftLowerArm")!.getWorldPosition(new Vector3());
const leftPostureUpperDirection = leftPostureJoint.sub(leftPostureRoot).normalize();
const rightPostureRoot = locomotionPostureBones.get("rightUpperArm")!.getWorldPosition(new Vector3());
const rightPostureJoint = locomotionPostureBones.get("rightLowerArm")!.getWorldPosition(new Vector3());
const rightPostureUpperDirection = rightPostureJoint.sub(rightPostureRoot).normalize();
assert.ok(
  leftPostureUpperDirection.y < -0.6 && Math.abs(leftPostureUpperDirection.x) < 0.25 && rightPostureUpperDirection.y < -0.6 && Math.abs(rightPostureUpperDirection.x) < 0.25,
  "locomotion posture application should keep upper arms close to the torso in model space"
);
assert.ok(
  Math.abs(locomotionPostureBones.get("leftLowerArm")!.quaternion.x) > 0.05 || Math.abs(locomotionPostureBones.get("leftLowerArm")!.quaternion.z) > 0.05,
  "locomotion posture IK should bend the lower arm toward the hand target"
);

const runtime = new AnimationRuntime(skeleton);
runtime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
runtime.update(0.5);
const evaluated = runtime.evaluate();
assert.ok(evaluated.activeLayers.length === 1);
assert.ok(evaluated.localPose[2]!.rotation[0] > 0.1);
assert.equal(evaluated.diagnostics, undefined);

const sanitizedRuntime = new AnimationRuntime(skeleton);
const sanitizedLayer = sanitizedRuntime.setLayer("bad-inputs", nodClip, {
  time: Number.NaN,
  weight: Number.NEGATIVE_INFINITY,
  targetWeight: -2,
  fadeSpeed: Number.POSITIVE_INFINITY,
  speed: -1,
  priority: -3
});
assert.equal(sanitizedLayer.time, 0);
assert.equal(sanitizedLayer.weight, 0);
assert.equal(sanitizedLayer.targetWeight, 0);
assert.equal(sanitizedLayer.fadeSpeed, 8);
assert.equal(sanitizedLayer.speed, 0);
assert.equal(sanitizedLayer.priority, 0);

const sanitizedCrossfade = sanitizedRuntime.crossfade("bad-crossfade", nodClip, {
  time: -1,
  weight: Number.NaN,
  targetWeight: Number.POSITIVE_INFINITY,
  fadeSpeed: -4,
  speed: Number.NaN,
  priority: Number.NEGATIVE_INFINITY
});
assert.equal(sanitizedCrossfade.time, 0);
assert.equal(sanitizedCrossfade.weight, 0);
assert.equal(sanitizedCrossfade.targetWeight, 1);
assert.equal(sanitizedCrossfade.fadeSpeed, 0);
assert.equal(sanitizedCrossfade.speed, 1);
assert.equal(sanitizedCrossfade.priority, 0);
sanitizedRuntime.fadeOut("bad-crossfade", Number.NaN);
assert.equal(sanitizedCrossfade.fadeSpeed, 8);

const corruptedRuntime = new AnimationRuntime(skeleton);
const corruptedLayer = corruptedRuntime.setLayer("corrupted", nodClip, { weight: 1, targetWeight: 1, loop: true });
corruptedLayer.time = Number.POSITIVE_INFINITY;
corruptedLayer.targetWeight = Number.NaN;
corruptedLayer.fadeSpeed = Number.NEGATIVE_INFINITY;
corruptedLayer.speed = Number.POSITIVE_INFINITY;
corruptedLayer.priority = Number.NaN;
corruptedRuntime.update(Number.NaN);
corruptedRuntime.update(-1);
const corruptedEvaluation = corruptedRuntime.evaluate();
const corruptedActiveLayer = corruptedEvaluation.activeLayers.find((layer) => layer.id === "corrupted");
assert.ok(corruptedActiveLayer);
assert.equal(corruptedActiveLayer.time, 0);
assert.equal(corruptedActiveLayer.weight, 1);
assert.equal(corruptedActiveLayer.targetWeight, 0);
assert.equal(corruptedActiveLayer.priority, 0);
assert.ok(corruptedEvaluation.activeLayers.every((layer) => [layer.time, layer.weight, layer.targetWeight, layer.priority].every(Number.isFinite)));
assertFiniteEvaluation(corruptedEvaluation);

const invalidRuntime = new AnimationRuntime(skeleton);
const invalidTranslationScaleClip: AnimationClip = {
  id: "invalid-translation-scale",
  duration: 1,
  tracks: [
    { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([Number.NaN, 0, 0]) },
    { humanBone: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([1, Number.POSITIVE_INFINITY, 1]) }
  ]
};
invalidRuntime.setLayer("invalid-source", invalidTranslationScaleClip, { weight: 1, targetWeight: 1, blendMode: "additive" });
assert.equal(invalidRuntime.evaluate().diagnostics, undefined, "runtime diagnostics should stay opt-in");
const invalidEvaluation = invalidRuntime.evaluate({ diagnostics: true });
assert.ok(invalidEvaluation.diagnostics!.some((issue) => issue.stage === "sample" && issue.layerId === "invalid-source" && issue.clipId === "invalid-translation-scale"));
assert.ok(invalidEvaluation.diagnostics!.some((issue) => issue.stage === "final" && issue.joint === "spine"));
assertFiniteEvaluation(invalidEvaluation);
for (const transform of invalidEvaluation.localPose) {
  assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-5);
}

const invalidRotationRuntime = new AnimationRuntime(skeleton);
const invalidRotationClip: AnimationClip = {
  id: "invalid-rotation",
  duration: 1,
  tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, Number.NaN, 0, 1]) }]
};
invalidRotationRuntime.setLayer("invalid-rotation-source", invalidRotationClip, { weight: 1, targetWeight: 1 });
const invalidRotationEvaluation = invalidRotationRuntime.evaluate({ diagnostics: true });
assert.ok(
  invalidRotationEvaluation.diagnostics!.some((issue) => issue.stage === "sample" && issue.layerId === "invalid-rotation-source" && issue.clipId === "invalid-rotation"),
  "runtime diagnostics should report invalid active rotation source tracks"
);

const repairedRotationRuntime = new AnimationRuntime(skeleton);
const repairedRotationClip: AnimationClip = {
  id: "repaired-runtime-rotation",
  duration: 1,
  tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }]
};
repairedRotationRuntime.setLayer("repaired-runtime-rotation-source", repairedRotationClip, { weight: 1, targetWeight: 1 });
const repairedRotationEvaluation = repairedRotationRuntime.evaluate({ diagnostics: true });
assert.ok(
  repairedRotationEvaluation.diagnostics!.some(
    (issue) =>
      issue.stage === "sample" &&
      issue.layerId === "repaired-runtime-rotation-source" &&
      issue.clipId === "repaired-runtime-rotation" &&
      issue.track === 0 &&
      issue.sample === 0 &&
      issue.joint === "head" &&
      issue.index === 2 &&
      issue.message === "rotation track quaternion was repaired to a normalizable fallback"
  ),
  "runtime diagnostics should report rotation samples repaired during sampling"
);
assert.ok(repairedRotationEvaluation.localPose[2]!.rotation.every(Number.isFinite));
assert.ok(Math.abs(Math.hypot(...repairedRotationEvaluation.localPose[2]!.rotation) - 1) < 1e-5);

const repairedSourceRestRuntime = new AnimationRuntime(skeleton);
const repairedSourceRestClip: AnimationClip = {
  id: "repaired-runtime-source-rest",
  duration: 1,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0]),
      values: toFloat32Array([0, 0, 0, 1]),
      sourceRestQuaternion: toFloat32Array([0, 0, 0, 0])
    }
  ]
};
repairedSourceRestRuntime.setLayer("repaired-runtime-source-rest-source", repairedSourceRestClip, { weight: 1, targetWeight: 1 });
const repairedSourceRestEvaluation = repairedSourceRestRuntime.evaluate({ diagnostics: true });
assert.ok(
  repairedSourceRestEvaluation.diagnostics!.some(
    (issue) =>
      issue.stage === "sample" &&
      issue.layerId === "repaired-runtime-source-rest-source" &&
      issue.clipId === "repaired-runtime-source-rest" &&
      issue.track === 0 &&
      issue.joint === "head" &&
      issue.index === 2 &&
      issue.message === "sourceRestQuaternion was repaired to a normalizable fallback"
  ),
  "runtime diagnostics should report malformed source-rest metadata repaired during sampling"
);
assert.ok(repairedSourceRestEvaluation.localPose[2]!.rotation.every(Number.isFinite));
assert.ok(Math.abs(Math.hypot(...repairedSourceRestEvaluation.localPose[2]!.rotation) - 1) < 1e-5);


const presenceBone = new Object3D();
presenceBone.name = "head";
const presenceApply = applyThreePresenceTargets({
  resolveBone: (bone) => (bone === "head" ? presenceBone : null),
  deltaSeconds: 1 / 30,
  targets: [{ bone: "head", rotation: [0.1, 0.2, 0], influence: 1, speed: 12 }]
});
assert.equal(presenceApply.applied, true);
assert.ok(Math.abs(presenceBone.quaternion.w) < 0.99999);
const presenceFallbackSpeedBone = new Object3D();
const presenceFallbackSpeed = applyThreePresenceTargets({
  resolveBone: (bone) => (bone === "head" ? presenceFallbackSpeedBone : null),
  deltaSeconds: 1 / 30,
  targets: [{ bone: "head", rotation: [0.1, 0.2, 0], influence: 1, speed: Number.NaN }]
});
assert.equal(presenceFallbackSpeed.applied, true, "Three presence application should fall back from non-finite target speeds");
assert.ok(
  [
    presenceFallbackSpeedBone.quaternion.x,
    presenceFallbackSpeedBone.quaternion.y,
    presenceFallbackSpeedBone.quaternion.z,
    presenceFallbackSpeedBone.quaternion.w
  ].every(Number.isFinite),
  "Three presence application should keep bone quaternions finite for non-finite target speeds"
);
assert.equal(
  applyThreePresenceTargets({
    resolveBone: () => null,
    deltaSeconds: 1 / 30,
    targets: [{ bone: "missing", rotation: [0, 0, 0], influence: 1 }]
  }).issues.length,
  1
);

const retargeted = retargetQuaternionSample([0, 0, 0, 1], [0, 0, 0, 1], [0, 0.2, 0, 0.98]);
assert.ok(Math.abs(Math.hypot(...retargeted) - 1) < 1e-5);

const sourceRestX = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const localSourceDeltaY = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
const sourceSampleWithLocalDelta = multiplyQuat(localSourceDeltaY, sourceRestX);
const targetRestZ = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const retargetedZeroSample = retargetQuaternionSample(sourceRestX, targetRestZ, [0, 0, 0, 0]);
assert.ok(
  Math.abs(retargetedZeroSample[0] - targetRestZ[0]) < 1e-5 &&
    Math.abs(retargetedZeroSample[1] - targetRestZ[1]) < 1e-5 &&
    Math.abs(retargetedZeroSample[2] - targetRestZ[2]) < 1e-5 &&
    Math.abs(retargetedZeroSample[3] - targetRestZ[3]) < 1e-5,
  "retargeting should treat non-normalizable source samples as identity source deltas"
);
const retargetedNonUnitSample = retargetQuaternionSample(sourceRestX, targetRestZ, sourceSampleWithLocalDelta.map((component) => component * 2) as [number, number, number, number]);
const retargetedUnitSample = retargetQuaternionSample(sourceRestX, targetRestZ, sourceSampleWithLocalDelta);
assert.ok(
  Math.abs(retargetedNonUnitSample[0] - retargetedUnitSample[0]) < 1e-5 &&
    Math.abs(retargetedNonUnitSample[1] - retargetedUnitSample[1]) < 1e-5 &&
    Math.abs(retargetedNonUnitSample[2] - retargetedUnitSample[2]) < 1e-5 &&
    Math.abs(retargetedNonUnitSample[3] - retargetedUnitSample[3]) < 1e-5,
  "retargeting should repair non-unit source samples without changing their rotation"
);
const expectedEquivalentRestDelta = multiplyQuat(sourceSampleWithLocalDelta, invertQuat(sourceRestX));
const retargetedToEquivalentRest = retargetQuaternionSample(sourceRestX, sourceRestX, sourceSampleWithLocalDelta);
assert.ok(
  Math.abs(retargetedToEquivalentRest[0] - sourceSampleWithLocalDelta[0]) < 1e-5 &&
    Math.abs(retargetedToEquivalentRest[1] - sourceSampleWithLocalDelta[1]) < 1e-5 &&
    Math.abs(retargetedToEquivalentRest[2] - sourceSampleWithLocalDelta[2]) < 1e-5 &&
    Math.abs(retargetedToEquivalentRest[3] - sourceSampleWithLocalDelta[3]) < 1e-5,
  "retargeting should keep equivalent source and target rest bases stable"
);
const expectedNormalizedDelta = expectedEquivalentRestDelta;
const retargetedToNormalizedRest = retargetQuaternionSample(sourceRestX, [0, 0, 0, 1], sourceSampleWithLocalDelta);
assert.ok(
  Math.abs(retargetedToNormalizedRest[0] - expectedNormalizedDelta[0]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[1] - expectedNormalizedDelta[1]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[2] - expectedNormalizedDelta[2]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[3] - expectedNormalizedDelta[3]) < 1e-5,
  "retargeting should preserve source local rotation deltas before applying normalized target rest"
);
assert.deepEqual(
  retargetQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, -1], undefined, [0, 0, 0, 1]).values,
  [0, 0, 0, 1, -0, -0, -0, 1],
  "retargeted quaternion tracks should keep equivalent samples in the shortest hemisphere"
);

const mismatchedBasisSourceRest = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
const mismatchedBasisTargetRest = [0, 0, 0, 1] as const;
const mismatchedBasisDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
const mismatchedBasisSample = multiplyQuat(mismatchedBasisDelta, mismatchedBasisSourceRest);
const mismatchedBasisBones = createSingleLimbBones(mismatchedBasisTargetRest);
const mismatchedBasisClip = createThreeAnimationClip(
  {
    id: "mismatched-rest-basis",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperArm",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mismatchedBasisSourceRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mismatchedBasisSourceRest, ...mismatchedBasisSample])
      }
    ]
  },
  {
    resolveBone: (bone) => (bone === "leftUpperArm" ? mismatchedBasisBones.upper : null)
  }
);
sampleThreeClipOnce(mismatchedBasisBones.root, mismatchedBasisClip);
const mismatchedBasisActual = readChildDirection(mismatchedBasisBones.upper, mismatchedBasisBones.lower);
const mismatchedBasisExpectedRotation = retargetQuaternionSample(mismatchedBasisSourceRest, [...mismatchedBasisTargetRest], mismatchedBasisSample);
const mismatchedBasisExpected = rotateVec3ByQuat(mismatchedBasisExpectedRotation, [0, 1, 0]);
const mismatchedBasisConjugatedPath = rotateVec3ByQuat(
  multiplyQuat(
    invertQuat(mismatchedBasisSourceRest),
    multiplyQuat(mismatchedBasisSample, mismatchedBasisSourceRest)
  ),
  [0, 1, 0]
);
assert.ok(
  !vectorNearlyEqual(mismatchedBasisExpected, mismatchedBasisConjugatedPath, 1e-4),
  "basis fixture should distinguish local delta retargeting from rest-basis conjugation"
);
assert.ok(vectorNearlyEqual(mismatchedBasisActual, mismatchedBasisExpected, 1e-5), "Three retargeting should render child direction from the source local delta");

const motusRightUpperLegRest: [number, number, number, number] = [-0.0006, 0.1254, 0.9682, -0.2166];
const motusRightUpperLegSample: [number, number, number, number] = [-0.0035, 0.1166, 0.9636, -0.2406];
const motusTargetRest: [number, number, number, number] = [0, 0, 0, 1];
const motusLegBones = createSingleLimbBones(motusTargetRest, "rightUpperLeg", "rightLowerLeg", [0, -1, 0]);
const motusLegClip = createThreeAnimationClip(
  {
    id: "motus-right-leg-pre-rotation",
    duration: 1,
    tracks: [
      {
        humanBone: "rightUpperLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(motusRightUpperLegRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...motusRightUpperLegRest, ...motusRightUpperLegSample])
      }
    ]
  },
  {
    resolveBone: (bone) => (bone === "rightUpperLeg" ? motusLegBones.upper : null)
  }
);
sampleThreeClipOnce(motusLegBones.root, motusLegClip);
const motusLegActual = readChildDirection(motusLegBones.upper, motusLegBones.lower);
const motusLegExpectedRotation = retargetQuaternionSample(motusRightUpperLegRest, motusTargetRest, motusRightUpperLegSample);
const motusLegExpected = rotateVec3ByQuat(motusLegExpectedRotation, [0, -1, 0]);
const motusLegConjugatedRotation = multiplyQuat(invertQuat(motusRightUpperLegRest), motusRightUpperLegSample);
const motusLegConjugated = rotateVec3ByQuat(motusLegConjugatedRotation, [0, -1, 0]);
assert.ok(
  !vectorNearlyEqual(motusLegExpected, motusLegConjugated, 1e-3),
  "right-leg fixture should catch conjugating Motus Man pre-rotations into the target leg"
);
assert.ok(vectorNearlyEqual(motusLegActual, motusLegExpected, 1e-5), "right leg should preserve forward local stride instead of twisting inward");

const mirroredLegSourceRestLeft = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
const mirroredLegSourceRestRight = quatFromAxisAngle([0, 1, 0], -Math.PI / 2);
const mirroredLegFlexion = quatFromAxisAngle([1, 0, 0], Math.PI / 4);
const mirroredLegRoot = new Object3D();
mirroredLegRoot.name = "mirroredLegRoot";
const mirroredLegBones = {
  left: createSingleLimbBones([0, 0, 0, 1], "leftUpperLeg", "leftLowerLeg", [0, -1, 0]),
  right: createSingleLimbBones([0, 0, 0, 1], "rightUpperLeg", "rightLowerLeg", [0, -1, 0])
};
mirroredLegRoot.add(mirroredLegBones.left.upper);
mirroredLegRoot.add(mirroredLegBones.right.upper);
const mirroredLegClip = createThreeAnimationClip(
  {
    id: "mirrored-leg-pre-rotation-flexion",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLegSourceRestLeft),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestLeft, ...multiplyQuat(mirroredLegFlexion, mirroredLegSourceRestLeft)])
      },
      {
        humanBone: "rightUpperLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLegSourceRestRight),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestRight, ...multiplyQuat(mirroredLegFlexion, mirroredLegSourceRestRight)])
      }
    ]
  },
  {
    resolveBone: (bone) => {
      if (bone === "leftUpperLeg") return mirroredLegBones.left.upper;
      if (bone === "rightUpperLeg") return mirroredLegBones.right.upper;
      return null;
    },
    targetRestQuaternion: () => [0, 0, 0, 1]
  }
);
sampleThreeClipOnce(mirroredLegRoot, mirroredLegClip);
const mirroredLegActualLeft = readChildDirection(mirroredLegBones.left.upper, mirroredLegBones.left.lower);
const mirroredLegActualRight = readChildDirection(mirroredLegBones.right.upper, mirroredLegBones.right.lower);
const mirroredLegExpected = rotateVec3ByQuat(mirroredLegFlexion, [0, -1, 0]);
const oldOrderMirroredLeft = rotateVec3ByQuat(multiplyQuat(invertQuat(mirroredLegSourceRestLeft), multiplyQuat(mirroredLegFlexion, mirroredLegSourceRestLeft)), [0, -1, 0]);
const oldOrderMirroredRight = rotateVec3ByQuat(multiplyQuat(invertQuat(mirroredLegSourceRestRight), multiplyQuat(mirroredLegFlexion, mirroredLegSourceRestRight)), [0, -1, 0]);
assert.ok(oldOrderMirroredLeft[0]! > 0.65 && oldOrderMirroredRight[0]! < -0.65, "old retarget order would split mirrored leg flexion inward across the centerline");
assert.ok(mirroredLegActualLeft[2]! < -0.65 && Math.abs(mirroredLegActualLeft[0]!) < 1e-5, "left leg flexion should bend backward instead of inward");
assert.ok(vectorNearlyEqual(mirroredLegActualLeft, mirroredLegExpected, 1e-5), "left leg rendered direction should preserve source flexion axis");
assert.ok(vectorNearlyEqual(mirroredLegActualRight, mirroredLegExpected, 1e-5), "right leg rendered direction should preserve source flexion axis");

const motusLeftLowerLegRest: [number, number, number, number] = [-0.0344, 0.0344, -0.2013, 0.9783];
const motusLeftLowerLegInwardSample: [number, number, number, number] = [-0.1252, -0.0155, -0.5739, 0.8091];
const motusRightLowerLegRest: [number, number, number, number] = [-0.0266, -0.0186, -0.5677, 0.8226];
const motusRightLowerLegInwardSample: [number, number, number, number] = [-0.0164, 0.0277, -0.2138, 0.9763];
const motusLeftLowerLegRawDirection = rotateVec3ByQuat(retargetQuaternionSample(motusLeftLowerLegRest, [0, 0, 0, 1], motusLeftLowerLegInwardSample), [0, -1, 0]);
const motusRightLowerLegRawDirection = rotateVec3ByQuat(retargetQuaternionSample(motusRightLowerLegRest, [0, 0, 0, 1], motusRightLowerLegInwardSample), [0, -1, 0]);
const motusLeftLowerLegRetargetedDirection = rotateVec3ByQuat(
  retargetQuaternionSample(motusLeftLowerLegRest, [0, 0, 0, 1], motusLeftLowerLegInwardSample, "leftLowerLeg"),
  [0, -1, 0]
);
const motusRightLowerLegRetargetedDirection = rotateVec3ByQuat(
  retargetQuaternionSample(motusRightLowerLegRest, [0, 0, 0, 1], motusRightLowerLegInwardSample, "rightLowerLeg"),
  [0, -1, 0]
);
assert.ok(
  Math.abs(motusLeftLowerLegRawDirection[0]!) > 0.65 && Math.abs(motusRightLowerLegRawDirection[0]!) > 0.65,
  "Motus lower-leg fixture should reproduce the inward lateral knee bend before axis remap"
);
assert.ok(
  Math.abs(motusLeftLowerLegRetargetedDirection[0]!) < 0.25 && Math.abs(motusRightLowerLegRetargetedDirection[0]!) < 0.25,
  "Motus lower-leg retargeting should move knee bend out of the inward lateral axis"
);
assert.ok(
  Math.abs(motusLeftLowerLegRetargetedDirection[2]!) > 0.65 && Math.abs(motusRightLowerLegRetargetedDirection[2]!) > 0.65,
  "Motus lower-leg retargeting should preserve the authored knee bend on the sagittal axis"
);

const normalLowerLegRest: [number, number, number, number] = quatFromAxisAngle([1, 0, 0], Math.PI / 7);
const normalLowerLegSample = multiplyQuat(quatFromAxisAngle([1, 0, 0], Math.PI / 5), normalLowerLegRest);
assert.ok(
  quaternionNearlyEqual(
    retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample, "leftLowerLeg"),
    retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample),
    1e-5
  ),
  "lower-leg axis remap should not affect non-rolled source rests"
);

const mirroredLimbSourceRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const mirroredLimbSourceRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
const mirroredLimbTargetRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const mirroredLimbTargetRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
const mirroredLimbDelta = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const mirroredLimbBones = createMirroredLimbBones();
const mirroredLimbClip = createThreeAnimationClip(
  {
    id: "mirrored-limb-local-axis",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperArm",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLimbSourceRestLeft),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestLeft, ...multiplyQuat(mirroredLimbDelta, mirroredLimbSourceRestLeft)])
      },
      {
        humanBone: "rightUpperArm",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLimbSourceRestRight),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestRight, ...multiplyQuat(mirroredLimbDelta, mirroredLimbSourceRestRight)])
      }
    ]
  },
  {
    resolveBone: (bone) => {
      if (bone === "leftUpperArm") return mirroredLimbBones.leftUpperArm;
      if (bone === "rightUpperArm") return mirroredLimbBones.rightUpperArm;
      return null;
    }
  }
);
sampleThreeClipOnce(mirroredLimbBones.root, mirroredLimbClip);
const mirroredLimbActual = {
  left: readChildDirection(mirroredLimbBones.leftUpperArm, mirroredLimbBones.leftLowerArm),
  right: readChildDirection(mirroredLimbBones.rightUpperArm, mirroredLimbBones.rightLowerArm)
};
const mirroredLimbExpected = {
  left: rotateVec3ByQuat(multiplyQuat(mirroredLimbDelta, mirroredLimbTargetRestLeft), [0, 1, 0]),
  right: rotateVec3ByQuat(multiplyQuat(mirroredLimbDelta, mirroredLimbTargetRestRight), [0, 1, 0])
};
assert.ok(vectorNearlyEqual(mirroredLimbActual.left, mirroredLimbExpected.left, 1e-5), "left limb rendered direction should preserve target-local rotation axis");
assert.ok(vectorNearlyEqual(mirroredLimbActual.right, mirroredLimbExpected.right, 1e-5), "right limb rendered direction should preserve target-local rotation axis");

const authoredRotationBone = createNamedBone("head", normalizeQuat([0.3, 0, 0, 0.953939]));
const authoredRotationClip = createThreeAnimationClip(
  {
    id: "authored-local-rotation",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0.2, 0, 0.98])
      }
    ]
  },
  { resolveBone: (bone) => (bone === "head" ? authoredRotationBone : null) }
);
const authoredTrackValues = Array.from(authoredRotationClip.tracks[0]!.values as ArrayLike<number>);
assert.deepEqual(authoredTrackValues.slice(0, 4), [0, 0, 0, 1], "authored target-local rotations must not be pre-multiplied by target rest");
assert.ok(authoredTrackValues[5]! > 0.19, "authored target-local rotations should preserve sampled components");

const posedDuringAsyncLoadBone = createNamedBone("leftUpperLeg", quatFromAxisAngle([0, 0, 1], Math.PI / 2));
const explicitRestClip = createThreeAnimationClip(
  {
    id: "explicit-target-rest",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperLeg",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, 1])
      }
    ]
  },
  {
    resolveBone: (bone) => (bone === "leftUpperLeg" ? posedDuringAsyncLoadBone : null),
    targetRestQuaternion: () => [0, 0, 0, 1]
  }
);
const explicitRestValues = Array.from(explicitRestClip.tracks[0]!.values as ArrayLike<number>);
assert.deepEqual(
  explicitRestValues.slice(0, 4),
  [0, 0, 0, 1],
  "explicit target rest should prevent live async-loaded bone poses from being baked into retargeted tracks"
);

const look = distributeLookAt([0.4, 0.2, 2]);
assert.ok(look.head.yaw > 0);
assert.ok(look.eyes.pitch > 0);
assert.equal(Number.isFinite(breathingWeight(Number.NaN, 0.5)), true, "breathing weight should ignore non-finite elapsed time");

const presenceA = new PresencePlanner("presence-test", 0);
const presenceB = new PresencePlanner("presence-test", 0);
presenceA.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
presenceB.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
const deterministicPresenceInput = {
  nowMs: 260,
  elapsedSeconds: 1.25,
  deltaSeconds: 1 / 30,
  behavior: { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
  affect: { arousal: 0.45, curiosity: 0.6, attentiveness: 0.8 },
  targetMouth: 0.1,
  clipBaseInfluence: 0.8,
  clipOverlayInfluence: 0.1
};
const presenceFrameA = presenceA.update(deterministicPresenceInput);
const presenceFrameB = presenceB.update(deterministicPresenceInput);
assert.deepEqual(presenceFrameA.lookAtTarget, presenceFrameB.lookAtTarget);
assert.ok(presenceFrameA.cueAmounts.glance > 0);
assert.ok(presenceFrameA.boneTargets.some((target) => target.bone === "head" && target.influence > 0));
assert.ok(presenceFrameA.boneTargets.every((target) => target.rotation.every(Number.isFinite)));
const finitePresenceFrame = presenceA.update({
  nowMs: 300,
  elapsedSeconds: Number.NaN,
  deltaSeconds: Number.NaN,
  behavior: { state: "speaking", energy: Number.NaN },
  affect: { arousal: Number.NaN, curiosity: Number.NaN, attentiveness: Number.NaN },
  targetMouth: Number.NaN,
  clipBaseInfluence: Number.NaN,
  clipOverlayInfluence: Number.NaN
});
assert.ok(finitePresenceFrame.lookAtTarget.every(Number.isFinite), "presence look target should stay finite for non-finite timing");
assert.ok(finitePresenceFrame.boneTargets.every((target) => target.rotation.every(Number.isFinite)), "presence bone targets should stay finite for non-finite timing");

const ik = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
assert.ok(ik.targetReach > 0.9);
assert.ok(Number.isFinite(ik.joint[0]));
const finiteIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0, -1.5, 0], pole: [0, 0, 1], maxStretch: Number.NaN });
assert.ok(finiteIk.joint.every(Number.isFinite), "IK should keep solved joints finite for non-finite stretch limits");
const diagonalIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [1, -1, 0], pole: [0, 0, 1], soften: 0 });
assert.ok(
  Math.abs(Math.hypot(...diagonalIk.joint) - 1) < 1e-5,
  "IK projection should keep the solved joint on the upper-bone sphere for diagonal targets"
);

const fullReachIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0, -2, 0], pole: [0, 0, 1] });
assert.equal(fullReachIk.clamped, false, "default IK softening must not report a physical reach clamp at full extension");
assert.ok(Math.abs(fullReachIk.targetReach - 1) < 1e-5, "physically reachable targets should report full target reach");
assert.ok(fullReachIk.solvedReach < 1, "default IK softening may still keep the solved endpoint short of full extension");
assert.equal(fullReachIk.stretchLimited, true);

const stretchLimitedIk = solveTwoBoneIk({
  root: [0, 0, 0],
  joint: [0, -1, 0],
  end: [0, -2, 0],
  target: [0, -1.5, 0],
  pole: [0, 0, 1],
  maxStretch: 0.5
});
assert.equal(stretchLimitedIk.clamped, false, "explicit stretch limits should not be mislabeled as physical reach clamps");
assert.equal(stretchLimitedIk.stretchLimited, true);
assert.ok(stretchLimitedIk.solvedReach < 0.7, "explicit stretch limit should still shorten the solved endpoint");
assert.ok(Math.abs(stretchLimitedIk.targetReach - 1) < 1e-5);

const ikCorrections = solveTwoBoneIkCorrections({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
const correctedUpper = rotateVec3ByQuat(ikCorrections.rootCorrection, [0, -1, 0]);
assert.ok(Math.hypot(correctedUpper[0] - ikCorrections.correctedUpperDirection[0], correctedUpper[1] - ikCorrections.correctedUpperDirection[1], correctedUpper[2] - ikCorrections.correctedUpperDirection[2]) < 1e-5);
assert.ok(Math.abs(Math.hypot(...ikCorrections.rootCorrection) - 1) < 1e-5);
assert.ok(Math.abs(Math.hypot(...ikCorrections.jointCorrection) - 1) < 1e-5);

const nonOrthogonalPoleIk = solveTwoBoneIk({
  root: [0, 0, 0],
  joint: [0, -1, 0],
  end: [0, -2, 0],
  target: [0, -1.5, 0],
  pole: [0, -1, 1]
});
assert.ok(Math.abs(Math.hypot(...nonOrthogonalPoleIk.joint) - 1) < 1e-5, "IK bend pole must not change the upper bone length");

const footPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: [-0.1, 1, 0],
      knee: [-0.1, 0.55, 0.02],
      ankle: [-0.1, 0.18, 0],
      ground: { point: [-0.1, 0, 0], normal: [0, 1, 0], rayStart: [-0.1, 0.68, 0] }
    },
    {
      id: "right",
      hip: [0.1, 1, 0],
      knee: [0.1, 0.6, 0.02],
      ankle: [0.1, 0.08, 0],
      ground: { point: [0.1, 0, 0], normal: [0, 1, 0], rayStart: [0.1, 0.58, 0] }
    }
  ],
  { footHeight: 0.08 }
);
assert.equal(footPlant.plantedCount, 2);
assert.ok(footPlant.pelvisOffset[1] < 0);
assert.ok(footPlant.legs.every((leg) => leg.ik && Number.isFinite(leg.ik.joint[1])));
assert.ok(footPlant.legs.every((leg) => leg.ik && Math.abs(Math.hypot(...leg.ik.rootCorrection) - 1) < 1e-5));

const fullReachFootPlant = solveFootPlant(
  [{ id: "left", hip: [0, 0, 0], knee: [0, -1, 0], ankle: [0, -1.9, 0], ground: { point: [0, -2.08, 0], normal: [0, 1, 0] } }],
  { footHeight: 0.08, maxAnkleCorrection: 0.5 }
);
assert.equal(fullReachFootPlant.legs[0]!.ik?.clamped, false);
assert.equal(fullReachFootPlant.legs[0]!.ik?.stretchLimited, true);
assert.ok(!fullReachFootPlant.issues.includes("left: ik target reach clamped"), "default IK softening must not emit foot-plant reach clamp issues");

const missingGroundPlant = solveFootPlant([{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.1, 0] }]);
assert.equal(missingGroundPlant.plantedCount, 0);
assert.equal(missingGroundPlant.legs[0]!.skippedReason, "missing-ground-contact");

const clampedFootPlant = solveFootPlant(
  [{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.4, 0], ground: { point: [0, -1, 0], normal: [0, 1, 0] } }],
  { footHeight: 0.08, maxAnkleCorrection: 0.1 }
);
assert.equal(clampedFootPlant.legs[0]!.clamped, true);
assert.ok(clampedFootPlant.legs[0]!.correctionDistance <= 0.1001);
const finiteFootPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: [0, 1, 0],
      knee: [0, 0.5, 0],
      ankle: [0, 0.1, 0],
      footHeight: Number.NaN,
      maxAnkleCorrection: Number.NaN,
      maxStretch: Number.NaN,
      ground: { point: [0, 0, 0], normal: [0, 1, 0] }
    }
  ],
  { footHeight: Number.NaN, maxAnkleCorrection: Number.NaN, maxPelvisOffset: Number.NaN, maxStretch: Number.NaN }
);
assert.ok(finiteFootPlant.pelvisOffset.every(Number.isFinite), "foot plant pelvis offset should stay finite for non-finite options");
assert.ok(finiteFootPlant.legs.every((leg) => leg.targetAnkle.every(Number.isFinite) && (leg.ik?.joint.every(Number.isFinite) ?? true)), "foot plant leg outputs should stay finite for non-finite options");

const pelvisBone = new Object3D();
pelvisBone.name = "hips";
const leftHipBone = new Object3D();
leftHipBone.name = "leftUpperLeg";
const leftKneeBone = new Object3D();
leftKneeBone.name = "leftLowerLeg";
const leftAnkleBone = new Object3D();
leftAnkleBone.name = "leftFoot";
pelvisBone.add(leftHipBone);
leftHipBone.add(leftKneeBone);
leftKneeBone.add(leftAnkleBone);
pelvisBone.updateMatrixWorld(true);
const footPlantApply = applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) =>
    ({
      hips: pelvisBone,
      leftUpperLeg: leftHipBone,
      leftLowerLeg: leftKneeBone,
      leftFoot: leftAnkleBone
    })[bone] ?? null,
  pelvis: "hips",
  legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot" }],
  applyPelvis: true,
  applyLegIk: true
});
assert.equal(footPlantApply.applied, true);
assert.equal(footPlantApply.pelvisApplied, true);
assert.ok(pelvisBone.position.y < 0);
assert.ok(Math.abs(leftHipBone.quaternion.w) < 0.99999 || Math.abs(leftKneeBone.quaternion.w) < 0.99999);
const firstPelvisY = pelvisBone.position.y;
applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) => ({ hips: pelvisBone })[bone] ?? null,
  pelvis: "hips",
  legs: [],
  applyPelvis: true,
  applyLegIk: false
});
assert.ok(Math.abs(pelvisBone.position.y - firstPelvisY) < 1e-6);
const clearedFootPlant = clearThreeFootPlantOffsets({
  resolveBone: (bone) => ({ hips: pelvisBone })[bone] ?? null,
  pelvis: "hips"
});
assert.equal(clearedFootPlant.cleared, true);
assert.ok(Math.abs(pelvisBone.position.y) < 1e-6);
const fallbackSpeedPelvis = new Object3D();
fallbackSpeedPelvis.name = "hips";
const fallbackSpeedFootPlant = applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) => (bone === "hips" ? fallbackSpeedPelvis : null),
  pelvis: "hips",
  legs: [],
  deltaSeconds: 1 / 30,
  speed: Number.NaN,
  applyPelvis: true,
  applyLegIk: false
});
assert.equal(fallbackSpeedFootPlant.pelvisApplied, true, "Three foot plant application should fall back from non-finite speeds");
assert.ok(fallbackSpeedFootPlant.pelvisOffsetLocal.every(Number.isFinite), "Three foot plant fallback offsets should remain finite");
const nonFiniteDeltaPelvis = new Object3D();
nonFiniteDeltaPelvis.name = "hips";
const nonFiniteDeltaFootPlant = applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) => (bone === "hips" ? nonFiniteDeltaPelvis : null),
  pelvis: "hips",
  legs: [],
  deltaSeconds: Number.NaN,
  applyPelvis: true,
  applyLegIk: false
});
assert.equal(nonFiniteDeltaFootPlant.pelvisApplied, false, "Three foot plant damping should treat non-finite delta time as zero elapsed time");
assert.deepEqual(nonFiniteDeltaFootPlant.pelvisOffsetLocal, [0, 0, 0]);

const visemes = new VisemeMixer({ maxTotal: 0.4 });
visemes.setTarget({ aa: 0.4, ou: 0.4 });
const mixed = visemes.update(1 / 30);
assert.ok(mixed.aa + mixed.ou <= 0.4001);
assert.deepEqual(limitVisemeStack({ aa: 0.2, ih: 0.2, ou: 0.2, ee: 0.2, oh: 0.2 }, Number.NaN), zeroVisemes());
const invalidVisemes = new VisemeMixer({ maxTotal: Number.NaN });
invalidVisemes.setTarget({ aa: 1, ih: 1 });
assert.ok(Object.values(invalidVisemes.update(Number.NaN)).every(Number.isFinite), "viseme mixer should keep weights finite for non-finite timing and limits");
const invalidIntensityVisemes = new VisemeMixer({ intensity: Number.NaN });
invalidIntensityVisemes.setTarget({ aa: 1 });
assert.ok(Object.values(invalidIntensityVisemes.update(1 / 30)).every(Number.isFinite), "viseme mixer should keep weights finite for non-finite intensity");

const blink = new BlinkScheduler("test", 0);
assert.equal(Number.isFinite(blink.update(16, 1 / 60, 0.5)), true);
blink.trigger(32, 100);
assert.equal(blink.update(48, 1 / 60, 0.5), 1);
assert.equal(Number.isFinite(blink.update(200, Number.NaN, 0.5)), true, "blink scheduler should ignore non-finite delta time");
assert.equal(blink.update(216, Number.NaN, 0.5), blink.update(216, Number.NaN, 0.5), "blink scheduler should keep non-finite delta decay deterministic");

const facial = new FacialExpressionMixer({
  visemes: {
    maxTotal: 0.42,
    attack: { aa: 30, ih: 34, ou: 28, ee: 34, oh: 28 },
    release: { aa: 20, ih: 24, ou: 18, ee: 24, oh: 18 }
  }
});
facial.setTarget({ targetMouth: 0.3, targetVisemes: { aa: 0.3, ee: 0.2 } });
const faceState = facial.update(1 / 30, {
  talking: true,
  blink: 1,
  mood: "warm",
  emotion: "happy",
  state: "speaking",
  energy: 0.6,
  rapport: 0.5,
  cueSmile: 0.2
});
assert.ok(faceState.mouthLevel > 0);
assert.ok(faceState.visemes.aa + faceState.visemes.ee <= 0.4201);
assert.equal(faceState.expressions.blink, 1);
assert.ok(faceState.expressions.happy > 0.1);

const metric = poseRotationMetric(skeleton.restPose, evaluated.localPose);
assert.ok(metric.maxRotationDelta > 0);
const signEquivalentPose = clonePose(skeleton.restPose);
signEquivalentPose[2]!.rotation = signEquivalentPose[2]!.rotation.map((component) => -component) as [number, number, number, number];
assert.equal(
  poseRotationMetric(skeleton.restPose, signEquivalentPose).maxRotationDelta,
  0,
  "pose rotation metrics should treat sign-opposite quaternions as equivalent rotations"
);

const headBone = new Object3D();
headBone.name = "normalizedHead";
const threeClip = createThreeAnimationClip(nodClip, {
  resolveBone: (humanBone) => (humanBone === "head" ? headBone : null)
});
assert.equal(threeClip.name, "nod");
assert.equal(threeClip.tracks.length, 1);
assert.equal(threeClip.tracks[0]!.name, `${headBone.uuid}.quaternion`);
const nonFiniteDurationClip = createThreeAnimationClip(
  { ...nodClip, id: "non-finite-duration", duration: Number.NaN },
  {
    resolveBone: (humanBone) => (humanBone === "head" ? headBone : null)
  }
);
assert.equal(Number.isFinite(nonFiniteDurationClip.duration), true, "Three clip creation should not emit non-finite durations");

const duplicateRoot = new Object3D();
const duplicateWrongBone = new Object3D();
duplicateWrongBone.name = "duplicateHead";
const duplicateTargetBone = new Object3D();
duplicateTargetBone.name = "duplicateHead";
duplicateRoot.add(duplicateWrongBone);
duplicateRoot.add(duplicateTargetBone);
const duplicateBoundClip = createThreeAnimationClip(nodClip, {
  resolveBone: (humanBone) => (humanBone === "head" ? duplicateTargetBone : null)
});
const duplicateMixer = new AnimationMixer(duplicateRoot);
const duplicateAction = duplicateMixer.clipAction(duplicateBoundClip);
duplicateAction.setLoop(LoopOnce, 1);
duplicateAction.play();
duplicateMixer.setTime(0.5);
assert.ok(Math.abs(duplicateWrongBone.quaternion.x) < 1e-6, "uuid binding should not animate the first same-named node");
assert.ok(Math.abs(duplicateTargetBone.quaternion.x) > 0.1, "uuid binding should animate the resolved target bone");

const root = new Object3D();
const mixer = new AnimationMixer(root);
const runtimeClips = createThreeRuntimeClipsForEntry(
  { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true },
  mixer,
  threeClip
);
assert.equal(runtimeClips.length, 2);
assert.equal(runtimeClips[0]!.lane, "base");
assert.equal(runtimeClips[1]!.instance, 1);

assert.equal(calculateThreeRuntimeStartTime(-1, { startTime: 4 }), 0);
assert.equal(calculateThreeRuntimeStartTime(2, { startTime: -0.25 }), 0);
assert.equal(calculateThreeRuntimeStartTime(2, { startTime: 2.25 }), 0.25);
assert.equal(
  calculateThreeRuntimeStartTime(4, { matchPhaseFrom: { action: { time: 1.5 }, duration: 3 }, random: () => 0.9 }),
  2
);
assert.equal(calculateThreeRuntimeStartTime(4, { random: () => 0.25 }), 1);
assert.equal(calculateThreeRuntimeStartTime(4, { random: () => Number.NaN }), 0);
assert.equal(calculateThreeRuntimeStartTime(4, { randomizeBaseTime: false }), 0);

const preparedBaseAction = makeRuntimeActionStub(0.75);
const preparedBaseClip = makeRuntimeClipDiagnosticStub({
  id: "prepared-base",
  label: "Prepared Base",
  lane: "base",
  weight: 0,
  targetWeight: 0,
  time: 0,
  duration: 4,
  scheduled: false,
  running: false,
  action: preparedBaseAction
});
const preparedStartTime = prepareThreeRuntimeAction(preparedBaseClip, {
  matchPhaseFrom: { action: { time: 1.5 }, duration: 3 },
  weight: 2,
  timeScale: Number.NaN
});
assert.equal(preparedStartTime, 2);
assert.equal(preparedBaseAction.time, 2);
assert.equal(preparedBaseAction.enabled, true);
assert.equal(preparedBaseAction.paused, false);
assert.equal(preparedBaseAction.effectiveWeight, 1);
assert.equal(preparedBaseAction.effectiveTimeScale, 1);
assert.equal(preparedBaseAction.resetCount, 1);
assert.equal(preparedBaseAction.playCount, 1);
assert.equal(preparedBaseAction.stopFadingCount, 1);
assert.equal(preparedBaseAction.stopWarpingCount, 1);

const preparedOverlayAction = makeRuntimeActionStub(0);
const preparedOverlayClip = makeRuntimeClipDiagnosticStub({
  id: "prepared-overlay",
  label: "Prepared Overlay",
  lane: "overlay",
  weight: 0,
  targetWeight: 0,
  time: 0,
  duration: 1,
  scheduled: false,
  running: false,
  action: preparedOverlayAction
});
assert.equal(prepareThreeRuntimeAction(preparedOverlayClip, { startTime: 0.8, weight: -1, timeScale: 1.25 }), 0);
assert.equal(preparedOverlayAction.time, 0);
assert.equal(preparedOverlayAction.effectiveWeight, 0);
assert.equal(preparedOverlayAction.effectiveTimeScale, 1.25);

assert.equal(calculateThreeBaseLoopSeamWindow(Number.NaN), 0.32);
assert.equal(calculateThreeBaseLoopSeamWindow(2), 0.36);
assert.equal(calculateThreeBaseLoopSeamWindow(10), 0.72);
const transitionWeights = calculateThreeBaseLoopTransitionWeights({ elapsed: 0.5, duration: 1, fromWeight: 0.8, toWeight: 0.5 });
assert.ok(Math.abs(transitionWeights.progress - 0.5) < 1e-6);
assert.ok(Math.abs(transitionWeights.fromWeight - 0.4) < 1e-6);
assert.ok(Math.abs(transitionWeights.toWeight - 0.25) < 1e-6);
assert.equal(calculateThreeBaseLoopTransitionWeights({ elapsed: Number.NaN, duration: -1, fromWeight: 1, toWeight: 1 }).progress, 0);
assert.equal(calculateThreeBaseLoopTransitionWeights({ elapsed: 2, duration: 1, fromWeight: 1, toWeight: 1 }).complete, true);

const overlayFadeIn = calculateThreeOverlayFade({
  time: 0.25,
  duration: 2,
  currentWeight: 0,
  targetWeight: 0.8,
  deltaSeconds: Math.log(2) / 6.5
});
assert.equal(overlayFadeIn.fadingOut, false);
assert.equal(overlayFadeIn.targetWeight, 0.8);
assert.ok(Math.abs(overlayFadeIn.nextWeight - 0.4) < 1e-6);
const overlayFadeOut = calculateThreeOverlayFade({
  time: 1.7,
  duration: 2,
  currentWeight: 0.5,
  targetWeight: 0.8,
  deltaSeconds: Math.log(2) / 5.5
});
assert.equal(overlayFadeOut.fadeOutWindow, 0.42);
assert.equal(overlayFadeOut.fadingOut, true);
assert.equal(overlayFadeOut.targetWeight, 0);
assert.ok(Math.abs(overlayFadeOut.nextWeight - 0.25) < 1e-6);
assert.equal(
  calculateThreeOverlayFade({ time: 2, duration: 2, currentWeight: 0.005, targetWeight: 1, deltaSeconds: 0 }).shouldStop,
  true
);

const diagnosticBase = makeRuntimeClipDiagnosticStub({
  id: "bad-base",
  label: "Bad Base",
  lane: "base",
  weight: Number.POSITIVE_INFINITY,
  targetWeight: Number.NaN,
  time: Number.NaN,
  duration: Number.NEGATIVE_INFINITY,
  scheduled: true,
  running: true,
  instance: Number.NaN,
  states: ["idle"]
});
const diagnosticOverlay = makeRuntimeClipDiagnosticStub({
  id: "overlay",
  label: "Overlay",
  lane: "overlay",
  weight: 0.4,
  targetWeight: 2,
  time: 0.25,
  duration: 1.2,
  scheduled: false,
  running: false,
  gestures: ["wave"],
  source: { library: "test" }
});
const diagnosticDebug = makeRuntimeClipDiagnosticStub({
  id: "debug",
  label: "Debug",
  lane: "debug",
  weight: 0.65,
  targetWeight: 1,
  time: Number.POSITIVE_INFINITY,
  duration: 2,
  scheduled: false,
  running: true
});
const diagnosticSnapshot = readThreeRuntimeClipSnapshot(diagnosticBase, { loop: "seamed-once" });
assert.equal(diagnosticSnapshot.weight, 0);
assert.equal(diagnosticSnapshot.targetWeight, 0);
assert.equal(diagnosticSnapshot.time, 0);
assert.equal(diagnosticSnapshot.duration, 0);
assert.equal(diagnosticSnapshot.instance, 0);
assert.equal(diagnosticSnapshot.loop, "seamed-once");
assert.deepEqual(diagnosticSnapshot.states, ["idle"]);
diagnosticSnapshot.states.push("mutated");
assert.deepEqual(diagnosticBase.states, ["idle"], "snapshot metadata arrays should be detached from manifest metadata");

const activeSnapshots = readActiveThreeRuntimeClipSnapshots([diagnosticBase, diagnosticOverlay, diagnosticDebug], { debugLoop: "loop" });
assert.deepEqual(activeSnapshots.map((clip) => [clip.sourceId, clip.lane, clip.loop]), [
  ["bad-base", "base", "seamed-once"],
  ["overlay", "overlay", "once"],
  ["debug", "debug", "loop"]
]);
assert.equal(activeSnapshots[1]!.targetWeight, 1);
assert.equal(activeSnapshots[1]!.source?.library, "test");
assert.equal(activeSnapshots[2]!.time, 0);

assert.deepEqual(calculateThreeRuntimeInfluence([diagnosticBase, diagnosticOverlay], { debugWeight: 0.8 }), { base: 0, overlay: 0.8, debug: 0.8 });
assert.deepEqual(calculateThreeRuntimeInfluence([diagnosticOverlay, diagnosticDebug], { includeDebugAsOverlay: false }), { base: 0, overlay: 0.4, debug: 0.65 });

console.log("waifu-animation tests passed");

function assertFiniteEvaluation(evaluation: ReturnType<AnimationRuntime["evaluate"]>): void {
  for (const transform of evaluation.localPose) {
    assert.ok(transform.translation.every(Number.isFinite));
    assert.ok(transform.rotation.every(Number.isFinite));
    assert.ok(transform.scale.every(Number.isFinite));
  }
  for (const matrix of evaluation.modelPose) {
    assert.ok(Array.from(matrix).every(Number.isFinite));
  }
}

function makeSourceRestQuaternionClip(id: string, track: Partial<AnimationClip["tracks"][number]> = {}): AnimationClip {
  return {
    id,
    duration: 1,
    tracks: [makeSourceRestQuaternionTrack(track)]
  };
}

function makeSourceRestQuaternionTrack(track: Partial<AnimationClip["tracks"][number]> = {}): AnimationClip["tracks"][number] {
  const { humanBone = "head", joint, property = "quaternion", sourceRestQuaternion = [0, 0, 0, 1], times = [0], values = [0, 0, 0, 1] } = track;
  return {
    ...(joint === undefined ? { humanBone } : { joint }),
    property,
    sourceRestQuaternion: toFloat32Array(sourceRestQuaternion),
    times: toFloat32Array(times),
    values: toFloat32Array(values)
  };
}

function makeTransformTrack(humanBone: string, property: "position" | "translation" | "quaternion", values: number[], times = [0]): AnimationClip["tracks"][number] {
  return { humanBone, property, times: toFloat32Array(times), values: toFloat32Array(values) };
}

function makeAuthoredLoopClip(id: string, tracks: readonly string[]): AnimationClip {
  return {
    id,
    duration: 1,
    loop: true,
    tracks: tracks.map((track) => {
      const [humanBone, property = "quaternion"] = track.split(".") as [string, "position" | "quaternion" | undefined];
      return property === "position"
        ? makeTransformTrack(humanBone, "position", [0, 0, 0, 0, 0, 1], [0, 1])
        : makeTransformTrack(humanBone, "quaternion", [0, 0, 0, 1, 0, 0, 0, 1], [0, 1]);
    })
  };
}

function attachArmChain(root: Object3D, bones: Map<string, Object3D>, side: "left" | "right", sign: 1 | -1): void {
  const upper = bones.get(`${side}UpperArm`)!;
  const lower = bones.get(`${side}LowerArm`)!;
  const hand = bones.get(`${side}Hand`)!;
  upper.position.set(sign * 0.24, 1.38, 0);
  lower.position.set(sign * 0.53, 0.98, 0);
  hand.position.set(sign * 0.72, 0.58, 0);
  root.add(upper);
  upper.add(lower);
  lower.add(hand);
}

function makeRuntimeClipDiagnosticStub(options: {
  id: string;
  label: string;
  lane: "base" | "overlay" | "debug";
  weight: number;
  targetWeight: number;
  time: number;
  duration: number;
  scheduled: boolean;
  running: boolean;
  instance?: number;
  states?: string[];
  emotions?: string[];
  gestures?: string[];
  source?: Record<string, unknown>;
  action?: ReturnType<typeof makeRuntimeActionStub>;
}) {
  const action =
    options.action ??
    ({
      time: options.time,
      getEffectiveWeight: () => options.weight,
      isRunning: () => options.running,
      isScheduled: () => options.scheduled
    } as const);
  return {
    id: options.id,
    label: options.label,
    url: `/${options.id}.waifuanim.bin`,
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    sourceId: options.id,
    instance: options.instance ?? 0,
    action,
    duration: options.duration,
    targetWeight: options.targetWeight,
    lastTriggeredAt: 0,
    lane: options.lane,
    ...(options.states ? { states: options.states } : {}),
    ...(options.emotions ? { emotions: options.emotions } : {}),
    ...(options.gestures ? { gestures: options.gestures } : {}),
    ...(options.source ? { source: options.source } : {})
  } as const;
}

function makeRuntimeActionStub(initialWeight: number) {
  return {
    time: 0,
    enabled: false,
    paused: true,
    effectiveWeight: initialWeight,
    effectiveTimeScale: 0,
    resetCount: 0,
    playCount: 0,
    stopFadingCount: 0,
    stopWarpingCount: 0,
    reset() {
      this.resetCount += 1;
      this.time = 0;
      return this;
    },
    play() {
      this.playCount += 1;
      return this;
    },
    stopFading() {
      this.stopFadingCount += 1;
      return this;
    },
    stopWarping() {
      this.stopWarpingCount += 1;
      return this;
    },
    setEffectiveTimeScale(value: number) {
      this.effectiveTimeScale = value;
      return this;
    },
    setEffectiveWeight(value: number) {
      this.effectiveWeight = value;
      return this;
    },
    getEffectiveWeight() {
      return this.effectiveWeight;
    },
    isRunning() {
      return false;
    },
    isScheduled() {
      return false;
    }
  };
}

function createMirroredLimbBones() {
  const root = new Object3D();
  root.name = "mirroredLimbRoot";

  const leftUpperArm = new Object3D();
  leftUpperArm.name = "leftUpperArm";
  leftUpperArm.quaternion.fromArray(mirroredLimbTargetRestLeft);
  root.add(leftUpperArm);

  const leftLowerArm = new Object3D();
  leftLowerArm.name = "leftLowerArm";
  leftLowerArm.position.set(0, 1, 0);
  leftUpperArm.add(leftLowerArm);

  const rightUpperArm = new Object3D();
  rightUpperArm.name = "rightUpperArm";
  rightUpperArm.quaternion.fromArray(mirroredLimbTargetRestRight);
  root.add(rightUpperArm);

  const rightLowerArm = new Object3D();
  rightLowerArm.name = "rightLowerArm";
  rightLowerArm.position.set(0, 1, 0);
  rightUpperArm.add(rightLowerArm);

  root.updateMatrixWorld(true);
  return { root, leftUpperArm, leftLowerArm, rightUpperArm, rightLowerArm };
}

function createSingleLimbBones(targetRest: readonly number[], upperName = "leftUpperArm", lowerName = "leftLowerArm", lowerOffset: readonly number[] = [0, 1, 0]) {
  const root = new Object3D();
  root.name = "singleLimbRoot";

  const upper = new Object3D();
  upper.name = upperName;
  upper.quaternion.fromArray(targetRest);
  root.add(upper);

  const lower = new Object3D();
  lower.name = lowerName;
  lower.position.set(lowerOffset[0] ?? 0, lowerOffset[1] ?? 1, lowerOffset[2] ?? 0);
  upper.add(lower);

  root.updateMatrixWorld(true);
  return { root, upper, lower };
}

function createNamedBone(name: string, rotation: readonly number[]): Object3D {
  const bone = new Object3D();
  bone.name = name;
  bone.quaternion.fromArray(rotation);
  return bone;
}

function sampleThreeClipOnce(root: Object3D, clip: ReturnType<typeof createThreeAnimationClip>, time = 1): void {
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  root.updateMatrixWorld(true);
}

function readChildDirection(parent: Object3D, child: Object3D): [number, number, number] {
  const parentWorld = new Vector3();
  const childWorld = new Vector3();
  parent.getWorldPosition(parentWorld);
  child.getWorldPosition(childWorld);
  childWorld.sub(parentWorld).normalize();
  return [childWorld.x, childWorld.y, childWorld.z];
}

function vectorNearlyEqual(actual: readonly number[], expected: readonly number[], tolerance: number): boolean {
  return (
    Math.abs(actual[0]! - expected[0]!) <= tolerance &&
    Math.abs(actual[1]! - expected[1]!) <= tolerance &&
    Math.abs(actual[2]! - expected[2]!) <= tolerance
  );
}

function quaternionNearlyEqual(actual: readonly number[], expected: readonly number[], tolerance: number): boolean {
  const direct =
    Math.abs(actual[0]! - expected[0]!) <= tolerance &&
    Math.abs(actual[1]! - expected[1]!) <= tolerance &&
    Math.abs(actual[2]! - expected[2]!) <= tolerance &&
    Math.abs(actual[3]! - expected[3]!) <= tolerance;
  const negated =
    Math.abs(actual[0]! + expected[0]!) <= tolerance &&
    Math.abs(actual[1]! + expected[1]!) <= tolerance &&
    Math.abs(actual[2]! + expected[2]!) <= tolerance &&
    Math.abs(actual[3]! + expected[3]!) <= tolerance;
  return direct || negated;
}
