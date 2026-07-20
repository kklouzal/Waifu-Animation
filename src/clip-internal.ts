import {
  type Quat,
  type Vec3,
  EPSILON,
  ONE_VEC3,
  cloneNormalizedQuat,
  cloneQuat,
  cloneVec3,
  clamp,
  multiplyQuat,
  normalizeQuat
} from "./math.js";
import { retargetQuaternionSample } from "./retargeting.js";
import type {
  AnimationClip,
  AnimationTrack,
  ClipValidationIssue,
  NormalizedTrackProperty,
  SampleOptions,
  SampleRepairDiagnostic,
  TrackProperty
} from "./clip-types.js";
import { type Skeleton, isHumanoidBoneName, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

export type {
  AnimationClip,
  AnimationTrack,
  ClipValidationIssue,
  NormalizedTrackProperty,
  RotationSpace,
  SampleOptions,
  SampleRatioOptions,
  SampleRepairDiagnostic,
  TrackProperty
} from "./clip-types.js";

export const SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;
export const ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;

export type QuaternionNormalizationMessages = {
  finite: string;
  normalizable: string;
  normalized: string;
};

export type QuaternionNormalizationIssue = {
  kind: keyof QuaternionNormalizationMessages;
  message: string;
};

export function formatClipIssue(issue: ClipValidationIssue): string {
  const pieces: string[] = [];
  if (issue.track !== undefined) pieces.push(`track ${issue.track}`);
  if (issue.index !== undefined) pieces.push(`index ${issue.index}`);
  if (issue.joint) pieces.push(issue.joint);
  if (issue.property) pieces.push(issue.property);
  pieces.push(issue.message);
  return pieces.join(" ");
}

export function validateClip(clip: AnimationClip, skeleton?: Skeleton): ClipValidationIssue[] {
  const issues: ClipValidationIssue[] = [];
  if (!isAnimationClipObject(clip)) {
    issues.push({ message: "animation clip must be an object" });
    return issues;
  }
  const candidate = clip as Partial<AnimationClip>;
  const tracks = Array.isArray(candidate.tracks) ? candidate.tracks : null;
  const duration = typeof candidate.duration === "number" ? candidate.duration : Number.NaN;
  const durationValid = Number.isFinite(duration) && duration > 0;
  const resolvedChannels = new Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>();
  if (typeof candidate.id !== "string" || candidate.id.length === 0) issues.push({ message: "clip id is required" });
  if (candidate.name !== undefined && typeof candidate.name !== "string")
    issues.push({ message: "clip name must be a string" });
  if (!durationValid) issues.push({ message: "clip duration must be positive and finite" });
  if (candidate.loop !== undefined && typeof candidate.loop !== "boolean")
    issues.push({ message: "clip loop must be a boolean" });
  if (!tracks) {
    issues.push({ message: "clip tracks must be an array" });
    return issues;
  }
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index] as Partial<AnimationTrack> | undefined;
    if (!isAnimationTrackObject(track)) {
      issues.push({ track: index, message: "animation track must be an object" });
      continue;
    }
    const property = normalizedTrackProperty(track.property);
    const hasJoint = track.joint !== undefined;
    const hasHumanBone = track.humanBone !== undefined;
    const targetName = String(track.joint ?? track.humanBone ?? "");
    let targetValid = true;
    if (!property) {
      issues.push({
        track: index,
        joint: targetName,
        property: String(track.property),
        message: "track property is unsupported"
      });
      continue;
    }
    const stride = trackStride(property);
    if (!hasJoint && !hasHumanBone) {
      issues.push({ track: index, property: track.property, message: "track needs joint or humanBone" });
      targetValid = false;
    } else if (hasJoint && hasHumanBone) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track needs exactly one joint or humanBone target"
      });
      targetValid = false;
    } else if (hasJoint && (typeof track.joint !== "string" || track.joint.length === 0)) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track joint target must be a non-empty string"
      });
      targetValid = false;
    } else if (hasHumanBone && (typeof track.humanBone !== "string" || track.humanBone.length === 0)) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track humanBone target must be a non-empty string"
      });
      targetValid = false;
    } else if (track.humanBone !== undefined && !isHumanoidBoneName(track.humanBone)) {
      issues.push({
        track: index,
        joint: String(track.humanBone),
        property: track.property,
        message: "track has unknown humanoid bone"
      });
      targetValid = false;
    }
    const jointIndex = skeleton && targetValid ? resolveTrackJointIndex(skeleton, track) : -1;
    if (skeleton && targetValid && jointIndex < 0) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track does not map to skeleton"
      });
    }
    validateRotationSpace(issues, track, index, targetName, property);
    validateSourceRestQuaternion(issues, track, index, targetName, property);
    validateSourceRestChildDirection(issues, track, index, targetName, property);
    const channel = targetValid ? resolvedTrackChannel(skeleton, track, jointIndex, property) : null;
    if (channel) {
      const existing = resolvedChannels.get(channel.key);
      if (existing) {
        issues.push({
          track: index,
          joint: channel.joint,
          property: track.property,
          message: `duplicate target channel ${channel.joint}.${property} conflicts with track ${existing.track} (${existing.joint}.${existing.property})`
        });
      } else {
        resolvedChannels.set(channel.key, { track: index, joint: channel.joint, property });
      }
    }
    const hasRuntimeTimes = track.times instanceof Float32Array;
    const hasRuntimeValues = track.values instanceof Float32Array;
    if (!hasRuntimeTimes) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track times must be a Float32Array"
      });
    }
    if (!hasRuntimeValues) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track values must be a Float32Array"
      });
    }
    if (!hasRuntimeTimes || !hasRuntimeValues) continue;
    if (track.times.length < 1)
      issues.push({ track: index, joint: targetName, property: track.property, message: "track has no times" });
    if (track.values.length !== track.times.length * stride) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track value count does not match times and stride"
      });
    }
    for (let i = 0; i < track.times.length; i += 1) {
      const time = track.times[i]!;
      if (!Number.isFinite(time)) {
        issues.push({ track: index, joint: targetName, property: track.property, message: "track time is not finite" });
      } else if (time < 0 || (durationValid && time > duration)) {
        issues.push({
          track: index,
          joint: targetName,
          property: track.property,
          message: "track time must be within clip duration"
        });
      }
      if (i > 0 && time <= track.times[i - 1]!) {
        issues.push({
          track: index,
          joint: targetName,
          property: track.property,
          message: "track times must be sorted"
        });
      }
    }
    if (hasNonFiniteTrackValue(track.values)) {
      issues.push({
        track: index,
        joint: targetName,
        property: track.property,
        message: "track values must be finite"
      });
    }
    validateRotationTrackQuaternions(issues, track, index, targetName, property);
  }
  return issues;
}

function isAnimationClipObject(value: unknown): value is AnimationClip {
  return typeof value === "object" && value !== null;
}

function isAnimationTrackObject(value: unknown): value is AnimationTrack {
  return typeof value === "object" && value !== null;
}

function hasNonFiniteTrackValue(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return true;
  }
  return false;
}

function validateRotationSpace(
  issues: ClipValidationIssue[],
  track: AnimationTrack,
  index: number,
  jointName: string,
  property: NormalizedTrackProperty
): void {
  if (track.rotationSpace === undefined) return;
  if (property !== "rotation") {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "rotationSpace is only valid on rotation tracks"
    });
    return;
  }
  if (track.rotationSpace !== "local-source" && track.rotationSpace !== "normalized-humanoid-delta") {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "rotationSpace must be local-source or normalized-humanoid-delta"
    });
  }
}

function validateSourceRestChildDirection(
  issues: ClipValidationIssue[],
  track: AnimationTrack,
  index: number,
  jointName: string,
  property: NormalizedTrackProperty
): void {
  const direction = track.sourceRestChildDirection;
  if (!direction) return;
  if (property !== "rotation") {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "sourceRestChildDirection is only valid on rotation tracks"
    });
    return;
  }
  if (direction.length !== 3) {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "sourceRestChildDirection must contain exactly 3 values"
    });
    return;
  }
  if (!Array.from(direction).every(Number.isFinite)) {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "sourceRestChildDirection values must be finite"
    });
    return;
  }
  if (Math.hypot(direction[0]!, direction[1]!, direction[2]!) <= EPSILON) {
    issues.push({
      track: index,
      joint: jointName,
      property: track.property,
      message: "sourceRestChildDirection must be normalizable"
    });
  }
}

function validateRotationTrackQuaternions(
  issues: ClipValidationIssue[],
  track: AnimationTrack,
  index: number,
  joint: string,
  property: NormalizedTrackProperty
): void {
  if (property !== "rotation") return;
  if (track.values.some((value) => !Number.isFinite(value))) return;
  let reportedNonNormalizable = false;
  let reportedNonNormalized = false;
  const sampleCount = Math.floor(track.values.length / 4);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const offset = sample * 4;
    const issue = quaternionNormalizationIssue(
      [track.values[offset]!, track.values[offset + 1]!, track.values[offset + 2]!, track.values[offset + 3]!],
      ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE,
      {
        finite: "rotation track quaternions must be finite",
        normalizable: "rotation track quaternions must be normalizable",
        normalized: "rotation track quaternions must be normalized"
      }
    );
    if (issue?.kind === "normalizable") {
      if (!reportedNonNormalizable) {
        issues.push({ track: index, joint, property: track.property, message: issue.message });
        reportedNonNormalizable = true;
      }
      continue;
    }
    if (issue?.kind === "normalized" && !reportedNonNormalized) {
      issues.push({ track: index, joint, property: track.property, message: issue.message });
      reportedNonNormalized = true;
    }
    if (reportedNonNormalizable && reportedNonNormalized) return;
  }
}

function validateSourceRestQuaternion(
  issues: ClipValidationIssue[],
  track: AnimationTrack,
  index: number,
  joint: string,
  property: NormalizedTrackProperty
): void {
  const sourceRest = track.sourceRestQuaternion;
  if (!sourceRest) return;
  if (property !== "rotation") {
    issues.push({
      track: index,
      joint,
      property: track.property,
      message: "sourceRestQuaternion is only valid on rotation tracks"
    });
  }
  if (sourceRest.length !== 4) {
    issues.push({
      track: index,
      joint,
      property: track.property,
      message: "sourceRestQuaternion must contain exactly 4 values"
    });
    return;
  }
  const issue = quaternionNormalizationIssue(sourceRest, SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE, {
    finite: "sourceRestQuaternion values must be finite",
    normalizable: "sourceRestQuaternion must be normalizable",
    normalized: "sourceRestQuaternion must be normalized"
  });
  if (issue) {
    issues.push({ track: index, joint, property: track.property, message: issue.message });
  }
}

function resolvedTrackChannel(
  skeleton: Skeleton | undefined,
  track: AnimationTrack,
  jointIndex: number,
  property: NormalizedTrackProperty
): { key: string; joint: string } | null {
  const jointName = track.joint ?? track.humanBone;
  if (!jointName) return null;
  if (skeleton) {
    if (jointIndex < 0) return null;
    const joint = skeleton.joints[jointIndex]!;
    return { key: `${jointIndex}:${property}`, joint: `${joint.name}[${jointIndex}]` };
  }
  const targetKind = track.joint !== undefined ? "joint" : "humanBone";
  return { key: `${targetKind}:${String(jointName)}:${property}`, joint: String(jointName) };
}

export function trackStride(property: string): 3 | 4 {
  const normalized = normalizedTrackProperty(property);
  if (!normalized) throw new Error(`unsupported animation track property ${String(property)}`);
  return normalized === "rotation" ? 4 : 3;
}

export function normalizedTrackProperty(property: string): NormalizedTrackProperty | null {
  if (property === "quaternion") return "rotation";
  if (property === "position") return "translation";
  if (property === "translation" || property === "rotation" || property === "scale") return property;
  return null;
}

export function resolveTrackJointIndex(skeleton: Skeleton, track: AnimationTrack): number {
  if (track.joint) return resolveJointIndex(skeleton, track.joint);
  if (track.humanBone && isHumanoidBoneName(track.humanBone)) return resolveHumanoidIndex(skeleton, track.humanBone);
  return -1;
}

export type TrackMetadataForSampling = {
  property: TrackProperty;
  joint?: string;
  humanBone?: string;
  rotationSpace?: string;
  sourceRestQuaternion?: ArrayLike<number>;
  sourceRestChildDirection?: ArrayLike<number>;
};

export function isNormalizedHumanoidDeltaRotationTrack(track: { rotationSpace?: string }): boolean {
  return track.rotationSpace === "normalized-humanoid-delta";
}

export function retargetSampledRotation(
  track: TrackMetadataForSampling,
  targetRest: Quat | undefined,
  sampled: Quat,
  jointIndex: number,
  options: SampleOptions,
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">
): Quat {
  if (isNormalizedHumanoidDeltaRotationTrack(track)) {
    const delta = cloneNormalizedQuat(sampled);
    return targetRest ? normalizeQuat(multiplyQuat(delta, targetRest)) : delta;
  }
  const sourceRest = track.sourceRestQuaternion;
  if (!sourceRest || !targetRest) return sampled;
  if (sourceRest.length !== 4) {
    options.diagnostics?.push({
      ...diagnosticContext,
      property: track.property,
      message: "sourceRestQuaternion was ignored because it does not contain exactly 4 values"
    });
    return sampled;
  }
  pushSourceRestRepairDiagnostic(options.diagnostics, diagnosticContext, track, sourceRest);
  const boneName = String(track.humanBone ?? track.joint ?? "");
  return retargetQuaternionSample(
    cloneNormalizedQuat(sourceRest),
    targetRest,
    sampled,
    boneName,
    options.sourceBasisQuaternion?.(boneName, jointIndex) ?? undefined,
    readTrackSourceRestChildDirection(track),
    options.targetRestChildDirection?.(boneName, jointIndex) ?? undefined
  );
}

function readTrackSourceRestChildDirection(track: TrackMetadataForSampling): Vec3 | undefined {
  const direction = track.sourceRestChildDirection;
  if (!direction || direction.length !== 3) return undefined;
  return cloneVec3(direction);
}

export function defaultTrackSample(property: NormalizedTrackProperty): number[] {
  if (property === "rotation") return cloneQuat(undefined);
  if (property === "scale") return cloneVec3(ONE_VEC3);
  return cloneVec3(undefined);
}

export function rotationSampleFallback(track: TrackMetadataForSampling): Quat {
  if (isNormalizedHumanoidDeltaRotationTrack(track)) return cloneQuat(undefined);
  return track.sourceRestQuaternion?.length === 4
    ? cloneNormalizedQuat(track.sourceRestQuaternion)
    : cloneQuat(undefined);
}

export function pushRotationSampleRepairDiagnostic(
  diagnostics: SampleRepairDiagnostic[] | undefined,
  diagnosticContext: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> | undefined,
  track: TrackMetadataForSampling,
  value: Quat,
  sample: number
): void {
  if (!diagnostics) return;
  const message = quaternionRepairMessage(value, "rotation track quaternion");
  if (!message) return;
  diagnostics.push({ ...diagnosticContext, property: track.property, sample, message });
}

export function repairVec3Sample(
  track: TrackMetadataForSampling,
  values: [number, number, number],
  fallback: [number, number, number],
  sample: number,
  diagnostics: SampleRepairDiagnostic[] | undefined,
  diagnosticContext: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> | undefined
): [number, number, number] {
  let repaired = false;
  const output = values.map((value, index) => {
    if (Number.isFinite(value)) return value;
    repaired = true;
    return fallback[index]!;
  }) as [number, number, number];
  if (repaired) {
    diagnostics?.push({
      ...diagnosticContext,
      property: track.property,
      sample,
      message: `${track.property} track sample values were repaired to finite defaults`
    });
  }
  return output;
}

function pushSourceRestRepairDiagnostic(
  diagnostics: SampleRepairDiagnostic[] | undefined,
  diagnosticContext: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> | undefined,
  track: TrackMetadataForSampling,
  sourceRest: ArrayLike<number>
): void {
  if (!diagnostics) return;
  const message = quaternionRepairMessage(cloneQuat(sourceRest), "sourceRestQuaternion");
  if (!message) return;
  diagnostics.push({ ...diagnosticContext, property: track.property, message });
}

function quaternionRepairMessage(value: Quat, label: string): string | null {
  return (
    quaternionNormalizationIssue(value, ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE, {
      finite: `${label} values were repaired to finite defaults`,
      normalizable: `${label} was repaired to a normalizable fallback`,
      normalized: `${label} was normalized during sampling`
    })?.message ?? null
  );
}

export function quaternionNormalizationIssue(
  value: ArrayLike<number>,
  lengthSquaredTolerance: number,
  messages: QuaternionNormalizationMessages
): QuaternionNormalizationIssue | null {
  for (let component = 0; component < 4; component += 1) {
    if (!Number.isFinite(value[component])) return { kind: "finite", message: messages.finite };
  }
  const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (!Number.isFinite(length) || length <= EPSILON) return { kind: "normalizable", message: messages.normalizable };
  const lengthSquared = length * length;
  if (Math.abs(lengthSquared - 1) > lengthSquaredTolerance) return { kind: "normalized", message: messages.normalized };
  return null;
}

export function readClipTimeRatio(clip: AnimationClip, time: number): number {
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) return 0;
  return clamp(Number.isFinite(time) ? time / clip.duration : 0, 0, 1);
}

export function readTrackTargetKey(
  track: AnimationTrack,
  skeleton: Skeleton | undefined,
  jointIndex: number
): string | null {
  if (skeleton) return jointIndex >= 0 ? String(jointIndex) : null;
  if (track.joint !== undefined) return `joint:${track.joint}`;
  if (track.humanBone !== undefined) return `humanBone:${track.humanBone}`;
  return null;
}
