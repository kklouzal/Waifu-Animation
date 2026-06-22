import {
  type Quat,
  cloneTransform,
  clamp,
  ensureShortestQuat,
  euclideanModulo,
  lerpVec3,
  normalizeQuat,
  slerpQuat
} from "./math.js";
import {
  defaultTrackSample,
  normalizedTrackProperty,
  pushRotationSampleRepairDiagnostic,
  readClipTimeRatio,
  readTrackTargetKey,
  repairVec3Sample,
  resolveTrackJointIndex,
  retargetSampledRotation,
  rotationSampleFallback,
  trackStride,
  type AnimationClip,
  type AnimationTrack,
  type NormalizedTrackProperty,
  type SampleOptions,
  type SampleRatioOptions,
  type SampleRepairDiagnostic,
  type TrackProperty
} from "./clip-internal.js";
import { type Pose, readPoseTransformOrRest } from "./pose.js";
import { type Skeleton, createRestPose, isHumanoidBoneName } from "./skeleton.js";

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

export function sampleClipToPose(
  skeleton: Skeleton,
  clip: AnimationClip,
  timeSeconds: number,
  options: SampleOptions = {}
): Pose {
  return sampleClipToPoseAtResolvedTime(
    skeleton,
    clip,
    sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false),
    options
  );
}

export function sampleClipToPoseAtRatio(
  skeleton: Skeleton,
  clip: AnimationClip,
  ratio: number,
  options: SampleRatioOptions = {}
): Pose {
  return sampleClipToPoseAtResolvedTime(skeleton, clip, sampleRatioToTime(clip, ratio), options);
}

export function sampleClipToPoseWithContext(
  skeleton: Skeleton,
  clip: AnimationClip,
  timeSeconds: number,
  context: AnimationSamplingContext,
  options: SampleOptions = {}
): Pose {
  const time = sampleTime(clip, timeSeconds, options.loop ?? clip.loop ?? false);
  context.beginSample(clip, time, readClipTimeRatio(clip, time));
  return sampleClipToPoseAtResolvedTime(
    skeleton,
    clip,
    time,
    options,
    (track, trackIndex, sampledTime, sampleOptions) =>
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
    return sampleClipToPoseAtResolvedTime(
      skeleton,
      clip,
      time,
      options,
      (track, trackIndex, sampledTime, sampleOptions) => this.sampleTrack(trackIndex, track, sampledTime, sampleOptions)
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
    options: {
      diagnostics?: SampleRepairDiagnostic[];
      diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">;
    } = {}
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

type TrackSampler = (
  track: AnimationTrack,
  trackIndex: number,
  timeSeconds: number,
  options: TrackSampleOptions
) => number[];

function sampleClipToPoseAtResolvedTime(
  skeleton: Skeleton,
  clip: AnimationClip,
  time: number,
  options: SampleOptions | SampleRatioOptions = {},
  trackSampler: TrackSampler = (track, _trackIndex, sampledTime, sampleOptions) =>
    sampleTrack(track, sampledTime, sampleOptions)
): Pose {
  const restPose = options.restPose ?? createRestPose(skeleton);
  const output = Array.from({ length: skeleton.joints.length }, (_, joint) =>
    cloneTransform(readPoseTransformOrRest(skeleton, restPose, joint))
  );
  for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex += 1) {
    const track = clip.tracks[trackIndex]!;
    if (!isSampleableTrackTarget(track)) continue;
    const jointIndex = resolveTrackJointIndex(skeleton, track);
    if (jointIndex < 0) continue;
    const property = normalizedTrackProperty(track.property);
    if (!property) {
      if (options.skipUnsupportedTracks) continue;
      throw new Error(`unsupported animation track property ${String(track.property)}`);
    }
    const diagnosticContext = {
      track: trackIndex,
      joint: skeleton.joints[jointIndex]?.name ?? String(track.joint ?? track.humanBone ?? ""),
      index: jointIndex
    };
    const sampled = options.diagnostics
      ? trackSampler(track, trackIndex, time, { diagnostics: options.diagnostics, diagnosticContext })
      : trackSampler(track, trackIndex, time, { diagnosticContext });
    const restTransform = readPoseTransformOrRest(skeleton, restPose, jointIndex);
    const transform = cloneTransform(output[jointIndex]);
    if (property === "translation") transform.translation = sampled as [number, number, number];
    if (property === "scale") transform.scale = sampled as [number, number, number];
    if (property === "rotation") {
      transform.rotation = retargetSampledRotation(
        track,
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

function isSampleableTrackTarget(track: AnimationTrack): boolean {
  const hasJoint = track.joint !== undefined;
  const hasHumanBone = track.humanBone !== undefined;
  if (hasJoint === hasHumanBone) return false;
  if (hasJoint) return typeof track.joint === "string" && track.joint.length > 0;
  return typeof track.humanBone === "string" && track.humanBone.length > 0 && isHumanoidBoneName(track.humanBone);
}

export function sampleTime(clip: AnimationClip, timeSeconds: number, loop: boolean): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  if (loop && clip.duration > 0) {
    return euclideanModulo(timeSeconds, clip.duration);
  }
  return clamp(timeSeconds, 0, Math.max(0, clip.duration));
}

export function sampleTrack(
  track: AnimationTrack,
  timeSeconds: number,
  options: {
    diagnostics?: SampleRepairDiagnostic[];
    diagnosticContext?: Pick<SampleRepairDiagnostic, "track" | "joint" | "index">;
  } = {}
): number[] {
  const property = normalizedTrackProperty(track.property);
  if (!property) throw new Error(`unsupported animation track property ${String(track.property)}`);
  const stride = trackStride(property);
  if (track.times.length === 0) return defaultTrackSample(property);
  if (timeSeconds <= track.times[0]!)
    return readTrackValue(track, 0, stride, property, options.diagnostics, options.diagnosticContext);
  const last = track.times.length - 1;
  if (timeSeconds >= track.times[last]!)
    return readTrackValue(track, last, stride, property, options.diagnostics, options.diagnosticContext);
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
  return repairVec3Sample(
    track,
    values as [number, number, number],
    fallback as [number, number, number],
    keyIndex,
    diagnostics,
    diagnosticContext
  );
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
    ...clip.tracks.map(
      (track) =>
        `${track.joint ?? ""}/${track.humanBone ?? ""}/${track.property}/${track.times.length}/${track.values.length}`
    )
  ].join("|");
}
