import { type AnimationClip } from "./clip.js";
import { buildPackedRuntimeAnimation } from "./packed-runtime.js";
import { type JointMask } from "./pose.js";
import type {
  AnimationLayer,
  AnimationRuntimeBackend,
  AnimationRuntimeBackendEvaluation,
  AnimationRuntimeBackendSnapshot,
  AnimationRuntimeOptions
} from "./runtime.js";
import { AnimationRuntime } from "./runtime.js";
import type { Skeleton } from "./skeleton.js";
import {
  copyModelPoseViewToMat4Array,
  loadWaifuAnimationWasmKernel,
  type WaifuAnimationWasmKernel,
  WaKernelStatus,
  type WaKernelLoadOptions,
  type WaKernelLoadResult,
  type WasmPackedClipAsset,
  type WasmPackedClipSamplingContext,
  type WasmPoseArenaContext,
  type WasmPoseBlendLayer
} from "./wasm-kernel.js";

export type WasmAnimationRuntimeBackendOptions = {
  /** Maximum retained layer/sample slots. Capacity is allocated once. Defaults to 16. */
  maxLayers?: number;
};

export type CreateWasmAnimationRuntimeOptions = Omit<AnimationRuntimeOptions, "backend"> & {
  kernel?: WaKernelLoadOptions;
  backend?: WasmAnimationRuntimeBackendOptions;
};

type LayerBinding = {
  slot: number;
  clip: AnimationClip;
  asset?: SharedClipAsset;
  sampler?: WasmPackedClipSamplingContext;
  maskSlot?: number | undefined;
};

type SharedClipAsset = {
  clip: AnimationClip;
  asset: WasmPackedClipAsset;
  references: number;
};

const FIRST_LAYER_SLOT = 1;
const F32_MAX = 3.4028234663852886e38;

/**
 * Per-avatar retained runtime composition context. It owns all mutable pose,
 * mask, sampling, composition, and model-matrix storage; immutable clip assets
 * are deduplicated only within this context and only by clip object identity.
 */
export class WasmAnimationRuntimeBackend implements AnimationRuntimeBackend {
  readonly skeleton: Skeleton;
  readonly maxLayers: number;
  private readonly kernel: WaifuAnimationWasmKernel;
  private readonly arena: WasmPoseArenaContext;
  private readonly bindings = new Map<string, LayerBinding>();
  private readonly assets = new Map<AnimationClip, SharedClipAsset>();
  private readonly freeSlots: number[];
  private readonly freeMaskSlots: number[];
  private readonly compositionA: number;
  private readonly compositionB: number;
  private readonly additiveDeltaSlot: number;
  private disposed = false;
  private needsSamplerReset = false;
  private wasmSampledLayerCount = 0;
  private scalarSampledLayerCount = 0;

  constructor(kernel: WaifuAnimationWasmKernel, skeleton: Skeleton, options: WasmAnimationRuntimeBackendOptions = {}) {
    this.kernel = kernel;
    this.skeleton = skeleton;
    this.maxLayers = readCapacity(options.maxLayers, 16);
    this.compositionA = FIRST_LAYER_SLOT + this.maxLayers;
    this.compositionB = this.compositionA + 1;
    this.additiveDeltaSlot = this.compositionB + 1;
    this.arena = kernel.createPoseArenaContext(skeleton, {
      poseCapacity: this.additiveDeltaSlot + 1,
      maskCapacity: this.maxLayers,
      maskValueCapacity: skeleton.joints.length,
      layerCapacity: this.maxLayers
    });
    this.freeSlots = Array.from({ length: this.maxLayers }, (_value, index) => FIRST_LAYER_SLOT + index).reverse();
    this.freeMaskSlots = Array.from({ length: this.maxLayers }, (_value, index) => index).reverse();
  }

  setLayer(layer: AnimationLayer, previous?: AnimationLayer): void {
    if (this.disposed) return;
    if (layer.sourceBasisQuaternion) {
      throw new Error("source-basis callbacks must be baked before mandatory WASM runtime sampling");
    }
    const existing = this.bindings.get(layer.id);
    if (existing && previous?.clip === layer.clip) {
      existing.clip = layer.clip;
      this.syncMask(existing, layer.mask);
      return;
    }
    if (existing) this.releaseBinding(layer.id, existing);
    const slot = this.freeSlots.pop();
    if (slot === undefined) throw new Error(`retained layer capacity ${this.maxLayers} exceeded`);
    const binding: LayerBinding = { slot, clip: layer.clip, maskSlot: undefined };
    this.bindings.set(layer.id, binding);
    try {
      this.syncMask(binding, layer.mask);
      const shared = this.acquireAsset(layer.clip);
      binding.asset = shared;
      binding.sampler = this.arena.createPackedSamplingContext(shared.asset);
    } catch (error) {
      this.releaseBinding(layer.id, binding);
      throw error;
    }
  }

  removeLayer(id: string): void {
    const binding = this.bindings.get(id);
    if (binding) this.releaseBinding(id, binding);
  }

  clear(): void {
    for (const [id, binding] of Array.from(this.bindings)) this.releaseBinding(id, binding);
    this.needsSamplerReset = false;
  }

  reset(): void {
    this.needsSamplerReset = true;
  }

  evaluate(activeLayers: readonly AnimationLayer[], blendThreshold: number): AnimationRuntimeBackendEvaluation {
    if (this.disposed) throw new Error("WASM animation runtime backend is disposed");
    for (const layer of activeLayers) {
      const binding = this.bindings.get(layer.id);
      if (binding && (binding.clip !== layer.clip || layer.sourceBasisQuaternion)) {
        this.setLayer(layer);
      }
    }
    if (activeLayers.length > this.maxLayers || activeLayers.some((layer) => !this.bindings.has(layer.id))) {
      throw new Error(`retained layer capacity ${this.maxLayers} exceeded`);
    }
    if (
      !isF32Compatible(blendThreshold) ||
      activeLayers.some((layer) => !isF32Compatible(layer.time) || !isF32Compatible(layer.weight))
    ) {
      throw new Error("runtime values exceed WASM f32 range");
    }

    this.wasmSampledLayerCount = 0;
    this.scalarSampledLayerCount = 0;
    if (this.needsSamplerReset) {
      for (const binding of this.bindings.values()) binding.sampler?.reset();
      this.needsSamplerReset = false;
    }

    try {
      for (const layer of activeLayers) {
        const binding = this.bindings.get(layer.id)!;
        this.syncMask(binding, layer.mask);
        if (!binding.sampler) throw new Error(`layer ${layer.id} has no retained WASM sampler`);
        const status = binding.sampler.sampleTime(layer.time, binding.slot, { loop: layer.loop });
        if (status !== WaKernelStatus.Ok) throw new Error(`packed sampling failed with status ${status}`);
        this.wasmSampledLayerCount += 1;
      }

      const resultSlot = this.compose(activeLayers, blendThreshold);
      const localPose = this.arena.copyPoseToTransforms(resultSlot);
      const modelPose = copyModelPoseViewToMat4Array(this.arena.modelPoseView);
      return { localPose, modelPose };
    } catch (error) {
      this.needsSamplerReset = true;
      throw error;
    }
  }

  snapshot(): AnimationRuntimeBackendSnapshot {
    return {
      kind: this.kernel.executionMode === "simd" ? "wasm-simd-retained" : "wasm-scalar-retained",
      state: this.disposed ? "disposed" : "ready",
      retainedLayerCount: this.bindings.size,
      wasmSampledLayerCount: this.wasmSampledLayerCount,
      scalarSampledLayerCount: this.scalarSampledLayerCount,
      memoryEpoch: this.kernel.memoryEpoch,
      memoryBytes: this.kernel.memory.buffer.byteLength
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.arena.destroy();
  }

  private compose(activeLayers: readonly AnimationLayer[], blendThreshold: number): number {
    let current = 0;
    let output = this.compositionA;
    const overrides = activeLayers.filter((layer) => layer.blendMode === "override");
    const additives = activeLayers.filter((layer) => layer.blendMode === "additive");
    for (let index = 0; index < overrides.length; ) {
      const first = overrides[index]!;
      const priority = first.priority;
      const group: WasmPoseBlendLayer[] = [];
      while (index < overrides.length) {
        const layer = overrides[index]!;
        if (layer.priority !== priority) break;
        const binding = this.bindings.get(layer.id)!;
        group.push({
          pose: binding.slot,
          weight: layer.weight,
          ...(binding.maskSlot !== undefined
            ? { mask: binding.maskSlot, maskCount: Math.min(layer.mask?.length ?? 0, this.skeleton.joints.length) }
            : {})
        });
        index += 1;
      }
      const status = this.arena.blend(group, { fallbackPose: current, outputPose: output, threshold: blendThreshold });
      this.accept(status, "override blend");
      current = output;
      output = output === this.compositionA ? this.compositionB : this.compositionA;
    }

    for (const layer of additives) {
      const binding = this.bindings.get(layer.id)!;
      this.accept(this.arena.additiveDelta(0, binding.slot, this.additiveDeltaSlot), "additive delta");
      const status = this.arena.applyAdditive(
        current,
        this.additiveDeltaSlot,
        layer.weight,
        output,
        binding.maskSlot,
        layer.mask ? Math.min(layer.mask.length, this.skeleton.joints.length) : undefined
      );
      this.accept(status, "additive apply");
      current = output;
      output = output === this.compositionA ? this.compositionB : this.compositionA;
    }

    this.accept(this.arena.normalize(current), "normalize");
    this.accept(this.arena.localToModel(current), "local-to-model");
    return current;
  }

  private syncMask(binding: LayerBinding, mask?: JointMask): void {
    if (!mask) {
      if (binding.maskSlot !== undefined) {
        this.freeMaskSlots.push(binding.maskSlot);
        binding.maskSlot = undefined;
      }
      return;
    }
    if (binding.maskSlot === undefined) binding.maskSlot = this.freeMaskSlots.pop();
    const maskSlot = binding.maskSlot;
    if (maskSlot === undefined) throw new Error(`retained mask capacity ${this.maxLayers} exceeded`);
    this.arena.writeMask(
      maskSlot,
      mask.length > this.skeleton.joints.length ? mask.subarray(0, this.skeleton.joints.length) : mask
    );
  }

  private acquireAsset(clip: AnimationClip): SharedClipAsset {
    const existing = this.assets.get(clip);
    if (existing) {
      existing.references += 1;
      return existing;
    }
    const packed = buildPackedRuntimeAnimation(clip, this.skeleton);
    const shared = { clip, asset: this.kernel.createPackedClipAsset(this.skeleton, packed), references: 1 };
    this.assets.set(clip, shared);
    return shared;
  }

  private releaseBinding(id: string, binding: LayerBinding): void {
    binding.sampler?.destroy();
    if (binding.asset) {
      binding.asset.references -= 1;
      if (binding.asset.references === 0) {
        binding.asset.asset.destroy();
        this.assets.delete(binding.asset.clip);
      }
    }
    if (binding.maskSlot !== undefined) this.freeMaskSlots.push(binding.maskSlot);
    this.freeSlots.push(binding.slot);
    this.bindings.delete(id);
  }

  private accept(status: WaKernelStatus, job: string): void {
    if (status === WaKernelStatus.Ok) return;
    this.needsSamplerReset = true;
    throw new Error(`${job} failed with status ${status}`);
  }
}

export function createWasmAnimationRuntimeBackend(
  kernelOrLoadResult: WaifuAnimationWasmKernel | WaKernelLoadResult,
  skeleton: Skeleton,
  options: WasmAnimationRuntimeBackendOptions = {}
): WasmAnimationRuntimeBackend {
  const kernel = "kind" in kernelOrLoadResult ? kernelOrLoadResult.kernel : kernelOrLoadResult;
  return new WasmAnimationRuntimeBackend(kernel, skeleton, options);
}

/** Initialize the mandatory kernel and create a retained runtime. Initialization rejects on any load/ABI/feature failure. */
export async function createWasmAnimationRuntime(
  skeleton: Skeleton,
  options: CreateWasmAnimationRuntimeOptions = {}
): Promise<AnimationRuntime> {
  const loadResult = await loadWaifuAnimationWasmKernel(options.kernel);
  const backend = createWasmAnimationRuntimeBackend(loadResult, skeleton, options.backend);
  return new AnimationRuntime(skeleton, {
    ...(options.blendThreshold !== undefined ? { blendThreshold: options.blendThreshold } : {}),
    backend
  });
}

function readCapacity(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error("maxLayers must be a positive integer");
  return value;
}

function isF32Compatible(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= F32_MAX;
}
