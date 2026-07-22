import { type Mat4, multiplyMat4 } from "../../src/math.js";
import { cloneFiniteMat4, finiteOr, isFiniteMat4 } from "../../src/numeric-helpers.js";

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

type AttributeInputLayout = Required<SkinningAttributeInput>;
type AttributeOutputLayout = Required<SkinningAttributeOutput>;

type SkinningInputSnapshots = {
  positions?: number[];
  normals?: number[];
  tangents?: number[];
  jointIndices?: number[];
  jointWeights?: number[];
};

const IDENTITY_MAT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) as Mat4;
const MAX_SKINNING_INFLUENCES = 256;
const MAX_SKINNING_OUTPUT_COMPONENTS = 16_777_216;
const MAX_SKINNING_VALIDATION_COMPONENTS = 1_000_000;
const MAX_SKINNING_REPORTED_INDEX_ISSUES = 16;
const MAX_SKINNING_PALETTE_MATRICES = 65_536;

export function validateSkinningJob(job: SkinningJob): SkinningValidationIssue[] {
  const issues: SkinningValidationIssue[] = [];
  const influences = sanitizeInfluenceCount(job.influences);
  const vertexCount = sanitizeRequestedVertexCount(job.vertexCount, job.positions);
  const weightMode = job.weightMode ?? "restored-last";

  if (job.vertexCount !== undefined && (!Number.isSafeInteger(job.vertexCount) || job.vertexCount < 0)) {
    issues.push({ field: "vertexCount", message: "skinning vertexCount must be a non-negative safe integer" });
  }
  if (
    job.influences !== undefined &&
    (!Number.isSafeInteger(job.influences) || job.influences <= 0 || job.influences > MAX_SKINNING_INFLUENCES)
  ) {
    issues.push({
      field: "influences",
      message: `skinning influences must be a positive safe integer no greater than ${MAX_SKINNING_INFLUENCES}`
    });
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
  validateAttributeOutputBounds(job.outPositions, vertexCount, "outPositions", issues);
  validateAttributeOutputBounds(job.outNormals, job.normals ? vertexCount : 0, "outNormals", issues);
  validateAttributeOutputBounds(job.outTangents, job.tangents && job.normals ? vertexCount : 0, "outTangents", issues);
  validateAttributeValues(job.positions, vertexCount, "positions", issues);
  validateAttributeValues(job.normals, vertexCount, "normals", issues);
  validateAttributeValues(job.tangents, vertexCount, "tangents", issues);

  if (weightMode !== "restored-last" && weightMode !== "explicit") {
    issues.push({ field: "weightMode", message: "skinning weightMode must be restored-last or explicit" });
  }
  validateIndexedLayout(job.jointIndexOffset, job.jointIndexStride, 1, "jointIndices", issues);
  validateIndexedLayout(job.jointWeightOffset, job.jointWeightStride, 0, "jointWeights", issues);
  if (job.jointIndices === undefined && vertexCount > 0) {
    issues.push({
      field: "jointIndices",
      message: "skinning joint indices are missing; joint 0 fallback will be used"
    });
  } else {
    validateIndexedBuffer(
      job.jointIndices,
      sanitizeSafeNonNegativeInteger(job.jointIndexOffset, 0),
      sanitizeSafePositiveInteger(job.jointIndexStride, influences),
      "jointIndices",
      issues
    );
    validateInfluenceBounds(
      job.jointIndices,
      vertexCount,
      influences,
      sanitizeSafeNonNegativeInteger(job.jointIndexOffset, 0),
      sanitizeSafePositiveInteger(job.jointIndexStride, influences),
      "jointIndices",
      issues
    );
  }
  if (influences > 1 || weightMode === "explicit") {
    const defaultWeightStride = weightMode === "explicit" ? influences : Math.max(0, influences - 1);
    if (job.jointWeights === undefined && vertexCount > 0) {
      issues.push({
        field: "jointWeights",
        message: "skinning joint weights are missing; fallback weights will be used"
      });
    }
    validateIndexedBuffer(
      job.jointWeights,
      sanitizeSafeNonNegativeInteger(job.jointWeightOffset, 0),
      sanitizeSafeNonNegativeInteger(job.jointWeightStride, defaultWeightStride),
      "jointWeights",
      issues
    );
    validateInfluenceBounds(
      job.jointWeights,
      vertexCount,
      defaultWeightStride,
      sanitizeSafeNonNegativeInteger(job.jointWeightOffset, 0),
      sanitizeSafeNonNegativeInteger(job.jointWeightStride, defaultWeightStride),
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
  if (job.modelMatrices !== undefined && job.inverseBindMatrices !== undefined) {
    if (job.jointRemaps === undefined && job.inverseBindMatrices.length !== job.modelMatrices.length) {
      issues.push({
        field: "inverseBindMatrices",
        message: "skinning model and inverse bind palettes must have equal lengths when no joint remap is provided"
      });
    }
    if (job.jointRemaps !== undefined) {
      if (job.jointRemaps.length !== job.inverseBindMatrices.length) {
        issues.push({
          field: "jointRemaps",
          message: "skinning joint remap and inverse bind palettes must have equal lengths"
        });
      }
      validateJointRemaps(job.jointRemaps, Math.min(job.modelMatrices.length, MAX_SKINNING_PALETTE_MATRICES), issues);
    }
  } else if (job.jointRemaps !== undefined) {
    issues.push({ field: "jointRemaps", message: "skinning joint remaps require model and inverse bind palettes" });
  }
  const resolvedPaletteLength = resolveValidationPaletteLength(job);
  if (
    job.jointInverseTransposeMatrices !== undefined &&
    job.jointInverseTransposeMatrices.length !== 0 &&
    job.jointInverseTransposeMatrices.length < resolvedPaletteLength
  ) {
    issues.push({
      field: "jointInverseTransposeMatrices",
      message: "skinning inverse-transpose palette is shorter than the joint matrix palette"
    });
  }
  validateJointIndices(job, vertexCount, influences, resolvedPaletteLength, issues);
  validateJointWeights(job, vertexCount, influences, weightMode, issues);
  validateOutputOverlap(
    job,
    sanitizeVertexCount(job.vertexCount, job.positions, [
      job.outPositions,
      job.normals ? job.outNormals : undefined,
      job.tangents && job.normals ? job.outTangents : undefined
    ]),
    issues
  );
  return issues;
}

export function buildSkinningMatrixPalette(
  modelMatrices: readonly SkinningNumericArray[],
  inverseBindMatrices: readonly SkinningNumericArray[],
  options: SkinningMatrixPaletteOptions = {}
): Mat4[] {
  const paletteCount = options.jointRemaps
    ? Math.min(safeArrayLength(options.jointRemaps), inverseBindMatrices.length, MAX_SKINNING_PALETTE_MATRICES)
    : Math.min(modelMatrices.length, inverseBindMatrices.length, MAX_SKINNING_PALETTE_MATRICES);
  const modelSnapshot = modelMatrices
    .slice(0, MAX_SKINNING_PALETTE_MATRICES)
    .map((matrix) => cloneExactFiniteMat4(matrix));
  const inverseBindSnapshot = inverseBindMatrices.slice(0, paletteCount).map((matrix) => cloneExactFiniteMat4(matrix));
  const remapSnapshot = options.jointRemaps ? snapshotNumericArray(options.jointRemaps, paletteCount) : undefined;
  const out = options.out ?? [];
  out.length = paletteCount;
  for (let index = 0; index < paletteCount; index += 1) {
    const modelIndex = remapSnapshot ? sanitizePaletteIndex(remapSnapshot[index], modelSnapshot.length) : index;
    const model = modelSnapshot[modelIndex] ?? IDENTITY_MAT4;
    const inverseBind = inverseBindSnapshot[index] ?? IDENTITY_MAT4;
    out[index] = cloneExactFiniteMat4(multiplyMat4(model, inverseBind));
  }
  return out;
}

export function skinVertices(job: SkinningJob): SkinningResult {
  const issues = validateSkinningJob(job);
  const influences = sanitizeInfluenceCount(job.influences);
  const vertexCount = sanitizeVertexCount(job.vertexCount, job.positions, [
    job.outPositions,
    job.normals ? job.outNormals : undefined,
    job.tangents && job.normals ? job.outTangents : undefined
  ]);
  const weightMode = job.weightMode === "explicit" ? "explicit" : "restored-last";
  const jointMatrices = resolveJointMatrices(job);
  const vectorMatrices = job.jointInverseTransposeMatrices
    ?.slice(0, jointMatrices.length)
    .map((matrix, index) => cloneExactFiniteMat4(matrix, jointMatrices[index]));
  const positionsInput = job.positions ?? { data: [] };
  const positionIn = resolveAttributeInput(positionsInput);
  const normalIn = job.normals ? resolveAttributeInput(job.normals) : null;
  const tangentIn = job.tangents && normalIn ? resolveAttributeInput(job.tangents) : null;
  const positionOut = resolveAttributeOutput(job.outPositions, vertexCount);
  let normalOut = normalIn ? resolveAttributeOutput(job.outNormals, vertexCount) : null;
  let tangentOut = tangentIn ? resolveAttributeOutput(job.outTangents, vertexCount) : null;
  if (normalOut && outputRegionsOverlap(positionOut, normalOut, vertexCount)) {
    normalOut = allocateAttributeOutput(job.outNormals, vertexCount);
  }
  if (
    tangentOut &&
    (outputRegionsOverlap(positionOut, tangentOut, vertexCount) ||
      (normalOut !== null && outputRegionsOverlap(normalOut, tangentOut, vertexCount)))
  ) {
    tangentOut = allocateAttributeOutput(job.outTangents, vertexCount);
  }
  const jointIndexOffset = sanitizeSafeNonNegativeInteger(job.jointIndexOffset, 0);
  const jointIndexStride = sanitizeSafePositiveInteger(job.jointIndexStride, influences);
  const defaultWeightStride = weightMode === "explicit" ? influences : Math.max(0, influences - 1);
  const jointWeightOffset = sanitizeSafeNonNegativeInteger(job.jointWeightOffset, 0);
  const jointWeightStride = sanitizeSafeNonNegativeInteger(job.jointWeightStride, defaultWeightStride);
  const snapshots = snapshotAliasedInputs(job, vertexCount, positionOut, normalOut, tangentOut);
  const jointIndexData = snapshots.jointIndices ?? job.jointIndices;
  const jointWeightData = snapshots.jointWeights ?? job.jointWeights;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const inputPositionBase = positionIn.offset + vertex * positionIn.stride;
    const position = readVec3(snapshots.positions ?? positionIn.data, inputPositionBase);
    const normal = normalIn
      ? readVec3(snapshots.normals ?? normalIn.data, normalIn.offset + vertex * normalIn.stride)
      : null;
    const tangent = tangentIn
      ? readVec3(snapshots.tangents ?? tangentIn.data, tangentIn.offset + vertex * tangentIn.stride)
      : null;
    let outPx = 0;
    let outPy = 0;
    let outPz = 0;
    let outNx = 0;
    let outNy = 0;
    let outNz = 0;
    let outTx = 0;
    let outTy = 0;
    let outTz = 0;
    const weights = resolveInfluenceWeights(
      jointWeightData,
      vertex,
      influences,
      weightMode,
      jointWeightOffset,
      jointWeightStride
    );

    for (let influence = 0; influence < influences; influence += 1) {
      const jointSlot = jointIndexOffset + vertex * jointIndexStride + influence;
      const jointIndex = sanitizePaletteIndex(jointIndexData?.[jointSlot], jointMatrices.length);
      const weight = weights[influence]!;
      if (weight === 0) continue;

      const matrix = jointMatrices[jointIndex] ?? IDENTITY_MAT4;
      const skinnedPosition = transformPointComponents(matrix, position[0], position[1], position[2]);
      outPx += skinnedPosition[0] * weight;
      outPy += skinnedPosition[1] * weight;
      outPz += skinnedPosition[2] * weight;

      if (normal) {
        const vectorMatrix = vectorMatrices?.[jointIndex] ?? matrix;
        const skinnedNormal = transformVectorComponents(vectorMatrix, normal[0], normal[1], normal[2]);
        outNx += skinnedNormal[0] * weight;
        outNy += skinnedNormal[1] * weight;
        outNz += skinnedNormal[2] * weight;
      }
      if (tangent) {
        const vectorMatrix = vectorMatrices?.[jointIndex] ?? matrix;
        const skinnedTangent = transformVectorComponents(vectorMatrix, tangent[0], tangent[1], tangent[2]);
        outTx += skinnedTangent[0] * weight;
        outTy += skinnedTangent[1] * weight;
        outTz += skinnedTangent[2] * weight;
      }
    }

    writeFiniteResultVec3(
      positionOut.data,
      positionOut.offset + vertex * positionOut.stride,
      outPx,
      outPy,
      outPz,
      "positions",
      vertex,
      issues
    );
    if (normalOut) {
      writeFiniteResultVec3(
        normalOut.data,
        normalOut.offset + vertex * normalOut.stride,
        outNx,
        outNy,
        outNz,
        "normals",
        vertex,
        issues
      );
    }
    if (tangentOut) {
      writeFiniteResultVec3(
        tangentOut.data,
        tangentOut.offset + vertex * tangentOut.stride,
        outTx,
        outTy,
        outTz,
        "tangents",
        vertex,
        issues
      );
    }
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

function resolveJointMatrices(job: SkinningJob): Mat4[] {
  if (job.jointMatrices?.length) {
    return job.jointMatrices.slice(0, MAX_SKINNING_PALETTE_MATRICES).map((matrix) => cloneExactFiniteMat4(matrix));
  }
  if (job.modelMatrices && job.inverseBindMatrices) {
    const palette = buildSkinningMatrixPalette(
      job.modelMatrices,
      job.inverseBindMatrices,
      job.jointRemaps ? { jointRemaps: job.jointRemaps } : {}
    );
    return palette.length > 0 ? palette : [new Float32Array(IDENTITY_MAT4)];
  }
  return [new Float32Array(IDENTITY_MAT4)];
}

function resolveInfluenceWeights(
  weights: SkinningNumericArray | undefined,
  vertex: number,
  influences: number,
  weightMode: SkinningWeightMode,
  weightOffset: number,
  weightStride: number
): number[] {
  if (influences === 1 && weightMode === "restored-last") return [1];
  const resolved = new Array<number>(influences).fill(0);
  const storedCount = weightMode === "explicit" ? influences : influences - 1;
  let sum = 0;
  for (let influence = 0; influence < storedCount; influence += 1) {
    const weightSlot = weightOffset + vertex * weightStride + influence;
    const candidate = Math.min(1, Math.max(0, finiteOr(weights?.[weightSlot], 0)));
    const weight = weightMode === "restored-last" ? Math.min(candidate, Math.max(0, 1 - sum)) : candidate;
    resolved[influence] = weight;
    sum += weight;
  }
  if (weightMode === "restored-last") {
    resolved[influences - 1] = Math.max(0, 1 - sum);
  } else if (sum > 1) {
    for (let influence = 0; influence < influences; influence += 1) {
      resolved[influence] = resolved[influence]! / sum;
    }
  } else if (sum <= 0) {
    resolved[0] = 1;
  }
  return resolved;
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
  if (!isSafeArrayLike(input.data)) {
    issues.push({ field, message: `skinning ${field} data must be an array-like numeric buffer with safe length` });
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

function validateAttributeOutputBounds(
  output: SkinningAttributeOutput | undefined,
  vertexCount: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!output || vertexCount <= 0) return;
  const offset = sanitizeSafeNonNegativeInteger(output.offset, 0);
  const stride = Math.max(3, sanitizeSafePositiveInteger(output.stride, 3));
  const requiredLength = safeRequiredLength(vertexCount, offset, stride, 3);
  if (requiredLength === null || requiredLength > MAX_SKINNING_OUTPUT_COMPONENTS) {
    issues.push({ field, message: `skinning ${field} layout exceeds the bounded output allocation limit` });
  } else if (output.data && safeArrayLength(output.data) < requiredLength) {
    issues.push({ field, message: `skinning ${field} data is shorter than vertexCount` });
  }
}

function validateAttributeValues(
  input: SkinningAttributeInput | undefined,
  vertexCount: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!input || vertexCount <= 0) return;
  const resolved = resolveAttributeInput(input);
  const count = Math.min(
    vertexCount,
    inferVec3Count(resolved.data, resolved.offset, resolved.stride),
    Math.floor(MAX_SKINNING_VALIDATION_COMPONENTS / 3)
  );
  let reported = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const base = resolved.offset + vertex * resolved.stride;
    if (
      !Number.isFinite(resolved.data[base]) ||
      !Number.isFinite(resolved.data[base + 1]) ||
      !Number.isFinite(resolved.data[base + 2])
    ) {
      issues.push({ field, index: vertex, message: `skinning ${field} vertex ${vertex} contains non-finite values` });
      reported += 1;
      if (reported >= MAX_SKINNING_REPORTED_INDEX_ISSUES) break;
    }
  }
}

function validateOffsetStride(
  offset: number | undefined,
  stride: number | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) {
    issues.push({ field, message: `skinning ${field} offset must be a non-negative safe integer` });
  }
  if (stride !== undefined && (!Number.isSafeInteger(stride) || stride < 3)) {
    issues.push({ field, message: `skinning ${field} stride must be a safe integer of at least 3 components` });
  }
}

function validateIndexedLayout(
  offset: number | undefined,
  stride: number | undefined,
  minStride: number,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) {
    issues.push({ field, message: `skinning ${field} offset must be a non-negative safe integer` });
  }
  if (stride !== undefined && (!Number.isSafeInteger(stride) || stride < minStride)) {
    issues.push({ field, message: `skinning ${field} stride must be a safe integer of at least ${minStride}` });
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
  if (!isSafeArrayLike(buffer))
    issues.push({ field, message: `skinning ${field} must be array-like with safe length` });
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
  const requiredLength = safeRequiredLength(vertexCount, offset, stride, requiredPerVertex);
  if (requiredLength === null || safeArrayLength(buffer) < requiredLength) {
    issues.push({ field, message: `skinning ${field} data is shorter than vertexCount influences` });
  }
}

function validateMatrixArray(
  matrices: readonly SkinningNumericArray[] | undefined,
  field: string,
  issues: SkinningValidationIssue[]
): void {
  if (!matrices) return;
  if (matrices.length > MAX_SKINNING_PALETTE_MATRICES) {
    issues.push({
      field,
      message: `skinning ${field} exceeds the ${MAX_SKINNING_PALETTE_MATRICES}-matrix palette limit`
    });
  }
  let reported = 0;
  for (let index = 0; index < Math.min(matrices.length, MAX_SKINNING_PALETTE_MATRICES); index += 1) {
    if (!isExactFiniteMat4(matrices[index])) {
      issues.push({ field, index, message: `skinning ${field} matrix ${index} must contain 16 finite values` });
      reported += 1;
      if (reported >= MAX_SKINNING_REPORTED_INDEX_ISSUES) break;
    }
  }
}

function validateJointRemaps(
  remaps: SkinningNumericArray,
  modelPaletteLength: number,
  issues: SkinningValidationIssue[]
): void {
  const count = Math.min(safeArrayLength(remaps), MAX_SKINNING_VALIDATION_COMPONENTS);
  let reported = 0;
  for (let index = 0; index < count && reported < MAX_SKINNING_REPORTED_INDEX_ISSUES; index += 1) {
    const remap = remaps[index] ?? Number.NaN;
    if (!Number.isSafeInteger(remap) || remap < 0 || remap >= modelPaletteLength) {
      issues.push({
        field: "jointRemaps",
        index,
        message: `skinning joint remap ${index} must reference a model matrix`
      });
      reported += 1;
    }
  }
}

function validateJointIndices(
  job: SkinningJob,
  vertexCount: number,
  influences: number,
  paletteLength: number,
  issues: SkinningValidationIssue[]
): void {
  if (!job.jointIndices || vertexCount <= 0 || influences <= 0 || paletteLength <= 0) return;
  const offset = sanitizeSafeNonNegativeInteger(job.jointIndexOffset, 0);
  const stride = sanitizeSafePositiveInteger(job.jointIndexStride, influences);
  const maxVerticesByBuffer = inferIndexedVertexCount(job.jointIndices, offset, stride, influences);
  const maxVerticesByValidation = Math.max(1, Math.floor(MAX_SKINNING_VALIDATION_COMPONENTS / influences));
  const count = Math.min(vertexCount, maxVerticesByBuffer, maxVerticesByValidation);
  let reported = 0;
  for (let vertex = 0; vertex < count && reported < MAX_SKINNING_REPORTED_INDEX_ISSUES; vertex += 1) {
    for (let influence = 0; influence < influences && reported < MAX_SKINNING_REPORTED_INDEX_ISSUES; influence += 1) {
      const slot = offset + vertex * stride + influence;
      const jointIndex = job.jointIndices[slot] ?? Number.NaN;
      if (!Number.isSafeInteger(jointIndex) || jointIndex < 0 || jointIndex >= paletteLength) {
        issues.push({
          field: "jointIndices",
          index: slot,
          message: `skinning joint index at component ${slot} will fall back to joint 0`
        });
        reported += 1;
      }
    }
  }
}

function validateJointWeights(
  job: SkinningJob,
  vertexCount: number,
  influences: number,
  weightMode: SkinningWeightMode,
  issues: SkinningValidationIssue[]
): void {
  if (!job.jointWeights || vertexCount <= 0 || influences <= 0) return;
  const storedCount = weightMode === "explicit" ? influences : influences - 1;
  if (storedCount <= 0) return;
  const offset = sanitizeSafeNonNegativeInteger(job.jointWeightOffset, 0);
  const stride = sanitizeSafeNonNegativeInteger(job.jointWeightStride, storedCount);
  const maxVerticesByBuffer = inferIndexedVertexCount(job.jointWeights, offset, stride, storedCount);
  const maxVerticesByValidation = Math.max(1, Math.floor(MAX_SKINNING_VALIDATION_COMPONENTS / storedCount));
  const count = Math.min(vertexCount, maxVerticesByBuffer, maxVerticesByValidation);
  let reported = 0;
  for (let vertex = 0; vertex < count && reported < MAX_SKINNING_REPORTED_INDEX_ISSUES; vertex += 1) {
    let sum = 0;
    for (let influence = 0; influence < storedCount && reported < MAX_SKINNING_REPORTED_INDEX_ISSUES; influence += 1) {
      const slot = offset + vertex * stride + influence;
      const weight = job.jointWeights[slot] ?? Number.NaN;
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        issues.push({
          field: "jointWeights",
          index: slot,
          message: `skinning joint weight at component ${slot} must be finite and normalized`
        });
        reported += 1;
      }
      sum += finiteOr(weight, 0);
    }
    if (reported < MAX_SKINNING_REPORTED_INDEX_ISSUES) {
      if (weightMode === "restored-last" && sum > 1) {
        issues.push({
          field: "jointWeights",
          index: offset + vertex * stride,
          message: `skinning restored-last weights for vertex ${vertex} exceed 1 and will be clamped`
        });
        reported += 1;
      } else if (weightMode === "explicit" && sum <= 0) {
        issues.push({
          field: "jointWeights",
          index: offset + vertex * stride,
          message: `skinning explicit weights for vertex ${vertex} sum to zero and will use joint 0 fallback`
        });
        reported += 1;
      } else if (weightMode === "explicit" && sum > 1) {
        issues.push({
          field: "jointWeights",
          index: offset + vertex * stride,
          message: `skinning explicit weights for vertex ${vertex} exceed 1 and will be normalized`
        });
        reported += 1;
      }
    }
  }
}

function validateOutputOverlap(job: SkinningJob, vertexCount: number, issues: SkinningValidationIssue[]): void {
  if (vertexCount <= 0) return;
  const positionOut = reusableOutputLayout(job.outPositions, vertexCount);
  const normalOut = job.normals && job.outNormals ? reusableOutputLayout(job.outNormals, vertexCount) : undefined;
  const tangentOut =
    job.tangents && job.normals && job.outTangents ? reusableOutputLayout(job.outTangents, vertexCount) : undefined;
  if (positionOut && normalOut && outputRegionsOverlap(positionOut, normalOut, vertexCount)) {
    issues.push({
      field: "outNormals",
      message: "skinning normal output overlaps position output; separate fallback will be used"
    });
  }
  if (
    tangentOut &&
    ((positionOut && outputRegionsOverlap(positionOut, tangentOut, vertexCount)) ||
      (normalOut && outputRegionsOverlap(normalOut, tangentOut, vertexCount)))
  ) {
    issues.push({
      field: "outTangents",
      message: "skinning tangent output overlaps another output; separate fallback will be used"
    });
  }
}

function reusableOutputLayout(
  output: SkinningAttributeOutput | undefined,
  vertexCount: number
): AttributeOutputLayout | undefined {
  if (!output?.data) return undefined;
  const layout = resolveAttributeOutputLayout(output);
  const requiredLength = safeRequiredLength(vertexCount, layout.offset, layout.stride, 3);
  if (requiredLength === null || safeArrayLength(output.data) < requiredLength) return undefined;
  return { data: output.data, ...layout };
}

function resolveValidationPaletteLength(job: SkinningJob): number {
  if (job.jointMatrices && job.jointMatrices.length > 0) {
    return Math.max(1, Math.min(job.jointMatrices.length, MAX_SKINNING_PALETTE_MATRICES));
  }
  if (job.modelMatrices !== undefined && job.inverseBindMatrices !== undefined) {
    const count = job.jointRemaps
      ? Math.min(safeArrayLength(job.jointRemaps), job.inverseBindMatrices.length)
      : Math.min(job.modelMatrices.length, job.inverseBindMatrices.length);
    return Math.max(1, Math.min(count, MAX_SKINNING_PALETTE_MATRICES));
  }
  return 1;
}

function sanitizeVertexCount(
  value: number | undefined,
  positions: SkinningAttributeInput | undefined,
  outputs: readonly (SkinningAttributeOutput | undefined)[] = []
): number {
  if (!positions) return 0;
  const inferred = inferVec3CountFromAttribute(positions);
  const requested = value !== undefined ? (Number.isSafeInteger(value) && value > 0 ? value : 0) : inferred;
  let count = Math.min(requested, inferred, maxVertexCountForOutputAllocation());
  for (const output of outputs) {
    count = Math.min(count, maxVertexCountForOutputAllocation(output));
  }
  return count;
}

function sanitizeRequestedVertexCount(
  value: number | undefined,
  positions: SkinningAttributeInput | undefined
): number {
  if (value !== undefined) return Number.isSafeInteger(value) && value > 0 ? value : 0;
  if (!positions) return 0;
  return inferVec3CountFromAttribute(positions);
}

function sanitizeInfluenceCount(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value! <= 0) return 1;
  return Math.min(value!, MAX_SKINNING_INFLUENCES);
}

function inferVec3CountFromAttribute(input: SkinningAttributeInput): number {
  const resolved = resolveAttributeInput(input);
  return inferVec3Count(resolved.data, resolved.offset, resolved.stride);
}

function inferVec3Count(data: SkinningNumericArray, offset: number, stride: number): number {
  const length = safeArrayLength(data);
  if (length < offset + 3 || stride <= 0) return 0;
  return Math.max(0, Math.floor((length - offset - 3) / stride) + 1);
}

function inferIndexedVertexCount(
  data: SkinningNumericArray,
  offset: number,
  stride: number,
  requiredPerVertex: number
): number {
  const length = safeArrayLength(data);
  if (requiredPerVertex <= 0) return Number.MAX_SAFE_INTEGER;
  if (length < offset + requiredPerVertex || stride < 0) return 0;
  if (stride === 0) return 1;
  return Math.max(0, Math.floor((length - offset - requiredPerVertex) / stride) + 1);
}

function resolveAttributeInput(input: SkinningAttributeInput): AttributeInputLayout {
  return {
    data: input.data,
    offset: sanitizeSafeNonNegativeInteger(input.offset, 0),
    stride: Math.max(3, sanitizeSafePositiveInteger(input.stride, 3))
  };
}

function resolveAttributeOutput(
  output: SkinningAttributeOutput | undefined,
  vertexCount: number
): AttributeOutputLayout {
  const resolved = resolveAttributeOutputLayout(output);
  if (vertexCount <= 0) {
    if (output?.data) return { ...resolved, data: output.data };
    return { ...resolved, data: new Float32Array(0) };
  }
  const requiredLength = safeRequiredLength(vertexCount, resolved.offset, resolved.stride, 3);
  const boundedRequiredLength = requiredLength === null ? 0 : Math.min(requiredLength, MAX_SKINNING_OUTPUT_COMPONENTS);
  const reusable = output?.data;
  if (reusable && safeArrayLength(reusable) >= boundedRequiredLength) return { ...resolved, data: reusable };
  return { ...resolved, data: new Float32Array(boundedRequiredLength) };
}

function resolveAttributeOutputLayout(
  output: SkinningAttributeOutput | undefined
): Omit<AttributeOutputLayout, "data"> {
  return {
    offset: sanitizeSafeNonNegativeInteger(output?.offset, 0),
    stride: Math.max(3, sanitizeSafePositiveInteger(output?.stride, 3))
  };
}

function allocateAttributeOutput(
  output: SkinningAttributeOutput | undefined,
  vertexCount: number
): AttributeOutputLayout {
  const layout = resolveAttributeOutputLayout(output);
  if (vertexCount <= 0) return { ...layout, data: new Float32Array(0) };
  const requiredLength = safeRequiredLength(vertexCount, layout.offset, layout.stride, 3);
  const boundedRequiredLength = requiredLength === null ? 0 : Math.min(requiredLength, MAX_SKINNING_OUTPUT_COMPONENTS);
  return { ...layout, data: new Float32Array(boundedRequiredLength) };
}

function readVec3(data: SkinningNumericArray, offset: number): [number, number, number] {
  return [finiteOr(data[offset], 0), finiteOr(data[offset + 1], 0), finiteOr(data[offset + 2], 0)];
}

function writeFiniteResultVec3(
  data: SkinningMutableArray,
  offset: number,
  x: number,
  y: number,
  z: number,
  field: string,
  vertex: number,
  issues: SkinningValidationIssue[]
): void {
  const repairedX = finiteOutputComponent(data, x);
  const repairedY = finiteOutputComponent(data, y);
  const repairedZ = finiteOutputComponent(data, z);
  if (repairedX !== x || repairedY !== y || repairedZ !== z) {
    issues.push({ field, index: vertex, message: `skinning ${field} vertex ${vertex} produced out-of-range values` });
  }
  data[offset] = repairedX;
  data[offset + 1] = repairedY;
  data[offset + 2] = repairedZ;
}

function finiteOutputComponent(data: SkinningMutableArray, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return data instanceof Float32Array && !Number.isFinite(Math.fround(value)) ? 0 : value;
}

function sanitizePaletteIndex(value: number | undefined, paletteLength: number): number {
  if (paletteLength <= 0 || !Number.isSafeInteger(value)) return 0;
  const index = value as number;
  if (index < 0 || index >= paletteLength) return 0;
  return index;
}

function cloneExactFiniteMat4(matrix: SkinningNumericArray | undefined, fallback?: SkinningNumericArray): Mat4 {
  if (isExactFiniteMat4(matrix)) {
    const clone = cloneFiniteMat4(matrix);
    if (isFiniteMat4(clone)) return clone;
  }
  if (isExactFiniteMat4(fallback)) {
    const clone = cloneFiniteMat4(fallback);
    if (isFiniteMat4(clone)) return clone;
  }
  return new Float32Array(IDENTITY_MAT4);
}

function isExactFiniteMat4(matrix: SkinningNumericArray | undefined): matrix is SkinningNumericArray {
  if (matrix?.length !== 16) return false;
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(matrix[index]) || !Number.isFinite(Math.fround(matrix[index]!))) return false;
  }
  return true;
}

function snapshotAliasedInputs(
  job: SkinningJob,
  vertexCount: number,
  positionOut: AttributeOutputLayout,
  normalOut: AttributeOutputLayout | null,
  tangentOut: AttributeOutputLayout | null
): SkinningInputSnapshots {
  const snapshots: SkinningInputSnapshots = {};
  const outputs = [positionOut, normalOut, tangentOut].filter(
    (output): output is AttributeOutputLayout => output !== null
  );
  if (job.positions) {
    const input = resolveAttributeInput(job.positions);
    if (outputs.some((output) => inputOverlapsOutput(input, output, vertexCount))) {
      snapshots.positions = snapshotAttributeInputData(input, vertexCount);
    }
  }
  if (job.normals) {
    const input = resolveAttributeInput(job.normals);
    if (outputs.some((output) => inputOverlapsOutput(input, output, vertexCount))) {
      snapshots.normals = snapshotAttributeInputData(input, vertexCount);
    }
  }
  if (job.tangents) {
    const input = resolveAttributeInput(job.tangents);
    if (outputs.some((output) => inputOverlapsOutput(input, output, vertexCount))) {
      snapshots.tangents = snapshotAttributeInputData(input, vertexCount);
    }
  }
  const jointIndexOffset = sanitizeSafeNonNegativeInteger(job.jointIndexOffset, 0);
  const influences = sanitizeInfluenceCount(job.influences);
  const jointIndexStride = sanitizeSafePositiveInteger(job.jointIndexStride, influences);
  if (
    job.jointIndices &&
    outputs.some((output) =>
      indexedInputOverlapsOutput(job.jointIndices!, jointIndexOffset, jointIndexStride, influences, vertexCount, output)
    )
  ) {
    snapshots.jointIndices = snapshotIndexedInputData(
      job.jointIndices,
      jointIndexOffset,
      jointIndexStride,
      influences,
      vertexCount
    );
  }
  const weightMode = job.weightMode === "explicit" ? "explicit" : "restored-last";
  const storedWeightCount = weightMode === "explicit" ? influences : Math.max(0, influences - 1);
  const jointWeightOffset = sanitizeSafeNonNegativeInteger(job.jointWeightOffset, 0);
  const jointWeightStride = sanitizeSafeNonNegativeInteger(job.jointWeightStride, storedWeightCount);
  if (
    job.jointWeights &&
    outputs.some((output) =>
      indexedInputOverlapsOutput(
        job.jointWeights!,
        jointWeightOffset,
        jointWeightStride,
        storedWeightCount,
        vertexCount,
        output
      )
    )
  ) {
    snapshots.jointWeights = snapshotIndexedInputData(
      job.jointWeights,
      jointWeightOffset,
      jointWeightStride,
      storedWeightCount,
      vertexCount
    );
  }
  return snapshots;
}

function snapshotAttributeInputData(input: AttributeInputLayout, vertexCount: number): number[] {
  const requiredLength = safeRequiredLength(vertexCount, input.offset, input.stride, 3);
  const length = Math.min(safeArrayLength(input.data), requiredLength ?? 0, MAX_SKINNING_OUTPUT_COMPONENTS);
  return snapshotNumericArray(input.data, length);
}

function snapshotIndexedInputData(
  input: SkinningNumericArray,
  offset: number,
  stride: number,
  requiredPerVertex: number,
  vertexCount: number
): number[] {
  const requiredLength = safeRequiredLength(vertexCount, offset, stride, requiredPerVertex);
  const length = Math.min(safeArrayLength(input), requiredLength ?? 0, MAX_SKINNING_OUTPUT_COMPONENTS);
  return snapshotNumericArray(input, length);
}

function snapshotNumericArray(input: SkinningNumericArray, maxLength = safeArrayLength(input)): number[] {
  const length = Math.min(safeArrayLength(input), maxLength, MAX_SKINNING_OUTPUT_COMPONENTS);
  const snapshot = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    snapshot[index] = input[index] ?? Number.NaN;
  }
  return snapshot;
}

function inputOverlapsOutput(input: AttributeInputLayout, output: AttributeOutputLayout, vertexCount: number): boolean {
  return stridedStorageOverlap(
    input.data,
    input.offset,
    input.stride,
    3,
    output.data,
    output.offset,
    output.stride,
    3,
    vertexCount
  );
}

function indexedInputOverlapsOutput(
  input: SkinningNumericArray,
  offset: number,
  stride: number,
  requiredPerVertex: number,
  vertexCount: number,
  output: AttributeOutputLayout
): boolean {
  return stridedStorageOverlap(
    input,
    offset,
    stride,
    requiredPerVertex,
    output.data,
    output.offset,
    output.stride,
    3,
    vertexCount
  );
}

function outputRegionsOverlap(a: AttributeOutputLayout, b: AttributeOutputLayout, vertexCount: number): boolean {
  return stridedStorageOverlap(a.data, a.offset, a.stride, 3, b.data, b.offset, b.stride, 3, vertexCount);
}

function stridedStorageOverlap(
  a: SkinningNumericArray,
  aOffset: number,
  aStride: number,
  aWidth: number,
  b: SkinningNumericArray,
  bOffset: number,
  bStride: number,
  bWidth: number,
  vertexCount: number
): boolean {
  if (vertexCount <= 0 || aWidth <= 0 || bWidth <= 0) return false;
  let aBase = 0;
  let bBase = 0;
  let aElementBytes = 1;
  let bElementBytes = 1;
  if (a !== b) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.buffer !== b.buffer) return false;
    aBase = a.byteOffset;
    bBase = b.byteOffset;
    aElementBytes = "BYTES_PER_ELEMENT" in a ? Number(a.BYTES_PER_ELEMENT) : 1;
    bElementBytes = "BYTES_PER_ELEMENT" in b ? Number(b.BYTES_PER_ELEMENT) : 1;
  }
  const firstA = aBase + aOffset * aElementBytes;
  const firstB = bBase + bOffset * bElementBytes;
  const stepA = aStride * aElementBytes;
  const stepB = bStride * bElementBytes;
  const widthA = aWidth * aElementBytes;
  const widthB = bWidth * bElementBytes;
  if (stepA === 0 && stepB === 0) return intervalsOverlap(firstA, widthA, firstB, widthB);
  if (stepA === 0) return repeatedIntervalOverlaps(firstA, widthA, firstB, stepB, widthB, vertexCount);
  if (stepB === 0) return repeatedIntervalOverlaps(firstB, widthB, firstA, stepA, widthA, vertexCount);
  let aIndex = 0;
  let bIndex = 0;
  while (aIndex < vertexCount && bIndex < vertexCount) {
    const aStart = firstA + aIndex * stepA;
    const bStart = firstB + bIndex * stepB;
    if (intervalsOverlap(aStart, widthA, bStart, widthB)) return true;
    if (aStart + widthA <= bStart) aIndex += 1;
    else bIndex += 1;
  }
  return false;
}

function repeatedIntervalOverlaps(
  fixedStart: number,
  fixedWidth: number,
  repeatedStart: number,
  repeatedStep: number,
  repeatedWidth: number,
  count: number
): boolean {
  for (let index = 0; index < count; index += 1) {
    if (intervalsOverlap(fixedStart, fixedWidth, repeatedStart + index * repeatedStep, repeatedWidth)) return true;
  }
  return false;
}

function intervalsOverlap(aStart: number, aWidth: number, bStart: number, bWidth: number): boolean {
  return aStart < bStart + bWidth && bStart < aStart + aWidth;
}

function maxVertexCountForOutputAllocation(output?: SkinningAttributeOutput): number {
  const offset = sanitizeSafeNonNegativeInteger(output?.offset, 0);
  const stride = Math.max(3, sanitizeSafePositiveInteger(output?.stride, 3));
  if (offset > MAX_SKINNING_OUTPUT_COMPONENTS - 3) return 0;
  return Math.floor((MAX_SKINNING_OUTPUT_COMPONENTS - offset - 3) / stride) + 1;
}

function safeRequiredLength(
  vertexCount: number,
  offset: number,
  stride: number,
  componentsPerVertex: number
): number | null {
  if (
    !Number.isSafeInteger(vertexCount) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(stride) ||
    !Number.isSafeInteger(componentsPerVertex) ||
    vertexCount < 0 ||
    offset < 0 ||
    stride < 0 ||
    componentsPerVertex < 0
  ) {
    return null;
  }
  if (vertexCount === 0 || componentsPerVertex === 0) return 0;
  const stepped = safeMultiply(vertexCount - 1, stride);
  if (stepped === null) return null;
  const withOffset = safeAdd(offset, stepped);
  if (withOffset === null) return null;
  return safeAdd(withOffset, componentsPerVertex);
}

function safeAdd(a: number, b: number): number | null {
  const value = a + b;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeMultiply(a: number, b: number): number | null {
  const value = a * b;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeSafePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : Math.max(1, Math.floor(fallback));
}

function sanitizeSafeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : Math.max(0, Math.floor(fallback));
}

function isSafeArrayLike(value: SkinningNumericArray | undefined): value is SkinningNumericArray {
  return !!value && Number.isSafeInteger(value.length) && value.length >= 0;
}

function safeArrayLength(value: SkinningNumericArray | undefined): number {
  return isSafeArrayLike(value) ? value.length : 0;
}
