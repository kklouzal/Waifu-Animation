import { type AnimationClip, type AnimationTrack, type ClipValidationIssue, normalizedTrackProperty, sampleTrack, validateClip } from "./clip.js";
import { WAIFU_ANIMATION_BINARY_FORMAT } from "./binary.js";

export type AssetValidationStatus = "accepted" | "rejected" | "quarantined";

export type AnimationManifestEntry = {
  id: string;
  label: string;
  url: string;
  format: typeof WAIFU_ANIMATION_BINARY_FORMAT | string;
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

export type AssetLoader = (url: string) => Promise<unknown>;

const STRIPPED_ROOT_CARRIER_TRANSLATION_TOLERANCE = 1e-4;

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
    if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) issues.push(`${entry.id} has unsupported format ${entry.format}`);
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
  }
  return issues;
}

export async function loadManifest(url: string, loader: AssetLoader, options: ManifestLoaderOptions = {}, seen = new Set<string>()): Promise<AnimationManifest> {
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
  const playbackWindow = resolvePlaybackWindow(entry, clip);
  const movingRootCarrierTrack = playbackWindow ? clip.tracks.find((track) => rootCarrierTranslationTrackHasMotion(track, playbackWindow)) : undefined;
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
  if (status === "rejected" || status === "quarantined") return entry.validation?.reason ?? `manifest marks clip ${status}`;
  if (isInvalidAssetValidationStatus(status)) return `invalid validation status ${String(status)}`;
  return null;
}

export function manifestRootMotionPolicyIssue(entry: AnimationManifestEntry): string | null {
  const entrySource = entry.source ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  if (sourceRootMotion !== undefined) {
    if (typeof sourceRootMotion === "string") {
      if (!isRootMotionPolicy(sourceRootMotion)) return `has invalid source.rootMotion policy ${String(sourceRootMotion)}`;
    } else if (typeof sourceRootMotion === "object" && sourceRootMotion !== null && "policy" in sourceRootMotion) {
      const policy = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).policy;
      const provenance = (sourceRootMotion as { policy?: unknown; provenance?: unknown }).provenance;
      if (!isRootMotionPolicy(policy)) return `has invalid source.rootMotion.policy ${String(policy)}`;
      if (provenance !== undefined && !isRootMotionProvenance(provenance)) return `has invalid source.rootMotion.provenance ${String(provenance)}`;
    } else {
      return "has invalid source.rootMotion metadata";
    }
  }
  const sourcePolicy = entrySource.rootMotionPolicy;
  if (sourcePolicy !== undefined && !isRootMotionPolicy(sourcePolicy)) return `has invalid source.rootMotionPolicy ${String(sourcePolicy)}`;
  return null;
}

function clipRootMotionPolicyIssue(clip: AnimationClip): string | null {
  const clipPolicy = clip.metadata?.rootMotionPolicy;
  if (clipPolicy !== undefined && !isRootMotionPolicy(clipPolicy)) return `has invalid clip rootMotionPolicy ${String(clipPolicy)}`;
  const clipProvenance = clip.metadata?.rootMotionProvenance;
  if (clipProvenance !== undefined && !isRootMotionProvenance(clipProvenance)) return `has invalid clip rootMotionProvenance ${String(clipProvenance)}`;
  return null;
}

function isRootMotionNamed(entry: AnimationManifestEntry, clip: AnimationClip): boolean {
  return /\broot[-_ ]?motion\b/i.test(`${entry.id} ${entry.label} ${entry.url} ${clip.id} ${clip.name ?? ""}`);
}

function isRootCarrierTranslationTrack(track: AnimationTrack): boolean {
  return normalizedTrackProperty(track.property) === "translation" && (track.humanBone === "hips" || isRootCarrierJointName(track.joint));
}

function rootCarrierTranslationTrackHasMotion(track: AnimationTrack, window: { start: number; end: number }): boolean {
  if (!isRootCarrierTranslationTrack(track)) return false;
  if (track.times.length < 2 || track.values.length !== track.times.length * 3) return false;
  const base = sampleTrack(track, window.start);
  const sampleTimes = [window.end];
  for (const time of track.times) {
    if (time > window.start && time < window.end) sampleTimes.push(time);
  }
  for (const time of sampleTimes) {
    if (translationSamplesDiffer(base, sampleTrack(track, time))) return true;
  }
  return false;
}

function translationSamplesDiffer(base: ArrayLike<number>, sample: ArrayLike<number>): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs((sample[axis] ?? 0) - (base[axis] ?? 0)) > STRIPPED_ROOT_CARRIER_TRANSLATION_TOLERANCE) return true;
  }
  return false;
}

function resolvePlaybackWindow(entry: AnimationManifestEntry, clip: AnimationClip): { start: number; end: number } | null {
  const start = entry.playback?.start ?? 0;
  const end = entry.playback?.end ?? clip.duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > clip.duration + 1e-5) return null;
  return { start, end };
}

function isRootCarrierJointName(joint: string | undefined): boolean {
  return joint === "root" || joint === "Root" || joint === "hips" || joint === "Hips" || joint === "pelvis" || joint === "Pelvis";
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
    if (typeof sourceRootMotion === "string") return isRootMotionPolicy(sourceRootMotion) ? { policy: sourceRootMotion, provenance: "unknown" } : null;
    if (typeof sourceRootMotion !== "object" || sourceRootMotion === null || !("policy" in sourceRootMotion)) return null;
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
      provenance: isRootMotionProvenance(clipMetadata.rootMotionProvenance) ? clipMetadata.rootMotionProvenance : "unknown"
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

export function usableManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] {
  const clips = readManifestClips(manifest) ?? [];
  const duplicateIds = duplicatedManifestIds(clips);
  return clips.filter((entry) => !manifestRejectionIssue(entry, duplicateIds));
}

export function rejectedAnimationReport(manifest: AnimationManifest): Array<{ id: string; label?: string; reason: string }> {
  const clips = readManifestClips(manifest) ?? [];
  const duplicateIds = duplicatedManifestIds(clips);
  return clips
    .map((entry) => ({ entry, reason: manifestRejectionIssue(entry, duplicateIds) }))
    .filter((item): item is { entry: AnimationManifestEntry; reason: string } => item.reason !== null)
    .map(({ entry, reason }) => ({ id: entry.id, label: entry.label, reason }));
}

function manifestRejectionIssue(entry: AnimationManifestEntry, duplicateIds = new Set<string>()): string | null {
  return manifestStructuralRejectionIssue(entry, duplicateIds) ?? manifestValidationStatusIssue(entry) ?? manifestRootMotionPolicyIssue(entry);
}

function manifestStructuralRejectionIssue(entry: AnimationManifestEntry, duplicateIds: ReadonlySet<string>): string | null {
  if (!entry.id) return "missing id";
  if (!entry.url) return "missing url";
  if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) return `unsupported format ${String(entry.format)}`;
  if (duplicateIds.has(entry.id)) return `duplicate clip id ${entry.id}`;
  if (entry.validation?.status === "accepted" && entry.validation.reason) return "accepted but still has rejection reason";
  return null;
}

function duplicatedManifestIds(entries: readonly AnimationManifestEntry[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (!entry.id) continue;
    if (seen.has(entry.id)) duplicates.add(entry.id);
    else seen.add(entry.id);
  }
  return duplicates;
}

function readManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] | null {
  return Array.isArray(manifest.clips) ? manifest.clips : null;
}
