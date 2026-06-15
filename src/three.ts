import {
  AnimationClip as ThreeAnimationClip,
  Euler,
  LoopOnce,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type AnimationAction,
  type AnimationMixer,
  type KeyframeTrack,
  type Object3D
} from "three";
import { type AnimationClip, type AnimationTrack, normalizedTrackProperty, sampleTrack, trackStride } from "./clip.js";
import { type FootPlantResult, solveTwoBoneIkCorrections } from "./ik.js";
import { type Quat, type Vec3, addVec3, clamp, clamp01, dampAlpha, dampValue, euclideanModulo, finiteNonNegative, lengthVec3, normalizeVec3, quatFromUnitVectors, rotateVec3ByQuat, scaleVec3, smoothStep, subVec3 } from "./math.js";
import { type AnimationManifestEntry } from "./manifest.js";
import {
  BASE_PROCEDURAL_TRACK_POLICY,
  OVERLAY_UPPER_BODY_TRACK_POLICY,
  ROOT_TRANSLATION_EXCLUDE_POLICY,
  type TrackMaskPolicy,
  filterTracksByNamePolicy
} from "./masks.js";
import { retargetQuaternionTrackValues } from "./retargeting.js";

export type ThreeBoneResolver = (humanBone: string) => Object3D | null | undefined;

export type ThreeAnimationClipOptions = {
  id?: string;
  playback?: AnimationManifestEntry["playback"];
  resolveBone: ThreeBoneResolver;
  targetRestQuaternion?: (humanBone: string, bone: Object3D) => ArrayLike<number> | null | undefined;
  logger?: Pick<Console, "warn">;
  minimumDuration?: number;
};

export type TrackSampleWindow = {
  times: number[];
  values: number[];
  duration: number;
};

export type ThreeRuntimeLane = "base" | "overlay" | "debug";

export type ThreeRuntimeClip<TEntry extends AnimationManifestEntry = AnimationManifestEntry> = TEntry & {
  sourceId: string;
  instance: number;
  action: AnimationAction;
  duration: number;
  targetWeight: number;
  lastTriggeredAt: number;
  lane: ThreeRuntimeLane;
};

export type ThreeRuntimeClipSnapshot<TEntry extends AnimationManifestEntry = AnimationManifestEntry> = {
  id: TEntry["id"];
  sourceId: string;
  instance: number;
  lane: ThreeRuntimeLane;
  states: string[];
  emotions: string[];
  gestures: string[];
  weight: number;
  targetWeight: number;
  time: number;
  duration: number;
  running: boolean;
  scheduled: boolean;
  loop?: string;
  source?: TEntry["source"];
};

export type ThreeRuntimeClipSnapshotOptions = {
  loop?: string;
};

export type ActiveThreeRuntimeClipSnapshotOptions<TEntry extends AnimationManifestEntry = AnimationManifestEntry> = {
  minimumWeight?: number;
  debugLoop?: string;
  loopForClip?: (clip: ThreeRuntimeClip<TEntry>) => string | undefined;
};

export type ThreeRuntimeInfluence = {
  base: number;
  overlay: number;
  debug: number;
};

export type ThreeRuntimeInfluenceOptions = {
  debugWeight?: number;
  includeDebugAsOverlay?: boolean;
};

export type ThreeRuntimePhaseSource = {
  action: Pick<AnimationAction, "time">;
  duration: number;
};

export type ThreeRuntimeStartTimeOptions = {
  startTime?: number;
  matchPhaseFrom?: ThreeRuntimePhaseSource | null;
  randomizeBaseTime?: boolean;
  random?: () => number;
};

export type PrepareThreeRuntimeActionOptions = ThreeRuntimeStartTimeOptions & {
  weight?: number;
  timeScale?: number;
};

export type ThreeBaseLoopSeamWindowOptions = {
  fraction?: number;
  min?: number;
  max?: number;
};

export type ThreeBaseLoopTransitionOptions = {
  elapsed: number;
  duration: number;
  fromWeight?: number;
  toWeight: number;
};

export type ThreeBaseLoopTransitionWeights = {
  progress: number;
  fromWeight: number;
  toWeight: number;
  complete: boolean;
};

export type ThreeOverlayFadeOptions = {
  time: number;
  duration: number;
  currentWeight: number;
  targetWeight: number;
  deltaSeconds: number;
  windowFraction?: number;
  minWindow?: number;
  maxWindow?: number;
  completionEpsilon?: number;
  fadeInSpeed?: number;
  fadeOutSpeed?: number;
  stopWeight?: number;
};

export type ThreeOverlayFadeResult = {
  fadeOutWindow: number;
  fadingOut: boolean;
  complete: boolean;
  targetWeight: number;
  nextWeight: number;
  blendSpeed: number;
  shouldStop: boolean;
};

export type ThreePresenceBoneTarget = {
  bone: string;
  rotation: Vec3;
  influence: number;
  speed?: number;
};

export type ThreePresenceApplyOptions = {
  resolveBone: ThreeBoneResolver;
  deltaSeconds: number;
  targets: readonly ThreePresenceBoneTarget[];
  enabled?: boolean;
};

export type ThreePresenceAppliedTarget = {
  bone: string;
  applied: boolean;
  influence: number;
  skippedReason?: string;
};

export type ThreePresenceApplyResult = {
  applied: boolean;
  targets: ThreePresenceAppliedTarget[];
  issues: string[];
};

export type ThreeLocomotionUpperBodyTargetsOptions = {
  influence?: number;
  phase?: number;
  swing?: number;
  speed?: number;
};

export type ThreeLocomotionUpperBodyPostureOptions = ThreeLocomotionUpperBodyTargetsOptions & {
  resolveBone: ThreeBoneResolver;
  deltaSeconds: number;
  enabled?: boolean;
};

export type ThreeLocomotionArmSide = "left" | "right";

export type ThreeLocomotionArmTarget = {
  side: ThreeLocomotionArmSide;
  appliedUpperArm: boolean;
  appliedLowerArm: boolean;
  appliedUpperArmDirection: boolean;
  skippedReason?: string;
};

export type ThreeFootPlantLegBinding = {
  id: string;
  hip: string;
  knee: string;
  ankle?: string;
  influence?: number;
  alignAnkleToGround?: boolean;
  ankleLocalUp?: Vec3;
};

export type ThreeFootPlantApplyOptions = {
  resolveBone: ThreeBoneResolver;
  pelvis?: string;
  legs: readonly ThreeFootPlantLegBinding[];
  influence?: number;
  deltaSeconds?: number;
  speed?: number;
  applyPelvis?: boolean;
  applyLegIk?: boolean;
};

export type ThreeFootPlantAppliedLeg = {
  id: string;
  planted: boolean;
  appliedHip: boolean;
  appliedKnee: boolean;
  appliedAnkle: boolean;
  skippedReason?: string;
};

export type ThreeFootPlantApplyResult = {
  applied: boolean;
  pelvisApplied: boolean;
  pelvisOffsetLocal: Vec3;
  influence: number;
  legs: ThreeFootPlantAppliedLeg[];
  issues: string[];
};

export type ThreeFootPlantClearOptions = {
  resolveBone: ThreeBoneResolver;
  pelvis?: string;
};

export type ThreeFootPlantClearResult = {
  cleared: boolean;
  issues: string[];
};

const tmpCorrection = new Quaternion();
const tmpCurrentWorld = new Quaternion();
const tmpTargetWorld = new Quaternion();
const tmpParentWorld = new Quaternion();
const tmpLocal = new Quaternion();
const tmpIdentity = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, "XYZ");
const tmpWorldDirection = new Vector3();
const tmpLocalDirection = new Vector3();

export function createThreeAnimationClip(clip: AnimationClip, options: ThreeAnimationClipOptions): ThreeAnimationClip {
  const playback = resolvePlaybackWindow(clip, options.playback, options.minimumDuration ?? 0.1);
  let runtimeDuration = playback.end - playback.start;
  const tracks = clip.tracks.flatMap((track) => {
    const boneName = track.humanBone ?? track.joint;
    if (!boneName) return [];
    const bone = options.resolveBone(String(boneName));
    if (!bone) return [];
    if (!trackHasValidShape(track)) {
      options.logger?.warn("invalid animation track skipped", options.id ?? clip.id, boneName, track.property);
      return [];
    }

    const property = normalizedTrackProperty(track.property);
    if (!property) {
      options.logger?.warn("unsupported animation track skipped", options.id ?? clip.id, boneName, track.property);
      return [];
    }
    const sampleWindow = sliceAnimationTrackWindow(track, playback.start, playback.end);
    if (sampleWindow.times.length < 2) return [];
    runtimeDuration = Math.max(runtimeDuration, sampleWindow.duration);

    if (property === "rotation") {
      const { values, invalidSamples } = retargetQuaternionTrackValues(
        sampleWindow.values,
        track.sourceRestQuaternion,
        options.targetRestQuaternion?.(String(boneName), bone) ?? bone.quaternion.toArray()
      );
      if (invalidSamples > 0) {
        options.logger?.warn("invalid retargeted quaternion samples repaired", boneName, invalidSamples);
      }
      return [new QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, Float32Array.from(sampleWindow.times), Float32Array.from(values))];
    }

    const targetProperty = property === "translation" ? "position" : "scale";
    return [new VectorKeyframeTrack(`${bone.uuid}.${targetProperty}`, Float32Array.from(sampleWindow.times), Float32Array.from(sampleWindow.values))];
  });

  if (tracks.length === 0) {
    options.logger?.warn("animation clip has no mapped runtime tracks", options.id ?? clip.id);
  }
  return new ThreeAnimationClip(options.id ?? clip.id, runtimeDuration, tracks);
}

export function sliceAnimationTrackWindow(track: AnimationTrack, start: number, end: number): TrackSampleWindow {
  const duration = Math.max(0, end - start);
  const times: number[] = [0];
  const values: number[] = sampleTrack(track, start);

  for (const sourceTime of track.times) {
    if (sourceTime <= start || sourceTime >= end) continue;
    times.push(sourceTime - start);
    values.push(...sampleTrack(track, sourceTime));
  }

  if (duration > 0) {
    times.push(duration);
    values.push(...sampleTrack(track, end));
  }
  return { times, values, duration };
}

export function applyThreeTrackPolicy(clip: ThreeAnimationClip, policy: TrackMaskPolicy): ThreeAnimationClip {
  const initialTrackCount = clip.tracks.length;
  clip.tracks = filterTracksByNamePolicy(clip.tracks, policy) as KeyframeTrack[];
  if (clip.tracks.length !== initialTrackCount) clip.resetDuration();
  return clip;
}

export function createThreeRuntimeClip<TEntry extends AnimationManifestEntry>(
  entry: TEntry,
  mixer: AnimationMixer,
  animationClip: ThreeAnimationClip,
  lane: ThreeRuntimeLane,
  instance = 0
): ThreeRuntimeClip<TEntry> {
  const action = mixer.clipAction(animationClip);
  configureThreeRuntimeAction(action);
  return {
    ...entry,
    sourceId: entry.id,
    instance,
    action,
    duration: animationClip.duration,
    targetWeight: 0,
    lastTriggeredAt: 0,
    lane
  };
}

export function createThreeRuntimeClipsForEntry<TEntry extends AnimationManifestEntry>(
  entry: TEntry,
  mixer: AnimationMixer,
  animationClip: ThreeAnimationClip
): ThreeRuntimeClip<TEntry>[] {
  applyThreeTrackPolicy(animationClip, ROOT_TRANSLATION_EXCLUDE_POLICY);
  if (entry.loop === false) {
    applyThreeTrackPolicy(animationClip, OVERLAY_UPPER_BODY_TRACK_POLICY);
    animationClip.name = `${entry.id}:overlay`;
    return [createThreeRuntimeClip(entry, mixer, animationClip, "overlay")];
  }

  applyThreeTrackPolicy(animationClip, BASE_PROCEDURAL_TRACK_POLICY);
  animationClip.name = `${entry.id}:base:a`;
  const secondClip = animationClip.clone();
  secondClip.name = `${entry.id}:base:b`;
  return [createThreeRuntimeClip(entry, mixer, animationClip, "base", 0), createThreeRuntimeClip(entry, mixer, secondClip, "base", 1)];
}

export function configureThreeRuntimeAction(action: AnimationAction): AnimationAction {
  action.enabled = false;
  action.paused = false;
  action.clampWhenFinished = true;
  action.zeroSlopeAtStart = true;
  action.zeroSlopeAtEnd = true;
  action.setLoop(LoopOnce, 1);
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(0);
  return action;
}

export function calculateThreeRuntimeStartTime(duration: number, options: ThreeRuntimeStartTimeOptions = {}): number {
  const safeDuration = sanitizeThreeRuntimeTime(duration);
  if (safeDuration <= 0) return 0;
  if (typeof options.startTime === "number") return euclideanModulo(sanitizeThreeRuntimeTime(options.startTime), safeDuration);

  const matchFrom = options.matchPhaseFrom;
  const sourceDuration = sanitizeThreeRuntimeTime(matchFrom?.duration ?? 0);
  const sourceTime = sanitizeThreeRuntimeTime(matchFrom?.action.time ?? 0);
  if (matchFrom && sourceDuration > 0) {
    return (euclideanModulo(sourceTime, sourceDuration) / sourceDuration) * safeDuration;
  }

  if (options.randomizeBaseTime !== false) {
    const randomValue = clamp01(options.random?.() ?? 0);
    return randomValue * safeDuration;
  }
  return 0;
}

export function prepareThreeRuntimeAction<TEntry extends AnimationManifestEntry>(
  clip: ThreeRuntimeClip<TEntry>,
  options: PrepareThreeRuntimeActionOptions = {}
): number {
  const weight = sanitizeThreeRuntimeWeight(options.weight ?? 0);
  const timeScale = finiteNonNegative(options.timeScale ?? 1, 1);
  const startTime = clip.lane === "base" ? calculateThreeRuntimeStartTime(clip.duration, options) : 0;
  clip.action.reset();
  clip.action.enabled = true;
  clip.action.paused = false;
  clip.action.stopFading();
  clip.action.stopWarping();
  clip.action.setEffectiveTimeScale(timeScale);
  clip.action.setEffectiveWeight(weight);
  clip.action.play();
  if (clip.lane === "base" && sanitizeThreeRuntimeTime(clip.duration) > 0) clip.action.time = startTime;
  return startTime;
}

export function calculateThreeBaseLoopSeamWindow(duration: number, options: ThreeBaseLoopSeamWindowOptions = {}): number {
  const safeDuration = sanitizeThreeRuntimeTime(duration);
  return clamp(safeDuration * finiteNonNegative(options.fraction ?? 0.18, 0.18), options.min ?? 0.32, options.max ?? 0.72);
}

export function calculateThreeBaseLoopTransitionWeights(options: ThreeBaseLoopTransitionOptions): ThreeBaseLoopTransitionWeights {
  const duration = Math.max(0.001, sanitizeThreeRuntimeTime(options.duration));
  const progress = smoothStep(0, 1, sanitizeThreeRuntimeTime(options.elapsed) / duration);
  const fromWeight = sanitizeThreeRuntimeWeight(options.fromWeight ?? 0) * (1 - progress);
  const toWeight = sanitizeThreeRuntimeWeight(options.toWeight) * progress;
  return {
    progress,
    fromWeight,
    toWeight,
    complete: progress >= 1
  };
}

export function calculateThreeOverlayFade(options: ThreeOverlayFadeOptions): ThreeOverlayFadeResult {
  const duration = sanitizeThreeRuntimeTime(options.duration);
  const time = sanitizeThreeRuntimeTime(options.time);
  const fadeOutWindow = clamp(
    duration * finiteNonNegative(options.windowFraction ?? 0.22, 0.22),
    options.minWindow ?? 0.18,
    options.maxWindow ?? 0.42
  );
  const completionEpsilon = finiteNonNegative(options.completionEpsilon ?? 0.02, 0.02);
  const fadingOut = time >= Math.max(0, duration - fadeOutWindow);
  const complete = time >= Math.max(0, duration - completionEpsilon);
  const targetWeight = fadingOut ? 0 : sanitizeThreeRuntimeWeight(options.targetWeight);
  const currentWeight = sanitizeThreeRuntimeWeight(options.currentWeight);
  const fadeInSpeed = finiteNonNegative(options.fadeInSpeed ?? 6.5, 6.5);
  const fadeOutSpeed = finiteNonNegative(options.fadeOutSpeed ?? 5.5, 5.5);
  const blendSpeed = targetWeight < currentWeight ? fadeOutSpeed : fadeInSpeed;
  const nextWeight = dampValue(currentWeight, targetWeight, blendSpeed, options.deltaSeconds);
  return {
    fadeOutWindow,
    fadingOut,
    complete,
    targetWeight,
    nextWeight,
    blendSpeed,
    shouldStop: complete && nextWeight < sanitizeThreeRuntimeWeight(options.stopWeight ?? 0.01)
  };
}

export function readThreeRuntimeClipSnapshot<TEntry extends AnimationManifestEntry>(
  clip: ThreeRuntimeClip<TEntry>,
  options: ThreeRuntimeClipSnapshotOptions = {}
): ThreeRuntimeClipSnapshot<TEntry> {
  const snapshot: ThreeRuntimeClipSnapshot<TEntry> = {
    id: clip.id,
    sourceId: clip.sourceId,
    instance: sanitizeThreeRuntimeCount(clip.instance),
    lane: clip.lane,
    states: [...(clip.states ?? [])],
    emotions: [...(clip.emotions ?? [])],
    gestures: [...(clip.gestures ?? [])],
    weight: sanitizeThreeRuntimeWeight(readThreeActionWeight(clip.action)),
    targetWeight: sanitizeThreeRuntimeWeight(clip.targetWeight),
    time: sanitizeThreeRuntimeTime(clip.action.time),
    duration: sanitizeThreeRuntimeTime(clip.duration),
    running: clip.action.isRunning(),
    scheduled: clip.action.isScheduled()
  };
  if (options.loop !== undefined) snapshot.loop = options.loop;
  if (clip.source !== undefined) snapshot.source = clip.source;
  return snapshot;
}

export function readActiveThreeRuntimeClipSnapshots<TEntry extends AnimationManifestEntry>(
  clips: readonly ThreeRuntimeClip<TEntry>[],
  options: ActiveThreeRuntimeClipSnapshotOptions<TEntry> = {}
): ThreeRuntimeClipSnapshot<TEntry>[] {
  const minimumWeight = sanitizeThreeRuntimeWeight(options.minimumWeight ?? 0.001);
  return clips.flatMap((clip) => {
    const loop = options.loopForClip?.(clip) ?? (clip.lane === "base" ? "seamed-once" : clip.lane === "debug" ? options.debugLoop : "once");
    const snapshot = readThreeRuntimeClipSnapshot(clip, loop === undefined ? {} : { loop });
    return snapshot.scheduled || snapshot.weight > minimumWeight ? [snapshot] : [];
  });
}

export function calculateThreeRuntimeInfluence(
  clips: readonly ThreeRuntimeClip[],
  options: ThreeRuntimeInfluenceOptions = {}
): ThreeRuntimeInfluence {
  const influence: ThreeRuntimeInfluence = { base: 0, overlay: 0, debug: 0 };
  for (const clip of clips) {
    const weight = sanitizeThreeRuntimeWeight(readThreeActionWeight(clip.action));
    if (clip.lane === "base") influence.base = Math.max(influence.base, weight);
    else if (clip.lane === "overlay") influence.overlay = Math.max(influence.overlay, weight);
    else if (clip.lane === "debug") influence.debug = Math.max(influence.debug, weight);
  }
  influence.debug = Math.max(influence.debug, sanitizeThreeRuntimeWeight(options.debugWeight ?? 0));
  if (options.includeDebugAsOverlay !== false) influence.overlay = Math.max(influence.overlay, influence.debug);
  return influence;
}

function readThreeActionWeight(action: AnimationAction): number {
  return action.getEffectiveWeight();
}

function sanitizeThreeRuntimeTime(value: number): number {
  return finiteNonNegative(value, 0);
}

function sanitizeThreeRuntimeWeight(value: number): number {
  return clamp01(value);
}

function sanitizeThreeRuntimePhase(value: number): number {
  return euclideanModulo(Number.isFinite(value) ? value : 0, 1);
}

function sanitizeThreeRuntimeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function sanitizeThreeRuntimeSwing(value: number | undefined, phase: number): number {
  return clamp(Number.isFinite(value ?? Number.NaN) ? value! : Math.sin(phase * Math.PI * 2), -1, 1);
}

function dampedInfluenceAmount(influence: number, speed: number, deltaSeconds: number | undefined): number {
  return clamp01(influence * (deltaSeconds === undefined ? 1 : dampAlpha(speed, sanitizeThreeRuntimeTime(deltaSeconds))));
}

export function applyThreePresenceTargets(options: ThreePresenceApplyOptions): ThreePresenceApplyResult {
  const issues: string[] = [];
  const targets: ThreePresenceAppliedTarget[] = [];
  if (options.enabled === false) return { applied: false, targets, issues };
  const deltaSeconds = sanitizeThreeRuntimeTime(options.deltaSeconds);
  for (const target of options.targets) {
    const influence = sanitizeThreeRuntimeWeight(target.influence);
    const speed = finiteNonNegative(target.speed ?? 8, 8);
    const appliedTarget: ThreePresenceAppliedTarget = { bone: target.bone, applied: false, influence };
    targets.push(appliedTarget);
    if (influence <= 0) {
      appliedTarget.skippedReason = "zero-influence";
      continue;
    }
    const bone = options.resolveBone(target.bone);
    if (!bone) {
      appliedTarget.skippedReason = "missing-bone";
      issues.push(`${target.bone}: missing bone`);
      continue;
    }
    appliedTarget.applied = applyLocalEulerTarget(bone, target.rotation, influence, deltaSeconds, speed);
    if (!appliedTarget.applied) appliedTarget.skippedReason = "invalid-or-negligible-target";
  }
  return { applied: targets.some((target) => target.applied), targets, issues };
}

export function createThreeLocomotionUpperBodyTargets(options: ThreeLocomotionUpperBodyTargetsOptions = {}): ThreePresenceBoneTarget[] {
  const influence = sanitizeThreeRuntimeWeight(options.influence ?? 1);
  if (influence <= 0) return [];
  const phase = sanitizeThreeRuntimePhase(options.phase ?? 0);
  const swing = sanitizeThreeRuntimeSwing(options.swing, phase);
  const counterSwing = -swing;
  const speed = finiteNonNegative(options.speed ?? 18, 18);

  return [
    { bone: "leftShoulder", rotation: [0.015, -0.018, 0.026 + swing * 0.014], influence: influence * 0.72, speed },
    { bone: "rightShoulder", rotation: [0.015, 0.018, -0.026 + counterSwing * 0.014], influence: influence * 0.72, speed },
    { bone: "leftUpperArm", rotation: [0.26 + swing * 0.18, 0.055 + swing * 0.03, 1.64 + swing * 0.05], influence, speed: speed * 1.4 },
    { bone: "rightUpperArm", rotation: [0.26 + counterSwing * 0.18, -0.055 + counterSwing * 0.03, -1.64 + counterSwing * 0.05], influence, speed: speed * 1.4 },
    { bone: "leftLowerArm", rotation: [1.55 + Math.max(0, -swing) * 0.24, 0.42 + swing * 0.05, -1.18 - Math.max(0, swing) * 0.18], influence, speed: speed * 1.15 },
    { bone: "rightLowerArm", rotation: [1.55 + Math.max(0, -counterSwing) * 0.24, -0.42 + counterSwing * 0.05, 1.18 + Math.max(0, counterSwing) * 0.18], influence, speed: speed * 1.15 },
    { bone: "leftHand", rotation: [0.16, 0.08, -0.2 + swing * 0.024], influence: influence * 0.82, speed },
    { bone: "rightHand", rotation: [0.16, -0.08, 0.2 + counterSwing * 0.024], influence: influence * 0.82, speed }
  ];
}

export function applyThreeLocomotionUpperBodyPosture(options: ThreeLocomotionUpperBodyPostureOptions): ThreePresenceApplyResult {
  const targetOptions: ThreeLocomotionUpperBodyTargetsOptions = {};
  if (options.influence !== undefined) targetOptions.influence = options.influence;
  if (options.phase !== undefined) targetOptions.phase = options.phase;
  if (options.swing !== undefined) targetOptions.swing = options.swing;
  if (options.speed !== undefined) targetOptions.speed = options.speed;
  const applyOptions: ThreePresenceApplyOptions = {
    resolveBone: options.resolveBone,
    deltaSeconds: options.deltaSeconds,
    targets: createThreeLocomotionUpperBodyTargets(targetOptions)
  };
  if (options.enabled !== undefined) applyOptions.enabled = options.enabled;
  const result = applyThreePresenceTargets(applyOptions);
  const arms = applyThreeLocomotionArmTargets(options);
  return {
    applied: result.applied || arms.some((arm) => arm.appliedUpperArmDirection || arm.appliedUpperArm || arm.appliedLowerArm),
    targets: [
      ...result.targets,
      ...arms.flatMap((arm) => [
        {
          bone: `${arm.side}UpperArm`,
          applied: arm.appliedUpperArmDirection || arm.appliedUpperArm,
          influence: sanitizeThreeRuntimeWeight(options.influence ?? 1),
          ...(arm.skippedReason && !arm.appliedUpperArm ? { skippedReason: arm.skippedReason } : {})
        },
        {
          bone: `${arm.side}LowerArm`,
          applied: arm.appliedLowerArm,
          influence: sanitizeThreeRuntimeWeight(options.influence ?? 1),
          ...(arm.skippedReason && !arm.appliedLowerArm ? { skippedReason: arm.skippedReason } : {})
        }
      ])
    ],
    issues: result.issues
  };
}

function applyThreeLocomotionArmTargets(options: ThreeLocomotionUpperBodyPostureOptions): ThreeLocomotionArmTarget[] {
  if (options.enabled === false) return [];
  const influence = sanitizeThreeRuntimeWeight(options.influence ?? 1);
  const speed = finiteNonNegative(options.speed ?? 18, 18);
  const amount = dampedInfluenceAmount(influence, speed * 1.25, options.deltaSeconds);
  if (amount <= 0) {
    return [
      { side: "left", appliedUpperArmDirection: false, appliedUpperArm: false, appliedLowerArm: false, skippedReason: "zero-influence" },
      { side: "right", appliedUpperArmDirection: false, appliedUpperArm: false, appliedLowerArm: false, skippedReason: "zero-influence" }
    ];
  }

  const hips = options.resolveBone("hips");
  const leftUpper = options.resolveBone("leftUpperArm");
  const rightUpper = options.resolveBone("rightUpperArm");
  const shoulderWidth = estimateShoulderWidth(leftUpper, rightUpper);
  const phase = sanitizeThreeRuntimePhase(options.phase ?? 0);
  const swing = sanitizeThreeRuntimeSwing(options.swing, phase);

  return (["left", "right"] as const).map((side) => {
    const sign = side === "left" ? 1 : -1;
    const upper = options.resolveBone(`${side}UpperArm`);
    const lower = options.resolveBone(`${side}LowerArm`);
    const hand = options.resolveBone(`${side}Hand`);
    if (!upper || !lower || !hand) {
      return { side, appliedUpperArmDirection: false, appliedUpperArm: false, appliedLowerArm: false, skippedReason: "missing-arm-bone" };
    }

    upper.parent?.updateMatrixWorld(true);
    upper.updateMatrixWorld(true);
    lower.updateMatrixWorld(true);
    hand.updateMatrixWorld(true);

    const root = objectWorldVec3(upper);
    const joint = objectWorldVec3(lower);
    const end = objectWorldVec3(hand);
    const hip = hips ? objectWorldVec3(hips) : [root[0], root[1] - 0.52, root[2]] satisfies Vec3;
    const upperLength = lengthVec3(subVec3(joint, root));
    const lowerLength = lengthVec3(subVec3(end, joint));
    const armLength = Math.max(0.25, upperLength + lowerLength);
    const sideSwing = side === "left" ? swing : -swing;
    const desiredUpperDirection = normalizeVec3([sign * 0.02, -0.985, 0.12 + sideSwing * 0.02], [0, -1, 0]);
    const upperCorrection = quatFromUnitVectors(normalizeVec3(subVec3(joint, root), desiredUpperDirection), desiredUpperDirection);
    const appliedUpperArmDirection = applyWorldQuaternionCorrection(upper, upperCorrection, amount);
    upper.updateMatrixWorld(true);
    lower.updateMatrixWorld(true);
    hand.updateMatrixWorld(true);
    const correctedRoot = objectWorldVec3(upper);
    const correctedJoint = objectWorldVec3(lower);
    const correctedEnd = objectWorldVec3(hand);
    const desiredJoint = addVec3(correctedRoot, scaleVec3(desiredUpperDirection, upperLength));
    const handTarget: Vec3 = [
      hip[0] + sign * Math.min(0.038, shoulderWidth * 0.08),
      correctedRoot[1] - armLength * 0.72,
      hip[2] + 0.045 + sideSwing * 0.018
    ];
    const pole = normalizeVec3(subVec3(desiredJoint, correctedRoot), desiredUpperDirection);
    const ik = solveTwoBoneIkCorrections({
      root: correctedRoot,
      joint: correctedJoint,
      end: correctedEnd,
      target: handTarget,
      pole: [sign * Math.max(0.02, shoulderWidth * 0.06), pole[1] - 0.08, 0.42 + sideSwing * 0.035],
      maxStretch: 0.58
    });

    const appliedUpperArm = applyWorldQuaternionCorrection(upper, ik.rootCorrection, amount);
    const appliedLowerArm = applyWorldQuaternionCorrection(lower, ik.jointCorrection, amount);
    upper.updateMatrixWorld(true);
    lower.updateMatrixWorld(true);
    const finalUpperDirectionCorrection = quatFromUnitVectors(normalizeVec3(subVec3(objectWorldVec3(lower), objectWorldVec3(upper)), desiredUpperDirection), desiredUpperDirection);
    const appliedFinalUpperArmDirection = applyWorldQuaternionCorrection(upper, finalUpperDirectionCorrection, amount);
    upper.updateMatrixWorld(true);
    lower.updateMatrixWorld(true);
    hand.updateMatrixWorld(true);
    const desiredLowerDirection = normalizeVec3([-sign * 0.32, -0.88, -0.16 + sideSwing * 0.02], [0, -1, 0]);
    const finalLowerDirectionCorrection = quatFromUnitVectors(normalizeVec3(subVec3(objectWorldVec3(hand), objectWorldVec3(lower)), desiredLowerDirection), desiredLowerDirection);
    const appliedFinalLowerArmDirection = applyWorldQuaternionCorrection(lower, finalLowerDirectionCorrection, amount);
    return {
      side,
      appliedUpperArmDirection: appliedUpperArmDirection || appliedFinalUpperArmDirection,
      appliedUpperArm,
      appliedLowerArm: appliedLowerArm || appliedFinalLowerArmDirection
    };
  });
}

export function clearThreeFootPlantOffsets(options: ThreeFootPlantClearOptions): ThreeFootPlantClearResult {
  const issues: string[] = [];
  let cleared = false;
  if (options.pelvis) {
    const pelvis = options.resolveBone(options.pelvis);
    if (pelvis) {
      cleared = clearPreviousFootPlantPelvisOffset(pelvis) || cleared;
      pelvis.updateMatrixWorld(true);
    } else {
      issues.push(`${options.pelvis}: missing pelvis bone`);
    }
  }
  return { cleared, issues };
}

export function applyThreeFootPlantResult(result: FootPlantResult, options: ThreeFootPlantApplyOptions): ThreeFootPlantApplyResult {
  const influence = sanitizeThreeRuntimeWeight(options.influence ?? 1);
  const speed = finiteNonNegative(options.speed ?? 32, 32);
  const amount = dampedInfluenceAmount(influence, speed, options.deltaSeconds);
  const issues = [...result.issues];
  const applyPelvis = options.applyPelvis !== false;
  const applyLegIk = options.applyLegIk !== false;
  const legs: ThreeFootPlantAppliedLeg[] = [];
  let pelvisApplied = false;
  let pelvisOffsetLocal: Vec3 = [0, 0, 0];

  if (applyPelvis && options.pelvis) {
    const pelvis = options.resolveBone(options.pelvis);
    if (pelvis) {
      clearPreviousFootPlantPelvisOffset(pelvis);
      const offsetLength = lengthVec3(result.pelvisOffset);
      if (amount > 0 && offsetLength > 1e-6) {
        pelvisOffsetLocal = worldOffsetToLocal(pelvis, result.pelvisOffset, amount);
        pelvis.position.add(tmpWorldDirection.set(pelvisOffsetLocal[0], pelvisOffsetLocal[1], pelvisOffsetLocal[2]));
        setPreviousFootPlantPelvisOffset(pelvis, pelvisOffsetLocal);
        pelvis.updateMatrixWorld(true);
        pelvisApplied = true;
      }
    } else {
      issues.push(`${options.pelvis}: missing pelvis bone`);
    }
  }

  for (const binding of options.legs) {
    const leg = result.legs.find((candidate) => candidate.id === binding.id);
    const applied: ThreeFootPlantAppliedLeg = {
      id: binding.id,
      planted: Boolean(leg?.planted),
      appliedHip: false,
      appliedKnee: false,
      appliedAnkle: false
    };
    legs.push(applied);

    if (!leg) {
      applied.skippedReason = "missing-foot-plant-result";
      issues.push(`${binding.id}: missing foot-plant result`);
      continue;
    }
    if (!leg.planted) {
      applied.skippedReason = leg.skippedReason ?? "not-planted";
      continue;
    }

    const legAmount = sanitizeThreeRuntimeWeight(amount * sanitizeThreeRuntimeWeight(binding.influence ?? 1));
    if (legAmount <= 0) {
      applied.skippedReason = "zero-influence";
      continue;
    }

    if (applyLegIk) {
      if (leg.ik) {
        const hip = options.resolveBone(binding.hip);
        const knee = options.resolveBone(binding.knee);
        if (hip) {
          applied.appliedHip = applyWorldQuaternionCorrection(hip, leg.ik.rootCorrection, legAmount);
        } else {
          issues.push(`${binding.id}: missing hip bone ${binding.hip}`);
        }
        if (knee) {
          applied.appliedKnee = applyWorldQuaternionCorrection(knee, leg.ik.jointCorrection, legAmount);
        } else {
          issues.push(`${binding.id}: missing knee bone ${binding.knee}`);
        }
      } else {
        issues.push(`${binding.id}: missing ik correction`);
      }
    }

    if (binding.ankle && binding.alignAnkleToGround !== false) {
      const ankle = options.resolveBone(binding.ankle);
      if (ankle) {
        applied.appliedAnkle = applyAnkleGroundAlignment(ankle, leg.groundNormal, binding.ankleLocalUp ?? [0, 1, 0], legAmount);
      } else {
        issues.push(`${binding.id}: missing ankle bone ${binding.ankle}`);
      }
    }
  }

  return {
    applied: pelvisApplied || legs.some((leg) => leg.appliedHip || leg.appliedKnee || leg.appliedAnkle),
    pelvisApplied,
    pelvisOffsetLocal,
    influence,
    legs,
    issues
  };
}

function resolvePlaybackWindow(clip: AnimationClip, playback: AnimationManifestEntry["playback"] | undefined, minimumDuration: number): { start: number; end: number } {
  const duration = sanitizeThreeRuntimeTime(clip.duration);
  const minDuration = finiteNonNegative(minimumDuration, 0.1);
  const start = clamp(playback?.start ?? 0, 0, duration);
  const requestedEnd = clamp(playback?.end ?? duration, 0, duration);
  const end = Math.max(start + minDuration, requestedEnd);
  return {
    start: Math.min(start, Math.max(0, duration - minDuration)),
    end: clamp(end, minDuration, duration)
  };
}

function trackHasValidShape(track: AnimationTrack): boolean {
  const property = normalizedTrackProperty(track.property);
  if (!property) return false;
  const stride = trackStride(property);
  return track.times.length >= 2 && track.values.length === track.times.length * stride && track.values.every(Number.isFinite);
}

type FootPlantOffsetObject = Object3D & { __waifuAnimationFootPlantOffset?: Vector3 };

function getPreviousFootPlantPelvisOffset(bone: Object3D): Vector3 | undefined {
  return (bone as FootPlantOffsetObject).__waifuAnimationFootPlantOffset;
}

function setPreviousFootPlantPelvisOffset(bone: Object3D, offset: Vec3): void {
  (bone as FootPlantOffsetObject).__waifuAnimationFootPlantOffset = new Vector3(offset[0], offset[1], offset[2]);
}

function clearPreviousFootPlantPelvisOffset(bone: Object3D): boolean {
  const previous = getPreviousFootPlantPelvisOffset(bone);
  if (!previous) return false;
  const changed = previous.lengthSq() > 1e-12;
  bone.position.sub(previous);
  previous.set(0, 0, 0);
  return changed;
}

function worldOffsetToLocal(bone: Object3D, offset: Vec3, amount: number): Vec3 {
  tmpWorldDirection.set(offset[0] * amount, offset[1] * amount, offset[2] * amount);
  const parent = bone.parent;
  if (parent) {
    parent.getWorldQuaternion(tmpParentWorld).invert();
    tmpWorldDirection.applyQuaternion(tmpParentWorld);
  }
  return [tmpWorldDirection.x, tmpWorldDirection.y, tmpWorldDirection.z];
}

function objectWorldVec3(object: Object3D): Vec3 {
  object.getWorldPosition(tmpWorldDirection);
  return [tmpWorldDirection.x, tmpWorldDirection.y, tmpWorldDirection.z];
}

function estimateShoulderWidth(leftUpper: Object3D | null | undefined, rightUpper: Object3D | null | undefined): number {
  if (!leftUpper || !rightUpper) return 0.42;
  leftUpper.updateMatrixWorld(true);
  rightUpper.updateMatrixWorld(true);
  const left = objectWorldVec3(leftUpper);
  const right = objectWorldVec3(rightUpper);
  return clamp(lengthVec3([left[0] - right[0], left[1] - right[1], left[2] - right[2]]), 0.22, 0.72);
}

function quatToThree(value: Quat): Quaternion {
  return tmpCorrection.set(value[0], value[1], value[2], value[3]).normalize();
}

function applyWorldQuaternionCorrection(bone: Object3D, correction: Quat, influence: number): boolean {
  if (lengthVec3([correction[0], correction[1], correction[2]]) <= 1e-7 || influence <= 0) return false;
  bone.updateMatrixWorld(true);
  bone.getWorldQuaternion(tmpCurrentWorld);
  return applyWorldQuaternionDelta(bone, quatToThree(correction), influence);
}

function applyAnkleGroundAlignment(bone: Object3D, groundNormal: Vec3, localUp: Vec3, influence: number): boolean {
  const normal = normalizeVec3(groundNormal, [0, 1, 0]);
  if (influence <= 0 || lengthVec3(normal) <= 1e-7) return false;
  bone.updateMatrixWorld(true);
  bone.getWorldQuaternion(tmpCurrentWorld);
  const worldUp = rotateVec3ByQuat([tmpCurrentWorld.x, tmpCurrentWorld.y, tmpCurrentWorld.z, tmpCurrentWorld.w], normalizeVec3(localUp, [0, 1, 0]));
  const correction = quatFromUnitVectors(worldUp, normal, [0, 0, 1]);
  tmpLocalDirection.set(correction[0], correction[1], correction[2]);
  if (tmpLocalDirection.lengthSq() <= 1e-12) return false;
  return applyWorldQuaternionDelta(bone, quatToThree(correction), influence);
}

function applyWorldQuaternionDelta(bone: Object3D, deltaWorld: Quaternion, influence: number): boolean {
  tmpCorrection.copy(deltaWorld);
  if (influence < 0.999) tmpCorrection.slerp(tmpIdentity, 1 - influence).normalize();
  tmpTargetWorld.copy(tmpCorrection).multiply(tmpCurrentWorld).normalize();
  bone.parent?.getWorldQuaternion(tmpParentWorld);
  if (bone.parent) {
    tmpLocal.copy(tmpParentWorld).invert().multiply(tmpTargetWorld).normalize();
  } else {
    tmpLocal.copy(tmpTargetWorld);
  }
  bone.quaternion.copy(tmpLocal);
  bone.updateMatrixWorld(true);
  return true;
}

function applyLocalEulerTarget(bone: Object3D, euler: Vec3, influence: number, deltaSeconds: number, speed: number): boolean {
  if (influence <= 0 || !euler.every(Number.isFinite)) return false;
  tmpTargetWorld.setFromEuler(tmpEuler.set(euler[0], euler[1], euler[2], "XYZ")).normalize();
  if (!Number.isFinite(tmpTargetWorld.x) || !Number.isFinite(tmpTargetWorld.y) || !Number.isFinite(tmpTargetWorld.z) || !Number.isFinite(tmpTargetWorld.w)) {
    return false;
  }
  const alpha = dampedInfluenceAmount(influence, speed, deltaSeconds);
  if (alpha <= 0) return false;
  tmpCurrentWorld.copy(bone.quaternion);
  bone.quaternion.slerpQuaternions(tmpCurrentWorld, tmpTargetWorld, alpha).normalize();
  return true;
}
