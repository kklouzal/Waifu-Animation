import { type Mat4, type Vec3, transformPoint } from "./math.js";
import {
  cloneFiniteMat4,
  cloneFiniteVec3,
  isFiniteMat4,
  sanitizeNonNegativeIntegerWithFlooredFallbackOrZero,
  sanitizePositiveIntegerWithFlooredFallback
} from "./numeric-helpers.js";
import { NO_PARENT, type JointReference, type Skeleton, type SkeletonJoint, resolveJointIndex } from "./skeleton.js";

export type BakedCameraJointPredicate = (joint: SkeletonJoint, index: number, skeleton: Skeleton) => boolean;

export type BakedCameraJointOptions = {
  /** Explicit joint reference to use before matching by predicate or name text. */
  joint?: JointReference;
  /** Predicate used to find the first matching camera joint. */
  predicate?: BakedCameraJointPredicate;
  /** Name text to search for when no explicit joint or predicate matches. Defaults to "camera". */
  includes?: string;
  /** Defaults to false so common DCC names like "Camera" still resolve. */
  caseSensitive?: boolean;
  /** Matrix used when callers opt into finite fallback behavior. */
  fallbackMatrix?: MatrixLike;
};

export type BakedCameraJointOverride = {
  jointIndex: number;
  jointName: string;
  matrix: Mat4;
};

export type MatrixLike = ArrayLike<number>;

export type RigidInstanceMatrixOptions = {
  /** Source joint indices to copy, in output order. Defaults to one instance per source matrix. */
  jointIndices?: readonly number[];
  /** Optional maximum number of instances to write. */
  count?: number;
  /** Matrix used when a selected source matrix is missing or not finite. Defaults to identity. */
  fallbackMatrix?: MatrixLike;
};

export type RigidInstanceMatrixBuffer = Float32Array | number[];

export type RigidInstanceMatrixBufferOptions = RigidInstanceMatrixOptions & {
  offset?: number;
  stride?: number;
};

export type RigidInstanceBoundsOptions = RigidInstanceMatrixOptions & {
  /** Local-space minimum corner for every rigid object. Defaults to a unit cube centered on the joint. */
  localMin?: Vec3;
  /** Local-space maximum corner for every rigid object. Defaults to a unit cube centered on the joint. */
  localMax?: Vec3;
};

export type RigidInstanceBounds = {
  min: Vec3;
  max: Vec3;
  empty: boolean;
  instanceCount: number;
};

const UNIT_CUBE_MIN: Vec3 = [-0.5, -0.5, -0.5];
const UNIT_CUBE_MAX: Vec3 = [0.5, 0.5, 0.5];

export function resolveBakedCameraJointIndex(skeleton: Skeleton, options: BakedCameraJointOptions = {}): number {
  if (options.joint !== undefined) return resolveOptionalJointIndex(skeleton, options.joint);

  if (options.predicate) {
    for (let index = 0; index < skeleton.joints.length; index += 1) {
      if (options.predicate(skeleton.joints[index]!, index, skeleton)) return index;
    }
  }

  const needle = options.includes ?? "camera";
  if (needle.length === 0) return -1;
  const caseSensitive = options.caseSensitive ?? false;
  const search = caseSensitive ? needle : needle.toLocaleLowerCase();
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const name = skeleton.joints[index]!.name;
    const haystack = caseSensitive ? name : name.toLocaleLowerCase();
    if (haystack.includes(search)) return index;
  }
  return -1;
}

export function getBakedCameraJointOverride(
  skeleton: Skeleton,
  modelMatrices: readonly MatrixLike[],
  options: BakedCameraJointOptions = {}
): BakedCameraJointOverride | undefined {
  const jointIndex = resolveBakedCameraJointIndex(skeleton, options);
  if (jointIndex < 0 || jointIndex >= skeleton.joints.length) return undefined;
  const source = modelMatrices[jointIndex];
  if (!isFiniteMat4(source, { requireIntegerLength: true }) && options.fallbackMatrix === undefined) return undefined;
  return {
    jointIndex,
    jointName: skeleton.joints[jointIndex]!.name,
    matrix: cloneFiniteMat4(source, { fallback: options.fallbackMatrix, requireIntegerLength: true })
  };
}

export function buildRigidInstanceMatrices(
  modelMatrices: readonly MatrixLike[],
  options: RigidInstanceMatrixOptions = {}
): Mat4[] {
  return updateRigidInstanceMatrices(modelMatrices, [], options);
}

export function updateRigidInstanceMatrices(
  modelMatrices: readonly MatrixLike[],
  out: Mat4[] = [],
  options: RigidInstanceMatrixOptions = {}
): Mat4[] {
  const count = resolveRigidInstanceCount(modelMatrices, options);
  out.length = count;
  for (let index = 0; index < count; index += 1) {
    out[index] = resolveRigidInstanceMatrix(modelMatrices, options, index);
  }
  return out;
}

export function updateRigidInstanceMatrixBuffer(
  modelMatrices: readonly MatrixLike[],
  out: RigidInstanceMatrixBuffer,
  options: RigidInstanceMatrixBufferOptions = {}
): RigidInstanceMatrixBuffer {
  const offset = sanitizeNonNegativeIntegerWithFlooredFallbackOrZero(options.offset, 0);
  const stride = sanitizePositiveIntegerWithFlooredFallback(options.stride, 16);
  const count = resolveRigidInstanceCount(modelMatrices, options);
  const requiredLength = count > 0 ? offset + (count - 1) * stride + 16 : 0;
  if (out instanceof Float32Array && out.length < requiredLength) {
    throw new Error(`rigid instance matrix buffer requires ${requiredLength} components, received ${out.length}`);
  }
  if (Array.isArray(out) && out.length < requiredLength) out.length = requiredLength;

  for (let index = 0; index < count; index += 1) {
    const matrix = resolveRigidInstanceMatrix(modelMatrices, options, index);
    const base = offset + index * stride;
    for (let component = 0; component < 16; component += 1) {
      out[base + component] = matrix[component]!;
    }
  }
  return out;
}

export function computeRigidInstanceBounds(
  modelMatrices: readonly MatrixLike[],
  options: RigidInstanceBoundsOptions = {}
): RigidInstanceBounds {
  const count = resolveRigidInstanceCount(modelMatrices, options);
  if (count === 0) return { min: [0, 0, 0], max: [0, 0, 0], empty: true, instanceCount: 0 };

  const { min: localMin, max: localMax } = resolveLocalBounds(options.localMin, options.localMax);
  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let wrotePoint = false;

  for (let index = 0; index < count; index += 1) {
    const matrix = resolveRigidInstanceMatrix(modelMatrices, options, index);
    for (let corner = 0; corner < 8; corner += 1) {
      const point = transformPoint(matrix, [
        (corner & 1) === 0 ? localMin[0] : localMax[0],
        (corner & 2) === 0 ? localMin[1] : localMax[1],
        (corner & 4) === 0 ? localMin[2] : localMax[2]
      ]);
      if (!point.every(Number.isFinite)) continue;
      min[0] = Math.min(min[0], point[0]);
      min[1] = Math.min(min[1], point[1]);
      min[2] = Math.min(min[2], point[2]);
      max[0] = Math.max(max[0], point[0]);
      max[1] = Math.max(max[1], point[1]);
      max[2] = Math.max(max[2], point[2]);
      wrotePoint = true;
    }
  }

  return wrotePoint
    ? { min, max, empty: false, instanceCount: count }
    : { min: [0, 0, 0], max: [0, 0, 0], empty: true, instanceCount: count };
}

function resolveOptionalJointIndex(skeleton: Skeleton, joint: JointReference): number {
  if (typeof joint === "string") return resolveJointIndex(skeleton, joint);
  if (!Number.isInteger(joint) || joint < NO_PARENT || joint >= skeleton.joints.length) return -1;
  return joint;
}

function resolveRigidInstanceMatrix(
  modelMatrices: readonly MatrixLike[],
  options: Pick<RigidInstanceMatrixOptions, "fallbackMatrix" | "jointIndices">,
  outputIndex: number
): Mat4 {
  const sourceIndex = options.jointIndices?.[outputIndex] ?? outputIndex;
  const source = Number.isInteger(sourceIndex) && sourceIndex >= 0 ? modelMatrices[sourceIndex] : undefined;
  return cloneFiniteMat4(source, { fallback: options.fallbackMatrix, requireIntegerLength: true });
}

function resolveRigidInstanceCount(modelMatrices: readonly MatrixLike[], options: Pick<RigidInstanceMatrixOptions, "count" | "jointIndices">): number {
  const fallback = options.jointIndices ? options.jointIndices.length : modelMatrices.length;
  const count = sanitizeNonNegativeIntegerWithFlooredFallbackOrZero(options.count, fallback);
  return Math.min(count, fallback);
}

function resolveLocalBounds(min: Vec3 | undefined, max: Vec3 | undefined): { min: Vec3; max: Vec3 } {
  const resolvedMin = cloneFiniteVec3(min, UNIT_CUBE_MIN);
  const resolvedMax = cloneFiniteVec3(max, UNIT_CUBE_MAX);
  return {
    min: [
      Math.min(resolvedMin[0], resolvedMax[0]),
      Math.min(resolvedMin[1], resolvedMax[1]),
      Math.min(resolvedMin[2], resolvedMax[2])
    ],
    max: [
      Math.max(resolvedMin[0], resolvedMax[0]),
      Math.max(resolvedMin[1], resolvedMax[1]),
      Math.max(resolvedMin[2], resolvedMax[2])
    ]
  };
}
