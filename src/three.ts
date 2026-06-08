import {
  AnimationClip as ThreeAnimationClip,
  LoopOnce,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  type AnimationAction,
  type AnimationMixer,
  type KeyframeTrack,
  type Object3D
} from "three";
import { type AnimationClip, type AnimationTrack, normalizedTrackProperty, sampleTrack, trackStride } from "./clip.js";
import { clamp } from "./math.js";
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
