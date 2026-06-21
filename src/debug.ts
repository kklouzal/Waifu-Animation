import { EPSILON, type Quat, type Transform, dotQuat, normalizeQuat } from "./math.js";
import { type PoseValidationIssue, validatePose } from "./pose.js";
import { type Skeleton } from "./skeleton.js";

export type PoseMetric = {
  rmsRotationDelta: number;
  maxRotationDelta: number;
  samples: number;
  invalidSamples?: number;
};

export type PoseComponentDeltaMetric = {
  rms: number;
  max: number;
  maxIndex?: number;
  maxJoint?: string;
  invalidSamples?: number;
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
  let validSamples = 0;
  let invalidSamples = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = rotationDelta(a[index]!, b[index]!);
    if (delta === undefined) {
      invalidSamples += 1;
      continue;
    }
    sum += delta * delta;
    max = Math.max(max, delta);
    validSamples += 1;
  }
  return {
    rmsRotationDelta: validSamples > 0 ? Math.sqrt(sum / validSamples) : 0,
    maxRotationDelta: max,
    samples: length,
    ...(invalidSamples > 0 ? { invalidSamples } : {})
  };
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
    rotation: finishMetricAccumulator(rotation, skeleton),
    translation: finishMetricAccumulator(translation, skeleton),
    scale: finishMetricAccumulator(scale, skeleton),
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
  validSamples: number;
  invalidSamples: number;
};

function createMetricAccumulator(): MetricAccumulator {
  return { sum: 0, max: 0, validSamples: 0, invalidSamples: 0 };
}

function pushMetricSample(metric: MetricAccumulator, delta: number | undefined, index: number): void {
  if (delta === undefined) {
    metric.invalidSamples += 1;
    return;
  }
  metric.sum += delta * delta;
  metric.validSamples += 1;
  if (delta > metric.max) {
    metric.max = delta;
    metric.maxIndex = index;
  }
}

function finishMetricAccumulator(metric: MetricAccumulator, skeleton: Skeleton | undefined): PoseComponentDeltaMetric {
  const maxJoint = metric.maxIndex !== undefined ? skeleton?.joints[metric.maxIndex]?.name : undefined;
  return {
    rms: metric.validSamples > 0 ? Math.sqrt(metric.sum / metric.validSamples) : 0,
    max: metric.max,
    ...(metric.maxIndex !== undefined ? { maxIndex: metric.maxIndex } : {}),
    ...(maxJoint !== undefined ? { maxJoint } : {}),
    ...(metric.invalidSamples > 0 ? { invalidSamples: metric.invalidSamples } : {})
  };
}

function rotationDelta(a: Transform, b: Transform): number | undefined {
  if (!isValidMetricRotation(a.rotation) || !isValidMetricRotation(b.rotation)) return undefined;
  const dot = Math.abs(dotQuat(normalizedMetricRotation(a.rotation), normalizedMetricRotation(b.rotation)));
  return 2 * Math.acos(Math.min(1, dot));
}

function normalizedMetricRotation(rotation: Quat): Quat {
  return normalizeQuat(rotation);
}

function vec3Delta(a: readonly [number, number, number], b: readonly [number, number, number]): number | undefined {
  if (!isFiniteVec3(a) || !isFiniteVec3(b)) return undefined;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function isValidMetricRotation(rotation: Quat): boolean {
  return rotation.every(Number.isFinite) && Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]) > EPSILON;
}

function isFiniteVec3(value: readonly [number, number, number]): boolean {
  return value.every(Number.isFinite);
}
