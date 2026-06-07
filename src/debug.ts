import { type Transform } from "./math.js";
import { type PoseValidationIssue, validatePose } from "./pose.js";
import { type Skeleton } from "./skeleton.js";

export type PoseMetric = {
  rmsRotationDelta: number;
  maxRotationDelta: number;
  samples: number;
};

export function poseRotationMetric(a: readonly Transform[], b: readonly Transform[]): PoseMetric {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    const aq = a[index]!.rotation;
    const bq = b[index]!.rotation;
    const dot = Math.abs(aq[0] * bq[0] + aq[1] * bq[1] + aq[2] * bq[2] + aq[3] * bq[3]);
    const delta = 2 * Math.acos(Math.min(1, dot));
    sum += delta * delta;
    max = Math.max(max, delta);
  }
  return { rmsRotationDelta: length > 0 ? Math.sqrt(sum / length) : 0, maxRotationDelta: max, samples: length };
}

export function invalidPoseReport(skeleton: Skeleton, pose: readonly Transform[]): PoseValidationIssue[] {
  return validatePose(skeleton, pose);
}

