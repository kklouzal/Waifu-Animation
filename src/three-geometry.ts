import { BufferAttribute, BufferGeometry, Float32BufferAttribute, type InstancedMesh } from "three";
import { type MatrixLike, type RigidInstanceMatrixOptions, updateRigidInstanceMatrixBuffer } from "./baked.js";
import { crossVec3, normalizeVec3, scaleVec3, type Vec3 } from "./math.js";
import { finiteOr, finitePositive, sanitizeNonNegativeInteger, sanitizePositiveInteger } from "./numeric-helpers.js";
import { type SkinningJob, type SkinningNumericArray, type SkinningResult, skinVertices } from "./skinning.js";

type ThreeSkinningJobFields = Omit<SkinningJob, "positions" | "normals" | "tangents" | "outPositions" | "outNormals" | "outTangents">;

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
  positions?: SkinningNumericArray | BufferAttribute;
  normals?: SkinningNumericArray | BufferAttribute;
  tangents?: SkinningNumericArray | BufferAttribute;
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

export function updateThreeRigidInstanceMatrices(
  target: ThreeRigidInstanceMatrixTarget,
  modelMatrices: readonly MatrixLike[],
  options: ThreeRigidInstanceMatricesOptions = {}
): number {
  const requestedCount = resolveThreeRigidInstanceCount(modelMatrices, options);
  if (isThreeInstancedMeshTarget(target)) {
    const count = Math.min(requestedCount, target.instanceMatrix.count);
    updateRigidInstanceMatrixBuffer(modelMatrices, target.instanceMatrix.array as Float32Array | number[], { ...options, count });
    if (options.updateMeshCount ?? true) target.count = count;
    markThreeAttributeUpdated(target.instanceMatrix, options.markNeedsUpdate);
    return count;
  }

  if (target instanceof BufferAttribute) {
    const count = Math.min(requestedCount, resolveThreeRigidInstanceBufferCapacity(target.array, options, target.count));
    updateRigidInstanceMatrixBuffer(modelMatrices, target.array as Float32Array | number[], { ...options, count });
    markThreeAttributeUpdated(target, options.markNeedsUpdate);
    return count;
  }

  const count = Math.min(requestedCount, resolveThreeRigidInstanceBufferCapacity(target, options));
  updateRigidInstanceMatrixBuffer(modelMatrices, target, { ...options, count });
  return count;
}

export function skinThreeBufferGeometry(geometry: BufferGeometry, options: ThreeSkinningBufferGeometryOptions = {}): ThreeSkinningBufferGeometryResult {
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
  const targetNormal = includeNormals && sourceNormal ? ensureThreeFloatVecAttribute(targetGeometry, names.normal, resolvedVertexCount, 3) : undefined;
  const tangentItemSize = Math.max(3, sourceTangent?.itemSize ?? 4, getThreeVec3Attribute(targetGeometry, names.tangent)?.itemSize ?? 0);
  const targetTangent = includeTangents && sourceTangent ? ensureThreeFloatVecAttribute(targetGeometry, names.tangent, resolvedVertexCount, tangentItemSize) : undefined;
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

export function buildThreeSkinningDebugSegments(options: ThreeSkinningDebugSegmentsOptions): ThreeSkinningDebugSegments {
  const names = resolveThreeSkinningAttributeNames(options.attributeNames);
  const positionSource = resolveThreeDebugSource(options.positions ?? getThreeVec3Attribute(options.geometry, names.position), options.positionOffset, options.positionStride);
  const normalSource = resolveThreeDebugSource(options.normals ?? getThreeVec3Attribute(options.geometry, names.normal), options.normalOffset, options.normalStride);
  const tangentSource = resolveThreeDebugSource(options.tangents ?? getThreeVec3Attribute(options.geometry, names.tangent), options.tangentOffset, options.tangentStride);
  const vertexCount = resolveThreeSkinningVertexCount(options.vertexCount, positionSource.count);
  const included = {
    normals: options.includeNormals ?? normalSource.count > 0,
    tangents: options.includeTangents ?? tangentSource.count > 0,
    binormals: options.includeBinormals ?? (normalSource.count > 0 && tangentSource.count > 0)
  };
  const vectorsPerVertex = (included.normals ? 1 : 0) + (included.tangents ? 1 : 0) + (included.binormals ? 1 : 0);
  const requiredLength = vertexCount * vectorsPerVertex * 6;
  const out = options.out && options.out.length >= requiredLength ? options.out : new Float32Array(requiredLength);
  const positions = out.length === requiredLength ? out : out.subarray(0, requiredLength);
  const scale = finitePositive(options.scale, 1);
  const normalizeVectors = options.normalizeVectors ?? true;
  let cursor = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const origin = readThreeDebugVec3(positionSource, vertex, [0, 0, 0]);
    const normal = readThreeDebugVec3(normalSource, vertex, [0, 0, 1]);
    const tangent = readThreeDebugVec3(tangentSource, vertex, [1, 0, 0]);
    if (included.normals) cursor = writeThreeDebugSegment(positions, cursor, origin, normal, scale, normalizeVectors, [0, 0, 1]);
    if (included.tangents) cursor = writeThreeDebugSegment(positions, cursor, origin, tangent, scale, normalizeVectors, [1, 0, 0]);
    if (included.binormals) {
      const handedness = finiteOr(readThreeDebugComponent(tangentSource, vertex, 3), finiteOr(options.tangentHandedness, 1));
      const binormal = scaleVec3(crossVec3(normalizeVec3(normal), normalizeVec3(tangent, [1, 0, 0])), handedness);
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

function resolveThreeSkinningAttributeNames(names: ThreeSkinningAttributeNames | undefined): Required<ThreeSkinningAttributeNames> {
  return {
    position: names?.position ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.position,
    normal: names?.normal ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.normal,
    tangent: names?.tangent ?? DEFAULT_THREE_SKINNING_ATTRIBUTE_NAMES.tangent
  };
}

function getThreeBufferAttribute(geometry: BufferGeometry | undefined, name: string): BufferAttribute | undefined {
  const attribute = geometry?.getAttribute(name);
  return attribute instanceof BufferAttribute ? attribute : undefined;
}

function getThreeVec3Attribute(geometry: BufferGeometry | undefined, name: string): BufferAttribute | undefined {
  const attribute = getThreeBufferAttribute(geometry, name);
  return attribute && attribute.itemSize >= 3 ? attribute : undefined;
}

function requireThreeVec3Attribute(geometry: BufferGeometry, name: string, label: string): BufferAttribute {
  const attribute = getThreeVec3Attribute(geometry, name);
  if (!attribute) throw new Error(`three skinning ${label} attribute '${name}' must be a BufferAttribute with itemSize >= 3`);
  return attribute;
}

function ensureThreeFloatVecAttribute(geometry: BufferGeometry, name: string, vertexCount: number, preferredItemSize: number): BufferAttribute {
  const existing = getThreeBufferAttribute(geometry, name);
  const itemSize = Math.max(3, preferredItemSize, existing?.itemSize ?? 0);
  if (existing && existing.array instanceof Float32Array && existing.itemSize >= itemSize && existing.count >= vertexCount) return existing;
  const attribute = new Float32BufferAttribute(new Float32Array(vertexCount * itemSize), itemSize);
  geometry.setAttribute(name, attribute);
  return attribute;
}

function threeAttributeSkinningInput(attribute: BufferAttribute): { data: SkinningNumericArray; offset: number; stride: number } {
  return { data: attribute.array, offset: 0, stride: attribute.itemSize };
}

function threeAttributeSkinningOutput(attribute: BufferAttribute): { data: Float32Array; offset: number; stride: number } {
  if (!(attribute.array instanceof Float32Array)) throw new Error("three skinning output attributes must use Float32Array buffers");
  return { data: attribute.array, offset: 0, stride: attribute.itemSize };
}

function copyThreeAttributeRemainder(source: BufferAttribute, target: BufferAttribute, vertexCount: number, startComponent: number): void {
  if (!(target.array instanceof Float32Array)) return;
  const componentCount = Math.min(source.itemSize, target.itemSize);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const sourceBase = vertex * source.itemSize;
    const targetBase = vertex * target.itemSize;
    for (let component = startComponent; component < componentCount; component += 1) {
      target.array[targetBase + component] = finiteOr(source.array[sourceBase + component], component === 3 ? 1 : 0);
    }
  }
}

function markThreeAttributeUpdated(attribute: BufferAttribute, markNeedsUpdate: boolean | undefined): void {
  if (markNeedsUpdate ?? true) attribute.needsUpdate = true;
}

function isThreeInstancedMeshTarget(target: ThreeRigidInstanceMatrixTarget): target is InstancedMesh {
  return typeof target === "object" && target !== null && "instanceMatrix" in target && (target as { instanceMatrix?: unknown }).instanceMatrix instanceof BufferAttribute;
}

function resolveThreeRigidInstanceCount(modelMatrices: readonly MatrixLike[], options: Pick<ThreeRigidInstanceMatricesOptions, "count" | "jointIndices">): number {
  const fallback = options.jointIndices ? options.jointIndices.length : modelMatrices.length;
  if (options.count === undefined) return Math.max(0, Math.floor(fallback));
  return Number.isInteger(options.count) && options.count >= 0 ? options.count : 0;
}

function resolveThreeRigidInstanceBufferCapacity(
  buffer: ArrayLike<number>,
  options: Pick<ThreeRigidInstanceMatricesOptions, "offset" | "stride">,
  attributeCount?: number
): number {
  const offset = sanitizeNonNegativeInteger(options.offset, 0);
  const stride = sanitizePositiveInteger(options.stride, 16);
  const componentCapacity = buffer.length >= offset + 16 ? Math.floor((buffer.length - offset - 16) / stride) + 1 : 0;
  return attributeCount === undefined ? componentCapacity : Math.min(componentCapacity, Math.max(0, Math.floor(attributeCount)));
}

function resolveThreeDebugSource(source: SkinningNumericArray | BufferAttribute | undefined, offset: number | undefined, stride: number | undefined): ThreeDebugSource {
  if (source instanceof BufferAttribute) {
    return {
      data: source.array,
      offset: sanitizeNonNegativeInteger(offset, 0),
      stride: sanitizePositiveInteger(stride, source.itemSize),
      count: source.count
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
  if (!data || !Number.isInteger(data.length) || data.length < offset + 3) return 0;
  return Math.max(0, Math.floor((data.length - offset - 3) / stride) + 1);
}

function resolveThreeSkinningVertexCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return Math.max(0, Math.floor(fallback));
  return Number.isInteger(value) && value > 0 ? value : 0;
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
  out[cursor] = origin[0];
  out[cursor + 1] = origin[1];
  out[cursor + 2] = origin[2];
  out[cursor + 3] = origin[0] + direction[0] * scale;
  out[cursor + 4] = origin[1] + direction[1] * scale;
  out[cursor + 5] = origin[2] + direction[2] * scale;
  return cursor + 6;
}
