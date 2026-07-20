import {
  type Quat,
  type Transform,
  type Vec3,
  EPSILON,
  ONE_VEC3,
  addVec3,
  cloneQuat,
  cloneTransform,
  cloneVec3,
  clamp,
  dotQuat,
  ensureShortestQuat,
  euclideanModulo,
  isFiniteTransform,
  lerpVec3,
  multiplyQuat,
  normalizeQuat,
  slerpQuat,
  transformDelta
} from "./math.js";
import { mat4Translation } from "./numeric-helpers.js";
import {
  defaultTrackSample,
  formatClipIssue,
  normalizedTrackProperty,
  resolveTrackJointIndex,
  trackStride,
  validateClip,
  type AnimationClip,
  type AnimationTrack,
  type ClipValidationIssue,
  type NormalizedTrackProperty,
  type SampleOptions,
  type TrackProperty
} from "./clip-internal.js";
import { sampleClipToPose } from "./clip-sampling.js";
import { type Pose, readPoseTransformOrRest } from "./pose.js";
import {
  type HumanoidBoneNameLike,
  type Skeleton,
  createRestPose,
  isHumanoidBoneName,
  localToModelPose,
  resolveHumanoidIndex,
  resolveJointIndex
} from "./skeleton.js";

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
  humanBone?: HumanoidBoneNameLike;
  translations?: readonly RawAnimationVec3KeyDefinition[];
  rotations?: readonly RawAnimationQuaternionKeyDefinition[];
  scales?: readonly RawAnimationVec3KeyDefinition[];
};

export type RawAnimationJointTrack = {
  joint?: string;
  humanBone?: HumanoidBoneNameLike;
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

export type AdditiveAnimationClipBuildOptions = {
  /** Explicit reference pose to subtract from the source clip. Defaults to each source channel's first keyed value. */
  referencePose?: readonly Transform[];
};

export type AdditiveAnimationClipBuildResult =
  | { ok: true; clip: AnimationClip; issues: [] }
  | { ok: false; clip: null; issues: ClipValidationIssue[] };

export type AnimationOptimizerTolerances = {
  /** Local-space translation distance tolerance. Defaults to 1e-3. */
  translation?: number;
  /** Local-space quaternion angle tolerance in radians. Defaults to 1e-3. */
  rotation?: number;
  /** Local-space scale distance tolerance. Defaults to 1e-3. */
  scale?: number;
};

export type AnimationOptimizerJointTolerance = AnimationOptimizerTolerances & {
  /** Multiplies joint sensitivity. Values above 1 make effective tolerances stricter. */
  weight?: number;
};

export type AnimationOptimizerOptions = {
  /** Optional skeleton used for target validation, hierarchy sensitivity, and joint override resolution. */
  skeleton?: Skeleton;
  /** Base local-space tolerances. Rotation is measured as quaternion shortest-path angle in radians. */
  tolerances?: AnimationOptimizerTolerances;
  /** Optional joint-name, humanoid-name, or numeric-index tolerance overrides. */
  jointTolerances?: Readonly<Record<string, AnimationOptimizerJointTolerance>>;
  /** Additional sensitivity per descendant joint. 0 disables hierarchy weighting. Defaults to 0. */
  hierarchyWeight?: number;
  /** Optional post-optimization raw-vs-optimized sample diagnostics. Requires a skeleton. */
  sampleError?: boolean | AnimationOptimizerSampleErrorOptions;
};

export type AnimationOptimizerSampleErrorOptions = {
  /** Explicit validation sample times. Defaults to fixed-rate samples over the source duration. */
  sampleTimes?: readonly number[];
  /** Fixed-rate validation fallback when sampleTimes is omitted. Defaults to 30 Hz. */
  sampleFrequency?: number;
  /** Loop handling passed to both sampled sources. Defaults to the source loop flag. */
  loop?: boolean;
  /** Optional rest pose used when sampling both sources. */
  restPose?: readonly Transform[];
  /** Include propagated model-space diagnostics. Defaults to true for optimizer sample diagnostics. */
  includeModelSpace?: boolean;
};

export type AnimationOptimizationChannelStats = {
  track: number;
  property: NormalizedTrackProperty;
  inputKeyCount: number;
  outputKeyCount: number;
  removedKeyCount: number;
  tolerance: number;
  jointWeight: number;
  hierarchyWeight: number;
  descendantCount: number;
  joint?: string;
  humanBone?: string;
  jointIndex?: number;
};

export type AnimationOptimizationStats = {
  inputKeyCount: number;
  outputKeyCount: number;
  removedKeyCount: number;
  channels: AnimationOptimizationChannelStats[];
  sampleError?: AnimationSampleErrorReport;
};

export type RawAnimationOptimizationResult =
  | { ok: true; rawAnimation: RawAnimation; issues: []; stats: AnimationOptimizationStats }
  | { ok: false; rawAnimation: null; issues: RawAnimationValidationIssue[]; stats: null };

export type AnimationSampleErrorMetric = {
  rms: number;
  max: number;
  maxSample?: number;
  maxTime?: number;
  maxJointIndex?: number;
  maxJoint?: string;
};

export type AnimationSampleErrorReport = {
  sampleCount: number;
  jointSampleCount: number;
  times: readonly number[];
  translation: AnimationSampleErrorMetric;
  rotation: AnimationSampleErrorMetric;
  scale: AnimationSampleErrorMetric;
  modelSpace?: AnimationModelSpaceSampleErrorReport;
};

export type AnimationModelSpaceJointSampleError = {
  jointIndex: number;
  joint: string;
  position: AnimationSampleErrorMetric;
  rotation: AnimationSampleErrorMetric;
  scale: AnimationSampleErrorMetric;
};

export type AnimationModelSpaceSampleErrorReport = {
  sampleCount: number;
  jointSampleCount: number;
  times: readonly number[];
  position: AnimationSampleErrorMetric;
  rotation: AnimationSampleErrorMetric;
  scale: AnimationSampleErrorMetric;
  joints: readonly AnimationModelSpaceJointSampleError[];
};

export type AnimationSampleErrorOptions = {
  skeleton: Skeleton;
  /** Explicit sample times. Defaults to fixed-rate samples over the reference duration. */
  sampleTimes?: readonly number[];
  /** Fixed-rate fallback when sampleTimes is omitted. Defaults to 30 Hz. */
  sampleFrequency?: number;
  /** Loop handling passed to both sampled sources. Defaults to each source's loop flag. */
  loop?: boolean;
  /** Optional rest pose used when sampling both sources. */
  restPose?: readonly Transform[];
  /** Also report propagated model-space position/rotation/scale error through the skeleton hierarchy. */
  includeModelSpace?: boolean;
};

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

type RawAnimationChannel = {
  sourceTrack: number;
  joint?: string;
  humanBone?: HumanoidBoneNameLike;
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
const MAX_RAW_ANIMATION_KEY_COUNT = 1_000_000;
const MAX_FIXED_RATE_SAMPLE_COUNT = 1_000_000;

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
  const duration = readRawAnimationDurationForValidation(rawAnimation.duration);
  if (typeof rawAnimation.id !== "string" || rawAnimation.id.length === 0) {
    issues.push({ message: "raw animation id is required" });
  }
  if (rawAnimation.name !== undefined && typeof rawAnimation.name !== "string") {
    issues.push({ message: "raw animation name must be a string" });
  }
  if (duration === null) {
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
        issues.push({
          track: trackIndex,
          joint: target.name,
          property,
          message: `raw animation ${property} keys must be an array`
        });
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
      validateRawAnimationKeys(issues, keys, trackIndex, target.name, property, duration);
      trackKeyCount += keys.length;
    }
    if (trackKeyCount === 0) {
      issues.push({
        track: trackIndex,
        joint: target.name,
        message: "raw animation joint track has no transform keys"
      });
    } else {
      channelCount += 1;
    }
  }

  if (channelCount === 0) {
    issues.push({ message: "raw animation has no keyed transform channels" });
  }
  return issues;
}

export function tryBuildAnimationFromRawAnimation(
  rawAnimation: RawAnimation,
  skeleton?: Skeleton
): AnimationBuildResult {
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

export function tryOptimizeRawAnimation(
  rawAnimation: RawAnimation,
  options: AnimationOptimizerOptions = {}
): RawAnimationOptimizationResult {
  const issues = validateRawAnimation(rawAnimation, options.skeleton);
  validateAnimationOptimizerOptions(issues, options);
  if (issues.length > 0) return { ok: false, rawAnimation: null, issues, stats: null };

  const optimized = optimizeValidatedRawAnimation(rawAnimation, options);
  const optimizedIssues = validateRawAnimation(optimized.rawAnimation, options.skeleton);
  if (optimizedIssues.length > 0) return { ok: false, rawAnimation: null, issues: optimizedIssues, stats: null };
  return { ok: true, rawAnimation: optimized.rawAnimation, issues: [], stats: optimized.stats };
}

export function optimizeRawAnimation(
  rawAnimation: RawAnimation,
  options: AnimationOptimizerOptions = {}
): RawAnimation {
  const result = tryOptimizeRawAnimation(rawAnimation, options);
  if (!result.ok) {
    throw new Error(`raw animation optimization failed: ${result.issues.map(formatRawAnimationIssue).join("; ")}`);
  }
  return result.rawAnimation;
}

export class AnimationOptimizer {
  optimize(rawAnimation: RawAnimation, options: AnimationOptimizerOptions = {}): RawAnimation {
    return optimizeRawAnimation(rawAnimation, options);
  }

  tryOptimize(rawAnimation: RawAnimation, options: AnimationOptimizerOptions = {}): RawAnimationOptimizationResult {
    return tryOptimizeRawAnimation(rawAnimation, options);
  }
}

export function tryBuildAdditiveAnimationClip(
  clip: AnimationClip,
  skeleton: Skeleton,
  options: AdditiveAnimationClipBuildOptions = {}
): AdditiveAnimationClipBuildResult {
  const issues = validateClip(clip, skeleton);
  validateAdditiveReferencePose(issues, skeleton, skeleton.restPose, "skeleton rest pose");
  if (options.referencePose !== undefined) {
    validateAdditiveReferencePose(issues, skeleton, options.referencePose, "reference pose");
  }
  if (issues.length > 0) return { ok: false, clip: null, issues };

  const additiveClip = buildValidatedAdditiveAnimationClip(clip, skeleton, options);
  const additiveIssues = validateClip(additiveClip, skeleton);
  if (additiveIssues.length > 0) return { ok: false, clip: null, issues: additiveIssues };
  return { ok: true, clip: additiveClip, issues: [] };
}

export function buildAdditiveAnimationClip(
  clip: AnimationClip,
  skeleton: Skeleton,
  options: AdditiveAnimationClipBuildOptions = {}
): AnimationClip {
  const result = tryBuildAdditiveAnimationClip(clip, skeleton, options);
  if (!result.ok) {
    throw new Error(`additive animation clip cannot be built: ${result.issues.map(formatClipIssue).join("; ")}`);
  }
  return result.clip;
}

export class AdditiveAnimationBuilder {
  build(clip: AnimationClip, skeleton: Skeleton, options: AdditiveAnimationClipBuildOptions = {}): AnimationClip {
    return buildAdditiveAnimationClip(clip, skeleton, options);
  }
}

export function extractRawAnimationTimePoints(
  rawAnimation: RawAnimation,
  options: RawAnimationTimePointOptions = {}
): number[] {
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
  const rawSampleCount = 1 + safeDuration * frequency;
  if (!Number.isFinite(rawSampleCount) || rawSampleCount > MAX_FIXED_RATE_SAMPLE_COUNT) {
    throw new RangeError(`fixed-rate sampling sample count exceeds ${MAX_FIXED_RATE_SAMPLE_COUNT}`);
  }
  const sampleCount = Math.max(1, Math.ceil(rawSampleCount));
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

export function sampleRawAnimation(
  rawAnimation: RawAnimation,
  timeSeconds: number,
  options: RawAnimationSampleOptions = {}
): Pose {
  assertValidRawAnimation(rawAnimation, options.skeleton);
  const time = sampleRawAnimationTime(rawAnimation, timeSeconds, options.loop ?? rawAnimation.loop ?? false);
  return sampleValidatedRawAnimation(rawAnimation, time, options);
}

export function sampleRawAnimationAtRatio(
  rawAnimation: RawAnimation,
  ratio: number,
  options: RawAnimationRatioSampleOptions = {}
): Pose {
  assertValidRawAnimation(rawAnimation, options.skeleton);
  return sampleValidatedRawAnimation(rawAnimation, sampleRawAnimationRatioToTime(rawAnimation, ratio), options);
}

export function compareAnimationSampleError(
  reference: RawAnimation | AnimationClip,
  candidate: RawAnimation | AnimationClip,
  options: AnimationSampleErrorOptions
): AnimationSampleErrorReport {
  assertValidAnimationSampleSource(reference, options.skeleton, "reference");
  assertValidAnimationSampleSource(candidate, options.skeleton, "candidate");
  const times = readAnimationSampleErrorTimes(reference, options);
  const translation = createSampleErrorAccumulator();
  const rotation = createSampleErrorAccumulator();
  const scale = createSampleErrorAccumulator();
  const modelSpace =
    options.includeModelSpace === true ? createModelSpaceSampleErrorAccumulator(options.skeleton) : undefined;
  const restPose = options.restPose;

  for (let sampleIndex = 0; sampleIndex < times.length; sampleIndex += 1) {
    const time = times[sampleIndex]!;
    const referencePose = sampleAnimationSource(reference, time, options.skeleton, options.loop, restPose);
    const candidatePose = sampleAnimationSource(candidate, time, options.skeleton, options.loop, restPose);
    for (let jointIndex = 0; jointIndex < options.skeleton.joints.length; jointIndex += 1) {
      const a = referencePose[jointIndex]!;
      const b = candidatePose[jointIndex]!;
      pushSampleError(translation, vec3Error(a.translation, b.translation), sampleIndex, time, jointIndex);
      pushSampleError(rotation, quaternionAngleError(a.rotation, b.rotation), sampleIndex, time, jointIndex);
      pushSampleError(scale, vec3Error(a.scale, b.scale), sampleIndex, time, jointIndex);
    }
    if (modelSpace) {
      pushModelSpaceSampleError(modelSpace, options.skeleton, referencePose, candidatePose, sampleIndex, time);
    }
  }

  const jointSampleCount = times.length * options.skeleton.joints.length;
  const report: AnimationSampleErrorReport = {
    sampleCount: times.length,
    jointSampleCount,
    times,
    translation: finishSampleErrorAccumulator(translation, jointSampleCount, options.skeleton),
    rotation: finishSampleErrorAccumulator(rotation, jointSampleCount, options.skeleton),
    scale: finishSampleErrorAccumulator(scale, jointSampleCount, options.skeleton)
  };
  if (modelSpace) {
    report.modelSpace = finishModelSpaceSampleErrorAccumulator(
      modelSpace,
      times.length,
      jointSampleCount,
      times,
      options.skeleton
    );
  }
  return report;
}

export function compareAnimationModelSpaceSampleError(
  reference: RawAnimation | AnimationClip,
  candidate: RawAnimation | AnimationClip,
  options: AnimationSampleErrorOptions
): AnimationModelSpaceSampleErrorReport {
  const report = compareAnimationSampleError(reference, candidate, { ...options, includeModelSpace: true });
  return report.modelSpace!;
}

const DEFAULT_ANIMATION_OPTIMIZER_TOLERANCES: Required<AnimationOptimizerTolerances> = {
  translation: 1e-3,
  rotation: 1e-3,
  scale: 1e-3
};

function validateAnimationOptimizerOptions(
  issues: RawAnimationValidationIssue[],
  options: AnimationOptimizerOptions
): void {
  const tolerances = options.tolerances;
  if (tolerances !== undefined && (typeof tolerances !== "object" || tolerances === null)) {
    issues.push({ message: "animation optimizer tolerances must be an object" });
  } else {
    for (const property of RAW_ANIMATION_PROPERTY_ORDER) {
      validateAnimationOptimizerTolerance(issues, tolerances?.[property], `animation optimizer ${property} tolerance`);
    }
  }
  validateAnimationOptimizerTolerance(issues, options.hierarchyWeight, "animation optimizer hierarchyWeight");
  validateAnimationOptimizerSampleErrorOptions(issues, options);
  const jointTolerances = options.jointTolerances;
  if (jointTolerances === undefined) return;
  if (typeof jointTolerances !== "object" || jointTolerances === null) {
    issues.push({ message: "animation optimizer jointTolerances must be an object" });
    return;
  }
  for (const [joint, tolerance] of Object.entries(jointTolerances)) {
    if (typeof tolerance !== "object" || tolerance === null) {
      issues.push({ joint, message: "animation optimizer joint tolerance override must be an object" });
      continue;
    }
    for (const property of RAW_ANIMATION_PROPERTY_ORDER) {
      validateAnimationOptimizerTolerance(
        issues,
        tolerance[property],
        `animation optimizer ${joint}.${property} tolerance`,
        joint,
        property
      );
    }
    validateAnimationOptimizerTolerance(issues, tolerance.weight, `animation optimizer ${joint}.weight`, joint);
    if (tolerance.weight !== undefined && tolerance.weight <= 0) {
      issues.push({ joint, message: "animation optimizer joint weight must be positive" });
    }
  }
}

function validateAnimationOptimizerSampleErrorOptions(
  issues: RawAnimationValidationIssue[],
  options: AnimationOptimizerOptions
): void {
  const sampleError = options.sampleError;
  if (sampleError === undefined || sampleError === false) return;
  if (!options.skeleton) {
    issues.push({ message: "animation optimizer sampleError requires a skeleton" });
  }
  if (sampleError === true) return;
  if (typeof sampleError !== "object" || sampleError === null) {
    issues.push({ message: "animation optimizer sampleError must be a boolean or object" });
    return;
  }
  if (
    sampleError.sampleFrequency !== undefined &&
    (!Number.isFinite(sampleError.sampleFrequency) || sampleError.sampleFrequency <= 0)
  ) {
    issues.push({ message: "animation optimizer sampleError sampleFrequency must be positive and finite" });
  }
  if (sampleError.sampleTimes !== undefined) {
    if (!Array.isArray(sampleError.sampleTimes)) {
      issues.push({ message: "animation optimizer sampleError sampleTimes must be an array" });
    } else if (sampleError.sampleTimes.length > MAX_FIXED_RATE_SAMPLE_COUNT) {
      issues.push({ message: `animation optimizer sampleError sampleTimes exceeds ${MAX_FIXED_RATE_SAMPLE_COUNT}` });
    } else if (sampleError.sampleTimes.some((time) => !Number.isFinite(time))) {
      issues.push({ message: "animation optimizer sampleError sampleTimes must contain finite values" });
    }
  }
  if (sampleError.loop !== undefined && typeof sampleError.loop !== "boolean") {
    issues.push({ message: "animation optimizer sampleError loop must be a boolean" });
  }
  if (sampleError.includeModelSpace !== undefined && typeof sampleError.includeModelSpace !== "boolean") {
    issues.push({ message: "animation optimizer sampleError includeModelSpace must be a boolean" });
  }
}

function validateAnimationOptimizerTolerance(
  issues: RawAnimationValidationIssue[],
  value: number | undefined,
  label: string,
  joint?: string,
  property?: NormalizedTrackProperty
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    const issue: RawAnimationValidationIssue = { message: `${label} must be finite and non-negative` };
    if (joint !== undefined) issue.joint = joint;
    if (property !== undefined) issue.property = property;
    issues.push(issue);
  }
}

function optimizeValidatedRawAnimation(
  rawAnimation: RawAnimation,
  options: AnimationOptimizerOptions
): { rawAnimation: RawAnimation; stats: AnimationOptimizationStats } {
  const descendantCounts = options.skeleton ? countSkeletonDescendants(options.skeleton) : [];
  const channels: AnimationOptimizationChannelStats[] = [];
  let inputKeyCount = 0;
  let outputKeyCount = 0;

  const tracks = readRawAnimationTracks(rawAnimation).map((track, trackIndex): RawAnimationJointTrack => {
    const target = readRawAnimationTarget(track, options.skeleton);
    const translations = optimizeRawAnimationVec3Keys(
      track.translations,
      "translation",
      track,
      trackIndex,
      target,
      options,
      descendantCounts,
      channels
    );
    const rotations = optimizeRawAnimationQuaternionKeys(
      track.rotations,
      track,
      trackIndex,
      target,
      options,
      descendantCounts,
      channels
    );
    const scales = optimizeRawAnimationVec3Keys(
      track.scales,
      "scale",
      track,
      trackIndex,
      target,
      options,
      descendantCounts,
      channels
    );
    inputKeyCount += track.translations.length + track.rotations.length + track.scales.length;
    outputKeyCount += translations.length + rotations.length + scales.length;
    const optimized: RawAnimationJointTrack = { translations, rotations, scales };
    if (track.joint !== undefined) optimized.joint = track.joint;
    if (track.humanBone !== undefined) optimized.humanBone = track.humanBone;
    return optimized;
  });

  const optimized: RawAnimation = {
    id: rawAnimation.id,
    duration: rawAnimation.duration,
    tracks
  };
  if (rawAnimation.name !== undefined) optimized.name = rawAnimation.name;
  if (rawAnimation.loop !== undefined) optimized.loop = rawAnimation.loop;
  if (rawAnimation.metadata !== undefined) optimized.metadata = { ...rawAnimation.metadata };
  const stats: AnimationOptimizationStats = {
    inputKeyCount,
    outputKeyCount,
    removedKeyCount: inputKeyCount - outputKeyCount,
    channels
  };
  if (options.skeleton && options.sampleError !== undefined && options.sampleError !== false) {
    stats.sampleError = compareAnimationSampleError(
      rawAnimation,
      optimized,
      createOptimizerSampleErrorOptions(options)
    );
  }
  return {
    rawAnimation: optimized,
    stats
  };
}

function createOptimizerSampleErrorOptions(options: AnimationOptimizerOptions): AnimationSampleErrorOptions {
  if (!options.skeleton) throw new Error("animation optimizer sampleError requires a skeleton");
  const sampleError = options.sampleError;
  const compareOptions: AnimationSampleErrorOptions = {
    skeleton: options.skeleton,
    includeModelSpace: true
  };
  if (typeof sampleError === "object" && sampleError !== null) {
    if (sampleError.sampleTimes !== undefined) compareOptions.sampleTimes = sampleError.sampleTimes;
    if (sampleError.sampleFrequency !== undefined) compareOptions.sampleFrequency = sampleError.sampleFrequency;
    if (sampleError.loop !== undefined) compareOptions.loop = sampleError.loop;
    if (sampleError.restPose !== undefined) compareOptions.restPose = sampleError.restPose;
    if (sampleError.includeModelSpace !== undefined) compareOptions.includeModelSpace = sampleError.includeModelSpace;
  }
  return compareOptions;
}

function optimizeRawAnimationVec3Keys(
  keys: readonly RawAnimationVec3Key[],
  property: "translation" | "scale",
  track: RawAnimationJointTrack,
  trackIndex: number,
  target: { key: string; name: string; jointIndex: number },
  options: AnimationOptimizerOptions,
  descendantCounts: readonly number[],
  stats: AnimationOptimizationChannelStats[]
): RawAnimationVec3Key[] {
  const tolerance = resolveAnimationOptimizerTolerance(property, track, target, options, descendantCounts);
  const optimized = decimateRawAnimationKeys(keys, property, tolerance.effective);
  pushAnimationOptimizationChannelStats(
    stats,
    track,
    trackIndex,
    target,
    property,
    keys.length,
    optimized.length,
    tolerance
  );
  return optimized as RawAnimationVec3Key[];
}

function optimizeRawAnimationQuaternionKeys(
  keys: readonly RawAnimationQuaternionKey[],
  track: RawAnimationJointTrack,
  trackIndex: number,
  target: { key: string; name: string; jointIndex: number },
  options: AnimationOptimizerOptions,
  descendantCounts: readonly number[],
  stats: AnimationOptimizationChannelStats[]
): RawAnimationQuaternionKey[] {
  const tolerance = resolveAnimationOptimizerTolerance("rotation", track, target, options, descendantCounts);
  const optimized = decimateRawAnimationKeys(keys, "rotation", tolerance.effective);
  pushAnimationOptimizationChannelStats(
    stats,
    track,
    trackIndex,
    target,
    "rotation",
    keys.length,
    optimized.length,
    tolerance
  );
  return optimized as RawAnimationQuaternionKey[];
}

type ResolvedAnimationOptimizerTolerance = {
  effective: number;
  jointWeight: number;
  hierarchyWeight: number;
  descendantCount: number;
};

function resolveAnimationOptimizerTolerance(
  property: NormalizedTrackProperty,
  track: RawAnimationJointTrack,
  target: { key: string; name: string; jointIndex: number },
  options: AnimationOptimizerOptions,
  descendantCounts: readonly number[]
): ResolvedAnimationOptimizerTolerance {
  const override = readAnimationOptimizerJointTolerance(track, target, options);
  const base =
    override?.[property] ?? options.tolerances?.[property] ?? DEFAULT_ANIMATION_OPTIMIZER_TOLERANCES[property];
  const jointWeight = override?.weight ?? 1;
  const hierarchyWeight = options.hierarchyWeight ?? 0;
  const descendantCount = target.jointIndex >= 0 ? (descendantCounts[target.jointIndex] ?? 0) : 0;
  return {
    effective: finiteEffectiveOptimizerTolerance(base, jointWeight, hierarchyWeight, descendantCount),
    jointWeight,
    hierarchyWeight,
    descendantCount
  };
}

function finiteEffectiveOptimizerTolerance(
  base: number,
  jointWeight: number,
  hierarchyWeight: number,
  descendantCount: number
): number {
  const hierarchyScale = 1 + hierarchyWeight * descendantCount;
  if (!Number.isFinite(hierarchyScale)) return 0;
  const denominator = jointWeight * hierarchyScale;
  if (!Number.isFinite(denominator)) return 0;
  const effective = base / denominator;
  if (Number.isFinite(effective)) return Math.max(0, effective);
  return effective > 0 ? Number.MAX_VALUE : 0;
}

function readAnimationOptimizerJointTolerance(
  track: RawAnimationJointTrack,
  target: { key: string; name: string; jointIndex: number },
  options: AnimationOptimizerOptions
): AnimationOptimizerJointTolerance | undefined {
  const jointTolerances = options.jointTolerances;
  if (!jointTolerances) return undefined;
  const keys: string[] = [];
  if (track.joint !== undefined) keys.push(track.joint);
  if (track.humanBone !== undefined) keys.push(track.humanBone);
  if (target.jointIndex >= 0) {
    keys.push(String(target.jointIndex));
    const joint = options.skeleton?.joints[target.jointIndex];
    if (joint) {
      keys.push(joint.name);
      if (joint.humanoid !== undefined) keys.push(joint.humanoid);
    }
  }
  for (const key of keys) {
    const tolerance = jointTolerances[key];
    if (tolerance !== undefined) return tolerance;
  }
  return undefined;
}

function pushAnimationOptimizationChannelStats(
  stats: AnimationOptimizationChannelStats[],
  track: RawAnimationJointTrack,
  trackIndex: number,
  target: { jointIndex: number },
  property: NormalizedTrackProperty,
  inputKeyCount: number,
  outputKeyCount: number,
  tolerance: ResolvedAnimationOptimizerTolerance
): void {
  if (inputKeyCount === 0) return;
  const item: AnimationOptimizationChannelStats = {
    track: trackIndex,
    property,
    inputKeyCount,
    outputKeyCount,
    removedKeyCount: inputKeyCount - outputKeyCount,
    tolerance: tolerance.effective,
    jointWeight: tolerance.jointWeight,
    hierarchyWeight: tolerance.hierarchyWeight,
    descendantCount: tolerance.descendantCount
  };
  if (track.joint !== undefined) item.joint = track.joint;
  if (track.humanBone !== undefined) item.humanBone = track.humanBone;
  if (target.jointIndex >= 0) item.jointIndex = target.jointIndex;
  stats.push(item);
}

function decimateRawAnimationKeys(
  keys: readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[],
  property: NormalizedTrackProperty,
  tolerance: number
): (RawAnimationVec3Key | RawAnimationQuaternionKey)[] {
  if (keys.length <= 2) return keys.map((key) => cloneRawAnimationKey(key, property));

  const included = new Array<boolean>(keys.length).fill(false);
  included[0] = true;
  included[keys.length - 1] = true;
  markRawAnimationRequiredKeys(keys, property, 0, keys.length - 1, tolerance, included);
  return keys.filter((_, index) => included[index]).map((key) => cloneRawAnimationKey(key, property));
}

function markRawAnimationRequiredKeys(
  keys: readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[],
  property: NormalizedTrackProperty,
  left: number,
  right: number,
  tolerance: number,
  included: boolean[]
): void {
  if (right - left <= 1) return;
  let maxError = -1;
  let candidate = -1;
  for (let index = left + 1; index < right; index += 1) {
    const error = rawAnimationKeyInterpolationError(keys[left]!, keys[right]!, keys[index]!, property);
    if (error > maxError) {
      maxError = error;
      candidate = index;
    }
  }
  if (candidate < 0 || maxError <= tolerance) return;
  included[candidate] = true;
  markRawAnimationRequiredKeys(keys, property, left, candidate, tolerance, included);
  markRawAnimationRequiredKeys(keys, property, candidate, right, tolerance, included);
}

function rawAnimationKeyInterpolationError(
  left: RawAnimationVec3Key | RawAnimationQuaternionKey,
  right: RawAnimationVec3Key | RawAnimationQuaternionKey,
  key: RawAnimationVec3Key | RawAnimationQuaternionKey,
  property: NormalizedTrackProperty
): number {
  const alpha = right.time > left.time ? (key.time - left.time) / (right.time - left.time) : 0;
  if (property === "rotation") {
    const expected = slerpQuat(
      normalizeQuat(cloneQuat((left as RawAnimationQuaternionKey).value)),
      normalizeQuat(cloneQuat((right as RawAnimationQuaternionKey).value)),
      alpha
    );
    return quaternionAngleError(expected, normalizeQuat(cloneQuat((key as RawAnimationQuaternionKey).value)));
  }
  const expected = lerpVec3(
    cloneVec3((left as RawAnimationVec3Key).value),
    cloneVec3((right as RawAnimationVec3Key).value),
    alpha
  );
  return vec3Error(expected, cloneVec3((key as RawAnimationVec3Key).value));
}

function cloneRawAnimationKey(
  key: RawAnimationVec3Key | RawAnimationQuaternionKey,
  property: NormalizedTrackProperty
): RawAnimationVec3Key | RawAnimationQuaternionKey {
  return property === "rotation" ? cloneRawAnimationQuaternionKey(key) : cloneRawAnimationVec3Key(key);
}

function countSkeletonDescendants(skeleton: Skeleton): number[] {
  const counts = new Array<number>(skeleton.joints.length).fill(0);
  for (let index = skeleton.joints.length - 1; index >= 0; index -= 1) {
    const parent = skeleton.joints[index]?.parentIndex ?? -1;
    if (parent >= 0 && parent < counts.length) {
      counts[parent] = (counts[parent] ?? 0) + 1 + (counts[index] ?? 0);
    }
  }
  return counts;
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
        values.set(
          cloneVec3((key as RawAnimationVec3Key).value, channel.property === "scale" ? ONE_VEC3 : undefined),
          keyIndex * stride
        );
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

function buildValidatedAdditiveAnimationClip(
  clip: AnimationClip,
  skeleton: Skeleton,
  options: AdditiveAnimationClipBuildOptions
): AnimationClip {
  const tracks = clip.tracks.map((track): AnimationTrack => {
    const property = normalizedTrackProperty(track.property)!;
    const stride = trackStride(property);
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    const restTransform = skeleton.restPose[jointIndex]!;
    const referenceTransform =
      options.referencePose?.[jointIndex] ??
      sampleClipToPose(skeleton, clip, track.times[0]!, {
        loop: false,
        restPose: skeleton.restPose,
        skipUnsupportedTracks: true
      })[jointIndex]!;
    const times = Float32Array.from(track.times);
    const values = new Float32Array(track.values.length);
    let previousRotation: Quat | undefined;

    for (let keyIndex = 0; keyIndex < track.times.length; keyIndex += 1) {
      const sampleTransform = sampleClipToPose(skeleton, clip, track.times[keyIndex]!, {
        loop: false,
        restPose: skeleton.restPose,
        skipUnsupportedTracks: true
      })[jointIndex]!;
      const value = encodeAdditiveTrackValue(restTransform, referenceTransform, sampleTransform, property);
      const offset = keyIndex * stride;
      if (property === "rotation") {
        let rotation = value as Quat;
        if (previousRotation) rotation = ensureShortestQuat(previousRotation, rotation);
        values.set(rotation, offset);
        previousRotation = rotation;
      } else {
        values.set(value, offset);
      }
    }

    const additiveTrack: AnimationTrack = { property, times, values };
    if (track.joint !== undefined) additiveTrack.joint = track.joint;
    if (track.humanBone !== undefined) additiveTrack.humanBone = track.humanBone;
    return additiveTrack;
  });

  const additiveClip: AnimationClip = {
    id: clip.id,
    duration: clip.duration,
    tracks
  };
  if (clip.name !== undefined) additiveClip.name = clip.name;
  if (clip.loop !== undefined) additiveClip.loop = clip.loop;
  if (clip.metadata !== undefined) additiveClip.metadata = { ...clip.metadata };
  return additiveClip;
}

function encodeAdditiveTrackValue(
  restTransform: Transform,
  referenceTransform: Transform,
  sampleTransform: Transform,
  property: NormalizedTrackProperty
): Vec3 | Quat {
  const delta = transformDelta(referenceTransform, sampleTransform);
  if (property === "translation") return addVec3(restTransform.translation, delta.translation);
  if (property === "rotation") return multiplyQuat(restTransform.rotation, delta.rotation);
  return [
    restTransform.scale[0] * delta.scale[0],
    restTransform.scale[1] * delta.scale[1],
    restTransform.scale[2] * delta.scale[2]
  ];
}

function validateAdditiveReferencePose(
  issues: ClipValidationIssue[],
  skeleton: Skeleton,
  pose: readonly Transform[],
  label: string
): void {
  if (pose.length !== skeleton.joints.length) {
    issues.push({
      joint: `<${label}>`,
      index: -1,
      message: `${label} length ${pose.length} does not match skeleton ${skeleton.joints.length}`
    });
    return;
  }
  for (let index = 0; index < pose.length; index += 1) {
    const transform = pose[index];
    if (!transform || !isValidAdditiveReferenceTransform(transform)) {
      issues.push({
        joint: skeleton.joints[index]?.name ?? String(index),
        index,
        message: `${label} transform is not finite or quaternion is invalid`
      });
    }
  }
}

function isValidAdditiveReferenceTransform(transform: Transform): boolean {
  return isFiniteTransform(transform);
}

function assertValidRawAnimation(rawAnimation: RawAnimation, skeleton?: Skeleton): void {
  const issues = validateRawAnimation(rawAnimation, skeleton);
  if (issues.length > 0) {
    throw new Error(`raw animation is invalid: ${issues.map(formatRawAnimationIssue).join("; ")}`);
  }
}

function sampleRawAnimationTime(rawAnimation: RawAnimation, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  const duration = Number.isFinite(rawAnimation.duration) && rawAnimation.duration > 0 ? rawAnimation.duration : 0;
  if (loop && duration > 0) return euclideanModulo(timeSeconds, duration);
  return clamp(timeSeconds, 0, duration);
}

function sampleRawAnimationRatioToTime(rawAnimation: RawAnimation, ratio: number): number {
  const duration = Number.isFinite(rawAnimation.duration) && rawAnimation.duration > 0 ? rawAnimation.duration : 0;
  return clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * duration;
}

function sampleValidatedRawAnimation(
  rawAnimation: RawAnimation,
  time: number,
  options: RawAnimationSampleOptions | RawAnimationRatioSampleOptions
): Pose {
  const tracks = readRawAnimationTracks(rawAnimation);
  if (!options.skeleton) return tracks.map((track) => sampleRawAnimationJointTrackNoValidate(track, time));

  const skeleton = options.skeleton;
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) =>
    cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint))
  );
  for (const track of tracks) {
    const jointIndex = readRawAnimationTarget(track, skeleton).jointIndex;
    if (jointIndex < 0) continue;
    const transform = cloneTransform(output[jointIndex]);
    if (track.translations.length > 0)
      transform.translation = sampleRawAnimationVec3Keys(track.translations, time, "translation");
    if (track.rotations.length > 0) transform.rotation = sampleRawAnimationQuaternionKeys(track.rotations, time);
    if (track.scales.length > 0) transform.scale = sampleRawAnimationVec3Keys(track.scales, time, "scale");
    output[jointIndex] = transform;
  }
  return output;
}

type AnimationSampleErrorAccumulator = {
  sum: number;
  max: number;
  maxSample?: number;
  maxTime?: number;
  maxJointIndex?: number;
};

type ModelSpaceComparableTransform = {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
};

type ModelSpaceJointSampleErrorAccumulator = {
  position: AnimationSampleErrorAccumulator;
  rotation: AnimationSampleErrorAccumulator;
  scale: AnimationSampleErrorAccumulator;
};

type ModelSpaceSampleErrorAccumulator = ModelSpaceJointSampleErrorAccumulator & {
  joints: ModelSpaceJointSampleErrorAccumulator[];
};

function assertValidAnimationSampleSource(
  source: RawAnimation | AnimationClip,
  skeleton: Skeleton,
  label: string
): void {
  if (isRawAnimationSampleSource(source)) {
    const issues = validateRawAnimation(source, skeleton);
    if (issues.length > 0)
      throw new Error(`${label} raw animation is invalid: ${issues.map(formatRawAnimationIssue).join("; ")}`);
    return;
  }
  const issues = validateClip(source, skeleton);
  if (issues.length > 0)
    throw new Error(`${label} animation clip is invalid: ${issues.map(formatClipIssue).join("; ")}`);
}

function isRawAnimationSampleSource(source: RawAnimation | AnimationClip): source is RawAnimation {
  return (
    Array.isArray(source.tracks) && source.tracks.length > 0 && source.tracks.every(isRawAnimationSampleTrackShape)
  );
}

function isRawAnimationSampleTrackShape(track: unknown): track is RawAnimationJointTrack {
  return (
    isRawAnimationJointTrackObject(track) &&
    Array.isArray((track as Partial<RawAnimationJointTrack>).translations) &&
    Array.isArray((track as Partial<RawAnimationJointTrack>).rotations) &&
    Array.isArray((track as Partial<RawAnimationJointTrack>).scales) &&
    !("property" in track) &&
    !("times" in track) &&
    !("values" in track)
  );
}

function readAnimationSampleErrorTimes(
  reference: RawAnimation | AnimationClip,
  options: AnimationSampleErrorOptions
): readonly number[] {
  if (options.sampleTimes !== undefined) {
    if (options.sampleTimes.length > MAX_FIXED_RATE_SAMPLE_COUNT) {
      throw new RangeError(`animation sample error sampleTimes exceeds ${MAX_FIXED_RATE_SAMPLE_COUNT}`);
    }
    const times = Array.from(options.sampleTimes);
    if (times.some((time) => !Number.isFinite(time)))
      throw new Error("animation sample error sampleTimes must contain finite values");
    return Object.freeze(times);
  }
  const frequency = options.sampleFrequency ?? 30;
  return Object.freeze(createFixedRateSamplingTimes(readAnimationSampleSourceDuration(reference), frequency).times);
}

function readAnimationSampleSourceDuration(source: RawAnimation | AnimationClip): number {
  return Number.isFinite(source.duration) && source.duration > 0 ? source.duration : 0;
}

function sampleAnimationSource(
  source: RawAnimation | AnimationClip,
  time: number,
  skeleton: Skeleton,
  loop: boolean | undefined,
  restPose: readonly Transform[] | undefined
): Pose {
  if (isRawAnimationSampleSource(source)) {
    const options: RawAnimationSampleOptions = { skeleton, loop: loop ?? source.loop ?? false };
    if (restPose !== undefined) options.restPose = restPose;
    return sampleRawAnimation(source, time, options);
  }
  const options: SampleOptions = { loop: loop ?? source.loop ?? false };
  if (restPose !== undefined) options.restPose = restPose;
  return sampleClipToPose(skeleton, source, time, options);
}

function createSampleErrorAccumulator(): AnimationSampleErrorAccumulator {
  return { sum: 0, max: 0 };
}

function createModelSpaceSampleErrorAccumulator(skeleton: Skeleton): ModelSpaceSampleErrorAccumulator {
  return {
    position: createSampleErrorAccumulator(),
    rotation: createSampleErrorAccumulator(),
    scale: createSampleErrorAccumulator(),
    joints: Array.from({ length: skeleton.joints.length }, () => ({
      position: createSampleErrorAccumulator(),
      rotation: createSampleErrorAccumulator(),
      scale: createSampleErrorAccumulator()
    }))
  };
}

function pushSampleError(
  accumulator: AnimationSampleErrorAccumulator,
  error: number,
  sample: number,
  time: number,
  jointIndex: number
): void {
  accumulator.sum += error * error;
  if (error > accumulator.max) {
    accumulator.max = error;
    accumulator.maxSample = sample;
    accumulator.maxTime = time;
    accumulator.maxJointIndex = jointIndex;
  }
}

function pushModelSpaceSampleError(
  accumulator: ModelSpaceSampleErrorAccumulator,
  skeleton: Skeleton,
  referencePose: readonly Transform[],
  candidatePose: readonly Transform[],
  sampleIndex: number,
  time: number
): void {
  const referenceModel = createModelSpaceComparablePose(skeleton, referencePose);
  const candidateModel = createModelSpaceComparablePose(skeleton, candidatePose);
  for (let jointIndex = 0; jointIndex < skeleton.joints.length; jointIndex += 1) {
    const reference = referenceModel[jointIndex]!;
    const candidate = candidateModel[jointIndex]!;
    const positionError = vec3Error(reference.position, candidate.position);
    const rotationError = quaternionAngleError(reference.rotation, candidate.rotation);
    const scaleError = vec3Error(reference.scale, candidate.scale);
    pushSampleError(accumulator.position, positionError, sampleIndex, time, jointIndex);
    pushSampleError(accumulator.rotation, rotationError, sampleIndex, time, jointIndex);
    pushSampleError(accumulator.scale, scaleError, sampleIndex, time, jointIndex);
    const joint = accumulator.joints[jointIndex]!;
    pushSampleError(joint.position, positionError, sampleIndex, time, jointIndex);
    pushSampleError(joint.rotation, rotationError, sampleIndex, time, jointIndex);
    pushSampleError(joint.scale, scaleError, sampleIndex, time, jointIndex);
  }
}

function finishSampleErrorAccumulator(
  accumulator: AnimationSampleErrorAccumulator,
  sampleCount: number,
  skeleton: Skeleton
): AnimationSampleErrorMetric {
  const metric: AnimationSampleErrorMetric = {
    rms: sampleCount > 0 ? Math.sqrt(accumulator.sum / sampleCount) : 0,
    max: accumulator.max
  };
  if (accumulator.maxSample !== undefined) metric.maxSample = accumulator.maxSample;
  if (accumulator.maxTime !== undefined) metric.maxTime = accumulator.maxTime;
  if (accumulator.maxJointIndex !== undefined) {
    metric.maxJointIndex = accumulator.maxJointIndex;
    const joint = skeleton.joints[accumulator.maxJointIndex];
    if (joint !== undefined) metric.maxJoint = joint.name;
  }
  return metric;
}

function finishModelSpaceSampleErrorAccumulator(
  accumulator: ModelSpaceSampleErrorAccumulator,
  sampleCount: number,
  jointSampleCount: number,
  times: readonly number[],
  skeleton: Skeleton
): AnimationModelSpaceSampleErrorReport {
  return {
    sampleCount,
    jointSampleCount,
    times,
    position: finishSampleErrorAccumulator(accumulator.position, jointSampleCount, skeleton),
    rotation: finishSampleErrorAccumulator(accumulator.rotation, jointSampleCount, skeleton),
    scale: finishSampleErrorAccumulator(accumulator.scale, jointSampleCount, skeleton),
    joints: accumulator.joints.map(
      (joint, jointIndex): AnimationModelSpaceJointSampleError => ({
        jointIndex,
        joint: skeleton.joints[jointIndex]?.name ?? String(jointIndex),
        position: finishSampleErrorAccumulator(joint.position, sampleCount, skeleton),
        rotation: finishSampleErrorAccumulator(joint.rotation, sampleCount, skeleton),
        scale: finishSampleErrorAccumulator(joint.scale, sampleCount, skeleton)
      })
    )
  };
}

function createModelSpaceComparablePose(
  skeleton: Skeleton,
  localPose: readonly Transform[]
): ModelSpaceComparableTransform[] {
  const modelPose = localToModelPose(skeleton, localPose);
  const output: ModelSpaceComparableTransform[] = [];
  for (let jointIndex = 0; jointIndex < skeleton.joints.length; jointIndex += 1) {
    const local = readPoseTransformOrRest(skeleton, localPose, jointIndex);
    const parentIndex = skeleton.joints[jointIndex]!.parentIndex;
    const parent = parentIndex >= 0 ? output[parentIndex] : undefined;
    if (parentIndex >= 0 && !parent)
      throw new Error(`model pose for parent ${parentIndex} must be available before comparing joint ${jointIndex}`);
    const scale = parent ? multiplyVec3Components(parent.scale, local.scale) : cloneVec3(local.scale, ONE_VEC3);
    const rotation = parent ? multiplyQuat(parent.rotation, local.rotation) : normalizeQuat(cloneQuat(local.rotation));
    output[jointIndex] = {
      position: mat4Translation(modelPose[jointIndex]!),
      rotation,
      scale
    };
  }
  return output;
}

function multiplyVec3Components(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

function vec3Error(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function quaternionAngleError(a: Quat, b: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(dotQuat(normalizeQuat(a), normalizeQuat(b)))));
}

function sampleRawAnimationJointTrackNoValidate(track: RawAnimationJointTrack, time: number): Transform {
  return {
    translation: sampleRawAnimationVec3Keys(track.translations, time, "translation"),
    rotation: sampleRawAnimationQuaternionKeys(track.rotations, time),
    scale: sampleRawAnimationVec3Keys(track.scales, time, "scale")
  };
}

function sampleRawAnimationVec3Keys(
  keys: readonly RawAnimationVec3Key[],
  time: number,
  property: "translation" | "scale"
): Vec3 {
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

function readRawAnimationPropertyFilter(
  properties: readonly TrackProperty[] | undefined
): ReadonlySet<NormalizedTrackProperty> | null {
  if (!properties) return null;
  const filter = new Set<NormalizedTrackProperty>();
  for (const property of properties) {
    const normalized = normalizedTrackProperty(property);
    if (!normalized) throw new Error(`unsupported raw animation timepoint property ${String(property)}`);
    filter.add(normalized);
  }
  return filter;
}

function readRawAnimationJointFilter(
  joints: readonly (number | string)[] | undefined,
  skeleton: Skeleton | undefined
): ReadonlySet<string> | null {
  if (!joints) return null;
  const filter = new Set<string>();
  for (const joint of joints) {
    if (!skeleton) {
      filter.add(String(joint));
      continue;
    }
    const jointIndex =
      typeof joint === "number"
        ? readRawAnimationFilterJointIndex(skeleton, joint)
        : resolveJointIndex(skeleton, joint);
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
    issues.push({
      track: trackIndex,
      joint: fallbackName,
      message: "raw animation joint track needs exactly one joint or humanBone target"
    });
    return { key: null, name: fallbackName, jointIndex: -1 };
  }
  if (hasJoint && (typeof track.joint !== "string" || track.joint.length === 0)) {
    issues.push({
      track: trackIndex,
      joint: fallbackName,
      message: "raw animation joint target must be a non-empty string"
    });
    return { key: null, name: fallbackName, jointIndex: -1 };
  }
  if (hasHumanBone) {
    if (typeof track.humanBone !== "string" || track.humanBone.length === 0) {
      issues.push({
        track: trackIndex,
        joint: fallbackName,
        message: "raw animation humanBone target must be a non-empty string"
      });
      return { key: null, name: fallbackName, jointIndex: -1 };
    }
    if (!isHumanoidBoneName(track.humanBone)) {
      issues.push({
        track: trackIndex,
        joint: track.humanBone,
        message: `raw animation track has unknown humanoid bone ${track.humanBone}`
      });
      return { key: null, name: track.humanBone, jointIndex: -1 };
    }
  }

  if (!skeleton) return { key: fallbackName, name: fallbackName, jointIndex: -1 };

  const jointIndex = hasJoint
    ? resolveJointIndex(skeleton, track.joint!)
    : track.humanBone && isHumanoidBoneName(track.humanBone)
      ? resolveHumanoidIndex(skeleton, track.humanBone)
      : -1;
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
  duration: number | null
): void {
  if (keys.length > MAX_RAW_ANIMATION_KEY_COUNT) {
    issues.push({
      track: trackIndex,
      joint,
      property,
      message: `raw animation ${property} key count exceeds ${MAX_RAW_ANIMATION_KEY_COUNT}`
    });
    return;
  }
  let previousTime = -Infinity;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex] as RawAnimationVec3Key | RawAnimationQuaternionKey | undefined;
    if (!isRawAnimationKeyObject(key)) {
      issues.push({
        track: trackIndex,
        key: keyIndex,
        joint,
        property,
        message: "raw animation key must be an object"
      });
      continue;
    }
    if (!Number.isFinite(key.time)) {
      issues.push({
        track: trackIndex,
        key: keyIndex,
        joint,
        property,
        message: "raw animation key time must be finite"
      });
    } else {
      if (key.time < 0 || (duration !== null && key.time > duration)) {
        issues.push({
          track: trackIndex,
          key: keyIndex,
          joint,
          property,
          message: "raw animation key time must be within raw animation duration"
        });
      }
      if (key.time <= previousTime) {
        issues.push({
          track: trackIndex,
          key: keyIndex,
          joint,
          property,
          message: "raw animation key times must be in strict ascending order"
        });
      }
      previousTime = key.time;
    }

    if (property === "rotation")
      validateRawAnimationQuaternionValue(issues, key.value, trackIndex, keyIndex, joint, property);
    else validateRawAnimationVec3Value(issues, key.value, trackIndex, keyIndex, joint, property);
  }
}

function readRawAnimationDurationForValidation(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
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
    issues.push({
      track,
      key,
      joint,
      property,
      message: `raw animation ${property} key value must contain exactly 3 values`
    });
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
    issues.push({
      track,
      key,
      joint,
      property,
      message: "raw animation rotation key value must contain exactly 4 values"
    });
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

function readRawAnimationTarget(
  track: RawAnimationJointTrack,
  skeleton?: Skeleton
): { key: string; name: string; jointIndex: number } {
  const targetName = String(track.joint ?? track.humanBone ?? "");
  if (!skeleton) return { key: targetName, name: targetName, jointIndex: -1 };
  const jointIndex =
    track.joint !== undefined
      ? resolveJointIndex(skeleton, track.joint)
      : track.humanBone && isHumanoidBoneName(track.humanBone)
        ? resolveHumanoidIndex(skeleton, track.humanBone)
        : -1;
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

function readRawAnimationKeys(
  track: RawAnimationJointTrack,
  property: NormalizedTrackProperty
): readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[] {
  const keys = readRawAnimationKeysForValidation(track, property);
  if (!keys) throw new Error(`raw animation ${property} keys must be an array`);
  return keys as readonly (RawAnimationVec3Key | RawAnimationQuaternionKey)[];
}

function readRawAnimationKeysForValidation(
  track: RawAnimationJointTrack,
  property: NormalizedTrackProperty
): readonly unknown[] | null {
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
