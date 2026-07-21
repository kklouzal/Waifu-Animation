import {
  type Quat,
  type Mat4,
  type Transform,
  type Vec3,
  EPSILON,
  clamp01,
  dampAlpha,
  dotQuat,
  finiteNonNegative,
  finiteSigned,
  identityTransform,
  lerpTransform,
  normalizeQuat
} from "./math.js";
import {
  type AnimationClip,
  type ClipValidationIssue,
  type SampleRepairDiagnostic,
  resolveTrackJointIndex,
  sampleClipToPose,
  validateClip
} from "./clip.js";
import { type MotionCarrier, sampleMotionIntervalDelta } from "./motion.js";
import {
  type JointMask,
  type JointMaskValidationIssue,
  type Pose,
  type PoseValidationIssue,
  additiveDeltaPose,
  applyAdditivePose,
  blendPoses,
  clonePose,
  normalizePose,
  sanitizeBlendThreshold,
  validateJointMask,
  validatePose
} from "./pose.js";
import { type Skeleton, createRestPose, localToModelPose } from "./skeleton.js";

const MAX_RUNTIME_ROOT_MOTION_LOOPS = 10_000;

export type LayerBlendMode = "override" | "additive";

export type AnimationLayer = {
  id: string;
  clip: AnimationClip;
  time: number;
  weight: number;
  targetWeight: number;
  fadeSpeed: number;
  speed: number;
  priority: number;
  loop: boolean;
  blendMode: LayerBlendMode;
  motionCarrier?: MotionCarrier;
  mask?: JointMask;
  sourceBasisQuaternion?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
};

export type AnimationLayerOptions = Partial<Omit<AnimationLayer, "id" | "clip" | "time">> & {
  time?: number;
};

export type CrossfadeOptions = AnimationLayerOptions & {
  /** Reset the target layer's time and current weight before fading in. Defaults to true for new layers and false when replacing the same id. */
  resetTime?: boolean;
  /** When true and `mask` is omitted, clear any mask previously stored on the target layer. */
  clearMask?: boolean;
  /** Optional source override layer ids to fade out. Defaults to all same-priority override layers except the target. */
  fromIds?: readonly string[];
  /** Override layer ids to keep active even when they match the crossfade scope. */
  excludeIds?: readonly string[];
  /** Disable automatic fade-out of matching source override layers. */
  fadeOutExisting?: boolean;
};

export type AnimationRuntimeOptions = {
  /** Ozz-style rest-pose fallback threshold for override blending. */
  blendThreshold?: number;
};

export type RuntimeUpdateOptions = {
  /** Collect an explicit blended motion-carrier interval delta for this update. */
  collectRootMotion?: boolean;
};

export type RuntimeRootMotionLayerDelta = {
  id: string;
  clipId: string;
  priority: number;
  weight: number;
  normalizedWeight: number;
  fromTime: number;
  toTime: number;
  carrier: { jointIndex: number; joint: string };
  delta: Transform;
};

export type RuntimeUpdateResult = {
  rootMotionDelta: Transform;
  rootMotionLayers: RuntimeRootMotionLayerDelta[];
};

export type RuntimeEvaluateOptions = {
  /** Collect pose validation diagnostics for sampled layers and the composed local pose. */
  diagnostics?: boolean;
};

export type RuntimeEvaluationDiagnostic = PoseValidationIssue & {
  stage: "sample" | "mask" | "final";
  layerId?: string;
  clipId?: string;
  track?: number;
  sample?: number;
  property?: string;
};

export type RuntimeEvaluation = {
  localPose: Pose;
  modelPose: Mat4[];
  activeLayers: Array<Pick<AnimationLayer, "id" | "time" | "weight" | "targetWeight" | "priority" | "blendMode">>;
  diagnostics?: RuntimeEvaluationDiagnostic[];
};

export type LocomotionBlendLayerInput = {
  id?: string;
  clip?: Pick<AnimationClip, "duration">;
  duration?: number;
  weight?: number;
  time?: number;
};

export type LocomotionPlaybackSyncOptions = {
  /** Optional Ozz blend-sample style parameter used to derive triangular walk/jog/run weights. */
  blendRatio?: number;
  /** Shared normalized cycle phase used to report synchronized local times. Defaults to 0. */
  phase?: number;
};

export type LocomotionPlaybackSyncLayer = {
  id: string;
  duration: number;
  weight: number;
  normalizedWeight: number;
  playbackSpeed: number;
  time: number;
  ratio: number;
  active: boolean;
};

export type LocomotionPlaybackSynchronization = {
  synchronizedDuration: number;
  totalWeight: number;
  activeWeight: number;
  phase: number;
  layers: LocomotionPlaybackSyncLayer[];
};

export function computeLocomotionBlendWeights(blendRatio: number, layerCount: number): number[] {
  if (!Number.isInteger(layerCount) || layerCount <= 0) return [];
  if (layerCount === 1) return [1];
  const ratio = clamp01(Number.isFinite(blendRatio) ? blendRatio : 0);
  const interval = 1 / (layerCount - 1);
  const weights: number[] = [];
  for (let index = 0; index < layerCount; index += 1) {
    const center = index * interval;
    weights.push(Math.max(0, (interval - Math.abs(ratio - center)) * (layerCount - 1)));
  }
  return weights;
}

export function synchronizeLocomotionPlayback(
  layers: readonly LocomotionBlendLayerInput[],
  options: LocomotionPlaybackSyncOptions = {}
): LocomotionPlaybackSynchronization {
  const weights =
    options.blendRatio === undefined ? null : computeLocomotionBlendWeights(options.blendRatio, layers.length);
  const phase = clamp01(Number.isFinite(options.phase) ? options.phase! : 0);
  const durations = layers.map(readLocomotionLayerDuration);
  const rawWeights = layers.map((layer, index) => finiteNonNegative(weights?.[index] ?? layer.weight, 0));
  const totalWeightStats = readFiniteNonNegativeWeightStats(rawWeights);
  const activeWeights: number[] = [];
  const activeDurations: number[] = [];

  for (let index = 0; index < layers.length; index += 1) {
    const duration = durations[index]!;
    const weight = rawWeights[index]!;
    if (weight <= EPSILON || duration <= EPSILON) continue;
    activeWeights.push(weight);
    activeDurations.push(duration);
  }

  const activeWeightStats = readFiniteNonNegativeWeightStats(activeWeights);
  const activeWeight = activeWeightStats.total;
  const synchronizedDuration = weightedFiniteNonNegativeAverage(activeDurations, activeWeights, activeWeightStats);
  const outputLayers = layers.map((layer, index): LocomotionPlaybackSyncLayer => {
    const duration = durations[index]!;
    const weight = rawWeights[index]!;
    return {
      id: layer.id ?? String(index),
      duration,
      weight,
      normalizedWeight: normalizeFiniteNonNegativeWeight(weight, totalWeightStats),
      playbackSpeed: synchronizedDuration > EPSILON && duration > EPSILON ? duration / synchronizedDuration : 0,
      time: duration > EPSILON ? duration * phase : 0,
      ratio: phase,
      active: weight > EPSILON && duration > EPSILON
    };
  });

  return { synchronizedDuration, totalWeight: totalWeightStats.total, activeWeight, phase, layers: outputLayers };
}

export class AnimationRuntime {
  readonly skeleton: Skeleton;
  readonly restPose: Pose;
  blendThreshold: number;
  private readonly layers = new Map<string, AnimationLayer>();

  constructor(skeleton: Skeleton, options: AnimationRuntimeOptions = {}) {
    this.skeleton = skeleton;
    this.restPose = createRestPose(skeleton);
    this.blendThreshold = sanitizeBlendThreshold(options.blendThreshold);
  }

  setLayer(id: string, clip: AnimationClip, options: AnimationLayerOptions = {}): AnimationLayer {
    const blendMode = sanitizeLayerBlendMode(options.blendMode);
    const layer: AnimationLayer = {
      id,
      clip,
      time: finiteNonNegative(options.time, 0),
      weight: sanitizeLayerWeight(blendMode, options.weight, 0),
      targetWeight: sanitizeLayerWeight(blendMode, options.targetWeight ?? options.weight, 1),
      fadeSpeed: finiteNonNegative(options.fadeSpeed, 8),
      speed: finiteNonNegative(options.speed, 1),
      priority: finiteNonNegative(options.priority, 0),
      loop: resolveLayerLoop(options.loop, clip.loop, false),
      blendMode,
      ...(options.motionCarrier ? { motionCarrier: options.motionCarrier } : {}),
      ...(options.mask ? { mask: options.mask } : {}),
      ...(options.sourceBasisQuaternion ? { sourceBasisQuaternion: options.sourceBasisQuaternion } : {})
    };
    this.layers.set(id, layer);
    return layer;
  }

  crossfade(id: string, clip: AnimationClip, options: CrossfadeOptions = {}): AnimationLayer {
    const existing = this.layers.get(id);
    const resetTime = options.resetTime ?? !existing;
    const blendMode = sanitizeLayerBlendMode(options.blendMode ?? existing?.blendMode);
    const targetWeight = sanitizeLayerWeight(blendMode, options.targetWeight ?? options.weight ?? 1, 1);
    const fadeSpeed = finiteNonNegative(options.fadeSpeed, 8);
    const priority = finiteNonNegative(options.priority ?? existing?.priority, 0);
    const layer: AnimationLayer = {
      id,
      clip,
      time: finiteNonNegative(resetTime ? options.time : (options.time ?? existing?.time), 0),
      weight: resetTime
        ? sanitizeLayerWeight(blendMode, options.weight, 0)
        : sanitizeLayerWeight(blendMode, existing?.weight ?? options.weight, 0),
      targetWeight,
      fadeSpeed,
      speed: finiteNonNegative(options.speed ?? existing?.speed, 1),
      priority,
      loop: resolveLayerLoop(options.loop, clip.loop, existing?.loop, false),
      blendMode,
      ...(options.motionCarrier
        ? { motionCarrier: options.motionCarrier }
        : existing?.motionCarrier
          ? { motionCarrier: existing.motionCarrier }
          : {}),
      ...(options.mask
        ? { mask: options.mask }
        : options.clearMask
          ? {}
          : existing?.mask
            ? { mask: existing.mask }
            : {}),
      ...(options.sourceBasisQuaternion
        ? { sourceBasisQuaternion: options.sourceBasisQuaternion }
        : existing?.sourceBasisQuaternion
          ? { sourceBasisQuaternion: existing.sourceBasisQuaternion }
          : {})
    };
    this.layers.set(id, layer);

    if (blendMode === "override" && options.fadeOutExisting !== false) {
      const fromIds = options.fromIds ? new Set(options.fromIds) : undefined;
      const excludeIds = new Set([id, ...(options.excludeIds ?? [])]);
      for (const source of this.layers.values()) {
        sanitizeLayerState(source);
        if (excludeIds.has(source.id)) continue;
        if (source.blendMode !== "override") continue;
        if (source.priority !== priority) continue;
        if (fromIds && !fromIds.has(source.id)) continue;
        source.targetWeight = 0;
        source.fadeSpeed = fadeSpeed;
      }
    }

    return layer;
  }

  fadeOut(id: string, fadeSpeed = 8): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.targetWeight = 0;
    layer.fadeSpeed = finiteNonNegative(fadeSpeed, 8);
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  clear(): void {
    this.layers.clear();
  }

  update(deltaSeconds: number, options: RuntimeUpdateOptions = {}): RuntimeUpdateResult {
    const delta = finiteNonNegative(deltaSeconds, 0);
    const intervals: RuntimeMotionInterval[] = [];
    for (const layer of this.layers.values()) {
      sanitizeLayerState(layer);
      const fromTime = layer.time;
      const fromWeight = layer.weight;
      const advancedTime = advanceLayerTime(fromTime, delta, layer.speed);
      layer.time = advancedTime;
      const alpha = dampAlpha(layer.fadeSpeed, delta);
      layer.weight = fadeLayerWeight(layer, alpha);
      const toWeight = layer.weight;
      if (
        options.collectRootMotion &&
        layer.blendMode === "override" &&
        (fromWeight > 0.0001 || toWeight > 0.0001) &&
        delta > 0 &&
        shouldCollectRootMotionInterval(layer, fromTime, advancedTime)
      ) {
        const sampleOptions = {
          ...(layer.motionCarrier ? { carrier: layer.motionCarrier } : {}),
          loop: layer.loop,
          restPose: this.restPose,
          ...(layer.sourceBasisQuaternion ? { sourceBasisQuaternion: layer.sourceBasisQuaternion } : {}),
          skipUnsupportedTracks: true
        };
        const interval = shouldSampleRootMotionInterval(layer, fromTime, advancedTime)
          ? sampleMotionIntervalDelta(this.skeleton, layer.clip, fromTime, advancedTime, sampleOptions)
          : sampleMotionIntervalDelta(this.skeleton, layer.clip, fromTime, fromTime, sampleOptions);
        intervals.push({
          layer,
          fromTime,
          toTime: advancedTime,
          fromWeight,
          toWeight,
          interval
        });
      }
      layer.time = finalizeLayerTime(layer, advancedTime);
      if (layer.targetWeight === 0 && Math.abs(layer.weight) < 0.0005) this.layers.delete(layer.id);
    }
    return options.collectRootMotion
      ? blendRootMotionIntervals(intervals, this.blendThreshold)
      : { rootMotionDelta: identityTransform(), rootMotionLayers: [] };
  }

  evaluate(options: RuntimeEvaluateOptions = {}): RuntimeEvaluation {
    const diagnostics = options.diagnostics ? ([] as RuntimeEvaluationDiagnostic[]) : undefined;
    const active = Array.from(this.layers.values())
      .map((layer) => sanitizeLayerState(layer))
      .filter((layer) => isLayerActive(layer))
      .sort(compareLayerOrder);

    const overrideLayers: Array<{ priority: number; pose: Pose; weight: number; mask?: JointMask }> = [];
    const additiveLayers: Array<{ pose: Pose; weight: number; mask?: JointMask }> = [];
    for (const layer of active) {
      const sampleDiagnostics = diagnostics ? ([] as SampleRepairDiagnostic[]) : undefined;
      if (diagnostics) pushClipDiagnostics(diagnostics, validateClip(layer.clip, this.skeleton), layer, this.skeleton);
      const sampleOptions = sampleDiagnostics
        ? {
            loop: layer.loop,
            restPose: this.restPose,
            diagnostics: sampleDiagnostics,
            ...(layer.sourceBasisQuaternion ? { sourceBasisQuaternion: layer.sourceBasisQuaternion } : {}),
            skipUnsupportedTracks: true
          }
        : {
            loop: layer.loop,
            restPose: this.restPose,
            ...(layer.sourceBasisQuaternion ? { sourceBasisQuaternion: layer.sourceBasisQuaternion } : {}),
            skipUnsupportedTracks: true
          };
      const sampled = sampleClipToPose(this.skeleton, layer.clip, layer.time, sampleOptions);
      if (diagnostics) {
        pushSampleRepairDiagnostics(diagnostics, sampleDiagnostics ?? [], layer);
        pushPoseDiagnostics(diagnostics, validatePose(this.skeleton, sampled), {
          stage: "sample",
          layerId: layer.id,
          clipId: layer.clip.id
        });
        if (layer.mask) pushMaskDiagnostics(diagnostics, validateJointMask(this.skeleton, layer.mask), layer);
      }
      if (layer.blendMode === "additive")
        additiveLayers.push({ pose: sampled, weight: layer.weight, ...(layer.mask ? { mask: layer.mask } : {}) });
      else
        overrideLayers.push({
          priority: layer.priority,
          pose: sampled,
          weight: layer.weight,
          ...(layer.mask ? { mask: layer.mask } : {})
        });
    }

    let localPose = clonePose(this.restPose);
    for (let index = 0; index < overrideLayers.length; ) {
      const priority = overrideLayers[index]!.priority;
      const group: Array<{ pose: Pose; weight: number; mask?: JointMask }> = [];
      while (index < overrideLayers.length && overrideLayers[index]!.priority === priority) {
        const layer = overrideLayers[index]!;
        group.push({ pose: layer.pose, weight: layer.weight, ...(layer.mask ? { mask: layer.mask } : {}) });
        index += 1;
      }
      localPose = blendPoses(this.skeleton, group, { threshold: this.blendThreshold, fallbackPose: localPose });
    }
    for (const additive of additiveLayers) {
      const deltaPose = additiveDeltaPose(this.restPose, additive.pose);
      localPose = applyAdditivePose(localPose, deltaPose, additive.weight, additive.mask);
    }
    if (diagnostics) pushPoseDiagnostics(diagnostics, validatePose(this.skeleton, localPose), { stage: "final" });
    localPose = normalizePose(localPose);
    const evaluation: RuntimeEvaluation = {
      localPose,
      modelPose: localToModelPose(this.skeleton, localPose),
      activeLayers: active.map((layer) => ({
        id: layer.id,
        time: layer.time,
        weight: layer.weight,
        targetWeight: layer.targetWeight,
        priority: layer.priority,
        blendMode: layer.blendMode
      }))
    };
    if (diagnostics) evaluation.diagnostics = diagnostics;
    return evaluation;
  }
}

function sanitizeLayerWeight(blendMode: LayerBlendMode, value: number | undefined, fallback: number): number {
  return blendMode === "additive" ? finiteSigned(value, fallback) : finiteNonNegative(value, fallback);
}

function sanitizeLayerBlendMode(value: LayerBlendMode | undefined): LayerBlendMode {
  return value === "additive" ? "additive" : "override";
}

function resolveLayerLoop(...candidates: unknown[]): boolean {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
  }
  return false;
}

function readLocomotionLayerDuration(layer: LocomotionBlendLayerInput): number {
  return finiteNonNegative(layer.duration ?? layer.clip?.duration, 0);
}

type FiniteNonNegativeWeightStats = {
  total: number;
  max: number;
  scaledTotal: number;
};

function readFiniteNonNegativeWeightStats(weights: readonly number[]): FiniteNonNegativeWeightStats {
  let max = 0;
  for (const weight of weights) max = Math.max(max, finiteNonNegative(weight, 0));
  if (!(max > 0)) return { total: 0, max: 0, scaledTotal: 0 };

  let scaledTotal = 0;
  for (const weight of weights) scaledTotal += finiteNonNegative(weight, 0) / max;
  if (!(scaledTotal > 0)) return { total: 0, max: 0, scaledTotal: 0 };

  const total = max * scaledTotal;
  return { total: Number.isFinite(total) ? total : Number.MAX_VALUE, max, scaledTotal };
}

function normalizeFiniteNonNegativeWeight(weight: number, stats: FiniteNonNegativeWeightStats): number {
  const safeWeight = finiteNonNegative(weight, 0);
  if (!(safeWeight > 0) || !(stats.total > EPSILON) || !(stats.max > 0) || !(stats.scaledTotal > 0)) return 0;
  return safeWeight / stats.max / stats.scaledTotal;
}

function weightedFiniteNonNegativeAverage(
  values: readonly number[],
  weights: readonly number[],
  stats: FiniteNonNegativeWeightStats
): number {
  if (!(stats.max > 0) || !(stats.scaledTotal > EPSILON)) return 0;
  let maxValue = 0;
  for (const value of values) maxValue = Math.max(maxValue, finiteNonNegative(value, 0));
  if (!(maxValue > 0)) return 0;

  let scaledAverage = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = finiteNonNegative(values[index], 0);
    const normalizedWeight = normalizeFiniteNonNegativeWeight(weights[index] ?? 0, stats);
    scaledAverage += (value / maxValue) * normalizedWeight;
  }
  const average = maxValue * scaledAverage;
  return Number.isFinite(average) ? average : Number.MAX_VALUE;
}

function sanitizeLayerState(layer: AnimationLayer): AnimationLayer {
  layer.blendMode = sanitizeLayerBlendMode(layer.blendMode);
  layer.loop = resolveLayerLoop(layer.loop, layer.clip.loop, false);
  layer.time = finiteNonNegative(layer.time, 0);
  layer.weight = sanitizeLayerWeight(layer.blendMode, layer.weight, 0);
  layer.targetWeight = sanitizeLayerWeight(layer.blendMode, layer.targetWeight, 0);
  layer.fadeSpeed = finiteNonNegative(layer.fadeSpeed, 0);
  layer.speed = finiteNonNegative(layer.speed, 0);
  layer.priority = finiteNonNegative(layer.priority, 0);
  return layer;
}

function fadeLayerWeight(layer: AnimationLayer, alpha: number): number {
  const amount = clamp01(alpha);
  const faded = layer.weight + (layer.targetWeight - layer.weight) * amount;
  return sanitizeLayerWeight(layer.blendMode, faded, 0);
}

function advanceLayerTime(time: number, deltaSeconds: number, speed: number): number {
  const base = finiteNonNegative(time, 0);
  const delta = finiteNonNegative(deltaSeconds, 0);
  const playbackSpeed = finiteNonNegative(speed, 0);
  if (delta <= 0 || playbackSpeed <= 0) return base;
  const step = delta * playbackSpeed;
  if (!Number.isFinite(step) || step <= 0) return base;
  const advanced = base + step;
  return Number.isFinite(advanced) ? advanced : base;
}

function shouldCollectRootMotionInterval(layer: AnimationLayer, fromTime: number, toTime: number): boolean {
  const duration = layer.clip.duration;
  if (!Number.isFinite(duration) || duration <= EPSILON) return false;
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return false;
  const span = toTime - fromTime;
  if (!Number.isFinite(span) || Math.abs(span) <= EPSILON) return false;
  if (layer.loop) return true;

  const fromClipTime = clampNonLoopingClipTime(fromTime, duration);
  const toClipTime = clampNonLoopingClipTime(toTime, duration);
  return Math.abs(toClipTime - fromClipTime) > EPSILON;
}

function shouldSampleRootMotionInterval(layer: AnimationLayer, fromTime: number, toTime: number): boolean {
  if (!shouldCollectRootMotionInterval(layer, fromTime, toTime)) return false;
  const duration = layer.clip.duration;
  if (!layer.loop) return true;
  return Math.abs(toTime - fromTime) / duration <= MAX_RUNTIME_ROOT_MOTION_LOOPS;
}

function clampNonLoopingClipTime(time: number, duration: number): number {
  return Math.min(duration, Math.max(0, time));
}

function compareLayerOrder(
  a: Pick<AnimationLayer, "id" | "priority">,
  b: Pick<AnimationLayer, "id" | "priority">
): number {
  const priorityDelta = a.priority - b.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return compareLayerId(a.id, b.id);
}

function compareLayerId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isLayerActive(layer: AnimationLayer): boolean {
  return layer.blendMode === "additive" ? Math.abs(layer.weight) > 0.0001 : layer.weight > 0.0001;
}

function finalizeLayerTime(layer: AnimationLayer, advancedTime: number): number {
  const time = finiteNonNegative(advancedTime, 0);
  const duration = layer.clip.duration;
  if (!Number.isFinite(duration) || duration <= 0) return time;
  if (!layer.loop) return Math.min(time, duration);
  return time % duration;
}

type RuntimeMotionInterval = {
  layer: AnimationLayer;
  fromTime: number;
  toTime: number;
  fromWeight: number;
  toWeight: number;
  interval: ReturnType<typeof sampleMotionIntervalDelta>;
};

function readRootMotionEffectiveWeight(layer: AnimationLayer, carrierJoint: number, weight = layer.weight): number {
  const layerWeight = finiteNonNegative(weight, 0);
  if (layerWeight <= 0) return 0;
  if (!layer.mask) return layerWeight;
  if (carrierJoint < 0 || carrierJoint >= layer.mask.length) return 0;
  return multiplyFiniteNonNegative(layerWeight, finiteNonNegative(layer.mask[carrierJoint], 0));
}

function readRootMotionIntervalEffectiveWeight(interval: RuntimeMotionInterval): number {
  const carrierJoint = interval.interval.from.jointIndex;
  const fromWeight = readRootMotionEffectiveWeight(interval.layer, carrierJoint, interval.fromWeight);
  const toWeight = readRootMotionEffectiveWeight(interval.layer, carrierJoint, interval.toWeight);
  return averageFiniteNonNegative(fromWeight, toWeight);
}

function multiplyFiniteNonNegative(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  const product = a * b;
  return Number.isFinite(product) ? product : Number.MAX_VALUE;
}

function averageFiniteNonNegative(a: number, b: number): number {
  const first = finiteNonNegative(a, 0);
  const second = finiteNonNegative(b, 0);
  const max = Math.max(first, second);
  if (max <= 0) return 0;
  return max * ((first / max + second / max) * 0.5);
}

function blendRootMotionIntervals(intervals: RuntimeMotionInterval[], threshold: number): RuntimeUpdateResult {
  const blendThreshold = sanitizeBlendThreshold(threshold);
  let rootMotionDelta = identityTransform();
  const rootMotionLayers: RuntimeRootMotionLayerDelta[] = [];
  const active = intervals
    .filter(
      (interval) => interval.layer.blendMode === "override" && readRootMotionIntervalEffectiveWeight(interval) > 0.0001
    )
    .sort((a, b) => compareLayerOrder(a.layer, b.layer));

  for (let index = 0; index < active.length; ) {
    const priority = active[index]!.layer.priority;
    const group: RuntimeMotionInterval[] = [];
    while (index < active.length && active[index]!.layer.priority === priority) {
      const item = active[index]!;
      group.push(item);
      index += 1;
    }
    const weightedGroup = readRootMotionGroupWeights(group);
    if (weightedGroup.entries.length === 0 || weightedGroup.totalWeight <= 0) continue;

    for (const { item, weight, normalizedWeight } of weightedGroup.entries) {
      rootMotionLayers.push({
        id: item.layer.id,
        clipId: item.layer.clip.id,
        priority: item.layer.priority,
        weight,
        normalizedWeight,
        fromTime: item.fromTime,
        toTime: item.toTime,
        carrier: { jointIndex: item.interval.from.jointIndex, joint: item.interval.from.joint },
        delta: item.interval.delta
      });
    }
    const groupDelta = blendRootMotionGroup(weightedGroup.entries);
    rootMotionDelta =
      weightedGroup.totalWeight < blendThreshold
        ? lerpTransform(rootMotionDelta, groupDelta, weightedGroup.totalWeight / blendThreshold)
        : groupDelta;
  }

  return { rootMotionDelta, rootMotionLayers };
}

type WeightedRuntimeMotionInterval = {
  item: RuntimeMotionInterval;
  weight: number;
  normalizedWeight: number;
};

function readRootMotionGroupWeights(group: RuntimeMotionInterval[]): {
  totalWeight: number;
  entries: WeightedRuntimeMotionInterval[];
} {
  const entries: WeightedRuntimeMotionInterval[] = [];
  for (const item of group) {
    const weight = finiteNonNegative(readRootMotionIntervalEffectiveWeight(item), 0);
    if (weight <= EPSILON) continue;
    entries.push({ item, weight, normalizedWeight: 0 });
  }
  const stats = readFiniteNonNegativeWeightStats(entries.map((entry) => entry.weight));
  if (!(stats.total > 0)) return { totalWeight: 0, entries: [] };

  for (const entry of entries) entry.normalizedWeight = normalizeFiniteNonNegativeWeight(entry.weight, stats);
  return { totalWeight: stats.total, entries };
}

function blendRootMotionGroup(group: WeightedRuntimeMotionInterval[]): Transform {
  if (group.length === 0) return identityTransform();

  const translation: Vec3 = [0, 0, 0];
  const scale: Vec3 = [0, 0, 0];
  const rotationSum: Quat = [0, 0, 0, 0];
  let firstRotation: Quat | undefined;
  let acceptedWeight = 0;

  for (const { item, normalizedWeight } of group) {
    if (!(normalizedWeight > EPSILON)) continue;
    const delta = item.interval.delta;

    translation[0] += finiteSigned(delta.translation[0], 0) * normalizedWeight;
    translation[1] += finiteSigned(delta.translation[1], 0) * normalizedWeight;
    translation[2] += finiteSigned(delta.translation[2], 0) * normalizedWeight;

    scale[0] += finiteSigned(delta.scale[0], 1) * normalizedWeight;
    scale[1] += finiteSigned(delta.scale[1], 1) * normalizedWeight;
    scale[2] += finiteSigned(delta.scale[2], 1) * normalizedWeight;

    let rotation = normalizeQuat([
      finiteSigned(delta.rotation[0], 0),
      finiteSigned(delta.rotation[1], 0),
      finiteSigned(delta.rotation[2], 0),
      finiteSigned(delta.rotation[3], 1)
    ]);
    const reference = dotQuat(rotationSum, rotationSum) > EPSILON ? rotationSum : firstRotation;
    if (reference) {
      if (dotQuat(reference, rotation) < 0) rotation = [-rotation[0], -rotation[1], -rotation[2], -rotation[3]];
    } else if (dotQuat([0, 0, 0, 1], rotation) < 0) {
      rotation = [-rotation[0], -rotation[1], -rotation[2], -rotation[3]];
    }
    firstRotation ??= rotation;
    rotationSum[0] += rotation[0] * normalizedWeight;
    rotationSum[1] += rotation[1] * normalizedWeight;
    rotationSum[2] += rotation[2] * normalizedWeight;
    rotationSum[3] += rotation[3] * normalizedWeight;
    acceptedWeight += normalizedWeight;
  }

  if (acceptedWeight <= EPSILON) return identityTransform();
  return { translation, rotation: normalizeQuat(rotationSum), scale };
}

function pushPoseDiagnostics(
  diagnostics: RuntimeEvaluationDiagnostic[],
  issues: PoseValidationIssue[],
  context: Pick<RuntimeEvaluationDiagnostic, "stage" | "layerId" | "clipId">
): void {
  for (const issue of issues) {
    diagnostics.push({ ...issue, ...context });
  }
}

function pushMaskDiagnostics(
  diagnostics: RuntimeEvaluationDiagnostic[],
  issues: JointMaskValidationIssue[],
  layer: AnimationLayer
): void {
  for (const issue of issues) {
    diagnostics.push({ ...issue, stage: "mask", layerId: layer.id, clipId: layer.clip.id });
  }
}

function pushClipDiagnostics(
  diagnostics: RuntimeEvaluationDiagnostic[],
  issues: ClipValidationIssue[],
  layer: AnimationLayer,
  skeleton: Skeleton
): void {
  for (const issue of issues) {
    const track = issue.track !== undefined ? layer.clip.tracks[issue.track] : undefined;
    const index = track ? resolveTrackJointIndex(skeleton, track) : -1;
    diagnostics.push(
      createSampleDiagnostic(layer, issue, issue.joint ?? track?.joint ?? track?.humanBone ?? "<clip>", index, {
        includeProperty: true
      })
    );
  }
}

function pushSampleRepairDiagnostics(
  diagnostics: RuntimeEvaluationDiagnostic[],
  issues: SampleRepairDiagnostic[],
  layer: AnimationLayer
): void {
  for (const issue of issues) {
    diagnostics.push(
      createSampleDiagnostic(layer, issue, issue.joint ?? "<clip>", issue.index ?? -1, { includeSample: true })
    );
  }
}

function createSampleDiagnostic(
  layer: AnimationLayer,
  issue: ClipValidationIssue | SampleRepairDiagnostic,
  joint: string,
  index: number,
  options: { includeProperty?: boolean; includeSample?: boolean } = {}
): RuntimeEvaluationDiagnostic {
  return {
    stage: "sample",
    layerId: layer.id,
    clipId: layer.clip.id,
    ...(issue.track !== undefined ? { track: issue.track } : {}),
    ...(options.includeProperty && issue.property !== undefined ? { property: issue.property } : {}),
    ...(options.includeSample && "sample" in issue && issue.sample !== undefined ? { sample: issue.sample } : {}),
    joint,
    index,
    message: issue.message
  };
}
