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
  const sourceDelta = remapHumanoidSourceDelta(multiplyQuat(srcSample, invertQuat(srcRest)), srcRest, humanBone);
  return normalizeQuat(multiplyQuat(sourceDelta, dstRest));
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
  if (!humanBone || !isRolledLowerLegSource(sourceRest, humanBone)) return sourceDelta;
  // Motus/FBX lower-leg tracks arrive with knee hinge motion on the rolled source Z axis.
  return normalizeQuat([sourceDelta[2], sourceDelta[1], sourceDelta[0], sourceDelta[3]]);
}

function isRolledLowerLegSource(sourceRest: Quat, humanBone: string): boolean {
  if (humanBone !== "leftLowerLeg" && humanBone !== "rightLowerLeg") return false;
  return Math.abs(sourceRest[2]) > Math.max(0.15, Math.abs(sourceRest[0]) * 2, Math.abs(sourceRest[1]) * 2);
}
