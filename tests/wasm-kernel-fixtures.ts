import type { AnimationClip, Mat4, Skeleton, SkinningJob } from "./test-api.js";
import {
  ReferenceAnimationRuntime as Runtime,
  createSkeleton,
  quatFromAxisAngle,
  sanitizeQuaternionTrackValues,
  toFloat32Array
} from "./test-api.js";

export type WasmKernelSyntheticOptions = {
  jointCount?: number;
  keyCount?: number;
  vertexCount?: number;
  influences?: number;
  phase?: number;
};

export type WasmKernelSyntheticFixture = {
  skeleton: Skeleton;
  clip: AnimationClip;
  overlayClip: AnimationClip;
  additiveClip: AnimationClip;
  upperBodyMask: Float32Array;
  additiveMask: Float32Array;
  skinning: {
    vertexCount: number;
    influences: number;
    positions: Float32Array;
    normals: Float32Array;
    tangents: Float32Array;
    jointIndices: Uint16Array;
    jointWeights: Float32Array;
    outPositions: Float32Array;
    outNormals: Float32Array;
    outTangents: Float32Array;
  };
  ik: {
    rootJoint: number;
    midJoint: number;
    endJoint: number;
    aimJoint: number;
  };
};

export function createWasmKernelSyntheticFixture(options: WasmKernelSyntheticOptions = {}): WasmKernelSyntheticFixture {
  const jointCount = sanitizeCount(options.jointCount, 48, 1, 256);
  const keyCount = sanitizeCount(options.keyCount, 5, 2, 32);
  const vertexCount = sanitizeCount(options.vertexCount, 1024, 0, 200_000);
  const influences = sanitizeCount(options.influences, 4, 1, 8);
  const phase = Number.isFinite(options.phase) ? options.phase! : 0;
  const skeleton = createWasmKernelSkeleton(jointCount, phase);
  return {
    skeleton,
    clip: createWasmKernelClip("wasm-kernel-base", jointCount, keyCount, phase, 1),
    overlayClip: createWasmKernelClip("wasm-kernel-overlay", jointCount, keyCount, phase + 0.37, 0.45),
    additiveClip: createWasmKernelClip("wasm-kernel-additive", jointCount, keyCount, phase + 0.71, 0.18),
    upperBodyMask: createGradientMask(jointCount, 0.25),
    additiveMask: createGradientMask(jointCount, 0.1),
    skinning: createWasmKernelSkinningBuffers(jointCount, vertexCount, influences, phase),
    ik: {
      rootJoint: 0,
      midJoint: Math.min(1, jointCount - 1),
      endJoint: Math.min(2, jointCount - 1),
      aimJoint: Math.min(3, jointCount - 1)
    }
  };
}

export function createWasmKernelRuntime(fixture: WasmKernelSyntheticFixture): Runtime {
  const runtime = new Runtime(fixture.skeleton, { blendThreshold: 0.01 });
  runtime.setLayer("base", fixture.clip, { weight: 1, targetWeight: 1, loop: true, priority: 0 });
  runtime.setLayer("overlay", fixture.overlayClip, {
    weight: 0.35,
    targetWeight: 0.35,
    loop: true,
    priority: 1,
    mask: fixture.upperBodyMask
  });
  runtime.setLayer("additive", fixture.additiveClip, {
    weight: 0.2,
    targetWeight: 0.2,
    loop: true,
    priority: 2,
    blendMode: "additive",
    mask: fixture.additiveMask
  });
  return runtime;
}

export function createSkinningJobForModelPose(
  fixture: WasmKernelSyntheticFixture,
  modelPose: readonly Mat4[]
): SkinningJob {
  return {
    vertexCount: fixture.skinning.vertexCount,
    influences: fixture.skinning.influences,
    jointMatrices: modelPose,
    jointIndices: fixture.skinning.jointIndices,
    jointWeights: fixture.skinning.jointWeights,
    positions: { data: fixture.skinning.positions },
    normals: { data: fixture.skinning.normals },
    tangents: { data: fixture.skinning.tangents },
    outPositions: { data: fixture.skinning.outPositions },
    outNormals: { data: fixture.skinning.outNormals },
    outTangents: { data: fixture.skinning.outTangents }
  };
}

function createWasmKernelSkeleton(jointCount: number, phase: number): Skeleton {
  return createSkeleton(
    Array.from({ length: jointCount }, (_, index) => ({
      name: `joint_${index}`,
      ...(index === 0 ? {} : { parentIndex: index - 1 }),
      rest: {
        translation: [
          index === 0 ? 0 : Math.sin(index * 0.17 + phase) * 0.015,
          index === 0 ? 1 : 0.045 + (index % 5) * 0.003,
          index === 0 ? 0 : Math.cos(index * 0.13 + phase) * 0.012
        ] as [number, number, number],
        rotation: quatFromAxisAngle([0, 1, 0], Math.sin(index * 0.11 + phase) * 0.015),
        scale: [1, 1, 1] as [number, number, number]
      }
    }))
  );
}

function createWasmKernelClip(
  id: string,
  jointCount: number,
  keyCount: number,
  phase: number,
  amplitude: number
): AnimationClip {
  const duration = new Float32Array([1.6])[0]!;
  const times = Array.from({ length: keyCount }, (_, index) => (duration * index) / (keyCount - 1));
  const tracks: AnimationClip["tracks"] = [];
  for (let joint = 0; joint < jointCount; joint += 1) {
    tracks.push({
      joint: `joint_${joint}`,
      property: "translation",
      times: toFloat32Array(times),
      values: toFloat32Array(flattenKeyValues(times, joint, phase, amplitude, 3, translationSample))
    });
    tracks.push({
      joint: `joint_${joint}`,
      property: "rotation",
      times: toFloat32Array(times),
      values: sanitizeQuaternionTrackValues(flattenKeyValues(times, joint, phase, amplitude, 4, rotationSample))
    });
    tracks.push({
      joint: `joint_${joint}`,
      property: "scale",
      times: toFloat32Array(times),
      values: toFloat32Array(flattenKeyValues(times, joint, phase, amplitude, 3, scaleSample))
    });
  }
  return { id, name: id, duration, loop: true, tracks };
}

function flattenKeyValues(
  times: readonly number[],
  joint: number,
  phase: number,
  amplitude: number,
  stride: 3 | 4,
  sample: (time: number, joint: number, phase: number, amplitude: number) => readonly number[]
): number[] {
  const values: number[] = [];
  for (const time of times) {
    const sampled = sample(time, joint, phase, amplitude);
    for (let index = 0; index < stride; index += 1) values.push(sampled[index] ?? (index === 3 ? 1 : 0));
  }
  return values;
}

function translationSample(time: number, joint: number, phase: number, amplitude: number): readonly number[] {
  return [
    Math.sin(time * 3.1 + joint * 0.17 + phase) * 0.035 * amplitude,
    (joint === 0 ? 1 : 0.045 + (joint % 5) * 0.003) + Math.cos(time * 2.3 + joint * 0.07 + phase) * 0.01 * amplitude,
    Math.sin(time * 2.7 + joint * 0.11 + phase) * 0.025 * amplitude
  ];
}

function rotationSample(time: number, joint: number, phase: number, amplitude: number): readonly number[] {
  const axis = normalize3([((joint % 3) - 1) * 0.31 + 0.13, 0.7 + (joint % 5) * 0.03, ((joint % 7) - 3) * 0.09 + 0.21]);
  return quatFromAxisAngle(axis, Math.sin(time * 2.9 + joint * 0.19 + phase) * 0.4 * amplitude);
}

function scaleSample(time: number, joint: number, phase: number, amplitude: number): readonly number[] {
  const amount = Math.sin(time * 1.7 + joint * 0.23 + phase) * 0.015 * amplitude;
  return [1 + amount, 1 - amount * 0.5, 1 + amount * 0.25];
}

function createGradientMask(jointCount: number, floor: number): Float32Array {
  const mask = new Float32Array(jointCount);
  const denominator = Math.max(1, jointCount - 1);
  for (let joint = 0; joint < jointCount; joint += 1) {
    mask[joint] = floor + (1 - floor) * (joint / denominator);
  }
  return mask;
}

function createWasmKernelSkinningBuffers(
  jointCount: number,
  vertexCount: number,
  influences: number,
  phase: number
): WasmKernelSyntheticFixture["skinning"] {
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const jointIndices = new Uint16Array(vertexCount * influences);
  const storedWeightCount = Math.max(0, influences - 1);
  const jointWeights = new Float32Array(vertexCount * storedWeightCount);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * 3;
    positions[base] = Math.sin(vertex * 0.013 + phase) * 0.5;
    positions[base + 1] = Math.cos(vertex * 0.017 + phase) * 0.25 + 1;
    positions[base + 2] = ((vertex % 31) - 15) * 0.01;
    normals[base] = 0;
    normals[base + 1] = 1;
    normals[base + 2] = 0;
    tangents[base] = 1;
    tangents[base + 1] = 0;
    tangents[base + 2] = 0;

    for (let influence = 0; influence < influences; influence += 1) {
      jointIndices[vertex * influences + influence] = (vertex * 7 + influence * 11) % jointCount;
      if (influence < storedWeightCount) {
        jointWeights[vertex * storedWeightCount + influence] = Math.max(0.05, 0.42 - influence * 0.11);
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
    outPositions: new Float32Array(vertexCount * 3),
    outNormals: new Float32Array(vertexCount * 3),
    outTangents: new Float32Array(vertexCount * 3)
  };
}

function sanitizeCount(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value!));
}

function normalize3(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 1e-8)) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}
