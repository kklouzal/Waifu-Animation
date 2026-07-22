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
  blendPoses,
  createSkeleton,
  localToModelPose,
  loadWaifuAnimationWasmKernel,
  normalizePose,
  quatFromAxisAngle,
  sampleClipToPoseWithContext,
  sanitizeQuaternionTrackValues,
  skinVertices,
  toFloat32Array,
  type AnimationClip,
  type JointMask,
  type Mat4,
  type Pose,
  type Quat,
  type Skeleton,
  type SkinningJob,
  WaKernelStatus,
  type WaKernelLoadResult,
  type WasmLocalToModelContext
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
const singleAvatar = createAvatarState(0);
const multiAvatars = Array.from({ length: config.multiAvatarCount }, (_value, index) => createAvatarState(index));
const runtime = createRuntime(fixture, 0);
const runtimeAvatars = Array.from({ length: config.runtimeAvatarCount }, (_value, index) =>
  createRuntime(fixture, index)
);

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
results.push(
  runBenchmark({
    name: "blend_additive_masks_1_avatar",
    description: "blend two override poses, apply one additive masked pose, and normalize one avatar pose",
    config,
    operationCountPerIteration: 1,
    op: () => blendAdditiveAndNormalize(fixture)
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
          featureFlags: wasmKernel.kernel.featureFlags
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
    "WASM startup is reported separately in wasmKernel.startupMs and is not included in steady-state local_to_model_scalar_wasm_1_avatar timings.",
    "No heap-allocation precision is claimed. Current TypeScript object churn is inferred structurally from API shapes, not Node heap deltas.",
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

function createRuntime(fixture: BenchmarkFixture, index: number): AnimationRuntime {
  const runtime = new AnimationRuntime(fixture.skeleton);
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
  const blend = resultByName.get("blend_additive_masks_1_avatar")!;
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
