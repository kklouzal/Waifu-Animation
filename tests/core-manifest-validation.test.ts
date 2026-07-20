import type { AnimationClip, AnimationManifest } from "./test-api.js";
import {
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  encodeAnimationBinary,
  inspectAnimationAsset,
  inspectClipAsset,
  readRequiredAnimationCoverage,
  readRootMotionMetadata,
  readRootMotionProvenance,
  rejectedAnimationReport,
  usableManifestClips,
  validateAnimationManifestAssets,
  validateManifest
} from "./test-api.js";
import { invalidValidationStatusManifestEntry, nodClip, quarantinedManifestEntry, skeleton } from "./test-helpers.js";

export async function runCoreManifestValidationTests(): Promise<void> {
  assert.deepEqual(
    validateManifest(null as unknown as AnimationManifest),
    ["manifest must be an object"],
    "validateManifest should reject non-object runtime JSON before reading manifest fields"
  );
  assert.deepEqual(
    validateManifest({ version: 0 } as unknown as AnimationManifest),
    ["manifest version must be a positive integer", "manifest clips must be an array"],
    "validateManifest should accumulate top-level version and missing clips diagnostics"
  );
  assert.deepEqual(
    validateManifest({ version: 1, includes: ["/base.json", ""], clips: [] }),
    ["manifest includes must be an array of non-empty strings"],
    "validateManifest should reject malformed include path metadata"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: [null] } as unknown as AnimationManifest),
    ["manifest entry must be an object"],
    "validateManifest should reject malformed clip entry values instead of dereferencing them"
  );
  const malformedEntryMetadataManifest = {
    version: 1,
    clips: [
      {
        id: "bad-weight",
        label: "Bad Weight",
        url: "/bad-weight.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        weight: Number.NaN
      },
      {
        id: "bad-tags",
        label: "Bad Tags",
        url: "/bad-tags.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        tags: ["idle", ""]
      },
      {
        id: "bad-source",
        label: "Bad Source",
        url: "/bad-source.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: []
      },
      {
        id: "bad-validation",
        label: "Bad Validation",
        url: "/bad-validation.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: []
      }
    ]
  } as unknown as AnimationManifest;
  assert.deepEqual(
    validateManifest(malformedEntryMetadataManifest),
    [
      "bad-weight has invalid weight metadata",
      "bad-tags has invalid tags metadata",
      "bad-source has invalid source metadata",
      "bad-validation has invalid validation metadata"
    ],
    "validateManifest should report malformed public manifest metadata fields deterministically"
  );
  assert.equal(
    usableManifestClips(malformedEntryMetadataManifest).length,
    0,
    "usableManifestClips should exclude entries with malformed public manifest metadata"
  );
  assert.deepEqual(
    rejectedAnimationReport({ version: 1, clips: [null] } as unknown as AnimationManifest),
    [{ id: "<unknown>", reason: "manifest entry must be an object" }],
    "rejectedAnimationReport should surface malformed clip entry shapes without throwing"
  );
  let malformedManifestFetchCount = 0;
  const malformedManifestAssetReport = await validateAnimationManifestAssets(
    { version: 1 } as unknown as AnimationManifest,
    async () => {
      malformedManifestFetchCount += 1;
      return encodeAnimationBinary(nodClip);
    },
    { now: new Date("2026-01-01T00:00:00.000Z") }
  );
  assert.equal(malformedManifestFetchCount, 0);
  assert.equal(malformedManifestAssetReport.total, 1);
  assert.equal(malformedManifestAssetReport.rejected, 1);
  assert.ok(
    malformedManifestAssetReport.entries[0]!.issues.some(
      (issue) => issue.message === "manifest clips must be an array"
    ),
    "asset report validation should surface a malformed top-level manifest without fetching assets"
  );
  const malformedEntryAssetFetches: string[] = [];
  const malformedEntryAssetReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        null,
        {
          id: "valid-after-null",
          label: "Valid After Null",
          url: "/valid-after-null.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
      ]
    } as unknown as AnimationManifest,
    async (url) => {
      malformedEntryAssetFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton, now: new Date("2026-01-01T00:00:00.000Z") }
  );
  assert.deepEqual(malformedEntryAssetFetches, ["/valid-after-null.waifuanim.bin"]);
  assert.equal(malformedEntryAssetReport.accepted, 1);
  assert.equal(malformedEntryAssetReport.rejected, 1);
  assert.ok(
    malformedEntryAssetReport.entries[0]!.issues.some((issue) => issue.message === "manifest entry must be an object"),
    "asset report validation should reject malformed clip entries without aborting adjacent valid assets"
  );
  const sparseManifestClips = [] as unknown[];
  sparseManifestClips[1] = {
    id: "valid-after-hole",
    label: "Valid After Hole",
    url: "/valid-after-hole.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  };
  const sparseManifestFetches: string[] = [];
  const sparseManifestAssetReport = await validateAnimationManifestAssets(
    { version: 1, clips: sparseManifestClips } as unknown as AnimationManifest,
    async (url) => {
      sparseManifestFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(sparseManifestFetches, ["/valid-after-hole.waifuanim.bin"]);
  assert.equal(sparseManifestAssetReport.accepted, 1);
  assert.equal(sparseManifestAssetReport.rejected, 1);
  assert.ok(
    sparseManifestAssetReport.entries[0]!.issues.some((issue) => issue.message === "manifest entry must be an object"),
    "asset report validation should visit sparse manifest clip holes as rejected entries"
  );
  const malformedValidationStatusManifest = {
    version: 1,
    clips: [
      { id: "valid", label: "Valid", url: "/valid.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      invalidValidationStatusManifestEntry,
      {
        id: "numeric-status",
        label: "Numeric Status",
        url: "/numeric-status.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: { status: 1 }
      },
      quarantinedManifestEntry,
      {
        id: "rejected",
        label: "Rejected",
        url: "/rejected.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: { status: "rejected" }
      },
      {
        id: "accepted",
        label: "Accepted",
        url: "/accepted.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: { status: "accepted" }
      },
      {
        id: "invalid-root-motion-policy",
        label: "Invalid Root Motion Policy",
        url: "/invalid-root-motion-policy.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "keep-everything" } }
      },
      {
        id: "invalid-root-motion-shape",
        label: "Invalid Root Motion Shape",
        url: "/invalid-root-motion-shape.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: true }
      },
      {
        id: "invalid-root-motion-policy-alias",
        label: "Invalid Root Motion Policy Alias",
        url: "/invalid-root-motion-policy-alias.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotionPolicy: "keep-everything" }
      },
      {
        id: "invalid-root-motion-provenance",
        label: "Invalid Root Motion Provenance",
        url: "/invalid-root-motion-provenance.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "stripped-to-in-place", provenance: "converted" } }
      },
      {
        id: "invalid-required-human-bone",
        label: "Invalid Required Human Bone",
        url: "/invalid-required-human-bone.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { requiredHumanBones: ["leftToes", "tail"] }
      },
      {
        id: "invalid-required-joint",
        label: "Invalid Required Joint",
        url: "/invalid-required-joint.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { requiredJoints: ["hips", ""] }
      }
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
    malformedValidationStatusIssues.includes(
      "invalid-root-motion-policy has invalid source.rootMotion.policy keep-everything"
    ),
    "validateManifest should report invalid source.rootMotion.policy values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-shape has invalid source.rootMotion metadata"),
    "validateManifest should report malformed source.rootMotion shapes from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes(
      "invalid-root-motion-policy-alias has invalid source.rootMotionPolicy keep-everything"
    ),
    "validateManifest should report invalid source.rootMotionPolicy aliases from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes(
      "invalid-root-motion-provenance has invalid source.rootMotion.provenance converted"
    ),
    "validateManifest should report invalid source.rootMotion.provenance values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes(
      "invalid-required-human-bone has invalid source.requiredHumanBones entry tail"
    ),
    "validateManifest should report invalid source.requiredHumanBones values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-required-joint has invalid source.requiredJoints entry "),
    "validateManifest should report invalid source.requiredJoints values from runtime JSON"
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
      ["invalid-root-motion-provenance", "has invalid source.rootMotion.provenance converted"],
      ["invalid-required-human-bone", "has invalid source.requiredHumanBones entry tail"],
      ["invalid-required-joint", "has invalid source.requiredJoints entry "]
    ],
    "rejectedAnimationReport should surface malformed validation status through the existing rejected logging path"
  );
  const explicitCoverageEntry = {
    id: "explicit-coverage",
    label: "Explicit Coverage",
    url: "/explicit-coverage.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { requiredHumanBones: ["head", "hips", "head"], requiredJoints: ["leftUpperArm", "hips"] }
  };
  assert.deepEqual(
    readRequiredAnimationCoverage(explicitCoverageEntry),
    { requiredHumanBones: ["head", "hips"], requiredJoints: ["hips", "leftUpperArm"] },
    "required animation coverage metadata should be deduplicated and sorted for deterministic validation"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: [explicitCoverageEntry] }),
    [],
    "valid required coverage metadata should pass manifest validation"
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
  const invalidValidationStatusClipInspection = inspectClipAsset(invalidValidationStatusManifestEntry, nodClip);
  assert.equal(invalidValidationStatusClipInspection.accepted, false);
  assert.ok(
    invalidValidationStatusClipInspection.issues.some(
      (issue) => issue.message === "invalid validation status acceptted"
    ),
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
    invalidValidationStatusAssetInspection.issues.some(
      (issue) => issue.message === "invalid validation status acceptted"
    ),
    "inspectAnimationAsset should reject malformed validation.status metadata"
  );
  const quarantinedAssetInspection = inspectAnimationAsset(quarantinedManifestEntry, nodClip, skeleton);
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

  const requiredCoverageInspection = inspectAnimationAsset(explicitCoverageEntry, nodClip, skeleton);
  assert.equal(requiredCoverageInspection.status, "rejected");
  assert.deepEqual(requiredCoverageInspection.jointCoverage, ["head"]);
  assert.ok(
    requiredCoverageInspection.issues.some(
      (issue) =>
        issue.severity === "error" &&
        issue.joint === "hips" &&
        issue.message === "required humanoid bone hips is not covered by resolved target skeleton tracks"
    ),
    "inspectAnimationAsset should reject clips that miss explicitly required humanoid bones"
  );
  assert.ok(
    requiredCoverageInspection.issues.some(
      (issue) =>
        issue.severity === "error" &&
        issue.joint === "leftUpperArm" &&
        issue.message === "required joint leftUpperArm is not covered by resolved target skeleton tracks"
    ),
    "inspectAnimationAsset should reject clips that miss explicitly required joints"
  );
  const requiredCoverageReport = await validateAnimationManifestAssets(
    { version: 1, clips: [explicitCoverageEntry] },
    async () => encodeAnimationBinary(nodClip),
    { skeleton }
  );
  assert.equal(requiredCoverageReport.accepted, 0);
  assert.equal(requiredCoverageReport.rejected, 1);
  assert.ok(
    requiredCoverageReport.entries[0]!.issues.some(
      (issue) => issue.message === "required humanoid bone hips is not covered by resolved target skeleton tracks"
    ),
    "asset validation reports should include explicit required coverage errors"
  );

  const unsupportedFormatAssetEntry = {
    id: "unsupported-format-asset",
    label: "Unsupported Format Asset",
    url: "/unsupported-format-asset.json",
    format: "json"
  };
  const unsupportedFormatAssetInspection = inspectAnimationAsset(unsupportedFormatAssetEntry, nodClip, skeleton);
  assert.equal(unsupportedFormatAssetInspection.status, "rejected");
  assert.ok(
    unsupportedFormatAssetInspection.issues.some(
      (issue) => issue.message === "unsupported-format-asset has unsupported format json"
    ),
    "inspectAnimationAsset should reject manifest entries whose declared format cannot be decoded as waifuanim binaries"
  );
  const malformedClipAssetInspection = inspectAnimationAsset(
    {
      id: "malformed-clip",
      label: "Malformed Clip",
      url: "/malformed-clip.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    { id: "malformed-clip", duration: 1 } as unknown as AnimationClip,
    skeleton
  );
  assert.equal(malformedClipAssetInspection.status, "rejected");
  assert.equal(malformedClipAssetInspection.duration, 0);
  assert.ok(
    malformedClipAssetInspection.issues.some((issue) => issue.message === "clip tracks must be an array"),
    "inspectAnimationAsset should return a rejected report for malformed clip containers instead of throwing"
  );
  const malformedRootCarrierClip = {
    id: "malformed-root-carrier",
    duration: 1,
    tracks: [{ joint: "hips", property: "translation" }]
  } as unknown as AnimationClip;
  const malformedRootCarrierInspection = inspectAnimationAsset(
    {
      id: "malformed-root-carrier",
      label: "Malformed Root Carrier",
      url: "/malformed-root-carrier.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    malformedRootCarrierClip,
    skeleton
  );
  assert.equal(malformedRootCarrierInspection.status, "rejected");
  assert.ok(
    malformedRootCarrierInspection.issues.some((issue) => issue.message === "track times must be a Float32Array"),
    "root-carrier manifest helpers should ignore malformed runtime track buffers after validation reports them"
  );
  const structurallyRejectedAssetFetches: string[] = [];
  const structuralAssetValidationReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        unsupportedFormatAssetEntry,
        {
          id: "duplicate-asset",
          label: "Duplicate Asset A",
          url: "/duplicate-a.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        },
        {
          id: "duplicate-asset",
          label: "Duplicate Asset B",
          url: "/duplicate-b.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        },
        {
          id: "accepted-reason-asset",
          label: "Accepted Reason Asset",
          url: "/accepted-reason-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          validation: { status: "accepted", reason: "stale rejection reason" }
        },
        {
          id: "valid-asset",
          label: "Valid Asset",
          url: "/valid-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
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
    structuralAssetValidationReport.entries[3]!.issues.some(
      (issue) => issue.message === "accepted-reason-asset is accepted but still has rejection reason"
    ),
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
        {
          id: "invalid-required-coverage-metadata-asset",
          label: "Invalid Required Coverage Metadata Asset",
          url: "/invalid-required-coverage-metadata-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { requiredHumanBones: ["head", "tail"] }
        },
        {
          id: "valid-metadata-asset",
          label: "Valid Metadata Asset",
          url: "/valid-metadata-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
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
  assert.equal(metadataRejectedAssetReport.rejected, 3);
  assert.ok(
    metadataRejectedAssetReport.entries[0]!.issues.some(
      (issue) => issue.message === "invalid validation status acceptted"
    )
  );
  assert.ok(
    metadataRejectedAssetReport.entries[1]!.issues.some(
      (issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"
    )
  );
  assert.ok(
    metadataRejectedAssetReport.entries[2]!.issues.some(
      (issue) => issue.message === "has invalid source.requiredHumanBones entry tail"
    )
  );
}
