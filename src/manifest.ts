import { type AnimationClip, type ClipValidationIssue, validateClip } from "./clip.js";
import { WAIFU_ANIMATION_BINARY_FORMAT } from "./binary.js";
import type { MotionCarrier } from "./motion.js";
import type { RootMotionCarrierBinding } from "./root-motion-authority.js";
import {
  duplicatedManifestIds,
  isRootCarrierRotationTrack,
  isRootCarrierTranslationTrack,
  resolveManifestPlaybackWindow,
  rootCarrierRotationTrackHasYawMotion,
  rootCarrierTranslationTrackHasMotion
} from "./manifest-clip-helpers.js";
import {
  type HumanoidBoneName,
  type HumanoidBoneNameLike,
  type Skeleton,
  isHumanoidBoneName,
  resolveHumanoidIndex,
  resolveJointIndex
} from "./skeleton.js";

export type AssetValidationStatus = "accepted" | "rejected" | "quarantined";
export type AnimationManifestFormat = typeof WAIFU_ANIMATION_BINARY_FORMAT | (string & {});

export type AnimationManifestEntry = {
  id: string;
  label: string;
  url: string;
  format: AnimationManifestFormat;
  playback?: {
    start?: number;
    end?: number;
  };
  loop?: boolean;
  preload?: boolean;
  autoplay?: boolean;
  weight?: number;
  tags?: string[];
  source?: Record<string, unknown>;
  states?: string[];
  emotions?: string[];
  gestures?: string[];
  validation?: {
    status?: AssetValidationStatus;
    reason?: string;
    issues?: string[];
  };
};

export type AnimationManifest = {
  version: number;
  includes?: string[];
  source?: Record<string, unknown>;
  clips: AnimationManifestEntry[];
};

export type ClipAssetInspection = {
  id: string;
  url: string;
  accepted: boolean;
  trackCount: number;
  duration: number;
  issues: ClipValidationIssue[];
};

export type RootMotionPolicy = "none" | "preserved" | "stripped-to-in-place";
export type RootMotionProvenance =
  | "unknown"
  | "not-authored"
  | "preserved-in-clip"
  | "stripped-during-conversion"
  | "requires-runtime-stripping"
  | "stationary-residual";
export type RootMotionMetadata = {
  policy: RootMotionPolicy;
  provenance: RootMotionProvenance;
  translationPolicy?: RootMotionPolicy;
  yawPolicy?: RootMotionPolicy;
};
export type RootMotionCarrierHintSource = "manifest" | "clip-metadata";
export type RootMotionCarrierHintIssueCode = "invalid" | "duplicate" | "conflict" | "skeleton-mismatch";
export type RootMotionCarrierHintIssue = {
  source: RootMotionCarrierHintSource;
  field: string;
  code: RootMotionCarrierHintIssueCode;
  message: string;
};
export type ResolvedRootMotionCarrierHint = {
  jointIndex: number;
  joint: string;
};
export type RootMotionCarrierHintOptions = {
  /** Optional decoded clip. When supplied, clip metadata is used as a fallback after manifest source metadata. */
  clip?: AnimationClip;
  /** Optional target skeleton used to validate carriers and resolve humanoid hints to concrete runtime report joints. */
  skeleton?: Skeleton;
  /** Optional id copied onto the returned RootMotionReconciler carrier binding. */
  bindingId?: string;
  /** Optional priority copied onto the returned RootMotionReconciler carrier binding. */
  bindingPriority?: number;
};
export type RootMotionCarrierHintResolution = {
  /** Winning carrier source. Manifest source metadata is authoritative over clip metadata when both are present. */
  source: RootMotionCarrierHintSource | null;
  /** Winning metadata field path, useful for deterministic diagnostics. */
  field: string | null;
  /** Explicit value suitable for AnimationRuntime layer options. Null means no validated carrier hint was present. */
  motionCarrier: MotionCarrier | null;
  /** Explicit binding suitable for RootMotionReconciler policy.carrierBindings. Null means no safe binding was derivable. */
  reconcilerCarrierBinding: RootMotionCarrierBinding | null;
  /** Concrete target-skeleton carrier when a skeleton was supplied and the hint mapped successfully. */
  resolved: ResolvedRootMotionCarrierHint | null;
  issues: RootMotionCarrierHintIssue[];
};

const MAX_ROOT_MOTION_CARRIER_STRING_LENGTH = 512;
const MAX_ROOT_MOTION_BINDING_PRIORITY = 1_000_000;
const MAX_FORMATTED_UNKNOWN_VALUE_LENGTH = 512;
const MAX_MANIFEST_STRING_LENGTH = 4_096;
const MAX_MANIFEST_STRING_ARRAY_LENGTH = 1_024;
export const MAX_MANIFEST_CLIPS_PER_MANIFEST = 1_024;
const DEFAULT_MAX_MANIFEST_INCLUDE_DEPTH = 64;
const DEFAULT_MAX_MANIFEST_TOTAL_LOADS = 1_024;
const DEFAULT_MAX_MANIFEST_INCLUDES_PER_MANIFEST = 1_024;
const ROOT_MOTION_CARRIER_INDEX_FIELDS = ["jointIndex", "joint_index", "index"] as const;
const ROOT_MOTION_CARRIER_JOINT_FIELDS = ["joint", "name", "jointName", "joint_name"] as const;
const ROOT_MOTION_CARRIER_HUMAN_BONE_FIELDS = ["humanBone", "human_bone", "humanoid"] as const;

class ManifestIncludeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestIncludeLimitError";
  }
}

export type RequiredAnimationCoverage = {
  requiredHumanBones: HumanoidBoneName[];
  requiredJoints: string[];
};

export type AssetLoader = (url: string) => Promise<unknown>;

export type ManifestLoaderOptions = {
  resolveInclude?: (includeUrl: string, parentUrl: string) => string;
  optionalIncludes?: boolean;
  maxIncludeDepth?: number;
  maxManifestCount?: number;
  maxIncludesPerManifest?: number;
  maxClipsPerManifest?: number;
};

export function validateManifestTopLevel(manifest: AnimationManifest): string[] {
  const issues: string[] = [];
  if (!isRecord(manifest)) return ["manifest must be an object"];
  const version = ownValue(manifest, "version");
  if (!Number.isInteger(version) || (version as number) < 1) issues.push("manifest version must be a positive integer");
  const manifestIncludes = ownValue(manifest, "includes");
  if (manifestIncludes !== undefined) {
    if (
      !Array.isArray(manifestIncludes) ||
      manifestIncludes.length > DEFAULT_MAX_MANIFEST_INCLUDES_PER_MANIFEST ||
      !isDenseArray(manifestIncludes) ||
      manifestIncludes.some((include) => !isNonEmptyString(include))
    ) {
      issues.push("manifest includes must be an array of non-empty strings");
    }
  }
  const manifestSource = ownValue(manifest, "source");
  if (manifestSource !== undefined && !isRecord(manifestSource)) issues.push("manifest source must be an object");
  const clipsIssue = manifestClipsTableIssue(ownValue(manifest, "clips"));
  if (clipsIssue) issues.push(clipsIssue);
  return issues;
}

export function validateManifest(manifest: AnimationManifest): string[] {
  const issues = validateManifestTopLevel(manifest);
  const ids = new Set<string>();
  if (!isRecord(manifest)) return issues;
  const clips = readManifestClips(manifest);
  if (!clips) return issues;
  for (let index = 0; index < clips.length; index += 1) {
    const entry = clips[index]!;
    if (!isManifestEntryObject(entry)) {
      issues.push("manifest entry must be an object");
      continue;
    }
    const entryId = readManifestEntryId(entry);
    const entryUrl = readManifestEntryUrl(entry);
    const issueId = manifestEntryIssueId(entry);
    if (!entryId) issues.push("manifest entry is missing id");
    if (!entryUrl) issues.push(`${issueId} is missing url`);
    const metadataIssue = manifestEntryMetadataIssue(entry);
    if (metadataIssue) issues.push(`${issueId} ${metadataIssue}`);
    const entryFormat = ownValue(entry, "format");
    if (entryFormat !== WAIFU_ANIMATION_BINARY_FORMAT)
      issues.push(`${issueId} has unsupported format ${formatUnknownValue(entryFormat)}`);
    if (entryId) {
      if (ids.has(entryId)) issues.push(`duplicate clip id ${entryId}`);
      ids.add(entryId);
    }
    const validationStatus = readManifestValidationStatus(entry);
    if (isInvalidAssetValidationStatus(validationStatus)) {
      issues.push(`${issueId} has invalid validation status ${formatUnknownValue(validationStatus)}`);
    }
    if (validationStatus === "accepted" && readManifestValidationReason(entry) !== undefined) {
      issues.push(`${issueId} is accepted but still has rejection reason`);
    }
    const rootMotionPolicyIssue = manifestRootMotionPolicyIssue(entry);
    if (rootMotionPolicyIssue) issues.push(`${issueId} ${rootMotionPolicyIssue}`);
    const coverageIssue = manifestRequiredCoverageIssue(entry);
    if (coverageIssue) issues.push(`${issueId} ${coverageIssue}`);
  }
  return issues;
}

export async function loadManifest(
  url: string,
  loader: AssetLoader,
  options: ManifestLoaderOptions = {},
  seen = new Set<string>(),
  depth = 0
): Promise<AnimationManifest> {
  if (seen.has(url)) return { version: 1, clips: [] };
  const maxDepth = positiveIntegerOption(options.maxIncludeDepth, DEFAULT_MAX_MANIFEST_INCLUDE_DEPTH);
  if (depth > maxDepth) throw new ManifestIncludeLimitError(`manifest include depth exceeds ${maxDepth} at ${url}`);
  const maxManifestCount = positiveIntegerOption(options.maxManifestCount, DEFAULT_MAX_MANIFEST_TOTAL_LOADS);
  if (seen.size >= maxManifestCount)
    throw new ManifestIncludeLimitError(`manifest include count exceeds ${maxManifestCount} at ${url}`);
  seen.add(url);
  const manifest = readLoadedManifest(await loader(url), url);
  const maxClips = Math.min(
    positiveIntegerOption(options.maxClipsPerManifest, MAX_MANIFEST_CLIPS_PER_MANIFEST),
    MAX_MANIFEST_CLIPS_PER_MANIFEST
  );
  const clips = readManifestClipsForLoad(manifest, url, maxClips);
  const manifestIncludes = readManifestIncludes(manifest, url, options);
  const includedClips: AnimationManifestEntry[] = [];
  for (const includeUrl of manifestIncludes) {
    const resolved = options.resolveInclude?.(includeUrl, url) ?? includeUrl;
    if (!isNonEmptyString(resolved)) {
      throw new Error(`manifest ${url} resolved include must be a non-empty string`);
    }
    try {
      const includedManifest = await loadManifest(resolved, loader, options, seen, depth + 1);
      const nextIncludedClips = readManifestClips(includedManifest, maxClips) ?? [];
      if (clips.length + includedClips.length + nextIncludedClips.length > maxClips) {
        throw new ManifestIncludeLimitError(`manifest ${url} clips exceed ${maxClips} entries after includes`);
      }
      includedClips.push(...nextIncludedClips);
    } catch (error) {
      if (error instanceof ManifestIncludeLimitError || !options.optionalIncludes) throw error;
    }
  }
  return {
    ...manifest,
    clips: clips.concat(includedClips)
  };
}

export function inspectClipAsset(entry: AnimationManifestEntry, clip: AnimationClip): ClipAssetInspection {
  const issues = validateClip(clip);
  const clipRecord = isRecord(clip) ? clip : {};
  const clipTracksValue = ownValue(clipRecord, "tracks");
  const clipTracks = Array.isArray(clipTracksValue) ? (clipTracksValue as AnimationClip["tracks"]) : [];
  const clipDurationValue = ownValue(clipRecord, "duration");
  const clipDuration =
    typeof clipDurationValue === "number" && Number.isFinite(clipDurationValue) ? clipDurationValue : 0;
  if (!isManifestEntryObject(entry)) {
    issues.push({ message: "manifest entry must be an object" });
    return {
      id: "<unknown>",
      url: "",
      accepted: false,
      trackCount: clipTracks.length,
      duration: clipDuration,
      issues
    };
  }
  const entryId = readManifestEntryId(entry);
  const entryUrl = readManifestEntryUrl(entry);
  const issueId = manifestEntryIssueId(entry);
  if (!entryId) issues.push({ message: "manifest entry is missing id" });
  if (!entryUrl) issues.push({ message: `${issueId} is missing url` });
  const metadataIssue = manifestEntryMetadataIssue(entry);
  if (metadataIssue) issues.push({ message: metadataIssue });
  const entryFormat = ownValue(entry, "format");
  if (entryFormat !== WAIFU_ANIMATION_BINARY_FORMAT) {
    issues.push({ message: `${issueId} has unsupported format ${formatUnknownValue(entryFormat)}` });
  }
  const rootMotionPolicy = readRootMotionPolicy(entry, clip);
  const translationPolicy = readRootMotionChannelPolicy(entry, clip, "translation");
  const yawPolicy = readRootMotionChannelPolicy(entry, clip, "yaw");
  const hasRootCarrierTranslationTrack = clipTracks.some(isRootCarrierTranslationTrack);
  const hasRootCarrierRotationTrack = clipTracks.some(isRootCarrierRotationTrack);
  const playbackWindow = resolveManifestPlaybackWindow(entry, clip);
  const movingRootCarrierTranslationTrack = playbackWindow
    ? clipTracks.find((track) => rootCarrierTranslationTrackHasMotion(track, playbackWindow))
    : undefined;
  const movingRootCarrierYawTrack = playbackWindow
    ? clipTracks.find((track) => rootCarrierRotationTrackHasYawMotion(track, playbackWindow))
    : undefined;
  const rootMotionPolicyIssue =
    manifestRootMotionPolicyIssue(entry) ?? clipRootMotionPolicyIssue(clip) ?? clipRootMotionConflictIssue(entry, clip);
  if (rootMotionPolicyIssue) {
    issues.push({ message: rootMotionPolicyIssue });
  }
  if (isRootMotionNamed(entry, clip)) {
    if (!rootMotionPolicy) {
      issues.push({ message: "root-motion clip must declare source.rootMotion.policy" });
    }
  }
  if (rootMotionPolicy === "preserved" && !hasRootCarrierTranslationTrack && !hasRootCarrierRotationTrack) {
    issues.push({ message: "root-motion policy is preserved but clip has no root carrier translation track" });
  }
  if (!rootMotionPolicy && movingRootCarrierTranslationTrack) {
    issues.push({
      joint: String(movingRootCarrierTranslationTrack.joint ?? movingRootCarrierTranslationTrack.humanBone ?? ""),
      property: movingRootCarrierTranslationTrack.property,
      message: "moving root carrier translation requires source.rootMotion.policy"
    });
  }
  if (!rootMotionPolicy && movingRootCarrierYawTrack) {
    issues.push({
      joint: String(movingRootCarrierYawTrack.joint ?? movingRootCarrierYawTrack.humanBone ?? ""),
      property: movingRootCarrierYawTrack.property,
      message: "moving root carrier yaw requires source.rootMotion.policy"
    });
  }
  if (translationPolicy === "none" && movingRootCarrierTranslationTrack) {
    issues.push({
      joint: String(movingRootCarrierTranslationTrack.joint ?? movingRootCarrierTranslationTrack.humanBone ?? ""),
      property: movingRootCarrierTranslationTrack.property,
      message: "root-motion policy is none but root carrier translation moves"
    });
  }
  if (yawPolicy === "none" && movingRootCarrierYawTrack) {
    issues.push({
      joint: String(movingRootCarrierYawTrack.joint ?? movingRootCarrierYawTrack.humanBone ?? ""),
      property: movingRootCarrierYawTrack.property,
      message: "root-motion policy is none but root carrier yaw moves"
    });
  }
  if (translationPolicy === "stripped-to-in-place") {
    if (movingRootCarrierTranslationTrack && !isIntentionalResidualRootCarrier(entry)) {
      issues.push({
        joint: String(movingRootCarrierTranslationTrack.joint ?? movingRootCarrierTranslationTrack.humanBone ?? ""),
        property: movingRootCarrierTranslationTrack.property,
        message: "root-motion policy is stripped-to-in-place but root carrier translation still moves"
      });
    }
  }
  if (yawPolicy === "stripped-to-in-place" && movingRootCarrierYawTrack) {
    issues.push({
      joint: String(movingRootCarrierYawTrack.joint ?? movingRootCarrierYawTrack.humanBone ?? ""),
      property: movingRootCarrierYawTrack.property,
      message: "root-motion policy is stripped-to-in-place but root carrier yaw still moves"
    });
  }
  const playback = ownValue(entry, "playback");
  if (playback !== undefined) {
    const start = isRecord(playback) ? (ownValue(playback, "start") ?? 0) : 0;
    const end = isRecord(playback) ? (ownValue(playback, "end") ?? clipDuration) : clipDuration;
    if (!playbackWindow) {
      issues.push({ message: `invalid playback window ${formatUnknownValue(start)}..${formatUnknownValue(end)}` });
    }
  }
  const statusIssue = manifestValidationStatusIssue(entry);
  if (statusIssue) {
    issues.push({ message: statusIssue });
  }
  return {
    id: entryId ?? "<unknown>",
    url: entryUrl ?? "",
    accepted: issues.length === 0,
    trackCount: clipTracks.length,
    duration: clipDuration,
    issues
  };
}

export function isAssetValidationStatus(value: unknown): value is AssetValidationStatus {
  return value === "accepted" || value === "rejected" || value === "quarantined";
}

export function isInvalidAssetValidationStatus(value: unknown): boolean {
  return value !== undefined && !isAssetValidationStatus(value);
}

export function manifestValidationStatusIssue(entry: AnimationManifestEntry): string | null {
  const status = readManifestValidationStatus(entry);
  if (status === "rejected" || status === "quarantined")
    return readManifestValidationReason(entry) ?? `manifest marks clip ${status}`;
  if (isInvalidAssetValidationStatus(status)) return `invalid validation status ${formatUnknownValue(status)}`;
  return null;
}

export function manifestRootMotionPolicyIssue(entry: AnimationManifestEntry): string | null {
  const sourceValue = ownValue(entry, "source");
  const entrySource = sourceValue === undefined ? {} : sourceValue;
  if (!isRecord(entrySource)) return null;
  const sourceRootMotion = ownValue(entrySource, "rootMotion");
  let declaredPolicy: RootMotionPolicy | null = null;
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string") {
      if (!isRootMotionPolicy(sourceRootMotion))
        return `has invalid source.rootMotion policy ${formatUnknownValue(sourceRootMotion)}`;
      declaredPolicy = sourceRootMotion;
    } else if (isRecord(sourceRootMotion) && hasOwn(sourceRootMotion, "policy")) {
      const policy = ownValue(sourceRootMotion, "policy");
      const provenance = ownValue(sourceRootMotion, "provenance");
      const translationPolicy = ownValue(sourceRootMotion, "translationPolicy");
      const yawPolicy = ownValue(sourceRootMotion, "yawPolicy");
      if (!isRootMotionPolicy(policy)) return `has invalid source.rootMotion.policy ${formatUnknownValue(policy)}`;
      if (provenance !== undefined && !isRootMotionProvenance(provenance))
        return `has invalid source.rootMotion.provenance ${formatUnknownValue(provenance)}`;
      if (translationPolicy !== undefined && !isRootMotionPolicy(translationPolicy))
        return `has invalid source.rootMotion.translationPolicy ${formatUnknownValue(translationPolicy)}`;
      if (yawPolicy !== undefined && !isRootMotionPolicy(yawPolicy))
        return `has invalid source.rootMotion.yawPolicy ${formatUnknownValue(yawPolicy)}`;
      const metadataIssue = rootMotionMetadataFieldIssue(sourceRootMotion);
      if (metadataIssue) return metadataIssue;
      declaredPolicy = policy;
    } else {
      return "has invalid source.rootMotion metadata";
    }
  }
  const sourcePolicy = ownValue(entrySource, "rootMotionPolicy");
  if (sourcePolicy !== undefined && !isRootMotionPolicy(sourcePolicy))
    return `has invalid source.rootMotionPolicy ${formatUnknownValue(sourcePolicy)}`;
  if (declaredPolicy && isRootMotionPolicy(sourcePolicy) && sourcePolicy !== declaredPolicy) {
    return `has conflicting source.rootMotionPolicy ${sourcePolicy} for source.rootMotion.policy ${declaredPolicy}`;
  }
  return null;
}

export function manifestRequiredCoverageIssue(entry: AnimationManifestEntry): string | null {
  const sourceValue = ownValue(entry, "source");
  const source = sourceValue === undefined ? {} : sourceValue;
  if (!isRecord(source)) return null;
  const requiredHumanBones = ownValue(source, "requiredHumanBones");
  if (requiredHumanBones !== undefined) {
    const bones = requiredHumanBones;
    if (!Array.isArray(bones) || bones.length > MAX_MANIFEST_STRING_ARRAY_LENGTH || !isDenseArray(bones))
      return "has invalid source.requiredHumanBones metadata";
    for (const bone of bones) {
      if (!isHumanoidBoneName(bone)) return `has invalid source.requiredHumanBones entry ${formatUnknownValue(bone)}`;
    }
  }
  const requiredJoints = ownValue(source, "requiredJoints");
  if (requiredJoints !== undefined) {
    const joints = requiredJoints;
    if (!Array.isArray(joints) || joints.length > MAX_MANIFEST_STRING_ARRAY_LENGTH || !isDenseArray(joints))
      return "has invalid source.requiredJoints metadata";
    for (const joint of joints) {
      if (!isNonEmptyString(joint)) return `has invalid source.requiredJoints entry ${formatUnknownValue(joint)}`;
    }
  }
  return null;
}

function rootMotionMetadataFieldIssue(metadata: Record<string, unknown>): string | null {
  const carrierIssue = rootMotionCarrierIssue(ownValue(metadata, "carrier"));
  if (carrierIssue) return `has invalid source.rootMotion.carrier ${carrierIssue}`;
  const extractedAxesIssue = optionalRootMotionAxesIssue(
    ownValue(metadata, "extractedAxes"),
    "source.rootMotion.extractedAxes"
  );
  if (extractedAxesIssue) return extractedAxesIssue;
  const preservedAxesIssue = optionalRootMotionAxesIssue(
    ownValue(metadata, "preservedAxes"),
    "source.rootMotion.preservedAxes"
  );
  if (preservedAxesIssue) return preservedAxesIssue;
  const ownerIssue = optionalNonEmptyStringIssue(ownValue(metadata, "owner"), "source.rootMotion.owner");
  if (ownerIssue) return ownerIssue;
  const unitsIssue = optionalNonEmptyStringIssue(ownValue(metadata, "units"), "source.rootMotion.units");
  if (unitsIssue) return unitsIssue;
  const supportIssue = optionalNonEmptyStringIssue(ownValue(metadata, "support"), "source.rootMotion.support");
  if (supportIssue) return supportIssue;
  const bakeModeIssue = optionalNonEmptyStringIssue(ownValue(metadata, "bakeMode"), "source.rootMotion.bakeMode");
  if (bakeModeIssue) return bakeModeIssue;
  return null;
}

function rootMotionCarrierIssue(value: unknown): string | null {
  if (value === undefined) return null;
  const issues: RootMotionCarrierHintIssue[] = [];
  const candidate = readRootMotionCarrierHintValue(value, "manifest", "source.rootMotion.carrier", issues);
  if (candidate && issues.length === 0) return null;
  if (typeof value === "number") return formatUnknownValue(value);
  if (typeof value === "string") return "metadata";
  if (!isRecord(value)) return formatUnknownValue(value);
  const invalidHintPrefix = "invalid root-motion carrier hint ";
  const invalidIssue = issues.find((issue) => issue.code === "invalid" && issue.message.startsWith(invalidHintPrefix));
  const invalidValue = invalidIssue?.message.slice(invalidHintPrefix.length);
  return invalidValue ? invalidValue : "metadata";
}

function optionalRootMotionAxesIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    !isDenseArray(value) ||
    value.some((axis) => axis !== "x" && axis !== "y" && axis !== "z")
  ) {
    return `has invalid ${label} metadata`;
  }
  return new Set(value).size === value.length ? null : `has duplicate ${label} metadata`;
}

export function manifestEntryMetadataIssue(entry: AnimationManifestEntry): string | null {
  const idIssue = optionalNonEmptyStringIssue(ownValue(entry, "id"), "id");
  if (idIssue) return idIssue;
  const labelIssue = optionalNonEmptyStringIssue(ownValue(entry, "label"), "label");
  if (labelIssue) return labelIssue;
  const urlIssue = optionalNonEmptyStringIssue(ownValue(entry, "url"), "url");
  if (urlIssue) return urlIssue;
  const playback = ownValue(entry, "playback");
  if (playback !== undefined) {
    if (!isRecord(playback)) return "has invalid playback metadata";
    const start = ownValue(playback, "start");
    const end = ownValue(playback, "end");
    if (start !== undefined && !Number.isFinite(start)) return "has invalid playback.start metadata";
    if (end !== undefined && !Number.isFinite(end)) return "has invalid playback.end metadata";
  }
  const loopIssue = optionalBooleanIssue(ownValue(entry, "loop"), "loop");
  if (loopIssue) return loopIssue;
  const preloadIssue = optionalBooleanIssue(ownValue(entry, "preload"), "preload");
  if (preloadIssue) return preloadIssue;
  const autoplayIssue = optionalBooleanIssue(ownValue(entry, "autoplay"), "autoplay");
  if (autoplayIssue) return autoplayIssue;
  const weight = ownValue(entry, "weight");
  if (weight !== undefined && (!Number.isFinite(weight) || (weight as number) < 0)) {
    return "has invalid weight metadata";
  }
  const tagsIssue = optionalStringArrayIssue(ownValue(entry, "tags"), "tags");
  if (tagsIssue) return tagsIssue;
  const statesIssue = optionalStringArrayIssue(ownValue(entry, "states"), "states");
  if (statesIssue) return statesIssue;
  const emotionsIssue = optionalStringArrayIssue(ownValue(entry, "emotions"), "emotions");
  if (emotionsIssue) return emotionsIssue;
  const gesturesIssue = optionalStringArrayIssue(ownValue(entry, "gestures"), "gestures");
  if (gesturesIssue) return gesturesIssue;
  const source = ownValue(entry, "source");
  if (source !== undefined && !isRecord(source)) return "has invalid source metadata";
  const validation = ownValue(entry, "validation");
  if (validation !== undefined) {
    if (!isRecord(validation)) return "has invalid validation metadata";
    const reasonIssue = optionalNonEmptyStringIssue(ownValue(validation, "reason"), "validation.reason");
    if (reasonIssue) {
      return "has invalid validation.reason metadata";
    }
    const validationIssues = ownValue(validation, "issues");
    if (validationIssues !== undefined) {
      const validationIssuesIssue = optionalStringArrayIssue(validationIssues, "validation.issues");
      if (validationIssuesIssue) return validationIssuesIssue;
    }
  }
  return null;
}

export function readRequiredAnimationCoverage(entry: AnimationManifestEntry): RequiredAnimationCoverage {
  if (manifestRequiredCoverageIssue(entry)) return { requiredHumanBones: [], requiredJoints: [] };
  const sourceValue = ownValue(entry, "source");
  const source = isRecord(sourceValue) ? sourceValue : {};
  const requiredHumanBones = ownValue(source, "requiredHumanBones");
  const requiredJoints = ownValue(source, "requiredJoints");
  return {
    requiredHumanBones: Array.isArray(requiredHumanBones)
      ? Array.from(new Set(requiredHumanBones.filter(isHumanoidBoneName))).sort()
      : [],
    requiredJoints: Array.isArray(requiredJoints)
      ? Array.from(new Set(requiredJoints.filter((joint): joint is string => isNonEmptyString(joint)))).sort()
      : []
  };
}

function exactRootMotionAxes(value: unknown, expected: readonly string[]): boolean {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    !isDenseArray(value) ||
    value.some((axis) => typeof axis !== "string")
  ) {
    return false;
  }
  const actual = Array.from(new Set(value)).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((axis, index) => axis === sortedExpected[index]);
}

function isIntentionalResidualRootCarrier(entry: AnimationManifestEntry): boolean {
  const source = ownValue(entry, "source");
  const rootMotion = isRecord(source) ? ownValue(source, "rootMotion") : undefined;
  if (!isRecord(rootMotion)) return false;
  const metadata = rootMotion;
  const verticalTransition =
    ownValue(metadata, "owner") === "director-xz" &&
    ownValue(metadata, "support") === "vertical-transition" &&
    ownValue(metadata, "bakeMode") === "reference" &&
    exactRootMotionAxes(ownValue(metadata, "extractedAxes"), ["x", "z"]) &&
    exactRootMotionAxes(ownValue(metadata, "preservedAxes"), ["y"]);
  const residualTrajectory =
    ownValue(metadata, "bakeMode") === "remove-linear-trajectory" &&
    (ownValue(metadata, "owner") === "director-xz" ||
      (ownValue(metadata, "owner") === "none" && ownValue(metadata, "support") === "contact-aware-stationary"));
  return (
    ownValue(metadata, "policy") === "stripped-to-in-place" &&
    ownValue(metadata, "carrier") === "hips" &&
    ownValue(metadata, "units") === "meters-target-rest-offset" &&
    (verticalTransition || residualTrajectory)
  );
}

function clipRootMotionPolicyIssue(clip: AnimationClip): string | null {
  const metadataValue = isRecord(clip) ? ownValue(clip, "metadata") : undefined;
  const metadata = isRecord(metadataValue) ? metadataValue : undefined;
  const clipPolicy = metadata ? ownValue(metadata, "rootMotionPolicy") : undefined;
  if (clipPolicy !== undefined && !isRootMotionPolicy(clipPolicy))
    return `has invalid clip rootMotionPolicy ${formatUnknownValue(clipPolicy)}`;
  const clipTranslationPolicy = metadata ? ownValue(metadata, "rootMotionTranslationPolicy") : undefined;
  if (clipTranslationPolicy !== undefined && !isRootMotionPolicy(clipTranslationPolicy))
    return `has invalid clip rootMotionTranslationPolicy ${formatUnknownValue(clipTranslationPolicy)}`;
  const clipYawPolicy = metadata ? ownValue(metadata, "rootMotionYawPolicy") : undefined;
  if (clipYawPolicy !== undefined && !isRootMotionPolicy(clipYawPolicy))
    return `has invalid clip rootMotionYawPolicy ${formatUnknownValue(clipYawPolicy)}`;
  const clipProvenance = metadata ? ownValue(metadata, "rootMotionProvenance") : undefined;
  if (clipProvenance !== undefined && !isRootMotionProvenance(clipProvenance))
    return `has invalid clip rootMotionProvenance ${formatUnknownValue(clipProvenance)}`;
  return null;
}

function clipRootMotionConflictIssue(entry: AnimationManifestEntry, clip: AnimationClip): string | null {
  const entryMetadata = readRootMotionMetadata(entry);
  if (!entryMetadata) return null;
  const clipMetadataValue = isRecord(clip) ? ownValue(clip, "metadata") : undefined;
  const clipMetadata = isRecord(clipMetadataValue) ? clipMetadataValue : undefined;
  const clipPolicy = clipMetadata ? ownValue(clipMetadata, "rootMotionPolicy") : undefined;
  if (isRootMotionPolicy(clipPolicy) && clipPolicy !== entryMetadata.policy) {
    return `clip rootMotionPolicy ${clipPolicy} conflicts with source.rootMotion.policy ${entryMetadata.policy}`;
  }
  const clipProvenance = clipMetadata ? ownValue(clipMetadata, "rootMotionProvenance") : undefined;
  if (
    isRootMotionProvenance(clipProvenance) &&
    clipProvenance !== "unknown" &&
    entryMetadata.provenance !== "unknown" &&
    clipProvenance !== entryMetadata.provenance
  ) {
    return `clip rootMotionProvenance ${clipProvenance} conflicts with source.rootMotion.provenance ${entryMetadata.provenance}`;
  }
  return null;
}

function isRootMotionNamed(entry: AnimationManifestEntry, clip: AnimationClip): boolean {
  const clipId = isRecord(clip) ? ownValue(clip, "id") : undefined;
  const clipName = isRecord(clip) ? ownValue(clip, "name") : undefined;
  return /\broot[-_ ]?motion\b/i.test(
    `${readManifestEntryId(entry) ?? ""} ${readManifestEntryLabel(entry) ?? ""} ${readManifestEntryUrl(entry) ?? ""} ${typeof clipId === "string" ? clipId : ""} ${typeof clipName === "string" ? clipName : ""}`
  );
}

export function readRootMotionPolicy(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionPolicy | null {
  return readRootMotionMetadata(entry, clip)?.policy ?? null;
}

export function readRootMotionChannelPolicy(
  entry: AnimationManifestEntry,
  clip: AnimationClip | undefined,
  channel: "translation" | "yaw"
): RootMotionPolicy | null {
  const sourceValue = ownValue(entry, "source");
  if (sourceValue !== undefined && !isRecord(sourceValue)) return null;
  const entrySource = isRecord(sourceValue) ? sourceValue : {};
  const sourceRootMotion = ownValue(entrySource, "rootMotion");
  const sourceChannelPolicy = isRecord(sourceRootMotion)
    ? readRootMotionChannelPolicyValue(sourceRootMotion, channel)
    : null;
  if (sourceChannelPolicy) return sourceChannelPolicy;
  const clipMetadata = clip && isRecord(clip) ? ownValue(clip, "metadata") : undefined;
  const clipChannelPolicy = readRootMotionChannelPolicyValue(clipMetadata, channel, "rootMotion");
  if (clipChannelPolicy && sourceRootMotion === undefined && ownValue(entrySource, "rootMotionPolicy") === undefined) {
    return clipChannelPolicy;
  }
  return readRootMotionPolicy(entry, clip);
}

export function readRootMotionProvenance(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionProvenance {
  return readRootMotionMetadata(entry, clip)?.provenance ?? "unknown";
}

export function readRootMotionMetadata(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionMetadata | null {
  const sourceValue = ownValue(entry, "source");
  if (sourceValue !== undefined && !isRecord(sourceValue)) return null;
  const entrySource = isRecord(sourceValue) ? sourceValue : {};
  const clipMetadataValue = clip && isRecord(clip) ? ownValue(clip, "metadata") : undefined;
  const clipMetadata = isRecord(clipMetadataValue) ? clipMetadataValue : {};
  const sourceRootMotion = ownValue(entrySource, "rootMotion");
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string")
      return isRootMotionPolicy(sourceRootMotion) ? { policy: sourceRootMotion, provenance: "unknown" } : null;
    if (!isRecord(sourceRootMotion) || !hasOwn(sourceRootMotion, "policy")) return null;
    const policy = ownValue(sourceRootMotion, "policy");
    const provenance = ownValue(sourceRootMotion, "provenance");
    const translationPolicy = ownValue(sourceRootMotion, "translationPolicy");
    const yawPolicy = ownValue(sourceRootMotion, "yawPolicy");
    if (!isRootMotionPolicy(policy)) return null;
    if (provenance !== undefined && !isRootMotionProvenance(provenance)) return null;
    if (translationPolicy !== undefined && !isRootMotionPolicy(translationPolicy)) return null;
    if (yawPolicy !== undefined && !isRootMotionPolicy(yawPolicy)) return null;
    return {
      policy,
      provenance: isRootMotionProvenance(provenance) ? provenance : "unknown",
      ...(isRootMotionPolicy(translationPolicy) ? { translationPolicy } : {}),
      ...(isRootMotionPolicy(yawPolicy) ? { yawPolicy } : {})
    };
  }
  const sourcePolicy = ownValue(entrySource, "rootMotionPolicy");
  if (isRootMotionPolicy(sourcePolicy)) return { policy: sourcePolicy, provenance: "unknown" };
  const clipPolicy = ownValue(clipMetadata, "rootMotionPolicy");
  if (isRootMotionPolicy(clipPolicy)) {
    const clipProvenance = ownValue(clipMetadata, "rootMotionProvenance");
    return {
      policy: clipPolicy,
      provenance: isRootMotionProvenance(clipProvenance) ? clipProvenance : "unknown"
    };
  }
  return null;
}

export function resolveRootMotionCarrierHint(
  entry: AnimationManifestEntry,
  options: RootMotionCarrierHintOptions = {}
): RootMotionCarrierHintResolution {
  const issues: RootMotionCarrierHintIssue[] = [];
  const manifest = readManifestRootMotionCarrierHint(entry, issues);
  const clipCandidate =
    manifest.candidate || !manifest.blocksClipFallback
      ? selectRootMotionCarrierHintCandidate(
          readClipRootMotionCarrierHints(options.clip, issues),
          issues,
          options.skeleton
        )
      : null;
  if (
    manifest.candidate &&
    clipCandidate &&
    !rootMotionCarriersEquivalent(manifest.candidate.motionCarrier, clipCandidate.motionCarrier, options.skeleton)
  ) {
    pushRootMotionCarrierHintIssue(
      issues,
      "clip-metadata",
      clipCandidate.field,
      "conflict",
      `clip root-motion carrier hint conflicts with authoritative ${manifest.candidate.field}`
    );
  }
  const candidate = manifest.blocksClipFallback ? manifest.candidate : (manifest.candidate ?? clipCandidate);

  if (!candidate) {
    return {
      source: null,
      field: null,
      motionCarrier: null,
      reconcilerCarrierBinding: null,
      resolved: null,
      issues
    };
  }

  const resolved = resolveRootMotionCarrierHintAgainstSkeleton(candidate, options.skeleton, issues);
  if (options.skeleton && !resolved) {
    return {
      source: candidate.source,
      field: candidate.field,
      motionCarrier: null,
      reconcilerCarrierBinding: null,
      resolved: null,
      issues
    };
  }

  const motionCarrier = cloneMotionCarrier(candidate.motionCarrier);
  return {
    source: candidate.source,
    field: candidate.field,
    motionCarrier,
    reconcilerCarrierBinding: rootMotionCarrierBindingFromHint(motionCarrier, resolved, options),
    resolved,
    issues
  };
}

type RootMotionCarrierHintCandidate = {
  source: RootMotionCarrierHintSource;
  field: string;
  motionCarrier: MotionCarrier;
};

type ManifestRootMotionCarrierHintRead = {
  candidate: RootMotionCarrierHintCandidate | null;
  blocksClipFallback: boolean;
};

function readManifestRootMotionCarrierHint(
  entry: AnimationManifestEntry,
  issues: RootMotionCarrierHintIssue[]
): ManifestRootMotionCarrierHintRead {
  const sourceValue = ownValue(entry, "source");
  if (sourceValue !== undefined && !isRecord(sourceValue)) {
    pushRootMotionCarrierHintIssue(
      issues,
      "manifest",
      "source",
      "invalid",
      "source metadata must be an object before root-motion carrier hints can be used"
    );
    return { candidate: null, blocksClipFallback: true };
  }
  const entrySource = isRecord(sourceValue) ? sourceValue : {};
  const sourceRootMotion = rootMotionCarrierOwnValue(entrySource, "rootMotion");
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string") {
      if (!isRootMotionPolicy(sourceRootMotion)) {
        pushRootMotionCarrierHintIssue(
          issues,
          "manifest",
          "source.rootMotion",
          "invalid",
          "source.rootMotion policy must be valid before root-motion carrier hints can be used"
        );
      }
      return { candidate: null, blocksClipFallback: true };
    }
    if (!isRecord(sourceRootMotion)) {
      pushRootMotionCarrierHintIssue(
        issues,
        "manifest",
        "source.rootMotion",
        "invalid",
        "source.rootMotion must be an object before root-motion carrier hints can be used"
      );
      return { candidate: null, blocksClipFallback: true };
    }
    const sourceRootMotionPolicy = rootMotionCarrierOwnValue(sourceRootMotion, "policy");
    if (!isRootMotionPolicy(sourceRootMotionPolicy)) {
      pushRootMotionCarrierHintIssue(
        issues,
        "manifest",
        "source.rootMotion.policy",
        "invalid",
        "source.rootMotion.policy must be valid before root-motion carrier hints can be used"
      );
      return { candidate: null, blocksClipFallback: true };
    }
    return {
      candidate: readRootMotionCarrierHintValue(
        rootMotionCarrierOwnValue(sourceRootMotion, "carrier"),
        "manifest",
        "source.rootMotion.carrier",
        issues
      ),
      blocksClipFallback: true
    };
  }
  const sourcePolicy = rootMotionCarrierOwnValue(entrySource, "rootMotionPolicy");
  if (sourcePolicy !== undefined && !isRootMotionPolicy(sourcePolicy)) {
    pushRootMotionCarrierHintIssue(
      issues,
      "manifest",
      "source.rootMotionPolicy",
      "invalid",
      "source.rootMotionPolicy must be valid before clip root-motion carrier fallbacks can be used"
    );
  }
  return { candidate: null, blocksClipFallback: sourcePolicy !== undefined };
}

function readClipRootMotionCarrierHints(
  clip: AnimationClip | undefined,
  issues: RootMotionCarrierHintIssue[]
): RootMotionCarrierHintCandidate[] {
  const metadata = clip && isRecord(clip) ? ownValue(clip, "metadata") : undefined;
  if (metadata === undefined) return [];
  if (!isRecord(metadata)) {
    pushRootMotionCarrierHintIssue(
      issues,
      "clip-metadata",
      "clip.metadata",
      "invalid",
      "clip metadata must be an object before root-motion carrier hints can be used"
    );
    return [];
  }
  const candidates: RootMotionCarrierHintCandidate[] = [];
  const rootMotion = rootMotionCarrierOwnValue(metadata, "rootMotion");
  const rootMotionCarrier = isRecord(rootMotion) ? rootMotionCarrierOwnValue(rootMotion, "carrier") : undefined;
  if (rootMotionCarrier !== undefined) {
    const candidate = readRootMotionCarrierHintValue(
      rootMotionCarrier,
      "clip-metadata",
      "clip.metadata.rootMotion.carrier",
      issues
    );
    if (candidate) candidates.push(candidate);
  }
  const legacyRootMotionCarrier = rootMotionCarrierOwnValue(metadata, "rootMotionCarrier");
  if (legacyRootMotionCarrier !== undefined) {
    const candidate = readRootMotionCarrierHintValue(
      legacyRootMotionCarrier,
      "clip-metadata",
      "clip.metadata.rootMotionCarrier",
      issues
    );
    if (candidate) candidates.push(candidate);
  }
  const motionCarrier = rootMotionCarrierOwnValue(metadata, "motionCarrier");
  if (motionCarrier !== undefined) {
    const candidate = readRootMotionCarrierHintValue(
      motionCarrier,
      "clip-metadata",
      "clip.metadata.motionCarrier",
      issues
    );
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function selectRootMotionCarrierHintCandidate(
  candidates: RootMotionCarrierHintCandidate[],
  issues: RootMotionCarrierHintIssue[],
  skeleton: Skeleton | undefined
): RootMotionCarrierHintCandidate | null {
  if (candidates.length === 0) return null;
  const first = candidates[0]!;
  if (candidates.length === 1) return first;
  if (
    candidates.every((candidate) =>
      rootMotionCarriersEquivalent(candidate.motionCarrier, first.motionCarrier, skeleton)
    )
  ) {
    pushRootMotionCarrierHintIssue(
      issues,
      first.source,
      candidates.map((candidate) => candidate.field).join(", "),
      "duplicate",
      "duplicate clip root-motion carrier hints resolved to the same carrier"
    );
    return first;
  }
  pushRootMotionCarrierHintIssue(
    issues,
    first.source,
    candidates.map((candidate) => candidate.field).join(", "),
    "conflict",
    "conflicting clip root-motion carrier hints must be deduplicated before use"
  );
  return null;
}

function readRootMotionCarrierHintValue(
  value: unknown,
  source: RootMotionCarrierHintSource,
  field: string,
  issues: RootMotionCarrierHintIssue[]
): RootMotionCarrierHintCandidate | null {
  if (value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) return { source, field, motionCarrier: { jointIndex: value } };
    pushInvalidRootMotionCarrierHintIssue(issues, source, field, value);
    return null;
  }
  if (typeof value === "string") {
    if (!boundedNonEmptyStringIssue(value)) return { source, field, motionCarrier: { joint: value } };
    pushInvalidRootMotionCarrierHintIssue(issues, source, field, value);
    return null;
  }
  if (!isRecord(value)) {
    pushInvalidRootMotionCarrierHintIssue(issues, source, field, value);
    return null;
  }

  const issueCountBefore = issues.length;
  const categories = [
    readRootMotionCarrierIndexHint(value, source, field, issues),
    readRootMotionCarrierJointHint(value, source, field, issues),
    readRootMotionCarrierHumanBoneHint(value, source, field, issues)
  ].filter((category): category is MotionCarrier => category !== null);
  if (categories.length === 0) {
    if (!rootMotionCarrierObjectHasKnownField(value)) {
      pushRootMotionCarrierHintIssue(
        issues,
        source,
        field,
        "invalid",
        "root-motion carrier object must name jointIndex, joint, or humanBone"
      );
    }
    return null;
  }
  if (categories.length > 1) {
    pushRootMotionCarrierHintIssue(
      issues,
      source,
      field,
      "conflict",
      "root-motion carrier object must name only one of jointIndex, joint, or humanBone"
    );
    return null;
  }
  if (issues.length > issueCountBefore) return null;
  return { source, field, motionCarrier: categories[0]! };
}

function readRootMotionCarrierIndexHint(
  value: Record<string, unknown>,
  source: RootMotionCarrierHintSource,
  field: string,
  issues: RootMotionCarrierHintIssue[]
): MotionCarrier | null {
  const fields = presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_INDEX_FIELDS);
  if (fields.length === 0) return null;
  const numbers: number[] = [];
  for (const key of fields) {
    const index = rootMotionCarrierOwnValue(value, key);
    if (!Number.isInteger(index) || (index as number) < 0) {
      pushInvalidRootMotionCarrierHintIssue(issues, source, `${field}.${key}`, index);
      return null;
    }
    numbers.push(index as number);
  }
  if (new Set(numbers).size > 1) {
    pushRootMotionCarrierHintIssue(
      issues,
      source,
      field,
      "conflict",
      "root-motion carrier jointIndex aliases conflict"
    );
    return null;
  }
  if (fields.length > 1) {
    pushRootMotionCarrierHintIssue(
      issues,
      source,
      field,
      "duplicate",
      "root-motion carrier repeats equivalent jointIndex aliases"
    );
  }
  return { jointIndex: numbers[0]! };
}

function readRootMotionCarrierJointHint(
  value: Record<string, unknown>,
  source: RootMotionCarrierHintSource,
  field: string,
  issues: RootMotionCarrierHintIssue[]
): MotionCarrier | null {
  const fields = presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_JOINT_FIELDS);
  if (fields.length === 0) return null;
  const joints: string[] = [];
  for (const key of fields) {
    const joint = rootMotionCarrierOwnValue(value, key);
    if (boundedNonEmptyStringIssue(joint)) {
      pushInvalidRootMotionCarrierHintIssue(issues, source, `${field}.${key}`, joint);
      return null;
    }
    joints.push(joint as string);
  }
  if (new Set(joints).size > 1) {
    pushRootMotionCarrierHintIssue(issues, source, field, "conflict", "root-motion carrier joint aliases conflict");
    return null;
  }
  if (fields.length > 1) {
    pushRootMotionCarrierHintIssue(
      issues,
      source,
      field,
      "duplicate",
      "root-motion carrier repeats equivalent joint aliases"
    );
  }
  return { joint: joints[0]! };
}

function readRootMotionCarrierHumanBoneHint(
  value: Record<string, unknown>,
  source: RootMotionCarrierHintSource,
  field: string,
  issues: RootMotionCarrierHintIssue[]
): MotionCarrier | null {
  const fields = presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_HUMAN_BONE_FIELDS);
  if (fields.length === 0) return null;
  const humanBones: HumanoidBoneNameLike[] = [];
  for (const key of fields) {
    const bone = rootMotionCarrierOwnValue(value, key);
    if (boundedNonEmptyStringIssue(bone) || !isHumanoidBoneName(bone)) {
      pushInvalidRootMotionCarrierHintIssue(issues, source, `${field}.${key}`, bone);
      return null;
    }
    humanBones.push(bone);
  }
  if (new Set(humanBones).size > 1) {
    pushRootMotionCarrierHintIssue(issues, source, field, "conflict", "root-motion carrier humanBone aliases conflict");
    return null;
  }
  if (fields.length > 1) {
    pushRootMotionCarrierHintIssue(
      issues,
      source,
      field,
      "duplicate",
      "root-motion carrier repeats equivalent humanBone aliases"
    );
  }
  return { humanBone: humanBones[0]! };
}

function presentRootMotionCarrierFields(value: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((field) => rootMotionCarrierOwnValue(value, field) !== undefined);
}

function rootMotionCarrierOwnValue(value: Record<string, unknown>, field: string): unknown {
  return ownValue(value, field);
}

function rootMotionCarrierObjectHasKnownField(value: Record<string, unknown>): boolean {
  return (
    presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_INDEX_FIELDS).length > 0 ||
    presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_JOINT_FIELDS).length > 0 ||
    presentRootMotionCarrierFields(value, ROOT_MOTION_CARRIER_HUMAN_BONE_FIELDS).length > 0
  );
}

function resolveRootMotionCarrierHintAgainstSkeleton(
  candidate: RootMotionCarrierHintCandidate,
  skeleton: Skeleton | undefined,
  issues: RootMotionCarrierHintIssue[]
): ResolvedRootMotionCarrierHint | null {
  if (!skeleton) return null;
  const carrier = candidate.motionCarrier;
  if ("jointIndex" in carrier) {
    const jointIndex = carrier.jointIndex;
    if (Number.isInteger(jointIndex) && jointIndex >= 0 && jointIndex < skeleton.joints.length) {
      return { jointIndex, joint: skeleton.joints[jointIndex]!.name };
    }
    pushRootMotionCarrierHintIssue(
      issues,
      candidate.source,
      candidate.field,
      "skeleton-mismatch",
      `root-motion carrier joint index ${String(jointIndex)} does not map to target skeleton`
    );
    return null;
  }
  if ("humanBone" in carrier) {
    const jointIndex = resolveHumanoidIndex(skeleton, carrier.humanBone as HumanoidBoneName);
    if (jointIndex >= 0) return { jointIndex, joint: skeleton.joints[jointIndex]!.name };
    pushRootMotionCarrierHintIssue(
      issues,
      candidate.source,
      candidate.field,
      "skeleton-mismatch",
      `root-motion carrier humanoid bone ${String(carrier.humanBone)} does not map to target skeleton`
    );
    return null;
  }
  const jointIndex = resolveJointIndex(skeleton, carrier.joint);
  if (jointIndex >= 0) return { jointIndex, joint: skeleton.joints[jointIndex]!.name };
  pushRootMotionCarrierHintIssue(
    issues,
    candidate.source,
    candidate.field,
    "skeleton-mismatch",
    `root-motion carrier joint ${carrier.joint} does not map to target skeleton`
  );
  return null;
}

function rootMotionCarrierBindingFromHint(
  carrier: MotionCarrier,
  resolved: ResolvedRootMotionCarrierHint | null,
  options: RootMotionCarrierHintOptions
): RootMotionCarrierBinding | null {
  const bindingId = boundedNonEmptyStringIssue(options.bindingId) ? undefined : options.bindingId;
  const bindingPriority = sanitizeRootMotionCarrierBindingPriority(options.bindingPriority);
  const base = {
    select: "bone" as const,
    ...(bindingId !== undefined ? { id: bindingId } : {}),
    ...(bindingPriority !== undefined ? { priority: bindingPriority } : {})
  };
  if (resolved) return { ...base, jointIndex: resolved.jointIndex, joint: resolved.joint };
  if ("jointIndex" in carrier) return { ...base, jointIndex: carrier.jointIndex };
  if ("joint" in carrier) return { ...base, joint: carrier.joint };
  return null;
}

function sanitizeRootMotionCarrierBindingPriority(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(-MAX_ROOT_MOTION_BINDING_PRIORITY, Math.min(MAX_ROOT_MOTION_BINDING_PRIORITY, value));
}

function rootMotionCarrierSignature(carrier: MotionCarrier): string {
  if ("jointIndex" in carrier) return `jointIndex:${carrier.jointIndex}`;
  if ("humanBone" in carrier) return `humanBone:${carrier.humanBone}`;
  return `joint:${carrier.joint}`;
}

function rootMotionCarrierLabel(carrier: MotionCarrier): string | null {
  if ("jointIndex" in carrier) return null;
  if ("humanBone" in carrier) return carrier.humanBone;
  return carrier.joint;
}

function rootMotionCarriersEquivalent(
  first: MotionCarrier,
  second: MotionCarrier,
  skeleton: Skeleton | undefined
): boolean {
  if (skeleton) {
    const firstResolved = resolveRootMotionCarrierForSkeleton(first, skeleton);
    const secondResolved = resolveRootMotionCarrierForSkeleton(second, skeleton);
    if (firstResolved && secondResolved) return firstResolved.jointIndex === secondResolved.jointIndex;
  }
  if (rootMotionCarrierSignature(first) === rootMotionCarrierSignature(second)) return true;
  const firstLabel = rootMotionCarrierLabel(first);
  const secondLabel = rootMotionCarrierLabel(second);
  return firstLabel !== null && firstLabel === secondLabel;
}

function resolveRootMotionCarrierForSkeleton(
  carrier: MotionCarrier,
  skeleton: Skeleton
): ResolvedRootMotionCarrierHint | null {
  if ("jointIndex" in carrier) {
    const jointIndex = carrier.jointIndex;
    return Number.isInteger(jointIndex) && jointIndex >= 0 && jointIndex < skeleton.joints.length
      ? { jointIndex, joint: skeleton.joints[jointIndex]!.name }
      : null;
  }
  if ("humanBone" in carrier) {
    if (!isHumanoidBoneName(carrier.humanBone)) return null;
    const jointIndex = resolveHumanoidIndex(skeleton, carrier.humanBone);
    return jointIndex >= 0 ? { jointIndex, joint: skeleton.joints[jointIndex]!.name } : null;
  }
  const jointIndex = resolveJointIndex(skeleton, carrier.joint);
  return jointIndex >= 0 ? { jointIndex, joint: skeleton.joints[jointIndex]!.name } : null;
}

function cloneMotionCarrier(carrier: MotionCarrier): MotionCarrier {
  if ("jointIndex" in carrier) return { jointIndex: carrier.jointIndex };
  if ("humanBone" in carrier) return { humanBone: carrier.humanBone };
  return { joint: carrier.joint };
}

function pushInvalidRootMotionCarrierHintIssue(
  issues: RootMotionCarrierHintIssue[],
  source: RootMotionCarrierHintSource,
  field: string,
  value: unknown
): void {
  pushRootMotionCarrierHintIssue(
    issues,
    source,
    field,
    "invalid",
    `invalid root-motion carrier hint ${formatUnknownValue(value)}`
  );
}

function pushRootMotionCarrierHintIssue(
  issues: RootMotionCarrierHintIssue[],
  source: RootMotionCarrierHintSource,
  field: string,
  code: RootMotionCarrierHintIssueCode,
  message: string
): void {
  issues.push({ source, field, code, message });
}

function isRootMotionPolicy(value: unknown): value is RootMotionPolicy {
  return value === "none" || value === "preserved" || value === "stripped-to-in-place";
}

function isRootMotionProvenance(value: unknown): value is RootMotionProvenance {
  return (
    value === "unknown" ||
    value === "not-authored" ||
    value === "preserved-in-clip" ||
    value === "stripped-during-conversion" ||
    value === "requires-runtime-stripping" ||
    value === "stationary-residual"
  );
}

function readRootMotionChannelPolicyValue(
  metadata: unknown,
  channel: "translation" | "yaw",
  prefix = ""
): RootMotionPolicy | null {
  if (!isRecord(metadata)) return null;
  const key = `${prefix}${channel === "translation" ? "Translation" : "Yaw"}Policy`;
  const compactKey = channel === "translation" ? "translationPolicy" : "yawPolicy";
  const compactValue = ownValue(metadata, compactKey);
  const value = compactValue ?? ownValue(metadata, key);
  return isRootMotionPolicy(value) ? value : null;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return truncateFormattedValue(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol()";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[array length ${value.length}]`;
  return truncateFormattedValue(Object.prototype.toString.call(value));
}

function truncateFormattedValue(value: string): string {
  if (value.length <= MAX_FORMATTED_UNKNOWN_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_FORMATTED_UNKNOWN_VALUE_LENGTH)}…`;
}

function readLoadedManifest(value: unknown, url: string): AnimationManifest {
  if (!isRecord(value)) throw new Error(`manifest ${url} must be an object`);
  return value as AnimationManifest;
}

function readManifestClipsForLoad(
  manifest: AnimationManifest,
  url: string,
  maxClips: number
): AnimationManifestEntry[] {
  const clips = ownValue(manifest, "clips");
  if (!Array.isArray(clips)) throw new Error(`manifest ${url} clips must be an array`);
  if (clips.length > maxClips) {
    throw new ManifestIncludeLimitError(`manifest ${url} clips exceed ${maxClips} entries`);
  }
  if (!isDenseArray(clips)) throw new Error(`manifest ${url} clips must be a dense array`);
  return clips as AnimationManifestEntry[];
}

function readManifestIncludes(manifest: AnimationManifest, url: string, options: ManifestLoaderOptions): string[] {
  const includes = ownValue(manifest, "includes");
  if (includes === undefined) return [];
  const maxIncludes = positiveIntegerOption(options.maxIncludesPerManifest, DEFAULT_MAX_MANIFEST_INCLUDES_PER_MANIFEST);
  if (!Array.isArray(includes)) {
    throw new Error(`manifest ${url} includes must be an array of non-empty strings`);
  }
  if (includes.length > maxIncludes)
    throw new ManifestIncludeLimitError(`manifest ${url} includes exceed ${maxIncludes} entries`);
  if (!isDenseArray(includes) || includes.some((include) => !isNonEmptyString(include))) {
    throw new Error(`manifest ${url} includes must be an array of non-empty strings`);
  }
  return includes as string[];
}

export function usableManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] {
  const clips = readManifestClips(manifest) ?? [];
  const duplicateIds = duplicatedManifestIds(clips);
  return clips.filter((entry) => !manifestRejectionIssue(entry, duplicateIds));
}

export function rejectedAnimationReport(
  manifest: AnimationManifest
): Array<{ id: string; label?: string; reason: string }> {
  const clips = readManifestClips(manifest) ?? [];
  const duplicateIds = duplicatedManifestIds(clips);
  return clips
    .map((entry) => ({ entry, reason: manifestRejectionIssue(entry, duplicateIds) }))
    .filter((item): item is { entry: AnimationManifestEntry; reason: string } => item.reason !== null)
    .map(({ entry, reason }) => ({
      id: isManifestEntryObject(entry) ? (readManifestEntryId(entry) ?? "<unknown>") : "<unknown>",
      ...(isManifestEntryObject(entry) && readManifestEntryLabel(entry) !== undefined
        ? { label: readManifestEntryLabel(entry)! }
        : {}),
      reason
    }));
}

function manifestRejectionIssue(entry: AnimationManifestEntry, duplicateIds = new Set<string>()): string | null {
  return (
    manifestStructuralRejectionIssue(entry, duplicateIds) ??
    manifestValidationStatusIssue(entry) ??
    manifestRootMotionPolicyIssue(entry) ??
    manifestRequiredCoverageIssue(entry)
  );
}

function manifestStructuralRejectionIssue(
  entry: AnimationManifestEntry,
  duplicateIds: ReadonlySet<string>
): string | null {
  if (!isManifestEntryObject(entry)) return "manifest entry must be an object";
  const id = readManifestEntryId(entry);
  if (!id) return "missing id";
  if (!readManifestEntryUrl(entry)) return "missing url";
  const metadataIssue = manifestEntryMetadataIssue(entry);
  if (metadataIssue) return metadataIssue;
  const format = ownValue(entry, "format");
  if (format !== WAIFU_ANIMATION_BINARY_FORMAT) return `unsupported format ${formatUnknownValue(format)}`;
  if (duplicateIds.has(id)) return `duplicate clip id ${id}`;
  if (readManifestValidationStatus(entry) === "accepted" && readManifestValidationReason(entry) !== undefined)
    return "accepted but still has rejection reason";
  return null;
}

function readManifestClips(
  manifest: AnimationManifest,
  maxClips = MAX_MANIFEST_CLIPS_PER_MANIFEST
): AnimationManifestEntry[] | null {
  if (!isRecord(manifest)) return null;
  const clips = ownValue(manifest, "clips");
  return manifestClipsTableIssue(clips, maxClips) === null ? (clips as AnimationManifestEntry[]) : null;
}

function manifestClipsTableIssue(value: unknown, maxClips = MAX_MANIFEST_CLIPS_PER_MANIFEST): string | null {
  if (!Array.isArray(value)) return "manifest clips must be an array";
  if (value.length > maxClips) return `manifest clips exceed ${maxClips} entries`;
  if (!isDenseArray(value)) return "manifest clips must be a dense array";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function isManifestEntryObject(value: unknown): value is AnimationManifestEntry {
  return isRecord(value);
}

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function ownValue(value: object, field: string): unknown {
  return hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined;
}

function readManifestEntryId(entry: AnimationManifestEntry): string | undefined {
  const id = ownValue(entry, "id");
  return isNonEmptyString(id) ? id : undefined;
}

function readManifestEntryLabel(entry: AnimationManifestEntry): string | undefined {
  const label = ownValue(entry, "label");
  return isNonEmptyString(label) ? label : undefined;
}

function readManifestEntryUrl(entry: AnimationManifestEntry): string | undefined {
  const url = ownValue(entry, "url");
  return isNonEmptyString(url) ? url : undefined;
}

function readManifestValidationStatus(entry: AnimationManifestEntry): unknown {
  const validation = ownValue(entry, "validation");
  return isRecord(validation) ? ownValue(validation, "status") : undefined;
}

function readManifestValidationReason(entry: AnimationManifestEntry): string | undefined {
  const validation = ownValue(entry, "validation");
  if (!isRecord(validation)) return undefined;
  const reason = ownValue(validation, "reason");
  return isNonEmptyString(reason) ? reason : undefined;
}

function manifestEntryIssueId(entry: AnimationManifestEntry): string {
  return readManifestEntryId(entry) ?? "<unknown>";
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_MANIFEST_STRING_LENGTH;
}

function boundedNonEmptyStringIssue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return "empty";
  return value.length <= MAX_ROOT_MOTION_CARRIER_STRING_LENGTH ? null : "length";
}

function optionalNonEmptyStringIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return isNonEmptyString(value) ? null : `has invalid ${label} metadata`;
}

function optionalBooleanIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return typeof value === "boolean" ? null : `has invalid ${label} metadata`;
}

function optionalStringArrayIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  const valid =
    Array.isArray(value) &&
    value.length <= MAX_MANIFEST_STRING_ARRAY_LENGTH &&
    isDenseArray(value) &&
    value.every(isNonEmptyString);
  return valid ? null : `has invalid ${label} metadata`;
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}
