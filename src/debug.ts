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
  scaleVelocityUnitsPerSecond?: number;
};

export type PoseDiscontinuityIssue = {
  kind: "angular-velocity-spike" | "translation-velocity-spike" | "scale-velocity-spike" | "invalid-interval";
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

const EMPTY_TRANSFORM_LIST: readonly Transform[] = [];
const EMPTY_DISCONTINUITY_FRAMES: readonly PoseDiscontinuityFrame[] = [];

function isReadonlyArray<T>(value: readonly T[] | undefined): value is readonly T[] {
  return Array.isArray(value);
}

function transformListOrEmpty(value: readonly Transform[] | undefined): readonly Transform[] {
  return isReadonlyArray(value) ? value : EMPTY_TRANSFORM_LIST;
}

function frameListOrEmpty(value: readonly PoseDiscontinuityFrame[] | undefined): readonly PoseDiscontinuityFrame[] {
  return isReadonlyArray(value) ? value : EMPTY_DISCONTINUITY_FRAMES;
}

export function poseRotationMetric(a: readonly Transform[], b: readonly Transform[]): PoseMetric {
  const poseA = transformListOrEmpty(a);
  const poseB = transformListOrEmpty(b);
  const length = Math.min(poseA.length, poseB.length);
  const rotation = createMetricAccumulator();
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = rotationDelta(poseA[index], poseB[index]);
    if (delta === undefined) {
      rotation.invalidSamples += 1;
      continue;
    }
    max = Math.max(max, delta);
    pushFiniteSample(rotation, delta);
  }
  return {
    rmsRotationDelta: finishRms(rotation),
    maxRotationDelta: max,
    samples: length,
    ...(rotation.invalidSamples > 0 ? { invalidSamples: rotation.invalidSamples } : {})
  };
}

export function poseDeltaMetric(
  a: readonly Transform[],
  b: readonly Transform[],
  skeleton?: Skeleton
): PoseDeltaMetric {
  const poseA = transformListOrEmpty(a);
  const poseB = transformListOrEmpty(b);
  const length = Math.min(poseA.length, poseB.length);
  const rotation = createMetricAccumulator();
  const translation = createMetricAccumulator();
  const scale = createMetricAccumulator();

  for (let index = 0; index < length; index += 1) {
    const at = poseA[index];
    const bt = poseB[index];
    pushMetricSample(rotation, rotationDelta(at, bt), index);
    pushMetricSample(translation, vec3Delta(at?.translation, bt?.translation), index);
    pushMetricSample(scale, vec3Delta(at?.scale, bt?.scale), index);
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
  const frameList = frameListOrEmpty(frames);
  const angularVelocity = createVelocityAccumulator();
  const translationVelocity = createVelocityAccumulator();
  const scaleVelocity = createVelocityAccumulator();
  const issues: PoseDiscontinuityIssue[] = [];
  let validIntervals = 0;
  let invalidIntervals = 0;

  for (let intervalIndex = 0; intervalIndex < frameList.length - 1; intervalIndex += 1) {
    const previous = frameList[intervalIndex];
    const next = frameList[intervalIndex + 1];
    const previousTime = readFrameTime(previous);
    const nextTime = readFrameTime(next);
    const deltaSeconds = nextTime - previousTime;
    if (
      !isPoseFrame(previous) ||
      !isPoseFrame(next) ||
      !Number.isFinite(previousTime) ||
      !Number.isFinite(nextTime) ||
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds <= 0
    ) {
      invalidIntervals += 1;
      issues.push({
        kind: "invalid-interval",
        intervalIndex,
        fromTimeSeconds: finiteIssueTime(previousTime),
        toTimeSeconds: finiteIssueTime(nextTime)
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
  const scaleVelocityMetric = finishVelocityAccumulator(scaleVelocity, skeleton);
  const angularThreshold = thresholds.angularVelocityRadiansPerSecond;
  const translationThreshold = thresholds.translationVelocityUnitsPerSecond;
  const scaleThreshold = thresholds.scaleVelocityUnitsPerSecond;
  if (
    angularThreshold !== undefined &&
    Number.isFinite(angularThreshold) &&
    angularThreshold >= 0 &&
    angularVelocityMetric.max > angularThreshold
  ) {
    issues.push(
      createThresholdIssue("angular-velocity-spike", angularVelocityMetric, angularThreshold, frameList, skeleton)
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
        frameList,
        skeleton
      )
    );
  }
  if (
    scaleThreshold !== undefined &&
    Number.isFinite(scaleThreshold) &&
    scaleThreshold >= 0 &&
    scaleVelocityMetric.max > scaleThreshold
  ) {
    issues.push(createThresholdIssue("scale-velocity-spike", scaleVelocityMetric, scaleThreshold, frameList, skeleton));
  }

  return {
    angularVelocityRadiansPerSecond: angularVelocityMetric,
    translationVelocityUnitsPerSecond: translationVelocityMetric,
    scaleVelocityUnitsPerSecond: scaleVelocityMetric,
    frames: frameList.length,
    intervals: Math.max(0, frameList.length - 1),
    validIntervals,
    ...(invalidIntervals > 0 ? { invalidIntervals } : {}),
    issues
  };
}

type MetricAccumulator = {
  scale: number;
  scaledSumSquares: number;
  max: number;
  maxIndex?: number;
  validSamples: number;
  invalidSamples: number;
};

type VelocityAccumulator = {
  scale: number;
  scaledSumSquares: number;
  max: number;
  maxIntervalIndex?: number;
  maxJointIndex?: number;
  validSamples: number;
  invalidSamples: number;
};

function createMetricAccumulator(): MetricAccumulator {
  return { scale: 0, scaledSumSquares: 0, max: 0, validSamples: 0, invalidSamples: 0 };
}

function createVelocityAccumulator(): VelocityAccumulator {
  return { scale: 0, scaledSumSquares: 0, max: 0, validSamples: 0, invalidSamples: 0 };
}

function pushFiniteSample(
  metric: Pick<MetricAccumulator, "scale" | "scaledSumSquares" | "validSamples">,
  sample: number
): void {
  const value = Math.abs(sample);
  if (value > 0) {
    if (value > metric.scale) {
      const ratio = metric.scale / value;
      metric.scaledSumSquares = metric.scaledSumSquares * ratio * ratio + 1;
      metric.scale = value;
    } else if (metric.scale > 0) {
      const ratio = value / metric.scale;
      metric.scaledSumSquares += ratio * ratio;
    }
  }
  metric.validSamples += 1;
}

function finishRms(metric: Pick<MetricAccumulator, "scale" | "scaledSumSquares" | "validSamples">): number {
  if (metric.validSamples <= 0 || metric.scale <= 0) return 0;
  return metric.scale * Math.sqrt(metric.scaledSumSquares / metric.validSamples);
}

function pushMetricSample(metric: MetricAccumulator, delta: number | undefined, index: number): void {
  if (delta === undefined || !Number.isFinite(delta)) {
    metric.invalidSamples += 1;
    return;
  }
  pushFiniteSample(metric, delta);
  if (delta > metric.max) {
    metric.max = delta;
    metric.maxIndex = index;
  }
}

function finishMetricAccumulator(metric: MetricAccumulator, skeleton: Skeleton | undefined): PoseComponentDeltaMetric {
  const maxJoint = metric.maxIndex !== undefined ? skeleton?.joints[metric.maxIndex]?.name : undefined;
  return {
    rms: finishRms(metric),
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
  pushFiniteSample(metric, sample);
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
    rms: finishRms(metric),
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

function isPoseFrame(frame: PoseDiscontinuityFrame | undefined): frame is PoseDiscontinuityFrame {
  return !!frame && typeof frame === "object" && Array.isArray(frame.pose);
}

function readFrameTime(frame: PoseDiscontinuityFrame | undefined): number {
  return typeof frame?.timeSeconds === "number" ? frame.timeSeconds : Number.NaN;
}

function finiteIssueTime(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function velocity(delta: number | undefined, deltaSeconds: number): number | undefined {
  if (delta === undefined || !Number.isFinite(delta) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
    return undefined;
  return delta / deltaSeconds;
}

function rotationDelta(a: Transform | undefined, b: Transform | undefined): number | undefined {
  const aRotation = a?.rotation;
  const bRotation = b?.rotation;
  if (!isValidMetricRotation(aRotation) || !isValidMetricRotation(bRotation)) return undefined;
  const dot = Math.abs(dotQuat(normalizedMetricRotation(aRotation), normalizedMetricRotation(bRotation)));
  return 2 * Math.acos(Math.min(1, dot));
}

function normalizedMetricRotation(rotation: Quat): Quat {
  return normalizeQuat(rotation);
}

function vec3Delta(
  a: readonly [number, number, number] | undefined,
  b: readonly [number, number, number] | undefined
): number | undefined {
  if (!isFiniteVec3(a) || !isFiniteVec3(b)) return undefined;
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Number.isFinite(distance) ? distance : Number.MAX_VALUE;
}

function isValidMetricRotation(rotation: Quat | undefined): rotation is Quat {
  if (!rotation || rotation.length !== 4 || !rotation.every(Number.isFinite)) return false;
  const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  return Number.isFinite(length) && length > EPSILON;
}

function isFiniteVec3(
  value: readonly [number, number, number] | undefined
): value is readonly [number, number, number] {
  return !!value && value.length === 3 && value.every(Number.isFinite);
}
