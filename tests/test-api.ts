export { default as assert } from "node:assert/strict";
export {
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LoopOnce,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3
} from "three";
export type { AnimationAction } from "three";
export * from "../src/index.js";

// Scalar numeric implementations are test-only differential references.
export { clonePose, normalizePose, blendPoses, additiveDeltaPose, applyAdditivePose } from "./reference/pose.js";
export { localToModelPose, updateLocalToModelPoseRange } from "./reference/skeleton.js";
export {
  samplePackedRuntimeAnimationToPose,
  samplePackedRuntimeAnimationToPoseAtRatio
} from "./reference/packed-runtime.js";

export { AnimationRuntime as ReferenceAnimationRuntime } from "./reference/runtime.js";

export { buildSkinningMatrixPalette, skinVertices } from "./reference/skinning.js";

export {
  AnimationSamplingContext,
  sampleClipToPose,
  sampleClipToPoseAtRatio,
  sampleClipToPoseWithContext,
  sampleRatioToTime,
  sampleTime,
  sampleTrack
} from "./reference/clip-sampling.js";
export {
  createHumanoidLookAtAimChain,
  modelCorrectionToLocalPostCorrection,
  solveAimIk,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  solveTwoBoneIkModel
} from "./reference/ik-core.js";

export * from "../src/motion.js";
