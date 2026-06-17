import { type Quat, cloneNormalizedQuat, ensureShortestQuat, invertQuat, multiplyQuat, normalizeQuat } from "./math.js";
import { type HumanoidBoneName, VRM_HUMANOID_BONES } from "./skeleton.js";

export type RetargetedQuaternionTrack = {
  values: number[];
  invalidSamples: number;
};

export const VRM_HUMANOID_SET = new Set<string>(VRM_HUMANOID_BONES);

export function isHumanoidBoneName(value: string): value is HumanoidBoneName {
  return VRM_HUMANOID_SET.has(value);
}

export function retargetQuaternionSample(sourceRest: Quat, targetRest: Quat, sourceSample: Quat, humanBone?: string): Quat {
  const srcRest = normalizeQuat(sourceRest);
  const dstRest = normalizeQuat(targetRest);
  const srcSample = normalizeQuat(sourceSample, srcRest);
  const sourceDelta = remapHumanoidSourceDelta(multiplyQuat(invertQuat(srcRest), srcSample), srcRest, humanBone);
  return normalizeQuat(multiplyQuat(dstRest, sourceDelta));
}

export function retargetQuaternionTrackValues(
  values: readonly number[],
  sourceRest: ArrayLike<number> | undefined,
  targetRest: ArrayLike<number>,
  humanBone?: string
): RetargetedQuaternionTrack {
  if (values.length % 4 !== 0) throw new Error("quaternion values must be a multiple of 4");
  const output: number[] = [];
  const srcRest = sourceRest ? cloneNormalizedQuat(sourceRest) : null;
  const dstRest = cloneNormalizedQuat(targetRest);
  let invalidSamples = 0;
  let previous: Quat = [0, 0, 0, 1];
  for (let i = 0; i < values.length; i += 4) {
    const sample = normalizeQuat([values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, values[i + 3] ?? 1]);
    let retargeted = srcRest ? retargetQuaternionSample(srcRest, dstRest, sample, humanBone) : sample;
    if (!retargeted.every(Number.isFinite)) {
      invalidSamples += 1;
      retargeted = previous;
    }
    if (i > 0) retargeted = ensureShortestQuat(previous, retargeted);
    output.push(...retargeted);
    previous = retargeted;
  }
  return { values: output, invalidSamples };
}

function remapHumanoidSourceDelta(sourceDelta: Quat, sourceRest: Quat, humanBone: string | undefined): Quat {
  if (!humanBone) return sourceDelta;
  if (isRolledUpperArmSource(sourceRest, humanBone)) {
    // Motus/FBX upper-arm deltas arrive in a source-local basis that leaves VRM normalized arms horizontal.
    return humanBone === "leftUpperArm"
      ? normalizeQuat([-sourceDelta[1], sourceDelta[2], sourceDelta[0], sourceDelta[3]])
      : normalizeQuat([-sourceDelta[1], -sourceDelta[2], -sourceDelta[0], sourceDelta[3]]);
  }
  if (isRolledLeftLowerArmSource(sourceRest, humanBone)) {
    // Motus/FBX left forearm uses the opposite bend sign after upper-arm basis remapping.
    return normalizeQuat([sourceDelta[0], sourceDelta[1], -sourceDelta[2], sourceDelta[3]]);
  }
  if (isMotusLegZAxisDelta(sourceDelta, humanBone)) {
    // Motus/FBX leg hinges are authored on source-local Z, while VRM leg flexion is local X.
    return normalizeQuat([sourceDelta[2], sourceDelta[1], sourceDelta[0], sourceDelta[3]]);
  }
  if (isRolledLowerLegSource(sourceRest, humanBone)) {
    // Motus/FBX lower-leg tracks arrive with knee hinge motion on the rolled source Z axis.
    return normalizeQuat([sourceDelta[2], sourceDelta[1], sourceDelta[0], sourceDelta[3]]);
  }
  return sourceDelta;
}

function isMotusLegZAxisDelta(sourceDelta: Quat, humanBone: string): boolean {
  if (humanBone !== "leftUpperLeg" && humanBone !== "rightUpperLeg" && humanBone !== "leftLowerLeg" && humanBone !== "rightLowerLeg") return false;
  return Math.abs(sourceDelta[2]) > 0.15 && Math.abs(sourceDelta[2]) > Math.abs(sourceDelta[0]) * 2;
}

function isRolledLeftLowerArmSource(sourceRest: Quat, humanBone: string): boolean {
  return humanBone === "leftLowerArm" && Math.abs(sourceRest[0]) < 0.05 && Math.abs(sourceRest[1]) < 0.05 && Math.abs(sourceRest[2]) < 0.05 && sourceRest[3] > 0.95;
}

function isRolledUpperArmSource(sourceRest: Quat, humanBone: string): boolean {
  if (humanBone !== "leftUpperArm" && humanBone !== "rightUpperArm") return false;
  return Math.abs(sourceRest[1]) > 0.05 && Math.abs(sourceRest[2]) > 0.15 && sourceRest[3] > 0.85;
}

function isRolledLowerLegSource(sourceRest: Quat, humanBone: string): boolean {
  if (humanBone !== "leftLowerLeg" && humanBone !== "rightLowerLeg") return false;
  return Math.abs(sourceRest[2]) > Math.max(0.15, Math.abs(sourceRest[0]) * 2, Math.abs(sourceRest[1]) * 2);
}
