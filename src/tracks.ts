import { EPSILON, clamp01, dotQuat, ensureShortestQuat, isFiniteNumber, normalizeQuat, slerpQuat, type Quat } from "./math.js";

export type UserTrackType = "float" | "float2" | "float3" | "float4" | "quaternion";
export type UserTrackInterpolation = "linear" | "step";

export type Float2 = [number, number];
export type Float4 = [number, number, number, number];

export type UserTrackValue<T extends UserTrackType> = T extends "float"
  ? number
  : T extends "float2"
    ? Float2
    : T extends "float3"
      ? [number, number, number]
      : T extends "float4"
        ? Float4
        : Quat;

export type RawUserTrackKeyframe<T extends UserTrackType = UserTrackType> = {
  ratio: number;
  value: UserTrackValue<T>;
  interpolation: UserTrackInterpolation;
};

export type RawUserTrack<T extends UserTrackType = UserTrackType> = {
  type: T;
  name?: string;
  keyframes: readonly RawUserTrackKeyframe<T>[];
};

export type UserTrack<T extends UserTrackType = UserTrackType> = {
  type: T;
  name: string;
  ratios: Float32Array;
  values: Float32Array;
  steps: Uint8Array;
};

export type RawFloatTrack = RawUserTrack<"float">;
export type RawFloat2Track = RawUserTrack<"float2">;
export type RawFloat3Track = RawUserTrack<"float3">;
export type RawFloat4Track = RawUserTrack<"float4">;
export type RawQuaternionTrack = RawUserTrack<"quaternion">;

export type FloatTrack = UserTrack<"float">;
export type Float2Track = UserTrack<"float2">;
export type Float3Track = UserTrack<"float3">;
export type Float4Track = UserTrack<"float4">;
export type QuaternionTrack = UserTrack<"quaternion">;

export type UserTrackValidationIssue = {
  key?: number;
  field: string;
  message: string;
};

export type UserTrackBuildResult<T extends UserTrackType = UserTrackType> =
  | { ok: true; track: UserTrack<T>; issues: [] }
  | { ok: false; track: null; issues: UserTrackValidationIssue[] };

export type RawUserTrackStats<T extends UserTrackType = UserTrackType> = {
  type: T;
  name: string;
  keyCount: number;
  linearKeyCount: number;
  stepKeyCount: number;
  valueComponentCount: number;
};

export type UserTrackOptimizationOptions = {
  /** Maximum value-space error allowed while removing redundant linear keys. Defaults to 1e-3. */
  tolerance?: number;
};

export type UserTrackOptimizationResult<T extends UserTrackType = UserTrackType> = {
  track: RawUserTrack<T>;
  before: RawUserTrackStats<T>;
  after: RawUserTrackStats<T>;
  removedKeyCount: number;
};

export type TrackTriggerEdge = {
  ratio: number;
  rising: boolean;
};

export type TrackTriggeringJob = {
  track: FloatTrack;
  from: number;
  to: number;
  threshold: number;
  /** Bounds eager traversal for very large looping ranges. Defaults to DEFAULT_TRACK_TRIGGER_MAX_LOOPS. */
  maxLoopCount?: number;
  /** Bounds eager array output. Defaults to DEFAULT_TRACK_TRIGGER_MAX_EDGES. */
  maxEdgeCount?: number;
};

export const DEFAULT_TRACK_TRIGGER_MAX_LOOPS = 10000;
export const DEFAULT_TRACK_TRIGGER_MAX_EDGES = 10000;

const USER_TRACK_TYPES = new Set<UserTrackType>(["float", "float2", "float3", "float4", "quaternion"]);
const USER_TRACK_INTERPOLATIONS = new Set<UserTrackInterpolation>(["linear", "step"]);

export function trackValueSize(type: UserTrackType): number {
  switch (type) {
    case "float":
      return 1;
    case "float2":
      return 2;
    case "float3":
      return 3;
    case "float4":
    case "quaternion":
      return 4;
  }
}

export function defaultUserTrackValue<T extends UserTrackType>(type: T): UserTrackValue<T> {
  switch (type) {
    case "float":
      return 0 as UserTrackValue<T>;
    case "float2":
      return [0, 0] as UserTrackValue<T>;
    case "float3":
      return [0, 0, 0] as UserTrackValue<T>;
    case "float4":
      return [0, 0, 0, 0] as UserTrackValue<T>;
    case "quaternion":
      return [0, 0, 0, 1] as UserTrackValue<T>;
  }
}

export function validateRawUserTrack(raw: RawUserTrack): UserTrackValidationIssue[] {
  const issues: UserTrackValidationIssue[] = [];
  if (!USER_TRACK_TYPES.has(raw.type)) {
    issues.push({ field: "type", message: `unsupported user track type ${String(raw.type)}` });
    return issues;
  }

  let previousRatio = -1;
  raw.keyframes.forEach((key, index) => {
    if (!isFiniteNumber(key.ratio) || key.ratio < 0 || key.ratio > 1) {
      issues.push({ key: index, field: "ratio", message: "keyframe ratio must be finite and in [0,1]" });
    }
    if (key.ratio <= previousRatio) {
      issues.push({ key: index, field: "ratio", message: "keyframe ratios must be in strict ascending order" });
    }
    previousRatio = key.ratio;

    if (!USER_TRACK_INTERPOLATIONS.has(key.interpolation)) {
      issues.push({ key: index, field: "interpolation", message: "keyframe interpolation must be linear or step" });
    }
    validateValue(raw.type, key.value, index, issues);
  });
  return issues;
}

export function validateUserTrack(track: UserTrack): UserTrackValidationIssue[] {
  const issues: UserTrackValidationIssue[] = [];
  if (!USER_TRACK_TYPES.has(track.type)) {
    issues.push({ field: "type", message: `unsupported user track type ${String(track.type)}` });
    return issues;
  }
  if (!(track.ratios instanceof Float32Array)) issues.push({ field: "ratios", message: "track ratios must be a Float32Array" });
  if (!(track.values instanceof Float32Array)) issues.push({ field: "values", message: "track values must be a Float32Array" });
  if (!(track.steps instanceof Uint8Array)) issues.push({ field: "steps", message: "track steps must be a Uint8Array" });
  if (issues.length > 0) return issues;

  const stride = trackValueSize(track.type);
  if (track.values.length !== track.ratios.length * stride) {
    issues.push({ field: "values", message: `track values length must equal ratios length times ${stride}` });
  }
  if (track.steps.length !== track.ratios.length) {
    issues.push({ field: "steps", message: "track steps length must equal ratios length" });
  }

  let previousRatio = -1;
  for (let index = 0; index < track.ratios.length; index += 1) {
    const ratio = track.ratios[index]!;
    if (!isFiniteNumber(ratio) || ratio < 0 || ratio > 1) {
      issues.push({ key: index, field: "ratios", message: "runtime key ratio must be finite and in [0,1]" });
    }
    if (ratio <= previousRatio) {
      issues.push({ key: index, field: "ratios", message: "runtime key ratios must be in strict ascending order" });
    }
    previousRatio = ratio;

    if (track.steps[index] !== 0 && track.steps[index] !== 1) {
      issues.push({ key: index, field: "steps", message: "runtime step flag must be 0 or 1" });
    }
    validateFlatValue(track.type, track.values, index * stride, index, issues);
  }
  return issues;
}

export function tryBuildUserTrack<T extends UserTrackType>(raw: RawUserTrack<T>): UserTrackBuildResult<T> {
  const issues = validateRawUserTrack(raw as RawUserTrack);
  if (issues.length > 0) return { ok: false, track: null, issues };
  return { ok: true, track: buildValidatedUserTrack(raw), issues: [] };
}

export function buildUserTrack<T extends UserTrackType>(raw: RawUserTrack<T>): UserTrack<T> {
  const result = tryBuildUserTrack(raw);
  if (!result.ok) throw trackValidationError("raw user track", result.issues);
  return result.track;
}

export function getRawUserTrackStats<T extends UserTrackType>(raw: RawUserTrack<T>): RawUserTrackStats<T> {
  const issues = validateRawUserTrack(raw as RawUserTrack);
  if (issues.length > 0) throw trackValidationError("raw user track", issues);
  let linearKeyCount = 0;
  let stepKeyCount = 0;
  for (const key of raw.keyframes) {
    if (key.interpolation === "step") stepKeyCount += 1;
    else linearKeyCount += 1;
  }
  return {
    type: raw.type,
    name: raw.name ?? "",
    keyCount: raw.keyframes.length,
    linearKeyCount,
    stepKeyCount,
    valueComponentCount: raw.keyframes.length * trackValueSize(raw.type)
  };
}

export function optimizeRawUserTrack<T extends UserTrackType>(
  raw: RawUserTrack<T>,
  options: UserTrackOptimizationOptions = {}
): UserTrackOptimizationResult<T> {
  const before = getRawUserTrackStats(raw);
  const tolerance = readOptimizationTolerance(options.tolerance);
  const optimizedKeyframes = decimateRawUserTrackKeys(raw, raw.type === "quaternion" ? 1 - Math.cos(0.5 * tolerance) : tolerance);
  const track: RawUserTrack<T> = raw.name === undefined
    ? { type: raw.type, keyframes: optimizedKeyframes }
    : { type: raw.type, name: raw.name, keyframes: optimizedKeyframes };
  const after = getRawUserTrackStats(track);
  return { track, before, after, removedKeyCount: before.keyCount - after.keyCount };
}

export function sampleRawUserTrack<T extends UserTrackType>(raw: RawUserTrack<T>, ratio: number): UserTrackValue<T> {
  return sampleUserTrack(buildUserTrack(raw), ratio);
}

export function sampleUserTrack<T extends UserTrackType>(track: UserTrack<T>, ratio: number): UserTrackValue<T> {
  const issues = validateUserTrack(track as UserTrack);
  if (issues.length > 0) throw trackValidationError("user track", issues);

  const ratios = track.ratios;
  if (ratios.length === 0) return defaultUserTrackValue(track.type);
  if (ratios.length === 1) return readRuntimeValue(track, 0);

  const clamped = clamp01(ratio);
  if (clamped <= 0) return readRuntimeValue(track, 0);
  if (clamped >= 1) return readRuntimeValue(track, ratios.length - 1);

  const upper = upperBound(ratios, clamped);
  const lower = Math.max(0, upper - 1);
  if (upper >= ratios.length || track.steps[lower] === 1) return readRuntimeValue(track, lower);

  const leftRatio = ratios[lower]!;
  const rightRatio = ratios[upper]!;
  const alpha = (clamped - leftRatio) / (rightRatio - leftRatio);
  return interpolateRuntimeValues(track, lower, upper, alpha);
}

export function triggerFloatTrackEdges(job: TrackTriggeringJob): TrackTriggerEdge[] {
  if (job.track.type !== "float") throw new Error("track triggering only supports float user tracks");
  if (![job.from, job.to, job.threshold].every(isFiniteNumber)) throw new Error("track triggering from, to, and threshold must be finite");
  const maxLoopCount = finitePositiveInteger(job.maxLoopCount, DEFAULT_TRACK_TRIGGER_MAX_LOOPS, "maxLoopCount");
  const maxEdgeCount = finitePositiveInteger(job.maxEdgeCount, DEFAULT_TRACK_TRIGGER_MAX_EDGES, "maxEdgeCount");
  const issues = validateUserTrack(job.track);
  if (issues.length > 0) throw trackValidationError("float user track", issues);
  if (job.from === job.to || job.track.ratios.length === 0) return [];

  return job.to > job.from ? triggerForward(job, maxLoopCount, maxEdgeCount) : triggerBackward(job, maxLoopCount, maxEdgeCount);
}

function buildValidatedUserTrack<T extends UserTrackType>(raw: RawUserTrack<T>): UserTrack<T> {
  const keyframes = patchBeginEndKeys(raw);
  const stride = trackValueSize(raw.type);
  const ratios = new Float32Array(keyframes.length);
  const values = new Float32Array(keyframes.length * stride);
  const steps = new Uint8Array(keyframes.length);
  let previousQuat: Quat | undefined;

  keyframes.forEach((key, index) => {
    ratios[index] = key.ratio;
    steps[index] = key.interpolation === "step" ? 1 : 0;
    const flat = flattenTrackValue(raw.type, key.value);
    const fixed = raw.type === "quaternion" ? fixupQuaternion(flat, previousQuat) : flat;
    if (raw.type === "quaternion") previousQuat = [fixed[0]!, fixed[1]!, fixed[2]!, fixed[3]!];
    values.set(fixed, index * stride);
  });

  return { type: raw.type, name: raw.name ?? "", ratios, values, steps };
}

function readOptimizationTolerance(value: number | undefined): number {
  if (value === undefined) return 1e-3;
  if (!isFiniteNumber(value) || value < 0) throw new Error("track optimization tolerance must be finite and non-negative");
  return value;
}

function decimateRawUserTrackKeys<T extends UserTrackType>(raw: RawUserTrack<T>, tolerance: number): RawUserTrackKeyframe<T>[] {
  const keyframes: RawUserTrackKeyframe<T>[] = [];
  let previousQuat: Quat | undefined;
  for (const key of raw.keyframes) {
    const cloned = cloneOptimizableKey(raw.type, key, previousQuat);
    keyframes.push(cloned);
    if (raw.type === "quaternion") previousQuat = cloned.value as Quat;
  }
  if (keyframes.length >= 2) {
    const included = new Array<boolean>(keyframes.length).fill(false);
    const segments: [number, number][] = [[0, keyframes.length - 1]];
    included[0] = true;
    included[keyframes.length - 1] = true;

    while (segments.length > 0) {
      const segment = segments.pop()!;
      const [left, right] = segment;
      let maxDistance = -1;
      let candidate = left;
      for (let index = left + 1; index < right; index += 1) {
        const key = keyframes[index]!;
        if (!isDecimableKey(key)) {
          candidate = index;
          break;
        }
        const distance = valueDistance(raw.type, interpolateOptimizedValue(raw.type, keyframes[left]!, keyframes[right]!, key), key.value);
        if (distance > tolerance && distance > maxDistance) {
          maxDistance = distance;
          candidate = index;
        }
      }
      if (candidate !== left) {
        included[candidate] = true;
        if (candidate - left > 1) segments.push([left, candidate]);
        if (right - candidate > 1) segments.push([candidate, right]);
      }
    }

    keyframes.splice(0, keyframes.length, ...keyframes.filter((_, index) => included[index]));
  }

  while (keyframes.length > 0) {
    const back = keyframes[keyframes.length - 1]!;
    if (keyframes.length > 1 && !isDecimableKey(back)) break;
    const reference = keyframes.length === 1 ? defaultUserTrackValue(raw.type) : keyframes[keyframes.length - 2]!.value;
    if (valueDistance(raw.type, reference, back.value) > tolerance) break;
    keyframes.pop();
  }

  return keyframes;
}

function cloneOptimizableKey<T extends UserTrackType>(type: T, key: RawUserTrackKeyframe<T>, previousQuat: Quat | undefined): RawUserTrackKeyframe<T> {
  const flat = flattenTrackValue(type, key.value);
  const value = type === "quaternion" ? fixupQuaternion(flat, previousQuat) : flat;
  return {
    ratio: key.ratio,
    value: (type === "float" ? value[0]! : value) as UserTrackValue<T>,
    interpolation: key.interpolation
  };
}

function isDecimableKey(key: RawUserTrackKeyframe): boolean {
  return key.interpolation !== "step";
}

function interpolateOptimizedValue<T extends UserTrackType>(
  type: T,
  left: RawUserTrackKeyframe<T>,
  right: RawUserTrackKeyframe<T>,
  reference: RawUserTrackKeyframe<T>
): UserTrackValue<T> {
  const alpha = (reference.ratio - left.ratio) / (right.ratio - left.ratio);
  if (type === "quaternion") return nlerpQuat(left.value as Quat, right.value as Quat, alpha) as UserTrackValue<T>;
  if (type === "float") {
    const a = left.value as number;
    const b = right.value as number;
    return (a + (b - a) * clamp01(alpha)) as UserTrackValue<T>;
  }
  const amount = clamp01(alpha);
  const stride = trackValueSize(type);
  const a = left.value as ArrayLike<number>;
  const b = right.value as ArrayLike<number>;
  const result: number[] = [];
  for (let component = 0; component < stride; component += 1) result.push(a[component]! + (b[component]! - a[component]!) * amount);
  return result as UserTrackValue<T>;
}

function valueDistance<T extends UserTrackType>(type: T, a: UserTrackValue<T>, b: UserTrackValue<T>): number {
  if (type === "quaternion") return 1 - Math.min(1, Math.abs(dotQuat(normalizeQuat(a as Quat), normalizeQuat(b as Quat))));
  if (type === "float") return Math.abs((a as number) - (b as number));
  const stride = trackValueSize(type);
  const left = a as ArrayLike<number>;
  const right = b as ArrayLike<number>;
  let squared = 0;
  for (let component = 0; component < stride; component += 1) {
    const delta = left[component]! - right[component]!;
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

function nlerpQuat(left: Quat, right: Quat, alpha: number): Quat {
  const end = ensureShortestQuat(left, right);
  const amount = clamp01(alpha);
  return normalizeQuat([
    left[0] + (end[0] - left[0]) * amount,
    left[1] + (end[1] - left[1]) * amount,
    left[2] + (end[2] - left[2]) * amount,
    left[3] + (end[3] - left[3]) * amount
  ]);
}

function patchBeginEndKeys<T extends UserTrackType>(raw: RawUserTrack<T>): RawUserTrackKeyframe<T>[] {
  if (raw.keyframes.length === 0) return [];
  if (raw.keyframes.length === 1) {
    const key = raw.keyframes[0]!;
    return [{ ratio: 0, value: key.value, interpolation: "linear" }];
  }

  const keyframes: RawUserTrackKeyframe<T>[] = [];
  const first = raw.keyframes[0]!;
  const last = raw.keyframes[raw.keyframes.length - 1]!;
  if (first.ratio !== 0) keyframes.push({ ratio: 0, value: first.value, interpolation: "linear" });
  keyframes.push(...raw.keyframes);
  if (last.ratio !== 1) keyframes.push({ ratio: 1, value: last.value, interpolation: "linear" });
  return keyframes;
}

function triggerForward(job: TrackTriggeringJob, maxLoopCount: number, maxEdgeCount: number): TrackTriggerEdge[] {
  const edges: TrackTriggerEdge[] = [];
  const ratios = job.track.ratios;
  const keyCount = ratios.length;
  let inner = 0;
  let loopCount = 0;
  for (let outer = Math.floor(job.from); outer < job.to; outer += 1) {
    guardLoopCount(++loopCount, maxLoopCount);
    while (inner < keyCount) {
      const current = inner;
      const edge = detectFloatEdge(job.track, current === 0 ? keyCount - 1 : current - 1, current, true, job.threshold);
      if (edge) {
        edge.ratio += outer;
        if (edge.ratio >= job.from && (edge.ratio < job.to || job.to >= 1 + outer)) {
          pushTriggeredEdge(edges, edge, maxEdgeCount);
          inner = current + 1;
          continue;
        }
        if (ratios[current]! + outer >= job.to) break;
      }
      inner = current + 1;
    }
    inner = 0;
  }
  return edges;
}

function triggerBackward(job: TrackTriggeringJob, maxLoopCount: number, maxEdgeCount: number): TrackTriggerEdge[] {
  const edges: TrackTriggerEdge[] = [];
  const ratios = job.track.ratios;
  const keyCount = ratios.length;
  let inner = keyCount - 1;
  let loopCount = 0;
  for (let outer = Math.floor(job.from); outer + 1 > job.to; outer -= 1) {
    guardLoopCount(++loopCount, maxLoopCount);
    while (inner >= 0) {
      const current = inner;
      const edge = detectFloatEdge(job.track, current === 0 ? keyCount - 1 : current - 1, current, false, job.threshold);
      if (edge) {
        edge.ratio += outer;
        if (edge.ratio >= job.to && (edge.ratio < job.from || job.from >= 1 + outer)) {
          pushTriggeredEdge(edges, edge, maxEdgeCount);
          inner = current - 1;
          continue;
        }
      }
      if (ratios[current]! + outer <= job.to) break;
      inner = current - 1;
    }
    inner = keyCount - 1;
  }
  return edges;
}

function detectFloatEdge(track: FloatTrack, left: number, right: number, forward: boolean, threshold: number): TrackTriggerEdge | null {
  const leftValue = track.values[left]!;
  const rightValue = track.values[right]!;
  let rising: boolean;
  if (leftValue <= threshold && rightValue > threshold) {
    rising = forward;
  } else if (leftValue > threshold && rightValue <= threshold) {
    rising = !forward;
  } else {
    return null;
  }

  const ratio = track.steps[left] === 1 ? track.ratios[right]! : right === 0 ? 0 : unlerpRatio(track.ratios[left]!, track.ratios[right]!, leftValue, rightValue, threshold);
  return { ratio, rising };
}

function unlerpRatio(leftRatio: number, rightRatio: number, leftValue: number, rightValue: number, threshold: number): number {
  const alpha = (threshold - leftValue) / (rightValue - leftValue);
  return leftRatio + (rightRatio - leftRatio) * alpha;
}

function pushTriggeredEdge(edges: TrackTriggerEdge[], edge: TrackTriggerEdge, maxEdgeCount: number): void {
  if (edges.length >= maxEdgeCount) {
    throw new RangeError(`track triggering exceeded maxEdgeCount ${maxEdgeCount}`);
  }
  edges.push(edge);
}

function guardLoopCount(loopCount: number, maxLoopCount: number): void {
  if (loopCount > maxLoopCount) {
    throw new RangeError(`track triggering exceeded maxLoopCount ${maxLoopCount}`);
  }
}

function finitePositiveInteger(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

function upperBound(values: Float32Array, ratio: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid]! <= ratio) low = mid + 1;
    else high = mid;
  }
  return low;
}

function interpolateRuntimeValues<T extends UserTrackType>(track: UserTrack<T>, left: number, right: number, alpha: number): UserTrackValue<T> {
  if (track.type === "quaternion") {
    return slerpQuat(readRuntimeValue(track, left) as Quat, readRuntimeValue(track, right) as Quat, alpha) as UserTrackValue<T>;
  }

  const stride = trackValueSize(track.type);
  if (stride === 1) {
    const a = track.values[left]!;
    const b = track.values[right]!;
    return (a + (b - a) * clamp01(alpha)) as UserTrackValue<T>;
  }

  const amount = clamp01(alpha);
  const result: number[] = [];
  const leftOffset = left * stride;
  const rightOffset = right * stride;
  for (let component = 0; component < stride; component += 1) {
    const a = track.values[leftOffset + component]!;
    const b = track.values[rightOffset + component]!;
    result.push(a + (b - a) * amount);
  }
  return result as UserTrackValue<T>;
}

function readRuntimeValue<T extends UserTrackType>(track: UserTrack<T>, index: number): UserTrackValue<T> {
  const stride = trackValueSize(track.type);
  const offset = index * stride;
  if (stride === 1) return track.values[offset]! as UserTrackValue<T>;
  const value: number[] = [];
  for (let component = 0; component < stride; component += 1) value.push(track.values[offset + component]!);
  if (track.type === "quaternion") return normalizeQuat([value[0]!, value[1]!, value[2]!, value[3]!]) as UserTrackValue<T>;
  return value as UserTrackValue<T>;
}

function fixupQuaternion(value: readonly number[], previous: Quat | undefined): number[] {
  let normalized = normalizeQuat([value[0]!, value[1]!, value[2]!, value[3]!]);
  if (previous) normalized = ensureShortestQuat(previous, normalized);
  else if (normalized[3] < 0) normalized = [-normalized[0], -normalized[1], -normalized[2], -normalized[3]];
  return normalized;
}

function flattenTrackValue(type: UserTrackType, value: UserTrackValue<UserTrackType>): number[] {
  if (type === "float") return [value as number];
  return Array.from(value as ArrayLike<number>);
}

function validateValue(type: UserTrackType, value: unknown, key: number, issues: UserTrackValidationIssue[]): void {
  const stride = trackValueSize(type);
  if (type === "float") {
    if (!isFiniteNumber(value as number)) issues.push({ key, field: "value", message: "float keyframe value must be finite" });
    return;
  }

  if (!isArrayLikeNumberValue(value, stride)) {
    issues.push({ key, field: "value", message: `${type} keyframe value must contain exactly ${stride} components` });
    return;
  }
  for (let component = 0; component < stride; component += 1) {
    if (!isFiniteNumber(value[component]!)) issues.push({ key, field: "value", message: `${type} keyframe components must be finite` });
  }
  if (type === "quaternion" && Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!) <= EPSILON) {
    issues.push({ key, field: "value", message: "quaternion keyframe value must be normalizable" });
  }
}

function validateFlatValue(type: UserTrackType, values: Float32Array, offset: number, key: number, issues: UserTrackValidationIssue[]): void {
  const stride = trackValueSize(type);
  for (let component = 0; component < stride; component += 1) {
    if (!isFiniteNumber(values[offset + component]!)) issues.push({ key, field: "values", message: "runtime track values must be finite" });
  }
  if (type === "quaternion" && Math.hypot(values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!) <= EPSILON) {
    issues.push({ key, field: "values", message: "runtime quaternion values must be normalizable" });
  }
}

function isArrayLikeNumberValue(value: unknown, length: number): value is ArrayLike<number> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { length?: unknown };
  return typeof candidate.length === "number" && candidate.length === length;
}

function trackValidationError(label: string, issues: readonly UserTrackValidationIssue[]): Error {
  return new Error(`${label} is invalid: ${issues.map(formatIssue).join("; ")}`);
}

function formatIssue(issue: UserTrackValidationIssue): string {
  return issue.key === undefined ? `${issue.field} ${issue.message}` : `key ${issue.key} ${issue.field} ${issue.message}`;
}
