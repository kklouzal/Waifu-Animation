import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InterleavedBufferAttribute,
  type InstancedMesh
} from "three";
import { type MatrixLike, type RigidInstanceMatrixOptions, updateRigidInstanceMatrixBuffer } from "./baked.js";
import { crossVec3, normalizeVec3, scaleVec3, type Vec3 } from "./math.js";
import { finiteOr, finitePositive } from "./numeric-helpers.js";
import { type SkinningJob, type SkinningNumericArray, type SkinningResult, skinVertices } from "./skinning.js";

type ThreeSkinningJobFields = Omit<
  SkinningJob,
  "positions" | "normals" | "tangents" | "outPositions" | "outNormals" | "outTangents"
>;

export type ThreeSkinningAttributeNames = {
  position?: string;
  normal?: string;
  tangent?: string;
};

export type ThreeSkinningBufferGeometryOptions = ThreeSkinningJobFields & {
  /** Optional bind/rest geometry to read from while writing skinned output into the target geometry. */
  sourceGeometry?: BufferGeometry;
  /** Geometry that receives skinned attributes. Defaults to the geometry passed to the helper. */
  targetGeometry?: BufferGeometry;
  attributeNames?: ThreeSkinningAttributeNames;
  includeNormals?: boolean;
  includeTangents?: boolean;
  markNeedsUpdate?: boolean;
  updateBounds?: boolean;
};

export type ThreeSkinningBufferGeometryResult = SkinningResult & {
  geometry: BufferGeometry;
  attributes: {
    position: BufferAttribute;
    normal?: BufferAttribute;
    tangent?: BufferAttribute;
  };
};

export type ThreeSkinningDebugVectorSet = {
  normals: boolean;
  tangents: boolean;
  binormals: boolean;
};

export type ThreeSkinningDebugSegments = {
  positions: Float32Array;
  vertexCount: number;
  segmentCount: number;
  included: ThreeSkinningDebugVectorSet;
};

export type ThreeSkinningDebugSegmentsOptions = {
  geometry?: BufferGeometry;
  attributeNames?: ThreeSkinningAttributeNames;
  positions?: SkinningNumericArray | BufferAttribute | InterleavedBufferAttribute;
  normals?: SkinningNumericArray | BufferAttribute | InterleavedBufferAttribute;
  tangents?: SkinningNumericArray | BufferAttribute | InterleavedBufferAttribute;
  vertexCount?: number;
  scale?: number;
  normalizeVectors?: boolean;
  includeNormals?: boolean;
  includeTangents?: boolean;
  includeBinormals?: boolean;
  positionOffset?: number;
  normalOffset?: number;
  tangentOffset?: number;
  positionStride?: number;
  normalStride?: number;
  tangentStride?: number;
  tangentHandedness?: number;
  out?: Float32Array;
};

export type ThreeSkinningDebugGeometryOptions = ThreeSkinningDebugSegmentsOptions & {
  targetGeometry?: BufferGeometry;
  markNeedsUpdate?: boolean;
};

export type ThreeRigidInstanceMatrixTarget = InstancedMesh | BufferAttribute | Float32Array | number[];

export type ThreeRigidInstanceMatricesOptions = RigidInstanceMatrixOptions & {
  offset?: number;
  stride?: number;
  markNeedsUpdate?: boolean;
  updateMeshCount?: boolean;
};

const DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES = {
  position: "position",
  normal: "normal",
  tangent: "tangent"
} as const;
const MAX_THREE_ATTRIBUTE_COMPONENTS = 16_777_216;
const MAX_THREE_RIGID_INSTANCES = 1_048_576;

export function updateThreeRigidInstanceMatrices(
  target: ThreeRigidInstanceMatrixTarget,
  modelMatrices: readonly MatrixLike[],
  options: ThreeRigidInstanceMatricesOptions = {}
): number {
  const requestedCount = resolveThreeRigidInstanceCount(modelMatrices, options);
  if (isThreeInstancedMeshTarget(target)) {
    validateThreeMatrixAttribute(target.instanceMatrix, "InstancedMesh instanceMatrix");
    if (
      (options.offset !== undefined && options.offset !== 0) ||
      (options.stride !== undefined && options.stride !== target.instanceMatrix.itemSize)
    ) {
      throw new Error("three InstancedMesh matrix updates require offset 0 and stride 16");
    }
    const count = Math.min(
      requestedCount,
      resolveThreeRigidInstanceBufferCapacity(target.instanceMatrix.array, {}, target.instanceMatrix.count)
    );
    updateRigidInstanceMatrixBuffer(modelMatrices, target.instanceMatrix.array as Float32Array | number[], {
      ...options,
      count
    });
    if (options.updateMeshCount ?? true) target.count = count;
    markThreeAttributeUpdated(target.instanceMatrix, options.markNeedsUpdate);
    return count;
  }

  if (target instanceof BufferAttribute) {
    validateThreeMatrixAttribute(target, "matrix BufferAttribute");
    const count = Math.min(
      requestedCount,
      resolveThreeRigidInstanceBufferCapacity(target.array, options, target.count)
    );
    updateRigidInstanceMatrixBuffer(modelMatrices, target.array as Float32Array | number[], { ...options, count });
    markThreeAttributeUpdated(target, options.markNeedsUpdate);
    return count;
  }

  const count = Array.isArray(target)
    ? requestedCount
    : Math.min(requestedCount, resolveThreeRigidInstanceBufferCapacity(target, options));
  updateRigidInstanceMatrixBuffer(modelMatrices, target, { ...options, count });
  return count;
}

export function skinThreeBufferGeometry(
  geometry: BufferGeometry,
  options: ThreeSkinningBufferGeometryOptions = {}
): ThreeSkinningBufferGeometryResult {
  const sourceGeometry = options.sourceGeometry ?? geometry;
  const targetGeometry = options.targetGeometry ?? geometry;
  const names = resolveThreeSkinningAttributeNames(options.attributeNames);
  const sourcePosition = requireThreeVec3Attribute(sourceGeometry, names.position, "source position");
  const sourceNormal = getThreeVec3Attribute(sourceGeometry, names.normal);
  const includeNormals = options.includeNormals ?? sourceNormal !== undefined;
  const sourceTangent = getThreeVec3Attribute(sourceGeometry, names.tangent);
  const includeTangents = (options.includeTangents ?? sourceTangent !== undefined) && includeNormals;
  const resolvedVertexCount = resolveThreeSkinningVertexCount(options.vertexCount, sourcePosition.count);
  const targetPosition = ensureThreeFloatVecAttribute(targetGeometry, names.position, resolvedVertexCount, 3);
  const targetNormal =
    includeNormals && sourceNormal
      ? ensureThreeFloatVecAttribute(targetGeometry, names.normal, resolvedVertexCount, 3)
      : undefined;
  const tangentItemSize = Math.max(
    3,
    sourceTangent?.itemSize ?? 4,
    getThreeVec3Attribute(targetGeometry, names.tangent)?.itemSize ?? 0
  );
  const targetTangent =
    includeTangents && sourceTangent
      ? ensureThreeFloatVecAttribute(targetGeometry, names.tangent, resolvedVertexCount, tangentItemSize)
      : undefined;
  const {
    sourceGeometry: _sourceGeometry,
    targetGeometry: _targetGeometry,
    attributeNames: _attributeNames,
    includeNormals: _includeNormals,
    includeTangents: _includeTangents,
    markNeedsUpdate,
    updateBounds,
    ...skinningFields
  } = options;
  const skinningJob: SkinningJob = {
    ...skinningFields,
    vertexCount: skinningFields.vertexCount ?? resolvedVertexCount,
    positions: threeAttributeSkinningInput(sourcePosition),
    outPositions: threeAttributeSkinningOutput(targetPosition)
  };

  if (sourceNormal && targetNormal) {
    skinningJob.normals = threeAttributeSkinningInput(sourceNormal);
    skinningJob.outNormals = threeAttributeSkinningOutput(targetNormal);
  }
  if (sourceTangent && targetTangent && skinningJob.normals) {
    skinningJob.tangents = threeAttributeSkinningInput(sourceTangent);
    skinningJob.outTangents = threeAttributeSkinningOutput(targetTangent);
  }

  const result = skinVertices(skinningJob);
  if (sourceTangent && targetTangent) copyThreeAttributeRemainder(sourceTangent, targetTangent, resolvedVertexCount, 3);
  markThreeAttributeUpdated(targetPosition, markNeedsUpdate);
  if (targetNormal) markThreeAttributeUpdated(targetNormal, markNeedsUpdate);
  if (targetTangent) markThreeAttributeUpdated(targetTangent, markNeedsUpdate);
  if (updateBounds ?? true) {
    targetGeometry.computeBoundingBox();
    targetGeometry.computeBoundingSphere();
  }

  const attributes: ThreeSkinningBufferGeometryResult["attributes"] = { position: targetPosition };
  if (targetNormal) attributes.normal = targetNormal;
  if (targetTangent) attributes.tangent = targetTangent;
  return { ...result, geometry: targetGeometry, attributes };
}

export function buildThreeSkinningDebugSegments(
  options: ThreeSkinningDebugSegmentsOptions
): ThreeSkinningDebugSegments {
  const names = resolveThreeSkinningAttributeNames(options.attributeNames);
  const positionSource = resolveThreeDebugSource(
    options.positions ?? getThreeVec3Attribute(options.geometry, names.position),
    options.positionOffset,
    options.positionStride
  );
  const normalSource = resolveThreeDebugSource(
    options.normals ?? getThreeVec3Attribute(options.geometry, names.normal),
    options.normalOffset,
    options.normalStride
  );
  const tangentSource = resolveThreeDebugSource(
    options.tangents ?? getThreeVec3Attribute(options.geometry, names.tangent),
    options.tangentOffset,
    options.tangentStride
  );
  const vertexCount = resolveThreeSkinningVertexCount(options.vertexCount, positionSource.count);
  const included = {
    normals: options.includeNormals ?? normalSource.count > 0,
    tangents: options.includeTangents ?? tangentSource.count > 0,
    binormals: options.includeBinormals ?? (normalSource.count > 0 && tangentSource.count > 0)
  };
  const vectorsPerVertex = (included.normals ? 1 : 0) + (included.tangents ? 1 : 0) + (included.binormals ? 1 : 0);
  const requiredLength = resolveThreeDebugOutputLength(vertexCount, vectorsPerVertex);
  const out = options.out && options.out.length >= requiredLength ? options.out : new Float32Array(requiredLength);
  const positions = out.length === requiredLength ? out : out.subarray(0, requiredLength);
  const scale = finitePositive(options.scale, 1);
  const normalizeVectors = options.normalizeVectors ?? true;
  let cursor = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const origin = readThreeDebugVec3(positionSource, vertex, [0, 0, 0]);
    const normal = readThreeDebugVec3(normalSource, vertex, [0, 0, 1]);
    const tangent = readThreeDebugVec3(tangentSource, vertex, [1, 0, 0]);
    if (included.normals)
      cursor = writeThreeDebugSegment(positions, cursor, origin, normal, scale, normalizeVectors, [0, 0, 1]);
    if (included.tangents)
      cursor = writeThreeDebugSegment(positions, cursor, origin, tangent, scale, normalizeVectors, [1, 0, 0]);
    if (included.binormals) {
      const handednessValue = finiteOr(
        readThreeDebugComponent(tangentSource, vertex, 3),
        finiteOr(options.tangentHandedness, 1)
      );
      const normalizedNormal = normalizeVec3(normal);
      const normalizedTangent = normalizeVec3(tangent, orthogonalVector(normalizedNormal));
      const binormal = scaleVec3(
        normalizeVec3(crossVec3(normalizedNormal, normalizedTangent), orthogonalVector(normalizedNormal)),
        handednessValue < 0 ? -1 : 1
      );
      cursor = writeThreeDebugSegment(positions, cursor, origin, binormal, scale, normalizeVectors, [0, 1, 0]);
    }
  }

  return {
    positions,
    vertexCount,
    segmentCount: vectorsPerVertex * vertexCount,
    included
  };
}

export function createThreeSkinningDebugGeometry(options: ThreeSkinningDebugGeometryOptions): BufferGeometry {
  const segments = buildThreeSkinningDebugSegments(options);
  const geometry = options.targetGeometry ?? new BufferGeometry();
  const positionAttribute = new Float32BufferAttribute(segments.positions, 3);
  geometry.setAttribute("position", positionAttribute);
  geometry.setDrawRange(0, segments.positions.length / 3);
  geometry.userData.waifuAnimationSkinningDebug = {
    vertexCount: segments.vertexCount,
    segmentCount: segments.segmentCount,
    included: segments.included
  };
  markThreeAttributeUpdated(positionAttribute, options.markNeedsUpdate);
  return geometry;
}

type ThreeDebugSource = {
  data: SkinningNumericArray;
  offset: number;
  stride: number;
  count: number;
};

type ThreeReadableAttribute = BufferAttribute | InterleavedBufferAttribute;

function resolveThreeSkinningAttributeNames(
  names: ThreeSkinningAttributeNames | undefined
): Required<ThreeSkinningAttributeNames> {
  return {
    position: names?.position ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.position,
    normal: names?.normal ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.normal,
    tangent: names?.tangent ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.tangent
  };
}

function getThreeReadableAttribute(
  geometry: BufferGeometry | undefined,
  name: string
): ThreeReadableAttribute | undefined {
  const attribute = geometry?.getAttribute(name);
  return attribute instanceof BufferAttribute || attribute instanceof InterleavedBufferAttribute
    ? attribute
    : undefined;
}

function getThreeBufferAttribute(geometry: BufferGeometry | undefined, name: string): BufferAttribute | undefined {
  const attribute = getThreeReadableAttribute(geometry, name);
  return attribute instanceof BufferAttribute ? attribute : undefined;
}

function getThreeVec3Attribute(geometry: BufferGeometry | undefined, name: string): ThreeReadableAttribute | undefined {
  const attribute = getThreeReadableAttribute(geometry, name);
  return attribute && Number.isSafeInteger(attribute.itemSize) && attribute.itemSize >= 3 ? attribute : undefined;
}

function requireThreeVec3Attribute(geometry: BufferGeometry, name: string, label: string): ThreeReadableAttribute {
  const attribute = getThreeVec3Attribute(geometry, name);
  if (!attribute)
    throw new Error(
      `three skinning ${label} attribute '${name}' must be a BufferAttribute or InterleavedBufferAttribute with itemSize >= 3`
    );
  return attribute;
}

function ensureThreeFloatVecAttribute(
  geometry: BufferGeometry,
  name: string,
  vertexCount: number,
  preferredItemSize: number
): BufferAttribute {
  const existing = getThreeBufferAttribute(geometry, name);
  const readableExisting = getThreeReadableAttribute(geometry, name);
  const itemSize = Math.max(3, preferredItemSize, readableExisting?.itemSize ?? 0);
  const requiredLength = vertexCount * itemSize;
  if (
    !Number.isSafeInteger(itemSize) ||
    !Number.isSafeInteger(requiredLength) ||
    requiredLength > MAX_THREE_ATTRIBUTE_COMPONENTS
  ) {
    throw new RangeError("three skinning attribute range exceeds safe array bounds");
  }
  if (
    existing &&
    existing.array instanceof Float32Array &&
    existing.itemSize >= itemSize &&
    existing.count >= vertexCount
  )
    return existing;
  const attribute = new Float32BufferAttribute(new Float32Array(requiredLength), itemSize);
  geometry.setAttribute(name, attribute);
  return attribute;
}

function threeAttributeSkinningInput(attribute: ThreeReadableAttribute): {
  data: SkinningNumericArray;
  offset: number;
  stride: number;
} {
  if (attribute instanceof BufferAttribute && attribute.array instanceof Float32Array && !attribute.normalized) {
    return { data: attribute.array, offset: 0, stride: attribute.itemSize };
  }
  if (
    attribute instanceof InterleavedBufferAttribute &&
    attribute.data.array instanceof Float32Array &&
    !attribute.normalized
  ) {
    return { data: attribute.data.array, offset: attribute.offset, stride: attribute.data.stride };
  }
  const data = flattenThreeAttribute(attribute);
  return { data, offset: 0, stride: attribute.itemSize };
}

function threeAttributeSkinningOutput(attribute: BufferAttribute): {
  data: Float32Array;
  offset: number;
  stride: number;
} {
  if (!(attribute.array instanceof Float32Array))
    throw new Error("three skinning output attributes must use Float32Array buffers");
  return { data: attribute.array, offset: 0, stride: attribute.itemSize };
}

function copyThreeAttributeRemainder(
  source: ThreeReadableAttribute,
  target: BufferAttribute,
  vertexCount: number,
  startComponent: number
): void {
  if (!(target.array instanceof Float32Array)) return;
  const componentCount = Math.min(source.itemSize, target.itemSize);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const targetBase = vertex * target.itemSize;
    for (let component = startComponent; component < componentCount; component += 1) {
      target.array[targetBase + component] = finiteOr(
        readThreeAttributeComponent(source, vertex, component),
        component === 3 ? 1 : 0
      );
    }
  }
}

function markThreeAttributeUpdated(attribute: BufferAttribute, markNeedsUpdate: boolean | undefined): void {
  if (markNeedsUpdate ?? true) attribute.needsUpdate = true;
}

function isThreeInstancedMeshTarget(target: ThreeRigidInstanceMatrixTarget): target is InstancedMesh {
  return (
    typeof target === "object" &&
    target !== null &&
    "instanceMatrix" in target &&
    (target as { instanceMatrix?: unknown }).instanceMatrix instanceof BufferAttribute
  );
}

function resolveThreeRigidInstanceCount(
  modelMatrices: readonly MatrixLike[],
  options: Pick<ThreeRigidInstanceMatricesOptions, "count" | "jointIndices">
): number {
  const fallback = options.jointIndices ? options.jointIndices.length : modelMatrices.length;
  const available = Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
  const requested =
    options.count === undefined
      ? available
      : Number.isSafeInteger(options.count) && options.count >= 0
        ? Math.min(options.count, available)
        : 0;
  return Math.min(requested, MAX_THREE_RIGID_INSTANCES);
}

function resolveThreeRigidInstanceBufferCapacity(
  buffer: ArrayLike<number>,
  options: Pick<ThreeRigidInstanceMatricesOptions, "offset" | "stride">,
  attributeCount?: number
): number {
  const offset = sanitizeNonNegativeInteger(options.offset, 0);
  const stride = Math.max(16, sanitizePositiveInteger(options.stride, 16));
  const componentCapacity = buffer.length >= offset + 16 ? Math.floor((buffer.length - offset - 16) / stride) + 1 : 0;
  return attributeCount === undefined
    ? componentCapacity
    : Math.min(componentCapacity, Math.max(0, Math.floor(attributeCount)));
}

function validateThreeMatrixAttribute(attribute: BufferAttribute, label: string): void {
  if (!(attribute.array instanceof Float32Array)) {
    throw new Error(`three ${label} must use a Float32Array buffer`);
  }
  if (attribute.itemSize !== 16 || !Number.isSafeInteger(attribute.count)) {
    throw new Error(`three ${label} must have itemSize 16 and an integral count`);
  }
}

function resolveThreeDebugSource(
  source: SkinningNumericArray | BufferAttribute | InterleavedBufferAttribute | undefined,
  offset: number | undefined,
  stride: number | undefined
): ThreeDebugSource {
  if (source instanceof BufferAttribute) {
    if (source.normalized || !(source.array instanceof Float32Array)) {
      return resolveThreeDebugSource(flattenThreeAttribute(source), offset, stride ?? source.itemSize);
    }
    const resolvedOffset = sanitizeNonNegativeInteger(offset, 0);
    const resolvedStride = sanitizePositiveInteger(stride, source.itemSize);
    return {
      data: source.array,
      offset: resolvedOffset,
      stride: resolvedStride,
      count: inferThreeVec3Count(source.array, resolvedOffset, resolvedStride)
    };
  }
  if (source instanceof InterleavedBufferAttribute) {
    if (source.normalized || !(source.data.array instanceof Float32Array)) {
      return resolveThreeDebugSource(flattenThreeAttribute(source), offset, stride ?? source.itemSize);
    }
    const resolvedOffset = sanitizeNonNegativeInteger(offset, source.offset);
    const resolvedStride = sanitizePositiveInteger(stride, source.data.stride);
    return {
      data: source.data.array,
      offset: resolvedOffset,
      stride: resolvedStride,
      count: inferThreeVec3Count(source.data.array, resolvedOffset, resolvedStride)
    };
  }
  const resolvedOffset = sanitizeNonNegativeInteger(offset, 0);
  const resolvedStride = sanitizePositiveInteger(stride, 3);
  return {
    data: source ?? [],
    offset: resolvedOffset,
    stride: resolvedStride,
    count: inferThreeVec3Count(source, resolvedOffset, resolvedStride)
  };
}

function inferThreeVec3Count(data: SkinningNumericArray | undefined, offset: number, stride: number): number {
  if (!data || !Number.isSafeInteger(data.length) || data.length < offset + 3) return 0;
  return Math.max(0, Math.floor((data.length - offset - 3) / stride) + 1);
}

function resolveThreeSkinningVertexCount(value: number | undefined, fallback: number): number {
  const available = sanitizeThreeAttributeCount(fallback);
  if (value === undefined) return available;
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, available) : 0;
}

function readThreeDebugVec3(source: ThreeDebugSource, vertex: number, fallback: Vec3): Vec3 {
  const base = source.offset + vertex * source.stride;
  return [
    finiteOr(source.data[base], fallback[0]),
    finiteOr(source.data[base + 1], fallback[1]),
    finiteOr(source.data[base + 2], fallback[2])
  ];
}

function readThreeDebugComponent(source: ThreeDebugSource, vertex: number, component: number): number | undefined {
  return source.data[source.offset + vertex * source.stride + component];
}

function writeThreeDebugSegment(
  out: Float32Array,
  cursor: number,
  origin: Vec3,
  vector: Vec3,
  scale: number,
  normalize: boolean,
  fallback: Vec3
): number {
  const direction = normalize ? normalizeVec3(vector, fallback) : vector;
  out[cursor] = finiteFloat32(origin[0]);
  out[cursor + 1] = finiteFloat32(origin[1]);
  out[cursor + 2] = finiteFloat32(origin[2]);
  out[cursor + 3] = finiteFloat32(origin[0] + direction[0] * scale);
  out[cursor + 4] = finiteFloat32(origin[1] + direction[1] * scale);
  out[cursor + 5] = finiteFloat32(origin[2] + direction[2] * scale);
  return cursor + 6;
}

function readThreeAttributeComponent(
  attribute: ThreeReadableAttribute,
  vertex: number,
  component: number
): number | undefined {
  if (vertex < 0 || vertex >= attribute.count || component < 0 || component >= attribute.itemSize) return undefined;
  if (component === 0) return attribute.getX(vertex);
  if (component === 1) return attribute.getY(vertex);
  if (component === 2) return attribute.getZ(vertex);
  if (component === 3) return attribute.getW(vertex);
  return attribute.getComponent(vertex, component);
}

function flattenThreeAttribute(attribute: ThreeReadableAttribute): Float32Array {
  const count = sanitizeThreeAttributeCount(attribute.count);
  const itemSize = Number.isSafeInteger(attribute.itemSize) && attribute.itemSize >= 3 ? attribute.itemSize : 3;
  const requiredLength = count * itemSize;
  if (!Number.isSafeInteger(requiredLength) || requiredLength > MAX_THREE_ATTRIBUTE_COMPONENTS) {
    throw new RangeError("three attribute range exceeds safe array bounds");
  }
  const data = new Float32Array(requiredLength);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const base = vertex * itemSize;
    for (let component = 0; component < itemSize; component += 1) {
      data[base + component] = finiteOr(
        readThreeAttributeComponent(attribute, vertex, component),
        component === 3 ? 1 : 0
      );
    }
  }
  return data;
}

function sanitizeThreeAttributeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : Math.max(0, Math.floor(value));
}

function resolveThreeDebugOutputLength(vertexCount: number, vectorsPerVertex: number): number {
  const requiredLength = vertexCount * vectorsPerVertex * 6;
  if (!Number.isSafeInteger(requiredLength) || requiredLength < 0 || requiredLength > MAX_THREE_ATTRIBUTE_COMPONENTS) {
    throw new RangeError("three skinning debug output range exceeds safe array bounds");
  }
  return requiredLength;
}

function orthogonalVector(normal: Vec3): Vec3 {
  const axis: Vec3 =
    Math.abs(normal[0]) <= Math.abs(normal[1]) && Math.abs(normal[0]) <= Math.abs(normal[2])
      ? [1, 0, 0]
      : Math.abs(normal[1]) <= Math.abs(normal[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  return normalizeVec3(crossVec3(normal, axis), [0, 1, 0]);
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function sanitizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function finiteFloat32(value: number): number {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value)) ? value : 0;
}
