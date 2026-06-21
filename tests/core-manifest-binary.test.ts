import {
  AnimationClip,
  AnimationManifest,
  AnimationRuntime,
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  decodeAnimationBinary,
  encodeAnimationBinary,
  inspectAnimationAsset,
  inspectClipAsset,
  quatFromAxisAngle,
  readRootMotionMetadata,
  readRootMotionProvenance,
  rejectedAnimationReport,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  tryBuildPackedRuntimeAnimation,
  usableManifestClips,
  validateAnimationInputs,
  validateAnimationManifestAssets,
  validateClip,
  validateManifest
} from "./test-api.js";
import {
  binaryFloatByteOffsetForTest,
  createLegacyV1NodBinary,
  invalidValidationStatusManifestEntry,
  makeSourceRestQuaternionClip,
  makeSourceRestQuaternionTrack,
  nodClip,
  quarantinedManifestEntry,
  quaternionNearlyEqual,
  skeleton
} from "./test-helpers.js";

export async function runCoreManifestBinaryTests(): Promise<void> {
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
      { id: "invalid-root-motion-policy-alias", label: "Invalid Root Motion Policy Alias", url: "/invalid-root-motion-policy-alias.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotionPolicy: "keep-everything" } },
      { id: "invalid-root-motion-provenance", label: "Invalid Root Motion Provenance", url: "/invalid-root-motion-provenance.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: { policy: "stripped-to-in-place", provenance: "converted" } } }
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
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-provenance has invalid source.rootMotion.provenance converted"),
    "validateManifest should report invalid source.rootMotion.provenance values from runtime JSON"
  );
  assert.deepEqual(
    validateManifest({ version: 1 } as unknown as AnimationManifest),
    ["manifest clips must be an array"],
    "validateManifest should report malformed manifests whose clips table is missing"
  );
  const missingIdsManifest = {
    version: 1,
    clips: [
      { id: "", label: "Missing Id A", url: "/missing-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "", label: "Missing Id B", url: "/missing-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
    ]
  } as AnimationManifest;
  const missingIdsManifestIssues = validateManifest(missingIdsManifest);
  assert.equal(
    missingIdsManifestIssues.filter((issue) => issue === "manifest entry is missing id").length,
    2,
    "validateManifest should report each missing id"
  );
  assert.equal(
    missingIdsManifestIssues.some((issue) => issue === "duplicate clip id "),
    false,
    "missing manifest ids should not be classified as duplicate concrete ids"
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
      ["invalid-root-motion-policy-alias", "has invalid source.rootMotionPolicy keep-everything"],
      ["invalid-root-motion-provenance", "has invalid source.rootMotion.provenance converted"]
    ],
    "rejectedAnimationReport should surface malformed validation status through the existing rejected logging path"
  );
  const convertedStrippedRootMotionEntry = {
    id: "root-motion-converted-stripped",
    label: "Root Motion Converted Stripped",
    url: "/root-motion-converted-stripped.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "stripped-to-in-place", provenance: "stripped-during-conversion" } }
  };
  assert.deepEqual(
    readRootMotionMetadata(convertedStrippedRootMotionEntry),
    { policy: "stripped-to-in-place", provenance: "stripped-during-conversion" },
    "root-motion metadata should expose conversion-time stripping separately from the runtime policy"
  );
  assert.equal(
    readRootMotionMetadata(
      {
        id: "invalid-root-motion-with-fallback",
        label: "Invalid Root Motion With Fallback",
        url: "/invalid-root-motion-with-fallback.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "keep-everything" }, rootMotionPolicy: "preserved" }
      },
      { ...nodClip, metadata: { rootMotionPolicy: "preserved", rootMotionProvenance: "preserved-in-clip" } }
    ),
    null,
    "invalid source.rootMotion metadata should not fall through to legacy aliases or clip metadata"
  );
  assert.equal(
    readRootMotionMetadata(
      {
        id: "invalid-root-motion-provenance-with-fallback",
        label: "Invalid Root Motion Provenance With Fallback",
        url: "/invalid-root-motion-provenance-with-fallback.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved", provenance: "converted" } }
      },
      { ...nodClip, metadata: { rootMotionPolicy: "preserved", rootMotionProvenance: "preserved-in-clip" } }
    ),
    null,
    "invalid source.rootMotion provenance should not be partially interpreted as a valid policy"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: [convertedStrippedRootMotionEntry] }),
    [],
    "valid root-motion provenance metadata should pass manifest validation"
  );
  assert.equal(
    readRootMotionProvenance({
      id: "legacy-stripped",
      label: "Legacy Stripped",
      url: "/legacy-stripped.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    }),
    "unknown",
    "legacy stripped-to-in-place manifests should remain readable with unknown provenance"
  );
  const structurallyInvalidManifest = {
    version: 1,
    clips: [
      { id: "valid", label: "Valid", url: "/valid.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "missing-url", label: "Missing Url", url: "", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "bad-format", label: "Bad Format", url: "/bad-format.json", format: "json" },
      { id: "dup", label: "Duplicate A", url: "/dup-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "dup", label: "Duplicate B", url: "/dup-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      {
        id: "accepted-with-reason",
        label: "Accepted With Reason",
        url: "/accepted-with-reason.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: { status: "accepted", reason: "old rejection" }
      }
    ]
  } as AnimationManifest;
  assert.deepEqual(
    usableManifestClips(structurallyInvalidManifest).map((entry) => entry.id),
    ["valid"],
    "usableManifestClips should exclude entries rejected by manifest structure validation"
  );
  assert.deepEqual(
    rejectedAnimationReport(structurallyInvalidManifest).map((entry) => [entry.id, entry.reason]),
    [
      ["missing-url", "missing url"],
      ["bad-format", "unsupported format json"],
      ["dup", "duplicate clip id dup"],
      ["dup", "duplicate clip id dup"],
      ["accepted-with-reason", "accepted but still has rejection reason"]
    ],
    "rejectedAnimationReport should include structural manifest rejection reasons"
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

  const unsupportedFormatAssetEntry = {
    id: "unsupported-format-asset",
    label: "Unsupported Format Asset",
    url: "/unsupported-format-asset.json",
    format: "json"
  };
  const unsupportedFormatAssetInspection = inspectAnimationAsset(
    unsupportedFormatAssetEntry,
    nodClip,
    skeleton
  );
  assert.equal(unsupportedFormatAssetInspection.status, "rejected");
  assert.ok(
    unsupportedFormatAssetInspection.issues.some((issue) => issue.message === "unsupported-format-asset has unsupported format json"),
    "inspectAnimationAsset should reject manifest entries whose declared format cannot be decoded as waifuanim binaries"
  );
  const structurallyRejectedAssetFetches: string[] = [];
  const structuralAssetValidationReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        unsupportedFormatAssetEntry,
        { id: "duplicate-asset", label: "Duplicate Asset A", url: "/duplicate-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
        { id: "duplicate-asset", label: "Duplicate Asset B", url: "/duplicate-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
        {
          id: "accepted-reason-asset",
          label: "Accepted Reason Asset",
          url: "/accepted-reason-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          validation: { status: "accepted", reason: "stale rejection reason" }
        },
        { id: "valid-asset", label: "Valid Asset", url: "/valid-asset.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
      ]
    },
    async (url) => {
      structurallyRejectedAssetFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(
    structurallyRejectedAssetFetches,
    ["/valid-asset.waifuanim.bin"],
    "asset report validation should not fetch entries already rejected by manifest structure"
  );
  assert.equal(structuralAssetValidationReport.accepted, 1);
  assert.equal(structuralAssetValidationReport.rejected, 4);
  assert.equal(structuralAssetValidationReport.quarantined, 0);
  const duplicateStructuralIssues = structuralAssetValidationReport.entries
    .slice(1, 3)
    .every((entry) => entry.issues.some((issue) => issue.message === "duplicate clip id duplicate-asset"));
  assert.ok(
    duplicateStructuralIssues,
    "asset report validation should reject all duplicate manifest ids before classifying binaries"
  );
  assert.ok(
    structuralAssetValidationReport.entries[3]!.issues.some((issue) => issue.message === "accepted-reason-asset is accepted but still has rejection reason"),
    "asset report validation should not accept entries whose manifest still carries a rejection reason"
  );
  const invalidRootMotionMetadataAssetEntry = {
    id: "invalid-root-motion-metadata-asset",
    label: "Invalid Root Motion Metadata Asset",
    url: "/invalid-root-motion-metadata-asset.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "keep-everything" } }
  };
  const metadataRejectedAssetFetches: string[] = [];
  const metadataRejectedAssetReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        invalidValidationStatusManifestEntry,
        invalidRootMotionMetadataAssetEntry,
        { id: "valid-metadata-asset", label: "Valid Metadata Asset", url: "/valid-metadata-asset.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
      ]
    },
    async (url) => {
      metadataRejectedAssetFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(
    metadataRejectedAssetFetches,
    ["/valid-metadata-asset.waifuanim.bin"],
    "asset report validation should not fetch entries rejected by manifest metadata validation"
  );
  assert.equal(metadataRejectedAssetReport.accepted, 1);
  assert.equal(metadataRejectedAssetReport.rejected, 2);
  assert.ok(metadataRejectedAssetReport.entries[0]!.issues.some((issue) => issue.message === "invalid validation status acceptted"));
  assert.ok(metadataRejectedAssetReport.entries[1]!.issues.some((issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"));

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
  assert.equal(
    duplicateResolvedAsset.issues.find((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation"))?.property,
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
      (issue) => issue.track === 0 && issue.joint === "spine" && issue.property === "rotation" && issue.message === "track needs exactly one joint or humanBone target"
    ),
    "validateClip should reject runtime tracks whose joint and humanBone targets disagree"
  );
  const ambiguousRuntimePackedBuild = tryBuildPackedRuntimeAnimation(ambiguousRuntimeTargetClip, skeleton);
  assert.equal(ambiguousRuntimePackedBuild.ok, false, "packed runtime builds should inherit runtime target ambiguity validation");
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
  const ambiguousRuntime = new AnimationRuntime(skeleton);
  ambiguousRuntime.setLayer("ambiguous", ambiguousRuntimeSampleClip, { weight: 1, targetWeight: 1 });
  const ambiguousEvaluation = ambiguousRuntime.evaluate({ diagnostics: true });
  assert.ok(
    ambiguousEvaluation.diagnostics?.some((issue) => issue.track === 0 && issue.message === "track needs exactly one joint or humanBone target"),
    "runtime diagnostics should keep reporting ambiguous track targets"
  );
  assert.ok(
    quaternionNearlyEqual(ambiguousEvaluation.localPose[1]!.rotation, skeleton.restPose[1]!.rotation, 1e-6),
    "runtime evaluation should skip structurally invalid ambiguous target tracks"
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
  const decodedLegacyNodClip = decodeAnimationBinary(createLegacyV1NodBinary(), "legacy-nod");
  assert.equal(decodedLegacyNodClip.id, "legacy-nod");
  assert.equal(decodedLegacyNodClip.loop, true);
  assert.equal(decodedLegacyNodClip.tracks.length, 1);
  assert.equal(decodedLegacyNodClip.tracks[0]!.humanBone, "head");
  assert.equal(decodedLegacyNodClip.tracks[0]!.property, "rotation");
  assert.deepEqual(Array.from(decodedLegacyNodClip.tracks[0]!.times), [0, 0.5, 1]);
  assert.ok(
    quaternionNearlyEqual(Array.from(decodedLegacyNodClip.tracks[0]!.values.slice(4, 8)), [0.15, 0, 0, 0.9887], 1e-6),
    "decodeAnimationBinary should read legacy v1 track/string/float offsets using the v1 record size"
  );
  const absentSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 28, 0, true);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 32, 0, true);
  assert.equal(
    decodeAnimationBinary(absentSourceRestFlagBinary, "absent-source-rest-flag").tracks[0]!.sourceRestQuaternion,
    undefined,
    "decodeAnimationBinary should honor a false source-rest presence flag even when legacy offset bytes are non-empty"
  );
  const invalidSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidSourceRestFlagBinary).setUint32(32 + 32, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidSourceRestFlagBinary, "invalid-source-rest-flag"),
    /animation track 0 source-rest presence flag is invalid/,
    "decodeAnimationBinary should reject malformed source-rest presence flags"
  );
  const childDirectionBinaryClip: AnimationClip = {
    id: "binary-child-direction",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        sourceRestChildDirection: toFloat32Array([0, 1, 0]),
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  const absentChildDirectionFlagBinary = encodeAnimationBinary(childDirectionBinaryClip);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 36, 0, true);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 40, 0, true);
  assert.equal(
    decodeAnimationBinary(absentChildDirectionFlagBinary, "absent-child-direction-flag").tracks[0]!.sourceRestChildDirection,
    undefined,
    "decodeAnimationBinary should honor a false source-rest child direction presence flag"
  );
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
  const invalidFlagsBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidFlagsBinary).setUint32(20, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidFlagsBinary, "invalid-flags"),
    /animation binary flags are invalid/,
    "decodeAnimationBinary should reject unknown binary header flags"
  );
  const nonFiniteDurationBinary = encodeAnimationBinary(nodClip);
  new DataView(nonFiniteDurationBinary).setFloat32(16, Number.NaN, true);
  assert.throws(
    () => decodeAnimationBinary(nonFiniteDurationBinary, "non-finite-binary-duration"),
    /animation binary duration must be positive and finite/,
    "decodeAnimationBinary should reject non-finite binary durations before exposing clips"
  );
  const unsortedBinaryTimes = encodeAnimationBinary(endpointTrackTimeClip);
  new Float32Array(unsortedBinaryTimes, binaryFloatByteOffsetForTest(unsortedBinaryTimes))[1] = 0;
  assert.throws(
    () => decodeAnimationBinary(unsortedBinaryTimes, "unsorted-binary-times"),
    /animation track 0 time values must be sorted/,
    "decodeAnimationBinary should reject duplicate or unsorted binary time samples"
  );
  const nonFiniteBinaryValue = encodeAnimationBinary(nodClip);
  new Float32Array(nonFiniteBinaryValue, binaryFloatByteOffsetForTest(nonFiniteBinaryValue))[3] = Number.NaN;
  assert.throws(
    () => decodeAnimationBinary(nonFiniteBinaryValue, "non-finite-binary-value"),
    /animation track 0 values must be finite/,
    "decodeAnimationBinary should reject non-finite binary value samples"
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
  const convertedStrippedRootMotionInspection = inspectAnimationAsset(
    convertedStrippedRootMotionEntry,
    rootMotionRotationOnlyClip,
    skeleton
  );
  assert.equal(convertedStrippedRootMotionInspection.status, "accepted");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionPolicy, "stripped-to-in-place");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionProvenance, "stripped-during-conversion");
  assert.equal(convertedStrippedRootMotionInspection.rootCarrierTranslationTrackCount, 0);
  assert.equal(convertedStrippedRootMotionInspection.movingRootCarrierTranslationTrackCount, 0);
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
  const preservedRootMotionReportInspection = inspectAnimationAsset(
    {
      id: "root-motion-hips-preserved-report",
      label: "Root Motion Hips Preserved Report",
      url: "/root-motion-hips-preserved-report.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", provenance: "preserved-in-clip" } }
    },
    preservedRootMotionHipsClip
  );
  assert.equal(preservedRootMotionReportInspection.rootMotionPolicy, "preserved");
  assert.equal(preservedRootMotionReportInspection.rootMotionProvenance, "preserved-in-clip");
  assert.equal(preservedRootMotionReportInspection.rootCarrierTranslationTrackCount, 1);
  assert.equal(preservedRootMotionReportInspection.movingRootCarrierTranslationTrackCount, 1);
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
}
