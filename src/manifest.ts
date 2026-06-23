import { type AnimationClip, type ClipValidationIssue, validateClip } from "./clip.js";
import { WAIFU_ANIMATION_BINARY_FORMAT } from "./binary.js";
import {
  duplicatedManifestIds,
  isRootCarrierTranslationTrack,
  resolveManifestPlaybackWindow,
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
  | "requires-runtime-stripping";
export type RootMotionMetadata = {
  policy: RootMotionPolicy;
  provenance: RootMotionProvenance;
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
  const clips = readManifestClips(manifest);
  if (!clips) return ["manifest clips must be an array"];
  for (const entry of clips) {
    if (!entry.id) issues.push("manifest entry is missing id");
    if (!entry.url) issues.push(`${entry.id || "<unknown>"} is missing url`);
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
  const manifest = (await loader(url)) as AnimationManifest;
  const manifestIncludes = Array.isArray(manifest.includes) ? manifest.includes : [];
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
  const rootMotionPolicy = readRootMotionPolicy(entry, clip);
  const hasRootCarrierTranslationTrack = clip.tracks.some(isRootCarrierTranslationTrack);
  const playbackWindow = resolveManifestPlaybackWindow(entry, clip);
  const movingRootCarrierTrack = playbackWindow
    ? clip.tracks.find((track) => rootCarrierTranslationTrackHasMotion(track, playbackWindow))
    : undefined;
  const rootMotionPolicyIssue = manifestRootMotionPolicyIssue(entry) ?? clipRootMotionPolicyIssue(clip);
  if (rootMotionPolicyIssue) {
    issues.push({ message: rootMotionPolicyIssue });
  }
  if (isRootMotionNamed(entry, clip)) {
    if (!rootMotionPolicy) {
      issues.push({ message: "root-motion clip must declare source.rootMotion.policy" });
    }
  }
  if (rootMotionPolicy === "preserved" && !hasRootCarrierTranslationTrack) {
    issues.push({ message: "root-motion policy is preserved but clip has no root carrier translation track" });
  }
  if (!rootMotionPolicy && movingRootCarrierTrack) {
    issues.push({
      joint: String(movingRootCarrierTrack.joint ?? movingRootCarrierTrack.humanBone ?? ""),
      property: movingRootCarrierTrack.property,
      message: "moving root carrier translation requires source.rootMotion.policy"
    });
  }
  if (rootMotionPolicy === "none" && movingRootCarrierTrack) {
    issues.push({
      joint: String(movingRootCarrierTrack.joint ?? movingRootCarrierTrack.humanBone ?? ""),
      property: movingRootCarrierTrack.property,
      message: "root-motion policy is none but root carrier translation moves"
    });
  }
  if (rootMotionPolicy === "stripped-to-in-place") {
    if (movingRootCarrierTrack) {
      issues.push({
        joint: String(movingRootCarrierTrack.joint ?? movingRootCarrierTrack.humanBone ?? ""),
        property: movingRootCarrierTrack.property,
        message: "root-motion policy is stripped-to-in-place but root carrier translation still moves"
      });
    }
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
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string") {
      if (!isRootMotionPolicy(sourceRootMotion))
        return `has invalid source.rootMotion policy ${String(sourceRootMotion)}`;
    } else if (typeof sourceRootMotion === "object" && sourceRootMotion !== null && "policy" in sourceRootMotion) {
      const policy = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).policy;
      const provenance = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).provenance;
      if (!isRootMotionPolicy(policy)) return `has invalid source.rootMotion.policy ${String(policy)}`;
      if (provenance !== undefined && !isRootMotionProvenance(provenance))
        return `has invalid source.rootMotion.provenance ${formatUnknownValue(provenance)}`;
    } else {
      return "has invalid source.rootMotion metadata";
    }
  }
  const sourcePolicy = entrySource.rootMotionPolicy;
  if (sourcePolicy !== undefined && !isRootMotionPolicy(sourcePolicy))
    return `has invalid source.rootMotionPolicy ${formatUnknownValue(sourcePolicy)}`;
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

function clipRootMotionPolicyIssue(clip: AnimationClip): string | null {
  const clipPolicy = clip.metadata?.rootMotionPolicy;
  if (clipPolicy !== undefined && !isRootMotionPolicy(clipPolicy))
    return `has invalid clip rootMotionPolicy ${formatUnknownValue(clipPolicy)}`;
  const clipProvenance = clip.metadata?.rootMotionProvenance;
  if (clipProvenance !== undefined && !isRootMotionProvenance(clipProvenance))
    return `has invalid clip rootMotionProvenance ${formatUnknownValue(clipProvenance)}`;
  return null;
}

function isRootMotionNamed(entry: AnimationManifestEntry, clip: AnimationClip): boolean {
  return /\broot[-_ ]?motion\b/i.test(`${entry.id} ${entry.label} ${entry.url} ${clip.id} ${clip.name ?? ""}`);
}

export function readRootMotionPolicy(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionPolicy | null {
  return readRootMotionMetadata(entry, clip)?.policy ?? null;
}

export function readRootMotionProvenance(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionProvenance {
  return readRootMotionMetadata(entry, clip)?.provenance ?? "unknown";
}

export function readRootMotionMetadata(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionMetadata | null {
  const entrySource = entry.source ?? {};
  const clipMetadata = clip?.metadata ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string")
      return isRootMotionPolicy(sourceRootMotion) ? { policy: sourceRootMotion, provenance: "unknown" } : null;
    if (typeof sourceRootMotion !== "object" || sourceRootMotion === null || !("policy" in sourceRootMotion))
      return null;
    const metadata = sourceRootMotion as { policy?: unknown; provenance?: unknown };
    if (!isRootMotionPolicy(metadata.policy)) return null;
    if (metadata.provenance !== undefined && !isRootMotionProvenance(metadata.provenance)) return null;
    return {
      policy: metadata.policy,
      provenance: isRootMotionProvenance(metadata.provenance) ? metadata.provenance : "unknown"
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
    value === "requires-runtime-stripping"
  );
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
    .map(({ entry, reason }) => ({ id: entry.id, label: entry.label, reason }));
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
  if (!entry.id) return "missing id";
  if (!entry.url) return "missing url";
  if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) return `unsupported format ${String(entry.format)}`;
  if (duplicateIds.has(entry.id)) return `duplicate clip id ${entry.id}`;
  if (entry.validation?.status === "accepted" && entry.validation.reason)
    return "accepted but still has rejection reason";
  return null;
}

function readManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] | null {
  return Array.isArray(manifest.clips) ? manifest.clips : null;
}
