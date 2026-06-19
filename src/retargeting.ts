import { EPSILON, type Quat, cloneNormalizedQuat, ensureShortestQuat, invertQuat, multiplyQuat, normalizeQuat } from "./math.js";

export { isHumanoidBoneName } from "./skeleton.js";

export type RetargetedQuaternionTrack = {
  values: number[];
  invalidSamples: number;
};

export function retargetQuaternionSample(sourceRest: Quat, targetRest: Quat, sourceSample: Quat, humanBone?: string, sourceBasis?: ArrayLike<number>): Quat {
  const srcRest = normalizeQuat(sourceRest);
  const dstRest = normalizeQuat(targetRest);
  const srcSample = normalizeQuat(sourceSample, srcRest);
  void humanBone;
  let sourceDelta = multiplyQuat(invertQuat(srcRest), srcSample);
  if (sourceBasis) {
    const basis = cloneNormalizedQuat(sourceBasis);
    sourceDelta = multiplyQuat(multiplyQuat(basis, sourceDelta), invertQuat(basis));
  }
  return normalizeQuat(multiplyQuat(dstRest, sourceDelta));
}

export function retargetQuaternionTrackValues(
  values: readonly number[],
  sourceRest: ArrayLike<number> | undefined,
  targetRest: ArrayLike<number>,
  humanBone?: string,
  sourceBasis?: ArrayLike<number> | null | undefined
): RetargetedQuaternionTrack {
  if (values.length % 4 !== 0) throw new Error("quaternion values must be a multiple of 4");
  const output: number[] = [];
  const srcRest = sourceRest ? cloneNormalizedQuat(sourceRest) : null;
  const dstRest = cloneNormalizedQuat(targetRest);
  let invalidSamples = 0;
  let previous: Quat = [0, 0, 0, 1];
  for (let i = 0; i < values.length; i += 4) {
    const rawSample: Quat = [values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, values[i + 3] ?? 1];
    if (isMalformedQuaternionSample(rawSample)) invalidSamples += 1;
    const sample = normalizeQuat(rawSample, srcRest ?? undefined);
    let retargeted = srcRest ? retargetQuaternionSample(srcRest, dstRest, sample, humanBone, sourceBasis ?? undefined) : sample;
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

function isMalformedQuaternionSample(value: Quat): boolean {
  if (!value.every(Number.isFinite)) return true;
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  return !Number.isFinite(length) || length <= EPSILON;
}
