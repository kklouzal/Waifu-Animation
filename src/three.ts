import {
  AnimationClip as ThreeAnimationClip,
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
import { type FootPlantResult } from "./ik.js";
import { type Quat, type Vec3, clamp, clamp01, dampAlpha, lengthVec3, normalizeVec3, quatFromUnitVectors, rotateVec3ByQuat } from "./math.js";
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
    const sampleWindow = sliceAnimationTrackWindow(track, playback.start, playback.end);
    if (sampleWindow.times.length < 2) return [];
    runtimeDuration = Math.max(runtimeDuration, sampleWindow.duration);

    if (property === "rotation") {
      const { values, invalidSamples } = retargetQuaternionTrackValues(
        sampleWindow.values,
        track.sourceRestQuaternion,
        bone.quaternion.toArray()
      );
      if (invalidSamples > 0) {
        options.logger?.warn("invalid retargeted quaternion samples repaired", boneName, invalidSamples);
      }
      return [new QuaternionKeyframeTrack(`${bone.name}.quaternion`, Float32Array.from(sampleWindow.times), Float32Array.from(values))];
    }

    const targetProperty = property === "translation" ? "position" : "scale";
    return [new VectorKeyframeTrack(`${bone.name}.${targetProperty}`, Float32Array.from(sampleWindow.times), Float32Array.from(sampleWindow.values))];
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
  const influence = clamp01(options.influence ?? 1);
  const amount = influence * (options.deltaSeconds === undefined ? 1 : dampAlpha(options.speed ?? 32, options.deltaSeconds));
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

    const legAmount = clamp01(amount * (binding.influence ?? 1));
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
  const duration = Math.max(0, clip.duration);
  const start = clamp(playback?.start ?? 0, 0, duration);
  const requestedEnd = clamp(playback?.end ?? duration, 0, duration);
  const end = Math.max(start + minimumDuration, requestedEnd);
  return {
    start: Math.min(start, Math.max(0, duration - minimumDuration)),
    end: clamp(end, minimumDuration, duration)
  };
}

function trackHasValidShape(track: AnimationTrack): boolean {
  const stride = trackStride(track.property);
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

function quatToThree(value: Quat): Quaternion {
  return tmpCorrection.set(value[0], value[1], value[2], value[3]).normalize();
}

function applyWorldQuaternionCorrection(bone: Object3D, correction: Quat, influence: number): boolean {
  if (lengthVec3([correction[0], correction[1], correction[2]]) <= 1e-7 || influence <= 0) return false;
  bone.updateMatrixWorld(true);
  bone.getWorldQuaternion(tmpCurrentWorld);
  tmpCorrection.copy(quatToThree(correction));
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

function applyAnkleGroundAlignment(bone: Object3D, groundNormal: Vec3, localUp: Vec3, influence: number): boolean {
  const normal = normalizeVec3(groundNormal, [0, 1, 0]);
  if (influence <= 0 || lengthVec3(normal) <= 1e-7) return false;
  bone.updateMatrixWorld(true);
  bone.getWorldQuaternion(tmpCurrentWorld);
  const worldUp = rotateVec3ByQuat([tmpCurrentWorld.x, tmpCurrentWorld.y, tmpCurrentWorld.z, tmpCurrentWorld.w], normalizeVec3(localUp, [0, 1, 0]));
  const correction = quatFromUnitVectors(worldUp, normal, [0, 0, 1]);
  tmpLocalDirection.set(correction[0], correction[1], correction[2]);
  if (tmpLocalDirection.lengthSq() <= 1e-12) return false;
  tmpCorrection.set(correction[0], correction[1], correction[2], correction[3]).normalize();
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
