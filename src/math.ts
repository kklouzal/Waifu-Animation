export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float32Array;

export type Transform = {
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
};

export type RandomSource = () => number;

export const EPSILON = 1e-8;
export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];
export const ZERO_VEC3: Vec3 = [0, 0, 0];
export const ONE_VEC3: Vec3 = [1, 1, 1];

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function numericArraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function euclideanModulo(value: number, divisor: number): number {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

export function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function finiteSigned(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function smoothPulse(progress: number): number {
  if (progress < 0 || progress > 1) return 0;
  return Math.sin(progress * Math.PI);
}

export function smoothStep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function dampAlpha(speed: number, deltaSeconds: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(deltaSeconds) || speed <= 0 || deltaSeconds <= 0) return 0;
  return 1 - Math.exp(-speed * deltaSeconds);
}

export function dampValue(current: number, target: number, speed: number, deltaSeconds: number): number {
  return current + (target - current) * dampAlpha(speed, deltaSeconds);
}

export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string | number): RandomSource {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function cloneVec3(value: ArrayLike<number> | undefined, fallback: Vec3 = ZERO_VEC3): Vec3 {
  return [value?.[0] ?? fallback[0], value?.[1] ?? fallback[1], value?.[2] ?? fallback[2]];
}

function cloneFiniteVec3(value: ArrayLike<number> | undefined, fallback: Vec3): Vec3 {
  const x = value?.[0] ?? fallback[0];
  const y = value?.[1] ?? fallback[1];
  const z = value?.[2] ?? fallback[2];
  return [isFiniteNumber(x) ? x : fallback[0], isFiniteNumber(y) ? y : fallback[1], isFiniteNumber(z) ? z : fallback[2]];
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function lengthVec3(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function cloneFiniteNormalFallbackVec3(fallback: Vec3): Vec3 {
  if (!fallback.every(isFiniteNumber)) return [0, 0, 1];
  const length = lengthVec3(fallback);
  return Number.isFinite(length) && length > EPSILON ? [fallback[0] / length, fallback[1] / length, fallback[2] / length] : [0, 0, 1];
}

export function normalizeVec3(value: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  if (!value.every(isFiniteNumber)) return cloneFiniteNormalFallbackVec3(fallback);
  const length = lengthVec3(value);
  return Number.isFinite(length) && length > EPSILON ? [value[0] / length, value[1] / length, value[2] / length] : cloneFiniteNormalFallbackVec3(fallback);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const amount = clamp01(t);
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

export function dotQuat(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function cloneQuat(value: ArrayLike<number> | undefined, fallback: Quat = IDENTITY_QUAT): Quat {
  return [value?.[0] ?? fallback[0], value?.[1] ?? fallback[1], value?.[2] ?? fallback[2], value?.[3] ?? fallback[3]];
}

export function cloneNormalizedQuat(value: ArrayLike<number> | undefined, fallback: Quat = IDENTITY_QUAT): Quat {
  return normalizeQuat(cloneQuat(value, fallback));
}

function normalizeFiniteFallbackQuat(fallback: Quat): Quat {
  if (!fallback.every(isFiniteNumber)) return cloneQuat(IDENTITY_QUAT);
  const length = Math.hypot(fallback[0], fallback[1], fallback[2], fallback[3]);
  if (!Number.isFinite(length) || length <= EPSILON) return cloneQuat(IDENTITY_QUAT);
  return [fallback[0] / length, fallback[1] / length, fallback[2] / length, fallback[3] / length];
}

export function normalizeQuat(value: Quat, fallback: Quat = IDENTITY_QUAT): Quat {
  if (!value.every(isFiniteNumber)) return normalizeFiniteFallbackQuat(fallback);
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(length) || length <= EPSILON) return normalizeFiniteFallbackQuat(fallback);
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

export function negateQuat(value: Quat): Quat {
  return [-value[0], -value[1], -value[2], -value[3]];
}

export function conjugateQuat(value: Quat): Quat {
  return [-value[0], -value[1], -value[2], value[3]];
}

export function multiplyQuat(a: Quat, b: Quat): Quat {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]);
}

export function invertQuat(value: Quat): Quat {
  const dot = dotQuat(value, value);
  if (!Number.isFinite(dot) || dot <= EPSILON) return cloneQuat(IDENTITY_QUAT);
  const c = conjugateQuat(value);
  return [c[0] / dot, c[1] / dot, c[2] / dot, c[3] / dot];
}

export function ensureShortestQuat(previous: Quat, next: Quat): Quat {
  return dotQuat(previous, next) < 0 ? negateQuat(next) : cloneQuat(next);
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  const amount = clamp01(t);
  let end = cloneQuat(b);
  let cos = dotQuat(a, end);
  if (cos < 0) {
    end = negateQuat(end);
    cos = -cos;
  }
  if (cos > 0.9995) {
    return normalizeQuat([
      a[0] + (end[0] - a[0]) * amount,
      a[1] + (end[1] - a[1]) * amount,
      a[2] + (end[2] - a[2]) * amount,
      a[3] + (end[3] - a[3]) * amount
    ]);
  }
  const theta0 = Math.acos(clamp(cos, -1, 1));
  const theta = theta0 * amount;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - cos * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return normalizeQuat([a[0] * s0 + end[0] * s1, a[1] * s0 + end[1] * s1, a[2] * s0 + end[2] * s1, a[3] * s0 + end[3] * s1]);
}

export function quatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const normalized = normalizeVec3(axis);
  const half = radians * 0.5;
  const s = Math.sin(half);
  return normalizeQuat([normalized[0] * s, normalized[1] * s, normalized[2] * s, Math.cos(half)]);
}

export function quatFromUnitVectors(from: Vec3, to: Vec3, fallbackAxis: Vec3 = [0, 1, 0]): Quat {
  const start = normalizeVec3(from, [0, 0, 1]);
  const end = normalizeVec3(to, [0, 0, 1]);
  const dot = clamp(dotVec3(start, end), -1, 1);
  if (dot < -0.999999) {
    const axis = normalizeVec3(crossVec3(fallbackAxis, start), normalizeVec3(crossVec3([1, 0, 0], start), [0, 0, 1]));
    return quatFromAxisAngle(axis, Math.PI);
  }
  const cross = crossVec3(start, end);
  return normalizeQuat([cross[0], cross[1], cross[2], 1 + dot]);
}

export function rotateVec3ByQuat(rotation: Quat, value: Vec3): Vec3 {
  const q = normalizeQuat(rotation);
  const u: Vec3 = [q[0], q[1], q[2]];
  const uv = crossVec3(u, value);
  const uuv = crossVec3(u, uv);
  return addVec3(value, addVec3(scaleVec3(uv, 2 * q[3]), scaleVec3(uuv, 2)));
}

export function identityTransform(): Transform {
  return cloneTransform(undefined);
}

export function cloneTransform(value: Partial<Transform> | undefined): Transform {
  return {
    translation: cloneFiniteVec3(value?.translation, ZERO_VEC3),
    rotation: normalizeQuat(cloneQuat(value?.rotation, IDENTITY_QUAT)),
    scale: cloneFiniteVec3(value?.scale, ONE_VEC3)
  };
}

export function cloneTransformList(transforms: readonly Transform[]): Transform[] {
  return transforms.map((transform) => cloneTransform(transform));
}

export function normalizeTransform(value: Transform): Transform {
  return {
    translation: cloneFiniteVec3(value.translation, ZERO_VEC3),
    rotation: normalizeQuat(value.rotation),
    scale: cloneFiniteVec3(value.scale, ONE_VEC3)
  };
}

export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  return {
    translation: lerpVec3(a.translation, b.translation, t),
    rotation: slerpQuat(a.rotation, b.rotation, t),
    scale: lerpVec3(a.scale, b.scale, t)
  };
}

export function scaleRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator)) return numerator / EPSILON;
  if (Math.abs(denominator) > EPSILON) return numerator / denominator;
  return numerator / (denominator < 0 || Object.is(denominator, -0) ? -EPSILON : EPSILON);
}

export function transformDelta(rest: Transform, sample: Transform): Transform {
  return {
    translation: subVec3(sample.translation, rest.translation),
    rotation: multiplyQuat(invertQuat(rest.rotation), sample.rotation),
    scale: [
      scaleRatio(sample.scale[0], rest.scale[0]),
      scaleRatio(sample.scale[1], rest.scale[1]),
      scaleRatio(sample.scale[2], rest.scale[2])
    ]
  };
}

export function applyTransformDelta(base: Transform, delta: Transform, weight: number): Transform {
  const amount = Number.isFinite(weight) ? weight : 0;
  if (Math.abs(amount) <= EPSILON) return cloneTransform(base);

  // Ozz additive blending treats positive weights as adding a delta and
  // negative weights as subtracting it. Rotation is interpolated from identity
  // toward the delta with quaternion sign fixed for the shortest path, then the
  // resulting delta is post-multiplied onto the base local rotation.
  const signedDeltaRotation = delta.rotation[3] < 0 ? negateQuat(delta.rotation) : cloneQuat(delta.rotation);
  const absAmount = Math.abs(amount);
  const weightedRotation = normalizeQuat([
    signedDeltaRotation[0] * absAmount,
    signedDeltaRotation[1] * absAmount,
    signedDeltaRotation[2] * absAmount,
    1 + (signedDeltaRotation[3] - 1) * absAmount
  ]);
  const appliedRotation = amount >= 0 ? weightedRotation : conjugateQuat(weightedRotation);

  const scaleChannel = (baseValue: number, deltaValue: number): number => {
    const factor = 1 + (deltaValue - 1) * absAmount;
    if (amount >= 0) return baseValue * factor;
    return scaleRatio(baseValue, factor);
  };

  return {
    translation: addVec3(base.translation, scaleVec3(delta.translation, amount)),
    rotation: multiplyQuat(base.rotation, appliedRotation),
    scale: [
      scaleChannel(base.scale[0], delta.scale[0]),
      scaleChannel(base.scale[1], delta.scale[1]),
      scaleChannel(base.scale[2], delta.scale[2])
    ]
  };
}

export function composeMat4(transform: Transform): Mat4 {
  const [x, y, z, w] = normalizeQuat(transform.rotation);
  const [sx, sy, sz] = transform.scale;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const out = new Float32Array(16);
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = transform.translation[0];
  out[13] = transform.translation[1];
  out[14] = transform.translation[2];
  out[15] = 1;
  return out;
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      const a0 = a[0 * 4 + row] ?? 0;
      const a1 = a[1 * 4 + row] ?? 0;
      const a2 = a[2 * 4 + row] ?? 0;
      const a3 = a[3 * 4 + row] ?? 0;
      out[col * 4 + row] =
        a0 * (b[col * 4 + 0] ?? 0) +
        a1 * (b[col * 4 + 1] ?? 0) +
        a2 * (b[col * 4 + 2] ?? 0) +
        a3 * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const x = point[0], y = point[1], z = point[2];
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0)
  ];
}

export function isFiniteTransform(transform: Transform): boolean {
  return (
    transform.translation.every(isFiniteNumber) &&
    transform.rotation.every(isFiniteNumber) &&
    transform.scale.every(isFiniteNumber) &&
    Math.hypot(...transform.rotation) > EPSILON
  );
}
