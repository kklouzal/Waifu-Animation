import { WAIFU_ANIMATION_BINARY_FORMAT, decodeAnimationBinary } from "./binary.js";
import {
  type AnimationClip,
  type ClipValidationIssue,
  normalizedTrackProperty,
  resolveTrackJointIndex,
  sampleTrack,
  trackStride,
  validateClip
} from "./clip.js";
import {
  type AnimationManifest,
  type AnimationManifestEntry,
  type AssetValidationStatus,
  MAX_MANIFEST_CLIPS_PER_MANIFEST,
  inspectClipAsset,
  isInvalidAssetValidationStatus,
  manifestEntryMetadataIssue,
  manifestRequiredCoverageIssue,
  manifestRootMotionPolicyIssue,
  readRequiredAnimationCoverage,
  readRootMotionPolicy,
  readRootMotionProvenance,
  validateManifestTopLevel
} from "./manifest.js";
import {
  duplicatedManifestIds,
  isRootCarrierTranslationTrack,
  resolveManifestPlaybackWindow,
  rootCarrierTranslationTrackHasMotion
} from "./manifest-clip-helpers.js";
import { cloneNormalizedQuat, dotQuat } from "./math.js";
import { type Skeleton, resolveJointIndex } from "./skeleton.js";

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
  const topLevelIssues = validateManifestTopLevel(manifest).map((message) => ({
    id: "<manifest>",
    severity: "error" as const,
    message
  }));
  if (topLevelIssues.length > 0) {
    return buildValidationReport(
      [buildRejectedEntry(manifestEntry("<manifest>", "Manifest", ""), topLevelIssues)],
      options.now
    );
  }
  const manifestClips = readManifestAssetEntries(manifest) ?? [];
  const structuralIssues = inspectManifestStructure(manifest);
  const entries = await Promise.all(
    manifestClips.map((entry, index) =>
      validateAnimationManifestEntryWithStructure(entry, fetchAsset, options, structuralIssues.get(index) ?? [])
    )
  );
  return buildValidationReport(entries, options.now);
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
  const validationStatus = isRecord(entry) ? readValidationStatus(entry) : undefined;
  if (validationStatus === "rejected" || validationStatus === "quarantined") {
    return buildRejectedEntry(
      entry,
      dedupeIssues([...structuralIssues, ...inspectManifestValidationStatusIssues(entry, validationStatus)]),
      validationStatus
    );
  }
  if (structuralIssues.length > 0) return buildRejectedEntry(entry, structuralIssues);
  try {
    const entryId = readEntryId(entry);
    const clip = decodeAnimationBinary(await fetchAsset(readEntryUrl(entry)), entryId);
    return inspectAnimationAsset(entry, clip, options.skeleton);
  } catch (error) {
    return buildRejectedEntry(entry, [
      { id: readEntryId(entry), severity: "error", message: error instanceof Error ? error.message : String(error) }
    ]);
  }
}

export function inspectAnimationAsset(
  entry: AnimationManifestEntry,
  clip: AnimationClip,
  skeleton?: Skeleton
): AnimationAssetValidationEntry {
  if (!isRecord(entry)) return buildRejectedEntry(entry, inspectManifestEntryStructure(entry));
  const id = readEntryId(entry);
  const structuralIssues = inspectManifestEntryStructure(entry);
  const clipIssues = validateClip(clip, skeleton).map((issue) => toAssetIssue(id, issue));
  const requestedStatus = readValidationStatus(entry);
  const validationStatusIssues =
    requestedStatus === "rejected" || requestedStatus === "quarantined"
      ? inspectManifestValidationStatusIssues(entry, requestedStatus)
      : [];
  if (!isInspectableManifestEntry(entry) || !isInspectableAnimationClip(clip)) {
    return buildRejectedEntry(entry, dedupeIssues([...structuralIssues, ...clipIssues, ...validationStatusIssues]));
  }
  const manifestInspection = inspectClipAsset(entry, clip).issues.map((issue) => toAssetIssue(id, issue));
  const issues = dedupeIssues([
    ...structuralIssues,
    ...clipIssues,
    ...manifestInspection,
    ...validationStatusIssues,
    ...inspectSemanticAsset(entry, clip, skeleton)
  ]);
  let status: AssetValidationStatus;
  if (requestedStatus === "quarantined") {
    status = "quarantined";
  } else if (
    requestedStatus === "rejected" ||
    isInvalidAssetValidationStatus(requestedStatus) ||
    issues.some((issue) => issue.severity === "error")
  ) {
    status = "rejected";
  } else {
    status = "accepted";
  }
  return {
    id,
    label: readOwnString(entry, "label") ?? "",
    url: readEntryUrl(entry),
    accepted: status === "accepted",
    status,
    duration: clip.duration,
    loop: Boolean(ownValue(entry, "loop") ?? clip.loop),
    ...assetReportMetadata(entry, clip),
    compatibleStates: readStringArray(ownValue(entry, "states")),
    jointCoverage: jointCoverage(clip, skeleton),
    trackCount: clip.tracks.length,
    issues
  };
}

export function usableValidatedAnimationAssets(
  report: AnimationAssetValidationReport
): AnimationAssetValidationEntry[] {
  return report.entries.filter((entry) => entry.status === "accepted");
}

export function rejectedValidatedAnimationAssets(
  report: AnimationAssetValidationReport
): AnimationAssetValidationEntry[] {
  return report.entries.filter((entry) => entry.status !== "accepted");
}

function inspectSemanticAsset(
  entry: AnimationManifestEntry,
  clip: AnimationClip,
  skeleton?: Skeleton
): AnimationAssetValidationIssue[] {
  const issues: AnimationAssetValidationIssue[] = [];
  const id = readEntryId(entry);
  const effectiveLoop = ownValue(entry, "loop") ?? clip.loop;
  const coverage = jointCoverage(clip, skeleton);
  if (clip.tracks.length === 0) issues.push({ id, severity: "error", message: "clip has no animation tracks" });
  if (effectiveLoop && clip.duration < 0.25) {
    const severity = /aim[-_ ]?offset/i.test(manifestEntrySearchText(entry)) ? "warning" : "error";
    issues.push({
      id,
      severity,
      message: "looping clip is too short to blend safely unless used as a static pose/aim offset"
    });
  }
  if (effectiveLoop) issues.push(...inspectLoopEndpointMismatches(entry, clip, skeleton));
  if (skeleton) {
    const mapped = coverage.length;
    if (mapped === 0) issues.push({ id, severity: "error", message: "clip has no tracks that map to target skeleton" });
  }
  issues.push(...inspectRequiredCoverage(entry, coverage, skeleton));
  return issues;
}

const LOOP_ENDPOINT_WARNING_PREFIX = "loop endpoints differ; crossfade or seam blending is required";

function inspectLoopEndpointMismatches(
  entry: AnimationManifestEntry,
  clip: AnimationClip,
  skeleton?: Skeleton
): AnimationAssetValidationIssue[] {
  const issues: AnimationAssetValidationIssue[] = [];
  const id = readEntryId(entry);
  const playbackWindow = resolveManifestPlaybackWindow(entry, clip);
  if (!playbackWindow) return issues;
  for (let index = 0; index < clip.tracks.length; index += 1) {
    const track = clip.tracks[index]!;
    if (!isRecord(track) || !(track.times instanceof Float32Array) || !(track.values instanceof Float32Array)) continue;
    if (track.times.length < 2) continue;
    const property = normalizedTrackProperty(track.property);
    if (!property) continue;
    const stride = trackStride(property);
    if (track.values.length !== track.times.length * stride) continue;
    const startSample = sampleTrack(track, playbackWindow.start);
    const endSample = sampleTrack(track, playbackWindow.end);
    const tolerance = property === "rotation" ? 0.24 : 0.18;
    const delta =
      property === "rotation"
        ? rotationEndpointDelta(startSample, endSample)
        : vectorEndpointDelta(startSample, endSample, stride);
    if (!Number.isFinite(delta) || delta <= tolerance) continue;
    const joint = resolveLoopEndpointJoint(track, skeleton);
    issues.push({
      id,
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
    if (!isRecord(track)) continue;
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

function inspectRequiredCoverage(
  entry: AnimationManifestEntry,
  coverage: readonly string[],
  skeleton?: Skeleton
): AnimationAssetValidationIssue[] {
  if (manifestRequiredCoverageIssue(entry)) return [];
  const required = readRequiredAnimationCoverage(entry);
  const issues: AnimationAssetValidationIssue[] = [];
  const id = readEntryId(entry);
  if (required.requiredHumanBones.length === 0 && required.requiredJoints.length === 0) return issues;
  const covered = new Set(coverage);
  for (const bone of required.requiredHumanBones) {
    if (covered.has(bone)) continue;
    issues.push({
      id,
      severity: "error",
      joint: bone,
      message: `required humanoid bone ${bone} is not covered by resolved target skeleton tracks`
    });
  }
  for (const joint of required.requiredJoints) {
    const coverageName = resolveRequiredJointCoverageName(joint, skeleton);
    if (coverageName && covered.has(coverageName)) continue;
    issues.push({
      id,
      severity: "error",
      joint,
      message: `required joint ${joint} is not covered by resolved target skeleton tracks`
    });
  }
  return issues;
}

function resolveRequiredJointCoverageName(joint: string, skeleton?: Skeleton): string | null {
  if (!skeleton) return joint;
  const directIndex = skeleton.nameToIndex.get(joint);
  if (directIndex !== undefined) return skeleton.joints[directIndex]!.humanoid ?? skeleton.joints[directIndex]!.name;
  const resolvedIndex = resolveJointIndex(skeleton, joint);
  if (resolvedIndex >= 0) return skeleton.joints[resolvedIndex]!.humanoid ?? skeleton.joints[resolvedIndex]!.name;
  return null;
}

function toAssetIssue(id: string, issue: ClipValidationIssue): AnimationAssetValidationIssue {
  return {
    id,
    severity: "error",
    message: issue.message,
    ...(issue.track === undefined ? {} : { track: issue.track }),
    ...(issue.joint === undefined ? {} : { joint: issue.joint }),
    ...(issue.property === undefined ? {} : { property: issue.property })
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
  const clips = readManifestAssetEntries(manifest) ?? [];
  const duplicateIds = duplicatedManifestIds(clips);
  const issues = new Map<number, AnimationAssetValidationIssue[]>();
  for (let index = 0; index < clips.length; index += 1) {
    const entry = clips[index]!;
    const entryIssues = inspectManifestEntryStructure(entry);
    const id = isRecord(entry) ? readOwnString(entry, "id") : null;
    if (id && duplicateIds.has(id)) {
      entryIssues.push({ id, severity: "error", message: `duplicate clip id ${id}` });
    }
    if (entryIssues.length > 0) issues.set(index, entryIssues);
  }
  return issues;
}

function inspectManifestEntryStructure(entry: AnimationManifestEntry): AnimationAssetValidationIssue[] {
  if (!isRecord(entry)) return [{ id: "<unknown>", severity: "error", message: "manifest entry must be an object" }];
  const id = readEntryId(entry);
  const issues: AnimationAssetValidationIssue[] = [];
  if (!readOwnString(entry, "id")) issues.push({ id, severity: "error", message: "manifest entry is missing id" });
  if (!readOwnString(entry, "url")) issues.push({ id, severity: "error", message: `${id} is missing url` });
  const metadataIssue = manifestEntryMetadataIssue(entry);
  if (metadataIssue) issues.push({ id, severity: "error", message: metadataIssue });
  const format = ownValue(entry, "format");
  if (format !== WAIFU_ANIMATION_BINARY_FORMAT) {
    issues.push({ id, severity: "error", message: `${id} has unsupported format ${formatUnknownValue(format)}` });
  }
  const validationStatus = readValidationStatus(entry);
  if (isInvalidAssetValidationStatus(validationStatus)) {
    issues.push({
      id,
      severity: "error",
      message: `invalid validation status ${formatUnknownValue(validationStatus)}`
    });
  }
  if (validationStatus === "accepted" && readValidationReason(entry) !== undefined) {
    issues.push({ id, severity: "error", message: `${id} is accepted but still has rejection reason` });
  }
  const rootMotionPolicyIssue = manifestRootMotionPolicyIssue(entry);
  if (rootMotionPolicyIssue) issues.push({ id, severity: "error", message: rootMotionPolicyIssue });
  const requiredCoverageIssue = manifestRequiredCoverageIssue(entry);
  if (requiredCoverageIssue) issues.push({ id, severity: "error", message: requiredCoverageIssue });
  return issues;
}

function inspectManifestValidationStatusIssues(
  entry: AnimationManifestEntry,
  status: "rejected" | "quarantined"
): AnimationAssetValidationIssue[] {
  const id = readEntryId(entry);
  const issues: AnimationAssetValidationIssue[] = [
    { id, severity: "error", message: readValidationReason(entry) ?? `manifest marks clip ${status}` }
  ];
  for (const issue of readValidationIssues(entry)) {
    issues.push({ id, severity: "error", message: issue });
  }
  return issues;
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

function buildRejectedEntry(
  entry: AnimationManifestEntry,
  issues: AnimationAssetValidationIssue[],
  status: Exclude<AssetValidationStatus, "accepted"> = "rejected"
): AnimationAssetValidationEntry {
  const safeEntry = isRecord(entry) ? entry : {};
  const metadataEntry = isRecord(entry) ? entry : manifestEntry("<unknown>", "", "");
  return {
    id: isRecord(safeEntry) ? readEntryId(safeEntry as AnimationManifestEntry) : "<unknown>",
    label: isRecord(safeEntry) ? (readOwnString(safeEntry, "label") ?? "") : "",
    url: isRecord(safeEntry) ? (readOwnString(safeEntry, "url") ?? "") : "",
    accepted: false,
    status,
    duration: 0,
    loop: isRecord(safeEntry) && ownValue(safeEntry, "loop") === true,
    ...assetReportMetadata(metadataEntry),
    compatibleStates: isRecord(safeEntry) ? readStringArray(ownValue(safeEntry, "states")) : [],
    jointCoverage: [],
    trackCount: 0,
    issues
  };
}

function classifyCategory(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  const text = manifestEntrySearchText(entry, clip);
  if (/walk|run|jog|turn|locomotion/.test(text)) return "locomotion";
  if (/sit|chair/.test(text)) return "sitting";
  if (/stretch/.test(text)) return "stretching";
  if (/gesture|wave|shrug|explain|clap/.test(text)) return "gesture";
  if (/idle|conversation|listen/.test(text)) return "idle";
  return "uncategorized";
}

function classifyPosture(entry: AnimationManifestEntry): string {
  const text = manifestEntrySearchText(entry);
  if (/sit|chair/.test(text)) return "sitting";
  if (/crouch/.test(text)) return "crouching";
  return "standing";
}

function manifestEntrySearchText(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  return `${readOwnString(entry, "id") ?? ""} ${readOwnString(entry, "label") ?? ""} ${readStringArray(ownValue(entry, "tags")).join(" ")} ${readString(clip?.name) ?? ""}`.toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_MANIFEST_STRING_LENGTH
    ? value
    : null;
}

function readEntryId(entry: AnimationManifestEntry): string {
  return readOwnString(entry, "id") ?? "<unknown>";
}

function readEntryUrl(entry: AnimationManifestEntry): string {
  return readOwnString(entry, "url") ?? "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_MANIFEST_STRING_ARRAY_LENGTH || !isDenseArray(value)) return [];
  return value.filter((item): item is string => readString(item) !== null);
}

function assetReportMetadata(
  entry: AnimationManifestEntry,
  clip?: AnimationClip
): Pick<
  AnimationAssetValidationEntry,
  | "category"
  | "posture"
  | "rootMotionPolicy"
  | "rootMotionProvenance"
  | "rootCarrierTranslationTrackCount"
  | "movingRootCarrierTranslationTrackCount"
> {
  const carrierSummary = clip ? rootCarrierTranslationSummary(entry, clip) : { total: 0, moving: 0 };
  const source = ownValue(entry, "source");
  const sourceRecord = isRecord(source) ? source : undefined;
  return {
    category:
      readString(sourceRecord ? ownValue(sourceRecord, "category") : undefined) ?? classifyCategory(entry, clip),
    posture: readString(sourceRecord ? ownValue(sourceRecord, "posture") : undefined) ?? classifyPosture(entry),
    rootMotionPolicy: readRootMotionPolicyLabel(entry, clip),
    rootMotionProvenance: readRootMotionProvenance(entry, clip),
    rootCarrierTranslationTrackCount: carrierSummary.total,
    movingRootCarrierTranslationTrackCount: carrierSummary.moving
  };
}

function readRootMotionPolicyLabel(entry: AnimationManifestEntry, clip?: AnimationClip): string {
  return readRootMotionPolicy(entry, clip) ?? "none";
}

function rootCarrierTranslationSummary(
  entry: AnimationManifestEntry,
  clip: AnimationClip
): { total: number; moving: number } {
  const playbackWindow = resolveManifestPlaybackWindow(entry, clip);
  let total = 0;
  let moving = 0;
  for (const track of clip.tracks) {
    if (!isRootCarrierTranslationTrack(track)) continue;
    total += 1;
    if (playbackWindow && rootCarrierTranslationTrackHasMotion(track, playbackWindow)) moving += 1;
  }
  return { total, moving };
}

function buildValidationReport(
  entries: AnimationAssetValidationEntry[],
  now: Date | undefined
): AnimationAssetValidationReport {
  const statusCounts = countValidationStatuses(entries);
  return {
    generatedAt: (now ?? new Date()).toISOString(),
    total: entries.length,
    accepted: statusCounts.accepted,
    rejected: statusCounts.rejected,
    quarantined: statusCounts.quarantined,
    entries
  };
}

function manifestEntry(id: string, label: string, url: string): AnimationManifestEntry {
  return { id, label, url, format: WAIFU_ANIMATION_BINARY_FORMAT };
}

function readManifestAssetEntries(manifest: AnimationManifest): AnimationManifestEntry[] | null {
  if (!isRecord(manifest)) return null;
  const clips = ownValue(manifest, "clips");
  return Array.isArray(clips) && clips.length <= MAX_MANIFEST_CLIPS_PER_MANIFEST && isDenseArray(clips)
    ? (clips as AnimationManifestEntry[])
    : null;
}

function isInspectableAnimationClip(value: unknown): value is AnimationClip {
  if (!isRecord(value)) return false;
  const clip = value as Partial<AnimationClip>;
  return (
    typeof clip.id === "string" &&
    (clip.name === undefined || typeof clip.name === "string") &&
    typeof clip.duration === "number" &&
    Number.isFinite(clip.duration) &&
    clip.duration > 0 &&
    Array.isArray(clip.tracks)
  );
}

function isInspectableManifestEntry(value: unknown): value is AnimationManifestEntry {
  if (!isRecord(value)) return false;
  const id = ownValue(value, "id");
  const label = ownValue(value, "label");
  const url = ownValue(value, "url");
  return (
    (id === undefined || typeof id === "string") &&
    (label === undefined || typeof label === "string") &&
    (url === undefined || typeof url === "string")
  );
}

const MAX_MANIFEST_STRING_LENGTH = 4_096;
const MAX_MANIFEST_STRING_ARRAY_LENGTH = 1_024;

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function ownValue(value: object, field: string): unknown {
  return hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined;
}

function readOwnString(value: object, field: string): string | null {
  return readString(ownValue(value, field));
}

function readValidationStatus(entry: AnimationManifestEntry): unknown {
  const validation = ownValue(entry, "validation");
  return isRecord(validation) ? ownValue(validation, "status") : undefined;
}

function readValidationReason(entry: AnimationManifestEntry): string | null {
  const validation = ownValue(entry, "validation");
  return isRecord(validation) ? readString(ownValue(validation, "reason")) : null;
}

function readValidationIssues(entry: AnimationManifestEntry): string[] {
  const validation = ownValue(entry, "validation");
  if (!isRecord(validation)) return [];
  const issues = ownValue(validation, "issues");
  return readStringArray(issues);
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value.length <= MAX_MANIFEST_STRING_LENGTH ? value : `${value.slice(0, 512)}…`;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol()";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[array length ${value.length}]`;
  return Object.prototype.toString.call(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}
