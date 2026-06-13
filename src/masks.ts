import { type AnimationClip, type AnimationTrack } from "./clip.js";

export type TrackLike = {
  name: string;
};

export type TrackNameRule = string | RegExp;
export type SourceTrackRule = string | RegExp | ((track: AnimationTrack) => boolean);

export type TrackMaskPolicy = {
  include?: TrackNameRule[];
  exclude?: TrackNameRule[];
};

export type SourceTrackMaskPolicy = {
  include?: SourceTrackRule[];
  exclude?: SourceTrackRule[];
};

function matchesRule(name: string, rule: TrackNameRule): boolean {
  return typeof rule === "string" ? name.includes(rule) : rule.test(name);
}

function sourceTrackName(track: AnimationTrack): string {
  return String(track.humanBone ?? track.joint ?? "");
}

function matchesSourceRule(track: AnimationTrack, rule: SourceTrackRule): boolean {
  if (typeof rule === "function") return rule(track);
  return matchesRule(sourceTrackName(track), rule);
}

export function trackNameAllowed(name: string, policy: TrackMaskPolicy): boolean {
  if (policy.include && policy.include.length > 0 && !policy.include.some((rule) => matchesRule(name, rule))) {
    return false;
  }
  if (policy.exclude?.some((rule) => matchesRule(name, rule))) {
    return false;
  }
  return true;
}

export function filterTracksByNamePolicy<T extends TrackLike>(tracks: readonly T[], policy: TrackMaskPolicy): T[] {
  return tracks.filter((track) => trackNameAllowed(track.name, policy));
}

export function sourceTrackAllowed(track: AnimationTrack, policy: SourceTrackMaskPolicy): boolean {
  if (policy.include && policy.include.length > 0 && !policy.include.some((rule) => matchesSourceRule(track, rule))) {
    return false;
  }
  if (policy.exclude?.some((rule) => matchesSourceRule(track, rule))) {
    return false;
  }
  return true;
}

export function filterSourceTracksByPolicy(tracks: readonly AnimationTrack[], policy: SourceTrackMaskPolicy): AnimationTrack[] {
  return tracks.filter((track) => sourceTrackAllowed(track, policy));
}

export function applySourceTrackPolicy(clip: AnimationClip, policy: SourceTrackMaskPolicy): AnimationClip {
  return {
    ...clip,
    tracks: filterSourceTracksByPolicy(clip.tracks, policy)
  };
}

export const ROOT_TRANSLATION_EXCLUDE_POLICY: TrackMaskPolicy = {
  exclude: [/(hips|Hips)\.position$/]
};

export const BASE_PROCEDURAL_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [/(thumb|index|middle|ring|little)/i]
};

export const OVERLAY_UPPER_BODY_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [/(upperLeg|lowerLeg|foot|toes|thumb|index|middle|ring|little)/i]
};

export const LOCOMOTION_BASE_SOURCE_TRACK_POLICY: SourceTrackMaskPolicy = {
  exclude: [
    /^(left|right)(Shoulder|UpperArm|LowerArm|Hand)/,
    /^(left|right)(Thumb|Index|Middle|Ring|Little)/
  ]
};
