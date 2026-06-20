import { type AnimationClip, type AnimationTrack, normalizedTrackProperty } from "./clip.js";

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

const ARM_TRACK_RULE = /(shoulder|upperArm|lowerArm|hand)/i;
const FINGER_TRACK_RULE = /(thumb|index|middle|ring|little)/i;
const ARM_SOURCE_TRACK_RULE = /^(left|right)(Shoulder|UpperArm|LowerArm|Hand)/;
const FINGER_SOURCE_TRACK_RULE = /^(left|right)(Thumb|Index|Middle|Ring|Little)/;
const ROOT_CARRIER_POSITION_RULE = /^(?:hips|root|pelvis)\.position$/i;

export function trackNameMatchesRule(name: string, rule: TrackNameRule): boolean {
  if (typeof rule === "string") return name.includes(rule);
  if (!rule.global && !rule.sticky) return rule.test(name);
  rule.lastIndex = 0;
  const matched = rule.test(name);
  rule.lastIndex = 0;
  return matched;
}

function sourceTrackName(track: AnimationTrack): string {
  return String(track.humanBone ?? track.joint ?? "");
}

function sourceTrackPropertyNames(track: AnimationTrack): string[] {
  const declared = String(track.property);
  const normalized = normalizedTrackProperty(declared);
  const runtime = normalized === "rotation" ? "quaternion" : normalized === "translation" ? "position" : normalized;
  return Array.from(new Set([declared, ...(runtime ? [runtime] : [])]));
}

function sourceTrackNames(track: AnimationTrack): string[] {
  const name = sourceTrackName(track);
  if (!name) return [name];
  return [name, ...sourceTrackPropertyNames(track).map((property) => `${name}.${property}`)];
}

function matchesSourceRule(track: AnimationTrack, rule: SourceTrackRule): boolean {
  if (typeof rule === "function") return rule(track);
  return sourceTrackNames(track).some((name) => trackNameMatchesRule(name, rule));
}

function policyAllows<TRule>(policy: { include?: TRule[]; exclude?: TRule[] }, matches: (rule: TRule) => boolean): boolean {
  if (policy.include && policy.include.length > 0 && !policy.include.some(matches)) {
    return false;
  }
  if (policy.exclude?.some(matches)) {
    return false;
  }
  return true;
}

export function trackNameAllowed(name: string, policy: TrackMaskPolicy): boolean {
  return policyAllows(policy, (rule) => trackNameMatchesRule(name, rule));
}

export function filterTracksByNamePolicy<T extends TrackLike>(tracks: readonly T[], policy: TrackMaskPolicy): T[] {
  return tracks.filter((track) => trackNameAllowed(track.name, policy));
}

export function sourceTrackAllowed(track: AnimationTrack, policy: SourceTrackMaskPolicy): boolean {
  return policyAllows(policy, (rule) => matchesSourceRule(track, rule));
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
  exclude: [ROOT_CARRIER_POSITION_RULE]
};

export const ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY: SourceTrackMaskPolicy = {
  exclude: [ROOT_CARRIER_POSITION_RULE]
};

export const AUTHORED_BASE_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [FINGER_TRACK_RULE]
};

export const AUTHORED_BASE_SOURCE_TRACK_POLICY: SourceTrackMaskPolicy = {
  exclude: [FINGER_SOURCE_TRACK_RULE]
};

export const BASE_PROCEDURAL_TRACK_POLICY = AUTHORED_BASE_TRACK_POLICY;

export const BASE_PROCEDURAL_SOURCE_TRACK_POLICY = AUTHORED_BASE_SOURCE_TRACK_POLICY;

export const OVERLAY_UPPER_BODY_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [/(upperLeg|lowerLeg|foot|toes)/i, FINGER_TRACK_RULE]
};

export const LOCOMOTION_BASE_SOURCE_TRACK_POLICY: SourceTrackMaskPolicy = {
  exclude: [FINGER_SOURCE_TRACK_RULE]
};
