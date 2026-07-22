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
const STRIPPED_ROOT_CARRIER_YAW_TOLERANCE = 1e-4;
const MAX_MANIFEST_ID_LENGTH = 4_096;

export function isRootCarrierTranslationTrack(track: AnimationTrack): boolean {
  if (!isRecord(track)) return false;
  const property = typeof track.property === "string" ? normalizedTrackProperty(track.property) : null;
  return property === "translation" && (track.humanBone === "hips" || isRootCarrierJointName(track.joint));
}

export function isRootCarrierRotationTrack(track: AnimationTrack): boolean {
  if (!isRecord(track)) return false;
  const property = typeof track.property === "string" ? normalizedTrackProperty(track.property) : null;
  return property === "rotation" && (track.humanBone === "hips" || isRootCarrierJointName(track.joint));
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

export function rootCarrierRotationTrackHasYawMotion(track: AnimationTrack, window: ManifestPlaybackWindow): boolean {
  if (!isRootCarrierRotationTrack(track)) return false;
  if (!(track.times instanceof Float32Array) || !(track.values instanceof Float32Array)) return false;
  if (track.times.length < 2 || track.values.length !== track.times.length * 4) return false;
  const base = sampleTrack(track, window.start);
  const sampleTimes = [window.end];
  for (const time of track.times) {
    if (time > window.start && time < window.end) sampleTimes.push(time);
  }
  for (const time of sampleTimes) {
    if (yawSamplesDiffer(base, sampleTrack(track, time))) return true;
  }
  return false;
}

function translationSamplesDiffer(base: ArrayLike<number>, sample: ArrayLike<number>): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs((sample[axis] ?? 0) - (base[axis] ?? 0)) > STRIPPED_ROOT_CARRIER_TRANSLATION_TOLERANCE) return true;
  }
  return false;
}

function yawSamplesDiffer(base: ArrayLike<number>, sample: ArrayLike<number>): boolean {
  return (
    Math.abs(wrapRadians(yawFromQuaternion(sample) - yawFromQuaternion(base))) > STRIPPED_ROOT_CARRIER_YAW_TOLERANCE
  );
}

function yawFromQuaternion(sample: ArrayLike<number>): number {
  const x = finiteQuaternionComponent(sample[0]);
  const y = finiteQuaternionComponent(sample[1]);
  const z = finiteQuaternionComponent(sample[2]);
  const w = finiteQuaternionComponent(sample[3], 1);
  const forwardX = 2 * (x * z + w * y);
  const forwardZ = 1 - 2 * (x * x + y * y);
  const yaw = Math.atan2(forwardX, forwardZ);
  return Number.isFinite(yaw) ? yaw : 0;
}

function finiteQuaternionComponent(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function wrapRadians(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function resolveManifestPlaybackWindow(
  entry: ManifestPlaybackSource,
  clip: Pick<AnimationClip, "duration">
): ManifestPlaybackWindow | null {
  const playbackValue = isRecord(entry) ? ownValue(entry, "playback") : undefined;
  const playback = isRecord(playbackValue) ? playbackValue : undefined;
  if (playbackValue !== undefined && !playback) return null;
  const durationValue = isRecord(clip) ? ownValue(clip, "duration") : undefined;
  const duration = typeof durationValue === "number" ? durationValue : Number.NaN;
  const startValue = playback ? ownValue(playback, "start") : undefined;
  const endValue = playback ? ownValue(playback, "end") : undefined;
  const start = startValue === undefined ? 0 : typeof startValue === "number" ? startValue : Number.NaN;
  const end = endValue === undefined ? duration : typeof endValue === "number" ? endValue : Number.NaN;
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
    if (!isRecord(entry)) continue;
    const id = ownValue(entry, "id");
    if (!isNonEmptyString(id)) continue;
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return duplicates;
}

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function ownValue(value: object, field: string): unknown {
  return hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_MANIFEST_ID_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
