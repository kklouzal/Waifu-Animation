import type { AnimationClip, AnimationManifest, AnimationManifestEntry } from "./test-api.js";
import {
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  encodeAnimationBinary,
  inspectAnimationAsset,
  inspectClipAsset,
  loadManifest,
  MAX_MANIFEST_CLIPS_PER_MANIFEST,
  readRequiredAnimationCoverage,
  readRootMotionMetadata,
  readRootMotionProvenance,
  rejectedAnimationReport,
  resolveRootMotionCarrierHint,
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
  const sparseIncludes = [] as unknown[];
  sparseIncludes[1] = "/lazy.json";
  assert.deepEqual(
    validateManifest({ version: 1, includes: sparseIncludes, clips: [] } as unknown as AnimationManifest),
    ["manifest includes must be an array of non-empty strings"],
    "validateManifest should reject sparse include arrays instead of skipping holes"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: [null] } as unknown as AnimationManifest),
    ["manifest entry must be an object"],
    "validateManifest should reject malformed clip entry values instead of dereferencing them"
  );
  const inheritedTopLevelManifest = Object.create({ version: 1, clips: [] }) as AnimationManifest;
  assert.deepEqual(
    validateManifest(inheritedTopLevelManifest),
    ["manifest version must be a positive integer", "manifest clips must be an array"],
    "validateManifest should ignore inherited top-level manifest fields instead of trusting prototype data"
  );
  const inheritedManifestEntry = Object.create({
    id: "proto-entry",
    label: "Proto Entry",
    url: "/proto-entry.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  }) as unknown as AnimationManifestEntry;
  const inheritedEntryManifest = { version: 1, clips: [inheritedManifestEntry] } as unknown as AnimationManifest;
  assert.deepEqual(
    validateManifest(inheritedEntryManifest),
    ["manifest entry is missing id", "<unknown> is missing url", "<unknown> has unsupported format undefined"],
    "validateManifest should reject inherited manifest entry fields as missing own metadata"
  );
  assert.deepEqual(
    usableManifestClips(inheritedEntryManifest),
    [],
    "usableManifestClips should not accept prototype-backed manifest entries"
  );
  assert.deepEqual(
    rejectedAnimationReport(inheritedEntryManifest),
    [{ id: "<unknown>", reason: "missing id" }],
    "rejectedAnimationReport should surface inherited manifest entry fields as structural rejects"
  );
  const inheritedEntryClipInspection = inspectClipAsset(inheritedManifestEntry, nodClip);
  assert.equal(inheritedEntryClipInspection.accepted, false);
  assert.ok(
    inheritedEntryClipInspection.issues.some((issue) => issue.message === "manifest entry is missing id"),
    "inspectClipAsset should not accept inherited manifest entry fields"
  );
  let inheritedEntryFetchCount = 0;
  const inheritedEntryAssetReport = await validateAnimationManifestAssets(
    inheritedEntryManifest,
    async () => {
      inheritedEntryFetchCount += 1;
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.equal(inheritedEntryFetchCount, 0);
  assert.equal(inheritedEntryAssetReport.rejected, 1);
  const inheritedSource = Object.create({ category: "locomotion", posture: "sitting" }) as unknown as Record<
    string,
    unknown
  >;
  const inheritedSourceEntry = {
    id: "own-source",
    label: "Own Source",
    url: "/own-source.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: inheritedSource
  };
  assert.deepEqual(
    validateManifest({ version: 1, clips: [inheritedSourceEntry] }),
    [],
    "own manifest entries with empty prototype-backed source objects should remain loadable"
  );
  const inheritedSourceAsset = inspectAnimationAsset(inheritedSourceEntry, nodClip, skeleton);
  assert.equal(
    inheritedSourceAsset.category,
    "uncategorized",
    "asset reports should not classify clips from inherited source.category metadata"
  );
  assert.equal(
    inheritedSourceAsset.posture,
    "standing",
    "asset reports should not classify clips from inherited source.posture metadata"
  );
  const blankRejectionReasonEntry = {
    id: "blank-rejected",
    label: "Blank Rejected",
    url: "/blank-rejected.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    validation: { status: "rejected" as const, reason: "" }
  };
  const blankRejectionReasonManifest = { version: 1, clips: [blankRejectionReasonEntry] } as AnimationManifest;
  assert.deepEqual(
    validateManifest(blankRejectionReasonManifest),
    ["blank-rejected has invalid validation.reason metadata"],
    "validateManifest should reject empty validation reasons instead of preserving an empty rejection string"
  );
  assert.deepEqual(
    usableManifestClips(blankRejectionReasonManifest),
    [],
    "usableManifestClips should not treat a rejected clip with an empty reason as usable"
  );
  assert.deepEqual(
    rejectedAnimationReport(blankRejectionReasonManifest).map((entry) => [entry.id, entry.reason]),
    [["blank-rejected", "has invalid validation.reason metadata"]],
    "rejectedAnimationReport should emit deterministic metadata reasons for empty rejection strings"
  );
  assert.equal(inspectClipAsset(blankRejectionReasonEntry, nodClip).accepted, false);
  const oversizedIdEntry = {
    id: "x".repeat(4_097),
    label: "Oversized Id",
    url: "/oversized-id.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  };
  assert.ok(
    validateManifest({ version: 1, clips: [oversizedIdEntry] }).includes("<unknown> has invalid id metadata"),
    "validateManifest should reject unbounded manifest id strings before using them in diagnostics"
  );
  await assert.rejects(
    () => loadManifest("/bad-clips", async () => ({ version: 1, clips: "not-an-array" })),
    /manifest \/bad-clips clips must be an array/,
    "loadManifest should reject malformed loaded clip tables instead of silently dropping them"
  );
  await assert.rejects(
    () =>
      loadManifest("/sparse-clips", async () => {
        const clips = [] as unknown[];
        clips[1] = {
          id: "sparse-loaded",
          label: "Sparse Loaded",
          url: "/sparse-loaded.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        };
        return { version: 1, clips };
      }),
    /manifest \/sparse-clips clips must be a dense array/,
    "loadManifest should reject sparse loaded clip arrays instead of preserving holes"
  );
  await assert.rejects(
    () =>
      loadManifest("/too-many-clips", async () => ({
        version: 1,
        clips: Array.from({ length: MAX_MANIFEST_CLIPS_PER_MANIFEST + 1 }, (_, index) => ({
          id: `loaded-${index}`,
          label: `Loaded ${index}`,
          url: `/loaded-${index}.waifuanim.bin`,
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }))
      })),
    new RegExp(`manifest /too-many-clips clips exceed ${MAX_MANIFEST_CLIPS_PER_MANIFEST} entries`),
    "loadManifest should apply the same conservative per-manifest clip bound as validation"
  );
  await assert.rejects(
    () => loadManifest("/sparse-includes", async () => ({ version: 1, includes: sparseIncludes, clips: [] })),
    /manifest \/sparse-includes includes must be an array of non-empty strings/,
    "loadManifest should reject sparse include arrays instead of recursing into undefined include ids"
  );
  const cycleLoadedManifest = await loadManifest("/cycle-a", async (url) => {
    if (url === "/cycle-a") {
      return {
        version: 1,
        includes: ["/cycle-b"],
        clips: [
          {
            id: "cycle-a",
            label: "Cycle A",
            url: "/cycle-a.waifuanim.bin",
            format: WAIFU_ANIMATION_BINARY_FORMAT
          }
        ]
      };
    }
    return {
      version: 1,
      includes: ["/cycle-a"],
      clips: [
        {
          id: "cycle-b",
          label: "Cycle B",
          url: "/cycle-b.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
      ]
    };
  });
  assert.deepEqual(
    cycleLoadedManifest.clips.map((entry) => entry.id),
    ["cycle-a", "cycle-b"],
    "loadManifest should keep deterministic parent-before-include clip ordering while cutting include cycles"
  );
  await assert.rejects(
    () =>
      loadManifest("/too-many-includes", async () => ({ version: 1, includes: ["/a", "/b"], clips: [] }), {
        maxIncludesPerManifest: 1
      }),
    /manifest \/too-many-includes includes exceed 1 entries/,
    "loadManifest should apply a deterministic per-manifest include bound"
  );
  await assert.rejects(
    () =>
      loadManifest(
        "/too-deep-a",
        async (url) => ({
          version: 1,
          includes: url.endsWith("a") ? ["/too-deep-b"] : url.endsWith("b") ? ["/too-deep-c"] : [],
          clips: []
        }),
        { maxIncludeDepth: 1 }
      ),
    /manifest include depth exceeds 1 at \/too-deep-c/,
    "loadManifest should apply an explicit include recursion depth bound before loading nested manifests"
  );
  await assert.rejects(
    () =>
      loadManifest(
        "/too-many-total-a",
        async (url) => ({ version: 1, includes: url.endsWith("a") ? ["/too-many-total-b"] : [], clips: [] }),
        { maxManifestCount: 1 }
      ),
    /manifest include count exceeds 1 at \/too-many-total-b/,
    "loadManifest should apply an explicit total manifest load bound before fetching another include"
  );
  await assert.rejects(
    () =>
      loadManifest(
        "/optional-too-many-total-a",
        async (url) => ({
          version: 1,
          includes: url.endsWith("a") ? ["/optional-too-many-total-b"] : [],
          clips: []
        }),
        { maxManifestCount: 1, optionalIncludes: true }
      ),
    /manifest include count exceeds 1 at \/optional-too-many-total-b/,
    "optional include loading should not suppress explicit include resource bounds"
  );
  const sharedIncludeOrder: string[] = [];
  const sharedIncludeManifest = await loadManifest("/shared-root", async (url) => {
    sharedIncludeOrder.push(url);
    if (url === "/shared-root") {
      return {
        version: 1,
        includes: ["/left", "/right"],
        clips: [
          {
            id: "root",
            label: "Root",
            url: "/root.waifuanim.bin",
            format: WAIFU_ANIMATION_BINARY_FORMAT
          }
        ]
      };
    }
    if (url === "/left") {
      return {
        version: 1,
        includes: ["/shared-leaf"],
        clips: [
          {
            id: "left",
            label: "Left",
            url: "/left.waifuanim.bin",
            format: WAIFU_ANIMATION_BINARY_FORMAT
          }
        ]
      };
    }
    if (url === "/right") {
      return {
        version: 1,
        includes: ["/shared-leaf"],
        clips: [
          {
            id: "right",
            label: "Right",
            url: "/right.waifuanim.bin",
            format: WAIFU_ANIMATION_BINARY_FORMAT
          }
        ]
      };
    }
    return {
      version: 1,
      clips: [
        {
          id: "shared-leaf",
          label: "Shared Leaf",
          url: "/shared-leaf.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
      ]
    };
  });
  assert.deepEqual(
    sharedIncludeOrder,
    ["/shared-root", "/left", "/shared-leaf", "/right"],
    "loadManifest should load includes deterministically and avoid re-loading a shared include"
  );
  assert.deepEqual(
    sharedIncludeManifest.clips.map((entry) => entry.id),
    ["root", "left", "shared-leaf", "right"],
    "loadManifest should preserve depth-first parent-before-include ordering when multiple branches share an include"
  );
  assert.deepEqual(
    validateManifest({
      version: 1,
      clips: [
        {
          id: "invalid-root-motion-channel-policy",
          label: "Invalid Root Motion Channel Policy",
          url: "/invalid-root-motion-channel-policy.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", translationPolicy: "keep-everything" } }
        },
        {
          id: "sparse-tags",
          label: "Sparse Tags",
          url: "/sparse-tags.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          tags: (() => {
            const tags = ["idle"] as unknown[];
            tags[2] = "loop";
            return tags;
          })()
        },
        {
          id: "oversized-root-motion-axes",
          label: "Oversized Root Motion Axes",
          url: "/oversized-root-motion-axes.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "stripped-to-in-place", extractedAxes: ["x", "y", "z", "x"] } }
        }
      ]
    } as unknown as AnimationManifest),
    [
      "invalid-root-motion-channel-policy has invalid source.rootMotion.translationPolicy keep-everything",
      "sparse-tags has invalid tags metadata",
      "oversized-root-motion-axes has invalid source.rootMotion.extractedAxes metadata"
    ],
    "validateManifest should reject malformed broader metadata arrays and root-motion channel policy fields deterministically"
  );
  assert.equal(
    readRootMotionMetadata(
      {
        id: "invalid-channel-policy-fallback",
        label: "Invalid Channel Policy Fallback",
        url: "/invalid-channel-policy-fallback.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved", translationPolicy: "keep-everything" } }
      },
      { ...nodClip, metadata: { rootMotionPolicy: "stripped-to-in-place" } }
    ),
    null,
    "readRootMotionMetadata should reject invalid manifest channel policy fields instead of partially reading metadata or falling back to clip metadata"
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
  const invalidTopLevelManifestFetches: string[] = [];
  const invalidTopLevelManifestReport = await validateAnimationManifestAssets(
    {
      version: 0,
      includes: ["/shared.json", ""],
      source: [],
      clips: [
        {
          id: "must-not-fetch",
          label: "Must Not Fetch",
          url: "/must-not-fetch.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
      ]
    } as unknown as AnimationManifest,
    async (url) => {
      invalidTopLevelManifestFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton, now: new Date("2026-01-01T00:00:00.000Z") }
  );
  assert.deepEqual(invalidTopLevelManifestFetches, []);
  assert.equal(invalidTopLevelManifestReport.accepted, 0);
  assert.equal(invalidTopLevelManifestReport.rejected, 1);
  assert.deepEqual(
    invalidTopLevelManifestReport.entries[0]!.issues.map((issue) => issue.message),
    [
      "manifest version must be a positive integer",
      "manifest includes must be an array of non-empty strings",
      "manifest source must be an object"
    ],
    "asset validation should preflight invalid top-level version/includes/source before fetching any clip asset"
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
  assert.deepEqual(sparseManifestFetches, []);
  assert.equal(sparseManifestAssetReport.accepted, 0);
  assert.equal(sparseManifestAssetReport.rejected, 1);
  assert.ok(
    sparseManifestAssetReport.entries[0]!.issues.some(
      (issue) => issue.message === "manifest clips must be a dense array"
    ),
    "asset report validation should reject sparse manifest clip tables without fetching present entries"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: sparseManifestClips } as unknown as AnimationManifest),
    ["manifest clips must be a dense array"],
    "validateManifest should reject sparse clip arrays before iterating holes"
  );
  const sparseHugeManifestClips = [] as unknown[];
  sparseHugeManifestClips.length = 1_000_000_000;
  sparseHugeManifestClips[MAX_MANIFEST_CLIPS_PER_MANIFEST] = {
    id: "sparse-huge-last",
    label: "Sparse Huge Last",
    url: "/sparse-huge-last.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  };
  assert.deepEqual(
    validateManifest({ version: 1, clips: sparseHugeManifestClips } as unknown as AnimationManifest),
    [`manifest clips exceed ${MAX_MANIFEST_CLIPS_PER_MANIFEST} entries`],
    "validateManifest should reject huge sparse clip arrays by length before scanning holes"
  );
  const sparseHugeManifestFetches: string[] = [];
  const sparseHugeManifestReport = await validateAnimationManifestAssets(
    { version: 1, clips: sparseHugeManifestClips } as unknown as AnimationManifest,
    async (url) => {
      sparseHugeManifestFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(sparseHugeManifestFetches, []);
  assert.equal(sparseHugeManifestReport.total, 1);
  assert.equal(sparseHugeManifestReport.rejected, 1);
  assert.deepEqual(
    sparseHugeManifestReport.entries[0]!.issues.map((issue) => issue.message),
    [`manifest clips exceed ${MAX_MANIFEST_CLIPS_PER_MANIFEST} entries`],
    "asset validation should reject hostile huge clip arrays deterministically before fetching assets"
  );
  assert.deepEqual(
    validateManifest({
      version: 1,
      clips: Array.from({ length: MAX_MANIFEST_CLIPS_PER_MANIFEST + 1 }, (_, index) => ({
        id: `bounded-${index}`,
        label: `Bounded ${index}`,
        url: `/bounded-${index}.waifuanim.bin`,
        format: WAIFU_ANIMATION_BINARY_FORMAT
      }))
    }),
    [`manifest clips exceed ${MAX_MANIFEST_CLIPS_PER_MANIFEST} entries`],
    "validateManifest should reject dense clip arrays above the explicit resource bound"
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
    validateManifest({
      version: 1,
      clips: [
        {
          id: "conflicting-root-motion-policy-alias",
          label: "Conflicting Root Motion Policy Alias",
          url: "/conflicting-root-motion-policy-alias.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "stripped-to-in-place" }, rootMotionPolicy: "preserved" }
        },
        {
          id: "invalid-root-motion-carrier",
          label: "Invalid Root Motion Carrier",
          url: "/invalid-root-motion-carrier.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", carrier: Number.POSITIVE_INFINITY } }
        },
        {
          id: "duplicate-root-motion-axes",
          label: "Duplicate Root Motion Axes",
          url: "/duplicate-root-motion-axes.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "stripped-to-in-place", extractedAxes: ["x", "x"] } }
        },
        {
          id: "ambiguous-root-motion-carrier",
          label: "Ambiguous Root Motion Carrier",
          url: "/ambiguous-root-motion-carrier.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", carrier: { jointIndex: 0, joint: "hips" } } }
        },
        {
          id: "conflicting-root-motion-carrier-aliases",
          label: "Conflicting Root Motion Carrier Aliases",
          url: "/conflicting-root-motion-carrier-aliases.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", carrier: { jointIndex: 0, index: 1 } } }
        },
        {
          id: "duplicate-root-motion-carrier-aliases",
          label: "Duplicate Root Motion Carrier Aliases",
          url: "/duplicate-root-motion-carrier-aliases.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", carrier: { jointIndex: 0, index: 0 } } }
        },
        {
          id: "invalid-root-motion-carrier-human-bone",
          label: "Invalid Root Motion Carrier Human Bone",
          url: "/invalid-root-motion-carrier-human-bone.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          source: { rootMotion: { policy: "preserved", carrier: { humanBone: "tail" } } }
        }
      ]
    }),
    [
      "conflicting-root-motion-policy-alias has conflicting source.rootMotionPolicy preserved for source.rootMotion.policy stripped-to-in-place",
      "invalid-root-motion-carrier has invalid source.rootMotion.carrier Infinity",
      "duplicate-root-motion-axes has duplicate source.rootMotion.extractedAxes metadata",
      "ambiguous-root-motion-carrier has invalid source.rootMotion.carrier metadata",
      "conflicting-root-motion-carrier-aliases has invalid source.rootMotion.carrier metadata",
      "duplicate-root-motion-carrier-aliases has invalid source.rootMotion.carrier metadata",
      "invalid-root-motion-carrier-human-bone has invalid source.rootMotion.carrier tail"
    ],
    "root-motion manifest validation should reject contradictory aliases and malformed carrier/axis declarations deterministically"
  );
  const manifestCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "manifest-carrier-hint",
      label: "Manifest Carrier Hint",
      url: "/manifest-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", carrier: "hips" } }
    },
    {
      clip: { ...nodClip, metadata: { rootMotionCarrier: "head" } },
      skeleton,
      bindingId: "manifest-carrier"
    }
  );
  assert.deepEqual(
    manifestCarrierHint.motionCarrier,
    { joint: "hips" },
    "manifest source.rootMotion.carrier should normalize to an explicit AnimationRuntime motionCarrier"
  );
  assert.deepEqual(
    manifestCarrierHint.reconcilerCarrierBinding,
    { select: "bone", id: "manifest-carrier", jointIndex: 0, joint: "hips" },
    "manifest carrier hints should resolve to concrete RootMotionReconciler bone bindings when a skeleton is supplied"
  );
  assert.ok(
    manifestCarrierHint.issues.some((issue) => issue.code === "conflict" && issue.source === "clip-metadata"),
    "manifest carrier hints should remain authoritative and report conflicting clip metadata carrier hints"
  );
  const malformedCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "malformed-carrier-hint",
      label: "Malformed Carrier Hint",
      url: "/malformed-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", carrier: { jointIndex: 0, joint: "hips" } } }
    },
    { skeleton }
  );
  assert.equal(malformedCarrierHint.motionCarrier, null);
  assert.ok(
    malformedCarrierHint.issues.some((issue) => issue.code === "conflict"),
    "conflicting source.rootMotion.carrier selector fields should block unsafe handoff helpers"
  );
  const missingCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "missing-carrier-hint",
      label: "Missing Carrier Hint",
      url: "/missing-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", carrier: { joint: "missing" } } }
    },
    { skeleton }
  );
  assert.equal(missingCarrierHint.motionCarrier, null);
  assert.ok(
    missingCarrierHint.issues.some((issue) => issue.code === "skeleton-mismatch"),
    "carrier handoff helpers should reject hints that do not map to the target skeleton instead of falling back to root"
  );
  const invalidPolicyAliasCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "invalid-policy-alias-carrier-hint",
      label: "Invalid Policy Alias Carrier Hint",
      url: "/invalid-policy-alias-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotionPolicy: "keep-everything" }
    },
    { clip: { ...nodClip, metadata: { rootMotionCarrier: "hips" } }, skeleton }
  );
  assert.equal(invalidPolicyAliasCarrierHint.motionCarrier, null);
  assert.ok(
    invalidPolicyAliasCarrierHint.issues.some(
      (issue) => issue.code === "invalid" && issue.field === "source.rootMotionPolicy"
    ),
    "invalid manifest root-motion aliases should report why clip carrier fallback was blocked"
  );
  const inheritedCarrier = Object.create({ joint: "hips" }) as Record<string, unknown>;
  const inheritedCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "inherited-carrier-hint",
      label: "Inherited Carrier Hint",
      url: "/inherited-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", carrier: inheritedCarrier } }
    },
    { skeleton }
  );
  assert.equal(inheritedCarrierHint.motionCarrier, null);
  assert.ok(
    inheritedCarrierHint.issues.some((issue) => issue.code === "invalid"),
    "carrier handoff helpers should not accept inherited prototype selector fields as manifest metadata"
  );
  const equivalentClipCarrierHint = resolveRootMotionCarrierHint(
    {
      id: "equivalent-clip-carrier-hint",
      label: "Equivalent Clip Carrier Hint",
      url: "/equivalent-clip-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      clip: { ...nodClip, metadata: { rootMotionCarrier: { humanBone: "hips" }, motionCarrier: { joint: "hips" } } },
      skeleton
    }
  );
  assert.deepEqual(equivalentClipCarrierHint.motionCarrier, { humanBone: "hips" });
  assert.deepEqual(equivalentClipCarrierHint.resolved, { jointIndex: 0, joint: "hips" });
  assert.ok(
    equivalentClipCarrierHint.issues.some((issue) => issue.code === "duplicate") &&
      !equivalentClipCarrierHint.issues.some((issue) => issue.code === "conflict"),
    "clip carrier aliases that resolve to the same skeleton joint should be duplicate diagnostics, not conflicts"
  );
  const humanoidCarrierWithoutSkeleton = resolveRootMotionCarrierHint({
    id: "humanoid-carrier-without-skeleton",
    label: "Humanoid Carrier Without Skeleton",
    url: "/humanoid-carrier-without-skeleton.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "preserved", carrier: { humanBone: "hips" } } }
  });
  assert.deepEqual(humanoidCarrierWithoutSkeleton.motionCarrier, { humanBone: "hips" });
  assert.equal(
    humanoidCarrierWithoutSkeleton.reconcilerCarrierBinding,
    null,
    "humanBone carriers need a target skeleton before the helper can safely derive RootMotionReconciler bindings"
  );
  const sanitizedBindingHint = resolveRootMotionCarrierHint(
    {
      id: "sanitized-binding-carrier-hint",
      label: "Sanitized Binding Carrier Hint",
      url: "/sanitized-binding-carrier-hint.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", carrier: "hips" } }
    },
    { bindingId: "", bindingPriority: 1e100 }
  );
  assert.deepEqual(
    sanitizedBindingHint.reconcilerCarrierBinding,
    { select: "bone", priority: 1_000_000, joint: "hips" },
    "carrier handoff helpers should omit unsafe binding ids and clamp binding priority before returning policy bindings"
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
  const rejectedManifestEntry = {
    id: "rejected-no-fetch",
    label: "Rejected No Fetch",
    url: "/rejected-no-fetch.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    validation: { status: "rejected" as const, reason: "manual reject", issues: ["bad hands"] }
  };
  const rejectedAssetInspection = inspectAnimationAsset(rejectedManifestEntry, nodClip, skeleton);
  assert.equal(rejectedAssetInspection.status, "rejected");
  assert.equal(rejectedAssetInspection.accepted, false);
  assert.ok(
    rejectedAssetInspection.issues.some((issue) => issue.message === "manual reject") &&
      rejectedAssetInspection.issues.some((issue) => issue.message === "bad hands"),
    "inspectAnimationAsset should preserve explicit rejected manifest diagnostics"
  );
  const quarantinedAssetInspection = inspectAnimationAsset(quarantinedManifestEntry, nodClip, skeleton);
  assert.equal(quarantinedAssetInspection.status, "quarantined");
  assert.equal(quarantinedAssetInspection.accepted, false);
  assert.ok(
    quarantinedAssetInspection.issues.some((issue) => issue.message === "manual hold"),
    "inspectAnimationAsset should preserve manifest quarantine reasons as validation issues"
  );
  const noFetchManifest = {
    version: 1,
    clips: [
      rejectedManifestEntry,
      { ...quarantinedManifestEntry, validation: { ...quarantinedManifestEntry.validation, issues: ["needs review"] } }
    ]
  } as AnimationManifest;
  const noFetchUrls: string[] = [];
  const noFetchAssetValidationReport = await validateAnimationManifestAssets(
    noFetchManifest,
    async (url) => {
      noFetchUrls.push(url);
      throw new Error(`fetch should not run for ${url}`);
    },
    { skeleton, now: new Date("2026-01-01T00:00:00.000Z") }
  );
  assert.deepEqual(noFetchUrls, []);
  assert.equal(noFetchAssetValidationReport.accepted, 0);
  assert.equal(noFetchAssetValidationReport.rejected, 1);
  assert.equal(noFetchAssetValidationReport.quarantined, 1);
  assert.equal(noFetchAssetValidationReport.entries[0]!.status, "rejected");
  assert.ok(noFetchAssetValidationReport.entries[0]!.issues.some((issue) => issue.message === "manual reject"));
  assert.equal(noFetchAssetValidationReport.entries[1]!.status, "quarantined");
  assert.ok(noFetchAssetValidationReport.entries[1]!.issues.some((issue) => issue.message === "manual hold"));
  assert.ok(noFetchAssetValidationReport.entries[1]!.issues.some((issue) => issue.message === "needs review"));
  const quarantinedAssetValidationReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [quarantinedManifestEntry]
    },
    async () => {
      throw new Error("quarantined clip should not fetch");
    },
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
  const malformedClipEntry = {
    id: "malformed-clip",
    label: "Malformed Clip",
    url: "/malformed-clip.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT
  };
  const malformedClip = { id: "malformed-clip", duration: 1 } as unknown as AnimationClip;
  const malformedClipAssetInspection = inspectAnimationAsset(malformedClipEntry, malformedClip, skeleton);
  assert.equal(malformedClipAssetInspection.status, "rejected");
  assert.equal(malformedClipAssetInspection.duration, 0);
  assert.ok(
    malformedClipAssetInspection.issues.some((issue) => issue.message === "clip tracks must be an array"),
    "inspectAnimationAsset should return a rejected report for malformed clip containers instead of throwing"
  );
  const malformedDirectClipInspection = inspectClipAsset(malformedClipEntry, malformedClip);
  assert.equal(malformedDirectClipInspection.accepted, false);
  assert.equal(malformedDirectClipInspection.trackCount, 0);
  assert.ok(
    malformedDirectClipInspection.issues.some((issue) => issue.message === "clip tracks must be an array"),
    "inspectClipAsset should return rejected diagnostics for malformed clip containers instead of throwing"
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
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      states: (() => {
        const states = ["idle"] as unknown[];
        states[2] = "walk";
        return states;
      })()
    } as unknown as AnimationManifest["clips"][number],
    malformedRootCarrierClip,
    skeleton
  );
  assert.equal(malformedRootCarrierInspection.status, "rejected");
  assert.ok(
    malformedRootCarrierInspection.issues.some((issue) => issue.message === "track times must be a Float32Array"),
    "root-carrier manifest helpers should ignore malformed runtime track buffers after validation reports them"
  );
  assert.deepEqual(
    malformedRootCarrierInspection.compatibleStates,
    [],
    "asset reports should not copy sparse metadata arrays after manifest validation rejects them"
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
          id: "invalid-sparse-states-metadata-asset",
          label: "Invalid Sparse States Metadata Asset",
          url: "/invalid-sparse-states-metadata-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          states: (() => {
            const states = ["idle"] as unknown[];
            states[2] = "walk";
            return states;
          })()
        },
        {
          id: "valid-metadata-asset",
          label: "Valid Metadata Asset",
          url: "/valid-metadata-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT
        }
      ]
    } as unknown as AnimationManifest,
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
  assert.equal(metadataRejectedAssetReport.rejected, 4);
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
  assert.ok(
    metadataRejectedAssetReport.entries[3]!.issues.some((issue) => issue.message === "has invalid states metadata")
  );
}
