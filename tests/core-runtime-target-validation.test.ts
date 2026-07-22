import type { AnimationClip } from "./test-api.js";
import {
  ReferenceAnimationRuntime,
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  decodeAnimationBinary,
  encodeAnimationBinary,
  inspectAnimationAsset,
  inspectClipAsset,
  quatFromAxisAngle,
  sampleClipToPose,
  toFloat32Array,
  tryBuildPackedRuntimeAnimation,
  validateAnimationInputs,
  validateClip
} from "./test-api.js";
import {
  makeSourceRestQuaternionClip,
  makeSourceRestQuaternionTrack,
  quaternionNearlyEqual,
  skeleton
} from "./test-helpers.js";

export async function runCoreRuntimeTargetValidationTests(): Promise<void> {
  const malformedSkeletonInputReport = validateAnimationInputs({} as typeof skeleton, {
    id: "malformed-skeleton-input",
    duration: 1,
    tracks: []
  });
  assert.equal(malformedSkeletonInputReport.accepted, false);
  assert.ok(
    malformedSkeletonInputReport.skeletonIssues.some(
      (issue) => issue.message === "skeleton must include joints, parents, and restPose arrays"
    ),
    "validateAnimationInputs should report malformed skeleton container shapes instead of throwing"
  );

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
    duplicateResolvedChannelReport.clipIssues.some(
      (issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")
    ),
    "validateAnimationInputs should reject joint/humanBone aliases that resolve to one rotation channel"
  );
  const duplicateResolvedAsset = inspectAnimationAsset(
    {
      id: "duplicate-resolved-channel",
      label: "Duplicate Resolved Channel",
      url: "/duplicate-resolved-channel.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    duplicateResolvedChannelClip,
    skeleton
  );
  assert.equal(duplicateResolvedAsset.status, "rejected");
  assert.ok(
    duplicateResolvedAsset.issues.some(
      (issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")
    ),
    "inspectAnimationAsset should surface duplicate resolved target channels"
  );
  assert.equal(
    duplicateResolvedAsset.issues.find(
      (issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")
    )?.property,
    "rotation",
    "inspectAnimationAsset should preserve clip issue property metadata in asset reports"
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
    {
      id: "duplicate-declared-channel",
      label: "Duplicate Declared Channel",
      url: "/duplicate-declared-channel.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    duplicateDeclaredChannelClip
  );
  assert.equal(duplicateDeclaredInspection.accepted, false);
  assert.ok(
    duplicateDeclaredInspection.issues.some(
      (issue) => issue.track === 1 && issue.message.includes("duplicate target channel head.translation")
    ),
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
  assert.equal(
    validateAnimationInputs(skeleton, distinctPropertyClip).accepted,
    true,
    "distinct transform properties on one joint should remain valid"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "distinct-properties",
        label: "Distinct Properties",
        url: "/distinct-properties.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT
      },
      distinctPropertyClip
    ).accepted,
    true,
    "declared channels with distinct normalized properties should remain valid"
  );

  const ambiguousRuntimeTargetClip: AnimationClip = {
    id: "ambiguous-runtime-target",
    duration: 1,
    tracks: [
      {
        joint: "spine",
        humanBone: "head",
        property: "rotation",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  const ambiguousRuntimeTargetIssues = validateClip(ambiguousRuntimeTargetClip, skeleton);
  assert.ok(
    ambiguousRuntimeTargetIssues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "spine" &&
        issue.property === "rotation" &&
        issue.message === "track needs exactly one joint or humanBone target"
    ),
    "validateClip should reject runtime tracks whose joint and humanBone targets disagree"
  );
  const ambiguousRuntimePackedBuild = tryBuildPackedRuntimeAnimation(ambiguousRuntimeTargetClip, skeleton);
  assert.equal(
    ambiguousRuntimePackedBuild.ok,
    false,
    "packed runtime builds should inherit runtime target ambiguity validation"
  );
  const ambiguousRuntimeSampleClip: AnimationClip = {
    id: "ambiguous-runtime-sample",
    duration: 1,
    tracks: [
      {
        joint: "spine",
        humanBone: "head",
        property: "rotation",
        times: toFloat32Array([0]),
        values: toFloat32Array(quatFromAxisAngle([0, 0, 1], Math.PI / 2))
      }
    ]
  };
  const ambiguousRuntimeSamplePose = sampleClipToPose(skeleton, ambiguousRuntimeSampleClip, 0);
  assert.ok(
    quaternionNearlyEqual(ambiguousRuntimeSamplePose[1]!.rotation, skeleton.restPose[1]!.rotation, 1e-6),
    "clip sampling should skip structurally invalid ambiguous target tracks before applying their joint target"
  );
  assert.ok(
    quaternionNearlyEqual(ambiguousRuntimeSamplePose[2]!.rotation, skeleton.restPose[2]!.rotation, 1e-6),
    "clip sampling should skip structurally invalid ambiguous target tracks before applying their humanBone target"
  );
  const ambiguousRuntime = new ReferenceAnimationRuntime(skeleton);
  ambiguousRuntime.setLayer("ambiguous", ambiguousRuntimeSampleClip, { weight: 1, targetWeight: 1 });
  const ambiguousEvaluation = ambiguousRuntime.evaluate({ diagnostics: true });
  assert.ok(
    ambiguousEvaluation.diagnostics?.some(
      (issue) => issue.track === 0 && issue.message === "track needs exactly one joint or humanBone target"
    ),
    "runtime diagnostics should keep reporting ambiguous track targets"
  );
  assert.ok(
    quaternionNearlyEqual(ambiguousEvaluation.localPose[1]!.rotation, skeleton.restPose[1]!.rotation, 1e-6),
    "runtime evaluation should skip structurally invalid ambiguous target tracks"
  );

  const validSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("valid-source-rest-quaternion");
  assert.equal(
    validateAnimationInputs(skeleton, validSourceRestQuaternionClip).accepted,
    true,
    "valid source rest metadata on quaternion tracks should remain accepted"
  );
  const decodedSourceRestQuaternionClip = decodeAnimationBinary(
    encodeAnimationBinary(validSourceRestQuaternionClip),
    "valid-source-rest-quaternion"
  );
  assert.deepEqual(
    Array.from(decodedSourceRestQuaternionClip.tracks[0]!.sourceRestQuaternion ?? []),
    [0, 0, 0, 1],
    "binary roundtrips should preserve source rest quaternion metadata"
  );
  assert.throws(
    () =>
      encodeAnimationBinary({
        ...validSourceRestQuaternionClip,
        tracks: [{ ...validSourceRestQuaternionClip.tracks[0]!, sourceRestQuaternion: toFloat32Array([0, 0, 1]) }]
      }),
    /animation clip valid-source-rest-quaternion is invalid: track 0 head\.quaternion sourceRestQuaternion must contain exactly 4 values/,
    "binary encoding should reject malformed source rest quaternion metadata before writing a corrupt payload"
  );

  const invalidZeroSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip(
    "invalid-zero-source-rest-quaternion",
    { sourceRestQuaternion: [0, 0, 0, 0] }
  );
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

  const invalidNonUnitSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip(
    "invalid-non-unit-source-rest-quaternion",
    { sourceRestQuaternion: [0, 0, 0, 2] }
  );
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
      makeSourceRestQuaternionTrack({
        humanBone: "spine",
        property: "rotation",
        sourceRestQuaternion: [0, Number.NaN, 0, 1]
      })
    ]
  };
  const invalidSourceRestQuaternionShapeReport = validateAnimationInputs(
    skeleton,
    invalidSourceRestQuaternionShapeClip
  );
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

  const invalidSourceRestQuaternionPropertyClip: AnimationClip = makeSourceRestQuaternionClip(
    "invalid-source-rest-quaternion-property",
    {
      joint: "head",
      property: "translation",
      values: [0, 0, 0]
    }
  );
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
    tracks: [
      { humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }
    ]
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
      tracks: [
        { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }
      ]
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
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      }
    ]
  };
  assert.equal(validateAnimationInputs(skeleton, duplicateTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, duplicateTrackTimeClip).clipIssues.some(
      (issue) => issue.message === "track times must be sorted"
    ),
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
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([-0.1, 0.5]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      }
    ]
  };
  assert.equal(validateAnimationInputs(skeleton, negativeTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, negativeTrackTimeClip).clipIssues.some(
      (issue) => issue.message === "track time must be within clip duration"
    ),
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
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 1.1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      }
    ]
  };
  assert.equal(validateAnimationInputs(skeleton, overDurationTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, overDurationTrackTimeClip).clipIssues.some(
      (issue) => issue.message === "track time must be within clip duration"
    ),
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
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      }
    ]
  };
  assert.equal(
    validateAnimationInputs(skeleton, endpointTrackTimeClip).accepted,
    true,
    "endpoint track times should remain accepted"
  );
}
