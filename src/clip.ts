import { type Mat4, type Quat, type Transform, type Vec3, EPSILON, ONE_VEC3, addVec3, cloneNormalizedQuat, cloneQuat, cloneTransform, cloneVec3, clamp, dotQuat, ensureShortestQuat, euclideanModulo, lerpVec3, multiplyQuat, normalizeQuat, slerpQuat, transformDelta } from "./math.js";
import { type Pose, readPoseTransformOrRest } from "./pose.js";
import { retargetQuaternionSample } from "./retargeting.js";
import { type HumanoidBoneName, type Skeleton, createRestPose, isHumanoidBoneName, localToModelPose, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

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

export const PACKED_RUNTIME_ANIMATION_FORMAT = "waifu.packed-runtime-animation";
export const PACKED_RUNTIME_ANIMATION_VERSION = 1;

export type PackedRuntimeAnimationArchiveMetadata = {
  format: typeof PACKED_RUNTIME_ANIMATION_FORMAT;
  version: typeof PACKED_RUNTIME_ANIMATION_VERSION;
  source: "AnimationClip";
  clipId: string;
  clipName?: string;
  duration: number;
  loop: boolean;
  trackCount: number;
  keyCount: number;
  iframeCount: number;
};

export type PackedRuntimeAnimationIframeTable = {
  times: readonly number[];
  ratios: readonly number[];
};

export type PackedRuntimeAnimationTrackSeekTable = {
  iframeLowerKeys: readonly number[];
  iframeUpperKeys: readonly number[];
};

export type PackedRuntimeAnimationKeyController = {
  track: number;
  sourceTrack: number;
  targetKey: string;
  property: TrackProperty;
  normalizedProperty: NormalizedTrackProperty;
  stride: 3 | 4;
  keyCount: number;
  timeOffset: number;
  valueOffset: number;
  firstTime: number;
  lastTime: number;
  joint?: string;
  humanBone?: string;
  jointIndex?: number;
  sourceRestQuaternion?: readonly number[];
  sourceRestChildDirection?: readonly number[];
  seekTable: PackedRuntimeAnimationTrackSeekTable;
};

export type PackedRuntimeAnimation = {
  id: string;
  name?: string;
  duration: number;
  loop: boolean;
  archive: PackedRuntimeAnimationArchiveMetadata;
  keyControllers: readonly PackedRuntimeAnimationKeyController[];
  iframeTable: PackedRuntimeAnimationIframeTable;
  times: readonly number[];
  values: readonly number[];
  metadata?: Readonly<Record<string, unknown>>;
};

export type PackedRuntimeAnimationBuildResult =
  | { ok: true; animation: PackedRuntimeAnimation; issues: [] }
  | { ok: false; animation: null; issues: ClipValidationIssue[] };

export type PackedRuntimeAnimationStats = AnimationClipStats & {
  format: typeof PACKED_RUNTIME_ANIMATION_FORMAT;
  version: typeof PACKED_RUNTIME_ANIMATION_VERSION;
  packedTrackCount: number;
  iframeCount: number;
  seekTableEntryCount: number;
  archive: PackedRuntimeAnimationArchiveMetadata;
  keyControllers: readonly PackedRuntimeAnimationKeyController[];
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

export function tryOptimizeRawAnimation(rawAnimation: RawAnimation, options: AnimationOptimizerOptions = {}): RawAnimationOptimizationResult {
  const issues = validateRawAnimation(rawAnimation, options.skeleton);
  validateAnimationOptimizerOptions(issues, options);
  if (issues.length > 0) return { ok: false, rawAnimation: null, issues, stats: null };

  const optimized = optimizeValidatedRawAnimation(rawAnimation, options);
  const optimizedIssues = validateRawAnimation(optimized.rawAnimation, options.skeleton);
  if (optimizedIssues.length > 0) return { ok: false, rawAnimation: null, issues: optimizedIssues, stats: null };
  return { ok: true, rawAnimation: optimized.rawAnimation, issues: [], stats: optimized.stats };
}

export function optimizeRawAnimation(rawAnimation: RawAnimation, options: AnimationOptimizerOptions = {}): RawAnimation {
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

export function buildAdditiveAnimationClip(clip: AnimationClip, skeleton: Skeleton, options: AdditiveAnimationClipBuildOptions = {}): AnimationClip {
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

export function tryBuildPackedRuntimeAnimation(clip: AnimationClip, skeleton?: Skeleton): PackedRuntimeAnimationBuildResult {
  const issues = validatePackableClip(clip, skeleton);
  if (issues.length > 0) return { ok: false, animation: null, issues };

  const animation = buildValidatedPackedRuntimeAnimation(clip, skeleton);
  const packedIssues = validatePackedRuntimeAnimation(animation, skeleton);
  if (packedIssues.length > 0) return { ok: false, animation: null, issues: packedIssues };
  return { ok: true, animation, issues: [] };
}

export function buildPackedRuntimeAnimation(clip: AnimationClip, skeleton?: Skeleton): PackedRuntimeAnimation {
  const result = tryBuildPackedRuntimeAnimation(clip, skeleton);
  if (!result.ok) {
    throw new Error(`animation clip cannot be packed: ${result.issues.map(formatClipIssue).join("; ")}`);
  }
  return result.animation;
}

export function validatePackedRuntimeAnimation(animation: PackedRuntimeAnimation, skeleton?: Skeleton): ClipValidationIssue[] {
  const issues: ClipValidationIssue[] = [];
  if (!isPackedRuntimeAnimationObject(animation)) {
    issues.push({ message: "packed runtime animation must be an object" });
    return issues;
  }

  const candidate = animation as Partial<PackedRuntimeAnimation>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) issues.push({ message: "packed runtime animation id is required" });
  if (candidate.name !== undefined && typeof candidate.name !== "string") issues.push({ message: "packed runtime animation name must be a string" });
  if (!Number.isFinite(candidate.duration) || (candidate.duration ?? 0) <= 0) {
    issues.push({ message: "packed runtime animation duration must be positive and finite" });
  }
  if (typeof candidate.loop !== "boolean") issues.push({ message: "packed runtime animation loop must be a boolean" });

  validatePackedArchiveMetadata(issues, candidate);

  const controllers = Array.isArray(candidate.keyControllers) ? candidate.keyControllers : null;
  const times = Array.isArray(candidate.times) ? candidate.times : null;
  const values = Array.isArray(candidate.values) ? candidate.values : null;
  const iframeTimes = Array.isArray(candidate.iframeTable?.times) ? candidate.iframeTable.times : null;
  const iframeRatios = Array.isArray(candidate.iframeTable?.ratios) ? candidate.iframeTable.ratios : null;
  if (!controllers) issues.push({ message: "packed runtime animation keyControllers must be an array" });
  if (!times) issues.push({ message: "packed runtime animation times must be an array" });
  if (!values) issues.push({ message: "packed runtime animation values must be an array" });
  if (!iframeTimes) issues.push({ message: "packed runtime animation iframe times must be an array" });
  if (!iframeRatios) issues.push({ message: "packed runtime animation iframe ratios must be an array" });
  if (!controllers || !times || !values || !iframeTimes || !iframeRatios) return issues;

  if (controllers.length === 0) issues.push({ message: "packed runtime animation has no key controllers" });
  validateFiniteNumberArray(issues, times, "packed runtime animation times");
  validateFiniteNumberArray(issues, values, "packed runtime animation values");
  validatePackedIframeTable(issues, candidate.duration ?? 0, iframeTimes, iframeRatios);

  const resolvedChannels = new Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>();
  for (let index = 0; index < controllers.length; index += 1) {
    const controller = controllers[index]!;
    validatePackedKeyController(issues, controller, index, candidate.duration ?? 0, times, values, iframeTimes, skeleton, resolvedChannels);
    if (index > 0 && comparePackedKeyControllers(controllers[index - 1]!, controller) > 0) {
      issues.push({ track: index, joint: controllerTargetName(controller), property: String(controller.property), message: "packed key controllers must be sorted" });
    }
  }

  validatePackedArchiveConsistency(issues, candidate, controllers, iframeTimes);
  return issues;
}

export function getPackedRuntimeAnimationStats(animation: PackedRuntimeAnimation): PackedRuntimeAnimationStats {
  const perTrack: AnimationTrackStats[] = [];
  const joints = new Set<string>();
  let translationTrackCount = 0;
  let rotationTrackCount = 0;
  let scaleTrackCount = 0;
  let translationKeyCount = 0;
  let rotationKeyCount = 0;
  let scaleKeyCount = 0;
  let seekTableEntryCount = 0;

  for (const controller of animation.keyControllers) {
    joints.add(controller.targetKey);
    seekTableEntryCount += controller.seekTable.iframeLowerKeys.length + controller.seekTable.iframeUpperKeys.length;
    if (controller.normalizedProperty === "translation") {
      translationTrackCount += 1;
      translationKeyCount += controller.keyCount;
    } else if (controller.normalizedProperty === "rotation") {
      rotationTrackCount += 1;
      rotationKeyCount += controller.keyCount;
    } else {
      scaleTrackCount += 1;
      scaleKeyCount += controller.keyCount;
    }
    perTrack.push({
      track: controller.track,
      property: controller.property,
      normalizedProperty: controller.normalizedProperty,
      keyCount: controller.keyCount,
      valueCount: controller.keyCount * controller.stride,
      stride: controller.stride,
      firstTime: controller.firstTime,
      lastTime: controller.lastTime,
      ...(controller.joint !== undefined ? { joint: controller.joint } : {}),
      ...(controller.humanBone !== undefined ? { humanBone: controller.humanBone } : {}),
      ...(controller.jointIndex !== undefined ? { jointIndex: controller.jointIndex } : {})
    });
  }

  const jointCount = joints.size;
  return {
    id: animation.id,
    name: animation.name ?? "",
    duration: animation.duration,
    loop: animation.loop,
    trackCount: animation.keyControllers.length,
    jointCount,
    soaTrackCount: Math.ceil(jointCount / 4),
    timepointCount: animation.iframeTable.times.length,
    translationTrackCount,
    rotationTrackCount,
    scaleTrackCount,
    translationKeyCount,
    rotationKeyCount,
    scaleKeyCount,
    totalKeyCount: translationKeyCount + rotationKeyCount + scaleKeyCount,
    perTrack,
    format: PACKED_RUNTIME_ANIMATION_FORMAT,
    version: PACKED_RUNTIME_ANIMATION_VERSION,
    packedTrackCount: animation.keyControllers.length,
    iframeCount: animation.iframeTable.times.length,
    seekTableEntryCount,
    archive: animation.archive,
    keyControllers: animation.keyControllers
  };
}

export function samplePackedRuntimeAnimationToPose(
  skeleton: Skeleton,
  animation: PackedRuntimeAnimation,
  timeSeconds: number,
  options: SampleOptions = {}
): Pose {
  assertValidPackedRuntimeAnimation(animation, skeleton);
  return samplePackedRuntimeAnimationAtResolvedTime(animation, skeleton, samplePackedAnimationTime(animation, timeSeconds, options.loop ?? animation.loop), options);
}

export function samplePackedRuntimeAnimationToPoseAtRatio(
  skeleton: Skeleton,
  animation: PackedRuntimeAnimation,
  ratio: number,
  options: SampleRatioOptions = {}
): Pose {
  assertValidPackedRuntimeAnimation(animation, skeleton);
  return samplePackedRuntimeAnimationAtResolvedTime(animation, skeleton, samplePackedAnimationRatioToTime(animation, ratio), options);
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
  const modelSpace = options.includeModelSpace === true ? createModelSpaceSampleErrorAccumulator(options.skeleton) : undefined;
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
    report.modelSpace = finishModelSpaceSampleErrorAccumulator(modelSpace, times.length, jointSampleCount, times, options.skeleton);
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

type PackedRuntimeAnimationBuildTrack = {
  sourceTrack: number;
  targetKey: string;
  property: TrackProperty;
  normalizedProperty: NormalizedTrackProperty;
  stride: 3 | 4;
  keyCount: number;
  times: number[];
  values: number[];
  joint?: string;
  humanBone?: string;
  jointIndex?: number;
  sourceRestQuaternion?: readonly number[];
  sourceRestChildDirection?: readonly number[];
};

function validatePackableClip(clip: AnimationClip, skeleton?: Skeleton): ClipValidationIssue[] {
  const issues = validateClip(clip, skeleton);
  if (Array.isArray(clip.tracks) && clip.tracks.length === 0) {
    issues.push({ message: "clip has no transform tracks" });
  }
  return issues;
}

function buildValidatedPackedRuntimeAnimation(clip: AnimationClip, skeleton?: Skeleton): PackedRuntimeAnimation {
  const buildTracks = collectPackedRuntimeAnimationTracks(clip, skeleton).sort(comparePackedBuildTracks);
  const iframeTimes = freezeNumberArray(collectClipTimepoints(clip));
  const iframeRatios = freezeNumberArray(iframeTimes.map((time) => readClipTimeRatio(clip, time)));
  const packedTimes: number[] = [];
  const packedValues: number[] = [];
  const keyControllers: PackedRuntimeAnimationKeyController[] = [];
  let totalKeyCount = 0;

  for (let trackIndex = 0; trackIndex < buildTracks.length; trackIndex += 1) {
    const buildTrack = buildTracks[trackIndex]!;
    const timeOffset = packedTimes.length;
    const valueOffset = packedValues.length;
    packedTimes.push(...buildTrack.times);
    packedValues.push(...buildTrack.values);
    totalKeyCount += buildTrack.keyCount;

    const seekTable = freezePackedTrackSeekTable(buildPackedTrackSeekTable(buildTrack.times, iframeTimes));
    const controller: PackedRuntimeAnimationKeyController = {
      track: trackIndex,
      sourceTrack: buildTrack.sourceTrack,
      targetKey: buildTrack.targetKey,
      property: buildTrack.property,
      normalizedProperty: buildTrack.normalizedProperty,
      stride: buildTrack.stride,
      keyCount: buildTrack.keyCount,
      timeOffset,
      valueOffset,
      firstTime: buildTrack.times[0]!,
      lastTime: buildTrack.times[buildTrack.times.length - 1]!,
      seekTable
    };
    if (buildTrack.joint !== undefined) controller.joint = buildTrack.joint;
    if (buildTrack.humanBone !== undefined) controller.humanBone = buildTrack.humanBone;
    if (buildTrack.jointIndex !== undefined) controller.jointIndex = buildTrack.jointIndex;
    if (buildTrack.sourceRestQuaternion !== undefined) controller.sourceRestQuaternion = buildTrack.sourceRestQuaternion;
    if (buildTrack.sourceRestChildDirection !== undefined) controller.sourceRestChildDirection = buildTrack.sourceRestChildDirection;
    keyControllers.push(Object.freeze(controller));
  }

  const archive: PackedRuntimeAnimationArchiveMetadata = {
    format: PACKED_RUNTIME_ANIMATION_FORMAT,
    version: PACKED_RUNTIME_ANIMATION_VERSION,
    source: "AnimationClip",
    clipId: clip.id,
    duration: clip.duration,
    loop: clip.loop ?? false,
    trackCount: keyControllers.length,
    keyCount: totalKeyCount,
    iframeCount: iframeTimes.length
  };
  if (clip.name !== undefined) archive.clipName = clip.name;

  const animation: PackedRuntimeAnimation = {
    id: clip.id,
    duration: clip.duration,
    loop: clip.loop ?? false,
    archive: Object.freeze(archive),
    keyControllers: Object.freeze(keyControllers),
    iframeTable: Object.freeze({ times: iframeTimes, ratios: iframeRatios }),
    times: freezeNumberArray(packedTimes),
    values: freezeNumberArray(packedValues)
  };
  if (clip.name !== undefined) animation.name = clip.name;
  if (clip.metadata !== undefined) animation.metadata = cloneImmutableMetadataRecord(clip.metadata);
  return Object.freeze(animation);
}

function collectPackedRuntimeAnimationTracks(clip: AnimationClip, skeleton?: Skeleton): PackedRuntimeAnimationBuildTrack[] {
  const tracks: PackedRuntimeAnimationBuildTrack[] = [];
  for (let sourceTrack = 0; sourceTrack < clip.tracks.length; sourceTrack += 1) {
    const track = clip.tracks[sourceTrack]!;
    const normalizedProperty = normalizedTrackProperty(track.property)!;
    const stride = trackStride(normalizedProperty);
    const jointIndex = skeleton ? resolveTrackJointIndex(skeleton, track) : -1;
    const targetKey = readTrackTargetKey(track, skeleton, jointIndex) ?? String(track.joint ?? track.humanBone ?? "");
    const buildTrack: PackedRuntimeAnimationBuildTrack = {
      sourceTrack,
      targetKey,
      property: track.property,
      normalizedProperty,
      stride,
      keyCount: track.times.length,
      times: Array.from(track.times),
      values: Array.from(track.values)
    };
    if (track.joint !== undefined) buildTrack.joint = track.joint;
    if (track.humanBone !== undefined) buildTrack.humanBone = track.humanBone;
    if (jointIndex >= 0) buildTrack.jointIndex = jointIndex;
    if (track.sourceRestQuaternion !== undefined) buildTrack.sourceRestQuaternion = freezeNumberArray(track.sourceRestQuaternion);
    if (track.sourceRestChildDirection !== undefined) buildTrack.sourceRestChildDirection = freezeNumberArray(track.sourceRestChildDirection);
    tracks.push(buildTrack);
  }
  return tracks;
}

function collectClipTimepoints(clip: AnimationClip): number[] {
  const timepoints = new Set<number>();
  for (const track of clip.tracks) {
    for (let index = 0; index < track.times.length; index += 1) {
      timepoints.add(track.times[index]!);
    }
  }
  return Array.from(timepoints).sort((a, b) => a - b);
}

function comparePackedBuildTracks(a: PackedRuntimeAnimationBuildTrack, b: PackedRuntimeAnimationBuildTrack): number {
  if (a.jointIndex !== undefined && b.jointIndex !== undefined && a.jointIndex !== b.jointIndex) return a.jointIndex - b.jointIndex;
  const targetOrder = a.targetKey.localeCompare(b.targetKey);
  if (targetOrder !== 0) return targetOrder;
  const propertyOrder = RAW_ANIMATION_PROPERTY_RANK[a.normalizedProperty] - RAW_ANIMATION_PROPERTY_RANK[b.normalizedProperty];
  if (propertyOrder !== 0) return propertyOrder;
  return a.sourceTrack - b.sourceTrack;
}

function comparePackedKeyControllers(a: PackedRuntimeAnimationKeyController, b: PackedRuntimeAnimationKeyController): number {
  if (a.jointIndex !== undefined && b.jointIndex !== undefined && a.jointIndex !== b.jointIndex) return a.jointIndex - b.jointIndex;
  const targetOrder = a.targetKey.localeCompare(b.targetKey);
  if (targetOrder !== 0) return targetOrder;
  const propertyOrder = RAW_ANIMATION_PROPERTY_RANK[a.normalizedProperty] - RAW_ANIMATION_PROPERTY_RANK[b.normalizedProperty];
  if (propertyOrder !== 0) return propertyOrder;
  return a.sourceTrack - b.sourceTrack;
}

function buildPackedTrackSeekTable(trackTimes: readonly number[], iframeTimes: readonly number[]): PackedRuntimeAnimationTrackSeekTable {
  const iframeLowerKeys: number[] = [];
  const iframeUpperKeys: number[] = [];
  for (const time of iframeTimes) {
    const [lower, upper] = packedTrackTimeBracket(trackTimes, time);
    iframeLowerKeys.push(lower);
    iframeUpperKeys.push(upper);
  }
  return { iframeLowerKeys, iframeUpperKeys };
}

function freezePackedTrackSeekTable(table: PackedRuntimeAnimationTrackSeekTable): PackedRuntimeAnimationTrackSeekTable {
  return Object.freeze({
    iframeLowerKeys: freezeNumberArray(table.iframeLowerKeys),
    iframeUpperKeys: freezeNumberArray(table.iframeUpperKeys)
  });
}

function packedTrackTimeBracket(times: readonly number[], time: number): [number, number] {
  if (times.length <= 1) return [0, 0];
  if (time <= times[0]!) return [0, 0];
  const last = times.length - 1;
  if (time >= times[last]!) return [last, last];
  const lower = findLowerKeyInReadonlyArray(times, 0, times.length, time);
  const upper = lower + 1;
  if (Object.is(time, times[lower]) || time === times[lower]) return [lower, lower];
  if (Object.is(time, times[upper]) || time === times[upper]) return [upper, upper];
  return [lower, upper];
}

function samplePackedAnimationTime(animation: PackedRuntimeAnimation, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  if (loop && animation.duration > 0) return euclideanModulo(timeSeconds, animation.duration);
  return clamp(timeSeconds, 0, Math.max(0, animation.duration));
}

function samplePackedAnimationRatioToTime(animation: PackedRuntimeAnimation, ratio: number): number {
  return clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * animation.duration;
}

function samplePackedRuntimeAnimationAtResolvedTime(
  animation: PackedRuntimeAnimation,
  skeleton: Skeleton,
  time: number,
  options: SampleOptions | SampleRatioOptions
): Pose {
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) => cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint)));
  for (const controller of animation.keyControllers) {
    const jointIndex = resolvePackedTrackJointIndex(skeleton, controller);
    if (jointIndex < 0) continue;
    const diagnosticContext = { track: controller.track, joint: skeleton.joints[jointIndex]?.name ?? controllerTargetName(controller), index: jointIndex };
    const sampleOptions: TrackSampleOptions = { diagnosticContext };
    if (options.diagnostics !== undefined) sampleOptions.diagnostics = options.diagnostics;
    const sampled = samplePackedTrack(animation, controller, time, sampleOptions);
    const restTransform = readPoseTransformOrRest(skeleton, restPose, jointIndex);
    const transform = cloneTransform(output[jointIndex]);
    if (controller.normalizedProperty === "translation") transform.translation = sampled as Vec3;
    if (controller.normalizedProperty === "scale") transform.scale = sampled as Vec3;
    if (controller.normalizedProperty === "rotation") {
      transform.rotation = retargetSampledRotation(controller, restTransform.rotation, sampled as Quat, jointIndex, options, diagnosticContext);
    }
    output[jointIndex] = transform;
  }
  return output;
}

function samplePackedTrack(
  animation: PackedRuntimeAnimation,
  controller: PackedRuntimeAnimationKeyController,
  timeSeconds: number,
  options: TrackSampleOptions = {}
): number[] {
  if (controller.keyCount === 0) return defaultTrackSample(controller.normalizedProperty);
  const firstTime = animation.times[controller.timeOffset] ?? controller.firstTime;
  if (timeSeconds <= firstTime) return readPackedTrackValue(animation, controller, 0, options.diagnostics, options.diagnosticContext);

  const lastKey = controller.keyCount - 1;
  const lastTime = animation.times[controller.timeOffset + lastKey] ?? controller.lastTime;
  if (timeSeconds >= lastTime) return readPackedTrackValue(animation, controller, lastKey, options.diagnostics, options.diagnosticContext);

  const iframeIndex = findExactPackedIframe(animation.iframeTable.times, timeSeconds);
  if (iframeIndex >= 0) {
    const lower = controller.seekTable.iframeLowerKeys[iframeIndex] ?? 0;
    const upper = controller.seekTable.iframeUpperKeys[iframeIndex] ?? lower;
    return samplePackedTrackBracket(animation, controller, lower, upper, timeSeconds, options);
  }

  const lower = findLowerKeyInReadonlyArray(animation.times, controller.timeOffset, controller.keyCount, timeSeconds);
  return samplePackedTrackBracket(animation, controller, lower, lower + 1, timeSeconds, options);
}

function samplePackedTrackBracket(
  animation: PackedRuntimeAnimation,
  controller: PackedRuntimeAnimationKeyController,
  lower: number,
  upper: number,
  timeSeconds: number,
  options: TrackSampleOptions
): number[] {
  if (lower === upper) return readPackedTrackValue(animation, controller, lower, options.diagnostics, options.diagnosticContext);
  const start = animation.times[controller.timeOffset + lower] ?? controller.firstTime;
  const end = animation.times[controller.timeOffset + upper] ?? controller.lastTime;
  const t = end > start ? (timeSeconds - start) / (end - start) : 0;
  const a = readPackedTrackValue(animation, controller, lower, options.diagnostics, options.diagnosticContext);
  const b = readPackedTrackValue(animation, controller, upper, options.diagnostics, options.diagnosticContext);
  if (controller.stride === 4) return slerpQuat(a as Quat, b as Quat, t);
  return lerpVec3(a as Vec3, b as Vec3, t);
}

function readPackedTrackValue(
  animation: PackedRuntimeAnimation,
  controller: PackedRuntimeAnimationKeyController,
  keyIndex: number,
  diagnostics?: SampleRepairDiagnostic[],
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">
): number[] {
  const offset = controller.valueOffset + keyIndex * controller.stride;
  const fallback = defaultTrackSample(controller.normalizedProperty);
  const values = fallback.map((value, index) => animation.values[offset + index] ?? value);
  if (controller.stride === 4) pushRotationSampleRepairDiagnostic(diagnostics, diagnosticContext, controller, values as Quat, keyIndex);
  if (controller.stride === 4) return normalizeQuat(values as Quat, rotationSampleFallback(controller));
  return repairVec3Sample(controller, values as Vec3, fallback as Vec3, keyIndex, diagnostics, diagnosticContext);
}

function findExactPackedIframe(times: readonly number[], time: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = times[mid]!;
    if (Object.is(value, time) || value === time) return mid;
    if (value < time) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

function findLowerKeyInReadonlyArray(times: readonly number[], offset: number, keyCount: number, timeSeconds: number): number {
  let low = 1;
  let high = keyCount - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[offset + mid]! < timeSeconds) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function assertValidPackedRuntimeAnimation(animation: PackedRuntimeAnimation, skeleton?: Skeleton): void {
  const issues = validatePackedRuntimeAnimation(animation, skeleton);
  if (issues.length > 0) {
    throw new Error(`packed runtime animation is invalid: ${issues.map(formatClipIssue).join("; ")}`);
  }
}

function validatePackedArchiveMetadata(issues: ClipValidationIssue[], animation: Partial<PackedRuntimeAnimation>): void {
  const archive = animation.archive;
  if (!isPackedArchiveObject(archive)) {
    issues.push({ message: "packed runtime animation archive metadata must be an object" });
    return;
  }
  if (archive.format !== PACKED_RUNTIME_ANIMATION_FORMAT) issues.push({ message: "packed runtime animation archive format is unsupported" });
  if (archive.version !== PACKED_RUNTIME_ANIMATION_VERSION) issues.push({ message: "packed runtime animation archive version is unsupported" });
  if (archive.source !== "AnimationClip") issues.push({ message: "packed runtime animation archive source is unsupported" });
  if (archive.clipId !== animation.id) issues.push({ message: "packed runtime animation archive clipId does not match animation id" });
  if (archive.clipName !== undefined && archive.clipName !== animation.name) {
    issues.push({ message: "packed runtime animation archive clipName does not match animation name" });
  }
  if (archive.duration !== animation.duration) issues.push({ message: "packed runtime animation archive duration does not match animation duration" });
  if (archive.loop !== animation.loop) issues.push({ message: "packed runtime animation archive loop does not match animation loop" });
  if (!Number.isInteger(archive.trackCount) || archive.trackCount < 0) issues.push({ message: "packed runtime animation archive trackCount must be a non-negative integer" });
  if (!Number.isInteger(archive.keyCount) || archive.keyCount < 0) issues.push({ message: "packed runtime animation archive keyCount must be a non-negative integer" });
  if (!Number.isInteger(archive.iframeCount) || archive.iframeCount < 0) issues.push({ message: "packed runtime animation archive iframeCount must be a non-negative integer" });
}

function validatePackedArchiveConsistency(
  issues: ClipValidationIssue[],
  animation: Partial<PackedRuntimeAnimation>,
  controllers: readonly PackedRuntimeAnimationKeyController[],
  iframeTimes: readonly number[]
): void {
  const archive = animation.archive;
  if (!isPackedArchiveObject(archive)) return;
  const keyCount = controllers.reduce((sum, controller) => sum + (Number.isInteger(controller.keyCount) ? controller.keyCount : 0), 0);
  if (archive.trackCount !== controllers.length) issues.push({ message: "packed runtime animation archive trackCount does not match key controllers" });
  if (archive.keyCount !== keyCount) issues.push({ message: "packed runtime animation archive keyCount does not match key controllers" });
  if (archive.iframeCount !== iframeTimes.length) issues.push({ message: "packed runtime animation archive iframeCount does not match iframe table" });
}

function validatePackedIframeTable(
  issues: ClipValidationIssue[],
  duration: number,
  iframeTimes: readonly number[],
  iframeRatios: readonly number[]
): void {
  if (iframeTimes.length !== iframeRatios.length) {
    issues.push({ message: "packed runtime animation iframe ratio count must match iframe time count" });
  }
  let previous = -Infinity;
  for (let index = 0; index < iframeTimes.length; index += 1) {
    const time = iframeTimes[index]!;
    const ratio = iframeRatios[index] ?? Number.NaN;
    if (!Number.isFinite(time)) issues.push({ index, message: "packed runtime animation iframe time is not finite" });
    else {
      if (time < 0 || time > duration) issues.push({ index, message: "packed runtime animation iframe time must be within animation duration" });
      if (time <= previous) issues.push({ index, message: "packed runtime animation iframe times must be unique and sorted" });
      previous = time;
    }
    if (!Number.isFinite(ratio)) {
      issues.push({ index, message: "packed runtime animation iframe ratio is not finite" });
    } else if (Math.abs(ratio - readDurationRatio(duration, time)) > 1e-6) {
      issues.push({ index, message: "packed runtime animation iframe ratio does not match time and duration" });
    }
  }
}

function validatePackedKeyController(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  duration: number,
  times: readonly number[],
  values: readonly number[],
  iframeTimes: readonly number[],
  skeleton: Skeleton | undefined,
  resolvedChannels: Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>
): void {
  if (!isPackedKeyControllerObject(controller)) {
    issues.push({ track: index, message: "packed key controller must be an object" });
    return;
  }
  const property = normalizedTrackProperty(String(controller.normalizedProperty));
  const stride = property ? trackStride(property) : null;
  const targetName = controllerTargetName(controller);
  if (controller.track !== index) issues.push({ track: index, joint: targetName, message: "packed key controller track index must match sorted order" });
  if (!Number.isInteger(controller.sourceTrack) || controller.sourceTrack < 0) {
    issues.push({ track: index, joint: targetName, message: "packed key controller sourceTrack must be a non-negative integer" });
  }
  if (typeof controller.targetKey !== "string" || controller.targetKey.length === 0) {
    issues.push({ track: index, joint: targetName, message: "packed key controller targetKey is required" });
  }
  if (!property || property !== controller.normalizedProperty) {
    issues.push({ track: index, joint: targetName, property: String(controller.normalizedProperty), message: "packed key controller property is unsupported" });
    return;
  }
  if (normalizedTrackProperty(String(controller.property)) !== property) {
    issues.push({ track: index, joint: targetName, property: String(controller.property), message: "packed key controller source property does not match normalized property" });
  }
  if (controller.stride !== stride) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller stride does not match property" });
  }
  const keyCountValid = Number.isInteger(controller.keyCount) && controller.keyCount > 0;
  const timeRangeValid = Number.isInteger(controller.timeOffset) && controller.timeOffset >= 0 && controller.timeOffset + Math.max(0, controller.keyCount) <= times.length;
  const valueRangeValid =
    Number.isInteger(controller.valueOffset) && controller.valueOffset >= 0 && controller.valueOffset + Math.max(0, controller.keyCount) * controller.stride <= values.length;
  if (!keyCountValid) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller keyCount must be positive" });
  }
  if (!timeRangeValid) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller timeOffset is out of range" });
  }
  if (!valueRangeValid) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller valueOffset is out of range" });
  }
  validatePackedControllerTarget(issues, controller, index, property, skeleton, resolvedChannels);
  validatePackedControllerSourceRest(issues, controller, index, property);
  if (keyCountValid && timeRangeValid && valueRangeValid) {
    validatePackedControllerTimesAndValues(issues, controller, index, duration, property, times, values);
  }
  validatePackedSeekTable(issues, controller, index, iframeTimes, times);
}

function validatePackedControllerTarget(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  property: NormalizedTrackProperty,
  skeleton: Skeleton | undefined,
  resolvedChannels: Map<string, { track: number; joint: string; property: NormalizedTrackProperty }>
): void {
  const hasJoint = controller.joint !== undefined;
  const hasHumanBone = controller.humanBone !== undefined;
  const targetName = controllerTargetName(controller);
  if (hasJoint === hasHumanBone) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller needs exactly one joint or humanBone target" });
    return;
  }
  if (hasJoint && (typeof controller.joint !== "string" || controller.joint.length === 0)) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller joint target must be a non-empty string" });
  }
  if (hasHumanBone) {
    if (typeof controller.humanBone !== "string" || controller.humanBone.length === 0) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller humanBone target must be a non-empty string" });
    } else if (!isHumanoidBoneName(controller.humanBone)) {
      issues.push({ track: index, joint: controller.humanBone, property: controller.property, message: "packed key controller has unknown humanoid bone" });
    }
  }
  if (controller.jointIndex !== undefined && (!Number.isInteger(controller.jointIndex) || controller.jointIndex < 0)) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller jointIndex must be a non-negative integer" });
  }

  const jointIndex = skeleton ? resolvePackedTrackJointIndex(skeleton, controller) : -1;
  if (skeleton) {
    if (jointIndex < 0) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller does not map to skeleton" });
    } else if (controller.jointIndex !== undefined && controller.jointIndex !== jointIndex) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller jointIndex does not match skeleton target" });
    }
  }

  const channelKey = skeleton && jointIndex >= 0 ? `${jointIndex}:${property}` : `${String(controller.joint ?? controller.humanBone ?? "")}:${property}`;
  const existing = resolvedChannels.get(channelKey);
  if (existing) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: `duplicate packed target channel ${targetName}.${property} conflicts with track ${existing.track} (${existing.joint}.${existing.property})`
    });
  } else {
    resolvedChannels.set(channelKey, { track: index, joint: targetName, property });
  }
}

function validatePackedControllerSourceRest(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  property: NormalizedTrackProperty
): void {
  const targetName = controllerTargetName(controller);
  if (controller.sourceRestQuaternion !== undefined) {
    if (property !== "rotation") {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestQuaternion is only valid on rotation tracks" });
    }
    if (controller.sourceRestQuaternion.length !== 4) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestQuaternion must contain exactly 4 values" });
    } else {
      const issue = quaternionNormalizationIssue(controller.sourceRestQuaternion, SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE, {
        finite: "sourceRestQuaternion values must be finite",
        normalizable: "sourceRestQuaternion must be normalizable",
        normalized: "sourceRestQuaternion must be normalized"
      });
      if (issue) issues.push({ track: index, joint: targetName, property: controller.property, message: issue.message });
    }
  }
  if (controller.sourceRestChildDirection !== undefined) {
    if (property !== "rotation") {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestChildDirection is only valid on rotation tracks" });
    }
    if (controller.sourceRestChildDirection.length !== 3) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestChildDirection must contain exactly 3 values" });
    } else if (!controller.sourceRestChildDirection.every(Number.isFinite)) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestChildDirection values must be finite" });
    } else if (Math.hypot(controller.sourceRestChildDirection[0]!, controller.sourceRestChildDirection[1]!, controller.sourceRestChildDirection[2]!) <= EPSILON) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "sourceRestChildDirection must be normalizable" });
    }
  }
}

function validatePackedControllerTimesAndValues(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  duration: number,
  property: NormalizedTrackProperty,
  times: readonly number[],
  values: readonly number[]
): void {
  const targetName = controllerTargetName(controller);
  let previous = -Infinity;
  for (let key = 0; key < controller.keyCount; key += 1) {
    const time = times[controller.timeOffset + key] ?? Number.NaN;
    if (!Number.isFinite(time)) issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key time is not finite" });
    else {
      if (time < 0 || time > duration) {
        issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key time is out of range" });
      }
      if (time <= previous) issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key times must be sorted" });
      previous = time;
    }
    for (let component = 0; component < controller.stride; component += 1) {
      if (!Number.isFinite(values[controller.valueOffset + key * controller.stride + component])) {
        issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key values must be finite" });
        break;
      }
    }
  }
  if (controller.keyCount > 0) {
    if (controller.firstTime !== times[controller.timeOffset]) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller firstTime does not match key data" });
    }
    if (controller.lastTime !== times[controller.timeOffset + controller.keyCount - 1]) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller lastTime does not match key data" });
    }
  }
  if (property === "rotation") validatePackedRotationValues(issues, controller, index, targetName, values);
}

function validatePackedRotationValues(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  targetName: string,
  values: readonly number[]
): void {
  let reportedNonNormalizable = false;
  let reportedNonNormalized = false;
  for (let sample = 0; sample < controller.keyCount; sample += 1) {
    const offset = controller.valueOffset + sample * 4;
    const issue = quaternionNormalizationIssue(
      [values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!],
      ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE,
      {
        finite: "rotation track quaternions must be finite",
        normalizable: "rotation track quaternions must be normalizable",
        normalized: "rotation track quaternions must be normalized"
      }
    );
    if (issue?.kind === "normalizable") {
      if (!reportedNonNormalizable) {
        issues.push({ track: index, joint: targetName, property: controller.property, message: issue.message });
        reportedNonNormalizable = true;
      }
      continue;
    }
    if (issue?.kind === "normalized" && !reportedNonNormalized) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: issue.message });
      reportedNonNormalized = true;
    }
    if (reportedNonNormalizable && reportedNonNormalized) return;
  }
}

function validatePackedSeekTable(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  iframeTimes: readonly number[],
  times: readonly number[]
): void {
  const targetName = controllerTargetName(controller);
  const lower = controller.seekTable?.iframeLowerKeys;
  const upper = controller.seekTable?.iframeUpperKeys;
  if (!Array.isArray(lower) || !Array.isArray(upper)) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed key controller seek table must contain iframe key arrays" });
    return;
  }
  if (lower.length !== iframeTimes.length || upper.length !== iframeTimes.length) {
    issues.push({ track: index, joint: targetName, property: controller.property, message: "packed seek table length must match iframe table length" });
  }
  const count = Math.min(lower.length, upper.length);
  for (let iframe = 0; iframe < count; iframe += 1) {
    const lowerKey = lower[iframe]!;
    const upperKey = upper[iframe]!;
    if (!Number.isInteger(lowerKey) || !Number.isInteger(upperKey) || lowerKey < 0 || upperKey < 0 || lowerKey >= controller.keyCount || upperKey >= controller.keyCount) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed seek table key index is out of range" });
      return;
    }
    if (lowerKey > upperKey) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed seek table lower key must not exceed upper key" });
      return;
    }
  }
  if (!canValidatePackedSeekTableAgainstTimes(controller, times, iframeTimes)) return;

  const trackTimes = times.slice(controller.timeOffset, controller.timeOffset + controller.keyCount);
  for (let iframe = 0; iframe < count; iframe += 1) {
    const [expectedLower, expectedUpper] = packedTrackTimeBracket(trackTimes, iframeTimes[iframe]!);
    if (lower[iframe] !== expectedLower || upper[iframe] !== expectedUpper) {
      issues.push({ track: index, joint: targetName, property: controller.property, message: "packed seek table does not match key times" });
      return;
    }
  }
}

function canValidatePackedSeekTableAgainstTimes(
  controller: PackedRuntimeAnimationKeyController,
  times: readonly number[],
  iframeTimes: readonly number[]
): boolean {
  if (!Number.isInteger(controller.timeOffset) || !Number.isInteger(controller.keyCount) || controller.keyCount <= 0) return false;
  if (controller.timeOffset < 0 || controller.timeOffset + controller.keyCount > times.length) return false;
  for (let key = 0; key < controller.keyCount; key += 1) {
    const time = times[controller.timeOffset + key];
    if (!Number.isFinite(time)) return false;
    if (key > 0 && time! <= times[controller.timeOffset + key - 1]!) return false;
  }
  return iframeTimes.every(Number.isFinite);
}

function validateFiniteNumberArray(issues: ClipValidationIssue[], values: readonly number[], label: string): void {
  if (values.some((value) => !Number.isFinite(value))) issues.push({ message: `${label} must contain finite numbers` });
}

function readDurationRatio(duration: number, time: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp(Number.isFinite(time) ? time / duration : 0, 0, 1);
}

function resolvePackedTrackJointIndex(skeleton: Skeleton, controller: PackedRuntimeAnimationKeyController): number {
  if (controller.joint !== undefined) return resolveJointIndex(skeleton, controller.joint);
  if (controller.humanBone !== undefined) return resolveHumanoidIndex(skeleton, controller.humanBone as HumanoidBoneName);
  return controller.jointIndex !== undefined && controller.jointIndex < skeleton.joints.length ? controller.jointIndex : -1;
}

function controllerTargetName(controller: Pick<PackedRuntimeAnimationKeyController, "joint" | "humanBone" | "jointIndex" | "targetKey">): string {
  return String(controller.joint ?? controller.humanBone ?? controller.jointIndex ?? controller.targetKey ?? "");
}

function formatClipIssue(issue: ClipValidationIssue): string {
  const pieces: string[] = [];
  if (issue.track !== undefined) pieces.push(`track ${issue.track}`);
  if (issue.index !== undefined) pieces.push(`index ${issue.index}`);
  if (issue.joint) pieces.push(issue.joint);
  if (issue.property) pieces.push(issue.property);
  pieces.push(issue.message);
  return pieces.join(" ");
}

function isPackedRuntimeAnimationObject(value: unknown): value is PackedRuntimeAnimation {
  return typeof value === "object" && value !== null;
}

function isPackedArchiveObject(value: unknown): value is PackedRuntimeAnimationArchiveMetadata {
  return typeof value === "object" && value !== null;
}

function isPackedKeyControllerObject(value: unknown): value is PackedRuntimeAnimationKeyController {
  return typeof value === "object" && value !== null;
}

function freezeNumberArray(values: Iterable<number> | ArrayLike<number>): readonly number[] {
  return Object.freeze(Array.from(values));
}

function cloneImmutableMetadataRecord(metadata: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const cloned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) cloned[key] = cloneImmutableMetadataValue(value);
  return Object.freeze(cloned);
}

function cloneImmutableMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneImmutableMetadataValue));
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const cloned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) cloned[key] = cloneImmutableMetadataValue(child);
    return Object.freeze(cloned);
  }
  return value;
}

const DEFAULT_ANIMATION_OPTIMIZER_TOLERANCES: Required<AnimationOptimizerTolerances> = {
  translation: 1e-3,
  rotation: 1e-3,
  scale: 1e-3
};

function validateAnimationOptimizerOptions(issues: RawAnimationValidationIssue[], options: AnimationOptimizerOptions): void {
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
      validateAnimationOptimizerTolerance(issues, tolerance[property], `animation optimizer ${joint}.${property} tolerance`, joint, property);
    }
    validateAnimationOptimizerTolerance(issues, tolerance.weight, `animation optimizer ${joint}.weight`, joint);
    if (tolerance.weight !== undefined && tolerance.weight <= 0) {
      issues.push({ joint, message: "animation optimizer joint weight must be positive" });
    }
  }
}

function validateAnimationOptimizerSampleErrorOptions(issues: RawAnimationValidationIssue[], options: AnimationOptimizerOptions): void {
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
  if (sampleError.sampleFrequency !== undefined && (!Number.isFinite(sampleError.sampleFrequency) || sampleError.sampleFrequency <= 0)) {
    issues.push({ message: "animation optimizer sampleError sampleFrequency must be positive and finite" });
  }
  if (sampleError.sampleTimes !== undefined) {
    if (!Array.isArray(sampleError.sampleTimes)) {
      issues.push({ message: "animation optimizer sampleError sampleTimes must be an array" });
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

function optimizeValidatedRawAnimation(rawAnimation: RawAnimation, options: AnimationOptimizerOptions): { rawAnimation: RawAnimation; stats: AnimationOptimizationStats } {
  const descendantCounts = options.skeleton ? countSkeletonDescendants(options.skeleton) : [];
  const channels: AnimationOptimizationChannelStats[] = [];
  let inputKeyCount = 0;
  let outputKeyCount = 0;

  const tracks = readRawAnimationTracks(rawAnimation).map((track, trackIndex): RawAnimationJointTrack => {
    const target = readRawAnimationTarget(track, options.skeleton);
    const translations = optimizeRawAnimationVec3Keys(track.translations, "translation", track, trackIndex, target, options, descendantCounts, channels);
    const rotations = optimizeRawAnimationQuaternionKeys(track.rotations, track, trackIndex, target, options, descendantCounts, channels);
    const scales = optimizeRawAnimationVec3Keys(track.scales, "scale", track, trackIndex, target, options, descendantCounts, channels);
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
    stats.sampleError = compareAnimationSampleError(rawAnimation, optimized, createOptimizerSampleErrorOptions(options));
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
  pushAnimationOptimizationChannelStats(stats, track, trackIndex, target, property, keys.length, optimized.length, tolerance);
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
  pushAnimationOptimizationChannelStats(stats, track, trackIndex, target, "rotation", keys.length, optimized.length, tolerance);
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
  const base = override?.[property] ?? options.tolerances?.[property] ?? DEFAULT_ANIMATION_OPTIMIZER_TOLERANCES[property];
  const jointWeight = override?.weight ?? 1;
  const hierarchyWeight = options.hierarchyWeight ?? 0;
  const descendantCount = target.jointIndex >= 0 ? descendantCounts[target.jointIndex] ?? 0 : 0;
  return {
    effective: base / jointWeight / (1 + hierarchyWeight * descendantCount),
    jointWeight,
    hierarchyWeight,
    descendantCount
  };
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
    const expected = slerpQuat(normalizeQuat(cloneQuat((left as RawAnimationQuaternionKey).value)), normalizeQuat(cloneQuat((right as RawAnimationQuaternionKey).value)), alpha);
    return quaternionAngleError(expected, normalizeQuat(cloneQuat((key as RawAnimationQuaternionKey).value)));
  }
  const expected = lerpVec3(cloneVec3((left as RawAnimationVec3Key).value), cloneVec3((right as RawAnimationVec3Key).value), alpha);
  return vec3Error(expected, cloneVec3((key as RawAnimationVec3Key).value));
}

function cloneRawAnimationKey(key: RawAnimationVec3Key | RawAnimationQuaternionKey, property: NormalizedTrackProperty): RawAnimationVec3Key | RawAnimationQuaternionKey {
  return property === "rotation" ? cloneRawAnimationQuaternionKey(key as RawAnimationQuaternionKey) : cloneRawAnimationVec3Key(key as RawAnimationVec3Key);
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

function buildValidatedAdditiveAnimationClip(clip: AnimationClip, skeleton: Skeleton, options: AdditiveAnimationClipBuildOptions): AnimationClip {
  const tracks = clip.tracks.map((track): AnimationTrack => {
    const property = normalizedTrackProperty(track.property)!;
    const stride = trackStride(property);
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    const restTransform = skeleton.restPose[jointIndex]!;
    const referenceTransform = options.referencePose?.[jointIndex] ?? sampleClipToPose(skeleton, clip, track.times[0]!, {
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
        values.set(value as Vec3, offset);
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

function validateAdditiveReferencePose(issues: ClipValidationIssue[], skeleton: Skeleton, pose: readonly Transform[], label: string): void {
  if (pose.length !== skeleton.joints.length) {
    issues.push({ joint: `<${label}>`, index: -1, message: `${label} length ${pose.length} does not match skeleton ${skeleton.joints.length}` });
    return;
  }
  for (let index = 0; index < pose.length; index += 1) {
    const transform = pose[index];
    if (!transform || !isValidAdditiveReferenceTransform(transform)) {
      issues.push({ joint: skeleton.joints[index]?.name ?? String(index), index, message: `${label} transform is not finite or quaternion is invalid` });
    }
  }
}

function isValidAdditiveReferenceTransform(transform: Transform): boolean {
  return (
    transform.translation.every(Number.isFinite) &&
    transform.rotation.every(Number.isFinite) &&
    transform.scale.every(Number.isFinite) &&
    Math.hypot(...transform.rotation) > EPSILON
  );
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

function assertValidAnimationSampleSource(source: RawAnimation | AnimationClip, skeleton: Skeleton, label: string): void {
  if (isRawAnimationSampleSource(source)) {
    const issues = validateRawAnimation(source, skeleton);
    if (issues.length > 0) throw new Error(`${label} raw animation is invalid: ${issues.map(formatRawAnimationIssue).join("; ")}`);
    return;
  }
  const issues = validateClip(source as AnimationClip, skeleton);
  if (issues.length > 0) throw new Error(`${label} animation clip is invalid: ${issues.map(formatClipIssue).join("; ")}`);
}

function isRawAnimationSampleSource(source: RawAnimation | AnimationClip): source is RawAnimation {
  return Array.isArray(source.tracks) && source.tracks.some((track) => "translations" in track || "rotations" in track || "scales" in track);
}

function readAnimationSampleErrorTimes(reference: RawAnimation | AnimationClip, options: AnimationSampleErrorOptions): readonly number[] {
  if (options.sampleTimes !== undefined) {
    const times = Array.from(options.sampleTimes);
    if (times.some((time) => !Number.isFinite(time))) throw new Error("animation sample error sampleTimes must contain finite values");
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
  const options: SampleOptions = { loop: loop ?? (source as AnimationClip).loop ?? false };
  if (restPose !== undefined) options.restPose = restPose;
  return sampleClipToPose(skeleton, source as AnimationClip, time, options);
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

function pushSampleError(accumulator: AnimationSampleErrorAccumulator, error: number, sample: number, time: number, jointIndex: number): void {
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

function finishSampleErrorAccumulator(accumulator: AnimationSampleErrorAccumulator, sampleCount: number, skeleton: Skeleton): AnimationSampleErrorMetric {
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
    joints: accumulator.joints.map((joint, jointIndex): AnimationModelSpaceJointSampleError => ({
      jointIndex,
      joint: skeleton.joints[jointIndex]?.name ?? String(jointIndex),
      position: finishSampleErrorAccumulator(joint.position, sampleCount, skeleton),
      rotation: finishSampleErrorAccumulator(joint.rotation, sampleCount, skeleton),
      scale: finishSampleErrorAccumulator(joint.scale, sampleCount, skeleton)
    }))
  };
}

function createModelSpaceComparablePose(skeleton: Skeleton, localPose: readonly Transform[]): ModelSpaceComparableTransform[] {
  const modelPose = localToModelPose(skeleton, localPose);
  const output: ModelSpaceComparableTransform[] = [];
  for (let jointIndex = 0; jointIndex < skeleton.joints.length; jointIndex += 1) {
    const local = readPoseTransformOrRest(skeleton, localPose, jointIndex);
    const parentIndex = skeleton.joints[jointIndex]!.parentIndex;
    const parent = parentIndex >= 0 ? output[parentIndex] : undefined;
    if (parentIndex >= 0 && !parent) throw new Error(`model pose for parent ${parentIndex} must be available before comparing joint ${jointIndex}`);
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

function mat4Translation(matrix: Mat4): Vec3 {
  return [finiteMat4Value(matrix, 12, 0), finiteMat4Value(matrix, 13, 0), finiteMat4Value(matrix, 14, 0)];
}

function finiteMat4Value(matrix: Mat4, index: number, fallback: number): number {
  const value = matrix[index];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

type TrackMetadataForSampling = {
  property: TrackProperty;
  joint?: string;
  humanBone?: string;
  sourceRestQuaternion?: ArrayLike<number>;
  sourceRestChildDirection?: ArrayLike<number>;
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

function rotationSampleFallback(track: TrackMetadataForSampling): Quat {
  return track.sourceRestQuaternion?.length === 4 ? cloneNormalizedQuat(track.sourceRestQuaternion) : cloneQuat(undefined);
}

function pushRotationSampleRepairDiagnostic(
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

function repairVec3Sample(
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
