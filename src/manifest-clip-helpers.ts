import { type AnimationClip, type AnimationTrack, normalizedTrackProperty, sampleTrack } from "./clip.js";

type ManifestPlaybackSource = {
  playback?: {
    start?: number;
    end?: number;
  };
};

type ManifestIdSource = {
  id?: string;
};

export type ManifestPlaybackWindow = {
  start: number;
  end: number;
};

const STRIPPED_ROOT_CARRIER_TRANSLATION_TOLERANCE = 1e-4;

export function isRootCarrierTranslationTrack(track: AnimationTrack): boolean {
  if (!isRecord(track)) return false;
  const property = typeof track.property === "string" ? normalizedTrackProperty(track.property) : null;
  return property === "translation" && (track.humanBone === "hips" || isRootCarrierJointName(track.joint));
}

export function rootCarrierTranslationTrackHasMotion(track: AnimationTrack, window: ManifestPlaybackWindow): boolean {
  if (!isRootCarrierTranslationTrack(track)) return false;
  if (!(track.times instanceof Float32Array) || !(track.values instanceof Float32Array)) return false;
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

export function resolveManifestPlaybackWindow(
  entry: ManifestPlaybackSource,
  clip: Pick<AnimationClip, "duration">
): ManifestPlaybackWindow | null {
  const playback = isRecord(entry?.playback) ? entry.playback : undefined;
  if (entry?.playback !== undefined && !playback) return null;
  const duration = isRecord(clip) && typeof clip.duration === "number" ? clip.duration : Number.NaN;
  const start = playback?.start ?? 0;
  const end = playback?.end ?? duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 1e-5)
    return null;
  return { start, end };
}

function isRootCarrierJointName(joint: string | undefined): boolean {
  return (
    joint === "root" ||
    joint === "Root" ||
    joint === "hips" ||
    joint === "Hips" ||
    joint === "pelvis" ||
    joint === "Pelvis"
  );
}

export function duplicatedManifestIds(entries: readonly ManifestIdSource[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    if (seen.has(entry.id)) duplicates.add(entry.id);
    else seen.add(entry.id);
  }
  return duplicates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
