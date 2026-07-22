import { type Mat4, type Transform, normalizeQuat } from "./math.js";
import { type AnimationClip } from "./clip-types.js";
import { NO_PARENT, type LocalToModelPoseRangeOptions, type Skeleton } from "./skeleton.js";
import {
  validatePackedRuntimeAnimation,
  buildPackedRuntimeAnimation,
  type PackedRuntimeAnimation,
  type PackedRuntimeAnimationKeyController
} from "./packed-runtime.js";
import { type SkinningJob, type SkinningNumericArray, type SkinningWeightMode } from "./skinning.js";

export const WA_KERNEL_ABI_MAJOR = 1;
/** Oldest ABI v1 minor accepted by the scalar local-to-model facade. */
export const WA_KERNEL_ABI_MINOR = 0;
export const WA_KERNEL_POSE_JOBS_ABI_MINOR = 1;
export const WA_KERNEL_PACKED_SAMPLING_ABI_MINOR = 2;
export const WA_KERNEL_SKINNING_ABI_MINOR = 3;
export const WA_KERNEL_PROCEDURAL_CORRECTIONS_ABI_MINOR = 4;
export const WA_KERNEL_EXECUTION_MODE_ABI_MINOR = 5;
export const WA_KERNEL_ROOT_MOTION_ABI_MINOR = 6;

export const WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL = 1 << 0;
export const WA_KERNEL_FEATURE_SCALAR_POSE_BLEND = 1 << 1;
export const WA_KERNEL_FEATURE_SCALAR_ADDITIVE = 1 << 2;
export const WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS = 1 << 3;
export const WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING = 1 << 4;
export const WA_KERNEL_FEATURE_RETAINED_SKINNING = 1 << 5;
export const WA_KERNEL_FEATURE_RETAINED_PROCEDURAL_CORRECTIONS = 1 << 6;
export const WA_KERNEL_FEATURE_SCALAR_POSE_JOBS =
  WA_KERNEL_FEATURE_SCALAR_POSE_BLEND | WA_KERNEL_FEATURE_SCALAR_ADDITIVE | WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS;
export const WA_KERNEL_FEATURE_SIMD_MATRIX_JOBS = 1 << 16;
export const WA_KERNEL_FEATURE_DEBUG_SELF_TEST = 0x80000000;

export enum WaKernelStatus {
  Ok = 0,
  AbiVersion = 1,
  BadHandle = 2,
  OutOfBounds = 3,
  InvalidArgument = 4,
  Capacity = 5,
  Unsupported = 6,
  Internal = 7
}

export type WaKernelLoadSource =
  | { bytes: BufferSource }
  | { module: WebAssembly.Module }
  | { url: string | URL; fetch?: WaKernelFetch };

export type WaKernelFetch = (input: string | URL, init?: RequestInit) => Promise<unknown>;

export type WaKernelLoadOptions = {
  /** Compatibility scalar asset. Defaults to the packaged scalar URL. */
  source?: WaKernelLoadSource;
  /** SIMD128 asset. Defaults to the packaged SIMD URL. */
  simdSource?: WaKernelLoadSource;
  requiredFeatures?: number;
  webAssembly?: Pick<typeof WebAssembly, "instantiate" | "validate"> | undefined;
};

export type WaKernelExecutionMode = "scalar" | "simd";
export type WaKernelLoadResult = {
  kind: "wasm-scalar" | "wasm-simd";
  mode: WaKernelExecutionMode;
  kernel: WaifuAnimationWasmKernel;
  startupMs: number;
  simdSupported: boolean;
};

export type WaKernelInitializationErrorCode =
  | "webassembly-unavailable"
  | "missing-asset"
  | "asset-load-failed"
  | "instantiate-failed"
  | "abi-mismatch"
  | "required-feature-missing"
  | "malformed-exports"
  | "memory-initialization-failed";

export class WaKernelInitializationError extends Error {
  readonly name = "WaKernelInitializationError";
  constructor(
    readonly code: WaKernelInitializationErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
  }
}

export class WaKernelJobError extends Error {
  readonly name = "WaKernelJobError";
  constructor(
    readonly job: string,
    readonly status: WaKernelStatus,
    message = `${job} failed: ${statusName(status)}`
  ) {
    super(message);
  }
}

export type WaKernelExportValidation =
  | {
      ok: true;
      major: number;
      minor: number;
      featureFlags: number;
    }
  | {
      ok: false;
      reason: string;
      major?: number;
      minor?: number;
      featureFlags?: number;
    };

export type WaKernelRawExports = {
  memory: WebAssembly.Memory;
  wa_version_major: () => number;
  wa_version_minor: () => number;
  wa_feature_flags: () => number;
  wa_execution_mode: () => number;
  wa_simd_execution_count: () => number;
  wa_memory_epoch: () => number;
  wa_refresh_views_required: (observedEpoch: number) => number;
  wa_heap_base: () => number;
  wa_alloc: (sizeBytes: number, alignment: number, outOffsetPtr: number) => number;
  wa_create_skeleton: (
    parentIndicesOffset: number,
    jointCount: number,
    parentIndicesCapacityBytes: number,
    outHandlePtr: number
  ) => number;
  wa_create_avatar: (skeletonHandle: number, jointCount: number, flags: number, outHandlePtr: number) => number;
  wa_create_packed_clip?: (
    tracksOffset: number,
    trackCount: number,
    tracksCapacityBytes: number,
    timesOffset: number,
    timesCount: number,
    timesCapacityBytes: number,
    valuesOffset: number,
    valuesCount: number,
    valuesCapacityBytes: number,
    duration: number,
    flags: number,
    outHandlePtr: number
  ) => number;
  wa_create_sampling_context?: (
    clipHandle: number,
    lowerKeysOffset: number,
    lowerKeysCapacityBytes: number,
    outHandlePtr: number
  ) => number;
  wa_reset_sampling_context?: (contextHandle: number) => number;
  wa_sample_packed_clip?: (
    avatarHandle: number,
    clipHandle: number,
    contextHandle: number,
    restPoseOffset: number,
    restPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number,
    time: number,
    flags: number
  ) => number;
  wa_sample_packed_clip_joint?: (
    avatarHandle: number,
    clipHandle: number,
    contextHandle: number,
    restPoseOffset: number,
    restPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number,
    time: number,
    flags: number,
    joint: number,
    outTransformOffset: number
  ) => number;
  wa_sample_packed_clip_ratio?: (
    avatarHandle: number,
    clipHandle: number,
    contextHandle: number,
    restPoseOffset: number,
    restPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number,
    ratio: number,
    flags: number
  ) => number;
  wa_create_skinning_job?: (
    inverseBindOffset: number,
    paletteCount: number,
    inverseBindCapacityBytes: number,
    remapOffset: number,
    remapCapacityBytes: number,
    indicesOffset: number,
    indicesCapacityBytes: number,
    weightsOffset: number,
    weightsCapacityBytes: number,
    vertexCount: number,
    influences: number,
    indexStride: number,
    weightStride: number,
    weightMode: number,
    flags: number,
    outHandlePtr: number
  ) => number;
  wa_build_skinning_palette?: (
    jobHandle: number,
    modelMatricesOffset: number,
    modelMatricesCount: number,
    modelMatricesCapacityBytes: number,
    paletteOffset: number,
    paletteCapacityBytes: number
  ) => number;
  wa_skin_vertices?: (jobHandle: number, descriptorOffset: number) => number;
  wa_apply_procedural_corrections?: (
    avatarHandle: number,
    localPoseOffset: number,
    localPoseCapacityBytes: number,
    modelPoseOffset: number,
    modelPoseCapacityBytes: number,
    jointCount: number,
    descriptorsOffset: number,
    descriptorCount: number,
    descriptorsCapacityBytes: number,
    optionsOffset: number
  ) => number;
  wa_destroy_handle: (handle: number) => number;
  wa_local_to_model: (
    avatarHandle: number,
    localPoseOffset: number,
    modelPoseOffset: number,
    jointCount: number,
    optionsPtr: number
  ) => number;
  wa_blend_poses?: (
    avatarHandle: number,
    layersOffset: number,
    layerCount: number,
    layersCapacityBytes: number,
    fallbackPoseOffset: number,
    fallbackPoseCapacityBytes: number,
    restPoseOffset: number,
    restPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number,
    threshold: number
  ) => number;
  wa_additive_delta?: (
    avatarHandle: number,
    restPoseOffset: number,
    restPoseCapacityBytes: number,
    samplePoseOffset: number,
    samplePoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number
  ) => number;
  wa_apply_additive?: (
    avatarHandle: number,
    basePoseOffset: number,
    basePoseCapacityBytes: number,
    deltaPoseOffset: number,
    deltaPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number,
    weight: number,
    maskOffset: number,
    maskCount: number,
    maskCapacityBytes: number
  ) => number;
  wa_normalize_pose?: (
    avatarHandle: number,
    inputPoseOffset: number,
    inputPoseCapacityBytes: number,
    outputPoseOffset: number,
    outputPoseCapacityBytes: number,
    jointCount: number
  ) => number;
  wa_force_memory_growth_for_test?: (minExtraPages: number) => number;
  wa_reset_for_test?: () => number;
};

export type WasmLocalToModelUpdateOptions = Pick<LocalToModelPoseRangeOptions, "root" | "from" | "to" | "fromExcluded">;

export type WasmPoseArenaOptions = {
  /** Number of retained padded-SoA pose slots. Slot 0 is initialized from the skeleton rest pose. */
  poseCapacity?: number;
  /** Number of retained dense mask slots. */
  maskCapacity?: number;
  /** Values retained per mask slot; defaults to the skeleton joint count and may be larger for extra-value tests. */
  maskValueCapacity?: number;
  /** Maximum override layer descriptors submitted by one blend job. */
  layerCapacity?: number;
};

export type WasmPoseBlendLayer = {
  pose: number;
  weight: number;
  /** Omit for an all-ones mask. Dense sparse-by-zero masks use a regular mask slot. */
  mask?: number;
  /** Defaults to the last length passed to writeMask/writeSparseMask. Missing short entries read as zero. */
  maskCount?: number;
};

export type WasmPoseBlendOptions = {
  fallbackPose?: number;
  outputPose: number;
  threshold?: number;
};

export type WasmPackedSamplingOptions = {
  /** Defaults to the packed animation's loop flag. Ignored by ratio sampling. */
  loop?: boolean;
  /** Reset all retained lower-key caches before this sample. */
  resetCache?: boolean;
};

export type WasmPackedSamplingResult = { kind: "wasm-scalar" | "wasm-simd"; status: WaKernelStatus };

export type WasmSkinningContextOptions = SkinningJob & {
  /** Required fixed vertex count for the retained job. */
  vertexCount: number;
  /** Immutable bind palette copied once at setup. */
  inverseBindMatrices: readonly SkinningNumericArray[];
  /** Reserve additional dynamic model matrices for remapped palettes. */
  modelMatrixCapacity?: number;
  /** Reserve a separate caller-owned vector matrix palette for inverse-transpose matrices. */
  vectorPalette?: boolean;
};

export type WasmSkinningRunResult = {
  kind: "wasm-scalar" | "wasm-simd";
  status: WaKernelStatus.Ok;
  positions: Float32Array;
  normals?: Float32Array;
  tangents?: Float32Array;
};

export type WasmRawBlendInvocation = {
  avatarHandle: number;
  layersOffset: number;
  layerCount: number;
  layersCapacityBytes: number;
  fallbackPoseOffset: number;
  fallbackPoseCapacityBytes: number;
  restPoseOffset: number;
  restPoseCapacityBytes: number;
  outputPoseOffset: number;
  outputPoseCapacityBytes: number;
  jointCount: number;
  threshold: number;
};

export type WasmRawAdditiveDeltaInvocation = {
  avatarHandle: number;
  restPoseOffset: number;
  restPoseCapacityBytes: number;
  samplePoseOffset: number;
  samplePoseCapacityBytes: number;
  outputPoseOffset: number;
  outputPoseCapacityBytes: number;
  jointCount: number;
};

export type WasmRawApplyAdditiveInvocation = {
  avatarHandle: number;
  basePoseOffset: number;
  basePoseCapacityBytes: number;
  deltaPoseOffset: number;
  deltaPoseCapacityBytes: number;
  outputPoseOffset: number;
  outputPoseCapacityBytes: number;
  jointCount: number;
  weight: number;
  maskOffset: number;
  maskCount: number;
  maskCapacityBytes: number;
};

export type WasmRawNormalizePoseInvocation = {
  avatarHandle: number;
  inputPoseOffset: number;
  inputPoseCapacityBytes: number;
  outputPoseOffset: number;
  outputPoseCapacityBytes: number;
  jointCount: number;
};

const SOA_TRANSFORM_FLOATS = 40;
const SOA_TRANSFORM_BYTES = SOA_TRANSFORM_FLOATS * 4;
const F32_BYTES = 4;
const MAT4_FLOATS = 16;
const MAT4_BYTES = MAT4_FLOATS * 4;
const OPTIONS_BYTES = 32;
const BLEND_LAYER_BYTES = 24;
const PACKED_TRACK_BYTES = 64;
const SKINNING_DESCRIPTOR_BYTES = 128;
const PARENT_BYTES = 4;
const DEFAULT_ALIGNMENT = 16;
const MATRIX_ALIGNMENT = 64;
const SCRATCH_BYTES = 64;
const MAX_JOINTS = 1024;

const OPTION_FLAG_FROM_EXCLUDED = 1 << 0;
const OPTION_FLAG_HAS_ROOT = 1 << 1;
const SAMPLE_FLAG_LOOP = 1 << 0;
const SAMPLE_FLAG_RESET_CACHE = 1 << 1;
const SKINNING_FLAG_HAS_REMAPS = 1 << 0;
const SKINNING_DESCRIPTOR_NORMALS = 1 << 0;
const SKINNING_DESCRIPTOR_TANGENTS = 1 << 1;

// Minimal SIMD128 module used only for engine feature detection. The selected
// SIMD artifact independently reports and proves actual SIMD job execution.
const WASM_SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00,
  0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x0b
]);

export async function loadWaifuAnimationWasmKernel(options: WaKernelLoadOptions = {}): Promise<WaKernelLoadResult> {
  const start = nowMs();
  const webAssembly = options.webAssembly ?? globalThis.WebAssembly;
  const simdSupported = detectWaKernelSimdSupport(webAssembly);
  if (!webAssembly || typeof webAssembly.instantiate !== "function") {
    throw new WaKernelInitializationError("webassembly-unavailable", "WebAssembly is required by waifu-animation");
  }
  const mode: WaKernelExecutionMode = simdSupported ? "simd" : "scalar";
  const source =
    mode === "simd"
      ? (options.simdSource ?? packagedKernelSource("simd"))
      : (options.source ?? packagedKernelSource("scalar"));
  try {
    const instance = await instantiateKernel(source, webAssembly);
    const requiredFeatures =
      (options.requiredFeatures ?? WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL) |
      (mode === "simd" ? WA_KERNEL_FEATURE_SIMD_MATRIX_JOBS : 0);
    const validation = validateWaifuAnimationKernelExports(instance.exports, requiredFeatures);
    if (!validation.ok) {
      const code = validation.reason.includes("feature")
        ? "required-feature-missing"
        : validation.reason.includes("abi")
          ? "abi-mismatch"
          : "malformed-exports";
      throw new WaKernelInitializationError(code, `invalid ${mode} WASM kernel: ${validation.reason}`);
    }
    const kernel = WaifuAnimationWasmKernel.fromExports(instance.exports, elapsedMs(start), mode);
    return {
      kind: mode === "simd" ? "wasm-simd" : "wasm-scalar",
      mode,
      kernel,
      startupMs: elapsedMs(start),
      simdSupported
    };
  } catch (error) {
    if (error instanceof WaKernelInitializationError) throw error;
    throw new WaKernelInitializationError(
      "instantiate-failed",
      `failed to initialize required ${mode} WASM kernel`,
      error
    );
  }
}

function packagedKernelSource(mode: WaKernelExecutionMode): WaKernelLoadSource {
  return { url: new URL(`../dist/wasm-kernel/waifu_animation_kernel.${mode}.wasm`, import.meta.url) };
}

export function validateWaifuAnimationKernelExports(
  exportsObject: WebAssembly.Exports | Record<string, unknown>,
  requiredFeatures = WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL
): WaKernelExportValidation {
  const exports = exportsObject as Record<string, unknown>;
  const requiredFunctionNames = [
    "wa_version_major",
    "wa_version_minor",
    "wa_feature_flags",
    "wa_execution_mode",
    "wa_simd_execution_count",
    "wa_memory_epoch",
    "wa_refresh_views_required",
    "wa_heap_base",
    "wa_alloc",
    "wa_create_skeleton",
    "wa_create_avatar",
    "wa_destroy_handle",
    "wa_local_to_model"
  ] as const;
  if (!(exports.memory instanceof WebAssembly.Memory)) return { ok: false, reason: "missing-memory" };
  for (const name of requiredFunctionNames) {
    if (typeof exports[name] !== "function") return { ok: false, reason: `missing-export:${name}` };
  }
  const major = (exports.wa_version_major as () => number)();
  const minor = (exports.wa_version_minor as () => number)();
  const featureFlags = (exports.wa_feature_flags as () => number)() >>> 0;
  if (major !== WA_KERNEL_ABI_MAJOR) return { ok: false, reason: "abi-major-mismatch", major, minor, featureFlags };
  if (minor < WA_KERNEL_ABI_MINOR) return { ok: false, reason: "abi-minor-too-old", major, minor, featureFlags };
  if (minor < WA_KERNEL_EXECUTION_MODE_ABI_MINOR)
    return { ok: false, reason: "execution-mode-abi-minor-too-old", major, minor, featureFlags };
  if ((featureFlags & requiredFeatures) >>> 0 !== requiredFeatures >>> 0) {
    return { ok: false, reason: "missing-required-feature", major, minor, featureFlags };
  }
  if ((requiredFeatures & WA_KERNEL_FEATURE_SCALAR_POSE_JOBS) !== 0) {
    if (minor < WA_KERNEL_POSE_JOBS_ABI_MINOR) {
      return { ok: false, reason: "pose-jobs-abi-minor-too-old", major, minor, featureFlags };
    }
    const requiredPoseExports = new Set<string>(["wa_normalize_pose"]);
    if ((requiredFeatures & WA_KERNEL_FEATURE_SCALAR_POSE_BLEND) !== 0) requiredPoseExports.add("wa_blend_poses");
    if ((requiredFeatures & WA_KERNEL_FEATURE_SCALAR_ADDITIVE) !== 0) {
      requiredPoseExports.add("wa_additive_delta");
      requiredPoseExports.add("wa_apply_additive");
    }
    if ((requiredFeatures & WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS) !== 0) {
      requiredPoseExports.add("wa_blend_poses");
      requiredPoseExports.add("wa_apply_additive");
    }
    for (const name of requiredPoseExports) {
      if (typeof exports[name] !== "function")
        return { ok: false, reason: `missing-export:${name}`, major, minor, featureFlags };
    }
  }
  if ((requiredFeatures & WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING) !== 0) {
    if (minor < WA_KERNEL_PACKED_SAMPLING_ABI_MINOR) {
      return { ok: false, reason: "packed-sampling-abi-minor-too-old", major, minor, featureFlags };
    }
    for (const name of [
      "wa_create_packed_clip",
      "wa_create_sampling_context",
      "wa_reset_sampling_context",
      "wa_sample_packed_clip",
      "wa_sample_packed_clip_ratio",
      "wa_sample_packed_clip_joint"
    ]) {
      if (typeof exports[name] !== "function") {
        return { ok: false, reason: `missing-export:${name}`, major, minor, featureFlags };
      }
    }
  }
  if ((requiredFeatures & WA_KERNEL_FEATURE_RETAINED_SKINNING) !== 0) {
    if (minor < WA_KERNEL_SKINNING_ABI_MINOR) {
      return { ok: false, reason: "skinning-abi-minor-too-old", major, minor, featureFlags };
    }
    for (const name of ["wa_create_skinning_job", "wa_build_skinning_palette", "wa_skin_vertices"]) {
      if (typeof exports[name] !== "function") {
        return { ok: false, reason: `missing-export:${name}`, major, minor, featureFlags };
      }
    }
  }
  if ((requiredFeatures & WA_KERNEL_FEATURE_RETAINED_PROCEDURAL_CORRECTIONS) !== 0) {
    if (minor < WA_KERNEL_PROCEDURAL_CORRECTIONS_ABI_MINOR) {
      return { ok: false, reason: "procedural-corrections-abi-minor-too-old", major, minor, featureFlags };
    }
    if (typeof exports.wa_apply_procedural_corrections !== "function") {
      return { ok: false, reason: "missing-export:wa_apply_procedural_corrections", major, minor, featureFlags };
    }
  }
  return { ok: true, major, minor, featureFlags };
}

export function detectWaKernelSimdSupport(
  webAssembly: Pick<typeof WebAssembly, "validate"> | undefined = globalThis.WebAssembly
): boolean {
  try {
    return typeof webAssembly?.validate === "function" && webAssembly.validate(WASM_SIMD_PROBE);
  } catch (_error) {
    return false;
  }
}

export function statusName(status: number): string {
  const names: Record<number, string> = {
    0: "WA_OK",
    1: "WA_ERR_ABI_VERSION",
    2: "WA_ERR_BAD_HANDLE",
    3: "WA_ERR_OOB",
    4: "WA_ERR_INVALID_ARG",
    5: "WA_ERR_CAPACITY",
    6: "WA_ERR_UNSUPPORTED",
    7: "WA_ERR_INTERNAL"
  };
  return names[status] ?? `WA_STATUS_${status}`;
}

export class WaifuAnimationWasmKernel {
  readonly startupMs: number;
  readonly featureFlags: number;
  readonly executionMode: WaKernelExecutionMode;
  private readonly exports: WaKernelRawExports;
  private readonly scratchOffset: number;
  private cachedBuffer: ArrayBuffer;
  private cachedEpoch: number;
  private dataView: DataView;

  private constructor(
    exports: WaKernelRawExports,
    startupMs: number,
    scratchOffset: number,
    executionMode: WaKernelExecutionMode
  ) {
    this.exports = exports;
    this.startupMs = startupMs;
    this.featureFlags = exports.wa_feature_flags() >>> 0;
    this.executionMode = executionMode;
    this.scratchOffset = scratchOffset;
    this.cachedBuffer = exports.memory.buffer;
    this.cachedEpoch = exports.wa_memory_epoch();
    this.dataView = new DataView(this.cachedBuffer);
  }

  static fromExports(
    exportsObject: WebAssembly.Exports,
    startupMs = 0,
    expectedMode?: WaKernelExecutionMode
  ): WaifuAnimationWasmKernel {
    const validation = validateWaifuAnimationKernelExports(exportsObject);
    if (!validation.ok) throw new Error(`invalid waifu-animation WASM kernel: ${validation.reason}`);
    const exports = exportsObject as unknown as WaKernelRawExports;
    const actualMode: WaKernelExecutionMode = exports.wa_execution_mode() === 1 ? "simd" : "scalar";
    if (expectedMode !== undefined && actualMode !== expectedMode) {
      throw new WaKernelInitializationError(
        "required-feature-missing",
        `selected ${expectedMode} kernel reported ${actualMode} execution mode`
      );
    }
    const heapBase = exports.wa_heap_base();
    const status = exports.wa_alloc(SCRATCH_BYTES, DEFAULT_ALIGNMENT, heapBase);
    if (status !== 0)
      throw new WaKernelInitializationError(
        "memory-initialization-failed",
        `failed to allocate WASM kernel scratch: ${statusName(status)}`
      );
    const dataView = new DataView(exports.memory.buffer);
    const scratchOffset = dataView.getUint32(heapBase, true);
    return new WaifuAnimationWasmKernel(exports, startupMs, scratchOffset, actualMode);
  }

  get memory(): WebAssembly.Memory {
    return this.exports.memory;
  }

  get memoryEpoch(): number {
    this.refreshViewsIfNeeded();
    return this.cachedEpoch;
  }

  get available(): boolean {
    return true;
  }

  get simdExecutionCount(): number {
    return this.exports.wa_simd_execution_count() >>> 0;
  }

  createLocalToModelContext(skeleton: Skeleton): WasmLocalToModelContext {
    return new WasmLocalToModelContext(this, skeleton);
  }

  createPoseArenaContext(skeleton: Skeleton, options: WasmPoseArenaOptions = {}): WasmPoseArenaContext {
    const validation = validateWaifuAnimationKernelExports(
      this.exports,
      WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL | WA_KERNEL_FEATURE_SCALAR_POSE_JOBS
    );
    if (!validation.ok) throw new Error(`WASM kernel pose jobs unavailable: ${validation.reason}`);
    return new WasmPoseArenaContext(this, skeleton, options);
  }

  createPackedClipAsset(skeleton: Skeleton, animation: PackedRuntimeAnimation): WasmPackedClipAsset {
    const validation = validateWaifuAnimationKernelExports(this.exports, WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING);
    if (!validation.ok) throw new Error(`WASM retained packed sampling unavailable: ${validation.reason}`);
    return new WasmPackedClipAsset(this, skeleton, animation);
  }

  /**
   * Create a retained ordinary-clip sampler. Conversion to the numeric packed
   * asset is import/setup work; every sample is executed by the Rust kernel.
   */
  createClipSamplingContext(skeleton: Skeleton, clip: AnimationClip): WasmClipSamplingContext {
    return new WasmClipSamplingContext(this, skeleton, clip);
  }

  createSkinningContext(options: WasmSkinningContextOptions): WasmSkinningContext {
    const validation = validateWaifuAnimationKernelExports(this.exports, WA_KERNEL_FEATURE_RETAINED_SKINNING);
    if (!validation.ok) throw new Error(`WASM retained skinning unavailable: ${validation.reason}`);
    return new WasmSkinningContext(this, options);
  }

  createProceduralCorrectionContext(
    arena: WasmPoseArenaContext,
    options: WasmProceduralCorrectionContextOptions = {}
  ): WasmProceduralCorrectionContext {
    const validation = validateWaifuAnimationKernelExports(
      this.exports,
      WA_KERNEL_FEATURE_RETAINED_PROCEDURAL_CORRECTIONS
    );
    if (!validation.ok) throw new Error(`WASM retained procedural corrections unavailable: ${validation.reason}`);
    return new WasmProceduralCorrectionContext(this, arena, options);
  }

  resetForTests(): WaKernelStatus {
    const status = this.exports.wa_reset_for_test?.() ?? WaKernelStatus.Unsupported;
    this.refreshViewsIfNeeded();
    return status;
  }

  forceMemoryGrowthForTests(minExtraPages = 1): WaKernelStatus {
    const status = this.exports.wa_force_memory_growth_for_test?.(minExtraPages) ?? WaKernelStatus.Unsupported;
    this.refreshViewsIfNeeded();
    return status;
  }

  allocateBytes(sizeBytes: number, alignment = DEFAULT_ALIGNMENT): number {
    const status = this.exports.wa_alloc(sizeBytes, alignment, this.scratchOffset);
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM kernel allocation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createSkeleton(parentIndicesOffset: number, jointCount: number, parentIndicesCapacityBytes: number): number {
    const status = this.exports.wa_create_skeleton(
      parentIndicesOffset,
      jointCount,
      parentIndicesCapacityBytes,
      this.scratchOffset
    );
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM kernel skeleton creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createAvatar(skeletonHandle: number, jointCount: number): number {
    const status = this.exports.wa_create_avatar(skeletonHandle, jointCount, 0, this.scratchOffset);
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM kernel avatar creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createPackedClip(
    tracksOffset: number,
    trackCount: number,
    timesOffset: number,
    timesCount: number,
    valuesOffset: number,
    valuesCount: number,
    duration: number
  ): number {
    if (!this.exports.wa_create_packed_clip) {
      throw new Error("WASM retained packed sampling export is missing");
    }
    const status = this.exports.wa_create_packed_clip(
      tracksOffset,
      trackCount,
      trackCount * PACKED_TRACK_BYTES,
      timesOffset,
      timesCount,
      timesCount * F32_BYTES,
      valuesOffset,
      valuesCount,
      valuesCount * F32_BYTES,
      duration,
      0,
      this.scratchOffset
    );
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM packed clip creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createSamplingContext(clipHandle: number, lowerKeysOffset: number, trackCount: number): number {
    if (!this.exports.wa_create_sampling_context) {
      throw new Error("WASM retained packed sampling export is missing");
    }
    const status = this.exports.wa_create_sampling_context(
      clipHandle,
      lowerKeysOffset,
      trackCount * F32_BYTES,
      this.scratchOffset
    );
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM packed sampling context creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createSkinningJob(input: {
    inverseBindOffset: number;
    paletteCount: number;
    remapOffset: number;
    indicesOffset: number;
    indicesCount: number;
    weightsOffset: number;
    weightsCount: number;
    vertexCount: number;
    influences: number;
    indexStride: number;
    weightStride: number;
    weightMode: SkinningWeightMode;
  }): number {
    const create = this.exports.wa_create_skinning_job;
    if (!create) throw new Error("WASM retained skinning is unavailable");
    const status = create(
      input.inverseBindOffset,
      input.paletteCount,
      input.paletteCount * MAT4_BYTES,
      input.remapOffset,
      input.remapOffset === 0 ? 0 : input.paletteCount * F32_BYTES,
      input.indicesOffset,
      input.indicesCount * F32_BYTES,
      input.weightsOffset,
      input.weightsCount * F32_BYTES,
      input.vertexCount,
      input.influences,
      input.indexStride,
      input.weightStride,
      input.weightMode === "explicit" ? 1 : 0,
      input.remapOffset === 0 ? 0 : SKINNING_FLAG_HAS_REMAPS,
      this.scratchOffset
    );
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM skinning job creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  invokeSkinningPalette(input: {
    handle: number;
    modelOffset: number;
    modelCount: number;
    modelCapacityBytes: number;
    paletteOffset: number;
    paletteCapacityBytes: number;
  }): WaKernelStatus {
    const invoke = this.exports.wa_build_skinning_palette;
    if (!invoke) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      invoke(
        input.handle,
        input.modelOffset,
        input.modelCount,
        input.modelCapacityBytes,
        input.paletteOffset,
        input.paletteCapacityBytes
      )
    );
  }

  invokeSkinning(handle: number, descriptorOffset: number): WaKernelStatus {
    const invoke = this.exports.wa_skin_vertices;
    if (!invoke) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(invoke(handle, descriptorOffset));
  }

  resetSamplingContext(contextHandle: number): WaKernelStatus {
    if (!this.exports.wa_reset_sampling_context) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(this.exports.wa_reset_sampling_context(contextHandle));
  }

  invokePackedSample(input: {
    avatarHandle: number;
    clipHandle: number;
    contextHandle: number;
    restPoseOffset: number;
    restPoseCapacityBytes: number;
    outputPoseOffset: number;
    outputPoseCapacityBytes: number;
    jointCount: number;
    value: number;
    flags: number;
    ratio: boolean;
  }): WaKernelStatus {
    const invoke = input.ratio ? this.exports.wa_sample_packed_clip_ratio : this.exports.wa_sample_packed_clip;
    if (!invoke) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      invoke(
        input.avatarHandle,
        input.clipHandle,
        input.contextHandle,
        input.restPoseOffset,
        input.restPoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount,
        input.value,
        input.flags
      )
    );
  }

  invokePackedJointSample(input: {
    avatarHandle: number;
    clipHandle: number;
    contextHandle: number;
    restPoseOffset: number;
    restPoseCapacityBytes: number;
    outputPoseOffset: number;
    outputPoseCapacityBytes: number;
    jointCount: number;
    time: number;
    flags: number;
    joint: number;
    outTransformOffset: number;
  }): WaKernelStatus {
    const invoke = this.exports.wa_sample_packed_clip_joint;
    if (!invoke) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      invoke(
        input.avatarHandle,
        input.clipHandle,
        input.contextHandle,
        input.restPoseOffset,
        input.restPoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount,
        input.time,
        input.flags,
        input.joint,
        input.outTransformOffset
      )
    );
  }

  destroyHandle(handle: number): WaKernelStatus {
    const status = this.exports.wa_destroy_handle(handle);
    this.refreshViewsIfNeeded();
    return status;
  }

  invokeLocalToModel(
    avatarHandle: number,
    localPoseOffset: number,
    modelPoseOffset: number,
    jointCount: number,
    optionsOffset: number
  ): WaKernelStatus {
    const status = this.exports.wa_local_to_model(
      avatarHandle,
      localPoseOffset,
      modelPoseOffset,
      jointCount,
      optionsOffset
    );
    this.refreshViewsIfNeeded();
    return status;
  }

  invokeBlendPoses(input: WasmRawBlendInvocation): WaKernelStatus {
    if (!this.exports.wa_blend_poses) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      this.exports.wa_blend_poses(
        input.avatarHandle,
        input.layersOffset,
        input.layerCount,
        input.layersCapacityBytes,
        input.fallbackPoseOffset,
        input.fallbackPoseCapacityBytes,
        input.restPoseOffset,
        input.restPoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount,
        input.threshold
      )
    );
  }

  invokeAdditiveDelta(input: WasmRawAdditiveDeltaInvocation): WaKernelStatus {
    if (!this.exports.wa_additive_delta) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      this.exports.wa_additive_delta(
        input.avatarHandle,
        input.restPoseOffset,
        input.restPoseCapacityBytes,
        input.samplePoseOffset,
        input.samplePoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount
      )
    );
  }

  invokeApplyAdditive(input: WasmRawApplyAdditiveInvocation): WaKernelStatus {
    if (!this.exports.wa_apply_additive) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      this.exports.wa_apply_additive(
        input.avatarHandle,
        input.basePoseOffset,
        input.basePoseCapacityBytes,
        input.deltaPoseOffset,
        input.deltaPoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount,
        input.weight,
        input.maskOffset,
        input.maskCount,
        input.maskCapacityBytes
      )
    );
  }

  invokeNormalizePose(input: WasmRawNormalizePoseInvocation): WaKernelStatus {
    if (!this.exports.wa_normalize_pose) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      this.exports.wa_normalize_pose(
        input.avatarHandle,
        input.inputPoseOffset,
        input.inputPoseCapacityBytes,
        input.outputPoseOffset,
        input.outputPoseCapacityBytes,
        input.jointCount
      )
    );
  }

  invokeProceduralCorrections(
    avatarHandle: number,
    localPoseOffset: number,
    localPoseCapacityBytes: number,
    modelPoseOffset: number,
    modelPoseCapacityBytes: number,
    jointCount: number,
    descriptorsOffset: number,
    descriptorCount: number,
    descriptorsCapacityBytes: number,
    optionsOffset: number
  ): WaKernelStatus {
    if (!this.exports.wa_apply_procedural_corrections) return WaKernelStatus.Unsupported;
    return this.finishPoseJobStatus(
      this.exports.wa_apply_procedural_corrections(
        avatarHandle,
        localPoseOffset,
        localPoseCapacityBytes,
        modelPoseOffset,
        modelPoseCapacityBytes,
        jointCount,
        descriptorsOffset,
        descriptorCount,
        descriptorsCapacityBytes,
        optionsOffset
      )
    );
  }

  refreshViewsIfNeeded(): void {
    const epoch = this.exports.wa_memory_epoch();
    if (
      this.cachedBuffer !== this.exports.memory.buffer ||
      this.cachedEpoch !== epoch ||
      this.exports.wa_refresh_views_required(this.cachedEpoch) !== 0
    ) {
      this.cachedBuffer = this.exports.memory.buffer;
      this.cachedEpoch = epoch;
      this.dataView = new DataView(this.cachedBuffer);
    }
  }

  dataViewForCurrentMemory(): DataView {
    this.refreshViewsIfNeeded();
    return this.dataView;
  }

  private finishPoseJobStatus(status: number): WaKernelStatus {
    this.refreshViewsIfNeeded();
    return status;
  }
}

/**
 * Retained scalar-WASM palette and CPU-skinning job. Immutable inverse binds,
 * remaps, indices, weights, and layout metadata are copied once. Callers update
 * the exposed typed views in place; `runRetained` allocates nothing and never
 * grows memory after construction.
 */
export class WasmSkinningContext {
  readonly vertexCount: number;
  readonly influences: number;
  readonly paletteCount: number;
  readonly modelMatrixCapacity: number;
  readonly weightMode: SkinningWeightMode;
  readonly handle: number;
  readonly modelMatricesOffset: number;
  readonly paletteOffset: number;
  readonly vectorPaletteOffset: number;
  readonly positionsOffset: number;
  readonly normalsOffset: number;
  readonly tangentsOffset: number;
  readonly outPositionsOffset: number;
  readonly outNormalsOffset: number;
  readonly outTangentsOffset: number;
  readonly descriptorOffset: number;
  private readonly kernel: WaifuAnimationWasmKernel;
  private readonly layouts: RetainedSkinningLayouts;
  private readonly inverseBindOffset: number;
  private readonly remapOffset: number;
  private readonly indicesOffset: number;
  private readonly weightsOffset: number;
  private readonly inverseBindMatricesSnapshot: Float32Array;
  private modelMatrixCount: number;
  private cachedBuffer: ArrayBuffer;
  private destroyed = false;
  private modelMatricesViewCache!: Float32Array;
  private paletteViewCache!: Float32Array;
  private vectorPaletteViewCache: Float32Array | undefined;
  private positionsViewCache!: Float32Array;
  private normalsViewCache: Float32Array | undefined;
  private tangentsViewCache: Float32Array | undefined;
  private outPositionsViewCache!: Float32Array;
  private outNormalsViewCache: Float32Array | undefined;
  private outTangentsViewCache: Float32Array | undefined;

  constructor(kernel: WaifuAnimationWasmKernel, options: WasmSkinningContextOptions) {
    const requestedVertexCount = requireBoundedNonNegativeInteger(options.vertexCount, "vertexCount", 4_194_304);
    const influences = requireBoundedPositiveInteger(options.influences ?? 1, "influences", 256);
    const positionLayout = retainedAttributeLayout(options.positions, 3);
    this.vertexCount = Math.min(requestedVertexCount, inferredRetainedVertexCount(options.positions, positionLayout));
    this.influences = influences;
    this.weightMode = options.weightMode === "explicit" ? "explicit" : "restored-last";
    const models = options.modelMatrices;
    if (!models || models.length === 0) throw new Error("WASM retained skinning requires modelMatrices at setup");
    this.paletteCount = Math.min(
      65_536,
      options.jointRemaps
        ? Math.min(safeNumericLength(options.jointRemaps), options.inverseBindMatrices.length)
        : Math.min(models.length, options.inverseBindMatrices.length)
    );
    if (this.paletteCount <= 0) throw new Error("WASM retained skinning requires a non-empty inverse-bind palette");
    this.modelMatrixCapacity = requireBoundedPositiveInteger(
      options.modelMatrixCapacity ?? models.length,
      "modelMatrixCapacity",
      65_536
    );
    if (models.length > this.modelMatrixCapacity) throw new Error("modelMatrices exceed retained modelMatrixCapacity");
    this.kernel = kernel;
    this.layouts = createRetainedSkinningLayouts(options, this.vertexCount, positionLayout);

    const inverseBytes = this.paletteCount * MAT4_BYTES;
    const remapBytes = options.jointRemaps ? this.paletteCount * F32_BYTES : 0;
    const indexCount = this.vertexCount * influences;
    const storedWeightCount = this.weightMode === "explicit" ? influences : influences - 1;
    const weightCount = this.vertexCount * storedWeightCount;
    this.inverseBindOffset = kernel.allocateBytes(Math.max(F32_BYTES, inverseBytes), MATRIX_ALIGNMENT);
    this.remapOffset = remapBytes > 0 ? kernel.allocateBytes(remapBytes, DEFAULT_ALIGNMENT) : 0;
    this.indicesOffset = kernel.allocateBytes(Math.max(F32_BYTES, indexCount * F32_BYTES), DEFAULT_ALIGNMENT);
    this.weightsOffset = kernel.allocateBytes(Math.max(F32_BYTES, weightCount * F32_BYTES), DEFAULT_ALIGNMENT);
    this.modelMatricesOffset = kernel.allocateBytes(this.modelMatrixCapacity * MAT4_BYTES, MATRIX_ALIGNMENT);
    this.paletteOffset = kernel.allocateBytes(inverseBytes, MATRIX_ALIGNMENT);
    this.vectorPaletteOffset =
      options.vectorPalette === true || options.jointInverseTransposeMatrices !== undefined
        ? kernel.allocateBytes(inverseBytes, MATRIX_ALIGNMENT)
        : 0;
    this.positionsOffset = kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.positions.length * F32_BYTES));
    this.normalsOffset = this.layouts.normals
      ? kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.normals.length * F32_BYTES))
      : 0;
    this.tangentsOffset = this.layouts.tangents
      ? kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.tangents.length * F32_BYTES))
      : 0;
    this.outPositionsOffset = kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.outPositions.length * F32_BYTES));
    this.outNormalsOffset = this.layouts.outNormals
      ? kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.outNormals.length * F32_BYTES))
      : 0;
    this.outTangentsOffset = this.layouts.outTangents
      ? kernel.allocateBytes(Math.max(F32_BYTES, this.layouts.outTangents.length * F32_BYTES))
      : 0;
    this.descriptorOffset = kernel.allocateBytes(SKINNING_DESCRIPTOR_BYTES, DEFAULT_ALIGNMENT);
    this.cachedBuffer = kernel.memory.buffer;
    this.refreshViewCaches();
    this.positionsViewCache.fill(0);
    this.normalsViewCache?.fill(0);
    this.tangentsViewCache?.fill(0);
    this.outPositionsViewCache.fill(0);
    this.outNormalsViewCache?.fill(0);
    this.outTangentsViewCache?.fill(0);

    this.inverseBindMatricesSnapshot = new Float32Array(this.paletteCount * MAT4_FLOATS);
    for (let index = 0; index < this.paletteCount; index += 1) {
      this.inverseBindMatricesSnapshot.set(
        finiteMat4OrIdentity(options.inverseBindMatrices[index]),
        index * MAT4_FLOATS
      );
    }
    new Float32Array(this.cachedBuffer, this.inverseBindOffset, this.inverseBindMatricesSnapshot.length).set(
      this.inverseBindMatricesSnapshot
    );
    if (this.remapOffset !== 0) {
      const remaps = new Float32Array(this.cachedBuffer, this.remapOffset, this.paletteCount);
      for (let index = 0; index < this.paletteCount; index += 1)
        remaps[index] = finiteNumber(options.jointRemaps?.[index], 0);
    }
    const retainedIndices = new Uint32Array(this.cachedBuffer, this.indicesOffset, indexCount);
    const sourceIndexOffset = safeNonNegativeInteger(options.jointIndexOffset, 0);
    const sourceIndexStride = safePositiveInteger(options.jointIndexStride, influences);
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      for (let influence = 0; influence < influences; influence += 1) {
        retainedIndices[vertex * influences + influence] = validPaletteIndex(
          options.jointIndices?.[sourceIndexOffset + vertex * sourceIndexStride + influence],
          this.paletteCount
        );
      }
    }
    const retainedWeights = new Float32Array(this.cachedBuffer, this.weightsOffset, weightCount);
    const sourceWeightOffset = safeNonNegativeInteger(options.jointWeightOffset, 0);
    const sourceWeightStride = safeNonNegativeInteger(options.jointWeightStride, storedWeightCount);
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      for (let influence = 0; influence < storedWeightCount; influence += 1) {
        retainedWeights[vertex * storedWeightCount + influence] =
          options.jointWeights?.[sourceWeightOffset + vertex * sourceWeightStride + influence] ?? Number.NaN;
      }
    }
    this.copyAttributeInput(this.positionsViewCache, options.positions?.data);
    this.copyAttributeInput(this.normalsViewCache, options.normals?.data);
    this.copyAttributeInput(this.tangentsViewCache, options.tangents?.data);
    this.copyAttributeInput(this.outPositionsViewCache, options.outPositions?.data);
    this.copyAttributeInput(this.outNormalsViewCache, options.outNormals?.data);
    this.copyAttributeInput(this.outTangentsViewCache, options.outTangents?.data);
    this.modelMatrixCount = models.length;
    this.writeModelMatrices(models);
    if (this.vectorPaletteViewCache) this.writeVectorPalette(options.jointInverseTransposeMatrices ?? []);
    this.writeDescriptor();
    this.handle = kernel.createSkinningJob({
      inverseBindOffset: this.inverseBindOffset,
      paletteCount: this.paletteCount,
      remapOffset: this.remapOffset,
      indicesOffset: this.indicesOffset,
      indicesCount: indexCount,
      weightsOffset: this.weightsOffset,
      weightsCount: weightCount,
      vertexCount: this.vertexCount,
      influences,
      indexStride: influences,
      weightStride: storedWeightCount,
      weightMode: this.weightMode
    });
  }

  get available(): boolean {
    return !this.destroyed;
  }

  get modelMatrices(): Float32Array {
    this.refreshViews();
    return this.modelMatricesViewCache;
  }

  get palette(): Float32Array {
    this.refreshViews();
    return this.paletteViewCache;
  }

  get vectorPalette(): Float32Array | undefined {
    this.refreshViews();
    return this.vectorPaletteViewCache;
  }

  get positions(): Float32Array {
    this.refreshViews();
    return this.positionsViewCache;
  }

  get normals(): Float32Array | undefined {
    this.refreshViews();
    return this.normalsViewCache;
  }

  get tangents(): Float32Array | undefined {
    this.refreshViews();
    return this.tangentsViewCache;
  }

  get outPositions(): Float32Array {
    this.refreshViews();
    return this.outPositionsViewCache;
  }

  get outNormals(): Float32Array | undefined {
    this.refreshViews();
    return this.outNormalsViewCache;
  }

  get outTangents(): Float32Array | undefined {
    this.refreshViews();
    return this.outTangentsViewCache;
  }

  writeModelMatrices(matrices: readonly SkinningNumericArray[]): Float32Array {
    if (matrices.length === 0 || matrices.length > this.modelMatrixCapacity) {
      throw new Error("modelMatrices length is outside retained capacity");
    }
    const view = this.modelMatrices;
    view.fill(0);
    for (let index = 0; index < matrices.length; index += 1) {
      view.set(finiteMat4OrIdentity(matrices[index]), index * MAT4_FLOATS);
    }
    this.modelMatrixCount = matrices.length;
    return view;
  }

  writeVectorPalette(matrices: readonly SkinningNumericArray[]): Float32Array {
    const view = this.vectorPalette;
    if (!view) throw new Error("retained vector palette was not reserved");
    view.fill(Number.NaN);
    for (let index = 0; index < Math.min(matrices.length, this.paletteCount); index += 1) {
      const matrix = matrices[index];
      if (isFiniteMat4Like(matrix)) view.set(matrix, index * MAT4_FLOATS);
    }
    return view;
  }

  buildPalette(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    return this.kernel.invokeSkinningPalette({
      handle: this.handle,
      modelOffset: this.modelMatricesOffset,
      modelCount: this.modelMatrixCount,
      modelCapacityBytes: this.modelMatrixCapacity * MAT4_BYTES,
      paletteOffset: this.paletteOffset,
      paletteCapacityBytes: this.paletteCount * MAT4_BYTES
    });
  }

  skin(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    return this.kernel.invokeSkinning(this.handle, this.descriptorOffset);
  }

  runRetained(): WaKernelStatus {
    const paletteStatus = this.buildPalette();
    return paletteStatus === WaKernelStatus.Ok ? this.skin() : paletteStatus;
  }

  run(): WasmSkinningRunResult {
    const status = this.runRetained();
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("skinning", status);
    const result: WasmSkinningRunResult = {
      kind: this.kernel.executionMode === "simd" ? "wasm-simd" : "wasm-scalar",
      status: WaKernelStatus.Ok,
      positions: this.outPositions
    };
    if (this.outNormals) result.normals = this.outNormals;
    if (this.outTangents) result.tangents = this.outTangents;
    return result;
  }

  invokeRawPaletteForTests(
    overrides: {
      handle?: number;
      modelOffset?: number;
      modelCount?: number;
      modelCapacityBytes?: number;
      paletteOffset?: number;
      paletteCapacityBytes?: number;
    } = {}
  ): WaKernelStatus {
    return this.kernel.invokeSkinningPalette({
      handle: overrides.handle ?? this.handle,
      modelOffset: overrides.modelOffset ?? this.modelMatricesOffset,
      modelCount: overrides.modelCount ?? this.modelMatrixCount,
      modelCapacityBytes: overrides.modelCapacityBytes ?? this.modelMatrixCapacity * MAT4_BYTES,
      paletteOffset: overrides.paletteOffset ?? this.paletteOffset,
      paletteCapacityBytes: overrides.paletteCapacityBytes ?? this.paletteCount * MAT4_BYTES
    });
  }

  invokeRawSkinForTests(wordOverrides: Readonly<Record<number, number>> = {}, handle = this.handle): WaKernelStatus {
    const descriptor = new Uint32Array(this.kernel.memory.buffer, this.descriptorOffset, SKINNING_DESCRIPTOR_BYTES / 4);
    const saved = descriptor.slice();
    for (const [word, value] of Object.entries(wordOverrides)) descriptor[Number(word)] = value;
    const status = this.kernel.invokeSkinning(handle, this.descriptorOffset);
    descriptor.set(saved);
    return status;
  }

  destroy(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.destroyed = true;
    return this.kernel.destroyHandle(this.handle);
  }

  refreshViews(): void {
    this.kernel.refreshViewsIfNeeded();
    if (this.cachedBuffer !== this.kernel.memory.buffer) {
      this.cachedBuffer = this.kernel.memory.buffer;
      this.refreshViewCaches();
    }
  }

  private refreshViewCaches(): void {
    this.modelMatricesViewCache = new Float32Array(
      this.cachedBuffer,
      this.modelMatricesOffset,
      this.modelMatrixCapacity * MAT4_FLOATS
    );
    this.paletteViewCache = new Float32Array(this.cachedBuffer, this.paletteOffset, this.paletteCount * MAT4_FLOATS);
    this.vectorPaletteViewCache =
      this.vectorPaletteOffset === 0
        ? undefined
        : new Float32Array(this.cachedBuffer, this.vectorPaletteOffset, this.paletteCount * MAT4_FLOATS);
    this.positionsViewCache = new Float32Array(this.cachedBuffer, this.positionsOffset, this.layouts.positions.length);
    this.normalsViewCache = this.layouts.normals
      ? new Float32Array(this.cachedBuffer, this.normalsOffset, this.layouts.normals.length)
      : undefined;
    this.tangentsViewCache = this.layouts.tangents
      ? new Float32Array(this.cachedBuffer, this.tangentsOffset, this.layouts.tangents.length)
      : undefined;
    this.outPositionsViewCache = new Float32Array(
      this.cachedBuffer,
      this.outPositionsOffset,
      this.layouts.outPositions.length
    );
    this.outNormalsViewCache = this.layouts.outNormals
      ? new Float32Array(this.cachedBuffer, this.outNormalsOffset, this.layouts.outNormals.length)
      : undefined;
    this.outTangentsViewCache = this.layouts.outTangents
      ? new Float32Array(this.cachedBuffer, this.outTangentsOffset, this.layouts.outTangents.length)
      : undefined;
  }

  private writeDescriptor(): void {
    const descriptor = new Uint32Array(this.cachedBuffer, this.descriptorOffset, SKINNING_DESCRIPTOR_BYTES / 4);
    descriptor.fill(0);
    const pairs = [
      [this.paletteOffset, this.paletteCount * MAT4_BYTES],
      [this.vectorPaletteOffset, this.vectorPaletteOffset === 0 ? 0 : this.paletteCount * MAT4_BYTES],
      [this.positionsOffset, this.layouts.positions.length * F32_BYTES],
      [this.normalsOffset, (this.layouts.normals?.length ?? 0) * F32_BYTES],
      [this.tangentsOffset, (this.layouts.tangents?.length ?? 0) * F32_BYTES],
      [this.outPositionsOffset, this.layouts.outPositions.length * F32_BYTES],
      [this.outNormalsOffset, (this.layouts.outNormals?.length ?? 0) * F32_BYTES],
      [this.outTangentsOffset, (this.layouts.outTangents?.length ?? 0) * F32_BYTES]
    ] as const;
    for (let index = 0; index < pairs.length; index += 1) {
      descriptor[index * 2] = pairs[index]![0];
      descriptor[index * 2 + 1] = pairs[index]![1];
    }
    const layouts = [
      this.layouts.positions,
      this.layouts.normals,
      this.layouts.tangents,
      this.layouts.outPositions,
      this.layouts.outNormals,
      this.layouts.outTangents
    ];
    for (let index = 0; index < layouts.length; index += 1) {
      descriptor[16 + index * 2] = layouts[index]?.offset ?? 0;
      descriptor[17 + index * 2] = layouts[index]?.stride ?? 3;
    }
    descriptor[28] =
      (this.layouts.normals ? SKINNING_DESCRIPTOR_NORMALS : 0) |
      (this.layouts.tangents ? SKINNING_DESCRIPTOR_TANGENTS : 0);
  }

  private copyAttributeInput(target: Float32Array | undefined, source: SkinningNumericArray | undefined): void {
    if (!target || !source) return;
    for (let index = 0; index < Math.min(target.length, safeNumericLength(source)); index += 1) {
      target[index] = source[index] ?? Number.NaN;
    }
  }
}

export function createWasmSkinningContext(
  kernelOrLoadResult: WaifuAnimationWasmKernel | WaKernelLoadResult,
  options: WasmSkinningContextOptions
): WasmSkinningContext {
  const kernel = "kind" in kernelOrLoadResult ? kernelOrLoadResult.kernel : kernelOrLoadResult;
  return kernel.createSkinningContext(options);
}

export function runWasmSkinning(context: WasmSkinningContext): WasmSkinningRunResult {
  return context.run();
}

/** Immutable packed animation copied once into retained WASM memory. */
export class WasmPackedClipAsset {
  readonly handle: number;
  readonly jointCount: number;
  readonly trackCount: number;
  readonly tracksOffset: number;
  readonly timesOffset: number;
  readonly valuesOffset: number;
  readonly animation: PackedRuntimeAnimation;
  private readonly kernel: WaifuAnimationWasmKernel;
  private destroyed = false;

  constructor(kernel: WaifuAnimationWasmKernel, skeleton: Skeleton, animation: PackedRuntimeAnimation) {
    const issues = validatePackedRuntimeAnimation(animation, skeleton);
    if (issues.length > 0) {
      throw new Error(
        `packed runtime animation is invalid for WASM: ${issues.map((issue) => issue.message).join("; ")}`
      );
    }
    this.kernel = kernel;
    this.animation = animation;
    this.jointCount = skeleton.joints.length;
    this.trackCount = animation.keyControllers.length;
    this.tracksOffset = kernel.allocateBytes(this.trackCount * PACKED_TRACK_BYTES, DEFAULT_ALIGNMENT);
    this.timesOffset = kernel.allocateBytes(animation.times.length * F32_BYTES, DEFAULT_ALIGNMENT);
    this.valuesOffset = kernel.allocateBytes(animation.values.length * F32_BYTES, DEFAULT_ALIGNMENT);
    const view = kernel.dataViewForCurrentMemory();
    for (let index = 0; index < animation.times.length; index += 1) {
      view.setFloat32(this.timesOffset + index * F32_BYTES, animation.times[index]!, true);
    }
    for (let index = 0; index < animation.values.length; index += 1) {
      view.setFloat32(this.valuesOffset + index * F32_BYTES, animation.values[index]!, true);
    }
    for (let index = 0; index < this.trackCount; index += 1) {
      const controller = animation.keyControllers[index]!;
      const descriptor = this.tracksOffset + index * PACKED_TRACK_BYTES;
      const joint = resolvePackedControllerJoint(controller, this.jointCount);
      const property =
        controller.normalizedProperty === "translation" ? 0 : controller.normalizedProperty === "rotation" ? 1 : 2;
      let flags = 0;
      if (controller.sourceRestQuaternion?.length === 4) flags |= 1;
      if (controller.rotationSpace === "normalized-humanoid-delta") flags |= 2;
      view.setUint32(descriptor, joint, true);
      view.setUint32(descriptor + 4, property, true);
      view.setUint32(descriptor + 8, controller.stride, true);
      view.setUint32(descriptor + 12, controller.keyCount, true);
      view.setUint32(descriptor + 16, controller.timeOffset, true);
      view.setUint32(descriptor + 20, controller.valueOffset, true);
      view.setUint32(descriptor + 24, flags, true);
      for (let component = 0; component < 4; component += 1) {
        view.setFloat32(
          descriptor + 28 + component * F32_BYTES,
          controller.sourceRestQuaternion?.[component] ?? (component === 3 ? 1 : 0),
          true
        );
      }
      for (let offset = 44; offset < PACKED_TRACK_BYTES; offset += F32_BYTES) {
        view.setUint32(descriptor + offset, 0, true);
      }
    }
    this.handle = kernel.createPackedClip(
      this.tracksOffset,
      this.trackCount,
      this.timesOffset,
      animation.times.length,
      this.valuesOffset,
      animation.values.length,
      animation.duration
    );
  }

  get available(): boolean {
    return !this.destroyed;
  }

  destroy(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.destroyed = true;
    return this.kernel.destroyHandle(this.handle);
  }
}

export type WasmPackedSamplingSnapshot = {
  sampleCount: number;
  resetCount: number;
  lastMode: "reset" | "coherent-forward" | "seek";
  lastTime: number;
};

/** Retained lower-key cache bound to one packed clip and one pose arena/avatar. */
export class WasmPackedClipSamplingContext {
  readonly lowerKeysOffset: number;
  readonly handle: number;
  readonly transformOutputOffset: number;
  private readonly kernel: WaifuAnimationWasmKernel;
  private readonly arena: WasmPoseArenaContext;
  private readonly asset: WasmPackedClipAsset;
  private destroyed = false;
  private sampleCount = 0;
  private resetCount = 0;
  private lastTime = 0;
  private lastMode: WasmPackedSamplingSnapshot["lastMode"] = "reset";

  constructor(
    kernel: WaifuAnimationWasmKernel,
    arena: WasmPoseArenaContext,
    asset: WasmPackedClipAsset,
    avatarHandle: number
  ) {
    if (asset.jointCount !== arena.jointCount) throw new Error("WASM packed clip and pose arena joint counts differ");
    this.kernel = kernel;
    this.arena = arena;
    this.asset = asset;
    this.lowerKeysOffset = kernel.allocateBytes(asset.trackCount * F32_BYTES, DEFAULT_ALIGNMENT);
    this.transformOutputOffset = kernel.allocateBytes(10 * F32_BYTES, DEFAULT_ALIGNMENT);
    this.handle = kernel.createSamplingContext(asset.handle, this.lowerKeysOffset, asset.trackCount);
    this.avatarHandle = avatarHandle;
  }

  private readonly avatarHandle: number;

  snapshot(): WasmPackedSamplingSnapshot {
    return {
      sampleCount: this.sampleCount,
      resetCount: this.resetCount,
      lastMode: this.lastMode,
      lastTime: this.lastTime
    };
  }

  reset(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    const status = this.kernel.resetSamplingContext(this.handle);
    if (status === WaKernelStatus.Ok) {
      this.resetCount += 1;
      this.lastMode = "reset";
      this.sampleCount = 0;
      this.lastTime = 0;
    }
    return status;
  }

  sampleTime(time: number, outputPose: number, options: WasmPackedSamplingOptions = {}): WaKernelStatus {
    return this.sample(time, outputPose, false, options);
  }

  sampleRatio(
    ratio: number,
    outputPose: number,
    options: Omit<WasmPackedSamplingOptions, "loop"> = {}
  ): WaKernelStatus {
    return this.sample(ratio, outputPose, true, options);
  }

  sampleTimeChecked(
    time: number,
    outputPose: number,
    options: WasmPackedSamplingOptions = {}
  ): WasmPackedSamplingResult {
    const status = this.sampleTime(time, outputPose, options);
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("packed-sampling", status);
    return { kind: this.kernel.executionMode === "simd" ? "wasm-simd" : "wasm-scalar", status };
  }

  /** Sample one carrier joint and materialize its TRS directly from Rust. */
  sampleJointTime(time: number, joint: number, options: WasmPackedSamplingOptions = {}): Transform {
    if (this.destroyed || !this.asset.available) throw new Error("WASM packed sampling context is disposed");
    if (!Number.isInteger(joint) || joint < 0 || joint >= this.arena.jointCount)
      throw new Error("sample joint is outside the skeleton range");
    const loop = options.loop ?? this.asset.animation.loop;
    let flags = loop ? SAMPLE_FLAG_LOOP : 0;
    if (options.resetCache === true) flags |= SAMPLE_FLAG_RESET_CACHE;
    const status = this.kernel.invokePackedJointSample({
      avatarHandle: this.avatarHandle,
      clipHandle: this.asset.handle,
      contextHandle: this.handle,
      restPoseOffset: this.arena.poseOffset(0),
      restPoseCapacityBytes: this.arena.poseStrideBytes,
      outputPoseOffset: this.arena.poseOffset(1),
      outputPoseCapacityBytes: this.arena.poseStrideBytes,
      jointCount: this.arena.jointCount,
      time,
      flags,
      joint,
      outTransformOffset: this.transformOutputOffset
    });
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("packed-joint-sampling", status);
    const values = new Float32Array(this.kernel.memory.buffer, this.transformOutputOffset, 10);
    return {
      translation: [values[0]!, values[1]!, values[2]!],
      rotation: [values[3]!, values[4]!, values[5]!, values[6]!],
      scale: [values[7]!, values[8]!, values[9]!]
    };
  }

  invokeRawForTests(
    overrides: Partial<Parameters<WaifuAnimationWasmKernel["invokePackedSample"]>[0]> = {}
  ): WaKernelStatus {
    return this.kernel.invokePackedSample({
      avatarHandle: this.avatarHandle,
      clipHandle: this.asset.handle,
      contextHandle: this.handle,
      restPoseOffset: this.arena.poseOffset(0),
      restPoseCapacityBytes: this.arena.poseStrideBytes,
      outputPoseOffset: this.arena.poseOffset(1),
      outputPoseCapacityBytes: this.arena.poseStrideBytes,
      jointCount: this.arena.jointCount,
      value: 0,
      flags: 0,
      ratio: false,
      ...overrides
    });
  }

  destroy(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.destroyed = true;
    return this.kernel.destroyHandle(this.handle);
  }

  private sample(
    value: number,
    outputPose: number,
    ratio: boolean,
    options: WasmPackedSamplingOptions | Omit<WasmPackedSamplingOptions, "loop">
  ): WaKernelStatus {
    if (this.destroyed || !this.asset.available) return WaKernelStatus.Unsupported;
    if (outputPose === 0) return WaKernelStatus.InvalidArgument;
    const requestedLoop = "loop" in options ? options.loop : undefined;
    const loop = !ratio && (requestedLoop ?? this.asset.animation.loop);
    let flags = loop ? SAMPLE_FLAG_LOOP : 0;
    if (options.resetCache === true) flags |= SAMPLE_FLAG_RESET_CACHE;
    const resolvedTime = ratio
      ? Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * this.asset.animation.duration
      : resolvePackedSampleTime(this.asset.animation.duration, value, loop);
    this.lastMode =
      options.resetCache === true || this.sampleCount === 0
        ? "reset"
        : resolvedTime < this.lastTime
          ? "seek"
          : "coherent-forward";
    const status = this.kernel.invokePackedSample({
      avatarHandle: this.avatarHandle,
      clipHandle: this.asset.handle,
      contextHandle: this.handle,
      restPoseOffset: this.arena.poseOffset(0),
      restPoseCapacityBytes: this.arena.poseStrideBytes,
      outputPoseOffset: this.arena.poseOffset(outputPose),
      outputPoseCapacityBytes: this.arena.poseStrideBytes,
      jointCount: this.arena.jointCount,
      value,
      flags,
      ratio
    });
    if (status === WaKernelStatus.Ok) {
      this.sampleCount += 1;
      this.lastTime = resolvedTime;
      if (options.resetCache === true) this.resetCount += 1;
    }
    return status;
  }
}

/** Required-kernel facade for ordinary AnimationClip sampling. */
export class WasmClipSamplingContext {
  readonly arena: WasmPoseArenaContext;
  readonly asset: WasmPackedClipAsset;
  readonly sampler: WasmPackedClipSamplingContext;
  private destroyed = false;

  constructor(
    private readonly kernel: WaifuAnimationWasmKernel,
    readonly skeleton: Skeleton,
    readonly clip: AnimationClip
  ) {
    this.arena = kernel.createPoseArenaContext(skeleton, { poseCapacity: 2 });
    this.asset = kernel.createPackedClipAsset(skeleton, buildPackedRuntimeAnimation(clip, skeleton));
    this.sampler = this.arena.createPackedSamplingContext(this.asset);
  }

  sampleTime(time: number, options: WasmPackedSamplingOptions = {}, out: Transform[] = []): Transform[] {
    this.assertAvailable();
    const status = this.sampler.sampleTime(time, 1, options);
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("clip-sampling", status);
    return this.arena.copyPoseToTransforms(1, out);
  }

  sampleRatio(
    ratio: number,
    options: Omit<WasmPackedSamplingOptions, "loop"> = {},
    out: Transform[] = []
  ): Transform[] {
    this.assertAvailable();
    const status = this.sampler.sampleRatio(ratio, 1, options);
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("clip-sampling", status);
    return this.arena.copyPoseToTransforms(1, out);
  }

  snapshot(): WasmPackedSamplingSnapshot & { kind: "wasm-scalar" | "wasm-simd" } {
    return {
      kind: this.kernel.executionMode === "simd" ? "wasm-simd" : "wasm-scalar",
      ...this.sampler.snapshot()
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sampler.destroy();
    this.asset.destroy();
    this.arena.destroy();
  }

  private assertAvailable(): void {
    if (this.destroyed) throw new Error("WASM clip sampling context is disposed");
  }
}

export function createWasmClipSamplingContext(
  kernel: WaifuAnimationWasmKernel,
  skeleton: Skeleton,
  clip: AnimationClip
): WasmClipSamplingContext {
  return kernel.createClipSamplingContext(skeleton, clip);
}

/**
 * Retained scalar-WASM pose arena. Numeric jobs read and write padded SoA slots
 * in-place; steady-state blend/additive calls do not create `Transform[]`.
 * `writePose` and `copyPoseToTransforms` are explicit object packing and
 * materialization adapters and therefore are not allocation-free promises.
 */
export class WasmPoseArenaContext {
  readonly skeleton: Skeleton;
  readonly jointCount: number;
  readonly groupCount: number;
  readonly poseCapacity: number;
  readonly maskCapacity: number;
  readonly maskValueCapacity: number;
  readonly layerCapacity: number;
  readonly poseStrideBytes: number;
  readonly maskStrideBytes: number;
  readonly poseArenaOffset: number;
  readonly maskArenaOffset: number;
  readonly layerDescriptorsOffset: number;
  readonly parentIndicesOffset: number;
  readonly modelPoseOffset: number;
  readonly localToModelOptionsOffset: number;
  readonly rootMatrixOffset: number;
  private readonly kernel: WaifuAnimationWasmKernel;
  readonly avatarHandle: number;
  private readonly skeletonHandle: number;
  private readonly maskLengths: Uint32Array;
  private poseViewCache: Float32Array[];
  private maskViewCache: Float32Array[];
  private modelPoseViewCache: Float32Array;
  private cachedBuffer: ArrayBuffer;
  private destroyed = false;

  constructor(kernel: WaifuAnimationWasmKernel, skeleton: Skeleton, options: WasmPoseArenaOptions = {}) {
    assertSupportedJointCount(skeleton.joints.length);
    this.kernel = kernel;
    this.skeleton = skeleton;
    this.jointCount = skeleton.joints.length;
    this.groupCount = Math.ceil(this.jointCount / 4);
    this.poseCapacity = positiveCapacity(options.poseCapacity, 8, "poseCapacity");
    this.maskCapacity = positiveCapacity(options.maskCapacity, 4, "maskCapacity");
    this.maskValueCapacity = positiveCapacity(options.maskValueCapacity, this.jointCount, "maskValueCapacity");
    this.layerCapacity = positiveCapacity(options.layerCapacity, 8, "layerCapacity");
    this.poseStrideBytes = this.groupCount * SOA_TRANSFORM_BYTES;
    this.maskStrideBytes = this.maskValueCapacity * PARENT_BYTES;
    this.parentIndicesOffset = kernel.allocateBytes(this.jointCount * PARENT_BYTES, DEFAULT_ALIGNMENT);
    this.poseArenaOffset = kernel.allocateBytes(this.poseCapacity * this.poseStrideBytes, DEFAULT_ALIGNMENT);
    this.maskArenaOffset = kernel.allocateBytes(this.maskCapacity * this.maskStrideBytes, DEFAULT_ALIGNMENT);
    this.layerDescriptorsOffset = kernel.allocateBytes(this.layerCapacity * BLEND_LAYER_BYTES, DEFAULT_ALIGNMENT);
    this.modelPoseOffset = kernel.allocateBytes(this.jointCount * MAT4_BYTES, MATRIX_ALIGNMENT);
    this.localToModelOptionsOffset = kernel.allocateBytes(OPTIONS_BYTES, DEFAULT_ALIGNMENT);
    this.rootMatrixOffset = kernel.allocateBytes(MAT4_BYTES, DEFAULT_ALIGNMENT);
    this.cachedBuffer = kernel.memory.buffer;
    this.poseViewCache = this.createPoseViews();
    this.maskViewCache = this.createMaskViews();
    this.modelPoseViewCache = new Float32Array(this.cachedBuffer, this.modelPoseOffset, this.jointCount * MAT4_FLOATS);
    this.maskLengths = new Uint32Array(this.maskCapacity);

    const dataView = kernel.dataViewForCurrentMemory();
    for (let joint = 0; joint < this.jointCount; joint += 1) {
      dataView.setInt32(this.parentIndicesOffset + joint * PARENT_BYTES, readSkeletonParent(skeleton, joint), true);
    }
    this.skeletonHandle = kernel.createSkeleton(
      this.parentIndicesOffset,
      this.jointCount,
      this.jointCount * PARENT_BYTES
    );
    this.avatarHandle = kernel.createAvatar(this.skeletonHandle, this.jointCount);
    for (let slot = 0; slot < this.poseCapacity; slot += 1) writeIdentitySoa(this.poseView(slot), this.jointCount);
    for (let slot = 0; slot < this.maskCapacity; slot += 1) this.maskView(slot).fill(0);
    this.writePose(0, skeleton.restPose);
    this.modelPoseViewCache.fill(0);
  }

  createPackedSamplingContext(asset: WasmPackedClipAsset): WasmPackedClipSamplingContext {
    if (this.destroyed) throw new Error("WASM pose arena is destroyed");
    return new WasmPackedClipSamplingContext(this.kernel, this, asset, this.avatarHandle);
  }

  poseOffset(slot: number): number {
    this.assertPoseSlot(slot);
    return this.poseArenaOffset + slot * this.poseStrideBytes;
  }

  maskOffset(slot: number): number {
    this.assertMaskSlot(slot);
    return this.maskArenaOffset + slot * this.maskStrideBytes;
  }

  poseView(slot: number): Float32Array {
    this.assertPoseSlot(slot);
    this.refreshViews();
    return this.poseViewCache[slot]!;
  }

  maskView(slot: number): Float32Array {
    this.assertMaskSlot(slot);
    this.refreshViews();
    return this.maskViewCache[slot]!;
  }

  get modelPoseView(): Float32Array {
    this.refreshViews();
    return this.modelPoseViewCache;
  }

  writePose(slot: number, pose: readonly Transform[]): Float32Array {
    if (pose.length !== this.jointCount) {
      throw new Error(`pose length ${pose.length} does not match WASM pose arena ${this.jointCount}`);
    }
    return writeTransformPoseToSoa(pose, this.poseView(slot), this.jointCount);
  }

  copyPoseToTransforms(slot: number, out: Transform[] = []): Transform[] {
    return copySoaPoseToTransformPose(this.poseView(slot), this.jointCount, out);
  }

  writeMask(slot: number, mask: ArrayLike<number>): Float32Array {
    if (mask.length > this.maskValueCapacity) {
      throw new Error(`mask length ${mask.length} exceeds WASM mask slot capacity ${this.maskValueCapacity}`);
    }
    const view = this.maskView(slot);
    view.fill(0);
    for (let index = 0; index < mask.length; index += 1) view[index] = Number(mask[index]);
    this.maskLengths[slot] = mask.length;
    return view;
  }

  writeSparseMask(
    slot: number,
    entries: readonly { joint: number; weight: number }[],
    length = this.jointCount
  ): Float32Array {
    if (!Number.isInteger(length) || length < 0 || length > this.maskValueCapacity) {
      throw new Error(`sparse mask length ${length} exceeds WASM mask slot capacity ${this.maskValueCapacity}`);
    }
    const view = this.maskView(slot);
    view.fill(0);
    for (const entry of entries) {
      if (Number.isInteger(entry.joint) && entry.joint >= 0 && entry.joint < length) {
        view[entry.joint] = entry.weight;
      }
    }
    this.maskLengths[slot] = length;
    return view;
  }

  blend(layers: readonly WasmPoseBlendLayer[], options: WasmPoseBlendOptions): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    if (layers.length > this.layerCapacity) return WaKernelStatus.Capacity;
    this.refreshViews();
    const dataView = this.kernel.dataViewForCurrentMemory();
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]!;
      const descriptor = this.layerDescriptorsOffset + index * BLEND_LAYER_BYTES;
      const poseOffset = this.poseOffset(layer.pose);
      let maskOffset = 0;
      let maskCount = 0;
      let maskCapacityBytes = 0;
      if (layer.mask !== undefined) {
        this.assertMaskSlot(layer.mask);
        maskOffset = this.maskOffset(layer.mask);
        maskCount = layer.maskCount ?? this.maskLengths[layer.mask]!;
        if (!Number.isInteger(maskCount) || maskCount < 0 || maskCount > this.maskValueCapacity) {
          return WaKernelStatus.Capacity;
        }
        maskCapacityBytes = this.maskStrideBytes;
      }
      dataView.setUint32(descriptor, poseOffset, true);
      dataView.setUint32(descriptor + 4, this.poseStrideBytes, true);
      dataView.setFloat32(descriptor + 8, layer.weight, true);
      dataView.setUint32(descriptor + 12, maskOffset, true);
      dataView.setUint32(descriptor + 16, maskCount, true);
      dataView.setUint32(descriptor + 20, maskCapacityBytes, true);
    }
    const fallbackPose = options.fallbackPose ?? 0;
    this.assertPoseSlot(fallbackPose);
    this.assertPoseSlot(options.outputPose);
    return this.kernel.invokeBlendPoses({
      avatarHandle: this.avatarHandle,
      layersOffset: this.layerDescriptorsOffset,
      layerCount: layers.length,
      layersCapacityBytes: this.layerCapacity * BLEND_LAYER_BYTES,
      fallbackPoseOffset: this.poseOffset(fallbackPose),
      fallbackPoseCapacityBytes: this.poseStrideBytes,
      restPoseOffset: this.poseOffset(0),
      restPoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(options.outputPose),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount,
      threshold: options.threshold ?? 0.1
    });
  }

  additiveDelta(restPose: number, samplePose: number, outputPose: number): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    return this.kernel.invokeAdditiveDelta({
      avatarHandle: this.avatarHandle,
      restPoseOffset: this.poseOffset(restPose),
      restPoseCapacityBytes: this.poseStrideBytes,
      samplePoseOffset: this.poseOffset(samplePose),
      samplePoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(outputPose),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount
    });
  }

  applyAdditive(
    basePose: number,
    deltaPose: number,
    weight: number,
    outputPose: number,
    mask?: number,
    maskCount?: number
  ): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    let resolvedMaskOffset = 0;
    let resolvedMaskCount = 0;
    let resolvedMaskCapacity = 0;
    if (mask !== undefined) {
      this.assertMaskSlot(mask);
      resolvedMaskOffset = this.maskOffset(mask);
      resolvedMaskCount = maskCount ?? this.maskLengths[mask]!;
      if (!Number.isInteger(resolvedMaskCount) || resolvedMaskCount < 0 || resolvedMaskCount > this.maskValueCapacity) {
        return WaKernelStatus.Capacity;
      }
      resolvedMaskCapacity = this.maskStrideBytes;
    }
    return this.kernel.invokeApplyAdditive({
      avatarHandle: this.avatarHandle,
      basePoseOffset: this.poseOffset(basePose),
      basePoseCapacityBytes: this.poseStrideBytes,
      deltaPoseOffset: this.poseOffset(deltaPose),
      deltaPoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(outputPose),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount,
      weight,
      maskOffset: resolvedMaskOffset,
      maskCount: resolvedMaskCount,
      maskCapacityBytes: resolvedMaskCapacity
    });
  }

  normalize(inputPose: number, outputPose = inputPose): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    return this.kernel.invokeNormalizePose({
      avatarHandle: this.avatarHandle,
      inputPoseOffset: this.poseOffset(inputPose),
      inputPoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(outputPose),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount
    });
  }

  localToModel(pose: number, options: WasmLocalToModelUpdateOptions = {}): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    const resolved = resolveUpdateRange(this.jointCount, options);
    const view = this.kernel.dataViewForCurrentMemory();
    let flags = resolved.fromExcluded ? OPTION_FLAG_FROM_EXCLUDED : 0;
    if (resolved.root) {
      if (resolved.root.length < MAT4_FLOATS) return WaKernelStatus.InvalidArgument;
      new Float32Array(this.kernel.memory.buffer, this.rootMatrixOffset, MAT4_FLOATS).set(
        resolved.root.subarray(0, 16)
      );
      flags |= OPTION_FLAG_HAS_ROOT;
    }
    view.setUint32(this.localToModelOptionsOffset, this.parentIndicesOffset, true);
    view.setUint32(this.localToModelOptionsOffset + 4, this.jointCount, true);
    view.setUint32(this.localToModelOptionsOffset + 8, this.jointCount * PARENT_BYTES, true);
    view.setInt32(this.localToModelOptionsOffset + 12, resolved.from, true);
    view.setInt32(this.localToModelOptionsOffset + 16, resolved.to, true);
    view.setUint32(this.localToModelOptionsOffset + 20, flags, true);
    view.setUint32(this.localToModelOptionsOffset + 24, resolved.root ? this.rootMatrixOffset : 0, true);
    view.setUint32(this.localToModelOptionsOffset + 28, resolved.root ? MAT4_BYTES : 0, true);
    return this.kernel.invokeLocalToModel(
      this.avatarHandle,
      this.poseOffset(pose),
      this.modelPoseOffset,
      this.jointCount,
      this.localToModelOptionsOffset
    );
  }

  invokeRawBlendForTests(overrides: Partial<WasmRawBlendInvocation> = {}): WaKernelStatus {
    return this.kernel.invokeBlendPoses({
      avatarHandle: this.avatarHandle,
      layersOffset: this.layerDescriptorsOffset,
      layerCount: 0,
      layersCapacityBytes: this.layerCapacity * BLEND_LAYER_BYTES,
      fallbackPoseOffset: this.poseOffset(0),
      fallbackPoseCapacityBytes: this.poseStrideBytes,
      restPoseOffset: this.poseOffset(0),
      restPoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(1),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount,
      threshold: 0.1,
      ...overrides
    });
  }

  invokeRawAdditiveDeltaForTests(overrides: Partial<WasmRawAdditiveDeltaInvocation> = {}): WaKernelStatus {
    return this.kernel.invokeAdditiveDelta({
      avatarHandle: this.avatarHandle,
      restPoseOffset: this.poseOffset(0),
      restPoseCapacityBytes: this.poseStrideBytes,
      samplePoseOffset: this.poseOffset(1),
      samplePoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(2),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount,
      ...overrides
    });
  }

  destroy(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.destroyed = true;
    const avatarStatus = this.kernel.destroyHandle(this.avatarHandle);
    const skeletonStatus = this.kernel.destroyHandle(this.skeletonHandle);
    return avatarStatus === WaKernelStatus.Ok ? skeletonStatus : avatarStatus;
  }

  refreshViews(): void {
    this.kernel.refreshViewsIfNeeded();
    if (this.cachedBuffer !== this.kernel.memory.buffer) {
      this.cachedBuffer = this.kernel.memory.buffer;
      this.poseViewCache = this.createPoseViews();
      this.maskViewCache = this.createMaskViews();
      this.modelPoseViewCache = new Float32Array(
        this.cachedBuffer,
        this.modelPoseOffset,
        this.jointCount * MAT4_FLOATS
      );
    }
  }

  private createPoseViews(): Float32Array[] {
    return Array.from(
      { length: this.poseCapacity },
      (_value, slot) =>
        new Float32Array(
          this.cachedBuffer,
          this.poseArenaOffset + slot * this.poseStrideBytes,
          this.poseStrideBytes / F32_BYTES
        )
    );
  }

  private createMaskViews(): Float32Array[] {
    return Array.from(
      { length: this.maskCapacity },
      (_value, slot) =>
        new Float32Array(this.cachedBuffer, this.maskArenaOffset + slot * this.maskStrideBytes, this.maskValueCapacity)
    );
  }

  private assertPoseSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.poseCapacity) {
      throw new Error(`WASM pose slot ${slot} is out of range`);
    }
  }

  private assertMaskSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maskCapacity) {
      throw new Error(`WASM mask slot ${slot} is out of range`);
    }
  }
}

export type WasmTwoBoneCorrection = {
  kind: "two-bone";
  rootJoint: number;
  midJoint: number;
  endJoint: number;
  target: readonly [number, number, number];
  pole?: readonly [number, number, number];
  midAxis?: readonly [number, number, number];
  twistAngle?: number;
  soften?: number;
  weight?: number;
  maxStretch?: number;
};

export type WasmAimCorrection = {
  kind: "aim";
  joint: number;
  target: readonly [number, number, number];
  forward?: readonly [number, number, number];
  up?: readonly [number, number, number];
  pole?: readonly [number, number, number];
  offset?: readonly [number, number, number];
  twistAngle?: number;
  weight?: number;
};

export type WasmFootCorrection = {
  kind: "foot";
  hipJoint: number;
  kneeJoint: number;
  ankleJoint: number;
  /** TypeScript-resolved ankle target after contact projection, policy, and bilateral pelvis compensation. */
  targetAnkle: readonly [number, number, number];
  pole?: readonly [number, number, number];
  maxStretch?: number;
  influence?: number;
  /** Optional TypeScript-resolved model-space ankle orientation target. */
  orientationTarget?: readonly [number, number, number];
  ankleUp?: readonly [number, number, number];
  footForward?: readonly [number, number, number];
  orientationWeight?: number;
};

export type WasmProceduralCorrection = WasmTwoBoneCorrection | WasmAimCorrection | WasmFootCorrection;
export type WasmProceduralCorrectionContextOptions = { capacity?: number };
export type WasmProceduralCorrectionRunResult = {
  kind: "wasm-scalar" | "wasm-simd";
  status: WaKernelStatus.Ok;
};

const PROCEDURAL_DESCRIPTOR_BYTES = 192;
const PROCEDURAL_FLAG_POLE = 1 << 0;
const PROCEDURAL_FLAG_MID_AXIS = 1 << 1;
const PROCEDURAL_FLAG_UP = 1 << 2;
const PROCEDURAL_FLAG_OFFSET = 1 << 3;
const PROCEDURAL_FLAG_ORIENTATION = 1 << 4;

/**
 * Retained ABI v1.4 scalar correction queue over an existing pose arena. Contact queries,
 * lock/stick policy, skipped statuses, pelvis target selection, and reports remain TypeScript-owned.
 * A successful run applies descriptors in submission order and refreshes each corrected subtree.
 */
export class WasmProceduralCorrectionContext {
  readonly capacity: number;
  readonly descriptorsOffset: number;
  private readonly optionsOffset: number;

  constructor(
    private readonly kernel: WaifuAnimationWasmKernel,
    private readonly arena: WasmPoseArenaContext,
    options: WasmProceduralCorrectionContextOptions = {}
  ) {
    this.capacity = positiveCapacity(options.capacity, 8, "procedural correction capacity");
    this.descriptorsOffset = kernel.allocateBytes(this.capacity * PROCEDURAL_DESCRIPTOR_BYTES, DEFAULT_ALIGNMENT);
    this.optionsOffset = kernel.allocateBytes(OPTIONS_BYTES, DEFAULT_ALIGNMENT);
  }

  run(
    pose: number,
    corrections: readonly WasmProceduralCorrection[],
    updateTo = this.arena.jointCount - 1
  ): WasmProceduralCorrectionRunResult {
    if (corrections.length > this.capacity)
      throw new WaKernelJobError("procedural-corrections", WaKernelStatus.Capacity);
    if (!Number.isInteger(updateTo) || updateTo < 0 || updateTo >= this.arena.jointCount)
      throw new WaKernelJobError(
        "procedural-corrections",
        WaKernelStatus.InvalidArgument,
        "invalid correction update range"
      );
    this.arena.poseOffset(pose);
    const view = this.kernel.dataViewForCurrentMemory();
    for (let index = 0; index < corrections.length; index += 1) this.writeDescriptor(view, index, corrections[index]!);
    view.setUint32(this.optionsOffset, this.arena.parentIndicesOffset, true);
    view.setUint32(this.optionsOffset + 4, this.arena.jointCount, true);
    view.setUint32(this.optionsOffset + 8, this.arena.jointCount * PARENT_BYTES, true);
    view.setInt32(this.optionsOffset + 12, NO_PARENT, true);
    view.setInt32(this.optionsOffset + 16, updateTo, true);
    view.setUint32(this.optionsOffset + 20, 0, true);
    view.setUint32(this.optionsOffset + 24, 0, true);
    view.setUint32(this.optionsOffset + 28, 0, true);
    const status = this.kernel.invokeProceduralCorrections(
      this.arena.avatarHandle,
      this.arena.poseOffset(pose),
      this.arena.poseStrideBytes,
      this.arena.modelPoseOffset,
      this.arena.jointCount * MAT4_BYTES,
      this.arena.jointCount,
      this.descriptorsOffset,
      corrections.length,
      this.capacity * PROCEDURAL_DESCRIPTOR_BYTES,
      this.optionsOffset
    );
    if (status !== WaKernelStatus.Ok) throw new WaKernelJobError("procedural-corrections", status);
    return { kind: this.kernel.executionMode === "simd" ? "wasm-simd" : "wasm-scalar", status };
  }

  invokeRawForTests(
    input: { pose?: number; count?: number; capacityBytes?: number; descriptorsOffset?: number } = {}
  ): WaKernelStatus {
    return this.kernel.invokeProceduralCorrections(
      this.arena.avatarHandle,
      this.arena.poseOffset(input.pose ?? 0),
      this.arena.poseStrideBytes,
      this.arena.modelPoseOffset,
      this.arena.jointCount * MAT4_BYTES,
      this.arena.jointCount,
      input.descriptorsOffset ?? this.descriptorsOffset,
      input.count ?? 0,
      input.capacityBytes ?? this.capacity * PROCEDURAL_DESCRIPTOR_BYTES,
      this.optionsOffset
    );
  }

  private writeDescriptor(view: DataView, index: number, correction: WasmProceduralCorrection): void {
    const base = this.descriptorsOffset + index * PROCEDURAL_DESCRIPTOR_BYTES;
    new Uint8Array(view.buffer, base, PROCEDURAL_DESCRIPTOR_BYTES).fill(0);
    const writeVec = (offset: number, value: readonly [number, number, number]): void => {
      view.setFloat32(base + offset, value[0], true);
      view.setFloat32(base + offset + 4, value[1], true);
      view.setFloat32(base + offset + 8, value[2], true);
    };
    if (correction.kind === "two-bone") {
      let flags = 0;
      if (correction.pole) flags |= PROCEDURAL_FLAG_POLE;
      if (correction.midAxis) flags |= PROCEDURAL_FLAG_MID_AXIS;
      view.setUint32(base, 1, true);
      view.setUint32(base + 4, flags, true);
      view.setInt32(base + 8, correction.rootJoint, true);
      view.setInt32(base + 12, correction.midJoint, true);
      view.setInt32(base + 16, correction.endJoint, true);
      writeVec(24, correction.target);
      if (correction.pole) writeVec(36, correction.pole);
      if (correction.midAxis) writeVec(48, correction.midAxis);
      view.setFloat32(base + 72, correction.twistAngle ?? 0, true);
      view.setFloat32(base + 76, correction.soften ?? 0.998, true);
      view.setFloat32(base + 80, correction.weight ?? 1, true);
      view.setFloat32(base + 84, correction.maxStretch ?? 1, true);
    } else if (correction.kind === "aim") {
      let flags = 0;
      if (correction.pole) flags |= PROCEDURAL_FLAG_POLE;
      if (correction.up) flags |= PROCEDURAL_FLAG_UP;
      if (correction.offset) flags |= PROCEDURAL_FLAG_OFFSET;
      view.setUint32(base, 2, true);
      view.setUint32(base + 4, flags, true);
      view.setInt32(base + 8, correction.joint, true);
      writeVec(24, correction.target);
      writeVec(36, correction.forward ?? [1, 0, 0]);
      writeVec(48, correction.up ?? [0, 1, 0]);
      writeVec(60, correction.pole ?? [0, 1, 0]);
      writeVec(72, correction.offset ?? [0, 0, 0]);
      view.setFloat32(base + 84, correction.twistAngle ?? 0, true);
      view.setFloat32(base + 88, correction.weight ?? 1, true);
    } else {
      let flags = 0;
      if (correction.pole) flags |= PROCEDURAL_FLAG_POLE;
      if (correction.orientationTarget) flags |= PROCEDURAL_FLAG_ORIENTATION;
      view.setUint32(base, 3, true);
      view.setUint32(base + 4, flags, true);
      view.setInt32(base + 8, correction.hipJoint, true);
      view.setInt32(base + 12, correction.kneeJoint, true);
      view.setInt32(base + 16, correction.ankleJoint, true);
      writeVec(24, correction.targetAnkle);
      if (correction.pole) writeVec(36, correction.pole);
      view.setFloat32(base + 76, 0.998, true);
      view.setFloat32(base + 80, correction.influence ?? 1, true);
      view.setFloat32(base + 84, correction.maxStretch ?? 1, true);
      if (correction.orientationTarget) {
        writeVec(104, correction.orientationTarget);
        writeVec(116, correction.ankleUp ?? [0, 1, 0]);
        writeVec(128, correction.footForward ?? [0, 0, 1]);
        writeVec(140, correction.footForward ?? [0, 0, 1]);
        view.setFloat32(base + 164, 0, true);
        view.setFloat32(base + 168, correction.orientationWeight ?? correction.influence ?? 1, true);
      }
    }
  }
}

export class WasmLocalToModelContext {
  readonly jointCount: number;
  readonly groupCount: number;
  readonly localPoseOffset: number;
  readonly modelPoseOffset: number;
  readonly parentIndicesOffset: number;
  readonly optionsOffset: number;
  readonly rootMatrixOffset: number;
  private readonly avatarHandle: number;
  private readonly skeletonHandle: number;
  private readonly kernel: WaifuAnimationWasmKernel;
  private readonly parents: Int32Array;
  private localPoseViewCache: Float32Array;
  private modelPoseViewCache: Float32Array;
  private cachedBuffer: ArrayBuffer;
  private destroyed = false;

  constructor(kernel: WaifuAnimationWasmKernel, skeleton: Skeleton) {
    assertSupportedJointCount(skeleton.joints.length);
    this.kernel = kernel;
    this.jointCount = skeleton.joints.length;
    this.groupCount = Math.ceil(this.jointCount / 4);
    this.parentIndicesOffset = kernel.allocateBytes(this.jointCount * PARENT_BYTES, DEFAULT_ALIGNMENT);
    this.localPoseOffset = kernel.allocateBytes(this.groupCount * SOA_TRANSFORM_BYTES, DEFAULT_ALIGNMENT);
    this.modelPoseOffset = kernel.allocateBytes(this.jointCount * MAT4_BYTES, MATRIX_ALIGNMENT);
    this.optionsOffset = kernel.allocateBytes(OPTIONS_BYTES, DEFAULT_ALIGNMENT);
    this.rootMatrixOffset = kernel.allocateBytes(MAT4_BYTES, DEFAULT_ALIGNMENT);
    this.cachedBuffer = kernel.memory.buffer;
    this.localPoseViewCache = new Float32Array(
      this.cachedBuffer,
      this.localPoseOffset,
      this.groupCount * SOA_TRANSFORM_FLOATS
    );
    this.modelPoseViewCache = new Float32Array(this.cachedBuffer, this.modelPoseOffset, this.jointCount * MAT4_FLOATS);
    this.parents = Int32Array.from(
      Array.from({ length: this.jointCount }, (_value, index) => readSkeletonParent(skeleton, index))
    );
    this.writeParents();
    this.skeletonHandle = kernel.createSkeleton(
      this.parentIndicesOffset,
      this.jointCount,
      this.jointCount * PARENT_BYTES
    );
    this.avatarHandle = kernel.createAvatar(this.skeletonHandle, this.jointCount);
    writeIdentitySoa(this.localPoseViewCache, this.jointCount);
    this.modelPoseViewCache.fill(0);
  }

  get localPoseView(): Float32Array {
    this.refreshViews();
    return this.localPoseViewCache;
  }

  get modelPoseView(): Float32Array {
    this.refreshViews();
    return this.modelPoseViewCache;
  }

  destroy(): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.destroyed = true;
    const avatarStatus = this.kernel.destroyHandle(this.avatarHandle);
    const skeletonStatus = this.kernel.destroyHandle(this.skeletonHandle);
    return avatarStatus === WaKernelStatus.Ok ? skeletonStatus : avatarStatus;
  }

  writeLocalPose(localPose: readonly Transform[]): void {
    if (localPose.length !== this.jointCount) {
      throw new Error(`local pose length ${localPose.length} does not match WASM context ${this.jointCount}`);
    }
    writeTransformPoseToSoa(localPose, this.localPoseView, this.jointCount);
  }

  updateModelPoseFromSoa(options: WasmLocalToModelUpdateOptions = {}): WaKernelStatus {
    if (this.destroyed) return WaKernelStatus.BadHandle;
    this.refreshViews();
    const resolved = resolveUpdateRange(this.jointCount, options);
    this.writeOptions(resolved);
    return this.kernel.invokeLocalToModel(
      this.avatarHandle,
      this.localPoseOffset,
      this.modelPoseOffset,
      this.jointCount,
      this.optionsOffset
    );
  }

  updateModelPoseFromTransformPose(
    localPose: readonly Transform[],
    out: Mat4[] = [],
    options: WasmLocalToModelUpdateOptions = {}
  ): Mat4[] | undefined {
    if (localPose.length !== this.jointCount) return undefined;
    this.writeLocalPose(localPose);
    const resolved = resolveUpdateRange(this.jointCount, options);
    if (!this.prepareExistingModelPoseForPartialRange(out, resolved)) return undefined;
    const status = this.updateModelPoseFromSoa(resolved);
    if (status !== WaKernelStatus.Ok) return undefined;
    copyUpdatedModelPoseToMat4Array(this.modelPoseView, out, this.parents, resolved);
    return out;
  }

  tryUpdateLocalToModelPoseRange(
    skeleton: Skeleton,
    localPose: readonly Transform[],
    out: Mat4[],
    options: WasmLocalToModelUpdateOptions = {}
  ): Mat4[] | undefined {
    if (skeleton.joints.length !== this.jointCount) return undefined;
    return this.updateModelPoseFromTransformPose(localPose, out, options);
  }

  invokeRawLocalToModelForTests(input: {
    avatarHandle?: number;
    localPoseOffset?: number;
    modelPoseOffset?: number;
    jointCount?: number;
    optionsOffset?: number;
  }): WaKernelStatus {
    return this.kernel.invokeLocalToModel(
      input.avatarHandle ?? this.avatarHandle,
      input.localPoseOffset ?? this.localPoseOffset,
      input.modelPoseOffset ?? this.modelPoseOffset,
      input.jointCount ?? this.jointCount,
      input.optionsOffset ?? this.optionsOffset
    );
  }

  refreshViews(): void {
    this.kernel.refreshViewsIfNeeded();
    if (this.cachedBuffer !== this.kernel.memory.buffer) {
      this.cachedBuffer = this.kernel.memory.buffer;
      this.localPoseViewCache = new Float32Array(
        this.cachedBuffer,
        this.localPoseOffset,
        this.groupCount * SOA_TRANSFORM_FLOATS
      );
      this.modelPoseViewCache = new Float32Array(
        this.cachedBuffer,
        this.modelPoseOffset,
        this.jointCount * MAT4_FLOATS
      );
    }
  }

  private writeParents(): void {
    const view = this.kernel.dataViewForCurrentMemory();
    for (let joint = 0; joint < this.jointCount; joint += 1) {
      view.setInt32(this.parentIndicesOffset + joint * PARENT_BYTES, this.parents[joint] ?? NO_PARENT, true);
    }
  }

  private writeOptions(options: ResolvedLocalToModelUpdateOptions): void {
    const view = this.kernel.dataViewForCurrentMemory();
    let flags = options.fromExcluded ? OPTION_FLAG_FROM_EXCLUDED : 0;
    if (options.root) {
      this.writeRootMatrix(options.root);
      flags |= OPTION_FLAG_HAS_ROOT;
    }
    view.setUint32(this.optionsOffset, this.parentIndicesOffset, true);
    view.setUint32(this.optionsOffset + 4, this.jointCount, true);
    view.setUint32(this.optionsOffset + 8, this.jointCount * PARENT_BYTES, true);
    view.setInt32(this.optionsOffset + 12, options.from, true);
    view.setInt32(this.optionsOffset + 16, options.to, true);
    view.setUint32(this.optionsOffset + 20, flags, true);
    view.setUint32(this.optionsOffset + 24, options.root ? this.rootMatrixOffset : 0, true);
    view.setUint32(this.optionsOffset + 28, options.root ? MAT4_BYTES : 0, true);
  }

  private writeRootMatrix(root: Mat4): void {
    this.refreshViews();
    if (root.length < MAT4_FLOATS) throw new Error("local-to-model root must contain 16 values");
    new Float32Array(this.cachedBuffer, this.rootMatrixOffset, MAT4_FLOATS).set(root.subarray(0, MAT4_FLOATS));
  }

  private prepareExistingModelPoseForPartialRange(
    out: readonly (Mat4 | undefined)[],
    options: ResolvedLocalToModelUpdateOptions
  ): boolean {
    if (options.from === NO_PARENT) return true;
    const from = options.from;
    const requiredParent = options.fromExcluded ? from : (this.parents[from] ?? NO_PARENT);
    if (requiredParent === NO_PARENT) return true;
    const parentMatrix = out[requiredParent];
    if (!parentMatrix || parentMatrix.length < MAT4_FLOATS) return false;
    this.copyExistingModelPoseFromMat4Array(out);
    return true;
  }

  private copyExistingModelPoseFromMat4Array(out: readonly (Mat4 | undefined)[]): void {
    const modelPose = this.modelPoseView;
    for (let joint = 0; joint < this.jointCount; joint += 1) {
      const source = out[joint];
      if (source && source.length >= MAT4_FLOATS) modelPose.set(source.subarray(0, MAT4_FLOATS), joint * MAT4_FLOATS);
    }
  }
}

type ResolvedLocalToModelUpdateOptions = {
  root?: Mat4;
  from: number;
  to: number;
  fromExcluded: boolean;
};

export function writeTransformPoseToSoa(
  pose: readonly Transform[],
  target: Float32Array,
  jointCount = pose.length
): Float32Array {
  assertSupportedJointCount(jointCount);
  if (target.length < Math.ceil(jointCount / 4) * SOA_TRANSFORM_FLOATS) {
    throw new Error("local pose SoA target capacity is too small");
  }
  writeIdentitySoa(target, jointCount);
  for (let joint = 0; joint < jointCount; joint += 1) {
    const transform = pose[joint];
    if (!transform) continue;
    const groupBase = (joint >> 2) * SOA_TRANSFORM_FLOATS;
    const lane = joint & 3;
    const rotation = normalizeQuat(transform.rotation);
    target[groupBase + lane] = finiteOr(transform.translation[0], 0);
    target[groupBase + 4 + lane] = finiteOr(transform.translation[1], 0);
    target[groupBase + 8 + lane] = finiteOr(transform.translation[2], 0);
    target[groupBase + 12 + lane] = rotation[0];
    target[groupBase + 16 + lane] = rotation[1];
    target[groupBase + 20 + lane] = rotation[2];
    target[groupBase + 24 + lane] = rotation[3];
    target[groupBase + 28 + lane] = finiteOr(transform.scale[0], 1);
    target[groupBase + 32 + lane] = finiteOr(transform.scale[1], 1);
    target[groupBase + 36 + lane] = finiteOr(transform.scale[2], 1);
  }
  return target;
}

export function copySoaPoseToTransformPose(
  source: Float32Array,
  jointCount: number,
  out: Transform[] = []
): Transform[] {
  assertSupportedJointCount(jointCount);
  if (source.length < Math.ceil(jointCount / 4) * SOA_TRANSFORM_FLOATS) {
    throw new Error("local pose SoA source capacity is too small");
  }
  out.length = jointCount;
  for (let joint = 0; joint < jointCount; joint += 1) {
    const groupBase = (joint >> 2) * SOA_TRANSFORM_FLOATS;
    const lane = joint & 3;
    const translation: Transform["translation"] = [
      finiteOr(source[groupBase + lane], 0),
      finiteOr(source[groupBase + 4 + lane], 0),
      finiteOr(source[groupBase + 8 + lane], 0)
    ];
    const rotation = normalizeQuat([
      finiteOr(source[groupBase + 12 + lane], 0),
      finiteOr(source[groupBase + 16 + lane], 0),
      finiteOr(source[groupBase + 20 + lane], 0),
      finiteOr(source[groupBase + 24 + lane], 1)
    ]);
    const scale: Transform["scale"] = [
      finiteOr(source[groupBase + 28 + lane], 1),
      finiteOr(source[groupBase + 32 + lane], 1),
      finiteOr(source[groupBase + 36 + lane], 1)
    ];
    const existing = out[joint];
    if (existing) {
      existing.translation[0] = translation[0];
      existing.translation[1] = translation[1];
      existing.translation[2] = translation[2];
      existing.rotation[0] = rotation[0];
      existing.rotation[1] = rotation[1];
      existing.rotation[2] = rotation[2];
      existing.rotation[3] = rotation[3];
      existing.scale[0] = scale[0];
      existing.scale[1] = scale[1];
      existing.scale[2] = scale[2];
    } else {
      out[joint] = { translation, rotation, scale };
    }
  }
  return out;
}

export function copyModelPoseViewToMat4Array(modelPose: Float32Array, out: Mat4[] = []): Mat4[] {
  const jointCount = Math.floor(modelPose.length / MAT4_FLOATS);
  out.length = jointCount;
  for (let joint = 0; joint < jointCount; joint += 1) {
    let matrix = out[joint];
    if (!matrix || matrix.length !== MAT4_FLOATS) {
      matrix = new Float32Array(MAT4_FLOATS);
      out[joint] = matrix;
    }
    matrix.set(modelPose.subarray(joint * MAT4_FLOATS, joint * MAT4_FLOATS + MAT4_FLOATS));
  }
  return out;
}

function copyUpdatedModelPoseToMat4Array(
  modelPose: Float32Array,
  out: Mat4[],
  parents: Int32Array,
  options: ResolvedLocalToModelUpdateOptions
): Mat4[] {
  const jointCount = parents.length;
  out.length = jointCount;
  if (options.from === NO_PARENT && options.to >= jointCount - 1 && !options.fromExcluded) {
    return copyModelPoseViewToMat4Array(modelPose, out);
  }

  const selected = new Uint8Array(jointCount);
  for (let joint = 0; joint < jointCount; joint += 1) {
    const parent = parents[joint] ?? NO_PARENT;
    if (options.from === NO_PARENT || joint === options.from || (parent >= 0 && selected[parent] === 1)) {
      selected[joint] = 1;
    }
    if (selected[joint] !== 1 || joint > options.to || (options.fromExcluded && joint === options.from)) continue;
    let matrix = out[joint];
    if (!matrix || matrix.length !== MAT4_FLOATS) {
      matrix = new Float32Array(MAT4_FLOATS);
      out[joint] = matrix;
    }
    matrix.set(modelPose.subarray(joint * MAT4_FLOATS, joint * MAT4_FLOATS + MAT4_FLOATS));
  }
  return out;
}

function writeIdentitySoa(target: Float32Array, jointCount: number): void {
  const groupCount = Math.ceil(jointCount / 4);
  for (let group = 0; group < groupCount; group += 1) {
    const base = group * SOA_TRANSFORM_FLOATS;
    target.fill(0, base, base + SOA_TRANSFORM_FLOATS);
    target.fill(1, base + 24, base + 28);
    target.fill(1, base + 28, base + 40);
  }
}

function resolveUpdateRange(
  jointCount: number,
  options: WasmLocalToModelUpdateOptions
): ResolvedLocalToModelUpdateOptions {
  const from = options.from ?? NO_PARENT;
  const to = options.to ?? jointCount - 1;
  if (!Number.isInteger(from) || from < NO_PARENT || from >= jointCount) {
    throw new Error("local-to-model from is out of range");
  }
  if (!Number.isInteger(to) || to < 0 || to >= jointCount) throw new Error("local-to-model to is out of range");
  const resolved: ResolvedLocalToModelUpdateOptions = { from, to, fromExcluded: options.fromExcluded === true };
  if (options.root !== undefined) resolved.root = options.root;
  return resolved;
}

function assertSupportedJointCount(jointCount: number): void {
  if (!Number.isInteger(jointCount) || jointCount <= 0 || jointCount > MAX_JOINTS) {
    throw new Error(`WASM local-to-model joint count ${jointCount} is out of range`);
  }
}

function positiveCapacity(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > MAX_JOINTS) {
    throw new Error(`WASM pose arena ${name} ${resolved} is out of range`);
  }
  return resolved;
}

type RetainedSkinningLayout = { offset: number; stride: number; length: number };
type RetainedSkinningLayouts = {
  positions: RetainedSkinningLayout;
  normals?: RetainedSkinningLayout;
  tangents?: RetainedSkinningLayout;
  outPositions: RetainedSkinningLayout;
  outNormals?: RetainedSkinningLayout;
  outTangents?: RetainedSkinningLayout;
};

function createRetainedSkinningLayouts(
  options: WasmSkinningContextOptions,
  vertexCount: number,
  positionLayout: Omit<RetainedSkinningLayout, "length">
): RetainedSkinningLayouts {
  const positions = retainedLayoutWithLength(positionLayout, vertexCount, options.positions?.data);
  const outPositionBase = retainedAttributeLayout(options.outPositions, 3);
  const outPositions = retainedLayoutWithLength(outPositionBase, vertexCount, options.outPositions?.data);
  const result: RetainedSkinningLayouts = { positions, outPositions };
  if (options.normals) {
    result.normals = retainedLayoutWithLength(
      retainedAttributeLayout(options.normals, 3),
      vertexCount,
      options.normals.data
    );
    result.outNormals = retainedLayoutWithLength(
      retainedAttributeLayout(options.outNormals, 3),
      vertexCount,
      options.outNormals?.data
    );
  }
  if (options.tangents && options.normals) {
    result.tangents = retainedLayoutWithLength(
      retainedAttributeLayout(options.tangents, 3),
      vertexCount,
      options.tangents.data
    );
    result.outTangents = retainedLayoutWithLength(
      retainedAttributeLayout(options.outTangents, 3),
      vertexCount,
      options.outTangents?.data
    );
  }
  return result;
}

function retainedAttributeLayout(
  attribute: { offset?: number; stride?: number } | undefined,
  minimumStride: number
): Omit<RetainedSkinningLayout, "length"> {
  return {
    offset: safeNonNegativeInteger(attribute?.offset, 0),
    stride: Math.max(minimumStride, safePositiveInteger(attribute?.stride, minimumStride))
  };
}

function retainedLayoutWithLength(
  layout: Omit<RetainedSkinningLayout, "length">,
  vertexCount: number,
  source?: SkinningNumericArray
): RetainedSkinningLayout {
  const required = vertexCount === 0 ? 0 : layout.offset + (vertexCount - 1) * layout.stride + 3;
  const length = Math.max(required, source ? safeNumericLength(source) : 0);
  if (!Number.isSafeInteger(length) || length > 16_777_216) {
    throw new Error("retained skinning attribute capacity exceeds bounded limit");
  }
  return { ...layout, length };
}

function inferredRetainedVertexCount(
  attribute: { data: SkinningNumericArray } | undefined,
  layout: Omit<RetainedSkinningLayout, "length">
): number {
  if (!attribute) return 0;
  const length = safeNumericLength(attribute.data);
  if (length < layout.offset + 3) return 0;
  return Math.floor((length - layout.offset - 3) / layout.stride) + 1;
}

function requireBoundedNonNegativeInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`WASM retained skinning ${label} ${value} is out of range`);
  }
  return value;
}

function requireBoundedPositiveInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`WASM retained skinning ${label} ${value} is out of range`);
  }
  return value;
}

function safeNumericLength(value: SkinningNumericArray): number {
  return Number.isSafeInteger(value.length) && value.length >= 0 ? value.length : 0;
}

function safeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function validPaletteIndex(value: number | undefined, paletteLength: number): number {
  return Number.isSafeInteger(value) && value! >= 0 && value! < paletteLength ? value! : 0;
}

function isFiniteMat4Like(value: SkinningNumericArray | undefined): value is SkinningNumericArray {
  if (!value || value.length !== MAT4_FLOATS) return false;
  for (let index = 0; index < MAT4_FLOATS; index += 1) {
    if (!Number.isFinite(value[index]) || !Number.isFinite(Math.fround(value[index]!))) return false;
  }
  return true;
}

function finiteMat4OrIdentity(value: SkinningNumericArray | undefined): Float32Array {
  if (isFiniteMat4Like(value)) return Float32Array.from(value);
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function readSkeletonParent(skeleton: Skeleton, index: number): number {
  return skeleton.parents[index] ?? skeleton.joints[index]?.parentIndex ?? NO_PARENT;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function resolvePackedControllerJoint(controller: PackedRuntimeAnimationKeyController, jointCount: number): number {
  const joint = controller.jointIndex ?? Number(controller.targetKey);
  if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount) {
    throw new Error(`packed animation track ${controller.track} is not resolved to a numeric joint index`);
  }
  return joint;
}

function resolvePackedSampleTime(duration: number, value: number, loop: boolean): number {
  const time = Number.isFinite(value) ? value : 0;
  if (!loop) return Math.min(duration, Math.max(0, time));
  return ((time % duration) + duration) % duration;
}

async function instantiateKernel(
  source: WaKernelLoadSource,
  webAssembly: Pick<typeof WebAssembly, "instantiate">
): Promise<WebAssembly.Instance> {
  if ("module" in source) {
    const instance = await webAssembly.instantiate(source.module, {});
    return instance;
  }
  const bytes = "bytes" in source ? source.bytes : await fetchKernelBytes(source.url, source.fetch);
  const instantiated = await webAssembly.instantiate(bytes, {});
  return "instance" in instantiated ? instantiated.instance : instantiated;
}

async function fetchKernelBytes(url: string | URL, fetcher: WaKernelFetch | undefined): Promise<BufferSource> {
  const resolvedFetcher = fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!resolvedFetcher)
    throw new WaKernelInitializationError(
      "missing-asset",
      `no fetch implementation is available for required WASM asset ${String(url)}`
    );
  let response: unknown;
  try {
    response = await resolvedFetcher(url);
  } catch (error) {
    throw new WaKernelInitializationError(
      "asset-load-failed",
      `failed to fetch required WASM asset ${String(url)}`,
      error
    );
  }
  if (isArrayBuffer(response)) return response;
  if (ArrayBuffer.isView(response)) return copyViewToArrayBuffer(response);
  if (isResponseLike(response)) {
    if (response.ok === false)
      throw new WaKernelInitializationError(
        "asset-load-failed",
        `failed to fetch required WASM asset: HTTP ${response.status ?? "error"}`
      );
    return await response.arrayBuffer();
  }
  throw new WaKernelInitializationError(
    "asset-load-failed",
    "WASM kernel fetch strategy must return a Response, ArrayBuffer, or ArrayBufferView"
  );
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function copyViewToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  if (view.buffer instanceof ArrayBuffer) return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

function isResponseLike(
  value: unknown
): value is { ok?: boolean; status?: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function elapsedMs(start: number): number {
  return Number((nowMs() - start).toFixed(6));
}
