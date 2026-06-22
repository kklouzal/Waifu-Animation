import { type Mat4, multiplyMat4 } from "./math.js";
import {
  cloneFiniteMat4,
  finiteOr,
  isFiniteMat4,
  sanitizeNonNegativeInteger,
  sanitizePositiveInteger
} from "./numeric-helpers.js";

export type SkinningNumericArray = ArrayLike<number>;
export type SkinningMutableArray = Float32Array | number[];

export type SkinningAttributeInput = {
  /** Flat xyz input data. Strides and offsets are counted in numeric components, not bytes. */
  data: SkinningNumericArray;
  /** Component offset of the first vertex. Defaults to 0. */
  offset?: number;
  /** Components from one vertex to the next. Defaults to 3. */
  stride?: number;
};

export type SkinningAttributeOutput = {
  /** Optional reusable flat xyz output data. Reused when it can hold the requested vertices. */
  data?: SkinningMutableArray;
  /** Component offset of the first output vertex. Defaults to 0. */
  offset?: number;
  /** Components from one output vertex to the next. Defaults to 3. */
  stride?: number;
};

export type SkinningWeightMode = "restored-last" | "explicit";

export type SkinningJob = {
  /** Number of vertices to skin. Defaults to the count inferred from positions. */
  vertexCount?: number;
  /** Maximum joint influences per vertex. Defaults to 1. */
  influences?: number;
  /** Precomputed skinning matrices, typically model-space joint matrix * inverse bind pose. */
  jointMatrices?: readonly SkinningNumericArray[];
  /** Optional model-space matrices used with inverseBindMatrices to build the palette. */
  modelMatrices?: readonly SkinningNumericArray[];
  /** Optional inverse bind matrices used with modelMatrices to build the palette. */
  inverseBindMatrices?: readonly SkinningNumericArray[];
  /** Optional mesh-to-skeleton remap used while building a model * inverse-bind palette. */
  jointRemaps?: SkinningNumericArray;
  /** Optional inverse-transpose matrix palette for normals and tangents. */
  jointInverseTransposeMatrices?: readonly SkinningNumericArray[];
  /** Flat joint indices. Missing or invalid indices fall back to joint 0. */
  jointIndices?: SkinningNumericArray;
  /**
   * Flat weights. In restored-last mode, each vertex stores influences - 1 weights and the final
   * influence weight is reconstructed as 1 - sum(previous). In explicit mode, each vertex stores
   * influences weights.
   */
  jointWeights?: SkinningNumericArray;
  jointIndexOffset?: number;
  jointIndexStride?: number;
  jointWeightOffset?: number;
  jointWeightStride?: number;
  weightMode?: SkinningWeightMode;
  positions?: SkinningAttributeInput;
  normals?: SkinningAttributeInput;
  tangents?: SkinningAttributeInput;
  outPositions?: SkinningAttributeOutput;
  outNormals?: SkinningAttributeOutput;
  outTangents?: SkinningAttributeOutput;
};

export type SkinningValidationIssue = {
  field?: string;
  index?: number;
  message: string;
};

export type SkinningResult = {
  vertexCount: number;
  influences: number;
  issues: SkinningValidationIssue[];
  positions: SkinningMutableArray;
  normals?: SkinningMutableArray;
  tangents?: SkinningMutableArray;
};

export type SkinningMatrixPaletteOptions = {
  jointRemaps?: SkinningNumericArray;
  out?: Mat4[];
};

const IDENTITY_MAT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) as Mat4;

export function validateSkinningJob(job: SkinningJob): SkinningValidationIssue[] {
  const issues: SkinningValidationIssue[] = [];
  const influences = sanitizePositiveInteger(job.influences, 1);
  const vertexCount = sanitizeVertexCount(job.vertexCount, job.positions);
  const weightMode = job.weightMode ?? "restored-last";

  if (job.vertexCount !== undefined && (!Number.isInteger(job.vertexCount) || job.vertexCount < 0)) {
    issues.push({ field: "vertexCount", message: "skinning vertexCount must be a non-negative integer" });
  }
  if (job.influences !== undefined && (!Number.isInteger(job.influences) || job.influences <= 0)) {
    issues.push({ field: "influences", message: "skinning influences must be a positive integer" });
  }
  if (job.positions === undefined) issues.push({ field: "positions", message: "skinning positions input is missing" });
  if (job.normals !== undefined && job.positions === undefined) {
    issues.push({ field: "normals", message: "skinning normals require positions input" });
  }
  if (job.tangents !== undefined && job.normals === undefined) {
    issues.push({ field: "tangents", message: "skinning tangents require normals input" });
  }
  validateAttributeInput(job.positions, "positions", issues);
  validateAttributeInput(job.normals, "normals", issues);
  validateAttributeInput(job.tangents, "tangents", issues);
  validateAttributeBounds(job.positions, vertexCount, "positions", issues);
  validateAttributeBounds(job.normals, vertexCount, "normals", issues);
  validateAttributeBounds(job.tangents, vertexCount, "tangents", issues);
  validateAttributeOutput(job.outPositions, "outPositions", issues);
  validateAttributeOutput(job.outNormals, "outNormals", issues);
  validateAttributeOutput(job.outTangents, "outTangents", issues);

  if (weightMode !== "restored-last" && weightMode !== "explicit") {
    issues.push({ field: "weightMode", message: "skinning weightMode must be restored-last or explicit" });
  }
  if (job.jointIndices === undefined && vertexCount > 0) {
    issues.push({
      field: "jointIndices",
      message: "skinning joint indices are missing; joint 0 fallback will be used"
    });
  } else {
    validateIndexedBuffer(
      job.jointIndices,
      sanitizeNonNegativeInteger(job.jointIndexOffset, 0),
      sanitizePositiveInteger(job.jointIndexStride, influences),
      "jointIndices",
      issues
    );
    validateInfluenceBounds(
      job.jointIndices,
      vertexCount,
      influences,
      sanitizeNonNegativeInteger(job.jointIndexOffset, 0),
      sanitizePositiveInteger(job.jointIndexStride, influences),
      "jointIndices",
      issues
    );
  }
  if (influences > 1 || weightMode === "explicit") {
    const defaultWeightStride = weightMode === "explicit" ? influences : Math.max(0, influences - 1);
    if (job.jointWeights === undefined && vertexCount > 0) {
      issues.push({
        field: "jointWeights",
        message: "skinning joint weights are missing; zero/restored fallback weights will be used"
      });
    }
    validateIndexedBuffer(
      job.jointWeights,
      sanitizeNonNegativeInteger(job.jointWeightOffset, 0),
      sanitizeNonNegativeInteger(job.jointWeightStride, defaultWeightStride),
      "jointWeights",
      issues
    );
    validateInfluenceBounds(
      job.jointWeights,
      vertexCount,
      defaultWeightStride,
      sanitizeNonNegativeInteger(job.jointWeightOffset, 0),
      sanitizeNonNegativeInteger(job.jointWeightStride, defaultWeightStride),
      "jointWeights",
      issues
    );
  }
  if (
    job.jointMatrices === undefined &&
    (job.modelMatrices === undefined || job.inverseBindMatrices === undefined) &&
    vertexCount > 0
  ) {
    issues.push({
      field: "jointMatrices",
      message: "skinning joint matrices are missing; identity fallback will be used"
    });
  }
  if (vertexCount > 0 && job.jointMatrices !== undefined && job.jointMatrices.length === 0) {
    issues.push({
      field: "jointMatrices",
      message: "skinning joint matrix palette is empty; identity fallback will be used"
    });
  }
  if (vertexCount > 0 && job.modelMatrices !== undefined && job.modelMatrices.length === 0) {
    issues.push({
      field: "modelMatrices",
      message: "skinning model matrix palette is empty; identity fallback will be used"
    });
  }
  if (vertexCount > 0 && job.inverseBindMatrices !== undefined && job.inverseBindMatrices.length === 0) {
    issues.push({
      field: "inverseBindMatrices",
      message: "skinning inverse bind palette is empty; identity fallback will be used"
    });
  }
  validateMatrixArray(job.jointMatrices, "jointMatrices", issues);
  validateMatrixArray(job.modelMatrices, "modelMatrices", issues);
  validateMatrixArray(job.inverseBindMatrices, "inverseBindMatrices", issues);
  validateMatrixArray(job.jointInverseTransposeMatrices, "jointInverseTransposeMatrices", issues);
  if (
    job.modelMatrices !== undefined &&
    job.inverseBindMatrices !== undefined &&
    job.inverseBindMatrices.length < job.modelMatrices.length &&
    job.jointRemaps === undefined
  ) {
    issues.push({
      field: "inverseBindMatrices",
      message: "skinning inverse bind palette is shorter than model matrix palette"
    });
  }
  return issues;
}

export function buildSkinningMatrixPalette(
  modelMatrices: readonly SkinningNumericArray[],
  inverseBindMatrices: readonly SkinningNumericArray[],
  options: SkinningMatrixPaletteOptions = {}
): Mat4[] {
  const paletteCount = options.jointRemaps
    ? options.jointRemaps.length
    : Math.max(modelMatrices.length, inverseBindMatrices.length);
  const out = options.out ?? [];
  out.length = paletteCount;
  for (let index = 0; index < paletteCount; index += 1) {
    const modelIndex = options.jointRemaps
      ? sanitizePaletteIndex(options.jointRemaps[index], modelMatrices.length)
      : index;
    const model = cloneFiniteMat4(modelMatrices[modelIndex]);
    const inverseBind = cloneFiniteMat4(inverseBindMatrices[index]);
    out[index] = multiplyMat4(model, inverseBind);
  }
  return out;
}

export function skinVertices(job: SkinningJob): SkinningResult {
  const issues = validateSkinningJob(job);
  const influences = sanitizePositiveInteger(job.influences, 1);
  const vertexCount = sanitizeVertexCount(job.vertexCount, job.positions);
  const weightMode = job.weightMode === "explicit" ? "explicit" : "restored-last";
  const jointMatrices = resolveJointMatrices(job);
  const vectorMatrices = job.jointInverseTransposeMatrices;
  const positionsInput = job.positions ?? { data: [] };
  const positionIn = resolveAttributeInput(positionsInput);
  const normalIn = job.normals ? resolveAttributeInput(job.normals) : null;
  const tangentIn = job.tangents && normalIn ? resolveAttributeInput(job.tangents) : null;
  const positionOut = resolveAttributeOutput(job.outPositions, vertexCount);
  const normalOut = normalIn ? resolveAttributeOutput(job.outNormals, vertexCount) : null;
  const tangentOut = tangentIn ? resolveAttributeOutput(job.outTangents, vertexCount) : null;
  const jointIndexOffset = sanitizeNonNegativeInteger(job.jointIndexOffset, 0);
  const jointIndexStride = sanitizePositiveInteger(job.jointIndexStride, influences);
  const defaultWeightStride = weightMode === "explicit" ? influences : Math.max(0, influences - 1);
  const jointWeightOffset = sanitizeNonNegativeInteger(job.jointWeightOffset, 0);
  const jointWeightStride = sanitizeNonNegativeInteger(job.jointWeightStride, defaultWeightStride);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const inputPositionBase = positionIn.offset + vertex * positionIn.stride;
    const position = readVec3(positionIn.data, inputPositionBase);
    const normal = normalIn ? readVec3(normalIn.data, normalIn.offset + vertex * normalIn.stride) : null;
    const tangent = tangentIn ? readVec3(tangentIn.data, tangentIn.offset + vertex * tangentIn.stride) : null;
    let outPx = 0;
    let outPy = 0;
    let outPz = 0;
    let outNx = 0;
    let outNy = 0;
    let outNz = 0;
    let outTx = 0;
    let outTy = 0;
    let outTz = 0;
    let previousWeightSum = 0;

    for (let influence = 0; influence < influences; influence += 1) {
      const jointSlot = jointIndexOffset + vertex * jointIndexStride + influence;
      const jointIndex = sanitizePaletteIndex(job.jointIndices?.[jointSlot], jointMatrices.length);
      const weight = readInfluenceWeight(
        job,
        vertex,
        influence,
        influences,
        weightMode,
        jointWeightOffset,
        jointWeightStride,
        previousWeightSum
      );
      if (weightMode === "restored-last" && influence < influences - 1) previousWeightSum += weight;
      if (weight === 0) continue;

      const matrix = cloneFiniteMat4(jointMatrices[jointIndex]);
      const skinnedPosition = transformPointComponents(matrix, position[0], position[1], position[2]);
      outPx += skinnedPosition[0] * weight;
      outPy += skinnedPosition[1] * weight;
      outPz += skinnedPosition[2] * weight;

      if (normal) {
        const vectorMatrix = cloneFiniteMat4(vectorMatrices?.[jointIndex] ?? matrix);
        const skinnedNormal = transformVectorComponents(vectorMatrix, normal[0], normal[1], normal[2]);
        outNx += skinnedNormal[0] * weight;
        outNy += skinnedNormal[1] * weight;
        outNz += skinnedNormal[2] * weight;
      }
      if (tangent) {
        const vectorMatrix = cloneFiniteMat4(vectorMatrices?.[jointIndex] ?? matrix);
        const skinnedTangent = transformVectorComponents(vectorMatrix, tangent[0], tangent[1], tangent[2]);
        outTx += skinnedTangent[0] * weight;
        outTy += skinnedTangent[1] * weight;
        outTz += skinnedTangent[2] * weight;
      }
    }

    writeVec3(positionOut.data, positionOut.offset + vertex * positionOut.stride, outPx, outPy, outPz);
    if (normalOut) writeVec3(normalOut.data, normalOut.offset + vertex * normalOut.stride, outNx, outNy, outNz);
    if (tangentOut) writeVec3(tangentOut.data, tangentOut.offset + vertex * tangentOut.stride, outTx, outTy, outTz);
  }

  const result: SkinningResult = {
    vertexCount,
    influences,
    issues,
    positions: positionOut.data
  };
  if (normalOut) result.normals = normalOut.data;
  if (tangentOut) result.tangents = tangentOut.data;
  return result;
}

function resolveJointMatrices(job: SkinningJob): readonly SkinningNumericArray[] {
  if (job.jointMatrices) return job.jointMatrices;
  if (job.modelMatrices && job.inverseBindMatrices) {
    return buildSkinningMatrixPalette(
      job.modelMatrices,
      job.inverseBindMatrices,
      job.jointRemaps ? { jointRemaps: job.jointRemaps } : {}
    );
  }
  return [IDENTITY_MAT4];
}

function readInfluenceWeight(
  job: SkinningJob,
  vertex: number,
  influence: number,
  influences: number,
  weightMode: SkinningWeightMode,
  weightOffset: number,
  weightStride: number,
  previousWeightSum: number
): number {
  if (influences === 1 && weightMode === "restored-last") return 1;
  if (weightMode === "restored-last" && influence === influences - 1) return 1 - previousWeightSum;
  const weightSlot = weightOffset + vertex * weightStride + influence;
  return finiteOr(job.jointWeights?.[weightSlot], 0);
}

function transformPointComponents(
  matrix: SkinningNumericArray,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  return [
    finiteOr(matrix[0], 0) * x + finiteOr(matrix[4], 0) * y + finiteOr(matrix[8], 0) * z + finiteOr(matrix[12], 0),
    finiteOr(matrix[1], 0) * x + finiteOr(matrix[5], 0) * y + finiteOr(matrix[9], 0) * z + finiteOr(matrix[13], 0),
    finiteOr(matrix[2], 0) * x + finiteOr(matrix[6], 0) * y + finiteOr(matrix[10], 0) * z + finiteOr(matrix[14], 0)
  ];
}

function transformVectorComponents(
  matrix: SkinningNumericArray,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  return [
    finiteOr(matrix[0], 0) * x + finiteOr(matrix[4], 0) * y + finiteOr(matrix[8], 0) * z,
    finiteOr(matrix[1], 0) * x + finiteOr(matrix[5], 0) * y + finiteOr(matrix[9], 0) * z,
    finiteOr(matrix[2], 0) * x + finiteOr(matrix[6], 0) * y + finiteOr(matrix[10], 0) * z
  ];
}

function validateAttributeInput(
  input: SkinningAttributeInput | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!input) return;
  if (!input.data || !Number.isInteger(input.data.length) || input.data.length < 0) {
    issues.push({ field, message: `skinning ${field} data must be an array-like numeric buffer` });
  }
  validateOffsetStride(input.offset, input.stride, field, issues);
}

function validateAttributeOutput(
  output: SkinningAttributeOutput | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!output) return;
  if (output.data && !Array.isArray(output.data) && !(output.data instanceof Float32Array)) {
    issues.push({ field, message: `skinning ${field} data must be a number array or Float32Array` });
  }
  validateOffsetStride(output.offset, output.stride, field, issues);
}

function validateAttributeBounds(
  input: SkinningAttributeInput | undefined,
  vertexCount: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!input || vertexCount <= 0) return;
  const resolved = resolveAttributeInput(input);
  if (inferVec3Count(resolved.data, resolved.offset, resolved.stride) < vertexCount) {
    issues.push({ field, message: `skinning ${field} data is shorter than vertexCount` });
  }
}

function validateOffsetStride(
  offset: number | undefined,
  stride: number | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    issues.push({ field, message: `skinning ${field} offset must be a non-negative integer` });
  }
  if (stride !== undefined && (!Number.isInteger(stride) || stride < 3)) {
    issues.push({ field, message: `skinning ${field} stride must be an integer of at least 3 components` });
  }
}

function validateIndexedBuffer(
  buffer: SkinningNumericArray | undefined,
  offset: number,
  stride: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (buffer === undefined) return;
  if (!Number.isInteger(buffer.length) || buffer.length < 0)
    issues.push({ field, message: `skinning ${field} must be array-like` });
  if (offset < 0) issues.push({ field, message: `skinning ${field} offset must be non-negative` });
  if (stride < 0) issues.push({ field, message: `skinning ${field} stride must be non-negative` });
}

function validateInfluenceBounds(
  buffer: SkinningNumericArray | undefined,
  vertexCount: number,
  requiredPerVertex: number,
  offset: number,
  stride: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!buffer || vertexCount <= 0 || requiredPerVertex <= 0) return;
  const requiredLength = offset + (vertexCount - 1) * stride + requiredPerVertex;
  if (buffer.length < requiredLength)
    issues.push({ field, message: `skinning ${field} data is shorter than vertexCount influences` });
}

function validateMatrixArray(
  matrices: readonly SkinningNumericArray[] | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!matrices) return;
  for (let index = 0; index < matrices.length; index += 1) {
    if (!isFiniteMat4(matrices[index])) {
      issues.push({ field, index, message: `skinning ${field} matrix ${index} must contain 16 finite values` });
    }
  }
}

function sanitizeVertexCount(value: number | undefined, positions: SkinningAttributeInput | undefined): number {
  if (value !== undefined) return Number.isInteger(value) && value > 0 ? value : 0;
  if (!positions) return 0;
  const input = resolveAttributeInput(positions);
  return inferVec3Count(input.data, input.offset, input.stride);
}

function inferVec3Count(data: SkinningNumericArray, offset: number, stride: number): number {
  if (!Number.isInteger(data.length) || data.length < offset + 3) return 0;
  return Math.max(0, Math.floor((data.length - offset - 3) / stride) + 1);
}

function resolveAttributeInput(input: SkinningAttributeInput): Required<SkinningAttributeInput> {
  return {
    data: input.data,
    offset: sanitizeNonNegativeInteger(input.offset, 0),
    stride: Math.max(3, sanitizePositiveInteger(input.stride, 3))
  };
}

function resolveAttributeOutput(
  output: SkinningAttributeOutput | undefined,
  vertexCount: number
): Required<SkinningAttributeOutput> {
  const offset = sanitizeNonNegativeInteger(output?.offset, 0);
  const stride = Math.max(3, sanitizePositiveInteger(output?.stride, 3));
  const requiredLength = vertexCount <= 0 ? offset : offset + (vertexCount - 1) * stride + 3;
  const reusable = output?.data;
  if (reusable && reusable.length >= requiredLength) return { data: reusable, offset, stride };
  return { data: new Float32Array(requiredLength), offset, stride };
}

function readVec3(data: SkinningNumericArray, offset: number): [number, number, number] {
  return [finiteOr(data[offset], 0), finiteOr(data[offset + 1], 0), finiteOr(data[offset + 2], 0)];
}

function writeVec3(data: SkinningMutableArray, offset: number, x: number, y: number, z: number): void {
  data[offset] = finiteOr(x, 0);
  data[offset + 1] = finiteOr(y, 0);
  data[offset + 2] = finiteOr(z, 0);
}

function sanitizePaletteIndex(value: number | undefined, paletteLength: number): number {
  if (paletteLength <= 0 || !Number.isInteger(value)) return 0;
  const index = value as number;
  if (index < 0 || index >= paletteLength) return 0;
  return index;
}
