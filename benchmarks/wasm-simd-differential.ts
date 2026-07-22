import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  WaKernelStatus,
  createSkeleton,
  loadWaifuAnimationWasmKernel,
  quatFromAxisAngle,
  type Transform,
  type WaifuAnimationWasmKernel,
  type WasmPoseArenaContext
} from "../src/index.js";

const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const joints = readArg("--joints", 72);
const iterations = readArg("--iterations", smoke ? 120 : 2_000);
const warmup = readArg("--warmup", smoke ? 30 : 300);
const scalarBytes = bytes("scalar");
const simdBytes = bytes("simd");

const scalarStart = performance.now();
const scalarLoad = await loadWaifuAnimationWasmKernel({
  source: { bytes: scalarBytes },
  webAssembly: { instantiate: WebAssembly.instantiate.bind(WebAssembly), validate: () => false }
});
const scalarStartupMs = performance.now() - scalarStart;
const simdStart = performance.now();
const simdLoad = await loadWaifuAnimationWasmKernel({
  source: { bytes: scalarBytes },
  simdSource: { bytes: simdBytes }
});
const simdStartupMs = performance.now() - simdStart;
if (simdLoad.mode !== "simd") throw new Error("current engine did not select the SIMD artifact");

const skeleton = createSkeleton(
  Array.from({ length: joints }, (_, joint) => ({
    name: `joint_${joint}`,
    ...(joint === 0 ? {} : { parentIndex: joint - 1 }),
    rest: poseAt(joint, 0)
  }))
);
const poses = [0.13, 0.47, 0.89].map((phase) => Array.from({ length: joints }, (_, joint) => poseAt(joint, phase)));
const mask = Float32Array.from({ length: joints }, (_, joint) => 0.1 + 0.9 * (joint / Math.max(1, joints - 1)));

const scalarSetupStart = performance.now();
const scalar = setup(scalarLoad.kernel);
const scalarSetupMs = performance.now() - scalarSetupStart;
const simdSetupStart = performance.now();
const simd = setup(simdLoad.kernel);
const simdSetupMs = performance.now() - simdSetupStart;

const scalarChain = measure("scalar", "retained_chain", scalar, runChain);
const simdChain = measure("simd", "retained_chain", simd, runChain);
const scalarLocalToModel = measure("scalar", "local_to_model", scalar, runLocalToModel);
const simdBefore = simdLoad.kernel.simdExecutionCount;
const simdLocalToModel = measure("simd", "local_to_model", simd, runLocalToModel);
const simdAfter = simdLoad.kernel.simdExecutionCount;

runChain(scalar);
const scalarFinal = Array.from(scalar.modelPoseView);
runChain(simd);
const simdFinal = Array.from(simd.modelPoseView);
let maxAbsDifference = 0;
for (let index = 0; index < scalarFinal.length; index += 1) {
  maxAbsDifference = Math.max(maxAbsDifference, Math.abs(scalarFinal[index]! - simdFinal[index]!));
}
if (maxAbsDifference > 3e-5) throw new Error(`scalar/SIMD parity failed: ${maxAbsDifference}`);
if (simdAfter <= simdBefore) throw new Error("SIMD execution counter did not advance");
if (Math.abs(scalarChain.checksum - simdChain.checksum) > 0.05)
  throw new Error("retained-chain checksum parity failed");

const output = {
  fixture: { joints, iterations, warmup, deterministicSeed: "analytic-0.13/0.47/0.89" },
  artifacts: {
    scalar: { bytes: scalarBytes.byteLength, fdBytes: countByte(scalarBytes, 0xfd) },
    simd: { bytes: simdBytes.byteLength, fdBytes: countByte(simdBytes, 0xfd) }
  },
  startup: { scalarMs: scalarStartupMs, simdMs: simdStartupMs },
  setup: {
    scalarMs: scalarSetupMs,
    simdMs: simdSetupMs,
    scalarMemoryBytes: scalarLoad.kernel.memory.buffer.byteLength,
    simdMemoryBytes: simdLoad.kernel.memory.buffer.byteLength
  },
  steadyState: [scalarLocalToModel, simdLocalToModel, scalarChain, simdChain],
  parity: { maxAbsDifference, scalarChecksum: scalarChain.checksum, simdChecksum: simdChain.checksum },
  simdProof: {
    featureFlags: simdLoad.kernel.featureFlags,
    executionMode: simdLoad.kernel.executionMode,
    executionCountBefore: simdBefore,
    executionCountAfter: simdAfter,
    dispatchedJobs: ["local-to-model parent×local matrices", "model×inverse-bind palette matrices"]
  },
  caveats: [
    "Node/Dev-01 microbenchmark; smoke mode is directional.",
    "Retained-chain timing excludes async startup, setup, Transform packing, and final JS materialization.",
    "0xfd byte counts are artifact evidence only; executionMode plus the SIMD-only counter prove selected v128 dispatch executed.",
    "SIMD preference is mandatory when supported even if an individual row is not faster."
  ]
};
console.log(JSON.stringify(output, null, 2));

function setup(kernel: WaifuAnimationWasmKernel): WasmPoseArenaContext {
  const arena = kernel.createPoseArenaContext(skeleton, {
    poseCapacity: 8,
    maskCapacity: 1,
    maskValueCapacity: joints,
    layerCapacity: 2
  });
  arena.writePose(1, poses[0]!);
  arena.writePose(2, poses[1]!);
  arena.writePose(3, poses[2]!);
  arena.writeMask(0, mask);
  runChain(arena);
  return arena;
}

function runLocalToModel(arena: WasmPoseArenaContext): void {
  expectOk(arena.localToModel(4), "local-to-model");
}

function runChain(arena: WasmPoseArenaContext): void {
  expectOk(
    arena.blend(
      [
        { pose: 1, weight: 0.65 },
        { pose: 2, weight: 0.35, mask: 0, maskCount: joints }
      ],
      { fallbackPose: 0, outputPose: 4, threshold: 0.01 }
    ),
    "blend"
  );
  expectOk(arena.additiveDelta(0, 3, 5), "additive-delta");
  expectOk(arena.applyAdditive(4, 5, 0.22, 6, 0, joints), "apply-additive");
  expectOk(arena.normalize(6, 7), "normalize");
  expectOk(arena.localToModel(7), "local-to-model");
}

function measure(
  mode: "scalar" | "simd",
  name: string,
  arena: WasmPoseArenaContext,
  operation: (arena: WasmPoseArenaContext) => void
) {
  for (let index = 0; index < warmup; index += 1) operation(arena);
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) operation(arena);
  const totalMs = performance.now() - start;
  let checksum = 0;
  const model = arena.modelPoseView;
  for (let index = 0; index < model.length; index += 13) checksum += model[index] ?? 0;
  return {
    mode,
    job: name,
    totalMs,
    msPerIteration: totalMs / iterations,
    iterations,
    checksum
  };
}

function poseAt(joint: number, phase: number): Transform {
  const angle = Math.sin(joint * 0.173 + phase) * 0.31;
  return {
    translation: [
      joint === 0 ? Math.sin(phase) * 0.1 : Math.sin(joint * 0.11 + phase) * 0.015,
      joint === 0 ? 1 : 0.045 + (joint % 5) * 0.003,
      Math.cos(joint * 0.07 + phase) * 0.012
    ],
    rotation: quatFromAxisAngle([0.3, 0.9, 0.2], angle),
    scale: [1 + Math.sin(phase + joint * 0.03) * 0.01, 1, 1 - Math.sin(phase + joint * 0.03) * 0.005]
  };
}

function bytes(mode: "scalar" | "simd"): ArrayBuffer {
  const file = readFileSync(new URL(`../dist/wasm-kernel/waifu_animation_kernel.${mode}.wasm`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

function countByte(buffer: ArrayBuffer, value: number): number {
  let count = 0;
  for (const byte of new Uint8Array(buffer)) if (byte === value) count += 1;
  return count;
}

function expectOk(status: WaKernelStatus, job: string): void {
  if (status !== WaKernelStatus.Ok) throw new Error(`${job} failed with status ${status}`);
}

function readArg(name: string, fallback: number): number {
  const index = args.indexOf(name);
  const value = index >= 0 ? Number(args[index + 1]) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
