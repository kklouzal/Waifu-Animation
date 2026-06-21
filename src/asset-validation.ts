import { WAIFU_ANIMATION_BINARY_FORMAT, decodeAnimationBinary } from "./binary.js";
import { type AnimationClip, type ClipValidationIssue, normalizedTrackProperty, resolveTrackJointIndex, sampleTrack, trackStride, validateClip } from "./clip.js";
import {
  type AnimationManifest,
  type AnimationManifestEntry,
  type AssetValidationStatus,
  inspectClipAsset,
  isInvalidAssetValidationStatus,
  readRootMotionPolicy,
  readRootMotionProvenance
} from "./manifest.js";
import { cloneNormalizedQuat, dotQuat } from "./math.js";
import { type Skeleton } from "./skeleton.js";

export type AnimationAssetValidationIssue = {
  id: string;
  severity: "error" | "warning";
  message: string;
  track?: number;
  joint?: string;
  property?: string;
  delta?: number;
};

export type AnimationAssetValidationEntry = {
  id: string;
  label: string;
  url: string;
  accepted: boolean;
  status: AssetValidationStatus;
  duration: number;
  loop: boolean;
  category: string;
  posture: string;
  compatibleStates: string[];
  rootMotionPolicy: string;
  rootMotionProvenance: string;
  rootCarrierTranslationTrackCount: number;
  movingRootCarrierTranslationTrackCount: number;
  jointCoverage: string[];
  trackCount: number;
  issues: AnimationAssetValidationIssue[];
};

export type AnimationAssetValidationReport = {
  generatedAt: string;
  total: number;
  accepted: number;
  rejected: number;
  quarantined: number;
  entries: AnimationAssetValidationEntry[];
};

export type AnimationAssetFetch = (url: string) => Promise<ArrayBuffer | ArrayBufferView>;

export type AnimationAssetValidationOptions = {
  skeleton?: Skeleton;
  now?: Date;
};

export async function validateAnimationManifestAssets(
  manifest: AnimationManifest,
  fetchAsset: AnimationAssetFetch,
  options: AnimationAssetValidationOptions = {}
): Promise<AnimationAssetValidationReport> {
  const structuralIssues = inspectManifestStructure(manifest);
  const entries = await Promise.all(
    manifest.clips.map((entry, index) =>
      validateAnimationManifestEntryWithStructure(entry, fetchAsset, options, structuralIssues.get(index) ?? [])
    )
  );
  const statusCounts = countValidationStatuses(entries);
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    total: entries.length,
    accepted: statusCounts.accepted,
    rejected: statusCounts.rejected,
    quarantined: statusCounts.quarantined,
    entries
  };
}

export async function validateAnimationManifestEntry(
  entry: AnimationManifestEntry,
  fetchAsset: AnimationAssetFetch,
  options: AnimationAssetValidationOptions = {}
): Promise<AnimationAssetValidationEntry> {
  return validateAnimationManifestEntryWithStructure(entry, fetchAsset, options, inspectManifestEntryStructure(entry));
}

async function validateAnimationManifestEntryWithStructure(
  entry: AnimationManifestEntry,
  fetchAsset: AnimationAssetFetch,
  options: AnimationAssetValidationOptions,
  structuralIssues: AnimationAssetValidationIssue[]
): Promise<AnimationAssetValidationEntry> {
  if (structuralIssues.length > 0) return buildRejectedEntry(entry, structuralIssues);
  try {
    const clip = decodeAnimationBinary(await fetchAsset(entry.url), entry.id);
    return inspectAnimationAsset(entry, clip, options.skeleton);
  } catch (error) {
    return buildRejectedEntry(entry, [{ id: entry.id, severity: "error", message: error instanceof Error ? error.message : String(error) }]);
  }
}

export function inspectAnimationAsset(entry: AnimationManifestEntry, clip: AnimationClip, skeleton?: Skeleton): AnimationAssetValidationEntry {
  const clipIssues = validateClip(clip, skeleton).map((issue) => toAssetIssue(entry.id, issue));
  const manifestInspection = inspectClipAsset(entry, clip).issues.map((issue) => toAssetIssue(entry.id, issue));
  const issues = dedupeIssues([
    ...inspectManifestEntryStructure(entry),
    ...clipIssues,
    ...manifestInspection,
    ...inspectSemanticAsset(entry, clip, skeleton)
  ]);
  const requestedStatus = entry.validation?.status;
  let status: AssetValidationStatus;
  if (requestedStatus === "quarantined") {
    status = "quarantined";
  } else if (requestedStatus === "rejected" || isInvalidAssetValidationStatus(requestedStatus) || issues.some((issue) => issue.severity === "error")) {
    status = "rejected";
  } else {
    status = "accepted";
  }
  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    accepted: status === "accepted",
    status,
    duration: clip.duration,
    loop: Boolean(entry.loop ?? clip.loop),
    ...assetReportMetadata(entry, clip),
    compatibleStates: entry.states ?? [],
    jointCoverage: jointCoverage(clip, skeleton),
    trackCount: clip.tracks.length,
    issues
  };
}

export function usableValidatedAnimationAssets(report: AnimationAssetValidationReport): AnimationAssetValidationEntry[] {
  return report.entries.filter((entry) => entry.status === "accepted");
}

export function rejectedValidatedAnimationAssets(report: AnimationAssetValidationReport): AnimationAssetValidationEntry[] {
  return report.entries.filter((entry) => entry.status !== "accepted");
}

function inspectSemanticAsset(entry: AnimationManifestEntry, clip: AnimationClip, skeleton?: Skeleton): AnimationAssetValidationIssue[] {
  const issues: AnimationAssetValidationIssue[] = [];
  const effectiveLoop = entry.loop ?? clip.loop;
  if (clip.tracks.length === 0) issues.push({ id: entry.id, severity: "error", message: "clip has no animation tracks" });
  if (effectiveLoop && clip.duration < 0.25) {
    const severity = /aim[-_ ]?offset/i.test(`${entry.id} ${entry.label} ${entry.tags?.join(" ") ?? ""}`) ? "warning" : "error";
    issues.push({ id: entry.id, severity, message: "looping clip is too short to blend safely unless used as a static pose/aim offset" });
  }
  if (effectiveLoop) issues.push(...inspectLoopEndpointMismatches(entry, clip, skeleton));
  if (skeleton) {
    const mapped = jointCoverage(clip, skeleton).length;
    if (mapped === 0) issues.push({ id: entry.id, severity: "error", message: "clip has no tracks that map to target skeleton" });
  }
  return issues;
}

const LOOP_ENDPOINT_WARNING_PREFIX = "loop endpoints differ; crossfade or seam blending is required";

function inspectLoopEndpointMismatches(entry: AnimationManifestEntry, clip: AnimationClip, skeleton?: Skeleton): AnimationAssetValidationIssue[] {
  const issues: AnimationAssetValidationIssue[] = [];
  const playbackWindow = resolvePlaybackWindow(entry, clip);
  if (!playbackWindow) return issues;
  for (let index = 0; index < clip.tracks.length; index += 1) {
    const track = clip.tracks[index]!;
    if (track.times.length < 2) continue;
    const property = normalizedTrackProperty(track.property);
    if (!property) continue;
    const stride = trackStride(property);
    if (track.values.length < track.times.length * stride) continue;
    const startSample = sampleTrack(track, playbackWindow.start);
    const endSample = sampleTrack(track, playbackWindow.end);
    const tolerance = property === "rotation" ? 0.24 : 0.18;
    const delta = property === "rotation" ? rotationEndpointDelta(startSample, endSample) : vectorEndpointDelta(startSample, endSample, stride);
    if (!Number.isFinite(delta) || delta <= tolerance) continue;
    const joint = resolveLoopEndpointJoint(track, skeleton);
    issues.push({
      id: entry.id,
      severity: "warning",
      message: `${LOOP_ENDPOINT_WARNING_PREFIX}: track ${index}${joint ? ` (${joint})` : ""} ${property} delta ${formatDelta(delta)} exceeds ${formatDelta(tolerance)}`,
      track: index,
      ...(joint ? { joint } : {}),
      property,
      delta
    });
  }
  return issues;
}

function resolvePlaybackWindow(entry: AnimationManifestEntry, clip: AnimationClip): { start: number; end: number } | null {
  const start = entry.playback?.start ?? 0;
  const end = entry.playback?.end ?? clip.duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > clip.duration + 1e-5) return null;
  return { start, end };
}

function resolveLoopEndpointJoint(track: AnimationClip["tracks"][number], skeleton?: Skeleton): string | undefined {
  if (skeleton) {
    const index = resolveTrackJointIndex(skeleton, track);
    if (index >= 0) {
      const joint = skeleton.joints[index]!;
      return joint.humanoid ?? joint.name;
    }
  }
  const joint = track.humanBone ?? track.joint;
  return joint === undefined ? undefined : String(joint);
}

function formatDelta(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(4);
}

function vectorEndpointDelta(first: ArrayLike<number>, last: ArrayLike<number>, stride: number): number {
  let delta = 0;
  for (let i = 0; i < stride; i += 1) delta += Math.abs((first[i] ?? 0) - (last[i] ?? 0));
  return delta;
}

function rotationEndpointDelta(first: ArrayLike<number>, last: ArrayLike<number>): number {
  const firstQuat = cloneNormalizedQuat(Array.prototype.slice.call(first, 0, 4));
  const lastQuat = cloneNormalizedQuat(Array.prototype.slice.call(last, 0, 4));
  const sameHemisphereDot = Math.abs(dotQuat(firstQuat, lastQuat));
  return Math.sqrt(Math.max(0, 2 - 2 * Math.min(1, sameHemisphereDot)));
}

function jointCoverage(clip: AnimationClip, skeleton?: Skeleton): string[] {
  const joints = new Set<string>();
  for (const track of clip.tracks) {
    const name = track.humanBone ?? track.joint;
    if (!name) continue;
    if (!skeleton) {
      joints.add(String(name));
      continue;
    }
    const index = resolveTrackJointIndex(skeleton, track);
    if (index >= 0) joints.add(skeleton.joints[index]!.humanoid ?? skeleton.joints[index]!.name);
  }
  return Array.from(joints).sort();
}

function toAssetIssue(id: string, issue: ClipValidationIssue): AnimationAssetValidationIssue {
  return {
    id,
    severity: "error",
    message: issue.message,
    ...(issue.track === undefined ? {} : { track: issue.track }),
    ...(issue.joint === undefined ? {} : { joint: issue.joint })
  };
}

function dedupeIssues(issues: AnimationAssetValidationIssue[]): AnimationAssetValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.track ?? ""}:${issue.joint ?? ""}:${issue.property ?? ""}:${issue.delta ?? ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inspectManifestStructure(manifest: AnimationManifest): Map<number, AnimationAssetValidationIssue[]> {
  const duplicateIds = duplicatedManifestIds(manifest.clips);
  const issues = new Map<number, AnimationAssetValidationIssue[]>();
  for (let index = 0; index < manifest.clips.length; index += 1) {
    const entry = manifest.clips[index]!;
    const entryIssues = inspectManifestEntryStructure(entry);
    if (entry.id && duplicateIds.has(entry.id)) {
      entryIssues.push({ id: entry.id, severity: "error", message: `duplicate clip id ${entry.id}` });
    }
    if (entryIssues.length > 0) issues.set(index, entryIssues);
  }
  return issues;
}

function inspectManifestEntryStructure(entry: AnimationManifestEntry): AnimationAssetValidationIssue[] {
  const id = entry.id || "<unknown>";
  const issues: AnimationAssetValidationIssue[] = [];
  if (!entry.id) issues.push({ id, severity: "error", message: "manifest entry is missing id" });
  if (!entry.url) issues.push({ id, severity: "error", message: `${id} is missing url` });
  if (entry.format !== WAIFU_ANIMATION_BINARY_FORMAT) {
    issues.push({ id, severity: "error", message: `${id} has unsupported format ${String(entry.format)}` });
  }
  if (entry.validation?.status === "accepted" && entry.validation.reason) {
    issues.push({ id, severity: "error", message: `${id} is accepted but still has rejection reason` });
  }
  return issues;
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

function countValidationStatuses(entries: AnimationAssetValidationEntry[]): Record<AssetValidationStatus, number> {
  return entries.reduce(
    (counts, entry) => {
      counts[entry.status] += 1;
      return counts;
    },
    { accepted: 0, rejected: 0, quarantined: 0 }
  );
}

function buildRejectedEntry(entry: AnimationManifestEntry, issues: AnimationAssetValidationIssue[]): AnimationAssetValidationEntry {
  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    accepted: false,
    status: "rejected",
    duration: 0,
    loop: Boolean(entry.loop),
    ...assetReportMetadata(entry),
    compatibleStates: entry.states ?? [],
    jointCoverage: [],
    trackCount: 0,
    issues
  };
}

function classifyCategory(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  const text = `${entry.id} ${entry.label} ${entry.tags?.join(" ") ?? ""} ${clip?.name ?? ""}`.toLowerCase();
  if (/walk|run|jog|turn|locomotion/.test(text)) return "locomotion";
  if (/sit|chair/.test(text)) return "sitting";
  if (/stretch/.test(text)) return "stretching";
  if (/gesture|wave|shrug|explain|clap/.test(text)) return "gesture";
  if (/idle|conversation|listen/.test(text)) return "idle";
  return "uncategorized";
}

function classifyPosture(entry: AnimationManifestEntry): string {
  const text = `${entry.id} ${entry.label} ${entry.tags?.join(" ") ?? ""}`.toLowerCase();
  if (/sit|chair/.test(text)) return "sitting";
  if (/crouch/.test(text)) return "crouching";
  return "standing";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assetReportMetadata(
  entry: AnimationManifestEntry,
  clip?: AnimationClip
): Pick<
  AnimationAssetValidationEntry,
  "category" | "posture" | "rootMotionPolicy" | "rootMotionProvenance" | "rootCarrierTranslationTrackCount" | "movingRootCarrierTranslationTrackCount"
> {
  const carrierSummary = clip ? rootCarrierTranslationSummary(entry, clip) : { total: 0, moving: 0 };
  return {
    category: readString(entry.source?.category) ?? classifyCategory(entry, clip),
    posture: readString(entry.source?.posture) ?? classifyPosture(entry),
    rootMotionPolicy: readRootMotionPolicyLabel(entry, clip),
    rootMotionProvenance: readRootMotionProvenance(entry, clip),
    rootCarrierTranslationTrackCount: carrierSummary.total,
    movingRootCarrierTranslationTrackCount: carrierSummary.moving
  };
}

function readRootMotionPolicyLabel(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  return readRootMotionPolicy(entry, clip) ?? "none";
}

function rootCarrierTranslationSummary(entry: AnimationManifestEntry, clip: AnimationClip): { total: number; moving: number } {
  const playbackWindow = resolvePlaybackWindow(entry, clip);
  let total = 0;
  let moving = 0;
  for (const track of clip.tracks) {
    if (!isRootCarrierTranslationTrack(track)) continue;
    total += 1;
    if (playbackWindow && rootCarrierTranslationTrackHasMotion(track, playbackWindow)) moving += 1;
  }
  return { total, moving };
}

function isRootCarrierTranslationTrack(track: AnimationClip["tracks"][number]): boolean {
  return normalizedTrackProperty(track.property) === "translation" && (track.humanBone === "hips" || isRootCarrierJointName(track.joint));
}

function rootCarrierTranslationTrackHasMotion(track: AnimationClip["tracks"][number], window: { start: number; end: number }): boolean {
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
    if (Math.abs((sample[axis] ?? 0) - (base[axis] ?? 0)) > 1e-4) return true;
  }
  return false;
}

function isRootCarrierJointName(joint: string | undefined): boolean {
  return joint === "root" || joint === "Root" || joint === "hips" || joint === "Hips" || joint === "pelvis" || joint === "Pelvis";
}
