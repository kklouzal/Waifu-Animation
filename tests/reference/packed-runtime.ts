import {
  type Quat,
  type Vec3,
  EPSILON,
  clamp,
  cloneTransform,
  euclideanModulo,
  lerpVec3,
  normalizeQuat,
  slerpQuat
} from "../../src/math.js";
import { type Pose, readPoseTransformOrRest } from "./pose.js";
import {
  type HumanoidBoneName,
  type Skeleton,
  createRestPose,
  isHumanoidBoneName,
  resolveHumanoidIndex,
  resolveJointIndex
} from "../../src/skeleton.js";
import type {
  AnimationClip,
  ClipValidationIssue,
  NormalizedTrackProperty,
  RotationSpace,
  SampleOptions,
  SampleRatioOptions,
  SampleRepairDiagnostic,
  TrackProperty
} from "../../src/clip-types.js";
import type { AnimationClipStats, AnimationTrackStats } from "../../src/clip-sampling.js";
import {
  ROTATION_QUATERNION_LENGTH_SQUARED_TOLERANCE,
  SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE,
  defaultTrackSample,
  formatClipIssue,
  normalizedTrackProperty,
  pushRotationSampleRepairDiagnostic,
  quaternionNormalizationIssue,
  readClipTimeRatio,
  readTrackTargetKey,
  repairVec3Sample,
  resolveTrackJointIndex,
  retargetSampledRotation,
  rotationSampleFallback,
  trackStride,
  validateClip
} from "../../src/clip-internal.js";

const PACKED_RUNTIME_PROPERTY_RANK: Readonly<Record<NormalizedTrackProperty, number>> = {
  translation: 0,
  rotation: 1,
  scale: 2
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
  rotationSpace?: RotationSpace;
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

type TrackSampleOptions = {
  diagnostics?: SampleRepairDiagnostic[];
  diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">;
};

export function tryBuildPackedRuntimeAnimation(
  clip: AnimationClip,
  skeleton?: Skeleton
): PackedRuntimeAnimationBuildResult {
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

export function validatePackedRuntimeAnimation(
  animation: PackedRuntimeAnimation,
  skeleton?: Skeleton
): ClipValidationIssue[] {
  const issues: ClipValidationIssue[] = [];
  if (!isPackedRuntimeAnimationObject(animation)) {
    issues.push({ message: "packed runtime animation must be an object" });
    return issues;
  }

  const candidate = animation as Partial<PackedRuntimeAnimation>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0)
    issues.push({ message: "packed runtime animation id is required" });
  if (candidate.name !== undefined && typeof candidate.name !== "string")
    issues.push({ message: "packed runtime animation name must be a string" });
  if (!Number.isFinite(candidate.duration) || (candidate.duration ?? 0) <= 0) {
    issues.push({ message: "packed runtime animation duration must be positive and finite" });
  }
  if (typeof candidate.loop !== "boolean") issues.push({ message: "packed runtime animation loop must be a boolean" });

  validatePackedArchiveMetadata(issues, candidate);

  const controllers = asReadonlyArray(candidate.keyControllers);
  const times = asReadonlyArray(candidate.times);
  const values = asReadonlyArray(candidate.values);
  const iframeTimes = asReadonlyArray(candidate.iframeTable?.times);
  const iframeRatios = asReadonlyArray(candidate.iframeTable?.ratios);
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
    validatePackedKeyController(
      issues,
      controller,
      index,
      candidate.duration ?? 0,
      times,
      values,
      iframeTimes,
      skeleton,
      resolvedChannels
    );
    if (
      index > 0 &&
      isPackedKeyControllerObject(controllers[index - 1]) &&
      isPackedKeyControllerObject(controller) &&
      comparePackedKeyControllers(controllers[index - 1]!, controller) > 0
    ) {
      issues.push({
        track: index,
        joint: controllerTargetName(controller),
        property: String(controller.property),
        message: "packed key controllers must be sorted"
      });
    }
  }

  validatePackedArchiveConsistency(issues, candidate, controllers, iframeTimes);
  validatePackedBufferCoverage(issues, controllers, times, values);
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
  return samplePackedRuntimeAnimationAtResolvedTime(
    animation,
    skeleton,
    samplePackedAnimationTime(animation, timeSeconds, options.loop ?? animation.loop),
    options
  );
}

export function samplePackedRuntimeAnimationToPoseAtRatio(
  skeleton: Skeleton,
  animation: PackedRuntimeAnimation,
  ratio: number,
  options: SampleRatioOptions = {}
): Pose {
  assertValidPackedRuntimeAnimation(animation, skeleton);
  return samplePackedRuntimeAnimationAtResolvedTime(
    animation,
    skeleton,
    samplePackedAnimationRatioToTime(animation, ratio),
    options
  );
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
  rotationSpace?: RotationSpace;
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
    if (buildTrack.rotationSpace !== undefined) controller.rotationSpace = buildTrack.rotationSpace;
    if (buildTrack.sourceRestQuaternion !== undefined)
      controller.sourceRestQuaternion = buildTrack.sourceRestQuaternion;
    if (buildTrack.sourceRestChildDirection !== undefined)
      controller.sourceRestChildDirection = buildTrack.sourceRestChildDirection;
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

function collectPackedRuntimeAnimationTracks(
  clip: AnimationClip,
  skeleton?: Skeleton
): PackedRuntimeAnimationBuildTrack[] {
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
    if (track.rotationSpace !== undefined) buildTrack.rotationSpace = track.rotationSpace;
    if (track.sourceRestQuaternion !== undefined)
      buildTrack.sourceRestQuaternion = freezeNumberArray(track.sourceRestQuaternion);
    if (track.sourceRestChildDirection !== undefined)
      buildTrack.sourceRestChildDirection = freezeNumberArray(track.sourceRestChildDirection);
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
  if (a.jointIndex !== undefined && b.jointIndex !== undefined && a.jointIndex !== b.jointIndex)
    return a.jointIndex - b.jointIndex;
  const targetOrder = a.targetKey.localeCompare(b.targetKey);
  if (targetOrder !== 0) return targetOrder;
  const propertyOrder =
    PACKED_RUNTIME_PROPERTY_RANK[a.normalizedProperty] - PACKED_RUNTIME_PROPERTY_RANK[b.normalizedProperty];
  if (propertyOrder !== 0) return propertyOrder;
  return a.sourceTrack - b.sourceTrack;
}

function comparePackedKeyControllers(
  a: PackedRuntimeAnimationKeyController,
  b: PackedRuntimeAnimationKeyController
): number {
  if (a.jointIndex !== undefined && b.jointIndex !== undefined && a.jointIndex !== b.jointIndex)
    return a.jointIndex - b.jointIndex;
  const targetOrder = String(a.targetKey ?? "").localeCompare(String(b.targetKey ?? ""));
  if (targetOrder !== 0) return targetOrder;
  const propertyOrder = packedControllerPropertyRank(a) - packedControllerPropertyRank(b);
  if (propertyOrder !== 0) return propertyOrder;
  return a.sourceTrack - b.sourceTrack;
}

function packedControllerPropertyRank(controller: PackedRuntimeAnimationKeyController): number {
  return PACKED_RUNTIME_PROPERTY_RANK[controller.normalizedProperty] ?? Number.POSITIVE_INFINITY;
}

function buildPackedTrackSeekTable(
  trackTimes: readonly number[],
  iframeTimes: readonly number[]
): PackedRuntimeAnimationTrackSeekTable {
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
  const duration = Number.isFinite(animation.duration) && animation.duration > 0 ? animation.duration : 0;
  if (loop && duration > 0) return euclideanModulo(timeSeconds, duration);
  return clamp(timeSeconds, 0, duration);
}

function samplePackedAnimationRatioToTime(animation: PackedRuntimeAnimation, ratio: number): number {
  const duration = Number.isFinite(animation.duration) && animation.duration > 0 ? animation.duration : 0;
  return clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * duration;
}

function samplePackedRuntimeAnimationAtResolvedTime(
  animation: PackedRuntimeAnimation,
  skeleton: Skeleton,
  time: number,
  options: SampleOptions | SampleRatioOptions
): Pose {
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) =>
    cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint))
  );
  for (const controller of animation.keyControllers) {
    const jointIndex = resolvePackedTrackJointIndex(skeleton, controller);
    if (jointIndex < 0) continue;
    const diagnosticContext = {
      track: controller.track,
      joint: skeleton.joints[jointIndex]?.name ?? controllerTargetName(controller),
      index: jointIndex
    };
    const sampleOptions: TrackSampleOptions = { diagnosticContext };
    if (options.diagnostics !== undefined) sampleOptions.diagnostics = options.diagnostics;
    const sampled = samplePackedTrack(animation, controller, time, sampleOptions);
    const restTransform = readPoseTransformOrRest(skeleton, restPose, jointIndex);
    const transform = cloneTransform(output[jointIndex]);
    if (controller.normalizedProperty === "translation") transform.translation = sampled as Vec3;
    if (controller.normalizedProperty === "scale") transform.scale = sampled as Vec3;
    if (controller.normalizedProperty === "rotation") {
      transform.rotation = retargetSampledRotation(
        controller,
        restTransform.rotation,
        sampled as Quat,
        jointIndex,
        options,
        diagnosticContext
      );
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
  if (timeSeconds <= firstTime)
    return readPackedTrackValue(animation, controller, 0, options.diagnostics, options.diagnosticContext);

  const lastKey = controller.keyCount - 1;
  const lastTime = animation.times[controller.timeOffset + lastKey] ?? controller.lastTime;
  if (timeSeconds >= lastTime)
    return readPackedTrackValue(animation, controller, lastKey, options.diagnostics, options.diagnosticContext);

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
  if (lower === upper)
    return readPackedTrackValue(animation, controller, lower, options.diagnostics, options.diagnosticContext);
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
  if (controller.stride === 4)
    pushRotationSampleRepairDiagnostic(diagnostics, diagnosticContext, controller, values as Quat, keyIndex);
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

function findLowerKeyInReadonlyArray(
  times: readonly number[],
  offset: number,
  keyCount: number,
  timeSeconds: number
): number {
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

function validatePackedArchiveMetadata(
  issues: ClipValidationIssue[],
  animation: Partial<PackedRuntimeAnimation>
): void {
  const archive = animation.archive;
  if (!isPackedArchiveObject(archive)) {
    issues.push({ message: "packed runtime animation archive metadata must be an object" });
    return;
  }
  if (archive.format !== PACKED_RUNTIME_ANIMATION_FORMAT)
    issues.push({ message: "packed runtime animation archive format is unsupported" });
  if (archive.version !== PACKED_RUNTIME_ANIMATION_VERSION)
    issues.push({ message: "packed runtime animation archive version is unsupported" });
  if (archive.source !== "AnimationClip")
    issues.push({ message: "packed runtime animation archive source is unsupported" });
  if (archive.clipId !== animation.id)
    issues.push({ message: "packed runtime animation archive clipId does not match animation id" });
  if (archive.clipName !== undefined && archive.clipName !== animation.name) {
    issues.push({ message: "packed runtime animation archive clipName does not match animation name" });
  }
  if (archive.duration !== animation.duration)
    issues.push({ message: "packed runtime animation archive duration does not match animation duration" });
  if (archive.loop !== animation.loop)
    issues.push({ message: "packed runtime animation archive loop does not match animation loop" });
  if (!Number.isInteger(archive.trackCount) || archive.trackCount < 0)
    issues.push({ message: "packed runtime animation archive trackCount must be a non-negative integer" });
  if (!Number.isInteger(archive.keyCount) || archive.keyCount < 0)
    issues.push({ message: "packed runtime animation archive keyCount must be a non-negative integer" });
  if (!Number.isInteger(archive.iframeCount) || archive.iframeCount < 0)
    issues.push({ message: "packed runtime animation archive iframeCount must be a non-negative integer" });
}

function validatePackedArchiveConsistency(
  issues: ClipValidationIssue[],
  animation: Partial<PackedRuntimeAnimation>,
  controllers: readonly PackedRuntimeAnimationKeyController[],
  iframeTimes: readonly number[]
): void {
  const archive = animation.archive;
  if (!isPackedArchiveObject(archive)) return;
  const keyCount = controllers.reduce(
    (sum, controller) =>
      sum +
      (isPackedKeyControllerObject(controller) && Number.isInteger(controller.keyCount) ? controller.keyCount : 0),
    0
  );
  if (archive.trackCount !== controllers.length)
    issues.push({ message: "packed runtime animation archive trackCount does not match key controllers" });
  if (archive.keyCount !== keyCount)
    issues.push({ message: "packed runtime animation archive keyCount does not match key controllers" });
  if (archive.iframeCount !== iframeTimes.length)
    issues.push({ message: "packed runtime animation archive iframeCount does not match iframe table" });
}

function validatePackedBufferCoverage(
  issues: ClipValidationIssue[],
  controllers: readonly PackedRuntimeAnimationKeyController[],
  times: readonly number[],
  values: readonly number[]
): void {
  if (controllers.length === 0) return;
  const timeCoverage = new Uint8Array(times.length);
  const valueCoverage = new Uint8Array(values.length);
  let reportedTimeOverlap = false;
  let reportedValueOverlap = false;

  for (let index = 0; index < controllers.length; index += 1) {
    const controller = controllers[index]!;
    if (!isPackedKeyControllerObject(controller)) continue;
    const property = normalizedTrackProperty(String(controller.normalizedProperty));
    const stride = property ? trackStride(property) : null;
    const keyCountValid = Number.isInteger(controller.keyCount) && controller.keyCount > 0;
    const timeRangeValid =
      Number.isInteger(controller.timeOffset) &&
      controller.timeOffset >= 0 &&
      controller.timeOffset + Math.max(0, controller.keyCount) <= times.length;
    const valueRangeValid =
      stride !== null &&
      controller.stride === stride &&
      Number.isInteger(controller.valueOffset) &&
      controller.valueOffset >= 0 &&
      controller.valueOffset + Math.max(0, controller.keyCount) * stride <= values.length;
    const targetName = controllerTargetName(controller);

    if (keyCountValid && timeRangeValid) {
      for (let key = 0; key < controller.keyCount; key += 1) {
        const offset = controller.timeOffset + key;
        if (timeCoverage[offset] && !reportedTimeOverlap) {
          issues.push({
            track: index,
            joint: targetName,
            property: String(controller.property),
            message: "packed key controller time ranges must not overlap"
          });
          reportedTimeOverlap = true;
        }
        timeCoverage[offset] = 1;
      }
    }

    if (keyCountValid && valueRangeValid && stride !== null) {
      for (let component = 0; component < controller.keyCount * stride; component += 1) {
        const offset = controller.valueOffset + component;
        if (valueCoverage[offset] && !reportedValueOverlap) {
          issues.push({
            track: index,
            joint: targetName,
            property: String(controller.property),
            message: "packed key controller value ranges must not overlap"
          });
          reportedValueOverlap = true;
        }
        valueCoverage[offset] = 1;
      }
    }
  }

  if (timeCoverage.some((covered) => covered === 0)) {
    issues.push({ message: "packed runtime animation time buffer contains unreferenced entries" });
  }
  if (valueCoverage.some((covered) => covered === 0)) {
    issues.push({ message: "packed runtime animation value buffer contains unreferenced entries" });
  }
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
      if (time < 0 || time > duration)
        issues.push({ index, message: "packed runtime animation iframe time must be within animation duration" });
      if (time <= previous)
        issues.push({ index, message: "packed runtime animation iframe times must be unique and sorted" });
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
  if (controller.track !== index)
    issues.push({
      track: index,
      joint: targetName,
      message: "packed key controller track index must match sorted order"
    });
  if (!Number.isInteger(controller.sourceTrack) || controller.sourceTrack < 0) {
    issues.push({
      track: index,
      joint: targetName,
      message: "packed key controller sourceTrack must be a non-negative integer"
    });
  }
  if (typeof controller.targetKey !== "string" || controller.targetKey.length === 0) {
    issues.push({ track: index, joint: targetName, message: "packed key controller targetKey is required" });
  }
  if (!property || property !== controller.normalizedProperty) {
    issues.push({
      track: index,
      joint: targetName,
      property: String(controller.normalizedProperty),
      message: "packed key controller property is unsupported"
    });
    return;
  }
  if (normalizedTrackProperty(String(controller.property)) !== property) {
    issues.push({
      track: index,
      joint: targetName,
      property: String(controller.property),
      message: "packed key controller source property does not match normalized property"
    });
  }
  if (controller.stride !== stride) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller stride does not match property"
    });
  }
  const keyCountValid = Number.isInteger(controller.keyCount) && controller.keyCount > 0;
  const timeRangeValid =
    Number.isInteger(controller.timeOffset) &&
    controller.timeOffset >= 0 &&
    controller.timeOffset + Math.max(0, controller.keyCount) <= times.length;
  const valueRangeValid =
    Number.isInteger(controller.valueOffset) &&
    controller.valueOffset >= 0 &&
    controller.valueOffset + Math.max(0, controller.keyCount) * controller.stride <= values.length;
  if (!keyCountValid) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller keyCount must be positive"
    });
  }
  if (!timeRangeValid) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller timeOffset is out of range"
    });
  }
  if (!valueRangeValid) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller valueOffset is out of range"
    });
  }
  validatePackedControllerTarget(issues, controller, index, property, skeleton, resolvedChannels);
  validatePackedControllerRotationSpace(issues, controller, index, property);
  validatePackedControllerSourceRest(issues, controller, index, property);
  if (keyCountValid && timeRangeValid && valueRangeValid) {
    validatePackedControllerTimesAndValues(issues, controller, index, duration, property, times, values);
  }
  validatePackedSeekTable(issues, controller, index, iframeTimes, times);
}

function validatePackedControllerRotationSpace(
  issues: ClipValidationIssue[],
  controller: PackedRuntimeAnimationKeyController,
  index: number,
  property: NormalizedTrackProperty
): void {
  if (controller.rotationSpace === undefined) return;
  const targetName = controllerTargetName(controller);
  if (property !== "rotation") {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "rotationSpace is only valid on rotation tracks"
    });
    return;
  }
  if (controller.rotationSpace !== "local-source" && controller.rotationSpace !== "normalized-humanoid-delta") {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "rotationSpace must be local-source or normalized-humanoid-delta"
    });
  }
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
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller needs exactly one joint or humanBone target"
    });
    return;
  }
  if (hasJoint && (typeof controller.joint !== "string" || controller.joint.length === 0)) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller joint target must be a non-empty string"
    });
  }
  if (hasHumanBone) {
    if (typeof controller.humanBone !== "string" || controller.humanBone.length === 0) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller humanBone target must be a non-empty string"
      });
    } else if (!isHumanoidBoneName(controller.humanBone)) {
      issues.push({
        track: index,
        joint: controller.humanBone,
        property: controller.property,
        message: "packed key controller has unknown humanoid bone"
      });
    }
  }
  if (controller.jointIndex !== undefined && (!Number.isInteger(controller.jointIndex) || controller.jointIndex < 0)) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller jointIndex must be a non-negative integer"
    });
  }

  const jointIndex = skeleton ? resolvePackedTrackJointIndex(skeleton, controller) : -1;
  if (skeleton) {
    if (jointIndex < 0) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller does not map to skeleton"
      });
    } else if (controller.jointIndex !== undefined && controller.jointIndex !== jointIndex) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller jointIndex does not match skeleton target"
      });
    }
  }
  if (typeof controller.targetKey === "string" && controller.targetKey.length > 0) {
    const expectedTargetKeys = packedControllerExpectedTargetKeys(controller, skeleton, jointIndex);
    if (expectedTargetKeys.length > 0 && !expectedTargetKeys.includes(controller.targetKey)) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller targetKey does not match resolved target"
      });
    }
  }

  const channelKey =
    skeleton && jointIndex >= 0
      ? `${jointIndex}:${property}`
      : `${packedControllerUnresolvedTargetKey(controller) || controller.targetKey}:${property}`;
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
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestQuaternion is only valid on rotation tracks"
      });
    }
    if (controller.sourceRestQuaternion.length !== 4) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestQuaternion must contain exactly 4 values"
      });
    } else {
      const issue = quaternionNormalizationIssue(
        controller.sourceRestQuaternion,
        SOURCE_REST_QUATERNION_LENGTH_SQUARED_TOLERANCE,
        {
          finite: "sourceRestQuaternion values must be finite",
          normalizable: "sourceRestQuaternion must be normalizable",
          normalized: "sourceRestQuaternion must be normalized"
        }
      );
      if (issue)
        issues.push({ track: index, joint: targetName, property: controller.property, message: issue.message });
    }
  }
  if (controller.sourceRestChildDirection !== undefined) {
    if (property !== "rotation") {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestChildDirection is only valid on rotation tracks"
      });
    }
    if (controller.sourceRestChildDirection.length !== 3) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestChildDirection must contain exactly 3 values"
      });
    } else if (!hasFiniteArrayLikeComponents(controller.sourceRestChildDirection, 3)) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestChildDirection values must be finite"
      });
    } else if (
      Math.hypot(
        controller.sourceRestChildDirection[0]!,
        controller.sourceRestChildDirection[1]!,
        controller.sourceRestChildDirection[2]!
      ) <= EPSILON
    ) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "sourceRestChildDirection must be normalizable"
      });
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
    if (!Number.isFinite(time))
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key time is not finite"
      });
    else {
      if (time < 0 || time > duration) {
        issues.push({
          track: index,
          joint: targetName,
          property: controller.property,
          message: "packed key time is out of range"
        });
      }
      if (time <= previous)
        issues.push({
          track: index,
          joint: targetName,
          property: controller.property,
          message: "packed key times must be sorted"
        });
      previous = time;
    }
    for (let component = 0; component < controller.stride; component += 1) {
      if (!Number.isFinite(values[controller.valueOffset + key * controller.stride + component])) {
        issues.push({
          track: index,
          joint: targetName,
          property: controller.property,
          message: "packed key values must be finite"
        });
        break;
      }
    }
  }
  if (controller.keyCount > 0) {
    if (controller.firstTime !== times[controller.timeOffset]) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller firstTime does not match key data"
      });
    }
    if (controller.lastTime !== times[controller.timeOffset + controller.keyCount - 1]) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed key controller lastTime does not match key data"
      });
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
  const lower = asReadonlyArray(controller.seekTable?.iframeLowerKeys);
  const upper = asReadonlyArray(controller.seekTable?.iframeUpperKeys);
  if (!lower || !upper) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed key controller seek table must contain iframe key arrays"
    });
    return;
  }
  if (lower.length !== iframeTimes.length || upper.length !== iframeTimes.length) {
    issues.push({
      track: index,
      joint: targetName,
      property: controller.property,
      message: "packed seek table length must match iframe table length"
    });
  }
  const count = Math.min(lower.length, upper.length);
  for (let iframe = 0; iframe < count; iframe += 1) {
    const lowerKey = lower[iframe]!;
    const upperKey = upper[iframe]!;
    if (
      !Number.isInteger(lowerKey) ||
      !Number.isInteger(upperKey) ||
      lowerKey < 0 ||
      upperKey < 0 ||
      lowerKey >= controller.keyCount ||
      upperKey >= controller.keyCount
    ) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed seek table key index is out of range"
      });
      return;
    }
    if (lowerKey > upperKey) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed seek table lower key must not exceed upper key"
      });
      return;
    }
  }
  if (!canValidatePackedSeekTableAgainstTimes(controller, times, iframeTimes)) return;

  const trackTimes = times.slice(controller.timeOffset, controller.timeOffset + controller.keyCount);
  for (let iframe = 0; iframe < count; iframe += 1) {
    const [expectedLower, expectedUpper] = packedTrackTimeBracket(trackTimes, iframeTimes[iframe]!);
    if (lower[iframe] !== expectedLower || upper[iframe] !== expectedUpper) {
      issues.push({
        track: index,
        joint: targetName,
        property: controller.property,
        message: "packed seek table does not match key times"
      });
      return;
    }
  }
}

function canValidatePackedSeekTableAgainstTimes(
  controller: PackedRuntimeAnimationKeyController,
  times: readonly number[],
  iframeTimes: readonly number[]
): boolean {
  if (!Number.isInteger(controller.timeOffset) || !Number.isInteger(controller.keyCount) || controller.keyCount <= 0)
    return false;
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

function hasFiniteArrayLikeComponents(values: ArrayLike<number>, count: number): boolean {
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function readDurationRatio(duration: number, time: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp(Number.isFinite(time) ? time / duration : 0, 0, 1);
}

function resolvePackedTrackJointIndex(skeleton: Skeleton, controller: PackedRuntimeAnimationKeyController): number {
  if (controller.joint !== undefined) return resolveJointIndex(skeleton, controller.joint);
  if (controller.humanBone !== undefined)
    return resolveHumanoidIndex(skeleton, controller.humanBone as HumanoidBoneName);
  return controller.jointIndex !== undefined && controller.jointIndex < skeleton.joints.length
    ? controller.jointIndex
    : -1;
}

function controllerTargetName(
  controller: Pick<PackedRuntimeAnimationKeyController, "joint" | "humanBone" | "jointIndex" | "targetKey">
): string {
  return String(controller.joint ?? controller.humanBone ?? controller.jointIndex ?? controller.targetKey ?? "");
}

function packedControllerExpectedTargetKeys(
  controller: PackedRuntimeAnimationKeyController,
  skeleton: Skeleton | undefined,
  jointIndex: number
): string[] {
  const keys = new Set<string>();
  if (skeleton && jointIndex >= 0 && controller.jointIndex !== undefined) {
    keys.add(String(jointIndex));
  } else {
    if (controller.jointIndex !== undefined) keys.add(String(controller.jointIndex));
    const unresolved = packedControllerUnresolvedTargetKey(controller);
    if (unresolved.length > 0) keys.add(unresolved);
    const legacy = packedControllerLegacyTargetKey(controller);
    if (legacy.length > 0) keys.add(legacy);
  }
  return Array.from(keys);
}

function packedControllerUnresolvedTargetKey(
  controller: Pick<PackedRuntimeAnimationKeyController, "joint" | "humanBone">
): string {
  if (controller.joint !== undefined) return `joint:${controller.joint}`;
  if (controller.humanBone !== undefined) return `humanBone:${controller.humanBone}`;
  return "";
}

function packedControllerLegacyTargetKey(
  controller: Pick<PackedRuntimeAnimationKeyController, "joint" | "humanBone">
): string {
  return String(controller.joint ?? controller.humanBone ?? "");
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

function asReadonlyArray<T>(value: readonly T[] | undefined): readonly T[] | null {
  return Array.isArray(value) ? value : null;
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
