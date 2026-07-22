import os from "node:os";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import {
  AnimationRuntime,
  AnimationSamplingContext,
  NO_PARENT,
  additiveDeltaPose,
  applyAdditivePose,
  applyAimIkModelCorrection,
  applyTwoBoneIkLocalCorrections,
  blendPoses,
  buildPackedRuntimeAnimation,
  clonePose,
  createWasmAnimationRuntimeBackend,
  createSkeleton,
  localToModelPose,
  loadWaifuAnimationWasmKernel,
  normalizePose,
  quatFromAxisAngle,
  sampleClipToPoseWithContext,
  samplePackedRuntimeAnimationToPose,
  sanitizeQuaternionTrackValues,
  skinVertices,
  solveAimIk,
  solveTwoBoneIkModel,
  toFloat32Array,
  type AnimationClip,
  type JointMask,
  type Mat4,
  type Pose,
  type PackedRuntimeAnimation,
  type Quat,
  type Skeleton,
  type SkinningJob,
  WaKernelStatus,
  type WaKernelLoadResult,
  type WaifuAnimationWasmKernel,
  type WasmLocalToModelContext,
  type WasmPoseArenaContext,
  type WasmProceduralCorrection,
  type WasmProceduralCorrectionContext,
  type WasmSkinningContext,
  type WasmPackedClipAsset,
  type WasmPackedClipSamplingContext
} from "../src/index.js";

type BenchmarkConfig = {
  smoke: boolean;
  jointCount: number;
  iterations: number;
  warmup: number;
  multiAvatarCount: number;
  runtimeAvatarCount: number;
};

type BenchmarkFixture = {
  skeleton: Skeleton;
  clips: [AnimationClip, AnimationClip, AnimationClip];
  packedClips: [PackedRuntimeAnimation, PackedRuntimeAnimation, PackedRuntimeAnimation];
  upperMask: JointMask;
  sparseMask: JointMask;
  preSampledBase: Pose;
  preSampledOverlay: Pose;
  preSampledAdditive: Pose;
  preBlendedPose: Pose;
  skinning: BenchmarkSkinningFixture;
};

type BenchmarkSkinningFixture = {
  vertexCount: number;
  influences: number;
  positions: Float32Array;
  normals: Float32Array;
  tangents: Float32Array;
  jointIndices: Uint16Array;
  jointWeights: Float32Array;
  inverseBindMatrices: Mat4[];
  outPositions: Float32Array;
  outNormals: Float32Array;
  outTangents: Float32Array;
};

type AvatarSamplingState = {
  contexts: [AnimationSamplingContext, AnimationSamplingContext, AnimationSamplingContext];
  timeOffset: number;
  modelOut: Mat4[];
};

type WasmPackedBenchmarkState = {
  arena: WasmPoseArenaContext;
  samplers: [WasmPackedClipSamplingContext, WasmPackedClipSamplingContext, WasmPackedClipSamplingContext];
  timeOffset: number;
};

type BenchmarkResult = {
  name: string;
  description: string;
  iterations: number;
  warmup: number;
  operationCount: number;
  totalMs: number;
  msPerOperation: number;
  operationsPerSecond: number;
  checksum: number;
};

type HotPathRank = {
  rank: number;
  job: string;
  measuredWorkload: string;
  msPerAvatarFrame: number;
  structuralFrequency: string;
  rationale: string;
};

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name?: string;
  version?: string;
};

const config = parseArgs(process.argv.slice(2));
const fixture = createFixture(config.jointCount);
const wasmKernel = await loadBenchmarkKernel();
const wasmLocalToModel =
  wasmKernel.kind === "wasm-scalar" ? wasmKernel.kernel.createLocalToModelContext(fixture.skeleton) : undefined;
if (wasmLocalToModel) wasmLocalToModel.writeLocalPose(fixture.preBlendedPose);
const wasmPoseArena =
  wasmKernel.kind === "wasm-scalar"
    ? createBenchmarkPoseArena(wasmKernel.kernel.createPoseArenaContext(fixture.skeleton))
    : undefined;
const wasmPoseAvatars =
  wasmKernel.kind === "wasm-scalar"
    ? Array.from({ length: config.multiAvatarCount }, () =>
        createBenchmarkPoseArena(wasmKernel.kernel.createPoseArenaContext(fixture.skeleton))
      )
    : [];
const proceduralSetupStart = performance.now();
const wasmProcedural =
  wasmKernel.kind === "wasm-scalar" && wasmPoseArena
    ? wasmKernel.kernel.createProceduralCorrectionContext(wasmPoseArena, { capacity: 8 })
    : undefined;
const retainedProceduralSetupMs = performance.now() - proceduralSetupStart;
const proceduralDescriptors = createProceduralDescriptors(fixture.skeleton.joints.length);
const packedSetupStart = performance.now();
const wasmPackedAssets =
  wasmKernel.kind === "wasm-scalar"
    ? fixture.packedClips.map((clip) => wasmKernel.kernel.createPackedClipAsset(fixture.skeleton, clip))
    : undefined;
const wasmPackedAvatar =
  wasmKernel.kind === "wasm-scalar" && wasmPackedAssets
    ? createWasmPackedBenchmarkState(
        createBenchmarkPoseArena(wasmKernel.kernel.createPoseArenaContext(fixture.skeleton)),
        wasmPackedAssets,
        0
      )
    : undefined;
const wasmPackedAvatars =
  wasmKernel.kind === "wasm-scalar" && wasmPackedAssets
    ? Array.from({ length: config.multiAvatarCount }, (_value, index) =>
        createWasmPackedBenchmarkState(
          createBenchmarkPoseArena(wasmKernel.kernel.createPoseArenaContext(fixture.skeleton)),
          wasmPackedAssets,
          index * 0.017
        )
      )
    : [];
const retainedPackedSetupMs = performance.now() - packedSetupStart;
const retainedPackedMemoryBytesAfterSetup =
  wasmKernel.kind === "wasm-scalar" ? wasmKernel.kernel.memory.buffer.byteLength : undefined;
const singleAvatar = createAvatarState(0);
const multiAvatars = Array.from({ length: config.multiAvatarCount }, (_value, index) => createAvatarState(index));
const runtime = createRuntime(fixture, 0);
const runtimeAvatars = Array.from({ length: config.runtimeAvatarCount }, (_value, index) =>
  createRuntime(fixture, index)
);
const wasmRuntimeSetupStart = performance.now();
const wasmRuntime =
  wasmKernel.kind === "wasm-scalar"
    ? createRuntime(
        fixture,
        0,
        createWasmAnimationRuntimeBackend(wasmKernel.kernel, fixture.skeleton, { maxLayers: 3 })
      )
    : undefined;
const wasmRuntimeAvatars =
  wasmKernel.kind === "wasm-scalar"
    ? Array.from({ length: config.runtimeAvatarCount }, (_value, index) =>
        createRuntime(
          fixture,
          index,
          createWasmAnimationRuntimeBackend(wasmKernel.kernel, fixture.skeleton, { maxLayers: 3 })
        )
      )
    : [];
const wasmRuntimeSetupMs = performance.now() - wasmRuntimeSetupStart;
const wasmRuntimeMemoryBytesAfterSetup =
  wasmKernel.kind === "wasm-scalar" ? wasmKernel.kernel.memory.buffer.byteLength : undefined;
const skinningSetupStart = performance.now();
const wasmSkinning =
  wasmKernel.kind === "wasm-scalar" ? createBenchmarkSkinningContext(wasmKernel.kernel, fixture) : undefined;
const wasmSkinningMeshes =
  wasmKernel.kind === "wasm-scalar"
    ? Array.from({ length: config.multiAvatarCount }, () => createBenchmarkSkinningContext(wasmKernel.kernel, fixture))
    : [];
const retainedSkinningSetupMs = performance.now() - skinningSetupStart;
const retainedSkinningMemoryBytesAfterSetup =
  wasmKernel.kind === "wasm-scalar" ? wasmKernel.kernel.memory.buffer.byteLength : undefined;

const results: BenchmarkResult[] = [];

results.push(
  runBenchmark({
    name: "sampling_3_clips_1_avatar",
    description: "sample three coherent TypeScript clips into local-space poses for one avatar frame",
    config,
    operationCountPerIteration: 1,
    op: (frame) => sampleThreeClips(fixture, singleAvatar, frame)
  })
);
if (wasmRuntime) {
  results.push(
    runBenchmark({
      name: "animation_runtime_wasm_evaluate_1_avatar",
      description:
        "opt-in AnimationRuntime.update + retained WASM sampling/composition/local-to-model, including TS scheduling and final JS pose materialization",
      config,
      operationCountPerIteration: 1,
      op: () => evaluateRuntime(wasmRuntime)
    })
  );
  results.push(
    runBenchmark({
      name: "animation_runtime_wasm_evaluate_multi_avatar",
      description:
        "same opt-in retained runtime facade across independently owned avatar contexts, including scheduler/orchestration",
      config,
      operationCountPerIteration: config.runtimeAvatarCount,
      op: () => {
        let checksum = 0;
        for (const avatarRuntime of wasmRuntimeAvatars) checksum += evaluateRuntime(avatarRuntime);
        return checksum;
      }
    })
  );
}
results.push(
  runBenchmark({
    name: "sampling_packed_typescript_3_clips_1_avatar",
    description: "sample three already-packed clips with the scalar TypeScript reference into object poses",
    config,
    operationCountPerIteration: 1,
    op: (frame) => sampleThreePackedClipsTypescript(fixture, frame, 0)
  })
);
if (wasmSkinning) {
  results.push(
    runBenchmark({
      name: "skinning_palette_scalar_wasm_1_avatar",
      description: "retained scalar-WASM model * inverse-bind palette only; suitable for a TS-owned GPU upload adapter",
      config,
      operationCountPerIteration: 1,
      op: () => skinningPaletteWasm(wasmSkinning)
    })
  );
  results.push(
    runBenchmark({
      name: "skinning_palette_cpu_scalar_wasm_1_avatar",
      description: "retained scalar-WASM palette plus CPU positions/normals/tangents skinning over caller-owned views",
      config,
      operationCountPerIteration: 1,
      op: () => skinningPaletteAndCpuWasm(wasmSkinning)
    })
  );
  results.push(
    runBenchmark({
      name: "skinning_palette_cpu_scalar_wasm_multi_mesh_avatar",
      description: "same retained scalar-WASM palette and CPU skinning across independent mesh/avatar contexts",
      config,
      operationCountPerIteration: config.multiAvatarCount,
      op: () => wasmSkinningMeshes.reduce((sum, context) => sum + skinningPaletteAndCpuWasm(context), 0)
    })
  );
}
results.push(
  runBenchmark({
    name: "sampling_packed_typescript_3_clips_multi_avatar",
    description: "same scalar TypeScript packed reference across multiple avatars (object-pose output)",
    config,
    operationCountPerIteration: config.multiAvatarCount,
    op: (frame) =>
      multiAvatars.reduce(
        (sum, avatar, index) => sum + sampleThreePackedClipsTypescript(fixture, frame + index, avatar.timeOffset),
        0
      )
  })
);
if (wasmPackedAvatar) {
  results.push(
    runBenchmark({
      name: "sampling_packed_scalar_wasm_3_clips_1_avatar",
      description: "sample three retained packed-clip handles directly into reusable padded-SoA pose slots",
      config,
      operationCountPerIteration: 1,
      op: (frame) => sampleThreePackedClipsWasm(wasmPackedAvatar, frame)
    })
  );
  results.push(
    runBenchmark({
      name: "sampling_packed_scalar_wasm_3_clips_multi_avatar",
      description: "same retained packed sampling with independent lower-key caches and pose arenas per avatar",
      config,
      operationCountPerIteration: config.multiAvatarCount,
      op: (frame) =>
        wasmPackedAvatars.reduce((sum, avatar, index) => sum + sampleThreePackedClipsWasm(avatar, frame + index), 0)
    })
  );
}
results.push(
  runBenchmark({
    name: "blend_additive_masks_typescript_object_pose_1_avatar",
    description: "current TypeScript object-pose blend, additive, masks, and normalization for one avatar",
    config,
    operationCountPerIteration: 1,
    op: () => blendAdditiveAndNormalize(fixture)
  })
);
if (wasmPackedAvatar) {
  results.push(
    runBenchmark({
      name: "retained_sample_blend_local_to_model_scalar_wasm_1_avatar",
      description:
        "retained WASM sampling -> blend/additive/masks/normalize -> local-to-model without JS pose materialization",
      config,
      operationCountPerIteration: 1,
      op: (frame) => evaluateRetainedWasmPipeline(wasmPackedAvatar, frame)
    })
  );
  results.push(
    runBenchmark({
      name: "retained_sample_blend_local_to_model_scalar_wasm_multi_avatar",
      description: "same fully retained scalar-WASM numeric chain across independent avatar arenas",
      config,
      operationCountPerIteration: config.multiAvatarCount,
      op: (frame) =>
        wasmPackedAvatars.reduce((sum, avatar, index) => sum + evaluateRetainedWasmPipeline(avatar, frame + index), 0)
    })
  );
}
if (wasmPoseArena) {
  results.push(
    runBenchmark({
      name: "blend_additive_masks_scalar_wasm_already_packed_1_avatar",
      description:
        "scalar WASM blend, additive-delta generation/application, masks, and normalization over retained padded-SoA buffers",
      config,
      operationCountPerIteration: 1,
      op: () => blendAdditiveWasmAlreadyPacked(wasmPoseArena)
    })
  );
  results.push(
    runBenchmark({
      name: "blend_additive_masks_scalar_wasm_already_packed_multi_avatar",
      description: "same retained padded-SoA scalar WASM pose jobs across independently owned avatar arenas",
      config,
      operationCountPerIteration: config.multiAvatarCount,
      op: () => {
        let checksum = 0;
        for (const arena of wasmPoseAvatars) checksum += blendAdditiveWasmAlreadyPacked(arena);
        return checksum;
      }
    })
  );
}
results.push(
  runBenchmark({
    name: "procedural_two_bone_typescript_1_avatar",
    description: "TypeScript object-pose two-bone solve/apply with partial model refresh",
    config,
    operationCountPerIteration: 1,
    op: () => proceduralTypescript(fixture, proceduralDescriptors.slice(0, 1))
  })
);
results.push(
  runBenchmark({
    name: "procedural_aim_chain_typescript_1_avatar",
    description: "TypeScript object-pose two-joint aim chain with partial model refresh",
    config,
    operationCountPerIteration: 1,
    op: () => proceduralTypescript(fixture, proceduralDescriptors.slice(1, 3))
  })
);
results.push(
  runBenchmark({
    name: "procedural_foot_typescript_1_avatar",
    description: "TypeScript numeric foot correction after TS-owned contact/pelvis target resolution",
    config,
    operationCountPerIteration: 1,
    op: () => proceduralTypescript(fixture, proceduralDescriptors.slice(3, 4))
  })
);
if (wasmProcedural && wasmPoseArena) {
  for (const [name, descriptors] of [
    ["procedural_two_bone_scalar_wasm_1_avatar", proceduralDescriptors.slice(0, 1)],
    ["procedural_aim_chain_scalar_wasm_1_avatar", proceduralDescriptors.slice(1, 3)],
    ["procedural_foot_scalar_wasm_1_avatar", proceduralDescriptors.slice(3, 4)],
    ["procedural_combined_post_process_scalar_wasm_1_avatar", proceduralDescriptors]
  ] as const) {
    results.push(
      runBenchmark({
        name,
        description: "retained ABI v1.4 correction descriptors over existing local/model arenas; setup excluded",
        config,
        operationCountPerIteration: 1,
        op: () => proceduralWasm(wasmPoseArena, wasmProcedural, fixture, descriptors)
      })
    );
  }
}
results.push(
  runBenchmark({
    name: "procedural_combined_post_process_typescript_1_avatar",
    description: "TypeScript object-pose two-bone + aim chain + resolved foot correction",
    config,
    operationCountPerIteration: 1,
    op: () => proceduralTypescript(fixture, proceduralDescriptors)
  })
);

results.push(
  runBenchmark({
    name: "local_to_model_1_avatar",
    description: "convert one local TRS pose to column-major model matrices with scalar TypeScript",
    config,
    operationCountPerIteration: 1,
    op: () => localToModelOnly(fixture, singleAvatar)
  })
);
if (wasmLocalToModel) {
  results.push(
    runBenchmark({
      name: "local_to_model_scalar_wasm_1_avatar",
      description:
        "convert one already-packed padded-SoA local TRS pose to column-major model matrices with scalar WASM",
      config,
      operationCountPerIteration: 1,
      op: () => localToModelWasmOnly(wasmLocalToModel)
    })
  );
}
results.push(
  runBenchmark({
    name: "skinning_palette_cpu_1_avatar",
    description: "build a model * inverse-bind palette and CPU-skin positions, normals, and tangents",
    config,
    operationCountPerIteration: 1,
    op: () => skinningPaletteAndCpu(fixture)
  })
);
results.push(
  runBenchmark({
    name: "sample_blend_local_to_model_1_avatar",
    description: "current scalar TypeScript sampling + blend/additive/masks + local-to-model for one avatar frame",
    config,
    operationCountPerIteration: 1,
    op: (frame) => evaluateManualPipeline(fixture, singleAvatar, frame)
  })
);
results.push(
  runBenchmark({
    name: "sample_blend_local_to_model_multi_avatar",
    description: "current scalar TypeScript sampling + blend/additive/masks + local-to-model across many avatars",
    config,
    operationCountPerIteration: config.multiAvatarCount,
    op: (frame) => {
      let checksum = 0;
      for (let index = 0; index < multiAvatars.length; index += 1) {
        checksum += evaluateManualPipeline(fixture, multiAvatars[index]!, frame + index);
      }
      return checksum;
    }
  })
);
results.push(
  runBenchmark({
    name: "animation_runtime_evaluate_1_avatar",
    description:
      "AnimationRuntime.update + evaluate with two override layers, one additive layer, masks, and local-to-model",
    config,
    operationCountPerIteration: 1,
    op: () => evaluateRuntime(runtime)
  })
);
results.push(
  runBenchmark({
    name: "animation_runtime_evaluate_multi_avatar",
    description: "AnimationRuntime.update + evaluate across many avatars",
    config,
    operationCountPerIteration: config.runtimeAvatarCount,
    op: () => {
      let checksum = 0;
      for (const avatarRuntime of runtimeAvatars) checksum += evaluateRuntime(avatarRuntime);
      return checksum;
    }
  })
);

const output = {
  benchmark: "waifu-animation-wasm-kernel-baseline",
  schemaVersion: 1,
  package: {
    name: packageJson.name ?? "waifu-animation",
    version: packageJson.version ?? null
  },
  config,
  fixture: {
    jointCount: fixture.skeleton.joints.length,
    soaGroupCount: Math.ceil(fixture.skeleton.joints.length / 4),
    clips: fixture.clips.map((clip) => ({
      id: clip.id,
      duration: clip.duration,
      trackCount: clip.tracks.length,
      keysPerTrack: clip.tracks[0]?.times.length ?? 0
    })),
    overrideLayerCount: 2,
    additiveLayerCount: 1,
    skinning: {
      vertexCount: fixture.skinning.vertexCount,
      influences: fixture.skinning.influences
    },
    masks: ["upperMask", "sparseMask"]
  },
  environment: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem()
  },
  wasmKernel:
    wasmKernel.kind === "wasm-scalar"
      ? {
          status: "ready",
          mode: wasmKernel.kind,
          startupMs: wasmKernel.startupMs,
          simdSupported: wasmKernel.simdSupported,
          featureFlags: wasmKernel.kernel.featureFlags,
          retainedPackedSetupMs,
          retainedMemoryBytesAfterSetup: retainedPackedMemoryBytesAfterSetup,
          runtimeFacadeSetupMs: wasmRuntimeSetupMs,
          runtimeFacadeMemoryBytesAfterSetup: wasmRuntimeMemoryBytesAfterSetup,
          retainedSkinningSetupMs,
          retainedSkinningMemoryBytesAfterSetup,
          retainedProceduralSetupMs,
          runtimeFacadeAllocationContract:
            "WASM bump allocations occur during backend/layer setup and are not reclaimed; steady-state update/evaluate performs no WASM memory growth, but final Transform[]/Mat4[] materialization remains JS-owned"
        }
      : {
          status: "fallback",
          mode: "typescript",
          startupMs: wasmKernel.startupMs,
          simdSupported: wasmKernel.simdSupported,
          reason: wasmKernel.reason
        },
  results,
  hotPathRank: rankHotPaths(results),
  notes: [
    "Timings use deterministic synthetic clips and skeletons; checksums guard against dead-code elimination.",
    "WASM startup is reported separately in wasmKernel.startupMs and is excluded from all scalar-WASM steady-state rows.",
    "Retained clip/arena/context setup is reported separately in wasmKernel.retainedPackedSetupMs and excluded from steady-state rows.",
    "The scalar-WASM pose rows begin with prepacked retained SoA poses and masks; object packing and Transform[] materialization are intentionally outside those timings.",
    "Each multi-avatar scalar-WASM row uses an independent retained context; offsets and typed views are reused unless WebAssembly.Memory grows.",
    "The TypeScript pose row measures the current object-shaped public API, so the comparison includes its current object allocation behavior but does not isolate allocation cost.",
    "No precise heap-allocation claim is made from Node heap deltas; retained-buffer behavior is enforced structurally by contract tests.",
    "The retained full-chain rows exclude runtime layer scheduling, Three/VRM adaptation, skinning, IK, diagnostics, and final JS Transform[] materialization; no production speedup claim is made.",
    "Retained skinning setup copies inverse binds, remaps, indices, weights, and metadata once; setup and memory are reported separately and excluded from steady-state rows.",
    "CPU skinning is optional: production GPU-skinned avatars may consume only the palette row through a TypeScript-owned upload adapter and may not use the CPU rows.",
    "The animation_runtime_wasm rows include TypeScript scheduling/orchestration and final public JS pose/matrix materialization, but exclude async loader and layer/backend setup. Unsupported callbacks/tracks can retain scalar sampling or trigger scalar frame fallback.",
    "Smoke timings are directional only and must not be presented as a production speedup claim.",
    "Use --smoke for a fast gate and default arguments for a steadier local baseline. Override with --iterations, --warmup, --joints, --avatars, or --runtime-avatars."
  ]
};

console.log(JSON.stringify(output, null, 2));

function parseArgs(args: string[]): BenchmarkConfig {
  const smoke = args.includes("--smoke");
  return {
    smoke,
    jointCount: readPositiveIntegerArg(args, "--joints", 72),
    iterations: readPositiveIntegerArg(args, "--iterations", smoke ? 60 : 900),
    warmup: readPositiveIntegerArg(args, "--warmup", smoke ? 20 : 180),
    multiAvatarCount: readPositiveIntegerArg(args, "--avatars", smoke ? 4 : 24),
    runtimeAvatarCount: readPositiveIntegerArg(args, "--runtime-avatars", smoke ? 2 : 8)
  };
}

function readPositiveIntegerArg(args: readonly string[], name: string, fallback: number): number {
  const equalsPrefix = `${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
  const positionalIndex = args.indexOf(name);
  const value =
    equalsValue?.slice(equalsPrefix.length) ?? (positionalIndex >= 0 ? args[positionalIndex + 1] : undefined);
  if (value === undefined || value.startsWith("--")) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadBenchmarkKernel(): Promise<WaKernelLoadResult> {
  const bytes = readBenchmarkKernelBytes();
  if (!bytes) return await loadWaifuAnimationWasmKernel();
  return await loadWaifuAnimationWasmKernel({ source: { bytes } });
}

function readBenchmarkKernelBytes(): ArrayBuffer | undefined {
  const candidates = [
    new URL("../dist/wasm-kernel/waifu_animation_kernel.wasm", import.meta.url),
    new URL("../target/wasm32-unknown-unknown/release/waifu_animation_kernel.wasm", import.meta.url)
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const bytes = readFileSync(candidate);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return undefined;
}

function createFixture(jointCount: number): BenchmarkFixture {
  const skeleton = createBenchmarkSkeleton(jointCount);
  const clips: [AnimationClip, AnimationClip, AnimationClip] = [
    createBenchmarkClip(skeleton, "bench_base_walk", 0.13),
    createBenchmarkClip(skeleton, "bench_overlay_idle", 0.47),
    createBenchmarkClip(skeleton, "bench_additive_upper", 0.79)
  ];
  const packedClips: [PackedRuntimeAnimation, PackedRuntimeAnimation, PackedRuntimeAnimation] = [
    buildPackedRuntimeAnimation(clips[0], skeleton),
    buildPackedRuntimeAnimation(clips[1], skeleton),
    buildPackedRuntimeAnimation(clips[2], skeleton)
  ];
  const upperMask = createDepthMask(skeleton, 2, 1, 0.08);
  const sparseMask = createSparseMask(skeleton);
  const preSampledBase = sampleClipToPoseWithContext(skeleton, clips[0], 0.37, new AnimationSamplingContext(), {
    loop: true,
    restPose: skeleton.restPose
  });
  const preSampledOverlay = sampleClipToPoseWithContext(skeleton, clips[1], 0.51, new AnimationSamplingContext(), {
    loop: true,
    restPose: skeleton.restPose
  });
  const preSampledAdditive = sampleClipToPoseWithContext(skeleton, clips[2], 0.73, new AnimationSamplingContext(), {
    loop: true,
    restPose: skeleton.restPose
  });
  const fixtureDraft: Omit<BenchmarkFixture, "preBlendedPose"> = {
    skeleton,
    clips,
    packedClips,
    upperMask,
    sparseMask,
    preSampledBase,
    preSampledOverlay,
    preSampledAdditive,
    skinning: createSkinningFixture(skeleton, 4096, 4)
  };
  const preBlendedPose = composeBlendAdditivePose(fixtureDraft);
  return {
    skeleton,
    clips,
    packedClips,
    upperMask,
    sparseMask,
    preSampledBase,
    preSampledOverlay,
    preSampledAdditive,
    preBlendedPose,
    skinning: fixtureDraft.skinning
  };
}

function createBenchmarkSkeleton(jointCount: number): Skeleton {
  const definitions = [];
  for (let index = 0; index < jointCount; index += 1) {
    const parentIndex = index === 0 ? NO_PARENT : Math.floor((index - 1) / 2);
    definitions.push({
      name: `joint_${index.toString().padStart(3, "0")}`,
      parentIndex,
      rest: {
        translation: [
          index === 0 ? 0 : ((index % 5) - 2) * 0.035,
          index === 0 ? 1 : 0.045 + (index % 7) * 0.004,
          ((index % 3) - 1) * 0.025
        ] as [number, number, number],
        rotation: [0, 0, 0, 1] as Quat,
        scale: [1, 1, 1] as [number, number, number]
      }
    });
  }
  return createSkeleton(definitions);
}

function createBenchmarkClip(skeleton: Skeleton, id: string, phase: number): AnimationClip {
  const duration = 1.25;
  const times = toFloat32Array([0, duration * 0.25, duration * 0.5, duration * 0.75, duration]);
  const tracks: AnimationClip["tracks"] = [];
  for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
    const jointName = skeleton.joints[joint]!.name;
    tracks.push({
      joint: jointName,
      property: "translation",
      times,
      values: toFloat32Array(createTranslationKeys(joint, phase))
    });
    tracks.push({
      joint: jointName,
      property: "rotation",
      times,
      values: sanitizeQuaternionTrackValues(createRotationKeys(joint, phase))
    });
    tracks.push({
      joint: jointName,
      property: "scale",
      times,
      values: toFloat32Array(createScaleKeys(joint, phase))
    });
  }
  return { id, duration, loop: true, tracks };
}

function createTranslationKeys(joint: number, phase: number): number[] {
  const values: number[] = [];
  for (let key = 0; key < 5; key += 1) {
    const t = key / 4;
    values.push(
      Math.sin((joint + 1) * 0.17 + t * Math.PI * 2 + phase) * 0.025,
      Math.cos((joint + 3) * 0.11 + t * Math.PI * 2 + phase) * 0.02,
      Math.sin((joint + 5) * 0.07 + t * Math.PI * 4 + phase) * 0.018
    );
  }
  return values;
}

function createRotationKeys(joint: number, phase: number): number[] {
  const values: number[] = [];
  const axes: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.577350269, 0.577350269, 0.577350269]
  ];
  const axis = axes[joint % axes.length]!;
  for (let key = 0; key < 5; key += 1) {
    const t = key / 4;
    const angle = Math.sin((joint + 1) * 0.09 + t * Math.PI * 2 + phase) * 0.42;
    values.push(...quatFromAxisAngle(axis, angle));
  }
  return values;
}

function createScaleKeys(joint: number, phase: number): number[] {
  const values: number[] = [];
  for (let key = 0; key < 5; key += 1) {
    const t = key / 4;
    const scale = 1 + Math.sin((joint + 2) * 0.05 + t * Math.PI * 2 + phase) * 0.025;
    values.push(scale, 1 + (scale - 1) * 0.5, 1 - (scale - 1) * 0.25);
  }
  return values;
}

function createDepthMask(
  skeleton: Skeleton,
  activeDepth: number,
  activeWeight: number,
  inactiveWeight: number
): JointMask {
  const mask = new Float32Array(skeleton.joints.length);
  for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
    mask[joint] = jointDepth(skeleton, joint) >= activeDepth ? activeWeight : inactiveWeight;
  }
  return mask;
}

function createSparseMask(skeleton: Skeleton): JointMask {
  const mask = new Float32Array(skeleton.joints.length);
  for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
    mask[joint] = joint === 0 ? 0 : joint % 4 === 0 || joint % 4 === 1 ? 1 : 0.25;
  }
  return mask;
}

function createSkinningFixture(skeleton: Skeleton, vertexCount: number, influences: number): BenchmarkSkinningFixture {
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const jointIndices = new Uint16Array(vertexCount * influences);
  const storedWeightCount = Math.max(0, influences - 1);
  const jointWeights = new Float32Array(vertexCount * storedWeightCount);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const xyz = vertex * 3;
    positions[xyz] = Math.sin(vertex * 0.013) * 0.45;
    positions[xyz + 1] = 0.8 + Math.cos(vertex * 0.017) * 0.3;
    positions[xyz + 2] = ((vertex % 47) - 23) * 0.008;
    normals[xyz] = 0;
    normals[xyz + 1] = 1;
    normals[xyz + 2] = 0;
    tangents[xyz] = 1;
    tangents[xyz + 1] = 0;
    tangents[xyz + 2] = 0;

    for (let influence = 0; influence < influences; influence += 1) {
      jointIndices[vertex * influences + influence] = (vertex * 13 + influence * 17) % skeleton.joints.length;
      if (influence < storedWeightCount) {
        jointWeights[vertex * storedWeightCount + influence] = Math.max(0.05, 0.4 - influence * 0.11);
      }
    }
  }

  return {
    vertexCount,
    influences,
    positions,
    normals,
    tangents,
    jointIndices,
    jointWeights,
    inverseBindMatrices: Array.from({ length: skeleton.joints.length }, () => identityMat4()),
    outPositions: new Float32Array(vertexCount * 3),
    outNormals: new Float32Array(vertexCount * 3),
    outTangents: new Float32Array(vertexCount * 3)
  };
}

function identityMat4(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function jointDepth(skeleton: Skeleton, joint: number): number {
  let depth = 0;
  let parent = skeleton.joints[joint]?.parentIndex ?? NO_PARENT;
  while (parent !== NO_PARENT) {
    depth += 1;
    parent = skeleton.joints[parent]?.parentIndex ?? NO_PARENT;
  }
  return depth;
}

function createAvatarState(index: number): AvatarSamplingState {
  return {
    contexts: [new AnimationSamplingContext(), new AnimationSamplingContext(), new AnimationSamplingContext()],
    timeOffset: index * 0.017,
    modelOut: []
  };
}

function sampleThreeClips(fixture: BenchmarkFixture, avatar: AvatarSamplingState, frame: number): number {
  const time = frameTime(frame, avatar.timeOffset);
  const base = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[0], time, avatar.contexts[0], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const overlay = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[1], time * 0.91, avatar.contexts[1], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const additive = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[2], time * 1.07, avatar.contexts[2], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  return checksumPose(base) + checksumPose(overlay) * 0.25 + checksumPose(additive) * 0.125;
}

function sampleThreePackedClipsTypescript(fixture: BenchmarkFixture, frame: number, timeOffset: number): number {
  const time = frameTime(frame, timeOffset);
  const base = samplePackedRuntimeAnimationToPose(fixture.skeleton, fixture.packedClips[0], time, {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const overlay = samplePackedRuntimeAnimationToPose(fixture.skeleton, fixture.packedClips[1], time * 0.91, {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const additive = samplePackedRuntimeAnimationToPose(fixture.skeleton, fixture.packedClips[2], time * 1.07, {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  return checksumPose(base) + checksumPose(overlay) * 0.25 + checksumPose(additive) * 0.125;
}

function createWasmPackedBenchmarkState(
  arena: WasmPoseArenaContext,
  assets: readonly WasmPackedClipAsset[],
  timeOffset: number
): WasmPackedBenchmarkState {
  if (assets.length !== 3) throw new Error("retained benchmark requires exactly three packed assets");
  return {
    arena,
    samplers: [
      arena.createPackedSamplingContext(assets[0]!),
      arena.createPackedSamplingContext(assets[1]!),
      arena.createPackedSamplingContext(assets[2]!)
    ],
    timeOffset
  };
}

function sampleThreePackedClipsWasm(state: WasmPackedBenchmarkState, frame: number): number {
  const time = frameTime(frame, state.timeOffset);
  if (
    state.samplers[0].sampleTime(time, 1, { loop: true }) !== WaKernelStatus.Ok ||
    state.samplers[1].sampleTime(time * 0.91, 2, { loop: true }) !== WaKernelStatus.Ok ||
    state.samplers[2].sampleTime(time * 1.07, 3, { loop: true }) !== WaKernelStatus.Ok
  ) {
    throw new Error("scalar WASM retained packed sampling failed");
  }
  return (
    checksumTransformSoa(state.arena.poseView(1), state.arena.jointCount) +
    checksumTransformSoa(state.arena.poseView(2), state.arena.jointCount) * 0.25 +
    checksumTransformSoa(state.arena.poseView(3), state.arena.jointCount) * 0.125
  );
}

function evaluateRetainedWasmPipeline(state: WasmPackedBenchmarkState, frame: number): number {
  sampleThreePackedClipsWasm(state, frame);
  const arena = state.arena;
  if (
    arena.blend(
      [
        { pose: 1, weight: 0.82 },
        { pose: 2, weight: 0.34, mask: 0 }
      ],
      { outputPose: 4, threshold: 0.1 }
    ) !== WaKernelStatus.Ok ||
    arena.additiveDelta(0, 3, 5) !== WaKernelStatus.Ok ||
    arena.applyAdditive(4, 5, 0.2, 6, 1) !== WaKernelStatus.Ok ||
    arena.normalize(6) !== WaKernelStatus.Ok ||
    arena.localToModel(6) !== WaKernelStatus.Ok
  ) {
    throw new Error("scalar WASM retained full pipeline failed");
  }
  return checksumTransformSoa(arena.poseView(6), arena.jointCount) + checksumMatrixBuffer(arena.modelPoseView);
}

function evaluateManualPipeline(fixture: BenchmarkFixture, avatar: AvatarSamplingState, frame: number): number {
  const time = frameTime(frame, avatar.timeOffset);
  const base = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[0], time, avatar.contexts[0], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const overlay = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[1], time * 0.91, avatar.contexts[1], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const additive = sampleClipToPoseWithContext(fixture.skeleton, fixture.clips[2], time * 1.07, avatar.contexts[2], {
    loop: true,
    restPose: fixture.skeleton.restPose
  });
  const blended = blendPoses(
    fixture.skeleton,
    [
      { pose: base, weight: 0.82 },
      { pose: overlay, weight: 0.34, mask: fixture.upperMask }
    ],
    { threshold: 0.1, fallbackPose: fixture.skeleton.restPose }
  );
  const additiveDelta = additiveDeltaPose(fixture.skeleton.restPose, additive);
  const localPose = normalizePose(applyAdditivePose(blended, additiveDelta, 0.2, fixture.sparseMask));
  const modelPose = localToModelPose(fixture.skeleton, localPose, avatar.modelOut);
  return checksumPose(localPose) + checksumMatrices(modelPose);
}

function blendAdditiveAndNormalize(fixture: BenchmarkFixture): number {
  return checksumPose(composeBlendAdditivePose(fixture));
}

function createBenchmarkPoseArena(context: WasmPoseArenaContext): WasmPoseArenaContext {
  context.writePose(1, fixture.preSampledBase);
  context.writePose(2, fixture.preSampledOverlay);
  context.writePose(3, fixture.preSampledAdditive);
  context.writeMask(0, fixture.upperMask);
  context.writeMask(1, fixture.sparseMask);
  return context;
}

function blendAdditiveWasmAlreadyPacked(context: WasmPoseArenaContext): number {
  if (
    context.blend(
      [
        { pose: 1, weight: 0.82 },
        { pose: 2, weight: 0.34, mask: 0 }
      ],
      { outputPose: 4, threshold: 0.1 }
    ) !== WaKernelStatus.Ok ||
    context.additiveDelta(0, 3, 5) !== WaKernelStatus.Ok ||
    context.applyAdditive(4, 5, 0.2, 6, 1) !== WaKernelStatus.Ok ||
    context.normalize(6) !== WaKernelStatus.Ok
  ) {
    throw new Error("scalar WASM retained pose job failed");
  }
  return checksumTransformSoa(context.poseView(6), context.jointCount);
}

function composeBlendAdditivePose(fixture: Omit<BenchmarkFixture, "preBlendedPose">): Pose {
  const blended = blendPoses(
    fixture.skeleton,
    [
      { pose: fixture.preSampledBase, weight: 0.82 },
      { pose: fixture.preSampledOverlay, weight: 0.34, mask: fixture.upperMask }
    ],
    { threshold: 0.1, fallbackPose: fixture.skeleton.restPose }
  );
  const additiveDelta = additiveDeltaPose(fixture.skeleton.restPose, fixture.preSampledAdditive);
  return normalizePose(applyAdditivePose(blended, additiveDelta, 0.2, fixture.sparseMask));
}

function localToModelOnly(fixture: BenchmarkFixture, avatar: AvatarSamplingState): number {
  const modelPose = localToModelPose(fixture.skeleton, fixture.preBlendedPose, avatar.modelOut);
  return checksumMatrices(modelPose);
}

function localToModelWasmOnly(context: WasmLocalToModelContext): number {
  const status = context.updateModelPoseFromSoa();
  if (status !== WaKernelStatus.Ok) throw new Error(`scalar WASM local-to-model failed with status ${status}`);
  return checksumMatrixBuffer(context.modelPoseView);
}

function checksumTransformSoa(values: Float32Array, jointCount: number): number {
  let checksum = 0;
  const stride = Math.max(1, Math.floor(jointCount / 12));
  for (let joint = 0; joint < jointCount; joint += stride) {
    const groupBase = (joint >> 2) * 40;
    const lane = joint & 3;
    checksum += (values[groupBase + lane] ?? 0) * 0.5;
    checksum += (values[groupBase + 4 + lane] ?? 0) * 0.25;
    checksum += (values[groupBase + 8 + lane] ?? 0) * 0.125;
    checksum += (values[groupBase + 12 + lane] ?? 0) * 0.0625;
    checksum += (values[groupBase + 16 + lane] ?? 0) * 0.03125;
    checksum += (values[groupBase + 20 + lane] ?? 0) * 0.015625;
    checksum += (values[groupBase + 24 + lane] ?? 0) * 0.0078125;
    checksum += (values[groupBase + 28 + lane] ?? 0) * 0.00390625;
    checksum += (values[groupBase + 32 + lane] ?? 0) * 0.001953125;
    checksum += (values[groupBase + 36 + lane] ?? 0) * 0.0009765625;
  }
  return checksum;
}

function skinningPaletteAndCpu(fixture: BenchmarkFixture): number {
  const modelMatrices = localToModelPose(fixture.skeleton, fixture.preBlendedPose);
  const job: SkinningJob = {
    vertexCount: fixture.skinning.vertexCount,
    influences: fixture.skinning.influences,
    modelMatrices,
    inverseBindMatrices: fixture.skinning.inverseBindMatrices,
    positions: { data: fixture.skinning.positions },
    normals: { data: fixture.skinning.normals },
    tangents: { data: fixture.skinning.tangents },
    jointIndices: fixture.skinning.jointIndices,
    jointWeights: fixture.skinning.jointWeights,
    outPositions: { data: fixture.skinning.outPositions },
    outNormals: { data: fixture.skinning.outNormals },
    outTangents: { data: fixture.skinning.outTangents }
  };
  const result = skinVertices(job);
  return checksumNumericArray(result.positions) + checksumNumericArray(result.normals ?? []) * 0.25;
}

function createBenchmarkSkinningContext(
  kernel: WaifuAnimationWasmKernel,
  fixture: BenchmarkFixture
): WasmSkinningContext {
  return kernel.createSkinningContext({
    vertexCount: fixture.skinning.vertexCount,
    influences: fixture.skinning.influences,
    modelMatrices: localToModelPose(fixture.skeleton, fixture.preBlendedPose),
    inverseBindMatrices: fixture.skinning.inverseBindMatrices,
    positions: { data: fixture.skinning.positions },
    normals: { data: fixture.skinning.normals },
    tangents: { data: fixture.skinning.tangents },
    jointIndices: fixture.skinning.jointIndices,
    jointWeights: fixture.skinning.jointWeights,
    outPositions: { data: fixture.skinning.outPositions.slice() },
    outNormals: { data: fixture.skinning.outNormals.slice() },
    outTangents: { data: fixture.skinning.outTangents.slice() }
  });
}

function skinningPaletteWasm(context: WasmSkinningContext): number {
  const status = context.buildPalette();
  if (status !== WaKernelStatus.Ok) throw new Error(`scalar WASM skinning palette failed with status ${status}`);
  return checksumNumericArray(context.palette);
}

function skinningPaletteAndCpuWasm(context: WasmSkinningContext): number {
  const status = context.runRetained();
  if (status !== WaKernelStatus.Ok) throw new Error(`scalar WASM CPU skinning failed with status ${status}`);
  return checksumNumericArray(context.outPositions) + checksumNumericArray(context.outNormals ?? []) * 0.25;
}

function createRuntime(
  fixture: BenchmarkFixture,
  index: number,
  backend?: NonNullable<ConstructorParameters<typeof AnimationRuntime>[1]>["backend"]
): AnimationRuntime {
  const runtime = new AnimationRuntime(fixture.skeleton, backend ? { backend } : {});
  runtime.setLayer("base", fixture.clips[0], {
    weight: 0.82,
    targetWeight: 0.82,
    fadeSpeed: 0,
    loop: true,
    time: index * 0.013
  });
  runtime.setLayer("overlay", fixture.clips[1], {
    weight: 0.34,
    targetWeight: 0.34,
    fadeSpeed: 0,
    loop: true,
    mask: fixture.upperMask,
    time: index * 0.017
  });
  runtime.setLayer("additive", fixture.clips[2], {
    blendMode: "additive",
    weight: 0.2,
    targetWeight: 0.2,
    fadeSpeed: 0,
    loop: true,
    mask: fixture.sparseMask,
    time: index * 0.019
  });
  return runtime;
}

function evaluateRuntime(runtime: AnimationRuntime): number {
  runtime.update(1 / 60);
  const evaluation = runtime.evaluate();
  return checksumPose(evaluation.localPose) + checksumMatrices(evaluation.modelPose);
}

function frameTime(frame: number, offset: number): number {
  return frame / 60 + offset;
}

function createProceduralDescriptors(jointCount: number): WasmProceduralCorrection[] {
  const root = 0,
    mid = Math.min(1, jointCount - 1),
    end = Math.min(2, jointCount - 1);
  const aimA = Math.min(3, jointCount - 1),
    aimB = Math.min(4, jointCount - 1);
  return [
    {
      kind: "two-bone",
      rootJoint: root,
      midJoint: mid,
      endJoint: end,
      target: [0.15, 1.07, 0.08],
      pole: [0, 0, 1],
      soften: 0.9,
      weight: 0.8,
      maxStretch: 0.98
    },
    {
      kind: "aim",
      joint: aimA,
      target: [0.8, 1.4, 0.6],
      forward: [1, 0, 0],
      up: [0, 1, 0],
      pole: [0, 1, 0],
      weight: 0.45
    },
    {
      kind: "aim",
      joint: aimB,
      target: [0.8, 1.4, 0.6],
      forward: [1, 0, 0],
      up: [0, 1, 0],
      pole: [0, 1, 0],
      weight: 0.65
    },
    {
      kind: "foot",
      hipJoint: root,
      kneeJoint: mid,
      ankleJoint: end,
      targetAnkle: [0.08, 1.02, 0.04],
      pole: [0, 0, 1],
      influence: 0.7,
      maxStretch: 0.98,
      orientationTarget: [0.08, 2.02, 0.04],
      orientationWeight: 0.5
    }
  ];
}

function proceduralTypescript(fixture: BenchmarkFixture, descriptors: readonly WasmProceduralCorrection[]): number {
  const localPose = clonePose(fixture.preBlendedPose);
  const modelPose = localToModelPose(fixture.skeleton, localPose);
  for (const d of descriptors) {
    if (d.kind === "aim") {
      const aim = solveAimIk({
        joint: modelPose[d.joint]!,
        target: [...d.target],
        forward: [...(d.forward ?? [1, 0, 0])],
        up: [...(d.up ?? [0, 1, 0])],
        pole: [...(d.pole ?? [0, 1, 0])],
        ...(d.weight === undefined ? {} : { weight: d.weight })
      });
      applyAimIkModelCorrection({
        skeleton: fixture.skeleton,
        localPose,
        modelPose,
        joint: d.joint,
        jointCorrection: aim.jointCorrection
      });
    } else {
      const rootJoint = d.kind === "two-bone" ? d.rootJoint : d.hipJoint;
      const midJoint = d.kind === "two-bone" ? d.midJoint : d.kneeJoint;
      const endJoint = d.kind === "two-bone" ? d.endJoint : d.ankleJoint;
      const solved = solveTwoBoneIkModel({
        root: modelPose[rootJoint]!,
        mid: modelPose[midJoint]!,
        end: modelPose[endJoint]!,
        target: [...(d.kind === "two-bone" ? d.target : d.targetAnkle)],
        ...(d.pole ? { pole: [...d.pole] } : {}),
        ...((d.kind === "two-bone" ? d.weight : d.influence) === undefined
          ? {}
          : { weight: d.kind === "two-bone" ? d.weight : d.influence }),
        ...(d.maxStretch === undefined ? {} : { maxStretch: d.maxStretch })
      });
      applyTwoBoneIkLocalCorrections({
        skeleton: fixture.skeleton,
        localPose,
        modelPose,
        rootJoint,
        midJoint,
        corrections: solved
      });
    }
  }
  return checksumPose(localPose) + checksumMatrices(modelPose);
}

function proceduralWasm(
  arena: WasmPoseArenaContext,
  context: WasmProceduralCorrectionContext,
  fixture: BenchmarkFixture,
  descriptors: readonly WasmProceduralCorrection[]
): number {
  arena.writePose(7, fixture.preBlendedPose);
  arena.localToModel(7);
  context.run(7, descriptors);
  return checksumTransformSoa(arena.poseView(7), arena.jointCount) + checksumMatrixBuffer(arena.modelPoseView);
}

function runBenchmark(input: {
  name: string;
  description: string;
  config: BenchmarkConfig;
  operationCountPerIteration: number;
  op: (frame: number) => number;
}): BenchmarkResult {
  let checksum = 0;
  for (let frame = 0; frame < input.config.warmup; frame += 1) checksum += input.op(frame);
  const start = performance.now();
  for (let frame = 0; frame < input.config.iterations; frame += 1) {
    checksum += input.op(frame + input.config.warmup);
  }
  const totalMs = performance.now() - start;
  const operationCount = input.config.iterations * input.operationCountPerIteration;
  const msPerOperation = totalMs / operationCount;
  return {
    name: input.name,
    description: input.description,
    iterations: input.config.iterations,
    warmup: input.config.warmup,
    operationCount,
    totalMs: round(totalMs, 6),
    msPerOperation: round(msPerOperation, 9),
    operationsPerSecond: round(1000 / msPerOperation, 3),
    checksum: round(checksum, 6)
  };
}

function checksumPose(pose: readonly Pose[number][]): number {
  let sum = 0;
  const stride = Math.max(1, Math.floor(pose.length / 12));
  for (let joint = 0; joint < pose.length; joint += stride) {
    const transform = pose[joint]!;
    sum += transform.translation[0] * 0.5 + transform.translation[1] * 0.25 + transform.translation[2] * 0.125;
    sum += transform.rotation[0] * 0.0625 + transform.rotation[1] * 0.03125 + transform.rotation[2] * 0.015625;
    sum += transform.rotation[3] * 0.0078125;
    sum += transform.scale[0] * 0.00390625 + transform.scale[1] * 0.001953125 + transform.scale[2] * 0.0009765625;
  }
  return sum;
}

function checksumMatrices(matrices: readonly Mat4[]): number {
  let sum = 0;
  const stride = Math.max(1, Math.floor(matrices.length / 12));
  for (let joint = 0; joint < matrices.length; joint += stride) {
    const matrix = matrices[joint]!;
    sum += (matrix[0] ?? 0) * 0.5 + (matrix[5] ?? 0) * 0.25 + (matrix[10] ?? 0) * 0.125;
    sum += (matrix[12] ?? 0) * 0.0625 + (matrix[13] ?? 0) * 0.03125 + (matrix[14] ?? 0) * 0.015625;
  }
  return sum;
}

function checksumMatrixBuffer(values: Float32Array): number {
  const jointCount = Math.floor(values.length / 16);
  let sum = 0;
  const stride = Math.max(1, Math.floor(jointCount / 12));
  for (let joint = 0; joint < jointCount; joint += stride) {
    const base = joint * 16;
    sum += (values[base] ?? 0) * 0.5 + (values[base + 5] ?? 0) * 0.25 + (values[base + 10] ?? 0) * 0.125;
    sum += (values[base + 12] ?? 0) * 0.0625 + (values[base + 13] ?? 0) * 0.03125 + (values[base + 14] ?? 0) * 0.015625;
  }
  return sum;
}

function checksumNumericArray(values: ArrayLike<number>): number {
  let sum = 0;
  const stride = Math.max(1, Math.floor(values.length / 24));
  for (let index = 0; index < values.length; index += stride) {
    sum += (values[index] ?? 0) * 0.5;
  }
  return sum;
}

function rankHotPaths(results: readonly BenchmarkResult[]): HotPathRank[] {
  const resultByName = new Map(results.map((result) => [result.name, result]));
  const sampling = resultByName.get("sampling_3_clips_1_avatar")!;
  const blend = resultByName.get("blend_additive_masks_typescript_object_pose_1_avatar")!;
  const localToModel = resultByName.get("local_to_model_1_avatar")!;
  const skinning = resultByName.get("skinning_palette_cpu_1_avatar")!;
  const runtimeResult = resultByName.get("animation_runtime_evaluate_1_avatar")!;
  const candidates: Omit<HotPathRank, "rank">[] = [
    {
      job: "AnimationRuntime composition frame",
      measuredWorkload: runtimeResult.name,
      msPerAvatarFrame: runtimeResult.msPerOperation,
      structuralFrequency: "once per animated avatar frame when using AnimationRuntime",
      rationale:
        "contains layer state update, active-layer sort, clip sampling, blend/additive/masks, normalization, and local-to-model output"
    },
    {
      job: "skinning palette and CPU vertex skinning",
      measuredWorkload: skinning.name,
      msPerAvatarFrame: skinning.msPerOperation,
      structuralFrequency:
        "per CPU-skinned mesh/update; optional for GPU-skinned production paths but important for debug/geometry adapters",
      rationale:
        "builds a matrix palette and loops vertices x influences for positions, normals, tangents, weight repair, and output reuse"
    },
    {
      job: "clip sampling into local TRS poses",
      measuredWorkload: sampling.name,
      msPerAvatarFrame: sampling.msPerOperation,
      structuralFrequency: "per active layer per animated avatar frame; benchmark samples three full-joint clips",
      rationale:
        "walks every transform track, seeks/interpolates keys, repairs finite values, normalizes/hemispheres quaternions, and currently materializes JS Transform objects"
    },
    {
      job: "blend/additive/mask composition",
      measuredWorkload: blend.name,
      msPerAvatarFrame: blend.msPerOperation,
      structuralFrequency: "per priority group and additive layer after sampling",
      rationale:
        "iterates all joints and layers, applies mask weights, accumulates TRS channels, normalizes quaternions, computes additive deltas, and allocates output poses"
    },
    {
      job: "local-to-model matrix propagation",
      measuredWorkload: localToModel.name,
      msPerAvatarFrame: localToModel.msPerOperation,
      structuralFrequency: "once after final local pose, plus partial refreshes after IK/aim corrections",
      rationale:
        "composes one matrix per joint and multiplies parent-child matrices in hierarchy order; bounded data shape makes it a low-risk first WASM kernel"
    }
  ];
  return candidates
    .sort((a, b) => b.msPerAvatarFrame - a.msPerAvatarFrame)
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
