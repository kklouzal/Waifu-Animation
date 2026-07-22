import { type Mat4, type Transform, normalizeQuat } from "./math.js";
import { NO_PARENT, type LocalToModelPoseRangeOptions, type Skeleton } from "./skeleton.js";

export const WA_KERNEL_ABI_MAJOR = 1;
/** Oldest ABI v1 minor accepted by the scalar local-to-model facade. */
export const WA_KERNEL_ABI_MINOR = 0;
export const WA_KERNEL_POSE_JOBS_ABI_MINOR = 1;

export const WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL = 1 << 0;
export const WA_KERNEL_FEATURE_SCALAR_POSE_BLEND = 1 << 1;
export const WA_KERNEL_FEATURE_SCALAR_ADDITIVE = 1 << 2;
export const WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS = 1 << 3;
export const WA_KERNEL_FEATURE_SCALAR_POSE_JOBS =
  WA_KERNEL_FEATURE_SCALAR_POSE_BLEND | WA_KERNEL_FEATURE_SCALAR_ADDITIVE | WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS;
export const WA_KERNEL_FEATURE_SIMD_LOCAL_TO_MODEL = 1 << 16;
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
  disabled?: boolean;
  source?: WaKernelLoadSource;
  requiredFeatures?: number;
  webAssembly?: Pick<typeof WebAssembly, "instantiate" | "validate"> | undefined;
};

export type WaKernelLoadResult =
  | {
      kind: "wasm-scalar";
      kernel: WaifuAnimationWasmKernel;
      startupMs: number;
      simdSupported: boolean;
    }
  | {
      kind: "typescript";
      kernel: null;
      reason: string;
      startupMs: number;
      simdSupported: boolean;
      error?: unknown;
    };

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
const PARENT_BYTES = 4;
const DEFAULT_ALIGNMENT = 16;
const MATRIX_ALIGNMENT = 64;
const SCRATCH_BYTES = 64;
const MAX_JOINTS = 1024;

const OPTION_FLAG_FROM_EXCLUDED = 1 << 0;
const OPTION_FLAG_HAS_ROOT = 1 << 1;

// Minimal module using one SIMD instruction. This is a capability seam only;
// Phase 1 always selects scalar-WASM when WASM is enabled.
const WASM_SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00,
  0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x0b
]);

export async function loadWaifuAnimationWasmKernel(options: WaKernelLoadOptions = {}): Promise<WaKernelLoadResult> {
  const start = nowMs();
  const webAssembly = options.webAssembly ?? globalThis.WebAssembly;
  const simdSupported = detectWaKernelSimdSupport(webAssembly);
  if (options.disabled === true || isKernelDisabledByEnvironment()) {
    return { kind: "typescript", kernel: null, reason: "disabled", startupMs: elapsedMs(start), simdSupported };
  }
  if (!webAssembly || typeof webAssembly.instantiate !== "function") {
    return {
      kind: "typescript",
      kernel: null,
      reason: "webassembly-unavailable",
      startupMs: elapsedMs(start),
      simdSupported
    };
  }
  if (!options.source) {
    return { kind: "typescript", kernel: null, reason: "no-source", startupMs: elapsedMs(start), simdSupported };
  }

  try {
    const instance = await instantiateKernel(options.source, webAssembly);
    const validation = validateWaifuAnimationKernelExports(instance.exports, options.requiredFeatures);
    if (!validation.ok) {
      return {
        kind: "typescript",
        kernel: null,
        reason: validation.reason,
        startupMs: elapsedMs(start),
        simdSupported
      };
    }
    const kernel = WaifuAnimationWasmKernel.fromExports(instance.exports, elapsedMs(start));
    return { kind: "wasm-scalar", kernel, startupMs: elapsedMs(start), simdSupported };
  } catch (error) {
    return {
      kind: "typescript",
      kernel: null,
      reason: "instantiate-failed",
      startupMs: elapsedMs(start),
      simdSupported,
      error
    };
  }
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
  private readonly exports: WaKernelRawExports;
  private readonly scratchOffset: number;
  private cachedBuffer: ArrayBuffer;
  private cachedEpoch: number;
  private dataView: DataView;
  private forcedDisableReason: string | undefined;
  private quarantinedReason: string | undefined;

  private constructor(exports: WaKernelRawExports, startupMs: number, scratchOffset: number) {
    this.exports = exports;
    this.startupMs = startupMs;
    this.featureFlags = exports.wa_feature_flags() >>> 0;
    this.scratchOffset = scratchOffset;
    this.cachedBuffer = exports.memory.buffer;
    this.cachedEpoch = exports.wa_memory_epoch();
    this.dataView = new DataView(this.cachedBuffer);
  }

  static fromExports(exportsObject: WebAssembly.Exports, startupMs = 0): WaifuAnimationWasmKernel {
    const validation = validateWaifuAnimationKernelExports(exportsObject);
    if (!validation.ok) throw new Error(`invalid waifu-animation WASM kernel: ${validation.reason}`);
    const exports = exportsObject as unknown as WaKernelRawExports;
    const heapBase = exports.wa_heap_base();
    const status = exports.wa_alloc(SCRATCH_BYTES, DEFAULT_ALIGNMENT, heapBase);
    if (status !== 0) throw new Error(`failed to allocate WASM kernel scratch: ${statusName(status)}`);
    const dataView = new DataView(exports.memory.buffer);
    const scratchOffset = dataView.getUint32(heapBase, true);
    return new WaifuAnimationWasmKernel(exports, startupMs, scratchOffset);
  }

  get memory(): WebAssembly.Memory {
    return this.exports.memory;
  }

  get memoryEpoch(): number {
    this.refreshViewsIfNeeded();
    return this.cachedEpoch;
  }

  get disabledReason(): string | undefined {
    return this.forcedDisableReason ?? this.quarantinedReason;
  }

  get available(): boolean {
    return this.disabledReason === undefined;
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

  forceDisableForTests(reason = "forced-disable"): void {
    this.forcedDisableReason = reason;
  }

  clearForcedDisableForTests(): void {
    this.forcedDisableReason = undefined;
  }

  resetForTests(): WaKernelStatus {
    const status = this.exports.wa_reset_for_test?.() ?? WaKernelStatus.Unsupported;
    this.refreshViewsIfNeeded();
    if (status === 0) {
      this.forcedDisableReason = undefined;
      this.quarantinedReason = undefined;
    }
    return status;
  }

  forceMemoryGrowthForTests(minExtraPages = 1): WaKernelStatus {
    const status = this.exports.wa_force_memory_growth_for_test?.(minExtraPages) ?? WaKernelStatus.Unsupported;
    this.refreshViewsIfNeeded();
    return status;
  }

  allocateBytes(sizeBytes: number, alignment = DEFAULT_ALIGNMENT): number {
    if (!this.available) throw new Error(`WASM kernel is disabled: ${this.disabledReason}`);
    const status = this.exports.wa_alloc(sizeBytes, alignment, this.scratchOffset);
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM kernel allocation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
  }

  createSkeleton(parentIndicesOffset: number, jointCount: number, parentIndicesCapacityBytes: number): number {
    if (!this.available) throw new Error(`WASM kernel is disabled: ${this.disabledReason}`);
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
    if (!this.available) throw new Error(`WASM kernel is disabled: ${this.disabledReason}`);
    const status = this.exports.wa_create_avatar(skeletonHandle, jointCount, 0, this.scratchOffset);
    this.refreshViewsIfNeeded();
    if (status !== 0) throw new Error(`WASM kernel avatar creation failed: ${statusName(status)}`);
    return this.dataView.getUint32(this.scratchOffset, true);
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
    if (!this.available) return WaKernelStatus.Unsupported;
    const status = this.exports.wa_local_to_model(
      avatarHandle,
      localPoseOffset,
      modelPoseOffset,
      jointCount,
      optionsOffset
    );
    this.refreshViewsIfNeeded();
    if (status === 7 || status === 6) {
      this.quarantinedReason = statusName(status);
    }
    return status;
  }

  invokeBlendPoses(input: WasmRawBlendInvocation): WaKernelStatus {
    if (!this.available || !this.exports.wa_blend_poses) return WaKernelStatus.Unsupported;
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
    if (!this.available || !this.exports.wa_additive_delta) return WaKernelStatus.Unsupported;
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
    if (!this.available || !this.exports.wa_apply_additive) return WaKernelStatus.Unsupported;
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
    if (!this.available || !this.exports.wa_normalize_pose) return WaKernelStatus.Unsupported;
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
    if (status === 7 || status === 6) this.quarantinedReason = statusName(status);
    return status;
  }
}

/**
 * Retained scalar-WASM pose arena. Numeric jobs read and write padded SoA slots
 * in-place; steady-state blend/additive calls do not create `Transform[]`.
 * `writePose` and `copyPoseToTransforms` are explicit object packing and
 * materialization adapters and therefore are not allocation-free promises.
 */
export class WasmPoseArenaContext {
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
  private readonly kernel: WaifuAnimationWasmKernel;
  private readonly avatarHandle: number;
  private readonly skeletonHandle: number;
  private readonly maskLengths: Uint32Array;
  private poseViewCache: Float32Array[];
  private maskViewCache: Float32Array[];
  private cachedBuffer: ArrayBuffer;
  private destroyed = false;

  constructor(kernel: WaifuAnimationWasmKernel, skeleton: Skeleton, options: WasmPoseArenaOptions = {}) {
    assertSupportedJointCount(skeleton.joints.length);
    this.kernel = kernel;
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
    this.cachedBuffer = kernel.memory.buffer;
    this.poseViewCache = this.createPoseViews();
    this.maskViewCache = this.createMaskViews();
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
    if (this.destroyed || !this.kernel.available) return WaKernelStatus.Unsupported;
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
    if (this.destroyed || !this.kernel.available) return WaKernelStatus.Unsupported;
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
    if (this.destroyed || !this.kernel.available) return WaKernelStatus.Unsupported;
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
    if (this.destroyed || !this.kernel.available) return WaKernelStatus.Unsupported;
    return this.kernel.invokeNormalizePose({
      avatarHandle: this.avatarHandle,
      inputPoseOffset: this.poseOffset(inputPose),
      inputPoseCapacityBytes: this.poseStrideBytes,
      outputPoseOffset: this.poseOffset(outputPose),
      outputPoseCapacityBytes: this.poseStrideBytes,
      jointCount: this.jointCount
    });
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
    if (this.destroyed || !this.kernel.available) return WaKernelStatus.Unsupported;
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

function readSkeletonParent(skeleton: Skeleton, index: number): number {
  return skeleton.parents[index] ?? skeleton.joints[index]?.parentIndex ?? NO_PARENT;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
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
  if (!resolvedFetcher) throw new Error("no fetch implementation available for WASM kernel URL source");
  const response = await resolvedFetcher(url);
  if (isArrayBuffer(response)) return response;
  if (ArrayBuffer.isView(response)) return copyViewToArrayBuffer(response);
  if (isResponseLike(response)) {
    if (response.ok === false) throw new Error(`failed to fetch WASM kernel: HTTP ${response.status ?? "error"}`);
    return await response.arrayBuffer();
  }
  throw new Error("WASM kernel fetch strategy must return a Response, ArrayBuffer, or ArrayBufferView");
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

function isKernelDisabledByEnvironment(): boolean {
  const env = readProcessEnv("WAIFU_ANIMATION_WASM_KERNEL");
  return env === "0" || env === "false" || env === "disabled";
}

function readProcessEnv(name: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[name]?.toLowerCase();
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function elapsedMs(start: number): number {
  return Number((nowMs() - start).toFixed(6));
}
