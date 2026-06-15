import { type Quat, type Transform, EPSILON, ONE_VEC3, cloneQuat, cloneTransform, cloneVec3, clamp, ensureShortestQuat, euclideanModulo, lerpVec3, normalizeQuat, slerpQuat } from "./math.js";
import { type Pose, clonePose } from "./pose.js";
import { retargetQuaternionSample } from "./retargeting.js";
import { type HumanoidBoneName, type Skeleton, createRestPose, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

export type TrackProperty = "translation" | "rotation" | "scale" | "position" | "quaternion";
export type NormalizedTrackProperty = "translation" | "rotation" | "scale";

export type AnimationTrack = {
  joint?: string;
  humanBone?: HumanoidBoneName | string;
  property: TrackProperty;
  times: Float32Array;
  values: Float32Array;
  sourceRestQuaternion?: Float32Array;
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
};

const SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;
const ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;

export function validateClip(clip: AnimationClip, skeleton?: Skeleton): ClipValidationIssue[] {
  const issues: ClipValidationIssue[] = [];
  const resolvedChannels = new Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>();
  if (!clip.id) issues.push({ message: "clip id is required" });
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) issues.push({ message: "clip duration must be positive and finite" });
  for (let index = 0; index < clip.tracks.length; index += 1) {
    const track = clip.tracks[index]!;
    const jointName = track.joint ?? track.humanBone;
    const property = normalizedTrackProperty(track.property);
    if (!property) {
      issues.push({ track: index, joint: String(jointName ?? ""), property: String(track.property), message: "track property is unsupported" });
      continue;
    }
    const stride = trackStride(property);
    if (!jointName) issues.push({ track: index, property: track.property, message: "track needs joint or humanBone" });
    const jointIndex = skeleton && jointName ? resolveTrackJointIndex(skeleton, track) : -1;
    if (skeleton && jointName && jointIndex < 0) {
      issues.push({ track: index, joint: String(jointName), property: track.property, message: "track does not map to skeleton" });
    }
    validateSourceRestQuaternion(issues, track, index, String(jointName ?? ""), property);
    const channel = resolvedTrackChannel(skeleton, track, jointIndex, property);
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
    if (track.times.length < 1) issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track has no times" });
    if (track.values.length !== track.times.length * stride) {
      issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track value count does not match times and stride" });
    }
    for (let i = 0; i < track.times.length; i += 1) {
      const time = track.times[i]!;
      if (!Number.isFinite(time)) {
        issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track time is not finite" });
      } else if (time < 0 || time > clip.duration) {
        issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track time must be within clip duration" });
      }
      if (i > 0 && time <= track.times[i - 1]!) {
        issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track times must be sorted" });
      }
    }
    if (track.values.some((value) => !Number.isFinite(value))) {
      issues.push({ track: index, joint: String(jointName ?? ""), property: track.property, message: "track values must be finite" });
    }
    validateRotationTrackQuaternions(issues, track, index, String(jointName ?? ""), property);
  }
  return issues;
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
    const length = Math.hypot(track.values[offset]!, track.values[offset + 1]!, track.values[offset + 2]!, track.values[offset + 3]!);
    if (length <= EPSILON) {
      if (!reportedNonNormalizable) {
        issues.push({ track: index, joint, property: track.property, message: "rotation track quaternions must be normalizable" });
        reportedNonNormalizable = true;
      }
      continue;
    }
    const lengthSquared = length * length;
    if (Math.abs(lengthSquared - 1) > ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE && !reportedNonNormalized) {
      issues.push({ track: index, joint, property: track.property, message: "rotation track quaternions must be normalized" });
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
  for (let component = 0; component < sourceRest.length; component += 1) {
    if (!Number.isFinite(sourceRest[component])) {
      issues.push({ track: index, joint, property: track.property, message: "sourceRestQuaternion values must be finite" });
      return;
    }
  }
  const length = Math.hypot(sourceRest[0]!, sourceRest[1]!, sourceRest[2]!, sourceRest[3]!);
  if (length <= EPSILON) {
    issues.push({ track: index, joint, property: track.property, message: "sourceRestQuaternion must be normalizable" });
    return;
  }
  const lengthSquared = length * length;
  if (Math.abs(lengthSquared - 1) > SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE) {
    issues.push({ track: index, joint, property: track.property, message: "sourceRestQuaternion must be normalized" });
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

export function toFloat32Array(values: ArrayLike<number>): Float32Array {
  return values instanceof Float32Array ? values : Float32Array.from(values);
}

export function sanitizeQuaternionTrackValues(values: ArrayLike<number>): Float32Array {
  if (values.length % 4 !== 0) throw new Error("quaternion track values must be a multiple of 4");
  const output = new Float32Array(values.length);
  let previous: Quat = [0, 0, 0, 1];
  for (let i = 0; i < values.length; i += 4) {
    let current = normalizeQuat([values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, values[i + 3] ?? 1]);
    if (i > 0) current = ensureShortestQuat(previous, current);
    output.set(current, i);
    previous = current;
  }
  return output;
}

export function sampleClipToPose(skeleton: Skeleton, clip: AnimationClip, timeSeconds: number, options: SampleOptions = {}): Pose {
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = clonePose(restPose);
  const time = sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false);
  for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex += 1) {
    const track = clip.tracks[trackIndex]!;
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    if (jointIndex < 0) continue;
    const property = normalizedTrackProperty(track.property);
    if (!property) throw new Error(`unsupported animation track property ${String(track.property)}`);
    const diagnosticContext = { track: trackIndex, joint: skeleton.joints[jointIndex]?.name ?? String(track.joint ?? track.humanBone ?? ""), index: jointIndex };
    const sampled = options.diagnostics
      ? sampleTrack(track, time, { diagnostics: options.diagnostics, diagnosticContext })
      : sampleTrack(track, time, { diagnosticContext });
    const transform = cloneTransform(output[jointIndex]);
    if (property === "translation") transform.translation = sampled as [number, number, number];
    if (property === "scale") transform.scale = sampled as [number, number, number];
    if (property === "rotation") transform.rotation = retargetSampledRotation(track, restPose[jointIndex]?.rotation, sampled as Quat, options.diagnostics, diagnosticContext);
    output[jointIndex] = transform;
  }
  return output;
}

function retargetSampledRotation(
  track: AnimationTrack,
  targetRest: Quat | undefined,
  sampled: Quat,
  diagnostics?: SampleRepairDiagnostic[],
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">
): Quat {
  const sourceRest = track.sourceRestQuaternion;
  if (!sourceRest || !targetRest) return sampled;
  if (sourceRest.length !== 4) {
    diagnostics?.push({ ...diagnosticContext, property: track.property, message: "sourceRestQuaternion was ignored because it does not contain exactly 4 values" });
    return sampled;
  }
  pushSourceRestRepairDiagnostic(diagnostics, diagnosticContext, track, sourceRest);
  return retargetQuaternionSample(cloneQuat(sourceRest), targetRest, sampled);
}

export function sampleTime(clip: AnimationClip, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  if (loop && clip.duration > 0) {
    return euclideanModulo(timeSeconds, clip.duration);
  }
  return clamp(timeSeconds, 0, Math.max(0, clip.duration));
}

export function sampleTrack(track: AnimationTrack, timeSeconds: number, options: { diagnostics?: SampleRepairDiagnostic[]; diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> } = {}): number[] {
  const property = normalizedTrackProperty(track.property);
  if (!property) throw new Error(`unsupported animation track property ${String(track.property)}`);
  const stride = trackStride(property);
  if (track.times.length === 0) return defaultTrackSample(property);
  if (timeSeconds <= track.times[0]!) return readTrackValue(track, 0, stride, property, options.diagnostics, options.diagnosticContext);
  const last = track.times.length - 1;
  if (timeSeconds >= track.times[last]!) return readTrackValue(track, last, stride, property, options.diagnostics, options.diagnosticContext);
  let low = 1;
  let high = track.times.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (track.times[mid]! < timeSeconds) low = mid + 1;
    else high = mid;
  }
  const upper = low;
  const lower = upper - 1;
  const start = track.times[lower]!;
  const end = track.times[upper]!;
  const t = end > start ? (timeSeconds - start) / (end - start) : 0;
  const a = readTrackValue(track, lower, stride, property, options.diagnostics, options.diagnosticContext);
  const b = readTrackValue(track, upper, stride, property, options.diagnostics, options.diagnosticContext);
  if (stride === 4) return slerpQuat(a as Quat, b as Quat, t);
  return lerpVec3(a as [number, number, number], b as [number, number, number], t);
}

function defaultTrackSample(property: NormalizedTrackProperty): number[] {
  if (property === "rotation") return cloneQuat(undefined);
  if (property === "scale") return cloneVec3(ONE_VEC3);
  return cloneVec3(undefined);
}

function readTrackValue(
  track: AnimationTrack,
  keyIndex: number,
  stride: 3 | 4,
  property: NormalizedTrackProperty,
  diagnostics?: SampleRepairDiagnostic[],
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">
): number[] {
  const offset = keyIndex * stride;
  const fallback = defaultTrackSample(property);
  const values = fallback.map((value, index) => track.values[offset + index] ?? value);
  if (stride === 4) pushRotationSampleRepairDiagnostic(diagnostics, diagnosticContext, track, values as Quat, keyIndex);
  return stride === 4 ? normalizeQuat(values as Quat) : values;
}

function pushRotationSampleRepairDiagnostic(
  diagnostics: SampleRepairDiagnostic[] | undefined,
  diagnosticContext: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> | undefined,
  track: AnimationTrack,
  value: Quat,
  sample: number
): void {
  if (!diagnostics) return;
  const message = quaternionRepairMessage(value, "rotation track quaternion");
  if (!message) return;
  diagnostics.push({ ...diagnosticContext, property: track.property, sample, message });
}

function pushSourceRestRepairDiagnostic(
  diagnostics: SampleRepairDiagnostic[] | undefined,
  diagnosticContext: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> | undefined,
  track: AnimationTrack,
  sourceRest: Float32Array
): void {
  if (!diagnostics) return;
  const message = quaternionRepairMessage(cloneQuat(sourceRest), "sourceRestQuaternion");
  if (!message) return;
  diagnostics.push({ ...diagnosticContext, property: track.property, message });
}

function quaternionRepairMessage(value: Quat, label: string): string | null {
  if (!value.every(Number.isFinite)) return `${label} values were repaired to finite defaults`;
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(length) || length <= EPSILON) return `${label} was repaired to a normalizable fallback`;
  const lengthSquared = length * length;
  if (Math.abs(lengthSquared - 1) > ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE) return `${label} was normalized during sampling`;
  return null;
}
