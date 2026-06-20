import assert from "node:assert/strict";
import { AnimationMixer, LoopOnce, Object3D, Quaternion, Vector3 } from "three";
import {
  AnimationRuntime,
  type AnimationManifest,
  type AnimationClip,
  type Pose,
  type SampleRepairDiagnostic,
  type Skeleton,
  AttentionScheduler,
  BlinkScheduler,
  dampAlpha,
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
  composeMat4,
  computeBoundAttachmentTransform,
  computeBoundAttachmentTransforms,
  computeAttachmentTransform,
  computeSkeletonAttachmentTransform,
  createAttachmentBinding,
  createAttachmentBindings,
  createThreeLocomotionUpperBodyTargets,
  createJointMask,
  DEFAULT_BLEND_THRESHOLD,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  calculateThreeRuntimeInfluence,
  createSubtreeJointMask,
  decodeAnimationBinary,
  encodeAnimationBinary,
  NO_PARENT,
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
  AUTHORED_BASE_TRACK_POLICY,
  AUTHORED_BASE_SOURCE_TRACK_POLICY,
  BASE_PROCEDURAL_TRACK_POLICY,
  BASE_PROCEDURAL_SOURCE_TRACK_POLICY,
  LOCOMOTION_BASE_SOURCE_TRACK_POLICY,
  ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY,
  inspectAnimationAsset,
  inspectClipAsset,
  identityTransform,
  isHumanoidBoneName,
  localToModelPose,
  multiplyMat4,
  normalizeQuat,
  normalizeTransform,
  normalizeVec3,
  poseDeltaMetric,
  poseRotationMetric,
  quatFromAxisAngle,
  quatFromUnitVectors,
  rotateVec3ByQuat,
  multiplyQuat,
  invertQuat,
  diagnoseRetargetingRestAxes,
  retargetQuaternionSample,
  retargetQuaternionTrackValues,
  sampleMotionCarrier,
  sampleMotionIntervalDelta,
  sampleClipToPose,
  sampleTrack,
  sanitizeQuaternionTrackValues,
  solveFootPlant,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  toFloat32Array,
  transformPoint,
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
const explicitRootSkeleton = createSkeleton([
  { name: "hips", parentIndex: NO_PARENT },
  { name: "spine", parentIndex: 0 },
  { name: "detached", parentIndex: NO_PARENT }
]);
assert.equal(explicitRootSkeleton.joints[0]!.parentIndex, NO_PARENT);
assert.equal(explicitRootSkeleton.joints[2]!.parentIndex, NO_PARENT);
assert.throws(
  () => createSkeleton([{ name: "root", parentIndex: Number.NaN }]),
  /joint root parent index must be an integer/,
  "createSkeleton should reject NaN parent indices"
);
assert.throws(
  () =>
    createSkeleton([
      { name: "root" },
      { name: "child", parentIndex: 0.5 }
    ]),
  /joint child parent index must be an integer/,
  "createSkeleton should reject non-integer parent indices"
);
assert.throws(
  () => createSkeleton([{ name: "root", parentIndex: NO_PARENT - 1 }]),
  /joint root parent index is invalid/,
  "createSkeleton should reject parent indices below NO_PARENT"
);
assert.throws(
  () => createSkeleton([{ name: "root", parentIndex: 0 }]),
  /joint root parent must appear before child/,
  "createSkeleton should reject self parent indices"
);
assert.throws(
  () =>
    createSkeleton([
      { name: "root" },
      { name: "child", parentIndex: 2 },
      { name: "futureParent", parentIndex: 0 }
    ]),
  /joint child parent must appear before child/,
  "createSkeleton should reject future parent indices"
);
assert.throws(
  () =>
    createSkeleton([
      { name: "hips", humanoid: "hips" },
      { name: "pelvis", humanoid: "hips" }
    ]),
  /duplicate humanoid bone hips on joints hips and pelvis/,
  "createSkeleton should reject duplicate humanoid bone assignments"
);
assert.throws(
  () => createSkeleton([{ name: "root", humanoid: "pelvis" } as unknown as Parameters<typeof createSkeleton>[0][number]]),
  /joint root has invalid humanoid bone pelvis/,
  "createSkeleton should reject invalid humanoid bone identifiers from runtime input"
);
assert.equal(isHumanoidBoneName("head"), true, "known VRM humanoid names should pass the runtime guard");
assert.equal(isHumanoidBoneName("pelvis"), false, "unknown humanoid names should fail the runtime guard");
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
const invalidJointHumanoidSkeleton = {
  ...skeleton,
  joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, humanoid: "pelvis" } : joint))
};
assert.ok(
  validateSkeleton(invalidJointHumanoidSkeleton).some(
    (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "joint has invalid humanoid bone pelvis"
  ),
  "validateSkeleton should report invalid humanoid bone identifiers on joints"
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
const invalidHumanoidMapSkeleton = {
  ...skeleton,
  humanoid: new Map([
    ["hips", 0],
    ["spine", 1],
    ["head", 2],
    ["pelvis", 0]
  ])
};
assert.ok(
  validateSkeleton(invalidHumanoidMapSkeleton).some((issue) => issue.message === "humanoid map entry pelvis has invalid humanoid bone name"),
  "validateSkeleton should report invalid humanoid map entry names"
);
const validHumanoidHierarchySkeleton = createSkeleton([
  { name: "hips", humanoid: "hips" },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "chest", parentName: "spine", humanoid: "chest" },
  { name: "neck", parentName: "chest", humanoid: "neck" },
  { name: "head", parentName: "neck", humanoid: "head" },
  { name: "leftShoulder", parentName: "chest", humanoid: "leftShoulder" },
  { name: "leftUpperArm", parentName: "leftShoulder", humanoid: "leftUpperArm" },
  { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm" },
  { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand" },
  { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg" },
  { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg" },
  { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot" }
]);
assert.deepEqual(validateSkeleton(validHumanoidHierarchySkeleton), [], "validateSkeleton should accept a coherent humanoid hierarchy");
const invalidHumanoidHierarchySkeleton = createSkeleton([
  { name: "hips", humanoid: "hips" },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "chest", parentName: "spine", humanoid: "chest" },
  { name: "neck", parentName: "chest", humanoid: "neck" },
  { name: "head", parentName: "hips", humanoid: "head" },
  { name: "leftUpperArm", parentName: "chest", humanoid: "leftUpperArm" },
  { name: "leftLowerArm", parentName: "hips", humanoid: "leftLowerArm" },
  { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg" },
  { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg" },
  { name: "rightFoot", parentName: "hips", humanoid: "rightFoot" }
]);
const invalidHumanoidHierarchyIssues = validateSkeleton(invalidHumanoidHierarchySkeleton);
assert.ok(
  invalidHumanoidHierarchyIssues.some(
    (issue) => issue.index === 4 && issue.joint === "head" && issue.message === "humanoid bone head must be a descendant of neck"
  ),
  "validateSkeleton should report head mappings outside the neck chain"
);
assert.ok(
  invalidHumanoidHierarchyIssues.some(
    (issue) => issue.index === 6 && issue.joint === "leftLowerArm" && issue.message === "humanoid bone leftLowerArm must be a descendant of leftUpperArm"
  ),
  "validateSkeleton should report lower-arm mappings outside the upper-arm chain"
);
assert.ok(
  invalidHumanoidHierarchyIssues.some(
    (issue) => issue.index === 9 && issue.joint === "rightFoot" && issue.message === "humanoid bone rightFoot must be a descendant of rightLowerLeg"
  ),
  "validateSkeleton should report foot mappings outside the lower-leg chain"
);
const optionalMissingHumanoidHierarchySkeleton = createSkeleton([
  { name: "hips", humanoid: "hips" },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "head", parentName: "spine", humanoid: "head" },
  { name: "leftLowerArm", parentName: "spine", humanoid: "leftLowerArm" },
  { name: "rightFoot", parentName: "hips", humanoid: "rightFoot" }
]);
assert.deepEqual(
  validateSkeleton(optionalMissingHumanoidHierarchySkeleton),
  [],
  "validateSkeleton should not require optional humanoid parent bones before checking hierarchy"
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
    { id: "accepted", label: "Accepted", url: "/accepted.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: "accepted" } },
    { id: "invalid-root-motion-policy", label: "Invalid Root Motion Policy", url: "/invalid-root-motion-policy.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: { policy: "keep-everything" } } },
    { id: "invalid-root-motion-shape", label: "Invalid Root Motion Shape", url: "/invalid-root-motion-shape.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: true } },
    { id: "invalid-root-motion-policy-alias", label: "Invalid Root Motion Policy Alias", url: "/invalid-root-motion-policy-alias.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotionPolicy: "keep-everything" } }
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
assert.ok(
  malformedValidationStatusIssues.includes("invalid-root-motion-policy has invalid source.rootMotion.policy keep-everything"),
  "validateManifest should report invalid source.rootMotion.policy values from runtime JSON"
);
assert.ok(
  malformedValidationStatusIssues.includes("invalid-root-motion-shape has invalid source.rootMotion metadata"),
  "validateManifest should report malformed source.rootMotion shapes from runtime JSON"
);
assert.ok(
  malformedValidationStatusIssues.includes("invalid-root-motion-policy-alias has invalid source.rootMotionPolicy keep-everything"),
  "validateManifest should report invalid source.rootMotionPolicy aliases from runtime JSON"
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
    ["rejected", "manifest marks clip rejected"],
    ["invalid-root-motion-policy", "has invalid source.rootMotion.policy keep-everything"],
    ["invalid-root-motion-shape", "has invalid source.rootMotion metadata"],
    ["invalid-root-motion-policy-alias", "has invalid source.rootMotionPolicy keep-everything"]
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
  /animation clip valid-source-rest-quaternion is invalid: track 0 head\.quaternion sourceRestQuaternion must contain exactly 4 values/,
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
assert.throws(
  () => encodeAnimationBinary(invalidSourceRestQuaternionPropertyClip),
  /animation clip invalid-source-rest-quaternion-property is invalid: track 0 head\.translation sourceRestQuaternion is only valid on rotation tracks/,
  "binary encoding should reject source rest quaternion metadata on non-rotation tracks"
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
assert.throws(
  () => encodeAnimationBinary(invalidZeroRotationSampleClip),
  /animation clip invalid-zero-rotation-sample is invalid: track 0 head\.quaternion rotation track quaternions must be normalizable/,
  "binary encoding should reject non-normalizable rotation sample quaternions"
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
assert.throws(
  () => encodeAnimationBinary(duplicateTrackTimeClip),
  /animation clip duplicate-track-time is invalid: track 0 head\.translation track times must be sorted/,
  "binary encoding should reject unsorted or duplicate track times"
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
assert.throws(
  () => encodeAnimationBinary(negativeTrackTimeClip),
  /animation clip negative-track-time is invalid: track 0 head\.translation track time must be within clip duration/,
  "binary encoding should reject negative track times"
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
assert.throws(
  () => encodeAnimationBinary(overDurationTrackTimeClip),
  /animation clip over-duration-track-time is invalid: track 0 head\.translation track time must be within clip duration/,
  "binary encoding should reject track times beyond the clip duration"
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
assert.throws(
  () => encodeAnimationBinary({ ...nodClip, id: "binary-non-finite-duration", duration: Number.NaN }),
  /animation clip binary-non-finite-duration is invalid: clip duration must be positive and finite/,
  "binary encoding should reject non-finite clip durations"
);
assert.throws(
  () =>
    encodeAnimationBinary({
      id: "binary-non-finite-values",
      duration: 1,
      tracks: [{ joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, Number.NaN, 0]) }]
    }),
  /animation clip binary-non-finite-values is invalid: track 0 head\.translation track values must be finite/,
  "binary encoding should reject non-finite track values"
);
assert.throws(
  () =>
    encodeAnimationBinary({
      id: "binary-non-normalized-rotation",
      duration: 1,
      tracks: [{ joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }]
    }),
  /animation clip binary-non-normalized-rotation is invalid: track 0 head\.rotation rotation track quaternions must be normalized/,
  "binary encoding should reject non-normalized rotation sample quaternions"
);
assert.throws(
  () => encodeAnimationBinary(duplicateDeclaredChannelClip),
  /animation clip duplicate-declared-channel is invalid: track 1 head\.translation duplicate target channel head\.translation conflicts with track 0 \(head\.translation\)/,
  "binary encoding should reject duplicate target channels without a skeleton"
);
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
const strippedRootMotionMovingHipsInspection = inspectClipAsset(
  {
    id: "root-motion-stripped-moving-hips",
    label: "Root Motion Stripped Moving Hips",
    url: "/root-motion-stripped-moving-hips.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "stripped-to-in-place" } }
  },
  {
    id: "root-motion-stripped-moving-hips",
    duration: 1,
    tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 0.25]) }]
  }
);
assert.equal(strippedRootMotionMovingHipsInspection.accepted, false);
assert.ok(
  strippedRootMotionMovingHipsInspection.issues.some((issue) => issue.message === "root-motion policy is stripped-to-in-place but root carrier translation still moves"),
  "stripped-to-in-place clips should reject meaningful hips translation motion"
);
const noPolicyMovingHipsInspection = inspectClipAsset(
  {
    id: "walk-moving-hips",
    label: "Walk Moving Hips",
    url: "/walk-moving-hips.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  {
    id: "walk-moving-hips",
    duration: 1,
    tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 0.25]) }]
  }
);
assert.equal(noPolicyMovingHipsInspection.accepted, false);
assert.ok(
  noPolicyMovingHipsInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
  "moving hips translation should require an explicit root-motion policy even without root-motion naming"
);
const noPolicyMovingRootMetadataInspection = inspectClipAsset(
  {
    id: "walk-moving-root",
    label: "Walk Moving Root",
    url: "/walk-moving-root.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  {
    id: "walk-moving-root",
    duration: 1,
    metadata: {},
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  }
);
assert.equal(noPolicyMovingRootMetadataInspection.accepted, false);
assert.ok(
  noPolicyMovingRootMetadataInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
  "moving root translation should require an explicit root-motion policy from manifest or clip metadata"
);
const nonePolicyMovingRootInspection = inspectClipAsset(
  {
    id: "walk-none-moving-root",
    label: "Walk None Moving Root",
    url: "/walk-none-moving-root.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "none" } }
  },
  {
    id: "walk-none-moving-root",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  }
);
assert.equal(nonePolicyMovingRootInspection.accepted, false);
assert.ok(
  nonePolicyMovingRootInspection.issues.some((issue) => issue.message === "root-motion policy is none but root carrier translation moves"),
  "policy none should reject moving root carrier translation"
);
const playbackWindowInPlaceRootCarrierInspection = inspectClipAsset(
  {
    id: "walk-trimmed-in-place-root",
    label: "Walk Trimmed In Place Root",
    url: "/walk-trimmed-in-place-root.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    playback: { start: 0.25, end: 0.75 }
  },
  {
    id: "walk-trimmed-in-place-root",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.75, 1]),
        values: toFloat32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0])
      }
    ]
  }
);
assert.equal(playbackWindowInPlaceRootCarrierInspection.accepted, true);
assert.equal(
  playbackWindowInPlaceRootCarrierInspection.issues.some(
    (issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy" || issue.message === "root-motion policy is none but root carrier translation moves"
  ),
  false,
  "root carrier motion outside the playback window should not trigger root-motion policy failures for an in-place segment"
);
const playbackWindowMovingRootCarrierInspection = inspectClipAsset(
  {
    id: "walk-trimmed-moving-root",
    label: "Walk Trimmed Moving Root",
    url: "/walk-trimmed-moving-root.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "none" } },
    playback: { start: 0.25, end: 0.75 }
  },
  {
    id: "walk-trimmed-moving-root",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.5, 0.75, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0.5, 0, 0])
      }
    ]
  }
);
assert.equal(playbackWindowMovingRootCarrierInspection.accepted, false);
assert.ok(
  playbackWindowMovingRootCarrierInspection.issues.some((issue) => issue.message === "root-motion policy is none but root carrier translation moves"),
  "root carrier motion inside the playback window should still trigger root-motion policy failures"
);
const invalidPlaybackWindowRootCarrierInspection = inspectClipAsset(
  {
    id: "walk-invalid-playback-root",
    label: "Walk Invalid Playback Root",
    url: "/walk-invalid-playback-root.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    playback: { start: 0.75, end: 0.25 }
  },
  {
    id: "walk-invalid-playback-root",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  }
);
assert.equal(invalidPlaybackWindowRootCarrierInspection.accepted, false);
assert.ok(
  invalidPlaybackWindowRootCarrierInspection.issues.some((issue) => issue.message === "invalid playback window 0.75..0.25"),
  "invalid playback windows should still be reported"
);
assert.equal(
  invalidPlaybackWindowRootCarrierInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
  false,
  "invalid playback windows should not add a second root-motion movement failure"
);
assert.equal(
  inspectClipAsset(
    {
      id: "idle-stripped-stationary-pelvis",
      label: "Idle Stripped Stationary Pelvis",
      url: "/idle-stripped-stationary-pelvis.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    {
      id: "idle-stripped-stationary-pelvis",
      duration: 1,
      tracks: [{ joint: "pelvis", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 0, 2, 1.00001, -0.00001, 2.00001]) }]
    }
  ).accepted,
  true,
  "stripped-to-in-place clips should tolerate tiny stationary root-carrier translation noise"
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
const preservedIdleHeadOnlyInspection = inspectClipAsset(
  {
    id: "idle-head-only",
    label: "Idle Head Only",
    url: "/idle-head-only.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "preserved" } }
  },
  {
    id: "idle-head-only",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.1, 0]) }]
  }
);
assert.equal(preservedIdleHeadOnlyInspection.accepted, false);
assert.ok(
  preservedIdleHeadOnlyInspection.issues.some((issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"),
  "preserved root-motion policy should require a root carrier translation track even without root-motion naming"
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
assert.equal(
  inspectClipAsset(
    {
      id: "idle-preserved-hips",
      label: "Idle Preserved Hips",
      url: "/idle-preserved-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    {
      id: "idle-preserved-hips",
      duration: 1,
      tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 1]) }]
    }
  ).accepted,
  true,
  "preserved root-motion policy should accept hips translation carriers even without root-motion naming"
);
assert.equal(
  inspectClipAsset(
    {
      id: "walk-clip-metadata-preserved-root",
      label: "Walk Clip Metadata Preserved Root",
      url: "/walk-clip-metadata-preserved-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "walk-clip-metadata-preserved-root",
      duration: 1,
      metadata: { rootMotionPolicy: "preserved" },
      tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
    }
  ).accepted,
  true,
  "preserved clip metadata should accept moving root carrier translation"
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
const invalidNonRootMotionPolicyInspection = inspectClipAsset(
  {
    id: "idle-invalid-root-motion-policy",
    label: "Idle Invalid Root Motion Policy",
    url: "/idle-invalid-root-motion-policy.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "keep-everything" } }
  },
  nodClip
);
assert.equal(invalidNonRootMotionPolicyInspection.accepted, false);
assert.ok(
  invalidNonRootMotionPolicyInspection.issues.some((issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"),
  "inspectClipAsset should reject invalid root-motion metadata even when the clip name is not root-motion"
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
  oppositeQuaternionEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
  false,
  "looping rotation endpoints should compare quaternion-equivalent signs"
);

const mismatchedTranslationEndpointClip: AnimationClip = {
  id: "mismatched-translation-endpoints",
  duration: 1,
  loop: true,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0.25, 0, 0]) }]
};
const mismatchedTranslationEndpointInspection = inspectAnimationAsset(
  {
    id: "mismatched-translation-endpoints",
    label: "Mismatched Translation Endpoints",
    url: "/mismatched-translation-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true
  },
  mismatchedTranslationEndpointClip,
  skeleton
);
const mismatchedTranslationEndpointIssue = mismatchedTranslationEndpointInspection.issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
assert.ok(mismatchedTranslationEndpointIssue, "translation loop endpoint validation should keep raw component behavior");
assert.equal(mismatchedTranslationEndpointIssue.track, 0);
assert.equal(mismatchedTranslationEndpointIssue.joint, "head");
assert.equal(mismatchedTranslationEndpointIssue.property, "translation");
assert.equal(mismatchedTranslationEndpointIssue.delta, 0.25);
assert.ok(mismatchedTranslationEndpointIssue.message.includes("delta 0.2500"), "translation seam warning should include measured delta");

const trimmedMatchedPlaybackEndpointClip: AnimationClip = {
  id: "trimmed-matched-playback-endpoints",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "translation",
      times: toFloat32Array([0, 0.25, 0.75, 1]),
      values: toFloat32Array([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0])
    }
  ]
};
const trimmedMatchedPlaybackEndpointInspection = inspectAnimationAsset(
  {
    id: "trimmed-matched-playback-endpoints",
    label: "Trimmed Matched Playback Endpoints",
    url: "/trimmed-matched-playback-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true,
    playback: { start: 0.25, end: 0.75 }
  },
  trimmedMatchedPlaybackEndpointClip,
  skeleton
);
assert.equal(
  trimmedMatchedPlaybackEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
  false,
  "loop endpoint validation should compare sampled playback-window endpoints instead of raw keyframe endpoints"
);

const trimmedMismatchedPlaybackEndpointClip: AnimationClip = {
  id: "trimmed-mismatched-playback-endpoints",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "translation",
      times: toFloat32Array([0, 0.25, 0.75, 1]),
      values: toFloat32Array([0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0, 0, 0])
    }
  ]
};
const trimmedMismatchedPlaybackEndpointIssue = inspectAnimationAsset(
  {
    id: "trimmed-mismatched-playback-endpoints",
    label: "Trimmed Mismatched Playback Endpoints",
    url: "/trimmed-mismatched-playback-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true,
    playback: { start: 0.25, end: 0.75 }
  },
  trimmedMismatchedPlaybackEndpointClip,
  skeleton
).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
assert.ok(
  trimmedMismatchedPlaybackEndpointIssue,
  "loop endpoint validation should warn when sampled playback-window endpoints differ even if raw keyframe endpoints match"
);
assert.equal(trimmedMismatchedPlaybackEndpointIssue.track, 0);
assert.equal(trimmedMismatchedPlaybackEndpointIssue.joint, "head");
assert.equal(trimmedMismatchedPlaybackEndpointIssue.property, "translation");
assert.equal(trimmedMismatchedPlaybackEndpointIssue.delta, 0.25);

const inferredLoopEndpointIssue = inspectAnimationAsset(
  {
    id: "inferred-loop-endpoints",
    label: "Inferred Loop Endpoints",
    url: "/inferred-loop-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  },
  { ...mismatchedTranslationEndpointClip, id: "inferred-loop-endpoints" },
  skeleton
).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
assert.ok(inferredLoopEndpointIssue, "decoded clip.loop should enable loop endpoint validation when manifest loop is omitted");
assert.equal(inferredLoopEndpointIssue.track, 0);
assert.equal(inferredLoopEndpointIssue.joint, "head");
assert.equal(inferredLoopEndpointIssue.property, "translation");

const manifestLoopFalseEndpointInspection = inspectAnimationAsset(
  {
    id: "manifest-loop-false-endpoints",
    label: "Manifest Loop False Endpoints",
    url: "/manifest-loop-false-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: false
  },
  { ...mismatchedTranslationEndpointClip, id: "manifest-loop-false-endpoints" },
  skeleton
);
assert.equal(manifestLoopFalseEndpointInspection.loop, false, "manifest loop false should override decoded clip.loop in the validation report");
assert.equal(
  manifestLoopFalseEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
  false,
  "manifest loop false should disable loop endpoint validation even when decoded clip.loop is true"
);

const mismatchedRotationEndpointClip: AnimationClip = {
  id: "mismatched-rotation-endpoints",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0.5, 0, 0.8660254])
    }
  ]
};
const mismatchedRotationEndpointIssue = inspectAnimationAsset(
  {
    id: "mismatched-rotation-endpoints",
    label: "Mismatched Rotation Endpoints",
    url: "/mismatched-rotation-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true
  },
  mismatchedRotationEndpointClip,
  skeleton
).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
assert.ok(mismatchedRotationEndpointIssue, "rotation loop endpoint validation should report mismatched rotation endpoints");
assert.equal(mismatchedRotationEndpointIssue.track, 0);
assert.equal(mismatchedRotationEndpointIssue.joint, "head");
assert.equal(mismatchedRotationEndpointIssue.property, "rotation");
assert.ok((mismatchedRotationEndpointIssue.delta ?? 0) > 0.5, "rotation seam warning should include a meaningful measured delta");

const malformedLoopEndpointClip: AnimationClip = {
  id: "malformed-loop-endpoints",
  duration: 1,
  loop: true,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0]) }]
};
const malformedLoopEndpointInspection = inspectAnimationAsset(
  {
    id: "malformed-loop-endpoints",
    label: "Malformed Loop Endpoints",
    url: "/malformed-loop-endpoints.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true
  },
  malformedLoopEndpointClip,
  skeleton
);
assert.equal(
  malformedLoopEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
  false,
  "malformed loop endpoint tracks should not crash or emit seam warnings from missing samples"
);
assert.ok(
  malformedLoopEndpointInspection.issues.some((issue) => issue.message === "track value count does not match times and stride"),
  "malformed loop endpoint tracks should still report structural validation errors"
);

const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
assert.ok(sampled[2]!.rotation[0] > 0.1);

const motionSkeleton = createSkeleton([
  { name: "root" },
  { name: "hips", parentName: "root", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "spine", parentName: "hips", humanoid: "spine" }
]);
const motionClip: AnimationClip = {
  id: "root-motion",
  duration: 1,
  loop: true,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
    {
      joint: "root",
      property: "rotation",
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI)])
    },
    { humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 1, 0, 0, 1, 6]) }
  ]
};
const defaultRootMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25);
assert.equal(defaultRootMotionSample.joint, "root", "motion sampling should default to the skeleton root carrier");
assert.deepEqual(defaultRootMotionSample.transform.translation, [2.5, 0, 0]);
const humanoidMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { humanBone: "hips" } });
assert.equal(humanoidMotionSample.jointIndex, 1, "motion sampling should resolve explicit humanoid carriers");
assert.deepEqual(humanoidMotionSample.transform.translation, [0, 1, 3]);
const jointMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { joint: "hips" } });
assert.deepEqual(jointMotionSample.transform.translation, humanoidMotionSample.transform.translation, "motion sampling should resolve explicit joint-name carriers");
const indexedMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { jointIndex: 1 } });
assert.deepEqual(indexedMotionSample.transform.translation, humanoidMotionSample.transform.translation, "motion sampling should resolve explicit joint-index carriers");
const motionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.2, 0.7);
assert.deepEqual(motionDelta.delta.translation, [5, 0, 0], "motion interval deltas should report carrier displacement");
assert.ok(quaternionNearlyEqual(motionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5), "motion interval deltas should report carrier rotation");
const wrappedMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.75, 1.25);
assert.deepEqual(wrappedMotionDelta.delta.translation, [5, 0, 0], "looped motion intervals should accumulate forward displacement across wrap");
const negativeMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.7, 0.2);
assert.deepEqual(negativeMotionDelta.delta.translation, [0, 0, 0], "negative motion intervals should return identity deltas");
const signedScaleMotionClip: AnimationClip = {
  id: "signed-scale-motion",
  duration: 1,
  tracks: [{ joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([-2, 2, -4, -4, 6, 2]) }]
};
const signedScaleMotionDelta = sampleMotionIntervalDelta(motionSkeleton, signedScaleMotionClip, 0, 1, { loop: false });
assert.deepEqual(signedScaleMotionDelta.delta.scale, [2, 3, -0.5], "motion interval scale deltas should preserve finite negative scale ratios");
const nonFiniteMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, Number.NaN);
assert.equal(nonFiniteMotionSample.time, 0, "non-finite motion sample times should deterministically sample time zero");
assert.deepEqual(nonFiniteMotionSample.transform.translation, [0, 0, 0]);
const invalidCarrierDiagnostics: SampleRepairDiagnostic[] = [];
const invalidCarrierSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25, {
  carrier: { humanBone: "pelvis" },
  diagnostics: invalidCarrierDiagnostics
});
assert.equal(invalidCarrierSample.joint, "root", "invalid motion carriers should fall back to the skeleton root");
assert.ok(
  invalidCarrierDiagnostics.some((issue) => issue.message === "motion carrier humanoid bone pelvis does not map to skeleton; using root"),
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
const repairedMotionSample = sampleMotionCarrier(motionSkeleton, repairedMotionClip, 0.5, { diagnostics: repairedMotionDiagnostics });
assert.ok(repairedMotionSample.transform.rotation.every(Number.isFinite), "motion carrier sampling should repair non-finite rotation samples");
assert.ok(Math.abs(Math.hypot(...repairedMotionSample.transform.rotation) - 1) < 1e-6, "motion carrier rotations should remain normalized");
assert.ok(
  repairedMotionDiagnostics.some((issue) => issue.property === "rotation" && issue.message === "rotation track quaternion was normalized during sampling"),
  "motion carrier sampling should preserve rotation repair diagnostics"
);
assert.ok(
  repairedMotionDiagnostics.some((issue) => issue.property === "rotation" && issue.message === "rotation track quaternion values were repaired to finite defaults"),
  "motion carrier sampling should report non-finite rotation repairs"
);

const coreRetargetSourceRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const coreRetargetTargetRest = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const coreRetargetDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
const coreRetargetSourceSample = multiplyQuat(coreRetargetSourceRest, coreRetargetDelta);
assert.ok(
  quaternionNearlyEqual(retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceRest), coreRetargetTargetRest, 1e-5),
  "retargeting a source rest sample should preserve the target rest rotation"
);
assert.ok(
  quaternionNearlyEqual(
    retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceSample),
    multiplyQuat(coreRetargetTargetRest, coreRetargetDelta),
    1e-5
  ),
  "retargeting should preserve source local deltas by post-applying them to target rest"
);
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
const coreRetargetExpected = multiplyQuat(coreRetargetTargetRest, coreRetargetDelta);
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

function modelPoint(skeleton: Skeleton, pose: Pose, joint: string): [number, number, number] {
  const index = skeleton.joints.findIndex((item) => item.name === joint);
  assert.ok(index >= 0, `fixture joint ${joint} should exist`);
  return transformPoint(localToModelPose(skeleton, pose)[index]!, [0, 0, 0]);
}

function signedJointOffset(a: [number, number, number], b: [number, number, number], c: [number, number, number], axis: [number, number, number]): number {
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as [number, number, number];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as [number, number, number];
  const acLengthSq = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2];
  assert.ok(acLengthSq > 1e-8, "signed joint fixture should not collapse the endpoint line");
  const t = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / acLengthSq;
  const closest = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t] as [number, number, number];
  const offset = [b[0] - closest[0], b[1] - closest[1], b[2] - closest[2]] as [number, number, number];
  return offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
}

const anatomicalLegSkeleton = createSkeleton([
  { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.12, 0] } },
  { name: "leftLowerLeg", parentName: "leftUpperLeg", humanoid: "leftLowerLeg", rest: { translation: [0, -0.46, 0] } },
  { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
  { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
  { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg", rest: { translation: [0, -0.46, 0] } },
  { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.46, 0] } }
]);
const anatomicalKneeFlexion = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
const anatomicalLegClip: AnimationClip = {
  id: "anatomical-knee-flexion",
  duration: 1,
  tracks: [
    {
      humanBone: "leftLowerLeg",
      property: "quaternion",
      sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion])
    },
    {
      humanBone: "rightLowerLeg",
      property: "quaternion",
      sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion])
    }
  ]
};
const anatomicalLegPose = sampleClipToPose(anatomicalLegSkeleton, anatomicalLegClip, 1);
const leftKneeForward = signedJointOffset(
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftUpperLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftLowerLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftFoot"),
  [0, 0, 1]
);
const rightKneeForward = signedJointOffset(
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightUpperLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightLowerLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightFoot"),
  [0, 0, 1]
);
assert.ok(leftKneeForward > 0.16, `left knee should flex forward in model space, got ${leftKneeForward.toFixed(4)}`);
assert.ok(rightKneeForward > 0.16, `right knee should flex forward in model space, got ${rightKneeForward.toFixed(4)}`);
const anatomicalBadBasisPose = sampleClipToPose(anatomicalLegSkeleton, anatomicalLegClip, 1, {
  sourceBasisQuaternion: () => quatFromUnitVectors([0, 0, 1], [1, 0, 0])
});
const badBasisKneeForward = signedJointOffset(
  modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftUpperLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftLowerLeg"),
  modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftFoot"),
  [0, 0, 1]
);
assert.ok(
  badBasisKneeForward < leftKneeForward * 0.25,
  `unneeded source-basis correction should be detectable as lost/backward knee flexion, got ${badBasisKneeForward.toFixed(4)}`
);

const anatomicalArmSkeleton = createSkeleton([
  { name: "chest", humanoid: "chest", rest: { translation: [0, 1.35, 0] } },
  { name: "leftUpperArm", parentName: "chest", humanoid: "leftUpperArm", rest: { translation: [-0.18, 0.12, 0] } },
  { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm", rest: { translation: [-0.36, 0, 0] } },
  { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.34, 0, 0] } },
  { name: "rightUpperArm", parentName: "chest", humanoid: "rightUpperArm", rest: { translation: [0.18, 0.12, 0] } },
  { name: "rightLowerArm", parentName: "rightUpperArm", humanoid: "rightLowerArm", rest: { translation: [0.36, 0, 0] } },
  { name: "rightHand", parentName: "rightLowerArm", humanoid: "rightHand", rest: { translation: [0.34, 0, 0] } }
]);
const leftElbowFlexion = quatFromAxisAngle([0, 1, 0], -Math.PI / 3);
const rightElbowFlexion = quatFromAxisAngle([0, 1, 0], Math.PI / 3);
const anatomicalArmClip: AnimationClip = {
  id: "anatomical-elbow-flexion",
  duration: 1,
  tracks: [
    {
      humanBone: "leftLowerArm",
      property: "quaternion",
      sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...leftElbowFlexion])
    },
    {
      humanBone: "rightLowerArm",
      property: "quaternion",
      sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...rightElbowFlexion])
    }
  ]
};
const anatomicalArmPose = sampleClipToPose(anatomicalArmSkeleton, anatomicalArmClip, 1);
const leftElbowForward = signedJointOffset(
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftUpperArm"),
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftLowerArm"),
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftHand"),
  [0, 0, 1]
);
const rightElbowForward = signedJointOffset(
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightUpperArm"),
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightLowerArm"),
  modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightHand"),
  [0, 0, 1]
);
assert.ok(leftElbowForward > 0.12, `left elbow should flex to the authored forward bend plane, got ${leftElbowForward.toFixed(4)}`);
assert.ok(rightElbowForward > 0.12, `right elbow should flex to the authored forward bend plane, got ${rightElbowForward.toFixed(4)}`);

const fullAnatomicalSkeleton = createSkeleton([
  { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "spine", parentName: "hips", humanoid: "spine", rest: { translation: [0, 0.28, 0] } },
  { name: "chest", parentName: "spine", humanoid: "chest", rest: { translation: [0, 0.28, 0] } },
  { name: "neck", parentName: "chest", humanoid: "neck", rest: { translation: [0, 0.24, 0] } },
  { name: "head", parentName: "neck", humanoid: "head", rest: { translation: [0, 0.18, 0] } },
  { name: "leftShoulder", parentName: "chest", humanoid: "leftShoulder", rest: { translation: [-0.12, 0.18, 0] } },
  { name: "leftUpperArm", parentName: "leftShoulder", humanoid: "leftUpperArm", rest: { translation: [-0.2, 0, 0] } },
  { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm", rest: { translation: [-0.36, 0, 0] } },
  { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.32, 0, 0] } },
  { name: "rightShoulder", parentName: "chest", humanoid: "rightShoulder", rest: { translation: [0.12, 0.18, 0] } },
  { name: "rightUpperArm", parentName: "rightShoulder", humanoid: "rightUpperArm", rest: { translation: [0.2, 0, 0] } },
  { name: "rightLowerArm", parentName: "rightUpperArm", humanoid: "rightLowerArm", rest: { translation: [0.36, 0, 0] } },
  { name: "rightHand", parentName: "rightLowerArm", humanoid: "rightHand", rest: { translation: [0.32, 0, 0] } },
  { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.12, 0] } },
  { name: "leftLowerLeg", parentName: "leftUpperLeg", humanoid: "leftLowerLeg", rest: { translation: [0, -0.46, 0] } },
  { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
  { name: "leftToes", parentName: "leftFoot", humanoid: "leftToes", rest: { translation: [0, 0, 0.18] } },
  { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
  { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg", rest: { translation: [0, -0.46, 0] } },
  { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.46, 0] } },
  { name: "rightToes", parentName: "rightFoot", humanoid: "rightToes", rest: { translation: [0, 0, 0.18] } }
]);
const fullAnatomicalClip: AnimationClip = {
  id: "full-anatomical-known-local-rotations",
  duration: 1,
  tracks: [
    { humanBone: "hips", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 10)]) },
    { humanBone: "spine", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 12)]) },
    { humanBone: "neck", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 10)]) },
    { humanBone: "leftShoulder", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], Math.PI / 8)]) },
    { humanBone: "rightShoulder", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], -Math.PI / 8)]) },
    { humanBone: "leftLowerArm", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...leftElbowFlexion]) },
    { humanBone: "rightLowerArm", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...rightElbowFlexion]) },
    { humanBone: "leftHand", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 9)]) },
    { humanBone: "rightHand", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 9)]) },
    { humanBone: "leftLowerLeg", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion]) },
    { humanBone: "rightLowerLeg", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion]) },
    { humanBone: "leftFoot", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)]) },
    { humanBone: "rightFoot", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)]) }
  ]
};
const fullAnatomicalPose = sampleClipToPose(fullAnatomicalSkeleton, fullAnatomicalClip, 1);
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "head")[2]! > 0.08, "spine rotation should propagate through neck/head in model space");
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm")[1]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftUpperArm")[1]!, "left shoulder should lower the upper arm rather than swap sides");
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightUpperArm")[1]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightUpperArm")[1]!, "right shoulder should lower the upper arm rather than swap sides");
assert.ok(
  signedJointOffset(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm"),
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftLowerArm"),
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand"),
    [0, 0, 1]
  ) > 0.12,
  "left elbow and wrist should bend into the expected forward model-space plane"
);
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand")[0]! < 0, "left wrist/hand should remain on the left side");
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightHand")[0]! > 0, "right wrist/hand should remain on the right side");
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftToes")[2]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftToes")[2]!, "left ankle/foot should plantarflex toes backward under the known local rotation");
assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightToes")[2]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightToes")[2]!, "right ankle/foot should plantarflex toes backward under the known local rotation");
const fullAnatomicalDiagnostics = diagnoseRetargetingRestAxes(fullAnatomicalSkeleton, fullAnatomicalClip);
assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerLeg")?.hingePlane, "sagittal", "diagnostic should classify left knee flexion as sagittal");
assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerLeg")?.hingePlane, "sagittal", "diagnostic should classify right knee flexion as sagittal");
assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerArm")?.hingePlane, "sagittal", "diagnostic should classify left elbow flexion as sagittal");
assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerArm")?.hingePlane, "sagittal", "diagnostic should classify right elbow flexion as sagittal");
const unsupportedDiagnostics = diagnoseRetargetingRestAxes(fullAnatomicalSkeleton);
assert.match(
  unsupportedDiagnostics.find((entry) => entry.humanBone === "leftLowerLeg")?.issue ?? "",
  /missing source rest quaternion/,
  "diagnostic should prove when actual source rest data is missing instead of pretending hinge retargeting is supported"
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
const malformedFiniteSampleDiagnostics: SampleRepairDiagnostic[] = [];
const malformedFiniteSampleClip: AnimationClip = {
  id: "malformed-finite-samples",
  duration: 1,
  tracks: [
    { humanBone: "spine", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([Number.NaN, 2, Number.POSITIVE_INFINITY, 4, 5, 6]) },
    { humanBone: "head", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, Number.NEGATIVE_INFINITY, 1, Number.NaN, 3, 4]) }
  ]
};
const malformedFiniteSamplePose = sampleClipToPose(skeleton, malformedFiniteSampleClip, 0.5, { diagnostics: malformedFiniteSampleDiagnostics });
assert.deepEqual(malformedFiniteSamplePose[1]!.translation, [2, 3.5, 3], "non-finite translation sample components should be repaired before interpolation");
assert.deepEqual(malformedFiniteSamplePose[2]!.scale, [1, 2, 2.5], "non-finite scale sample components should be repaired before interpolation");
assert.ok(malformedFiniteSamplePose.every((transform) => transform.translation.every(Number.isFinite) && transform.scale.every(Number.isFinite)));
assert.ok(
  malformedFiniteSampleDiagnostics.some((issue) => issue.property === "translation" && issue.sample === 0 && issue.message === "translation track sample values were repaired to finite defaults"),
  "direct pose sampling should report repaired translation samples"
);
assert.ok(
  malformedFiniteSampleDiagnostics.some((issue) => issue.property === "scale" && issue.sample === 0 && issue.message === "scale track sample values were repaired to finite defaults"),
  "direct pose sampling should report repaired scale samples"
);
assert.ok(
  malformedFiniteSampleDiagnostics.some((issue) => issue.property === "scale" && issue.sample === 1 && issue.message === "scale track sample values were repaired to finite defaults"),
  "direct pose sampling should report each repaired scale key used for interpolation"
);
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
const unknownHumanoidTrackClip = {
  id: "unknown-humanbone",
  duration: 1,
  tracks: [{ humanBone: "pelvis", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }]
} as unknown as AnimationClip;
assert.ok(
  validateClip(unknownHumanoidTrackClip).some(
    (issue) => issue.track === 0 && issue.joint === "pelvis" && issue.property === "translation" && issue.message === "track has unknown humanoid bone"
  ),
  "validateClip should report unknown humanoid track identifiers without requiring a skeleton"
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

const attachmentOffset = composeMat4({ translation: [0.25, 0.5, -0.75], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4), scale: [1, 2, 1] });
const expectedAttachment = multiplyMat4(models[2]!, attachmentOffset);
assertMat4NearlyEqual(
  computeAttachmentTransform({ modelPose: models, jointIndex: 2, offset: attachmentOffset }),
  expectedAttachment,
  1e-6,
  "attachment transform should concatenate joint model matrix then offset matrix"
);
assertMat4NearlyEqual(
  computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
  expectedAttachment,
  1e-6,
  "attachment transform should resolve joints by name"
);
const boundHeadAttachment = createAttachmentBinding({ skeleton, joint: "head", offset: attachmentOffset, id: "hat" });
assert.equal(boundHeadAttachment.jointIndex, 2, "attachment binding should resolve joint names once");
assert.equal(boundHeadAttachment.jointName, "head", "attachment binding should retain resolved joint metadata");
assert.equal(boundHeadAttachment.id, "hat", "attachment binding should retain stable ids");
assertMat4NearlyEqual(
  computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
  expectedAttachment,
  1e-6,
  "bound attachment transform should concatenate joint model matrix then precomputed offset matrix"
);
assertMat4NearlyEqual(
  computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
  computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
  0,
  "attachment transform should be deterministic for repeated evaluation"
);
const humanoidAttachment = computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] } });
assertMat4NearlyEqual(
  humanoidAttachment,
  computeAttachmentTransform({ modelPose: models, jointIndex: 3, offset: { translation: [0, 0.25, 0] } }),
  1e-6,
  "attachment transform should resolve humanoid aliases through the skeleton map"
);
const boundHumanoidAttachment = createAttachmentBinding({ skeleton, joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] }, id: "armband" });
assert.equal(boundHumanoidAttachment.jointIndex, 3, "attachment binding should resolve humanoid aliases once");
assert.equal(boundHumanoidAttachment.humanoid, "leftUpperArm", "attachment binding should retain humanoid metadata");
assertMat4NearlyEqual(
  computeBoundAttachmentTransform({ modelPose: models, binding: boundHumanoidAttachment }),
  humanoidAttachment,
  1e-6,
  "bound attachment transform should evaluate humanoid alias bindings"
);
const rotatedAttachmentSkeleton = createSkeleton([
  { name: "root", rest: { rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2) } },
  { name: "rightHandJoint", parentName: "root", humanoid: "rightHand" }
]);
const rotatedAttachmentModels = localToModelPose(rotatedAttachmentSkeleton, rotatedAttachmentSkeleton.restPose);
assert.ok(
  vectorNearlyEqual(
    transformPoint(computeSkeletonAttachmentTransform({ skeleton: rotatedAttachmentSkeleton, modelPose: rotatedAttachmentModels, joint: "rightHand", offset: { translation: [1, 0, 0] } }), [0, 0, 0]),
    [0, 1, 0],
    1e-6
  ),
  "attachment translation offsets should rotate with the parent/joint model matrix"
);
assert.throws(
  () => computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "missingJoint" }),
  /attachment joint missingJoint was not found/,
  "missing attachment joints should be explicit failures"
);
assert.throws(
  () => computeAttachmentTransform({ modelPose: models, jointIndex: 99 }),
  /attachment joint index 99 is out of range/,
  "out-of-range attachment joint indices should be explicit failures"
);
assert.throws(
  () => createAttachmentBinding({ skeleton, joint: 99 }),
  /attachment joint index 99 is out of range/,
  "out-of-range numeric attachment bindings should fail during binding"
);
const staleBoundAttachment = createAttachmentBinding({ skeleton, joint: "head" });
const shortModelPose = models.slice(0, 2);
assert.throws(
  () => computeBoundAttachmentTransform({ modelPose: shortModelPose, binding: staleBoundAttachment }),
  /attachment binding joint index 2 is out of range/,
  "bound attachment evaluation should reject model poses without the resolved joint"
);
const nonFiniteJointModels = [...models];
nonFiniteJointModels[2] = new Float32Array(models[2]!);
nonFiniteJointModels[2]![12] = Number.NaN;
assert.throws(
  () => computeAttachmentTransform({ modelPose: nonFiniteJointModels, jointIndex: 2 }),
  /attachment joint 2 model matrix values must be finite/,
  "non-finite joint model matrices should not produce plausible attachment output"
);
assert.throws(
  () => computeBoundAttachmentTransform({ modelPose: nonFiniteJointModels, binding: boundHeadAttachment }),
  /attachment binding joint 2 model matrix values must be finite/,
  "bound attachment evaluation should reject non-finite joint model matrices"
);
const sanitizedOffsetAttachment = computeAttachmentTransform({
  modelPose: [composeMat4(identityTransform())],
  jointIndex: 0,
  offset: {
    translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
    rotation: [0, Number.NaN, 0, 1],
    scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
  }
});
assertMat4NearlyEqual(
  sanitizedOffsetAttachment,
  composeMat4(cloneTransform({
    translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
    rotation: [0, Number.NaN, 0, 1],
    scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
  })),
  0,
  "attachment transform offsets should sanitize Partial<Transform> inputs through cloneTransform"
);
const sanitizedBoundAttachment = createAttachmentBinding({
  skeleton,
  joint: "head",
  offset: {
    translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
    rotation: [0, Number.NaN, 0, 1],
    scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
  }
});
assertMat4NearlyEqual(
  sanitizedBoundAttachment.offsetMatrix,
  composeMat4(cloneTransform({
    translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
    rotation: [0, Number.NaN, 0, 1],
    scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
  })),
  0,
  "attachment bindings should sanitize Partial<Transform> offsets once during binding"
);
const nonFiniteOffsetMatrix = new Float32Array(16);
nonFiniteOffsetMatrix[0] = Number.NaN;
assert.throws(
  () => createAttachmentBinding({ skeleton, joint: "head", offset: nonFiniteOffsetMatrix }),
  /attachment offset matrix values must be finite/,
  "attachment bindings should reject non-finite offset matrices"
);
assertMat4NearlyEqual(
  computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
  computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
  0,
  "bound attachment transform should be deterministic for repeated evaluation"
);
const boundAttachments = createAttachmentBindings(skeleton, [
  { joint: "head", offset: attachmentOffset, id: "hat" },
  { joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] }, id: "armband" }
]);
const boundAttachmentTransforms = computeBoundAttachmentTransforms({ modelPose: models, bindings: boundAttachments });
assert.deepEqual(
  boundAttachmentTransforms.map((result) => result.id),
  ["hat", "armband"],
  "batch bound attachment evaluation should preserve attachment id order"
);
assert.deepEqual(
  boundAttachmentTransforms.map((result) => result.jointIndex),
  [2, 3],
  "batch bound attachment evaluation should preserve resolved joint order"
);
assertMat4NearlyEqual(boundAttachmentTransforms[0]!.transform, expectedAttachment, 1e-6, "batch bound attachment should evaluate the first binding");
assertMat4NearlyEqual(boundAttachmentTransforms[1]!.transform, humanoidAttachment, 1e-6, "batch bound attachment should evaluate the second binding");

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
const rootCarrierSourcePolicyClip: AnimationClip = {
  id: "root-carrier-source-policy",
  duration: 1,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
    { joint: "pelvis", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
    { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
    { humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
  ]
};
assert.deepEqual(
  applySourceTrackPolicy(rootCarrierSourcePolicyClip, ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
  ["head.quaternion"],
  "source root translation policy should strip root, hips, and pelvis translation carriers"
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

const rotatedLocomotionPostureBones = new Map<string, Object3D>();
const rotatedLocomotionPostureRoot = new Object3D();
rotatedLocomotionPostureRoot.rotation.y = Math.PI / 2;
for (const name of locomotionUpperBodyTargets.map((target) => target.bone)) {
  const bone = new Object3D();
  bone.name = name;
  rotatedLocomotionPostureBones.set(name, bone);
}
const rotatedLocomotionPostureHips = new Object3D();
rotatedLocomotionPostureHips.name = "hips";
rotatedLocomotionPostureBones.set("hips", rotatedLocomotionPostureHips);
rotatedLocomotionPostureRoot.add(rotatedLocomotionPostureHips);
attachArmChain(rotatedLocomotionPostureRoot, rotatedLocomotionPostureBones, "left", 1);
attachArmChain(rotatedLocomotionPostureRoot, rotatedLocomotionPostureBones, "right", -1);
const rotatedPostureResult = applyThreeLocomotionUpperBodyPosture({
  resolveBone: (bone) => rotatedLocomotionPostureBones.get(bone),
  deltaSeconds: 1,
  phase: 0.125,
  influence: 1,
  speed: 100
});
assert.equal(rotatedPostureResult.applied, true, "locomotion posture should apply on a yawed avatar root");
rotatedLocomotionPostureRoot.updateMatrixWorld(true);
const rotatedForward = new Vector3(0, 0, -1)
  .applyQuaternion(rotatedLocomotionPostureHips.getWorldQuaternion(new Quaternion()))
  .setY(0)
  .normalize();
for (const side of ["left", "right"] as const) {
  const shoulder = rotatedLocomotionPostureBones.get(`${side}UpperArm`)!.getWorldPosition(new Vector3());
  const elbow = rotatedLocomotionPostureBones.get(`${side}LowerArm`)!.getWorldPosition(new Vector3());
  const hand = rotatedLocomotionPostureBones.get(`${side}Hand`)!.getWorldPosition(new Vector3());
  assert.ok(signedJointForwardOffset(shoulder, elbow, hand, rotatedForward) > -0.005, "locomotion posture elbows should follow avatar forward on yawed roots");
}

const runtime = new AnimationRuntime(skeleton);
runtime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
runtime.update(0.5);
const evaluated = runtime.evaluate();
assert.ok(evaluated.activeLayers.length === 1);
assert.ok(evaluated.localPose[2]!.rotation[0] > 0.1);
assert.equal(evaluated.diagnostics, undefined);

const runtimeBackwardCompatibleUpdate = new AnimationRuntime(skeleton);
runtimeBackwardCompatibleUpdate.setLayer("fading", nodClip, { weight: 0.0004, targetWeight: 0, fadeSpeed: 8 });
runtimeBackwardCompatibleUpdate.update(1);
assert.equal(runtimeBackwardCompatibleUpdate.evaluate().activeLayers.length, 0, "update without root-motion collection should keep removing faded layers");

const runtimeRootMotion = new AnimationRuntime(motionSkeleton);
runtimeRootMotion.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true });
const runtimeRootMotionUpdate = runtimeRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(runtimeRootMotionUpdate.rootMotionDelta.translation, [5, 0, 0], "runtime root motion should collect root carrier interval translation");
assert.ok(
  quaternionNearlyEqual(runtimeRootMotionUpdate.rootMotionDelta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
  "runtime root motion should collect root carrier interval rotation"
);
assert.equal(runtimeRootMotionUpdate.rootMotionLayers[0]?.carrier.joint, "root");
assert.equal(runtimeRootMotion.evaluate().localPose[0]!.translation[0], 5, "root-motion collection should not strip or separately apply pose motion");

const runtimeLoopingTime = new AnimationRuntime(motionSkeleton);
runtimeLoopingTime.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.75 });
const runtimeLoopingTimeUpdate = runtimeLoopingTime.update(2.5, { collectRootMotion: true });
assert.equal(runtimeLoopingTime.evaluate().activeLayers[0]?.time, 0.25, "looping runtime layers should store wrapped clip time after update");
assert.equal(runtimeLoopingTimeUpdate.rootMotionLayers[0]?.fromTime, 0.75, "root-motion diagnostics should keep the unwrapped interval start");
assert.equal(runtimeLoopingTimeUpdate.rootMotionLayers[0]?.toTime, 3.25, "root-motion diagnostics should keep the unwrapped interval end");
assert.deepEqual(runtimeLoopingTimeUpdate.rootMotionDelta.translation, [25, 0, 0], "multi-loop runtime root motion should accumulate the full update span");

const runtimeLoopBoundary = new AnimationRuntime(motionSkeleton);
runtimeLoopBoundary.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.5 });
runtimeLoopBoundary.update(0.5);
assert.equal(runtimeLoopBoundary.evaluate().activeLayers[0]?.time, 0, "looping runtime layers should wrap exact duration endpoints to zero");

const runtimeNonLoopingTime = new AnimationRuntime(motionSkeleton);
runtimeNonLoopingTime.setLayer("move-once", motionClip, { weight: 1, targetWeight: 1, loop: false, time: 0.75 });
runtimeNonLoopingTime.update(2.5);
assert.equal(runtimeNonLoopingTime.evaluate().activeLayers[0]?.time, 1, "non-looping runtime layers should clamp to finite clip duration");

const runtimeZeroDurationClip: AnimationClip = { id: "runtime-zero-duration", duration: 0, loop: true, tracks: [] };
const runtimeNonFiniteDurationClip: AnimationClip = { id: "runtime-non-finite-duration", duration: Number.NaN, loop: true, tracks: [] };
const runtimeInvalidDurationTime = new AnimationRuntime(motionSkeleton);
runtimeInvalidDurationTime.setLayer("zero", runtimeZeroDurationClip, { weight: 1, targetWeight: 1, loop: true, time: 0.25 });
runtimeInvalidDurationTime.setLayer("nan", runtimeNonFiniteDurationClip, { weight: 1, targetWeight: 1, loop: true, time: 0.25 });
runtimeInvalidDurationTime.update(0.5);
assert.deepEqual(
  runtimeInvalidDurationTime.evaluate().activeLayers.map((layer) => [layer.id, layer.time]),
  [["nan", 0.75], ["zero", 0.75]],
  "invalid-duration runtime layers should keep finite advanced times instead of wrapping through invalid durations"
);

const runtimeHumanoidRootMotion = new AnimationRuntime(motionSkeleton);
runtimeHumanoidRootMotion.setLayer("hips-move", motionClip, { weight: 1, targetWeight: 1, motionCarrier: { humanBone: "hips" } });
const runtimeHumanoidMotionUpdate = runtimeHumanoidRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(runtimeHumanoidMotionUpdate.rootMotionDelta.translation, [0, 0, 3], "runtime root motion should support explicit humanoid carriers");
assert.equal(runtimeHumanoidMotionUpdate.rootMotionLayers[0]?.carrier.joint, "hips");

const runtimeInvalidRootMotion = new AnimationRuntime(motionSkeleton);
const runtimeInvalidLayer = runtimeInvalidRootMotion.setLayer("invalid", motionClip, { weight: 1, targetWeight: 1, loop: true });
runtimeInvalidLayer.time = Number.POSITIVE_INFINITY;
runtimeInvalidLayer.speed = Number.POSITIVE_INFINITY;
const invalidRootMotionUpdate = runtimeInvalidRootMotion.update(Number.NaN, { collectRootMotion: true });
assert.deepEqual(invalidRootMotionUpdate.rootMotionDelta, identityTransform(), "non-finite root-motion update input should produce identity motion");
assert.equal(invalidRootMotionUpdate.rootMotionLayers.length, 0, "non-finite root-motion update input should not emit unsafe layer deltas");

const runtimeZeroWeightRootMotion = new AnimationRuntime(motionSkeleton);
runtimeZeroWeightRootMotion.setLayer("zero", motionClip, { weight: 0, targetWeight: 0, loop: true });
const zeroWeightRootMotionUpdate = runtimeZeroWeightRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(zeroWeightRootMotionUpdate.rootMotionDelta, identityTransform(), "zero-weight root-motion layers should produce identity motion");
assert.equal(zeroWeightRootMotionUpdate.rootMotionLayers.length, 0, "zero-weight root-motion layers should not emit diagnostics");

const maskedMotionPoseClip: AnimationClip = {
  id: "masked-motion-pose",
  duration: 1,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
    { joint: "spine", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.5, 0]) }
  ]
};
const runtimeMaskedRootMotion = new AnimationRuntime(motionSkeleton);
runtimeMaskedRootMotion.setLayer("upper-body", maskedMotionPoseClip, {
  weight: 1,
  targetWeight: 1,
  mask: createJointMask(motionSkeleton, 0, { spine: 1 })
});
const maskedRootMotionUpdate = runtimeMaskedRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(maskedRootMotionUpdate.rootMotionDelta, identityTransform(), "masked-out root carrier should not contribute root motion");
assert.equal(maskedRootMotionUpdate.rootMotionLayers.length, 0, "masked-out root carrier should not emit root-motion diagnostics");
assert.deepEqual(
  runtimeMaskedRootMotion.evaluate().localPose[2]!.translation,
  [0, 0.25, 0],
  "root-motion masking should still allow the layer to own unmasked pose joints"
);

const weightedMotionA: AnimationClip = {
  id: "weighted-motion-a",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
};
const weightedMotionB: AnimationClip = {
  id: "weighted-motion-b",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 2, 0, 0]) }]
};
const runtimeWeightedRootMotion = new AnimationRuntime(motionSkeleton);
runtimeWeightedRootMotion.setLayer("motion-a", weightedMotionA, { weight: 3, targetWeight: 3, priority: 2 });
runtimeWeightedRootMotion.setLayer("motion-b", weightedMotionB, { weight: 1, targetWeight: 1, priority: 2 });
const weightedRootMotionUpdate = runtimeWeightedRootMotion.update(0.5, { collectRootMotion: true });
assert.ok(Math.abs(weightedRootMotionUpdate.rootMotionDelta.translation[0] - 4) < 1e-6, "same-priority root motion should normalize positive override weights");
assert.ok(weightedRootMotionUpdate.rootMotionDelta.translation.every(Number.isFinite), "weighted root motion should stay finite");
assert.deepEqual(
  weightedRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
  [["motion-a", 0.75], ["motion-b", 0.25]],
  "weighted root-motion diagnostics should be deterministic"
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
runtimeFadeInIntervalRootMotion.setLayer("fade-in", weightedMotionA, { weight: 0, targetWeight: 1, fadeSpeed: Math.log(4) });
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
runtimeFadeOutIntervalRootMotion.setLayer("fade-out", weightedMotionA, { weight: 1, targetWeight: 0, fadeSpeed: Math.log(4) });
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
  [["masked-motion-a", 0.5, 1 / 3], ["motion-b", 1, 2 / 3]],
  "fractional carrier masks should be reflected in root-motion diagnostics"
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
  maskedFadeIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
  [["masked-fade-in", 0.1875, 1]],
  "masked fade-in root-motion diagnostics should report the interval masked effective weight"
);

const weakPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
weakPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
weakPriorityRootMotion.setLayer("weak-override-motion", weightedMotionB, { weight: 0.05, targetWeight: 0.05, priority: 1 });
const weakPriorityRootMotionUpdate = weakPriorityRootMotion.update(1, { collectRootMotion: true });
assert.ok(
  Math.abs(weakPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 6) < 1e-6,
  "under-threshold higher-priority root motion should partially blend with lower-priority fallback motion"
);
assert.deepEqual(
  weakPriorityRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
  [["base-motion", 1], ["weak-override-motion", 1]],
  "priority fallback root-motion diagnostics should preserve per-group normalized weights"
);

const thresholdPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
thresholdPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
thresholdPriorityRootMotion.setLayer("threshold-override-motion", weightedMotionB, { weight: 0.1, targetWeight: 0.1, priority: 1 });
const thresholdPriorityRootMotionUpdate = thresholdPriorityRootMotion.update(1, { collectRootMotion: true });
assert.ok(
  Math.abs(thresholdPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 2) < 1e-6,
  "at-threshold higher-priority root motion should fully replace lower-priority fallback motion"
);

const oppositeMotionA: AnimationClip = {
  id: "opposite-motion-a",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
};
const oppositeMotionB: AnimationClip = {
  id: "opposite-motion-b",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, -10, 0, 0]) }]
};
const runtimeOppositeRootMotion = new AnimationRuntime(motionSkeleton);
runtimeOppositeRootMotion.setLayer("opposite-a", oppositeMotionA, { weight: 1, targetWeight: 1, priority: 3 });
runtimeOppositeRootMotion.setLayer("opposite-b", oppositeMotionB, { weight: 1, targetWeight: 1, priority: 3 });
const oppositeRootMotionUpdate = runtimeOppositeRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(oppositeRootMotionUpdate.rootMotionDelta.translation, [0, 0, 0], "opposite equal root-motion directions should cancel instead of sequentially accumulating length");
assert.deepEqual(oppositeRootMotionUpdate.rootMotionDelta.scale, [1, 1, 1], "blended root-motion deltas should keep identity scale");

const orthogonalMotionA: AnimationClip = {
  id: "orthogonal-motion-a",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
};
const orthogonalMotionB: AnimationClip = {
  id: "orthogonal-motion-b",
  duration: 1,
  tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 10]) }]
};
const runtimeOrthogonalRootMotion = new AnimationRuntime(motionSkeleton);
runtimeOrthogonalRootMotion.setLayer("orthogonal-a", orthogonalMotionA, { weight: 1, targetWeight: 1, priority: 4 });
runtimeOrthogonalRootMotion.setLayer("orthogonal-b", orthogonalMotionB, { weight: 1, targetWeight: 1, priority: 4 });
const orthogonalRootMotionUpdate = runtimeOrthogonalRootMotion.update(1, { collectRootMotion: true });
assert.deepEqual(orthogonalRootMotionUpdate.rootMotionDelta.translation, [5, 0, 5], "orthogonal equal root-motion deltas should blend to the weighted vector average");

const rotationOrderMotionA: AnimationClip = {
  id: "rotation-order-motion-a",
  duration: 1,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 10]) },
    { joint: "root", property: "quaternion", times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)]) }
  ]
};
const rotationOrderMotionB: AnimationClip = {
  id: "rotation-order-motion-b",
  duration: 1,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
    { joint: "root", property: "quaternion", times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 2)]) }
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
assert.deepEqual(rootMotionOrderUpdateA.rootMotionDelta.translation, rootMotionOrderUpdateB.rootMotionDelta.translation, "same-priority root-motion translation should be independent of layer id/order");
assert.ok(
  quaternionNearlyEqual(rootMotionOrderUpdateA.rootMotionDelta.rotation, rootMotionOrderUpdateB.rootMotionDelta.rotation, 1e-6),
  "same-priority root-motion rotation should be independent of layer id/order"
);

const runtimeAdditiveRootMotion = new AnimationRuntime(motionSkeleton);
runtimeAdditiveRootMotion.setLayer("base", weightedMotionB, { weight: 1, targetWeight: 1 });
runtimeAdditiveRootMotion.setLayer("additive-motion", weightedMotionA, { weight: 1, targetWeight: 1, blendMode: "additive" });
const additiveRootMotionUpdate = runtimeAdditiveRootMotion.update(0.5, { collectRootMotion: true });
assert.deepEqual(additiveRootMotionUpdate.rootMotionDelta.translation, [1, 0, 0], "additive layers should not contribute to runtime root motion");
assert.deepEqual(additiveRootMotionUpdate.rootMotionLayers.map((layer) => layer.id), ["base"]);

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
assert.ok(
  invalidEvaluation.diagnostics!.some(
    (issue) =>
      issue.stage === "sample" &&
      issue.layerId === "invalid-source" &&
      issue.clipId === "invalid-translation-scale" &&
      issue.track === 0 &&
      issue.sample === 0 &&
      issue.joint === "spine" &&
      issue.index === 1 &&
      issue.message === "translation track sample values were repaired to finite defaults"
  ),
  "runtime diagnostics should report translation samples repaired during sampling"
);
assert.ok(
  invalidEvaluation.diagnostics!.some(
    (issue) =>
      issue.stage === "sample" &&
      issue.layerId === "invalid-source" &&
      issue.clipId === "invalid-translation-scale" &&
      issue.track === 1 &&
      issue.sample === 0 &&
      issue.joint === "head" &&
      issue.index === 2 &&
      issue.message === "scale track sample values were repaired to finite defaults"
  ),
  "runtime diagnostics should report scale samples repaired during sampling"
);
assert.equal(
  invalidEvaluation.diagnostics!.some((issue) => issue.stage === "final" && issue.joint === "spine"),
  false,
  "translation and scale sample repairs should prevent final-pose diagnostics for the repaired joints"
);
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
const sourceSampleWithLocalDelta = multiplyQuat(sourceRestX, localSourceDeltaY);
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
const expectedEquivalentRestDelta = multiplyQuat(invertQuat(sourceRestX), sourceSampleWithLocalDelta);
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
const retargetedNaNTrack = retargetQuaternionTrackValues([0, Number.NaN, 0, 1], undefined, [0, 0, 0, 1]);
assert.equal(retargetedNaNTrack.invalidSamples, 1, "retargeted quaternion tracks should count NaN source samples as invalid");
assert.ok(
  quaternionNearlyEqual(retargetedNaNTrack.values, [0, 0, 0, 1], 1e-5),
  "retargeted quaternion tracks should repair NaN source samples to a normalized fallback"
);
const retargetedZeroTrack = retargetQuaternionTrackValues([0, 0, 0, 0], undefined, [0, 0, 0, 1]);
assert.equal(retargetedZeroTrack.invalidSamples, 1, "retargeted quaternion tracks should count zero source samples as invalid");
assert.ok(
  quaternionNearlyEqual(retargetedZeroTrack.values, [0, 0, 0, 1], 1e-5),
  "retargeted quaternion tracks should repair zero source samples to a normalized fallback"
);
const retargetedZeroTrackWithSourceRest = retargetQuaternionTrackValues([0, 0, 0, 0], sourceRestX, targetRestZ);
assert.equal(retargetedZeroTrackWithSourceRest.invalidSamples, 1, "source-rest retargeted tracks should count zero source samples as invalid");
assert.ok(
  quaternionNearlyEqual(retargetedZeroTrackWithSourceRest.values, targetRestZ, 1e-5),
  "source-rest retargeted tracks should repair zero source samples to the target rest instead of applying an inverse source-rest delta"
);
const retargetedNaNTrackWithSourceRest = retargetQuaternionTrackValues([Number.NaN, 0, 0, 1], sourceRestX, targetRestZ);
assert.equal(retargetedNaNTrackWithSourceRest.invalidSamples, 1, "source-rest retargeted tracks should count non-finite source samples as invalid");
assert.ok(
  quaternionNearlyEqual(retargetedNaNTrackWithSourceRest.values, targetRestZ, 1e-5),
  "source-rest retargeted tracks should repair non-finite source samples to the target rest"
);
const retargetedNonUnitTrack = retargetQuaternionTrackValues([0, 0, 0, 2], undefined, [0, 0, 0, 1]);
assert.equal(retargetedNonUnitTrack.invalidSamples, 0, "retargeted quaternion tracks should accept normalizable non-unit source samples");
assert.ok(
  quaternionNearlyEqual(retargetedNonUnitTrack.values, [0, 0, 0, 1], 1e-5),
  "retargeted quaternion tracks should normalize non-unit source samples without changing their rotation"
);
const childDirectionMetadataDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
const childDirectionMetadataRetargeted = retargetQuaternionSample(
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  childDirectionMetadataDelta,
  "leftUpperArm",
  undefined,
  [0, 1, 0],
  [1, 0, 0]
);
assert.ok(
  quaternionNearlyEqual(childDirectionMetadataRetargeted, childDirectionMetadataDelta, 1e-5),
  "source/target child-direction metadata must not silently conjugate local rotation deltas"
);
const targetChildDirectionHingeDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
const targetChildDirectionHingeRetargeted = retargetQuaternionSample(
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  targetChildDirectionHingeDelta,
  "leftLowerLeg",
  undefined,
  undefined,
  [0, -1, 0]
);
assert.ok(
  quaternionNearlyEqual(targetChildDirectionHingeRetargeted, targetChildDirectionHingeDelta, 1e-5),
  "target child direction alone must not trigger hidden hinge-axis remapping"
);
const explicitSourceBasis = quatFromUnitVectors([0, 0, 1], [1, 0, 0]);
const explicitBasisDelta = quatFromAxisAngle([0, 0, 1], Math.PI / 5);
const explicitBasisExpected = multiplyQuat(multiplyQuat(explicitSourceBasis, explicitBasisDelta), invertQuat(explicitSourceBasis));
const explicitBasisWithChildDirections = retargetQuaternionSample(
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  explicitBasisDelta,
  "leftLowerLeg",
  explicitSourceBasis,
  [0, 1, 0],
  [1, 0, 0]
);
assert.ok(
  quaternionNearlyEqual(explicitBasisWithChildDirections, explicitBasisExpected, 1e-5),
  "explicit source-basis correction must not be overridden by child-direction metadata"
);

const mismatchedBasisSourceRest = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
const mismatchedBasisTargetRest = [0, 0, 0, 1] as const;
const mismatchedBasisDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
const mismatchedBasisSample = multiplyQuat(mismatchedBasisSourceRest, mismatchedBasisDelta);
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
    mismatchedBasisSample,
    invertQuat(mismatchedBasisSourceRest)
  ),
  [0, 1, 0]
);
assert.ok(
  !vectorNearlyEqual(mismatchedBasisExpected, mismatchedBasisConjugatedPath, 1e-4),
  "basis fixture should distinguish local delta retargeting from rest-basis conjugation"
);
assert.ok(vectorNearlyEqual(mismatchedBasisActual, mismatchedBasisExpected, 1e-5), "Three retargeting should render child direction from the source local delta");

const invalidSourceRestTrackBones = createSingleLimbBones([0, 0, 0, 1], "leftUpperArm", "leftLowerArm", [0, 1, 0]);
const invalidSourceRestTrackClip = createThreeAnimationClip(
  {
    id: "invalid-source-rest-sample",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperArm",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(sourceRestX),
        times: toFloat32Array([0, 1]),
        values: Float32Array.from([...sourceRestX, 0, 0, 0, 0])
      }
    ]
  },
  {
    resolveBone: (bone) => (bone === "leftUpperArm" ? invalidSourceRestTrackBones.upper : null),
    targetRestQuaternion: () => targetRestZ
  }
);
sampleThreeClipOnce(invalidSourceRestTrackBones.root, invalidSourceRestTrackClip);
const invalidSourceRestTrackActual = readChildDirection(invalidSourceRestTrackBones.upper, invalidSourceRestTrackBones.lower);
const invalidSourceRestTrackExpected = rotateVec3ByQuat(targetRestZ, [0, 1, 0]);
assert.ok(
  vectorNearlyEqual(invalidSourceRestTrackActual, invalidSourceRestTrackExpected, 1e-5),
  "Three source-rest retargeting should hold target rest for invalid samples instead of applying inverse source-rest rotation"
);

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
const motusLegExpectedRotation = retargetQuaternionSample(motusRightUpperLegRest, motusTargetRest, motusRightUpperLegSample, "rightUpperLeg");
const motusLegExpected = rotateVec3ByQuat(motusLegExpectedRotation, [0, -1, 0]);
assert.ok(vectorNearlyEqual(motusLegActual, motusLegExpected, 1e-5), "right leg should preserve forward local stride instead of twisting inward");

const realMotusWalkLegSamples: Array<{
  bone: "leftUpperLeg" | "rightUpperLeg" | "leftLowerLeg" | "rightLowerLeg";
  rest: [number, number, number, number];
  sample: [number, number, number, number];
}> = [
  {
    bone: "leftUpperLeg",
    rest: [0.073705, -0.062139, -0.008584, 0.995305],
    sample: [0.180756, 0.001265, 0.277474, 0.943575]
  },
  {
    bone: "rightUpperLeg",
    rest: [0.062139, 0.073705, 0.995305, 0.008584],
    sample: [0.004475, 0.157648, 0.956273, -0.246312]
  },
  {
    bone: "leftLowerLeg",
    rest: [-0.048884, 0.018864, -0.065522, 0.996474],
    sample: [-0.084341, -0.082607, -0.595885, 0.794345]
  },
  {
    bone: "rightLowerLeg",
    rest: [-0.048884, 0.018864, -0.065522, 0.996474],
    sample: [-0.03445, -0.020477, -0.584123, 0.810675]
  }
];
for (const fixture of realMotusWalkLegSamples) {
  const unremappedDirection = rotateVec3ByQuat(retargetQuaternionSample(fixture.rest, motusTargetRest, fixture.sample), [0, -1, 0]);
  const retargetedDirection = rotateVec3ByQuat(retargetQuaternionSample(fixture.rest, motusTargetRest, fixture.sample, fixture.bone), [0, -1, 0]);
  assert.ok(
    vectorNearlyEqual(retargetedDirection, unremappedDirection, 1e-5),
    `${fixture.bone} retargeting must not apply hidden bone-name axis swizzles`
  );
}

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
        values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestLeft, ...multiplyQuat(mirroredLegSourceRestLeft, mirroredLegFlexion)])
      },
      {
        humanBone: "rightUpperLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLegSourceRestRight),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestRight, ...multiplyQuat(mirroredLegSourceRestRight, mirroredLegFlexion)])
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
const oldOrderMirroredLeft = rotateVec3ByQuat(multiplyQuat(multiplyQuat(mirroredLegSourceRestLeft, mirroredLegFlexion), invertQuat(mirroredLegSourceRestLeft)), [0, -1, 0]);
const oldOrderMirroredRight = rotateVec3ByQuat(multiplyQuat(multiplyQuat(mirroredLegSourceRestRight, mirroredLegFlexion), invertQuat(mirroredLegSourceRestRight)), [0, -1, 0]);
assert.ok(Math.abs(oldOrderMirroredLeft[0]!) > 0.65 && Math.abs(oldOrderMirroredRight[0]!) > 0.65, "old retarget order would split mirrored leg flexion laterally across the centerline");
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
  "Motus lower-leg fixture keeps documenting the source/target basis incompatibility"
);
assert.ok(
  vectorNearlyEqual(motusLeftLowerLegRetargetedDirection, motusLeftLowerLegRawDirection, 1e-5) &&
    vectorNearlyEqual(motusRightLowerLegRetargetedDirection, motusRightLowerLegRawDirection, 1e-5),
  "Motus lower-leg labels must not alter the mathematically defined local delta"
);

const normalLowerLegRest: [number, number, number, number] = quatFromAxisAngle([1, 0, 0], Math.PI / 7);
const normalLowerLegLocalDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 5);
const normalLowerLegSample = multiplyQuat(normalLowerLegRest, normalLowerLegLocalDelta);
assert.ok(
  quaternionNearlyEqual(
    retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample, "leftLowerLeg"),
    retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample),
    1e-5
  ),
  "lower-leg bone labels should not affect source-rest local delta retargeting"
);

const motusManLimbSourceBasis = quatFromUnitVectors([0, 0, 1], [1, 0, 0]);
const motusLowerLegSourceRest = quatFromAxisAngle([0, 0, 1], 0.2);
const motusLowerLegSourceFlexion = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const motusLowerLegSourceSample = multiplyQuat(motusLowerLegSourceRest, motusLowerLegSourceFlexion);
const motusLowerLegUncorrectedDirection = rotateVec3ByQuat(
  retargetQuaternionSample(motusLowerLegSourceRest, [0, 0, 0, 1], motusLowerLegSourceSample),
  [0, -1, 0]
);
const motusLowerLegCorrectedDirection = rotateVec3ByQuat(
  retargetQuaternionSample(motusLowerLegSourceRest, [0, 0, 0, 1], motusLowerLegSourceSample, "leftLowerLeg", motusManLimbSourceBasis),
  [0, -1, 0]
);
assert.ok(Math.abs(motusLowerLegUncorrectedDirection[0]!) > 0.85, "MotusMan lower-leg Z-axis flexion reproduces sideways VRM shin motion without a source-basis correction");
assert.ok(
  Math.abs(motusLowerLegCorrectedDirection[0]!) < 1e-5 && motusLowerLegCorrectedDirection[2]! < -0.85,
  "MotusMan lower-leg source-basis correction should turn sideways shin motion into forward/back flexion"
);

const motusBasisThreeBones = createSingleLimbBones([0, 0, 0, 1], "leftLowerLeg", "leftFoot", [0, -1, 0]);
const motusBasisThreeClip = createThreeAnimationClip(
  {
    id: "motusman-source-basis-lower-leg",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(motusLowerLegSourceRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...motusLowerLegSourceRest, ...motusLowerLegSourceSample])
      }
    ]
  },
  {
    resolveBone: (bone) => (bone === "leftLowerLeg" ? motusBasisThreeBones.upper : null),
    targetRestQuaternion: () => [0, 0, 0, 1],
    sourceBasisQuaternion: () => motusManLimbSourceBasis
  }
);
sampleThreeClipOnce(motusBasisThreeBones.root, motusBasisThreeClip);
const motusBasisThreeDirection = readChildDirection(motusBasisThreeBones.upper, motusBasisThreeBones.lower);
assert.ok(
  vectorNearlyEqual(motusBasisThreeDirection, motusLowerLegCorrectedDirection, 1e-5),
  "Three retargeting should apply caller-provided source-basis correction before binding MotusMan limb tracks"
);

const motusBasisCoreSkeleton = createSkeleton([
  { name: "leftLowerLeg", humanoid: "leftLowerLeg" },
  { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -1, 0] } }
]);
const motusBasisCoreClip: AnimationClip = {
  id: "motusman-source-basis-core-lower-leg",
  duration: 1,
  tracks: [
    {
      humanBone: "leftLowerLeg",
      property: "quaternion",
      sourceRestQuaternion: Float32Array.from(motusLowerLegSourceRest),
      times: toFloat32Array([0, 1]),
      values: sanitizeQuaternionTrackValues([...motusLowerLegSourceRest, ...motusLowerLegSourceSample])
    }
  ]
};
const motusBasisCorePose = sampleClipToPose(motusBasisCoreSkeleton, motusBasisCoreClip, 1, {
  sourceBasisQuaternion: () => motusManLimbSourceBasis
});
assert.ok(
  vectorNearlyEqual(rotateVec3ByQuat(motusBasisCorePose[0]!.rotation, [0, -1, 0]), motusLowerLegCorrectedDirection, 1e-5),
  "core pose sampling should apply caller-provided source-basis correction before local-pose retargeting"
);
const motusBasisCoreRuntime = new AnimationRuntime(motusBasisCoreSkeleton);
motusBasisCoreRuntime.setLayer("motus-lower-leg", motusBasisCoreClip, {
  time: 1,
  weight: 1,
  sourceBasisQuaternion: () => motusManLimbSourceBasis
});
assert.ok(
  vectorNearlyEqual(rotateVec3ByQuat(motusBasisCoreRuntime.evaluate().localPose[0]!.rotation, [0, -1, 0]), motusLowerLegCorrectedDirection, 1e-5),
  "AnimationRuntime should pass source-basis correction through to sampled mocap layers"
);

const mirroredLimbSourceRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const mirroredLimbSourceRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
const mirroredLimbTargetRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const mirroredLimbTargetRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
const mirroredLimbDelta = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
const mirroredLimbSourceSampleLeft = multiplyQuat(mirroredLimbSourceRestLeft, mirroredLimbDelta);
const mirroredLimbSourceSampleRight = multiplyQuat(mirroredLimbSourceRestRight, mirroredLimbDelta);
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
        values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestLeft, ...mirroredLimbSourceSampleLeft])
      },
      {
        humanBone: "rightUpperArm",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(mirroredLimbSourceRestRight),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestRight, ...mirroredLimbSourceSampleRight])
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
  left: rotateVec3ByQuat(multiplyQuat(mirroredLimbTargetRestLeft, mirroredLimbDelta), [0, 1, 0]),
  right: rotateVec3ByQuat(multiplyQuat(mirroredLimbTargetRestRight, mirroredLimbDelta), [0, 1, 0])
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
const behindLook = distributeLookAt([0, 0, -1], { maxYaw: 0.5 });
assert.equal(behindLook.eyes.yaw, 0.21, "directly behind targets should clamp toward the yaw limit instead of collapsing to center");
const hostileLook = distributeLookAt([Number.NaN, Infinity, -1], {
  maxYaw: Number.POSITIVE_INFINITY,
  maxPitch: Number.NaN,
  eyeLead: Number.NaN,
  headWeight: Number.POSITIVE_INFINITY,
  neckWeight: Number.NEGATIVE_INFINITY,
  spineWeight: -4,
  torsoWeight: 3
});
assert.ok(
  Object.values(hostileLook).every((part) => Number.isFinite(part.yaw) && Number.isFinite(part.pitch) && Number.isFinite(part.weight)),
  "look-at distribution should stay finite when options contain non-finite limits or weights"
);
assert.ok(
  Object.values(hostileLook).every((part) => Math.abs(part.yaw) <= 0.85 && Math.abs(part.pitch) <= 0.52),
  "look-at distribution should clamp unsafe option multipliers to bounded corrections"
);
const attention = new AttentionScheduler("attention-safety");
const noPositiveAttention = attention.choose(Number.NaN, [
  { id: "nan", position: [Number.NaN, 0, 0], weight: Number.NaN },
  { id: "zero", position: [0, 0, 1], weight: 0 },
  { id: "infinite", position: [0, 1, 0], weight: Number.POSITIVE_INFINITY },
  { id: "negative", position: [1, 0, 0], weight: -4 }
]);
assert.equal(noPositiveAttention, null, "attention scheduler should return null when no target has a positive finite weight");
const weightedAttention = new AttentionScheduler("attention-weighted-safety");
const finiteWeightedAttention = weightedAttention.choose(1_000, [
  { id: "ignored-nan", position: [0, 0, 1], weight: Number.NaN },
  { id: "valid", position: [1, 0, 0], weight: 1 }
]);
assert.equal(finiteWeightedAttention?.id, "valid", "NaN attention weights should not poison weighted selection");
const invalidPositionAttention = new AttentionScheduler("attention-position-safety");
const finitePositionAttention = invalidPositionAttention.choose(1_000, [
  { id: "ignored-nan-position", position: [Number.NaN, 0, 1], weight: 100 },
  { id: "ignored-infinite-position", position: [0, Number.POSITIVE_INFINITY, 1], weight: 100 },
  { id: "valid-position", position: [0, 1, 1], weight: 1 }
]);
assert.equal(finitePositionAttention?.id, "valid-position", "invalid attention target positions should be ignored");
const disabledDwellAttention = new AttentionScheduler("attention-disabled-dwell");
assert.equal(
  disabledDwellAttention.choose(100, [{ id: "initial", position: [0, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
  "initial"
);
assert.equal(
  disabledDwellAttention.choose(
    101,
    [
      { id: "initial-disabled", position: [0, 0, 1], weight: 0 },
      { id: "replacement", position: [1, 0, 1], weight: 1 }
    ],
    10_000,
    10_000
  )?.id,
  "replacement",
  "disabled current attention target should not be retained until dwell expires"
);
const invalidDwellAttention = new AttentionScheduler("attention-invalid-dwell");
assert.equal(
  invalidDwellAttention.choose(100, [{ id: "initial", position: [0, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
  "initial"
);
assert.equal(
  invalidDwellAttention.choose(
    101,
    [
      { id: "initial-invalid", position: [0, Number.NaN, 1], weight: 1 },
      { id: "replacement", position: [1, 0, 1], weight: 1 }
    ],
    10_000,
    10_000
  )?.id,
  "replacement",
  "invalid current attention target should not be retained until dwell expires"
);
const deterministicAttentionA = new AttentionScheduler("attention-deterministic");
const deterministicAttentionB = new AttentionScheduler("attention-deterministic");
const deterministicTargets: Parameters<AttentionScheduler["choose"]>[1] = [
  { id: "low", position: [0, 0, 1], weight: 1 },
  { id: "high", position: [1, 0, 1], weight: 5 },
  { id: "ignored", position: [0, 1, 1], weight: 0 }
];
assert.equal(
  deterministicAttentionA.choose(500, deterministicTargets)?.id,
  deterministicAttentionB.choose(500, deterministicTargets)?.id,
  "positive-weight attention selection should remain deterministic under a fixed seed"
);
const finiteDwellAttention = new AttentionScheduler("attention-dwell");
assert.equal(
  finiteDwellAttention.choose(Number.POSITIVE_INFINITY, [{ id: "finite-dwell", position: [0, 0, 1], weight: 1 }], Number.NaN, Number.POSITIVE_INFINITY)?.id,
  "finite-dwell",
  "non-finite dwell and now inputs should not prevent a finite scheduler choice"
);
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
const nonFiniteInputIk = solveTwoBoneIk({
  root: [Number.NaN, 0, 0],
  joint: [0, Number.NaN, 0],
  end: [0, -2, Number.POSITIVE_INFINITY],
  target: [0, -1.5, Number.NaN],
  pole: [Number.NaN, Number.NaN, Number.NaN],
  maxStretch: Number.NaN
});
assert.ok(nonFiniteInputIk.joint.every(Number.isFinite) && nonFiniteInputIk.end.every(Number.isFinite), "IK should repair non-finite chain and target inputs");
assert.ok(Number.isFinite(nonFiniteInputIk.solvedReach), "IK reach reporting should stay finite for repaired non-finite inputs");
const minimumReachIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -1.5, 0], target: [0, -0.5, 0], pole: [0, 0, 1], maxStretch: 1 });
assert.equal(minimumReachIk.clamped, false, "exact minimum-reach targets should not be treated as clamped");
assert.ok(minimumReachIk.solvedReach <= 1.000001, "minimum-reach solves must not report more than full target reach");
assert.ok(Math.hypot(minimumReachIk.end[0], minimumReachIk.end[1] + 0.5, minimumReachIk.end[2]) < 1e-6, "minimum-reach solves should keep the endpoint on the target");
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
const zeroMaxAnkleCorrectionPlant = solveFootPlant(
  [{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.2, 0], ground: { point: [0, 0, 0], normal: [0, 1, 0] } }],
  { footHeight: 0.08, maxAnkleCorrection: 0 }
);
assert.equal(zeroMaxAnkleCorrectionPlant.legs[0]!.clamped, true, "zero max ankle correction should clamp any non-zero correction");
assert.equal(zeroMaxAnkleCorrectionPlant.legs[0]!.correctionDistance, 0, "zero max ankle correction should leave the ankle target unchanged");
assert.deepEqual(zeroMaxAnkleCorrectionPlant.pelvisOffset, [0, 0, 0]);
const boundaryReachPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: [0, 0, 0],
      knee: [0, -1, 0],
      ankle: [0, -2, 0],
      ground: { point: [1, -1.08, 0], normal: [0, 1, 0], rayStart: [1, -0.5, 0] },
      footHeight: 0.08,
      maxAnkleCorrection: 2,
      maxStretch: 0.5
    }
  ],
  { footHeight: 0.08, maxAnkleCorrection: 2, maxPelvisOffset: 2, maxStretch: 0.5 }
);
assert.ok(boundaryReachPlant.pelvisOffset[1] < -0.999, "reach compensation should handle targets exactly on the horizontal reach boundary");
assert.equal(boundaryReachPlant.legs[0]!.ik?.stretchLimited, false, "boundary reach compensation should avoid an artificial stretch-limited solve");
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
const invalidInputFootPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: [Number.NaN, 1, 0],
      knee: [0, Number.NaN, 0],
      ankle: [0, 0.1, Number.NaN],
      ground: { point: [Number.NaN, 0, 0], normal: [Number.NaN, Number.NaN, Number.NaN], rayStart: [0, Number.NaN, 0] }
    }
  ],
  { footHeight: 0.08, maxAnkleCorrection: 0.5, maxPelvisOffset: 0.5, maxStretch: 1 }
);
assert.ok(invalidInputFootPlant.pelvisOffset.every(Number.isFinite), "foot plant should repair non-finite pelvis input data");
assert.ok(
  invalidInputFootPlant.legs.every((leg) => leg.initialAnkle.every(Number.isFinite) && leg.targetAnkle.every(Number.isFinite) && (leg.ik?.end.every(Number.isFinite) ?? true)),
  "foot plant should keep leg outputs finite for non-finite contact inputs"
);

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
const scaledRoot = new Object3D();
scaledRoot.name = "scaledRoot";
scaledRoot.scale.set(2, 2, 2);
const scaledPelvis = new Object3D();
scaledPelvis.name = "hips";
scaledRoot.add(scaledPelvis);
scaledRoot.updateMatrixWorld(true);
const scaledPelvisBefore = scaledPelvis.getWorldPosition(new Vector3()).clone();
const scaledFootPlantApply = applyThreeFootPlantResult(
  { pelvisOffset: [0, -1, 0], plantedCount: 0, lowestCorrection: 1, legs: [], issues: [] },
  {
    resolveBone: (bone) => (bone === "hips" ? scaledPelvis : null),
    pelvis: "hips",
    legs: [],
    applyPelvis: true,
    applyLegIk: false
  }
);
scaledRoot.updateMatrixWorld(true);
const scaledPelvisAfter = scaledPelvis.getWorldPosition(new Vector3());
assert.equal(scaledFootPlantApply.pelvisApplied, true);
assert.ok(Math.abs(scaledFootPlantApply.pelvisOffsetLocal[1] + 0.5) < 1e-6, "world pelvis offsets should be converted through parent scale");
assert.ok(Math.abs(scaledPelvisAfter.y - scaledPelvisBefore.y + 1) < 1e-6, "scaled parent transforms should not amplify world pelvis offsets");

const anchoredReachRoot = new Object3D();
anchoredReachRoot.name = "anchoredReachRoot";
const anchoredReachPelvis = new Object3D();
anchoredReachPelvis.name = "hips";
const anchoredReachHip = new Object3D();
anchoredReachHip.name = "leftUpperLeg";
anchoredReachHip.position.set(-0.1, -0.05, 0);
const anchoredReachKnee = new Object3D();
anchoredReachKnee.name = "leftLowerLeg";
anchoredReachKnee.position.set(0, -0.45, 0.02);
const anchoredReachAnkle = new Object3D();
anchoredReachAnkle.name = "leftFoot";
anchoredReachAnkle.position.set(0, -0.45, -0.02);
anchoredReachRoot.add(anchoredReachPelvis);
anchoredReachPelvis.add(anchoredReachHip);
anchoredReachHip.add(anchoredReachKnee);
anchoredReachKnee.add(anchoredReachAnkle);
anchoredReachPelvis.position.set(0, 1, 0);
anchoredReachRoot.updateMatrixWorld(true);
const anchoredReachTarget = anchoredReachAnkle.getWorldPosition(new Vector3()).clone();
anchoredReachRoot.position.z = -0.18;
anchoredReachRoot.updateMatrixWorld(true);
const anchoredReachCurrentAnkle = anchoredReachAnkle.getWorldPosition(new Vector3());
const anchoredReachPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: anchoredReachHip.getWorldPosition(new Vector3()).toArray() as [number, number, number],
      knee: anchoredReachKnee.getWorldPosition(new Vector3()).toArray() as [number, number, number],
      ankle: anchoredReachCurrentAnkle.toArray() as [number, number, number],
      ground: {
        point: [anchoredReachTarget.x, anchoredReachTarget.y - 0.08, anchoredReachTarget.z],
        normal: [0, 1, 0],
        rayStart: [anchoredReachTarget.x, anchoredReachTarget.y + 0.5, anchoredReachTarget.z]
      },
      footHeight: 0.08,
      maxAnkleCorrection: 0.5,
      maxStretch: 1
    }
  ],
  { footHeight: 0.08, maxAnkleCorrection: 0.5, maxPelvisOffset: 0.08, pelvisCompensation: 1, maxStretch: 1 }
);
assert.ok(anchoredReachPlant.pelvisOffset[1] < -0.005, "foot plant should lower the pelvis when a planted ankle would otherwise overreach");
assert.ok(Math.abs(anchoredReachPlant.pelvisOffset[1]) <= 0.0801, "reach compensation should respect the configured pelvis limit");
assert.equal(anchoredReachPlant.legs[0]!.ik?.clamped, false, "pelvis reach compensation should keep the anchored ankle reachable");
applyThreeFootPlantResult(anchoredReachPlant, {
  resolveBone: (bone) =>
    ({
      hips: anchoredReachPelvis,
      leftUpperLeg: anchoredReachHip,
      leftLowerLeg: anchoredReachKnee,
      leftFoot: anchoredReachAnkle
    })[bone] ?? null,
  pelvis: "hips",
  legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot", alignAnkleToGround: false }],
  applyPelvis: true,
  applyLegIk: true
});
anchoredReachRoot.updateMatrixWorld(true);
const anchoredReachAppliedAnkle = anchoredReachAnkle.getWorldPosition(new Vector3());
assert.ok(
  anchoredReachAppliedAnkle.distanceTo(anchoredReachTarget) < 0.003,
  "Three foot plant application should keep an anchored ankle world-stable while the avatar root advances"
);

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

const partialAttackVisemes = new VisemeMixer({ attack: { aa: 60 }, release: 20, maxTotal: 1 });
partialAttackVisemes.setTarget({ aa: 0.5, ih: 0.5 });
const partialAttackMixed = partialAttackVisemes.update(1 / 30);
assert.ok(partialAttackMixed.ih > 0, "partial viseme attack maps should fall back for unspecified visemes");
assert.ok(Math.abs(partialAttackMixed.aa - 0.5 * dampAlpha(60, 1 / 30)) < 1e-6, "partial viseme attack maps should respect specified speeds");
assert.ok(Math.abs(partialAttackMixed.ih - 0.5 * dampAlpha(30, 1 / 30)) < 1e-6, "partial viseme attack maps should use the default attack speed");

const partialReleaseVisemes = new VisemeMixer({ attack: 30, release: { aa: 40 }, maxTotal: 1 });
partialReleaseVisemes.setTarget({ aa: 0.5, ih: 0.5 });
partialReleaseVisemes.update(1 / 30);
partialReleaseVisemes.setTarget({});
const beforePartialRelease = { ...partialReleaseVisemes.current };
const partialReleaseMixed = partialReleaseVisemes.update(1 / 30);
assert.ok(partialReleaseMixed.ih < beforePartialRelease.ih, "partial viseme release maps should fall back for unspecified visemes");
assert.ok(Math.abs(partialReleaseMixed.aa - beforePartialRelease.aa * (1 - dampAlpha(40, 1 / 30))) < 1e-6, "partial viseme release maps should respect specified speeds");
assert.ok(Math.abs(partialReleaseMixed.ih - beforePartialRelease.ih * (1 - dampAlpha(20, 1 / 30))) < 1e-6, "partial viseme release maps should use the default release speed");

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
const poseDeltaA = clonePose(skeleton.restPose);
const poseDeltaB = clonePose(skeleton.restPose);
poseDeltaB[1]!.translation = [0, 2, 0];
poseDeltaB[3]!.scale = [1, 3, 1];
poseDeltaB[2]!.rotation = poseDeltaB[2]!.rotation.map((component) => -component) as [number, number, number, number];
const poseDelta = poseDeltaMetric(poseDeltaA, poseDeltaB, skeleton);
assert.equal(poseDelta.samples, skeleton.restPose.length);
assert.equal(poseDelta.rotation.max, 0, "pose delta metrics should preserve sign-equivalent quaternion behavior");
assert.equal(poseDelta.translation.max, 2);
assert.equal(poseDelta.translation.maxIndex, 1);
assert.equal(poseDelta.translation.maxJoint, "spine");
assert.equal(poseDelta.scale.max, 2);
assert.equal(poseDelta.scale.maxIndex, 3);
assert.equal(poseDelta.scale.maxJoint, "leftUpperArm");
assert.ok(Math.abs(poseDelta.translation.rms - 1) < 1e-12);
assert.ok(Math.abs(poseDelta.scale.rms - 1) < 1e-12);

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

const hipsTranslationRuntimeRoot = new Object3D();
const hipsTranslationBone = new Object3D();
hipsTranslationBone.name = "hips";
hipsTranslationRuntimeRoot.add(hipsTranslationBone);
const hipsTranslationSourceClip: AnimationClip = {
  id: "hips-translation-source",
  duration: 1,
  loop: true,
  tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.25, 0]) }]
};
const preservedHipsTranslationClip = createThreeAnimationClip(hipsTranslationSourceClip, {
  resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
});
createThreeRuntimeClipsForEntry(
  {
    id: "preserved-hips-translation",
    label: "Preserved Hips Translation",
    url: "/preserved-hips-translation.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true,
    source: { rootMotion: { policy: "preserved" } }
  },
  new AnimationMixer(hipsTranslationRuntimeRoot),
  preservedHipsTranslationClip
);
assert.equal(
  preservedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
  true,
  "preserved root-motion runtime clips should keep hips position tracks for the Three mixer"
);
const metadataPreservedHipsTranslationClip = createThreeAnimationClip(
  { ...hipsTranslationSourceClip, id: "metadata-preserved-hips-translation", metadata: { rootMotionPolicy: "preserved" } },
  {
    resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
  }
);
createThreeRuntimeClipsForEntry(
  {
    id: "metadata-preserved-hips-translation",
    label: "Metadata Preserved Hips Translation",
    url: "/metadata-preserved-hips-translation.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true
  },
  new AnimationMixer(hipsTranslationRuntimeRoot),
  metadataPreservedHipsTranslationClip
);
assert.equal(
  metadataPreservedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
  true,
  "clip metadata rootMotionPolicy=preserved should survive Three binding and keep hips position tracks"
);
const strippedHipsTranslationClip = createThreeAnimationClip(hipsTranslationSourceClip, {
  resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
});
createThreeRuntimeClipsForEntry(
  {
    id: "stripped-hips-translation",
    label: "Stripped Hips Translation",
    url: "/stripped-hips-translation.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true,
    source: { rootMotion: { policy: "stripped-to-in-place" } }
  },
  new AnimationMixer(hipsTranslationRuntimeRoot),
  strippedHipsTranslationClip
);
assert.equal(
  strippedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
  false,
  "stripped-to-in-place runtime clips should still remove root carrier position tracks"
);
const namedRootCarrierRuntimeRoot = new Object3D();
const rootTranslationBone = new Object3D();
rootTranslationBone.name = "root";
const pelvisTranslationBone = new Object3D();
pelvisTranslationBone.name = "pelvis";
namedRootCarrierRuntimeRoot.add(rootTranslationBone);
namedRootCarrierRuntimeRoot.add(pelvisTranslationBone);
const namedRootCarrierSourceClip: AnimationClip = {
  id: "named-root-carrier-translation-source",
  duration: 1,
  loop: true,
  tracks: [
    { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0.25, 0, 0]) },
    { joint: "pelvis", property: "position", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 0.25]) }
  ]
};
const strippedNamedRootCarrierClip = createThreeAnimationClip(namedRootCarrierSourceClip, {
  resolveBone: (bone) => {
    if (bone === "root") return rootTranslationBone;
    if (bone === "pelvis") return pelvisTranslationBone;
    return null;
  }
});
assert.equal(
  strippedNamedRootCarrierClip.tracks.some((track) => track.name === `${rootTranslationBone.uuid}.position` || track.name === `${pelvisTranslationBone.uuid}.position`),
  true,
  "root carrier fixture should bind root and pelvis position tracks before runtime policy stripping"
);
createThreeRuntimeClipsForEntry(
  {
    id: "stripped-named-root-carrier-translation",
    label: "Stripped Named Root Carrier Translation",
    url: "/stripped-named-root-carrier-translation.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    loop: true,
    source: { rootMotion: { policy: "stripped-to-in-place" } }
  },
  new AnimationMixer(namedRootCarrierRuntimeRoot),
  strippedNamedRootCarrierClip
);
assert.equal(
  strippedNamedRootCarrierClip.tracks.some((track) => track.name === `${rootTranslationBone.uuid}.position` || track.name === `${pelvisTranslationBone.uuid}.position`),
  false,
  "stripped-to-in-place runtime clips should remove root and pelvis position tracks after UUID binding"
);

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

function signedJointForwardOffset(a: Vector3, b: Vector3, c: Vector3, axis: Vector3): number {
  const ac = c.clone().sub(a);
  const ab = b.clone().sub(a);
  const lengthSq = ac.lengthSq();
  if (lengthSq <= 1e-8) return 0;
  const closest = a.clone().addScaledVector(ac, ab.dot(ac) / lengthSq);
  return b.clone().sub(closest).dot(axis);
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

function assertMat4NearlyEqual(actual: readonly number[], expected: readonly number[], tolerance: number, message: string): void {
  assert.equal(actual.length, 16, `${message}: actual matrix length`);
  assert.equal(expected.length, 16, `${message}: expected matrix length`);
  for (let index = 0; index < 16; index += 1) {
    assert.ok(Math.abs(actual[index]! - expected[index]!) <= tolerance, `${message}: matrix value ${index} expected ${expected[index]} got ${actual[index]}`);
  }
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
