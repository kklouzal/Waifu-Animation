import { type Transform, dotQuat } from "./math.js";
import { type PoseValidationIssue, validatePose } from "./pose.js";
import { type Skeleton } from "./skeleton.js";

export type PoseMetric = {
  rmsRotationDelta: number;
  maxRotationDelta: number;
  samples: number;
};

export type PoseComponentDeltaMetric = {
  rms: number;
  max: number;
  maxIndex?: number;
  maxJoint?: string;
};

export type PoseDeltaMetric = {
  rotation: PoseComponentDeltaMetric;
  translation: PoseComponentDeltaMetric;
  scale: PoseComponentDeltaMetric;
  samples: number;
};

export function poseRotationMetric(a: readonly Transform[], b: readonly Transform[]): PoseMetric {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    const aq = a[index]!.rotation;
    const bq = b[index]!.rotation;
    const dot = Math.abs(dotQuat(aq, bq));
    const delta = 2 * Math.acos(Math.min(1, dot));
    sum += delta * delta;
    max = Math.max(max, delta);
  }
  return { rmsRotationDelta: length > 0 ? Math.sqrt(sum / length) : 0, maxRotationDelta: max, samples: length };
}

export function poseDeltaMetric(a: readonly Transform[], b: readonly Transform[], skeleton?: Skeleton): PoseDeltaMetric {
  const length = Math.min(a.length, b.length);
  const rotation = createMetricAccumulator();
  const translation = createMetricAccumulator();
  const scale = createMetricAccumulator();

  for (let index = 0; index < length; index += 1) {
    const at = a[index]!;
    const bt = b[index]!;
    pushMetricSample(rotation, rotationDelta(at, bt), index);
    pushMetricSample(translation, vec3Delta(at.translation, bt.translation), index);
    pushMetricSample(scale, vec3Delta(at.scale, bt.scale), index);
  }

  return {
    rotation: finishMetricAccumulator(rotation, length, skeleton),
    translation: finishMetricAccumulator(translation, length, skeleton),
    scale: finishMetricAccumulator(scale, length, skeleton),
    samples: length
  };
}

export function invalidPoseReport(skeleton: Skeleton, pose: readonly Transform[]): PoseValidationIssue[] {
  return validatePose(skeleton, pose);
}

type MetricAccumulator = {
  sum: number;
  max: number;
  maxIndex?: number;
};

function createMetricAccumulator(): MetricAccumulator {
  return { sum: 0, max: 0 };
}

function pushMetricSample(metric: MetricAccumulator, delta: number, index: number): void {
  metric.sum += delta * delta;
  if (delta > metric.max) {
    metric.max = delta;
    metric.maxIndex = index;
  }
}

function finishMetricAccumulator(metric: MetricAccumulator, samples: number, skeleton: Skeleton | undefined): PoseComponentDeltaMetric {
  const maxJoint = metric.maxIndex !== undefined ? skeleton?.joints[metric.maxIndex]?.name : undefined;
  return {
    rms: samples > 0 ? Math.sqrt(metric.sum / samples) : 0,
    max: metric.max,
    ...(metric.maxIndex !== undefined ? { maxIndex: metric.maxIndex } : {}),
    ...(maxJoint !== undefined ? { maxJoint } : {})
  };
}

function rotationDelta(a: Transform, b: Transform): number {
  const dot = Math.abs(dotQuat(a.rotation, b.rotation));
  return 2 * Math.acos(Math.min(1, dot));
}

function vec3Delta(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
