import type { Mat4, Vec3 } from "./math.js";

export type NumericArray = ArrayLike<number>;

type FiniteMat4Options = {
  requireIntegerLength?: boolean;
};

type CloneFiniteMat4Options = FiniteMat4Options & {
  fallback?: NumericArray | undefined;
};

const IDENTITY_MAT4_VALUES = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

export function cloneFiniteMat4(matrix: NumericArray | undefined, options: CloneFiniteMat4Options = {}): Mat4 {
  if (isFiniteMat4(matrix, options)) return cloneMat4(matrix);
  if (isFiniteMat4(options.fallback, options)) return cloneMat4(options.fallback);
  return new Float32Array(IDENTITY_MAT4_VALUES);
}

export function isFiniteMat4(
  matrix: NumericArray | undefined,
  options: FiniteMat4Options = {}
): matrix is NumericArray {
  if (!matrix || matrix.length < 16) return false;
  if (options.requireIntegerLength === true && !Number.isInteger(matrix.length)) return false;
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(matrix[index])) return false;
  }
  return true;
}

export function cloneFiniteVec3(value: NumericArray | undefined, fallback: Vec3): Vec3 {
  const x = value?.[0];
  const y = value?.[1];
  const z = value?.[2];
  return [
    Number.isFinite(x) ? x! : fallback[0],
    Number.isFinite(y) ? y! : fallback[1],
    Number.isFinite(z) ? z! : fallback[2]
  ];
}

export function mat4Translation(matrix: NumericArray): Vec3 {
  return [finiteMat4Value(matrix, 12, 0), finiteMat4Value(matrix, 13, 0), finiteMat4Value(matrix, 14, 0)];
}

export function finiteMat4Value(matrix: NumericArray, index: number, fallback: number): number {
  const value = matrix[index];
  return Number.isFinite(value) ? value! : fallback;
}

export function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

export function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

export function sanitizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 ? value! : fallback;
}

export function sanitizePositiveIntegerWithFlooredFallback(value: number | undefined, fallback: number): number {
  const resolvedFallback = Math.max(1, Math.floor(fallback));
  return Number.isInteger(value) && value! > 0 ? value! : resolvedFallback;
}

export function sanitizeNonNegativeIntegerWithFlooredFallbackOrZero(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) return Math.max(0, Math.floor(fallback));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function cloneMat4(matrix: NumericArray): Mat4 {
  return new Float32Array(Array.from({ length: 16 }, (_, index) => matrix[index]!));
}
