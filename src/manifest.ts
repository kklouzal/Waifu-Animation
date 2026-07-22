import { type AnimationClip, type ClipValidationIssue, validateClip } from "./clip.js";
import { WAIFU_ANIMATION_BINARY_FORMAT } from "./binary.js";
import {
  duplicatedManifestIds,
  isRootCarrierRotationTrack,
  isRootCarrierTranslationTrack,
  resolveManifestPlaybackWindow,
  rootCarrierRotationTrackHasYawMotion,
  rootCarrierTranslationTrackHasMotion
} from "./manifest-clip-helpers.js";
import { type HumanoidBoneName, isHumanoidBoneName } from "./skeleton.js";

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
export type RequiredAnimationCoverage = {
  requiredHumanBones: HumanoidBoneName[];
  requiredJoints: string[];
};

export type AssetLoader = (url: string) => Promise<unknown>;

export type ManifestLoaderOptions = {
  resolveInclude?: (includeUrl: string, parentUrl: string) => string;
  optionalIncludes?: boolean;
};

export function validateManifest(manifest: AnimationManifest): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  if (!isRecord(manifest)) return ["manifest must be an object"];
  if (!Number.isInteger(manifest.version) || manifest.version < 1)
    issues.push("manifest version must be a positive integer");
  if (manifest.includes !== undefined) {
    if (!Array.isArray(manifest.includes) || manifest.includes.some((include) => !isNonEmptyString(include))) {
      issues.push("manifest includes must be an array of non-empty strings");
    }
  }
  if (manifest.source !== undefined && !isRecord(manifest.source)) issues.push("manifest source must be an object");
  const clips = readManifestClips(manifest);
  if (!clips) return [...issues, "manifest clips must be an array"];
  for (const entry of clips) {
    if (!isManifestEntryObject(entry)) {
      issues.push("manifest entry must be an object");
      continue;
    }
    if (!entry.id) issues.push("manifest entry is missing id");
    if (!entry.url) issues.push(`${entry.id || "<unknown>"} is missing url`);
    const metadataIssue = manifestEntryMetadataIssue(entry);
    if (metadataIssue) issues.push(`${entry.id || "<unknown>"} ${metadataIssue}`);
    if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT)
      issues.push(`${entry.id} has unsupported format ${entry.format}`);
    if (entry.id) {
      if (ids.has(entry.id)) issues.push(`duplicate clip id ${entry.id}`);
      ids.add(entry.id);
    }
    if (isInvalidAssetValidationStatus(entry.validation?.status)) {
      issues.push(`${entry.id || "<unknown>"} has invalid validation status ${String(entry.validation?.status)}`);
    }
    if (entry.validation?.status === "accepted" && entry.validation.reason) {
      issues.push(`${entry.id} is accepted but still has rejection reason`);
    }
    const rootMotionPolicyIssue = manifestRootMotionPolicyIssue(entry);
    if (rootMotionPolicyIssue) issues.push(`${entry.id || "<unknown>"} ${rootMotionPolicyIssue}`);
    const coverageIssue = manifestRequiredCoverageIssue(entry);
    if (coverageIssue) issues.push(`${entry.id || "<unknown>"} ${coverageIssue}`);
  }
  return issues;
}

export async function loadManifest(
  url: string,
  loader: AssetLoader,
  options: ManifestLoaderOptions = {},
  seen = new Set<string>()
): Promise<AnimationManifest> {
  if (seen.has(url)) return { version: 1, clips: [] };
  seen.add(url);
  const manifest = readLoadedManifest(await loader(url), url);
  const manifestIncludes = readManifestIncludes(manifest, url);
  const includes = await Promise.all(
    manifestIncludes.map(async (includeUrl) => {
      const resolved = options.resolveInclude?.(includeUrl, url) ?? includeUrl;
      try {
        return await loadManifest(resolved, loader, options, seen);
      } catch (error) {
        if (options.optionalIncludes) return { version: 1, clips: [] };
        throw error;
      }
    })
  );
  return {
    ...manifest,
    clips: (readManifestClips(manifest) ?? []).concat(includes.flatMap((entry) => readManifestClips(entry) ?? []))
  };
}

export function inspectClipAsset(entry: AnimationManifestEntry, clip: AnimationClip): ClipAssetInspection {
  const issues = validateClip(clip);
  if (!entry.id) issues.push({ message: "manifest entry is missing id" });
  if (!entry.url) issues.push({ message: `${entry.id || "<unknown>"} is missing url` });
  const metadataIssue = manifestEntryMetadataIssue(entry);
  if (metadataIssue) issues.push({ message: metadataIssue });
  if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) {
    issues.push({ message: `${entry.id || "<unknown>"} has unsupported format ${String(entry.format)}` });
  }
  const rootMotionPolicy = readRootMotionPolicy(entry, clip);
  const translationPolicy = readRootMotionChannelPolicy(entry, clip, "translation");
  const yawPolicy = readRootMotionChannelPolicy(entry, clip, "yaw");
  const hasRootCarrierTranslationTrack = clip.tracks.some(isRootCarrierTranslationTrack);
  const hasRootCarrierRotationTrack = clip.tracks.some(isRootCarrierRotationTrack);
  const playbackWindow = resolveManifestPlaybackWindow(entry, clip);
  const movingRootCarrierTranslationTrack = playbackWindow
    ? clip.tracks.find((track) => rootCarrierTranslationTrackHasMotion(track, playbackWindow))
    : undefined;
  const movingRootCarrierYawTrack = playbackWindow
    ? clip.tracks.find((track) => rootCarrierRotationTrackHasYawMotion(track, playbackWindow))
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
  if (entry.playback) {
    const start = entry.playback.start ?? 0;
    const end = entry.playback.end ?? clip.duration;
    if (!playbackWindow) {
      issues.push({ message: `invalid playback window ${start}..${end}` });
    }
  }
  const statusIssue = manifestValidationStatusIssue(entry);
  if (statusIssue) {
    issues.push({ message: statusIssue });
  }
  return {
    id: entry.id,
    url: entry.url,
    accepted: issues.length === 0,
    trackCount: clip.tracks.length,
    duration: clip.duration,
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
  const status = entry.validation?.status;
  if (status === "rejected" || status === "quarantined")
    return entry.validation?.reason ?? `manifest marks clip ${status}`;
  if (isInvalidAssetValidationStatus(status)) return `invalid validation status ${String(status)}`;
  return null;
}

export function manifestRootMotionPolicyIssue(entry: AnimationManifestEntry): string | null {
  const entrySource = entry.source ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  let declaredPolicy: RootMotionPolicy | null = null;
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string") {
      if (!isRootMotionPolicy(sourceRootMotion))
        return `has invalid source.rootMotion policy ${String(sourceRootMotion)}`;
      declaredPolicy = sourceRootMotion;
    } else if (isRecord(sourceRootMotion) && "policy" in sourceRootMotion) {
      const policy = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).policy;
      const provenance = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).provenance;
      const translationPolicy = (sourceRootMotion as { translationPolicy?: unknown }).translationPolicy;
      const yawPolicy = (sourceRootMotion as { yawPolicy?: unknown }).yawPolicy;
      if (!isRootMotionPolicy(policy)) return `has invalid source.rootMotion.policy ${String(policy)}`;
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
  const sourcePolicy = entrySource.rootMotionPolicy;
  if (sourcePolicy !== undefined && !isRootMotionPolicy(sourcePolicy))
    return `has invalid source.rootMotionPolicy ${formatUnknownValue(sourcePolicy)}`;
  if (declaredPolicy && isRootMotionPolicy(sourcePolicy) && sourcePolicy !== declaredPolicy) {
    return `has conflicting source.rootMotionPolicy ${sourcePolicy} for source.rootMotion.policy ${declaredPolicy}`;
  }
  return null;
}

export function manifestRequiredCoverageIssue(entry: AnimationManifestEntry): string | null {
  const source = entry.source ?? {};
  if (source.requiredHumanBones !== undefined) {
    const bones = source.requiredHumanBones;
    if (!Array.isArray(bones)) return "has invalid source.requiredHumanBones metadata";
    for (const bone of bones) {
      if (!isHumanoidBoneName(bone)) return `has invalid source.requiredHumanBones entry ${formatUnknownValue(bone)}`;
    }
  }
  if (source.requiredJoints !== undefined) {
    const joints = source.requiredJoints;
    if (!Array.isArray(joints)) return "has invalid source.requiredJoints metadata";
    for (const joint of joints) {
      if (typeof joint !== "string" || joint.length === 0)
        return `has invalid source.requiredJoints entry ${formatUnknownValue(joint)}`;
    }
  }
  return null;
}

function rootMotionMetadataFieldIssue(metadata: Record<string, unknown>): string | null {
  const carrierIssue = rootMotionCarrierIssue(metadata.carrier);
  if (carrierIssue) return `has invalid source.rootMotion.carrier ${carrierIssue}`;
  const extractedAxesIssue = optionalRootMotionAxesIssue(metadata.extractedAxes, "source.rootMotion.extractedAxes");
  if (extractedAxesIssue) return extractedAxesIssue;
  const preservedAxesIssue = optionalRootMotionAxesIssue(metadata.preservedAxes, "source.rootMotion.preservedAxes");
  if (preservedAxesIssue) return preservedAxesIssue;
  const ownerIssue = optionalNonEmptyStringIssue(metadata.owner, "source.rootMotion.owner");
  if (ownerIssue) return ownerIssue;
  const unitsIssue = optionalNonEmptyStringIssue(metadata.units, "source.rootMotion.units");
  if (unitsIssue) return unitsIssue;
  const supportIssue = optionalNonEmptyStringIssue(metadata.support, "source.rootMotion.support");
  if (supportIssue) return supportIssue;
  const bakeModeIssue = optionalNonEmptyStringIssue(metadata.bakeMode, "source.rootMotion.bakeMode");
  if (bakeModeIssue) return bakeModeIssue;
  return null;
}

function rootMotionCarrierIssue(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value.length > 0 ? null : "metadata";
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? null : formatUnknownValue(value);
  if (!isRecord(value)) return formatUnknownValue(value);
  const jointIndex = value.jointIndex ?? value.joint_index ?? value.index;
  if (jointIndex !== undefined && (!Number.isInteger(jointIndex) || (jointIndex as number) < 0)) {
    return formatUnknownValue(jointIndex);
  }
  const joint = value.joint ?? value.name ?? value.jointName ?? value.joint_name;
  if (joint !== undefined && !isNonEmptyString(joint)) return formatUnknownValue(joint);
  const humanBone = value.humanBone ?? value.human_bone ?? value.humanoid;
  if (humanBone !== undefined && !isNonEmptyString(humanBone)) return formatUnknownValue(humanBone);
  return jointIndex !== undefined || joint !== undefined || humanBone !== undefined ? null : "metadata";
}

function optionalRootMotionAxesIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((axis) => axis !== "x" && axis !== "y" && axis !== "z")) {
    return `has invalid ${label} metadata`;
  }
  return new Set(value).size === value.length ? null : `has duplicate ${label} metadata`;
}

export function manifestEntryMetadataIssue(entry: AnimationManifestEntry): string | null {
  const idIssue = optionalNonEmptyStringIssue(entry.id, "id");
  if (idIssue) return idIssue;
  const labelIssue = optionalStringIssue(entry.label, "label");
  if (labelIssue) return labelIssue;
  const urlIssue = optionalNonEmptyStringIssue(entry.url, "url");
  if (urlIssue) return urlIssue;
  if (entry.playback !== undefined) {
    if (!isRecord(entry.playback)) return "has invalid playback metadata";
    const start = entry.playback.start;
    const end = entry.playback.end;
    if (start !== undefined && !Number.isFinite(start)) return "has invalid playback.start metadata";
    if (end !== undefined && !Number.isFinite(end)) return "has invalid playback.end metadata";
  }
  const loopIssue = optionalBooleanIssue(entry.loop, "loop");
  if (loopIssue) return loopIssue;
  const preloadIssue = optionalBooleanIssue(entry.preload, "preload");
  if (preloadIssue) return preloadIssue;
  const autoplayIssue = optionalBooleanIssue(entry.autoplay, "autoplay");
  if (autoplayIssue) return autoplayIssue;
  if (entry.weight !== undefined && (!Number.isFinite(entry.weight) || entry.weight < 0)) {
    return "has invalid weight metadata";
  }
  const tagsIssue = optionalStringArrayIssue(entry.tags, "tags");
  if (tagsIssue) return tagsIssue;
  const statesIssue = optionalStringArrayIssue(entry.states, "states");
  if (statesIssue) return statesIssue;
  const emotionsIssue = optionalStringArrayIssue(entry.emotions, "emotions");
  if (emotionsIssue) return emotionsIssue;
  const gesturesIssue = optionalStringArrayIssue(entry.gestures, "gestures");
  if (gesturesIssue) return gesturesIssue;
  if (entry.source !== undefined && !isRecord(entry.source)) return "has invalid source metadata";
  if (entry.validation !== undefined) {
    if (!isRecord(entry.validation)) return "has invalid validation metadata";
    if (entry.validation.reason !== undefined && typeof entry.validation.reason !== "string") {
      return "has invalid validation.reason metadata";
    }
    if (entry.validation.issues !== undefined) {
      const validationIssuesIssue = optionalStringArrayIssue(entry.validation.issues, "validation.issues");
      if (validationIssuesIssue) return validationIssuesIssue;
    }
  }
  return null;
}

export function readRequiredAnimationCoverage(entry: AnimationManifestEntry): RequiredAnimationCoverage {
  if (manifestRequiredCoverageIssue(entry)) return { requiredHumanBones: [], requiredJoints: [] };
  const source = entry.source ?? {};
  return {
    requiredHumanBones: Array.isArray(source.requiredHumanBones)
      ? Array.from(new Set(source.requiredHumanBones.filter(isHumanoidBoneName))).sort()
      : [],
    requiredJoints: Array.isArray(source.requiredJoints)
      ? Array.from(
          new Set(
            source.requiredJoints.filter((joint): joint is string => typeof joint === "string" && joint.length > 0)
          )
        ).sort()
      : []
  };
}

function exactRootMotionAxes(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.some((axis) => typeof axis !== "string")) return false;
  const actual = Array.from(new Set(value)).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((axis, index) => axis === sortedExpected[index]);
}

function isIntentionalResidualRootCarrier(entry: AnimationManifestEntry): boolean {
  const rootMotion = entry.source?.rootMotion;
  if (!isRecord(rootMotion)) return false;
  const metadata = rootMotion;
  const verticalTransition =
    metadata.owner === "director-xz" &&
    metadata.support === "vertical-transition" &&
    metadata.bakeMode === "reference" &&
    exactRootMotionAxes(metadata.extractedAxes, ["x", "z"]) &&
    exactRootMotionAxes(metadata.preservedAxes, ["y"]);
  const residualTrajectory =
    metadata.bakeMode === "remove-linear-trajectory" &&
    (metadata.owner === "director-xz" ||
      (metadata.owner === "none" && metadata.support === "contact-aware-stationary"));
  return (
    metadata.policy === "stripped-to-in-place" &&
    metadata.carrier === "hips" &&
    metadata.units === "meters-target-rest-offset" &&
    (verticalTransition || residualTrajectory)
  );
}

function clipRootMotionPolicyIssue(clip: AnimationClip): string | null {
  const clipPolicy = clip.metadata?.rootMotionPolicy;
  if (clipPolicy !== undefined && !isRootMotionPolicy(clipPolicy))
    return `has invalid clip rootMotionPolicy ${formatUnknownValue(clipPolicy)}`;
  const clipTranslationPolicy = clip.metadata?.rootMotionTranslationPolicy;
  if (clipTranslationPolicy !== undefined && !isRootMotionPolicy(clipTranslationPolicy))
    return `has invalid clip rootMotionTranslationPolicy ${formatUnknownValue(clipTranslationPolicy)}`;
  const clipYawPolicy = clip.metadata?.rootMotionYawPolicy;
  if (clipYawPolicy !== undefined && !isRootMotionPolicy(clipYawPolicy))
    return `has invalid clip rootMotionYawPolicy ${formatUnknownValue(clipYawPolicy)}`;
  const clipProvenance = clip.metadata?.rootMotionProvenance;
  if (clipProvenance !== undefined && !isRootMotionProvenance(clipProvenance))
    return `has invalid clip rootMotionProvenance ${formatUnknownValue(clipProvenance)}`;
  return null;
}

function clipRootMotionConflictIssue(entry: AnimationManifestEntry, clip: AnimationClip): string | null {
  const entryMetadata = readRootMotionMetadata(entry);
  if (!entryMetadata) return null;
  const clipPolicy = clip.metadata?.rootMotionPolicy;
  if (isRootMotionPolicy(clipPolicy) && clipPolicy !== entryMetadata.policy) {
    return `clip rootMotionPolicy ${clipPolicy} conflicts with source.rootMotion.policy ${entryMetadata.policy}`;
  }
  const clipProvenance = clip.metadata?.rootMotionProvenance;
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
  return /\broot[-_ ]?motion\b/i.test(`${entry.id} ${entry.label} ${entry.url} ${clip.id} ${clip.name ?? ""}`);
}

export function readRootMotionPolicy(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionPolicy | null {
  return readRootMotionMetadata(entry, clip)?.policy ?? null;
}

export function readRootMotionChannelPolicy(
  entry: AnimationManifestEntry,
  clip: AnimationClip | undefined,
  channel: "translation" | "yaw"
): RootMotionPolicy | null {
  if (entry.source !== undefined && !isRecord(entry.source)) return null;
  const entrySource = entry.source ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  const sourceChannelPolicy = isRecord(sourceRootMotion)
    ? readRootMotionChannelPolicyValue(sourceRootMotion, channel)
    : null;
  if (sourceChannelPolicy) return sourceChannelPolicy;
  const clipChannelPolicy = readRootMotionChannelPolicyValue(clip?.metadata, channel, "rootMotion");
  if (clipChannelPolicy && sourceRootMotion === undefined && entrySource.rootMotionPolicy === undefined) {
    return clipChannelPolicy;
  }
  return readRootMotionPolicy(entry, clip);
}

export function readRootMotionProvenance(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionProvenance {
  return readRootMotionMetadata(entry, clip)?.provenance ?? "unknown";
}

export function readRootMotionMetadata(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionMetadata | null {
  if (entry.source !== undefined && !isRecord(entry.source)) return null;
  const entrySource = entry.source ?? {};
  const clipMetadata = clip?.metadata ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string")
      return isRootMotionPolicy(sourceRootMotion) ? { policy: sourceRootMotion, provenance: "unknown" } : null;
    if (!isRecord(sourceRootMotion) || !("policy" in sourceRootMotion)) return null;
    const metadata = sourceRootMotion as {
      policy?: unknown;
      provenance?: unknown;
      translationPolicy?: unknown;
      yawPolicy?: unknown;
    };
    if (!isRootMotionPolicy(metadata.policy)) return null;
    if (metadata.provenance !== undefined && !isRootMotionProvenance(metadata.provenance)) return null;
    return {
      policy: metadata.policy,
      provenance: isRootMotionProvenance(metadata.provenance) ? metadata.provenance : "unknown",
      ...(isRootMotionPolicy(metadata.translationPolicy) ? { translationPolicy: metadata.translationPolicy } : {}),
      ...(isRootMotionPolicy(metadata.yawPolicy) ? { yawPolicy: metadata.yawPolicy } : {})
    };
  }
  const sourcePolicy = entrySource.rootMotionPolicy;
  if (isRootMotionPolicy(sourcePolicy)) return { policy: sourcePolicy, provenance: "unknown" };
  const clipPolicy = clipMetadata.rootMotionPolicy;
  if (isRootMotionPolicy(clipPolicy)) {
    return {
      policy: clipPolicy,
      provenance: isRootMotionProvenance(clipMetadata.rootMotionProvenance)
        ? clipMetadata.rootMotionProvenance
        : "unknown"
    };
  }
  return null;
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
  const value = metadata[compactKey] ?? metadata[key];
  return isRootMotionPolicy(value) ? value : null;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol()";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function readLoadedManifest(value: unknown, url: string): AnimationManifest {
  if (!isRecord(value)) throw new Error(`manifest ${url} must be an object`);
  return value as AnimationManifest;
}

function readManifestIncludes(manifest: AnimationManifest, url: string): string[] {
  if (manifest.includes === undefined) return [];
  if (!Array.isArray(manifest.includes) || manifest.includes.some((include) => !isNonEmptyString(include))) {
    throw new Error(`manifest ${url} includes must be an array of non-empty strings`);
  }
  return manifest.includes;
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
      id: isManifestEntryObject(entry) && typeof entry.id === "string" ? entry.id : "<unknown>",
      ...(isManifestEntryObject(entry) && typeof entry.label === "string" ? { label: entry.label } : {}),
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
  if (!entry.id) return "missing id";
  if (!entry.url) return "missing url";
  const metadataIssue = manifestEntryMetadataIssue(entry);
  if (metadataIssue) return metadataIssue;
  if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) return `unsupported format ${String(entry.format)}`;
  if (duplicateIds.has(entry.id)) return `duplicate clip id ${entry.id}`;
  if (entry.validation?.status === "accepted" && entry.validation.reason)
    return "accepted but still has rejection reason";
  return null;
}

function readManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] | null {
  return isRecord(manifest) && Array.isArray(manifest.clips) ? manifest.clips : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifestEntryObject(value: unknown): value is AnimationManifestEntry {
  return isRecord(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalNonEmptyStringIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return isNonEmptyString(value) ? null : `has invalid ${label} metadata`;
}

function optionalStringIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? null : `has invalid ${label} metadata`;
}

function optionalBooleanIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return typeof value === "boolean" ? null : `has invalid ${label} metadata`;
}

function optionalStringArrayIssue(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) && value.every(isNonEmptyString) ? null : `has invalid ${label} metadata`;
}
