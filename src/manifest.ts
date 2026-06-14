import { type AnimationClip, type ClipValidationIssue, normalizedTrackProperty, validateClip } from "./clip.js";
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

export type AssetLoader = (url: string) => Promise<unknown>;

export type ManifestLoaderOptions = {
  resolveInclude?: (includeUrl: string, parentUrl: string) => string;
  optionalIncludes?: boolean;
};

export function validateManifest(manifest: AnimationManifest): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const entry of manifest.clips) {
    if (!entry.id) issues.push("manifest entry is missing id");
    if (!entry.url) issues.push(`${entry.id || "<unknown>"} is missing url`);
    if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) issues.push(`${entry.id} has unsupported format ${entry.format}`);
    if (ids.has(entry.id)) issues.push(`duplicate clip id ${entry.id}`);
    ids.add(entry.id);
    if (entry.validation?.status === "accepted" && entry.validation.reason) {
      issues.push(`${entry.id} is accepted but still has rejection reason`);
    }
  }
  return issues;
}

export async function loadManifest(url: string, loader: AssetLoader, options: ManifestLoaderOptions = {}, seen = new Set<string>()): Promise<AnimationManifest> {
  if (seen.has(url)) return { version: 1, clips: [] };
  seen.add(url);
  const manifest = (await loader(url)) as AnimationManifest;
  const includes = await Promise.all(
    (manifest.includes ?? []).map(async (includeUrl) => {
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
    clips: (manifest.clips ?? []).concat(includes.flatMap((entry) => entry.clips ?? []))
  };
}

export function inspectClipAsset(entry: AnimationManifestEntry, clip: AnimationClip): ClipAssetInspection {
  const issues = validateClip(clip);
  const rootMotionPolicy = readRootMotionPolicy(entry, clip);
  const hasTranslationTracks = clip.tracks.some((track) => normalizedTrackProperty(track.property) === "translation");
  if (isRootMotionNamed(entry, clip)) {
    if (!rootMotionPolicy) {
      issues.push({ message: "root-motion clip must declare source.rootMotion.policy" });
    } else if (rootMotionPolicy === "preserved" && !hasTranslationTracks) {
      issues.push({ message: "root-motion policy is preserved but clip has no translation tracks" });
    }
  }
  if (entry.playback) {
    const start = entry.playback.start ?? 0;
    const end = entry.playback.end ?? clip.duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > clip.duration + 1e-5) {
      issues.push({ message: `invalid playback window ${start}..${end}` });
    }
  }
  if (entry.validation?.status === "rejected" || entry.validation?.status === "quarantined") {
    issues.push({ message: entry.validation.reason ?? `manifest marks clip ${entry.validation.status}` });
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

function isRootMotionNamed(entry: AnimationManifestEntry, clip: AnimationClip): boolean {
  return /\broot[-_ ]?motion\b/i.test(`${entry.id} ${entry.label} ${entry.url} ${clip.id} ${clip.name ?? ""}`);
}

export function readRootMotionPolicy(entry: AnimationManifestEntry, clip?: AnimationClip): RootMotionPolicy | null {
  const entrySource = entry.source ?? {};
  const clipMetadata = clip?.metadata ?? {};
  const sourceRootMotion = entrySource.rootMotion;
  if (typeof sourceRootMotion === "string" && isRootMotionPolicy(sourceRootMotion)) return sourceRootMotion;
  if (typeof sourceRootMotion === "object" && sourceRootMotion && "policy" in sourceRootMotion) {
    const policy = (sourceRootMotion as { policy?: unknown }).policy;
    if (isRootMotionPolicy(policy)) return policy;
  }
  const sourcePolicy = entrySource.rootMotionPolicy;
  if (isRootMotionPolicy(sourcePolicy)) return sourcePolicy;
  const clipPolicy = clipMetadata.rootMotionPolicy;
  if (isRootMotionPolicy(clipPolicy)) return clipPolicy;
  return null;
}

function isRootMotionPolicy(value: unknown): value is RootMotionPolicy {
  return value === "none" || value === "preserved" || value === "stripped-to-in-place";
}

export function usableManifestClips(manifest: AnimationManifest): AnimationManifestEntry[] {
  return manifest.clips.filter((entry) => entry.validation?.status !== "rejected" && entry.validation?.status !== "quarantined");
}

export function rejectedAnimationReport(manifest: AnimationManifest): Array<{ id: string; label?: string; reason: string }> {
  return manifest.clips
    .filter((entry) => entry.validation?.status === "rejected" || entry.validation?.status === "quarantined")
    .map((entry) => ({ id: entry.id, label: entry.label, reason: entry.validation?.reason ?? "not accepted" }));
}
