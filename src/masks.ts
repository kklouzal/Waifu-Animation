export type TrackLike = {
  name: string;
};

export type TrackNameRule = string | RegExp;

export type TrackMaskPolicy = {
  include?: TrackNameRule[];
  exclude?: TrackNameRule[];
};

function matchesRule(name: string, rule: TrackNameRule): boolean {
  return typeof rule === "string" ? name.includes(rule) : rule.test(name);
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

export const ROOT_TRANSLATION_EXCLUDE_POLICY: TrackMaskPolicy = {
  exclude: [/(hips|Hips)\.position$/]
};

export const BASE_PROCEDURAL_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [/(thumb|index|middle|ring|little)/i]
};

export const OVERLAY_UPPER_BODY_TRACK_POLICY: TrackMaskPolicy = {
  exclude: [/(upperLeg|lowerLeg|foot|toes|thumb|index|middle|ring|little)/i]
};
