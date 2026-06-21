import { type Quat, type Transform, type Vec3, EPSILON, ONE_VEC3, cloneNormalizedQuat, cloneQuat, cloneVec3, clamp } from "./math.js";
import { retargetQuaternionSample } from "./retargeting.js";
import { type HumanoidBoneName, type Skeleton, isHumanoidBoneName, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

export type TrackProperty = "translation" | "rotation" | "scale" | "position" | "quaternion";
export type NormalizedTrackProperty = "translation" | "rotation" | "scale";

export type AnimationTrack = {
  joint?: string;
  humanBone?: HumanoidBoneName | string;
  property: TrackProperty;
  times: Float32Array;
  values: Float32Array;
  sourceRestQuaternion?: Float32Array;
  sourceRestChildDirection?: Float32Array;
};

export type AnimationClip = {
  id: string;
  name?: string;
  duration: number;
  loop?: boolean;
  tracks: AnimationTrack[];
  metadata?: Record<string, unknown>;
};

export type ClipValidationIssue = {
  track?: number;
  joint?: string;
  index?: number;
  property?: string;
  message: string;
};

export type SampleRepairDiagnostic = ClipValidationIssue & {
  sample?: number;
};

export type SampleOptions = {
  loop?: boolean;
  restPose?: readonly Transform[];
  diagnostics?: SampleRepairDiagnostic[];
  sourceBasisQuaternion?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
  targetRestChildDirection?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
  /** Skip structurally unsupported external channels after validation has reported them. */
  skipUnsupportedTracks?: boolean;
};

export type SampleRatioOptions = Omit<SampleOptions, "loop">;

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
  const resolvedChannels = new Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>();
  if (!clip.id) issues.push({ message: "clip id is required" });
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) issues.push({ message: "clip duration must be positive and finite" });
  for (let index = 0; index < clip.tracks.length; index += 1) {
    const track = clip.tracks[index]!;
    const property = normalizedTrackProperty(track.property);
    const hasJoint = track.joint !== undefined;
    const hasHumanBone = track.humanBone !== undefined;
    const targetName = String(track.joint ?? track.humanBone ?? "");
    let targetValid = true;
    if (!property) {
      issues.push({ track: index, joint: targetName, property: String(track.property), message: "track property is unsupported" });
      continue;
    }
    const stride = trackStride(property);
    if (!hasJoint && !hasHumanBone) {
      issues.push({ track: index, property: track.property, message: "track needs joint or humanBone" });
      targetValid = false;
    } else if (hasJoint && hasHumanBone) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track needs exactly one joint or humanBone target" });
      targetValid = false;
    } else if (hasJoint && (typeof track.joint !== "string" || track.joint.length === 0)) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track joint target must be a non-empty string" });
      targetValid = false;
    } else if (hasHumanBone && (typeof track.humanBone !== "string" || track.humanBone.length === 0)) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track humanBone target must be a non-empty string" });
      targetValid = false;
    } else if (track.humanBone !== undefined && !isHumanoidBoneName(track.humanBone)) {
      issues.push({ track: index, joint: String(track.humanBone), property: track.property, message: "track has unknown humanoid bone" });
      targetValid = false;
    }
    const jointIndex = skeleton && targetValid ? resolveTrackJointIndex(skeleton, track) : -1;
    if (skeleton && targetValid && jointIndex < 0) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track does not map to skeleton" });
    }
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
    if (track.times.length < 1) issues.push({ track: index, joint: targetName, property: track.property, message: "track has no times" });
    if (track.values.length !== track.times.length * stride) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track value count does not match times and stride" });
    }
    for (let i = 0; i < track.times.length; i += 1) {
      const time = track.times[i]!;
      if (!Number.isFinite(time)) {
        issues.push({ track: index, joint: targetName, property: track.property, message: "track time is not finite" });
      } else if (time < 0 || time > clip.duration) {
        issues.push({ track: index, joint: targetName, property: track.property, message: "track time must be within clip duration" });
      }
      if (i > 0 && time <= track.times[i - 1]!) {
        issues.push({ track: index, joint: targetName, property: track.property, message: "track times must be sorted" });
      }
    }
    if (track.values.some((value) => !Number.isFinite(value))) {
      issues.push({ track: index, joint: targetName, property: track.property, message: "track values must be finite" });
    }
    validateRotationTrackQuaternions(issues, track, index, targetName, property);
  }
  return issues;
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
    issues.push({ track: index, joint: jointName, property: track.property, message: "sourceRestChildDirection is only valid on rotation tracks" });
    return;
  }
  if (direction.length !== 3) {
    issues.push({ track: index, joint: jointName, property: track.property, message: "sourceRestChildDirection must contain exactly 3 values" });
    return;
  }
  if (!Array.from(direction).every(Number.isFinite)) {
    issues.push({ track: index, joint: jointName, property: track.property, message: "sourceRestChildDirection values must be finite" });
    return;
  }
  if (Math.hypot(direction[0]!, direction[1]!, direction[2]!) <= EPSILON) {
    issues.push({ track: index, joint: jointName, property: track.property, message: "sourceRestChildDirection must be normalizable" });
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
    issues.push({ track: index, joint, property: track.property, message: "sourceRestQuaternion is only valid on rotation tracks" });
  }
  if (sourceRest.length !== 4) {
    issues.push({ track: index, joint, property: track.property, message: "sourceRestQuaternion must contain exactly 4 values" });
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
  return { key: `${String(jointName)}:${property}`, joint: String(jointName) };
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
  if (track.humanBone) return resolveHumanoidIndex(skeleton, track.humanBone as HumanoidBoneName);
  return -1;
}

export type TrackMetadataForSampling = {
  property: TrackProperty;
  joint?: string;
  humanBone?: string;
  sourceRestQuaternion?: ArrayLike<number>;
  sourceRestChildDirection?: ArrayLike<number>;
};

export function retargetSampledRotation(
  track: TrackMetadataForSampling,
  targetRest: Quat | undefined,
  sampled: Quat,
  jointIndex: number,
  options: SampleOptions,
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">
): Quat {
  const sourceRest = track.sourceRestQuaternion;
  if (!sourceRest || !targetRest) return sampled;
  if (sourceRest.length !== 4) {
    options.diagnostics?.push({ ...diagnosticContext, property: track.property, message: "sourceRestQuaternion was ignored because it does not contain exactly 4 values" });
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
  return track.sourceRestQuaternion?.length === 4 ? cloneNormalizedQuat(track.sourceRestQuaternion) : cloneQuat(undefined);
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
    diagnostics?.push({ ...diagnosticContext, property: track.property, sample, message: `${track.property} track sample values were repaired to finite defaults` });
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
  return quaternionNormalizationIssue(value, ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE, {
    finite: `${label} values were repaired to finite defaults`,
    normalizable: `${label} was repaired to a normalizable fallback`,
    normalized: `${label} was normalized during sampling`
  })?.message ?? null;
}

export function quaternionNormalizationIssue(value: ArrayLike<number>, lengthSquaredTolerance: number, messages: QuaternionNormalizationMessages): QuaternionNormalizationIssue | null {
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

export function readTrackTargetKey(track: AnimationTrack, skeleton: Skeleton | undefined, jointIndex: number): string | null {
  if (skeleton) return jointIndex >= 0 ? String(jointIndex) : null;
  const joint = track.joint ?? track.humanBone;
  return joint === undefined ? null : String(joint);
}
