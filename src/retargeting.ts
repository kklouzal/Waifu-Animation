import { type Quat, cloneQuat, invertQuat, multiplyQuat, normalizeQuat } from "./math.js";
import { type HumanoidBoneName, VRM_HUMANOID_BONES } from "./skeleton.js";

export type RetargetedQuaternionTrack = {
  values: number[];
  invalidSamples: number;
};

export const VRM_HUMANOID_SET = new Set<string>(VRM_HUMANOID_BONES);

export function isHumanoidBoneName(value: string): value is HumanoidBoneName {
  return VRM_HUMANOID_SET.has(value);
}

export function retargetQuaternionSample(sourceRest: Quat, targetRest: Quat, sourceSample: Quat): Quat {
  return normalizeQuat(multiplyQuat(multiplyQuat(targetRest, invertQuat(sourceRest)), sourceSample));
}

export function retargetQuaternionTrackValues(values: readonly number[], sourceRest: ArrayLike<number> | undefined, targetRest: ArrayLike<number>): RetargetedQuaternionTrack {
  if (values.length % 4 !== 0) throw new Error("quaternion values must be a multiple of 4");
  const output: number[] = [];
  const srcRest = normalizeQuat(cloneQuat(sourceRest, [0, 0, 0, 1]));
  const dstRest = normalizeQuat(cloneQuat(targetRest, [0, 0, 0, 1]));
  let invalidSamples = 0;
  let previous: Quat = [0, 0, 0, 1];
  for (let i = 0; i < values.length; i += 4) {
    const sample = normalizeQuat([values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, values[i + 3] ?? 1]);
    let retargeted = retargetQuaternionSample(srcRest, dstRest, sample);
    if (!retargeted.every(Number.isFinite)) {
      invalidSamples += 1;
      retargeted = previous;
    }
    if (i > 0 && previous[0] * retargeted[0] + previous[1] * retargeted[1] + previous[2] * retargeted[2] + previous[3] * retargeted[3] < 0) {
      retargeted = [-retargeted[0], -retargeted[1], -retargeted[2], -retargeted[3]];
    }
    output.push(...retargeted);
    previous = retargeted;
  }
  return { values: output, invalidSamples };
}
