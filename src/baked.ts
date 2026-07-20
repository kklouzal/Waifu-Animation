import { type Mat4, type Vec3, transformPoint } from "./math.js";
import { cloneFiniteMat4, cloneFiniteVec3, isFiniteMat4 } from "./numeric-helpers.js";
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
const MAX_RIGID_INSTANCE_COUNT = 1_048_576;
const MAX_RIGID_BUFFER_COMPONENTS = MAX_RIGID_INSTANCE_COUNT * 16;

export function resolveBakedCameraJointIndex(skeleton: Skeleton, options: BakedCameraJointOptions = {}): number {
  if (options.joint !== undefined) {
    const explicit = resolveOptionalJointIndex(skeleton, options.joint);
    if (explicit >= 0) return explicit;
  }

  if (options.predicate) {
    for (let index = 0; index < skeleton.joints.length; index += 1) {
      if (options.predicate(skeleton.joints[index]!, index, skeleton)) return index;
    }
  }

  const needle = options.includes ?? "camera";
  if (needle.length === 0) return -1;
  const caseSensitive = options.caseSensitive ?? false;
  const search = caseSensitive ? needle : needle.toLowerCase();
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const name = skeleton.joints[index]!.name;
    const haystack = caseSensitive ? name : name.toLowerCase();
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
  if (!isExactFiniteMat4(source) && !isExactFiniteMat4(options.fallbackMatrix)) return undefined;
  return {
    jointIndex,
    jointName: skeleton.joints[jointIndex]!.name,
    matrix: cloneExactFiniteMat4(source, options.fallbackMatrix)
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
  const matrices = resolveRigidInstanceMatrices(modelMatrices, options, count);
  out.length = count;
  for (let index = 0; index < count; index += 1) {
    out[index] = matrices[index]!;
  }
  return out;
}

export function updateRigidInstanceMatrixBuffer(
  modelMatrices: readonly MatrixLike[],
  out: RigidInstanceMatrixBuffer,
  options: RigidInstanceMatrixBufferOptions = {}
): RigidInstanceMatrixBuffer {
  const offset = sanitizeNonNegativeInteger(options.offset, 0);
  const stride = Math.max(16, sanitizePositiveInteger(options.stride, 16));
  const count = resolveRigidInstanceCount(modelMatrices, options);
  const requiredLength = computeRigidBufferRequiredLength(count, offset, stride);
  if (requiredLength === undefined)
    throw new RangeError("rigid instance matrix buffer range exceeds safe array bounds");
  if (out instanceof Float32Array && out.length < requiredLength) {
    throw new Error(`rigid instance matrix buffer requires ${requiredLength} components, received ${out.length}`);
  }
  if (Array.isArray(out) && out.length < requiredLength) out.length = requiredLength;

  const matrices = resolveRigidInstanceMatrices(modelMatrices, options, count);
  for (let index = 0; index < count; index += 1) {
    const matrix = matrices[index]!;
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
  const source = Number.isSafeInteger(sourceIndex) && sourceIndex >= 0 ? modelMatrices[sourceIndex] : undefined;
  return cloneExactFiniteMat4(source, options.fallbackMatrix);
}

function resolveRigidInstanceMatrices(
  modelMatrices: readonly MatrixLike[],
  options: Pick<RigidInstanceMatrixOptions, "fallbackMatrix" | "jointIndices">,
  count: number
): Mat4[] {
  return Array.from({ length: count }, (_, index) => resolveRigidInstanceMatrix(modelMatrices, options, index));
}

function resolveRigidInstanceCount(
  modelMatrices: readonly MatrixLike[],
  options: Pick<RigidInstanceMatrixOptions, "count" | "jointIndices">
): number {
  const fallback = options.jointIndices ? options.jointIndices.length : modelMatrices.length;
  const count = sanitizeNonNegativeInteger(options.count, fallback);
  const resolved = Math.min(count, fallback);
  if (resolved > MAX_RIGID_INSTANCE_COUNT) {
    throw new RangeError(`rigid instance count exceeds ${MAX_RIGID_INSTANCE_COUNT}`);
  }
  return resolved;
}

function isExactFiniteMat4(matrix: MatrixLike | undefined): matrix is MatrixLike {
  if (matrix?.length !== 16 || !isFiniteMat4(matrix)) return false;
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(Math.fround(matrix[index]!))) return false;
  }
  return true;
}

function cloneExactFiniteMat4(matrix: MatrixLike | undefined, fallback: MatrixLike | undefined): Mat4 {
  if (isExactFiniteMat4(matrix)) {
    const clone = cloneFiniteMat4(matrix);
    if (isFiniteMat4(clone)) return clone;
  }
  if (isExactFiniteMat4(fallback)) {
    const clone = cloneFiniteMat4(fallback);
    if (isFiniteMat4(clone)) return clone;
  }
  return cloneFiniteMat4(undefined);
}

function computeRigidBufferRequiredLength(count: number, offset: number, stride: number): number | undefined {
  if (count <= 0) return 0;
  const required = offset + (count - 1) * stride + 16;
  return Number.isSafeInteger(required) && required >= 0 && required <= MAX_RIGID_BUFFER_COMPONENTS
    ? required
    : undefined;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : Math.max(1, Math.floor(fallback));
}

function sanitizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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
