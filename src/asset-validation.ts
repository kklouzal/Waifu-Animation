import { decodeAnimationBinary } from "./binary.js";
import { type AnimationClip, type ClipValidationIssue, normalizedTrackProperty, resolveTrackJointIndex, sampleTrack, trackStride, validateClip } from "./clip.js";
import {
  type AnimationManifest,
  type AnimationManifestEntry,
  type AssetValidationStatus,
  inspectClipAsset,
  isInvalidAssetValidationStatus,
  readRootMotionPolicy
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
  const entries = await Promise.all(manifest.clips.map((entry) => validateAnimationManifestEntry(entry, fetchAsset, options)));
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
  const issues = dedupeIssues([...clipIssues, ...manifestInspection, ...inspectSemanticAsset(entry, clip, skeleton)]);
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

function assetReportMetadata(entry: AnimationManifestEntry, clip?: AnimationClip): Pick<AnimationAssetValidationEntry, "category" | "posture" | "rootMotionPolicy"> {
  return {
    category: readString(entry.source?.category) ?? classifyCategory(entry, clip),
    posture: readString(entry.source?.posture) ?? classifyPosture(entry),
    rootMotionPolicy: readRootMotionPolicyLabel(entry, clip)
  };
}

function readRootMotionPolicyLabel(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  return readRootMotionPolicy(entry, clip) ?? "none";
}
