import { type Quat, type Transform, type Vec3, EPSILON, ONE_VEC3, cloneNormalizedQuat, cloneQuat, cloneTransform, cloneVec3, clamp, ensureShortestQuat, euclideanModulo, lerpVec3, normalizeQuat, slerpQuat } from "./math.js";
import { type Pose, readPoseTransformOrRest } from "./pose.js";
import { retargetQuaternionSample } from "./retargeting.js";
import { type HumanoidBoneName, type Skeleton, createRestPose, isHumanoidBoneName, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

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

export type RawAnimationVec3KeyDefinition = {
  time: number;
  value: ArrayLike<number>;
};

export type RawAnimationQuaternionKeyDefinition = {
  time: number;
  value: ArrayLike<number>;
};

export type RawAnimationVec3Key = {
  time: number;
  value: Vec3;
};

export type RawAnimationQuaternionKey = {
  time: number;
  value: Quat;
};

export type RawAnimationJointTrackDefinition = {
  joint?: string;
  humanBone?: HumanoidBoneName | string;
  translations?: readonly RawAnimationVec3KeyDefinition[];
  rotations?: readonly RawAnimationQuaternionKeyDefinition[];
  scales?: readonly RawAnimationVec3KeyDefinition[];
};

export type RawAnimationJointTrack = {
  joint?: string;
  humanBone?: HumanoidBoneName | string;
  translations: RawAnimationVec3Key[];
  rotations: RawAnimationQuaternionKey[];
  scales: RawAnimationVec3Key[];
};

export type RawAnimationDefinition = {
  id: string;
  name?: string;
  duration: number;
  loop?: boolean;
  tracks?: readonly RawAnimationJointTrackDefinition[];
  metadata?: Record<string, unknown>;
};

export type RawAnimation = {
  id: string;
  name?: string;
  duration: number;
  loop?: boolean;
  tracks: RawAnimationJointTrack[];
  metadata?: Record<string, unknown>;
};

export type ClipValidationIssue = {
  track?: number;
  joint?: string;
  index?: number;
  property?: string;
  message: string;
};

export type RawAnimationValidationIssue = {
  track?: number;
  key?: number;
  joint?: string;
  index?: number;
  property?: NormalizedTrackProperty;
  message: string;
};

export type AnimationBuildResult =
  | { ok: true; clip: AnimationClip; issues: [] }
  | { ok: false; clip: null; issues: RawAnimationValidationIssue[] };

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

export type RawAnimationSampleOptions = {
  skeleton?: Skeleton;
  restPose?: readonly Transform[];
  loop?: boolean;
};

export type RawAnimationRatioSampleOptions = Omit<RawAnimationSampleOptions, "loop">;

export type RawAnimationTimePointOptions = {
  skeleton?: Skeleton;
  joints?: readonly (number | string)[];
  properties?: readonly TrackProperty[];
};

export type FixedRateSample = {
  index: number;
  time: number;
  ratio: number;
};

export type FixedRateSamplingTimes = {
  duration: number;
  frequency: number;
  period: number;
  sampleCount: number;
  samples: FixedRateSample[];
  times: number[];
  ratios: number[];
};

export type AnimationTrackStats = {
  track: number;
  property: TrackProperty;
  normalizedProperty: NormalizedTrackProperty | null;
  keyCount: number;
  valueCount: number;
  stride: 3 | 4 | null;
  firstTime: number | null;
  lastTime: number | null;
  joint?: string;
  humanBone?: string;
  jointIndex?: number;
};

export type AnimationClipStats = {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  trackCount: number;
  jointCount: number;
  soaTrackCount: number;
  timepointCount: number;
  translationTrackCount: number;
  rotationTrackCount: number;
  scaleTrackCount: number;
  translationKeyCount: number;
  rotationKeyCount: number;
  scaleKeyCount: number;
  totalKeyCount: number;
  perTrack: AnimationTrackStats[];
};

export type AnimationSamplingMode = "reset" | "coherent-forward" | "seek";

export type AnimationSamplingContextSnapshot = {
  clipId: string | null;
  ratio: number;
  time: number;
  maxTracks: number;
  trackCount: number;
  sampleCount: number;
  invalidationCount: number;
  lastMode: AnimationSamplingMode;
  reusedTrackCount: number;
  advancedTrackCount: number;
  searchedTrackCount: number;
};

const SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;
const ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE = 1e-6;

type QuaternionNormalizationMessages = {
  finite: string;
  normalizable: string;
  normalized: string;
};

type QuaternionNormalizationIssue = {
  kind: keyof QuaternionNormalizationMessages;
  message: string;
};

type RawAnimationChannel = {
  sourceTrack: number;
  joint?: string;
  humanBone?: HumanoidBoneName | string;
  targetKey: string;
  jointIndex: number;
  property: NormalizedTrackProperty;
  keys: readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[];
};

const RAW_ANIMATION_PROPERTY_ORDER: readonly NormalizedTrackProperty[] = ["translation", "rotation", "scale"];
const RAW_ANIMATION_PROPERTY_RANK: Readonly<Record<NormalizedTrackProperty, number>> = {
  translation: 0,
  rotation: 1,
  scale: 2
};

export function createRawAnimation(definition: RawAnimationDefinition): RawAnimation {
  const raw: RawAnimation = {
    id: definition.id,
    duration: definition.duration,
    tracks: (definition.tracks ?? []).map((track) => createRawAnimationJointTrack(track))
  };
  if (definition.name !== undefined) raw.name = definition.name;
  if (definition.loop !== undefined) raw.loop = definition.loop;
  if (definition.metadata !== undefined) raw.metadata = { ...definition.metadata };
  return raw;
}

export function createRawAnimationJointTrack(definition: RawAnimationJointTrackDefinition): RawAnimationJointTrack {
  const track: RawAnimationJointTrack = {
    translations: (definition.translations ?? []).map(cloneRawAnimationVec3Key),
    rotations: (definition.rotations ?? []).map(cloneRawAnimationQuaternionKey),
    scales: (definition.scales ?? []).map(cloneRawAnimationVec3Key)
  };
  if (definition.joint !== undefined) track.joint = definition.joint;
  if (definition.humanBone !== undefined) track.humanBone = definition.humanBone;
  return track;
}

export function cloneRawAnimation(rawAnimation: RawAnimation): RawAnimation {
  assertRawAnimationObject(rawAnimation);
  const cloned: RawAnimation = {
    id: rawAnimation.id,
    duration: rawAnimation.duration,
    tracks: readRawAnimationTracks(rawAnimation).map((track) => cloneRawAnimationJointTrack(track))
  };
  if (rawAnimation.name !== undefined) cloned.name = rawAnimation.name;
  if (rawAnimation.loop !== undefined) cloned.loop = rawAnimation.loop;
  if (rawAnimation.metadata !== undefined) cloned.metadata = { ...rawAnimation.metadata };
  return cloned;
}

export function cloneRawAnimationJointTrack(track: RawAnimationJointTrack): RawAnimationJointTrack {
  assertRawAnimationJointTrackObject(track, "raw animation joint track");
  const cloned: RawAnimationJointTrack = {
    translations: readRawAnimationKeys(track, "translation").map(cloneRawAnimationVec3Key),
    rotations: readRawAnimationKeys(track, "rotation").map(cloneRawAnimationQuaternionKey),
    scales: readRawAnimationKeys(track, "scale").map(cloneRawAnimationVec3Key)
  };
  if (track.joint !== undefined) cloned.joint = track.joint;
  if (track.humanBone !== undefined) cloned.humanBone = track.humanBone;
  return cloned;
}

export function validateRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): RawAnimationValidationIssue[] {
  const issues: RawAnimationValidationIssue[] = [];
  if (!isRawAnimationObject(rawAnimation)) {
    issues.push({ message: "raw animation must be an object" });
    return issues;
  }
  if (typeof rawAnimation.id !== "string" || rawAnimation.id.length === 0) {
    issues.push({ message: "raw animation id is required" });
  }
  if (rawAnimation.name !== undefined && typeof rawAnimation.name !== "string") {
    issues.push({ message: "raw animation name must be a string" });
  }
  if (!Number.isFinite(rawAnimation.duration) || rawAnimation.duration <= 0) {
    issues.push({ message: "raw animation duration must be positive and finite" });
  }
  if (rawAnimation.loop !== undefined && typeof rawAnimation.loop !== "boolean") {
    issues.push({ message: "raw animation loop must be a boolean" });
  }
  const tracks = Array.isArray(rawAnimation.tracks) ? rawAnimation.tracks : undefined;
  if (!tracks) {
    issues.push({ message: "raw animation tracks must be an array" });
    return issues;
  }

  const resolvedChannels = new Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>();
  let channelCount = 0;

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    if (!isRawAnimationJointTrackObject(track)) {
      issues.push({ track: trackIndex, message: "raw animation joint track must be an object" });
      continue;
    }

    const target = validateRawAnimationTrackTarget(issues, track, trackIndex, skeleton);
    let trackKeyCount = 0;
    for (const property of RAW_ANIMATION_PROPERTY_ORDER) {
      const keys = readRawAnimationKeysForValidation(track, property);
      if (!keys) {
        issues.push({ track: trackIndex, joint: target.name, property, message: `raw animation ${property} keys must be an array` });
        continue;
      }
      if (keys.length > 0 && target.key) {
        const channelKey = `${target.key}:${property}`;
        const existing = resolvedChannels.get(channelKey);
        if (existing) {
          issues.push({
            track: trackIndex,
            joint: target.name,
            property,
            message: `duplicate raw animation target channel ${target.name}.${property} conflicts with track ${existing.track} (${existing.joint}.${existing.property})`
          });
        } else {
          resolvedChannels.set(channelKey, { track: trackIndex, joint: target.name, property });
        }
      }
      validateRawAnimationKeys(issues, keys, trackIndex, target.name, property, rawAnimation.duration);
      trackKeyCount += keys.length;
    }
    if (trackKeyCount === 0) {
      issues.push({ track: trackIndex, joint: target.name, message: "raw animation joint track has no transform keys" });
    } else {
      channelCount += 1;
    }
  }

  if (channelCount === 0) {
    issues.push({ message: "raw animation has no keyed transform channels" });
  }
  return issues;
}

export function tryBuildAnimationFromRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): AnimationBuildResult {
  const issues = validateRawAnimation(rawAnimation, skeleton);
  if (issues.length > 0) return { ok: false, clip: null, issues };

  const clip = buildValidatedAnimationFromRawAnimation(rawAnimation, skeleton);
  const clipIssues = validateClip(clip, skeleton);
  if (clipIssues.length > 0) {
    return {
      ok: false,
      clip: null,
      issues: clipIssues.map((issue): RawAnimationValidationIssue => {
        const mapped: RawAnimationValidationIssue = { message: issue.message };
        if (issue.track !== undefined) mapped.track = issue.track;
        if (issue.joint !== undefined) mapped.joint = issue.joint;
        if (issue.index !== undefined) mapped.index = issue.index;
        const property = normalizedTrackProperty(issue.property ?? "");
        if (property) mapped.property = property;
        return mapped;
      })
    };
  }
  return { ok: true, clip, issues: [] };
}

export function buildAnimationFromRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): AnimationClip {
  const result = tryBuildAnimationFromRawAnimation(rawAnimation, skeleton);
  if (!result.ok) {
    throw new Error(`raw animation is invalid: ${result.issues.map(formatRawAnimationIssue).join("; ")}`);
  }
  return result.clip;
}

export class AnimationBuilder {
  build(rawAnimation: RawAnimation, skeleton?: Skeleton): AnimationClip {
    return buildAnimationFromRawAnimation(rawAnimation, skeleton);
  }
}

export function extractRawAnimationTimePoints(rawAnimation: RawAnimation, options: RawAnimationTimePointOptions = {}): number[] {
  assertValidRawAnimation(rawAnimation, options.skeleton);
  const propertyFilter = readRawAnimationPropertyFilter(options.properties);
  const jointFilter = readRawAnimationJointFilter(options.joints, options.skeleton);
  const timepoints = new Set<number>();

  for (const track of readRawAnimationTracks(rawAnimation)) {
    const target = readRawAnimationTarget(track, options.skeleton);
    if (jointFilter && !jointFilter.has(target.key)) continue;
    for (const property of RAW_ANIMATION_PROPERTY_ORDER) {
      if (propertyFilter && !propertyFilter.has(property)) continue;
      for (const key of readRawAnimationKeys(track, property)) {
        timepoints.add(key.time);
      }
    }
  }

  return Array.from(timepoints).sort((a, b) => a - b);
}

export function createFixedRateSamplingTimes(duration: number, frequency: number): FixedRateSamplingTimes {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("fixed-rate sampling frequency must be positive and finite");
  }
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const period = 1 / frequency;
  const sampleCount = Math.max(1, Math.ceil(1 + safeDuration * frequency));
  const samples: FixedRateSample[] = [];
  const times: number[] = [];
  const ratios: number[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const time = Math.min(index * period, safeDuration);
    const ratio = safeDuration > 0 ? clamp(time / safeDuration, 0, 1) : 0;
    samples.push({ index, time, ratio });
    times.push(time);
    ratios.push(ratio);
  }

  return { duration: safeDuration, frequency, period, sampleCount, samples, times, ratios };
}

export function sampleRawAnimation(rawAnimation: RawAnimation, timeSeconds: number, options: RawAnimationSampleOptions = {}): Pose {
  assertValidRawAnimation(rawAnimation, options.skeleton);
  const time = sampleRawAnimationTime(rawAnimation, timeSeconds, options.loop ?? rawAnimation.loop ?? false);
  return sampleValidatedRawAnimation(rawAnimation, time, options);
}

export function sampleRawAnimationAtRatio(rawAnimation: RawAnimation, ratio: number, options: RawAnimationRatioSampleOptions = {}): Pose {
  assertValidRawAnimation(rawAnimation, options.skeleton);
  return sampleValidatedRawAnimation(rawAnimation, sampleRawAnimationRatioToTime(rawAnimation, ratio), options);
}

function buildValidatedAnimationFromRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): AnimationClip {
  const channels = collectRawAnimationChannels(rawAnimation, skeleton).sort(compareRawAnimationChannels);
  const tracks = channels.map((channel): AnimationTrack => {
    const stride = trackStride(channel.property);
    const times = new Float32Array(channel.keys.length);
    const values = new Float32Array(channel.keys.length * stride);
    let previousRotation: Quat | undefined;
    for (let keyIndex = 0; keyIndex < channel.keys.length; keyIndex += 1) {
      const key = channel.keys[keyIndex]!;
      times[keyIndex] = key.time;
      if (channel.property === "rotation") {
        let rotation = normalizeQuat(cloneQuat((key as RawAnimationQuaternionKey).value));
        if (previousRotation) rotation = ensureShortestQuat(previousRotation, rotation);
        values.set(rotation, keyIndex * stride);
        previousRotation = rotation;
      } else {
        values.set(cloneVec3((key as RawAnimationVec3Key).value, channel.property === "scale" ? ONE_VEC3 : undefined), keyIndex * stride);
      }
    }
    const track: AnimationTrack = { property: channel.property, times, values };
    if (channel.joint !== undefined) track.joint = channel.joint;
    if (channel.humanBone !== undefined) track.humanBone = channel.humanBone;
    return track;
  });

  const clip: AnimationClip = {
    id: rawAnimation.id,
    duration: rawAnimation.duration,
    tracks
  };
  if (rawAnimation.name !== undefined) clip.name = rawAnimation.name;
  if (rawAnimation.loop !== undefined) clip.loop = rawAnimation.loop;
  if (rawAnimation.metadata !== undefined) clip.metadata = { ...rawAnimation.metadata };
  return clip;
}

function assertValidRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): void {
  const issues = validateRawAnimation(rawAnimation, skeleton);
  if (issues.length > 0) {
    throw new Error(`raw animation is invalid: ${issues.map(formatRawAnimationIssue).join("; ")}`);
  }
}

function sampleRawAnimationTime(rawAnimation: RawAnimation, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  if (loop && rawAnimation.duration > 0) return euclideanModulo(timeSeconds, rawAnimation.duration);
  return clamp(timeSeconds, 0, Math.max(0, rawAnimation.duration));
}

function sampleRawAnimationRatioToTime(rawAnimation: RawAnimation, ratio: number): number {
  return clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * rawAnimation.duration;
}

function sampleValidatedRawAnimation(rawAnimation: RawAnimation, time: number, options: RawAnimationSampleOptions | RawAnimationRatioSampleOptions): Pose {
  const tracks = readRawAnimationTracks(rawAnimation);
  if (!options.skeleton) return tracks.map((track) => sampleRawAnimationJointTrackNoValidate(track, time));

  const skeleton = options.skeleton;
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) => cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint)));
  for (const track of tracks) {
    const jointIndex = readRawAnimationTarget(track, skeleton).jointIndex;
    if (jointIndex < 0) continue;
    const transform = cloneTransform(output[jointIndex]);
    if (track.translations.length > 0) transform.translation = sampleRawAnimationVec3Keys(track.translations, time, "translation");
    if (track.rotations.length > 0) transform.rotation = sampleRawAnimationQuaternionKeys(track.rotations, time);
    if (track.scales.length > 0) transform.scale = sampleRawAnimationVec3Keys(track.scales, time, "scale");
    output[jointIndex] = transform;
  }
  return output;
}

function sampleRawAnimationJointTrackNoValidate(track: RawAnimationJointTrack, time: number): Transform {
  return {
    translation: sampleRawAnimationVec3Keys(track.translations, time, "translation"),
    rotation: sampleRawAnimationQuaternionKeys(track.rotations, time),
    scale: sampleRawAnimationVec3Keys(track.scales, time, "scale")
  };
}

function sampleRawAnimationVec3Keys(keys: readonly RawAnimationVec3Key[], time: number, property: "translation" | "scale"): Vec3 {
  if (keys.length === 0) return defaultTrackSample(property) as Vec3;
  if (time <= keys[0]!.time) return cloneVec3(keys[0]!.value, property === "scale" ? ONE_VEC3 : undefined);
  const last = keys.length - 1;
  if (time >= keys[last]!.time) return cloneVec3(keys[last]!.value, property === "scale" ? ONE_VEC3 : undefined);
  const lower = findLowerRawAnimationKey(keys, time);
  const upper = lower + 1;
  const start = keys[lower]!;
  const end = keys[upper]!;
  const t = end.time > start.time ? (time - start.time) / (end.time - start.time) : 0;
  return lerpVec3(
    cloneVec3(start.value, property === "scale" ? ONE_VEC3 : undefined),
    cloneVec3(end.value, property === "scale" ? ONE_VEC3 : undefined),
    t
  );
}

function sampleRawAnimationQuaternionKeys(keys: readonly RawAnimationQuaternionKey[], time: number): Quat {
  if (keys.length === 0) return cloneQuat(undefined);
  if (time <= keys[0]!.time) return normalizeQuat(cloneQuat(keys[0]!.value));
  const last = keys.length - 1;
  if (time >= keys[last]!.time) return normalizeQuat(cloneQuat(keys[last]!.value));
  const lower = findLowerRawAnimationKey(keys, time);
  const upper = lower + 1;
  const start = keys[lower]!;
  const end = keys[upper]!;
  const t = end.time > start.time ? (time - start.time) / (end.time - start.time) : 0;
  return slerpQuat(normalizeQuat(cloneQuat(start.value)), normalizeQuat(cloneQuat(end.value)), t);
}

function findLowerRawAnimationKey(keys: readonly { time: number }[], time: number): number {
  let low = 1;
  let high = keys.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (keys[mid]!.time < time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function readRawAnimationPropertyFilter(properties: readonly TrackProperty[] | undefined): ReadonlySet<NormalizedTrackProperty> | null {
  if (!properties) return null;
  const filter = new Set<NormalizedTrackProperty>();
  for (const property of properties) {
    const normalized = normalizedTrackProperty(property);
    if (!normalized) throw new Error(`unsupported raw animation timepoint property ${String(property)}`);
    filter.add(normalized);
  }
  return filter;
}

function readRawAnimationJointFilter(joints: readonly (number | string)[] | undefined, skeleton: Skeleton | undefined): ReadonlySet<string> | null {
  if (!joints) return null;
  const filter = new Set<string>();
  for (const joint of joints) {
    if (!skeleton) {
      filter.add(String(joint));
      continue;
    }
    const jointIndex = typeof joint === "number" ? readRawAnimationFilterJointIndex(skeleton, joint) : resolveJointIndex(skeleton, joint);
    if (jointIndex < 0) throw new Error(`raw animation timepoint joint ${String(joint)} was not found`);
    filter.add(String(jointIndex));
  }
  return filter;
}

function readRawAnimationFilterJointIndex(skeleton: Skeleton, joint: number): number {
  if (!Number.isInteger(joint) || joint < 0 || joint >= skeleton.joints.length) {
    throw new Error(`raw animation timepoint joint index ${String(joint)} is out of range`);
  }
  return joint;
}

function collectRawAnimationChannels(rawAnimation: RawAnimation, skeleton?: Skeleton): RawAnimationChannel[] {
  const channels: RawAnimationChannel[] = [];
  const tracks = readRawAnimationTracks(rawAnimation);
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    const target = readRawAnimationTarget(track, skeleton);
    pushRawAnimationChannel(channels, track, trackIndex, target, "translation", track.translations);
    pushRawAnimationChannel(channels, track, trackIndex, target, "rotation", track.rotations);
    pushRawAnimationChannel(channels, track, trackIndex, target, "scale", track.scales);
  }
  return channels;
}

function pushRawAnimationChannel(
  channels: RawAnimationChannel[],
  track: RawAnimationJointTrack,
  sourceTrack: number,
  target: { key: string; name: string; jointIndex: number },
  property: NormalizedTrackProperty,
  keys: readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[]
): void {
  if (keys.length === 0) return;
  const channel: RawAnimationChannel = {
    sourceTrack,
    targetKey: target.key,
    jointIndex: target.jointIndex,
    property,
    keys
  };
  if (track.joint !== undefined) channel.joint = track.joint;
  if (track.humanBone !== undefined) channel.humanBone = track.humanBone;
  channels.push(channel);
}

function compareRawAnimationChannels(a: RawAnimationChannel, b: RawAnimationChannel): number {
  if (a.jointIndex >= 0 && b.jointIndex >= 0 && a.jointIndex !== b.jointIndex) return a.jointIndex - b.jointIndex;
  const targetOrder = a.targetKey.localeCompare(b.targetKey);
  if (targetOrder !== 0) return targetOrder;
  const propertyOrder = RAW_ANIMATION_PROPERTY_RANK[a.property] - RAW_ANIMATION_PROPERTY_RANK[b.property];
  if (propertyOrder !== 0) return propertyOrder;
  return a.sourceTrack - b.sourceTrack;
}

function validateRawAnimationTrackTarget(
  issues: RawAnimationValidationIssue[],
  track: RawAnimationJointTrack,
  trackIndex: number,
  skeleton: Skeleton | undefined
): { key: string | null; name: string; jointIndex: number } {
  const hasJoint = track.joint !== undefined;
  const hasHumanBone = track.humanBone !== undefined;
  const fallbackName = String(track.joint ?? track.humanBone ?? "");

  if (hasJoint === hasHumanBone) {
    issues.push({ track: trackIndex, joint: fallbackName, message: "raw animation joint track needs exactly one joint or humanBone target" });
    return { key: null, name: fallbackName, jointIndex: -1 };
  }
  if (hasJoint && (typeof track.joint !== "string" || track.joint.length === 0)) {
    issues.push({ track: trackIndex, joint: fallbackName, message: "raw animation joint target must be a non-empty string" });
    return { key: null, name: fallbackName, jointIndex: -1 };
  }
  if (hasHumanBone) {
    if (typeof track.humanBone !== "string" || track.humanBone.length === 0) {
      issues.push({ track: trackIndex, joint: fallbackName, message: "raw animation humanBone target must be a non-empty string" });
      return { key: null, name: fallbackName, jointIndex: -1 };
    }
    if (!isHumanoidBoneName(track.humanBone)) {
      issues.push({ track: trackIndex, joint: track.humanBone, message: `raw animation track has unknown humanoid bone ${track.humanBone}` });
      return { key: null, name: track.humanBone, jointIndex: -1 };
    }
  }

  if (!skeleton) return { key: fallbackName, name: fallbackName, jointIndex: -1 };

  const jointIndex = hasJoint ? resolveJointIndex(skeleton, track.joint!) : resolveHumanoidIndex(skeleton, track.humanBone as HumanoidBoneName);
  if (jointIndex < 0) {
    issues.push({ track: trackIndex, joint: fallbackName, message: "raw animation track does not map to skeleton" });
    return { key: null, name: fallbackName, jointIndex: -1 };
  }
  const jointName = skeleton.joints[jointIndex]?.name ?? fallbackName;
  return { key: String(jointIndex), name: `${jointName}[${jointIndex}]`, jointIndex };
}

function validateRawAnimationKeys(
  issues: RawAnimationValidationIssue[],
  keys: readonly unknown[],
  trackIndex: number,
  joint: string,
  property: NormalizedTrackProperty,
  duration: number
): void {
  let previousTime = -Infinity;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex] as RawAnimationVec3Key | RawAnimationQuaternionKey | undefined;
    if (!isRawAnimationKeyObject(key)) {
      issues.push({ track: trackIndex, key: keyIndex, joint, property, message: "raw animation key must be an object" });
      continue;
    }
    if (!Number.isFinite(key.time)) {
      issues.push({ track: trackIndex, key: keyIndex, joint, property, message: "raw animation key time must be finite" });
    } else {
      if (key.time < 0 || key.time > duration) {
        issues.push({ track: trackIndex, key: keyIndex, joint, property, message: "raw animation key time must be within raw animation duration" });
      }
      if (key.time <= previousTime) {
        issues.push({ track: trackIndex, key: keyIndex, joint, property, message: "raw animation key times must be in strict ascending order" });
      }
      previousTime = key.time;
    }

    if (property === "rotation") validateRawAnimationQuaternionValue(issues, key.value, trackIndex, keyIndex, joint, property);
    else validateRawAnimationVec3Value(issues, key.value, trackIndex, keyIndex, joint, property);
  }
}

function validateRawAnimationVec3Value(
  issues: RawAnimationValidationIssue[],
  value: unknown,
  track: number,
  key: number,
  joint: string,
  property: NormalizedTrackProperty
): void {
  const length = rawArrayLikeLength(value);
  if (length !== 3) {
    issues.push({ track, key, joint, property, message: `raw animation ${property} key value must contain exactly 3 values` });
    return;
  }
  for (let component = 0; component < 3; component += 1) {
    if (!Number.isFinite((value as ArrayLike<number>)[component])) {
      issues.push({ track, key, joint, property, message: `raw animation ${property} key values must be finite` });
      return;
    }
  }
}

function validateRawAnimationQuaternionValue(
  issues: RawAnimationValidationIssue[],
  value: unknown,
  track: number,
  key: number,
  joint: string,
  property: NormalizedTrackProperty
): void {
  const length = rawArrayLikeLength(value);
  if (length !== 4) {
    issues.push({ track, key, joint, property, message: "raw animation rotation key value must contain exactly 4 values" });
    return;
  }
  const components = value as ArrayLike<number>;
  for (let component = 0; component < 4; component += 1) {
    if (!Number.isFinite(components[component])) {
      issues.push({ track, key, joint, property, message: "raw animation rotation key values must be finite" });
      return;
    }
  }
  const lengthValue = Math.hypot(components[0]!, components[1]!, components[2]!, components[3]!);
  if (!Number.isFinite(lengthValue) || lengthValue <= EPSILON) {
    issues.push({ track, key, joint, property, message: "raw animation rotation key quaternion must be normalizable" });
  }
}

function readRawAnimationTarget(track: RawAnimationJointTrack, skeleton?: Skeleton): { key: string; name: string; jointIndex: number } {
  const targetName = String(track.joint ?? track.humanBone ?? "");
  if (!skeleton) return { key: targetName, name: targetName, jointIndex: -1 };
  const jointIndex = track.joint !== undefined ? resolveJointIndex(skeleton, track.joint) : resolveHumanoidIndex(skeleton, track.humanBone as HumanoidBoneName);
  const jointName = skeleton.joints[jointIndex]?.name ?? targetName;
  return { key: String(jointIndex), name: `${jointName}[${jointIndex}]`, jointIndex };
}

function formatRawAnimationIssue(issue: RawAnimationValidationIssue): string {
  const pieces: string[] = [];
  if (issue.track !== undefined) pieces.push(`track ${issue.track}`);
  if (issue.key !== undefined) pieces.push(`key ${issue.key}`);
  if (issue.joint) pieces.push(issue.joint);
  if (issue.property) pieces.push(issue.property);
  pieces.push(issue.message);
  return pieces.join(" ");
}

function cloneRawAnimationVec3Key(key: RawAnimationVec3KeyDefinition): RawAnimationVec3Key {
  return {
    time: key.time,
    value: [rawAnimationNumberAt(key.value, 0), rawAnimationNumberAt(key.value, 1), rawAnimationNumberAt(key.value, 2)]
  };
}

function cloneRawAnimationQuaternionKey(key: RawAnimationQuaternionKeyDefinition): RawAnimationQuaternionKey {
  return {
    time: key.time,
    value: [
      rawAnimationNumberAt(key.value, 0),
      rawAnimationNumberAt(key.value, 1),
      rawAnimationNumberAt(key.value, 2),
      rawAnimationNumberAt(key.value, 3)
    ]
  };
}

function rawAnimationNumberAt(value: ArrayLike<number> | undefined, index: number): number {
  const component = value?.[index];
  return typeof component === "number" ? component : Number.NaN;
}

function readRawAnimationTracks(rawAnimation: RawAnimation): readonly RawAnimationJointTrack[] {
  const tracks = (rawAnimation as RawAnimation | undefined)?.tracks;
  if (!Array.isArray(tracks)) throw new Error("raw animation tracks must be an array");
  return tracks;
}

function readRawAnimationKeys(track: RawAnimationJointTrack, property: NormalizedTrackProperty): readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[] {
  const keys = readRawAnimationKeysForValidation(track, property);
  if (!keys) throw new Error(`raw animation ${property} keys must be an array`);
  return keys as readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[];
}

function readRawAnimationKeysForValidation(track: RawAnimationJointTrack, property: NormalizedTrackProperty): readonly unknown[] | null {
  if (property === "translation") return Array.isArray(track.translations) ? track.translations : null;
  if (property === "rotation") return Array.isArray(track.rotations) ? track.rotations : null;
  return Array.isArray(track.scales) ? track.scales : null;
}

function rawArrayLikeLength(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const length = (value as ArrayLike<number>).length;
  return typeof length === "number" ? length : null;
}

function isRawAnimationObject(value: unknown): value is RawAnimation {
  return typeof value === "object" && value !== null;
}

function assertRawAnimationObject(value: unknown): asserts value is RawAnimation {
  if (!isRawAnimationObject(value)) throw new Error("raw animation must be an object");
}

function isRawAnimationJointTrackObject(value: unknown): value is RawAnimationJointTrack {
  return typeof value === "object" && value !== null;
}

function assertRawAnimationJointTrackObject(value: unknown, label: string): asserts value is RawAnimationJointTrack {
  if (!isRawAnimationJointTrackObject(value)) throw new Error(`${label} must be an object`);
}

function isRawAnimationKeyObject(value: unknown): value is { time: number; value: unknown } {
  return typeof value === "object" && value !== null && "time" in value && "value" in value;
}

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
    if (track.humanBone !== undefined && !isHumanoidBoneName(track.humanBone)) {
      issues.push({ track: index, joint: String(track.humanBone), property: track.property, message: "track has unknown humanoid bone" });
    }
    const jointIndex = skeleton && jointName ? resolveTrackJointIndex(skeleton, track) : -1;
    if (skeleton && jointName && jointIndex < 0) {
      issues.push({ track: index, joint: String(jointName), property: track.property, message: "track does not map to skeleton" });
    }
    validateSourceRestQuaternion(issues, track, index, String(jointName ?? ""), property);
    validateSourceRestChildDirection(issues, track, index, String(jointName ?? ""), property);
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
  return sampleClipToPoseAtResolvedTime(skeleton, clip, sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false), options);
}

export function sampleClipToPoseAtRatio(skeleton: Skeleton, clip: AnimationClip, ratio: number, options: SampleRatioOptions = {}): Pose {
  return sampleClipToPoseAtResolvedTime(skeleton, clip, sampleRatioToTime(clip, ratio), options);
}

export function sampleClipToPoseWithContext(skeleton: Skeleton, clip: AnimationClip, timeSeconds: number, context: AnimationSamplingContext, options: SampleOptions = {}): Pose {
  const time = sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false);
  context.beginSample(clip, time, readClipTimeRatio(clip, time));
  return sampleClipToPoseAtResolvedTime(skeleton, clip, time, options, (track, trackIndex, sampledTime, sampleOptions) =>
    context.sampleTrack(trackIndex, track, sampledTime, sampleOptions)
  );
}

export function sampleRatioToTime(clip: AnimationClip, ratio: number): number {
  const duration = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0;
  return clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * duration;
}

export function getAnimationClipStats(clip: AnimationClip, skeleton?: Skeleton): AnimationClipStats {
  const perTrack: AnimationTrackStats[] = [];
  const joints = new Set<string>();
  const timepoints = new Set<number>();
  let translationTrackCount = 0;
  let rotationTrackCount = 0;
  let scaleTrackCount = 0;
  let translationKeyCount = 0;
  let rotationKeyCount = 0;
  let scaleKeyCount = 0;

  for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex += 1) {
    const track = clip.tracks[trackIndex]!;
    const property = normalizedTrackProperty(track.property);
    const stride = property ? trackStride(property) : null;
    const keyCount = track.times.length;
    const jointIndex = skeleton ? resolveTrackJointIndex(skeleton, track) : -1;
    const target = readTrackTargetKey(track, skeleton, jointIndex);
    if (target) joints.add(target);
    for (let i = 0; i < track.times.length; i += 1) {
      const time = track.times[i]!;
      if (Number.isFinite(time)) timepoints.add(time);
    }
    if (property === "translation") {
      translationTrackCount += 1;
      translationKeyCount += keyCount;
    } else if (property === "rotation") {
      rotationTrackCount += 1;
      rotationKeyCount += keyCount;
    } else if (property === "scale") {
      scaleTrackCount += 1;
      scaleKeyCount += keyCount;
    }
    perTrack.push({
      track: trackIndex,
      property: track.property,
      normalizedProperty: property,
      keyCount,
      valueCount: track.values.length,
      stride,
      firstTime: keyCount > 0 && Number.isFinite(track.times[0]) ? track.times[0]! : null,
      lastTime: keyCount > 0 && Number.isFinite(track.times[keyCount - 1]) ? track.times[keyCount - 1]! : null,
      ...(track.joint !== undefined ? { joint: track.joint } : {}),
      ...(track.humanBone !== undefined ? { humanBone: track.humanBone } : {}),
      ...(jointIndex >= 0 ? { jointIndex } : {})
    });
  }

  const jointCount = joints.size;
  return {
    id: clip.id,
    name: clip.name ?? "",
    duration: Number.isFinite(clip.duration) ? clip.duration : 0,
    loop: clip.loop ?? false,
    trackCount: clip.tracks.length,
    jointCount,
    soaTrackCount: Math.ceil(jointCount / 4),
    timepointCount: timepoints.size,
    translationTrackCount,
    rotationTrackCount,
    scaleTrackCount,
    translationKeyCount,
    rotationKeyCount,
    scaleKeyCount,
    totalKeyCount: translationKeyCount + rotationKeyCount + scaleKeyCount,
    perTrack
  };
}

export class AnimationSamplingContext {
  private lowerKeys = new Int32Array(0);
  private clip: AnimationClip | null = null;
  private signature = "";
  private invalid = true;
  private ratio = 0;
  private time = 0;
  private trackCount = 0;
  private sampleCount = 0;
  private invalidationCount = 0;
  private lastMode: AnimationSamplingMode = "reset";
  private reusedTrackCount = 0;
  private advancedTrackCount = 0;
  private searchedTrackCount = 0;

  constructor(maxTracks = 0) {
    this.resize(maxTracks);
  }

  get maxTracks(): number {
    return this.lowerKeys.length;
  }

  resize(maxTracks: number): void {
    const size = Math.max(0, Math.ceil(finiteTrackCount(maxTracks)));
    if (size === this.lowerKeys.length) return;
    this.lowerKeys = new Int32Array(size);
    this.lowerKeys.fill(-1);
    this.invalidate();
  }

  invalidate(): void {
    if (!this.invalid || this.clip !== null) this.invalidationCount += 1;
    this.invalid = true;
    this.clip = null;
    this.signature = "";
    this.lowerKeys.fill(-1);
  }

  snapshot(): AnimationSamplingContextSnapshot {
    return {
      clipId: this.clip?.id ?? null,
      ratio: this.ratio,
      time: this.time,
      maxTracks: this.maxTracks,
      trackCount: this.trackCount,
      sampleCount: this.sampleCount,
      invalidationCount: this.invalidationCount,
      lastMode: this.lastMode,
      reusedTrackCount: this.reusedTrackCount,
      advancedTrackCount: this.advancedTrackCount,
      searchedTrackCount: this.searchedTrackCount
    };
  }

  sampleTime(skeleton: Skeleton, clip: AnimationClip, timeSeconds: number, options: SampleOptions = {}): Pose {
    return sampleClipToPoseWithContext(skeleton, clip, timeSeconds, this, options);
  }

  sampleRatio(skeleton: Skeleton, clip: AnimationClip, ratio: number, options: SampleRatioOptions = {}): Pose {
    const time = sampleRatioToTime(clip, ratio);
    this.beginSample(clip, time, readClipTimeRatio(clip, time));
    return sampleClipToPoseAtResolvedTime(skeleton, clip, time, options, (track, trackIndex, sampledTime, sampleOptions) =>
      this.sampleTrack(trackIndex, track, sampledTime, sampleOptions)
    );
  }

  beginSample(clip: AnimationClip, time: number, ratio: number): void {
    if (clip.tracks.length > this.maxTracks) this.resize(clip.tracks.length);
    const signature = animationSamplingSignature(clip);
    const animationChanged = this.clip !== clip || this.signature !== signature;
    const reset = this.invalid || animationChanged;
    if (animationChanged && this.clip !== null && !this.invalid) this.invalidationCount += 1;

    this.lastMode = reset ? "reset" : time < this.time ? "seek" : "coherent-forward";
    this.reusedTrackCount = 0;
    this.advancedTrackCount = 0;
    this.searchedTrackCount = 0;
    if (reset) this.lowerKeys.fill(-1);

    this.clip = clip;
    this.signature = signature;
    this.invalid = false;
    this.time = time;
    this.ratio = ratio;
    this.trackCount = clip.tracks.length;
    this.sampleCount += 1;
  }

  sampleTrack(
    trackIndex: number,
    track: AnimationTrack,
    timeSeconds: number,
    options: { diagnostics?: SampleRepairDiagnostic[]; diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index"> } = {}
  ): number[] {
    const property = normalizedTrackProperty(track.property);
    if (!property) throw new Error(`unsupported animation track property ${String(track.property)}`);
    const stride = trackStride(property);
    if (track.times.length === 0) return defaultTrackSample(property);
    if (trackIndex < 0 || trackIndex >= this.maxTracks) {
      return sampleTrack(track, timeSeconds, options);
    }
    if (timeSeconds <= track.times[0]!) {
      this.lowerKeys[trackIndex] = 0;
      return readTrackValue(track, 0, stride, property, options.diagnostics, options.diagnosticContext);
    }
    const last = track.times.length - 1;
    if (timeSeconds >= track.times[last]!) {
      this.lowerKeys[trackIndex] = Math.max(0, last - 1);
      return readTrackValue(track, last, stride, property, options.diagnostics, options.diagnosticContext);
    }

    const lower = this.resolveLowerKey(trackIndex, track.times, timeSeconds);
    const upper = lower + 1;
    const start = track.times[lower]!;
    const end = track.times[upper]!;
    const t = end > start ? (timeSeconds - start) / (end - start) : 0;
    const a = readTrackValue(track, lower, stride, property, options.diagnostics, options.diagnosticContext);
    const b = readTrackValue(track, upper, stride, property, options.diagnostics, options.diagnosticContext);
    if (stride === 4) return slerpQuat(a as Quat, b as Quat, t);
    return lerpVec3(a as [number, number, number], b as [number, number, number], t);
  }

  private resolveLowerKey(trackIndex: number, times: Float32Array, timeSeconds: number): number {
    const lastLower = times.length - 2;
    const cached = this.lowerKeys[trackIndex] ?? -1;
    if (this.lastMode === "coherent-forward" && cached >= 0 && cached <= lastLower && timeSeconds >= times[cached]!) {
      let lower = cached;
      while (lower < lastLower && timeSeconds > times[lower + 1]!) lower += 1;
      this.lowerKeys[trackIndex] = lower;
      if (lower === cached) this.reusedTrackCount += 1;
      else this.advancedTrackCount += 1;
      return lower;
    }

    this.searchedTrackCount += 1;
    const lower = findLowerKey(times, timeSeconds);
    this.lowerKeys[trackIndex] = lower;
    return lower;
  }
}

type TrackSampleOptions = {
  diagnostics?: SampleRepairDiagnostic[];
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">;
};

type TrackSampler = (track: AnimationTrack, trackIndex: number, timeSeconds: number, options: TrackSampleOptions) => number[];

function sampleClipToPoseAtResolvedTime(
  skeleton: Skeleton,
  clip: AnimationClip,
  time: number,
  options: SampleOptions | SampleRatioOptions = {},
  trackSampler: TrackSampler = (track, _trackIndex, sampledTime, sampleOptions) => sampleTrack(track, sampledTime, sampleOptions)
): Pose {
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) => cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint)));
  for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex += 1) {
    const track = clip.tracks[trackIndex]!;
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    if (jointIndex < 0) continue;
    const property = normalizedTrackProperty(track.property);
    if (!property) {
      if (options.skipUnsupportedTracks) continue;
      throw new Error(`unsupported animation track property ${String(track.property)}`);
    }
    const diagnosticContext = { track: trackIndex, joint: skeleton.joints[jointIndex]?.name ?? String(track.joint ?? track.humanBone ?? ""), index: jointIndex };
    const sampled = options.diagnostics
      ? trackSampler(track, trackIndex, time, { diagnostics: options.diagnostics, diagnosticContext })
      : trackSampler(track, trackIndex, time, { diagnosticContext });
    const restTransform = readPoseTransformOrRest(skeleton, restPose, jointIndex);
    const transform = cloneTransform(output[jointIndex]);
    if (property === "translation") transform.translation = sampled as [number, number, number];
    if (property === "scale") transform.scale = sampled as [number, number, number];
    if (property === "rotation") {
      transform.rotation = retargetSampledRotation(track, restTransform.rotation, sampled as Quat, jointIndex, options, diagnosticContext);
    }
    output[jointIndex] = transform;
  }
  return output;
}

function retargetSampledRotation(
  track: AnimationTrack,
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

function readTrackSourceRestChildDirection(track: AnimationTrack): Vec3 | undefined {
  const direction = track.sourceRestChildDirection;
  if (!direction || direction.length !== 3) return undefined;
  return cloneVec3(direction);
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
  const lower = findLowerKey(track.times, timeSeconds);
  const upper = lower + 1;
  const start = track.times[lower]!;
  const end = track.times[upper]!;
  const t = end > start ? (timeSeconds - start) / (end - start) : 0;
  const a = readTrackValue(track, lower, stride, property, options.diagnostics, options.diagnosticContext);
  const b = readTrackValue(track, upper, stride, property, options.diagnostics, options.diagnosticContext);
  if (stride === 4) return slerpQuat(a as Quat, b as Quat, t);
  return lerpVec3(a as [number, number, number], b as [number, number, number], t);
}

function findLowerKey(times: Float32Array, timeSeconds: number): number {
  let low = 1;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid]! < timeSeconds) low = mid + 1;
    else high = mid;
  }
  return low - 1;
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
  if (stride === 4) return normalizeQuat(values as Quat, rotationSampleFallback(track));
  return repairVec3Sample(track, values as [number, number, number], fallback as [number, number, number], keyIndex, diagnostics, diagnosticContext);
}

function rotationSampleFallback(track: AnimationTrack): Quat {
  return track.sourceRestQuaternion?.length === 4 ? cloneNormalizedQuat(track.sourceRestQuaternion) : cloneQuat(undefined);
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

function repairVec3Sample(
  track: AnimationTrack,
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
  track: AnimationTrack,
  sourceRest: Float32Array
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

function quaternionNormalizationIssue(value: ArrayLike<number>, lengthSquaredTolerance: number, messages: QuaternionNormalizationMessages): QuaternionNormalizationIssue | null {
  for (let component = 0; component < 4; component += 1) {
    if (!Number.isFinite(value[component])) return { kind: "finite", message: messages.finite };
  }
  const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (!Number.isFinite(length) || length <= EPSILON) return { kind: "normalizable", message: messages.normalizable };
  const lengthSquared = length * length;
  if (Math.abs(lengthSquared - 1) > lengthSquaredTolerance) return { kind: "normalized", message: messages.normalized };
  return null;
}

function readClipTimeRatio(clip: AnimationClip, time: number): number {
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) return 0;
  return clamp(Number.isFinite(time) ? time / clip.duration : 0, 0, 1);
}

function readTrackTargetKey(track: AnimationTrack, skeleton: Skeleton | undefined, jointIndex: number): string | null {
  if (skeleton) return jointIndex >= 0 ? String(jointIndex) : null;
  const joint = track.joint ?? track.humanBone;
  return joint === undefined ? null : String(joint);
}

function finiteTrackCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function animationSamplingSignature(clip: AnimationClip): string {
  return [
    clip.id,
    clip.duration,
    clip.loop === true ? 1 : 0,
    clip.tracks.length,
    ...clip.tracks.map((track) => `${track.joint ?? ""}/${track.humanBone ?? ""}/${track.property}/${track.times.length}/${track.values.length}`)
  ].join("|");
}
