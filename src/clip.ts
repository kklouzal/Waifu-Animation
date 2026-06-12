import { type Quat, type Transform, EPSILON, cloneTransform, clamp, lerpVec3, normalizeQuat, slerpQuat } from "./math.js";
import { type Pose, clonePose } from "./pose.js";
import { type HumanoidBoneName, type Skeleton, createRestPose, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

export type TrackProperty = "translation" | "rotation" | "scale" | "position" | "quaternion";

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
  property?: TrackProperty;
  message: string;
};

export type SampleOptions = {
  loop?: boolean;
  restPose?: readonly Transform[];
};

const SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;

export function validateClip(clip: AnimationClip, skeleton?: Skeleton): ClipValidationIssue[] {
  const issues: ClipValidationIssue[] = [];
  const resolvedChannels = new Map<string, { track: number; joint: string; property: ReturnType<typeof normalizedTrackProperty> }>();
  if (!clip.id) issues.push({ message: "clip id is required" });
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) issues.push({ message: "clip duration must be positive and finite" });
  for (let index = 0; index < clip.tracks.length; index += 1) {
    const track = clip.tracks[index]!;
    const stride = trackStride(track.property);
    const jointName = track.joint ?? track.humanBone;
    const property = normalizedTrackProperty(track.property);
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
  }
  return issues;
}

function validateSourceRestQuaternion(
  issues: ClipValidationIssue[],
  track: AnimationTrack,
  index: number,
  joint: string,
  property: ReturnType<typeof normalizedTrackProperty>
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
  property: ReturnType<typeof normalizedTrackProperty>
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

export function trackStride(property: TrackProperty): 3 | 4 {
  return property === "rotation" || property === "quaternion" ? 4 : 3;
}

export function normalizedTrackProperty(property: TrackProperty): "translation" | "rotation" | "scale" {
  if (property === "quaternion") return "rotation";
  if (property === "position") return "translation";
  return property;
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
    if (i > 0 && previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2] + previous[3] * current[3] < 0) {
      current = [-current[0], -current[1], -current[2], -current[3]];
    }
    output.set(current, i);
    previous = current;
  }
  return output;
}

export function sampleClipToPose(skeleton: Skeleton, clip: AnimationClip, timeSeconds: number, options: SampleOptions = {}): Pose {
  const output = clonePose(options.restPose ?? createRestPose(skeleton));
  const time = sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false);
  for (const track of clip.tracks) {
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    if (jointIndex < 0) continue;
    const property = normalizedTrackProperty(track.property);
    const sampled = sampleTrack(track, time);
    const transform = cloneTransform(output[jointIndex]);
    if (property === "translation") transform.translation = sampled as [number, number, number];
    if (property === "scale") transform.scale = sampled as [number, number, number];
    if (property === "rotation") transform.rotation = sampled as [number, number, number, number];
    output[jointIndex] = transform;
  }
  return output;
}

export function sampleTime(clip: AnimationClip, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  if (loop && clip.duration > 0) {
    return ((timeSeconds % clip.duration) + clip.duration) % clip.duration;
  }
  return clamp(timeSeconds, 0, Math.max(0, clip.duration));
}

export function sampleTrack(track: AnimationTrack, timeSeconds: number): number[] {
  const stride = trackStride(track.property);
  if (track.times.length === 0) return stride === 4 ? [0, 0, 0, 1] : [0, 0, 0];
  if (timeSeconds <= track.times[0]!) return readTrackValue(track, 0, stride);
  const last = track.times.length - 1;
  if (timeSeconds >= track.times[last]!) return readTrackValue(track, last, stride);
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
  const a = readTrackValue(track, lower, stride);
  const b = readTrackValue(track, upper, stride);
  if (stride === 4) return slerpQuat(a as Quat, b as Quat, t);
  return lerpVec3(a as [number, number, number], b as [number, number, number], t);
}

function readTrackValue(track: AnimationTrack, keyIndex: number, stride: 3 | 4): number[] {
  const offset = keyIndex * stride;
  const fallback = stride === 4 ? [0, 0, 0, 1] : [0, 0, 0];
  const values = fallback.map((value, index) => track.values[offset + index] ?? value);
  return stride === 4 ? normalizeQuat(values as Quat) : values;
}
