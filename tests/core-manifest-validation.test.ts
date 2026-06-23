import type { AnimationManifest } from "./test-api.js";
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
