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

export type PoseDiscontinuityFrame = {
  timeSeconds: number;
  pose: readonly Transform[];
};

export type PoseDiscontinuityThresholds = {
  angularVelocityRadiansPerSecond?: number;
  translationVelocityUnitsPerSecond?: number;
};

export type PoseDiscontinuityIssue = {
  kind: "angular-velocity-spike" | "translation-velocity-spike" | "invalid-interval";
  intervalIndex: number;
  fromTimeSeconds: number;
  toTimeSeconds: number;
  jointIndex?: number;
  jointName?: string;
  value?: number;
  threshold?: number;
};

export type PoseVelocityComponentMetric = {
  rms: number;
  max: number;
  maxIntervalIndex?: number;
  maxJointIndex?: number;
  maxJoint?: string;
  invalidSamples?: number;
};

export type PoseDiscontinuityMetric = {
  angularVelocityRadiansPerSecond: PoseVelocityComponentMetric;
  translationVelocityUnitsPerSecond: PoseVelocityComponentMetric;
  scaleVelocityUnitsPerSecond: PoseVelocityComponentMetric;
  frames: number;
  intervals: number;
  validIntervals: number;
  invalidIntervals?: number;
  issues: PoseDiscontinuityIssue[];
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

export function poseDeltaMetric(
  a: readonly Transform[],
  b: readonly Transform[],
  skeleton?: Skeleton
): PoseDeltaMetric {
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

export function poseDiscontinuityMetric(
  frames: readonly PoseDiscontinuityFrame[],
  skeleton?: Skeleton,
  thresholds: PoseDiscontinuityThresholds = {}
): PoseDiscontinuityMetric {
  const angularVelocity = createVelocityAccumulator();
  const translationVelocity = createVelocityAccumulator();
  const scaleVelocity = createVelocityAccumulator();
  const issues: PoseDiscontinuityIssue[] = [];
  let validIntervals = 0;
  let invalidIntervals = 0;

  for (let intervalIndex = 0; intervalIndex < frames.length - 1; intervalIndex += 1) {
    const previous = frames[intervalIndex]!;
    const next = frames[intervalIndex + 1]!;
    const deltaSeconds = next.timeSeconds - previous.timeSeconds;
    if (
      !Number.isFinite(previous.timeSeconds) ||
      !Number.isFinite(next.timeSeconds) ||
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds <= 0
    ) {
      invalidIntervals += 1;
      issues.push({
        kind: "invalid-interval",
        intervalIndex,
        fromTimeSeconds: previous.timeSeconds,
        toTimeSeconds: next.timeSeconds
      });
      continue;
    }

    validIntervals += 1;
    const length = Math.min(previous.pose.length, next.pose.length);
    for (let jointIndex = 0; jointIndex < length; jointIndex += 1) {
      const previousTransform = previous.pose[jointIndex]!;
      const nextTransform = next.pose[jointIndex]!;
      pushVelocitySample(
        angularVelocity,
        velocity(rotationDelta(previousTransform, nextTransform), deltaSeconds),
        intervalIndex,
        jointIndex
      );
      pushVelocitySample(
        translationVelocity,
        velocity(vec3Delta(previousTransform.translation, nextTransform.translation), deltaSeconds),
        intervalIndex,
        jointIndex
      );
      pushVelocitySample(
        scaleVelocity,
        velocity(vec3Delta(previousTransform.scale, nextTransform.scale), deltaSeconds),
        intervalIndex,
        jointIndex
      );
    }
  }

  const angularVelocityMetric = finishVelocityAccumulator(angularVelocity, skeleton);
  const translationVelocityMetric = finishVelocityAccumulator(translationVelocity, skeleton);
  const angularThreshold = thresholds.angularVelocityRadiansPerSecond;
  const translationThreshold = thresholds.translationVelocityUnitsPerSecond;
  if (
    angularThreshold !== undefined &&
    Number.isFinite(angularThreshold) &&
    angularThreshold >= 0 &&
    angularVelocityMetric.max > angularThreshold
  ) {
    issues.push(
      createThresholdIssue("angular-velocity-spike", angularVelocityMetric, angularThreshold, frames, skeleton)
    );
  }
  if (
    translationThreshold !== undefined &&
    Number.isFinite(translationThreshold) &&
    translationThreshold >= 0 &&
    translationVelocityMetric.max > translationThreshold
  ) {
    issues.push(
      createThresholdIssue(
        "translation-velocity-spike",
        translationVelocityMetric,
        translationThreshold,
        frames,
        skeleton
      )
    );
  }

  return {
    angularVelocityRadiansPerSecond: angularVelocityMetric,
    translationVelocityUnitsPerSecond: translationVelocityMetric,
    scaleVelocityUnitsPerSecond: finishVelocityAccumulator(scaleVelocity, skeleton),
    frames: frames.length,
    intervals: Math.max(0, frames.length - 1),
    validIntervals,
    ...(invalidIntervals > 0 ? { invalidIntervals } : {}),
    issues
  };
}

type MetricAccumulator = {
  sum: number;
  max: number;
  maxIndex?: number;
  validSamples: number;
  invalidSamples: number;
};

type VelocityAccumulator = {
  sum: number;
  max: number;
  maxIntervalIndex?: number;
  maxJointIndex?: number;
  validSamples: number;
  invalidSamples: number;
};

function createMetricAccumulator(): MetricAccumulator {
  return { sum: 0, max: 0, validSamples: 0, invalidSamples: 0 };
}

function createVelocityAccumulator(): VelocityAccumulator {
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

function pushVelocitySample(
  metric: VelocityAccumulator,
  sample: number | undefined,
  intervalIndex: number,
  jointIndex: number
): void {
  if (sample === undefined || !Number.isFinite(sample)) {
    metric.invalidSamples += 1;
    return;
  }
  metric.sum += sample * sample;
  metric.validSamples += 1;
  if (sample > metric.max) {
    metric.max = sample;
    metric.maxIntervalIndex = intervalIndex;
    metric.maxJointIndex = jointIndex;
  }
}

function finishVelocityAccumulator(
  metric: VelocityAccumulator,
  skeleton: Skeleton | undefined
): PoseVelocityComponentMetric {
  const maxJoint = metric.maxJointIndex !== undefined ? skeleton?.joints[metric.maxJointIndex]?.name : undefined;
  return {
    rms: metric.validSamples > 0 ? Math.sqrt(metric.sum / metric.validSamples) : 0,
    max: metric.max,
    ...(metric.maxIntervalIndex !== undefined ? { maxIntervalIndex: metric.maxIntervalIndex } : {}),
    ...(metric.maxJointIndex !== undefined ? { maxJointIndex: metric.maxJointIndex } : {}),
    ...(maxJoint !== undefined ? { maxJoint } : {}),
    ...(metric.invalidSamples > 0 ? { invalidSamples: metric.invalidSamples } : {})
  };
}

function createThresholdIssue(
  kind: PoseDiscontinuityIssue["kind"],
  metric: PoseVelocityComponentMetric,
  threshold: number,
  frames: readonly PoseDiscontinuityFrame[],
  skeleton: Skeleton | undefined
): PoseDiscontinuityIssue {
  const intervalIndex = metric.maxIntervalIndex ?? 0;
  const jointIndex = metric.maxJointIndex;
  const jointName = jointIndex !== undefined ? skeleton?.joints[jointIndex]?.name : undefined;
  return {
    kind,
    intervalIndex,
    fromTimeSeconds: frames[intervalIndex]?.timeSeconds ?? 0,
    toTimeSeconds: frames[intervalIndex + 1]?.timeSeconds ?? 0,
    ...(jointIndex !== undefined ? { jointIndex } : {}),
    ...(jointName !== undefined ? { jointName } : {}),
    value: metric.max,
    threshold
  };
}

function velocity(delta: number | undefined, deltaSeconds: number): number | undefined {
  if (delta === undefined || !Number.isFinite(delta) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
    return undefined;
  return delta / deltaSeconds;
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
  return value.length === 3 && value.every(Number.isFinite);
}
