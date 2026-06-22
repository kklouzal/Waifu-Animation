import {
  AnimationRuntime,
  assert,
  clonePose,
  poseDeltaMetric,
  poseDiscontinuityMetric,
  poseRotationMetric
} from "./test-api.js";
import { nodClip, skeleton } from "./test-helpers.js";

export function createAnimationMetricsEvaluation(): ReturnType<AnimationRuntime["evaluate"]> {
  const metricRuntime = new AnimationRuntime(skeleton);
  metricRuntime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
  metricRuntime.update(0.5);
  return metricRuntime.evaluate();
}
export function runAnimationMetricsTests(evaluated: ReturnType<AnimationRuntime["evaluate"]>): void {
  const metric = poseRotationMetric(skeleton.restPose, evaluated.localPose);
  assert.ok(metric.maxRotationDelta > 0);
  const signEquivalentPose = clonePose(skeleton.restPose);
  signEquivalentPose[2]!.rotation = signEquivalentPose[2]!.rotation.map((component) => -component) as [
    number,
    number,
    number,
    number
  ];
  assert.equal(
    poseRotationMetric(skeleton.restPose, signEquivalentPose).maxRotationDelta,
    0,
    "pose rotation metrics should treat sign-opposite quaternions as equivalent rotations"
  );
  const nonUnitRotationPose = clonePose(skeleton.restPose);
  nonUnitRotationPose[2]!.rotation = [0, 2, 0, 2];
  const nonUnitRotationMetric = poseRotationMetric(skeleton.restPose, nonUnitRotationPose);
  assert.ok(
    nonUnitRotationMetric.maxRotationDelta > 1.56 && nonUnitRotationMetric.maxRotationDelta < 1.58,
    "pose rotation metrics should normalize finite non-unit quaternions before measuring angular error"
  );
  const invalidRotationMetricPose = clonePose(nonUnitRotationPose);
  invalidRotationMetricPose[1]!.rotation = [Number.NaN, 0, 0, 1];
  invalidRotationMetricPose[3]!.rotation = [0, 0, 0, 0];
  const invalidRotationMetric = poseRotationMetric(skeleton.restPose, invalidRotationMetricPose);
  assert.equal(
    Number.isFinite(invalidRotationMetric.rmsRotationDelta),
    true,
    "pose rotation RMS should stay finite for invalid quaternions"
  );
  assert.equal(
    Number.isFinite(invalidRotationMetric.maxRotationDelta),
    true,
    "pose rotation max should stay finite for invalid quaternions"
  );
  assert.equal(
    invalidRotationMetric.invalidSamples,
    2,
    "pose rotation metrics should count skipped invalid quaternion samples"
  );
  assert.ok(
    invalidRotationMetric.maxRotationDelta > 1.56 && invalidRotationMetric.maxRotationDelta < 1.58,
    "pose rotation metrics should keep valid finite quaternion samples when invalid samples are skipped"
  );
  const poseDeltaA = clonePose(skeleton.restPose);
  const poseDeltaB = clonePose(skeleton.restPose);
  poseDeltaB[1]!.translation = [0, 2, 0];
  poseDeltaB[3]!.scale = [1, 3, 1];
  poseDeltaB[2]!.rotation = poseDeltaB[2]!.rotation.map((component) => -component) as [number, number, number, number];
  const poseDelta = poseDeltaMetric(poseDeltaA, poseDeltaB, skeleton);
  assert.equal(poseDelta.samples, skeleton.restPose.length);
  assert.equal(poseDelta.rotation.max, 0, "pose delta metrics should preserve sign-equivalent quaternion behavior");
  assert.equal(poseDelta.translation.max, 2);
  assert.equal(poseDelta.translation.maxIndex, 1);
  assert.equal(poseDelta.translation.maxJoint, "spine");
  assert.equal(poseDelta.scale.max, 2);
  assert.equal(poseDelta.scale.maxIndex, 3);
  assert.equal(poseDelta.scale.maxJoint, "leftUpperArm");
  assert.ok(Math.abs(poseDelta.translation.rms - 1) < 1e-12);
  assert.ok(Math.abs(poseDelta.scale.rms - 1) < 1e-12);
  const nonUnitPoseDelta = poseDeltaMetric(skeleton.restPose, nonUnitRotationPose, skeleton);
  assert.ok(
    nonUnitPoseDelta.rotation.max > 1.56 && nonUnitPoseDelta.rotation.max < 1.58,
    "pose delta metrics should not report zero rotation error for finite non-unit quaternions"
  );
  assert.equal(nonUnitPoseDelta.rotation.maxJoint, "head");
  const invalidPoseDeltaA = clonePose(skeleton.restPose);
  const invalidPoseDeltaB = clonePose(skeleton.restPose);
  invalidPoseDeltaA[0]!.translation = [Number.NaN, 0, 0];
  invalidPoseDeltaB[1]!.translation = [0, Number.POSITIVE_INFINITY, 0];
  invalidPoseDeltaB[2]!.translation = [0, 3, 0];
  invalidPoseDeltaA[0]!.scale = [1, Number.NEGATIVE_INFINITY, 1];
  invalidPoseDeltaB[1]!.scale = [1, Number.NaN, 1];
  invalidPoseDeltaB[3]!.scale = [1, 4, 1];
  invalidPoseDeltaA[1]!.rotation = [Number.NaN, 0, 0, 1];
  invalidPoseDeltaB[2]!.rotation = [0, 0, Number.POSITIVE_INFINITY, 1];
  invalidPoseDeltaB[3]!.rotation = [0, 2, 0, 2];
  const invalidPoseDelta = poseDeltaMetric(invalidPoseDeltaA, invalidPoseDeltaB, skeleton);
  assert.equal(invalidPoseDelta.samples, skeleton.restPose.length);
  assert.equal(
    invalidPoseDelta.translation.invalidSamples,
    2,
    "pose delta metrics should count skipped invalid translation samples"
  );
  assert.equal(
    invalidPoseDelta.scale.invalidSamples,
    2,
    "pose delta metrics should count skipped invalid scale samples"
  );
  assert.equal(
    invalidPoseDelta.rotation.invalidSamples,
    2,
    "pose delta metrics should count skipped invalid rotation samples"
  );
  assert.equal(
    Number.isFinite(invalidPoseDelta.translation.rms),
    true,
    "translation RMS should stay finite for invalid samples"
  );
  assert.equal(Number.isFinite(invalidPoseDelta.scale.rms), true, "scale RMS should stay finite for invalid samples");
  assert.equal(
    Number.isFinite(invalidPoseDelta.rotation.rms),
    true,
    "rotation RMS should stay finite for invalid samples"
  );
  assert.equal(invalidPoseDelta.translation.max, 3);
  assert.equal(invalidPoseDelta.translation.maxJoint, "head");
  assert.equal(invalidPoseDelta.scale.max, 3);
  assert.equal(invalidPoseDelta.scale.maxJoint, "leftUpperArm");
  assert.ok(
    invalidPoseDelta.rotation.max > 1.56 && invalidPoseDelta.rotation.max < 1.58,
    "pose delta metrics should keep valid finite rotation samples when invalid samples are skipped"
  );
  const malformedVec3PoseA = clonePose(skeleton.restPose);
  const malformedVec3PoseB = clonePose(skeleton.restPose);
  malformedVec3PoseA[0]!.translation = [0, 0] as unknown as [number, number, number];
  malformedVec3PoseB[1]!.scale = [1] as unknown as [number, number, number];
  const malformedVec3PoseDelta = poseDeltaMetric(malformedVec3PoseA, malformedVec3PoseB, skeleton);
  assert.equal(
    malformedVec3PoseDelta.translation.invalidSamples,
    1,
    "pose delta metrics should count short translation tuples as invalid samples"
  );
  assert.equal(
    malformedVec3PoseDelta.scale.invalidSamples,
    1,
    "pose delta metrics should count short scale tuples as invalid samples"
  );
  assert.equal(
    Number.isFinite(malformedVec3PoseDelta.translation.rms),
    true,
    "short translation tuples should not poison translation RMS"
  );
  assert.equal(
    Number.isFinite(malformedVec3PoseDelta.scale.rms),
    true,
    "short scale tuples should not poison scale RMS"
  );

  const frameA = clonePose(skeleton.restPose);
  const frameB = clonePose(skeleton.restPose);
  const frameC = clonePose(skeleton.restPose);
  frameB[1]!.translation = [0, 0.5, 0];
  frameC[1]!.translation = [0, 1.5, 0];
  frameC[2]!.scale = [1, 1.5, 1];
  frameC[3]!.rotation = [0, Math.sin(0.25), 0, Math.cos(0.25)];
  const discontinuity = poseDiscontinuityMetric(
    [
      { timeSeconds: 0, pose: frameA },
      { timeSeconds: 0.5, pose: frameB },
      { timeSeconds: 1, pose: frameC }
    ],
    skeleton
  );
  assert.equal(discontinuity.frames, 3);
  assert.equal(discontinuity.intervals, 2);
  assert.equal(discontinuity.validIntervals, 2);
  assert.equal(discontinuity.translationVelocityUnitsPerSecond.max, 2);
  assert.equal(discontinuity.translationVelocityUnitsPerSecond.maxIntervalIndex, 1);
  assert.equal(discontinuity.translationVelocityUnitsPerSecond.maxJointIndex, 1);
  assert.equal(discontinuity.translationVelocityUnitsPerSecond.maxJoint, "spine");
  assert.equal(discontinuity.scaleVelocityUnitsPerSecond.max, 1);
  assert.equal(discontinuity.scaleVelocityUnitsPerSecond.maxJoint, "head");
  assert.ok(
    discontinuity.angularVelocityRadiansPerSecond.max > 0.99 && discontinuity.angularVelocityRadiansPerSecond.max < 1.01
  );
  assert.equal(discontinuity.angularVelocityRadiansPerSecond.maxJoint, "leftUpperArm");
  assert.ok(discontinuity.translationVelocityUnitsPerSecond.rms > 0);
  assertFiniteMetricOutput(discontinuity);

  const signFrameA = clonePose(skeleton.restPose);
  const signFrameB = clonePose(skeleton.restPose);
  signFrameB[2]!.rotation = signFrameB[2]!.rotation.map((component) => -component) as [number, number, number, number];
  const signDiscontinuity = poseDiscontinuityMetric(
    [
      { timeSeconds: 0, pose: signFrameA },
      { timeSeconds: 1, pose: signFrameB }
    ],
    skeleton
  );
  assert.equal(
    signDiscontinuity.angularVelocityRadiansPerSecond.max,
    0,
    "pose discontinuity metrics should treat sign-opposite quaternions as equivalent rotations"
  );

  const invalidFrameA = clonePose(skeleton.restPose);
  const invalidFrameB = clonePose(skeleton.restPose);
  invalidFrameA[0]!.rotation = [Number.NaN, 0, 0, 1];
  invalidFrameB[1]!.rotation = [0, 0, 0, 0];
  invalidFrameA[2]!.translation = [Number.POSITIVE_INFINITY, 0, 0];
  invalidFrameB[3]!.translation = [0, 1] as unknown as [number, number, number];
  invalidFrameA[0]!.scale = [1, Number.NaN, 1];
  invalidFrameB[1]!.scale = [1] as unknown as [number, number, number];
  invalidFrameB[1]!.translation = [0, 0.25, 0];
  const invalidDiscontinuity = poseDiscontinuityMetric(
    [
      { timeSeconds: 0, pose: invalidFrameA },
      { timeSeconds: 0.25, pose: invalidFrameB }
    ],
    skeleton
  );
  assert.equal(invalidDiscontinuity.angularVelocityRadiansPerSecond.invalidSamples, 2);
  assert.equal(invalidDiscontinuity.translationVelocityUnitsPerSecond.invalidSamples, 2);
  assert.equal(invalidDiscontinuity.scaleVelocityUnitsPerSecond.invalidSamples, 2);
  assert.equal(invalidDiscontinuity.translationVelocityUnitsPerSecond.max, 1);
  assert.equal(invalidDiscontinuity.translationVelocityUnitsPerSecond.maxJoint, "spine");
  assertFiniteMetricOutput(invalidDiscontinuity);

  const invalidTimeDiscontinuity = poseDiscontinuityMetric(
    [
      { timeSeconds: 0, pose: frameA },
      { timeSeconds: 0, pose: frameB },
      { timeSeconds: -1, pose: frameC },
      { timeSeconds: Number.POSITIVE_INFINITY, pose: frameC },
      { timeSeconds: 1, pose: frameC }
    ],
    skeleton
  );
  assert.equal(invalidTimeDiscontinuity.validIntervals, 0);
  assert.equal(invalidTimeDiscontinuity.invalidIntervals, 4);
  assert.deepEqual(
    invalidTimeDiscontinuity.issues.map((issue) => issue.kind),
    ["invalid-interval", "invalid-interval", "invalid-interval", "invalid-interval"]
  );
  assert.equal(invalidTimeDiscontinuity.translationVelocityUnitsPerSecond.max, 0);

  const thresholdDiscontinuity = poseDiscontinuityMetric(
    [
      { timeSeconds: 0, pose: frameA },
      { timeSeconds: 0.5, pose: frameB },
      { timeSeconds: 1, pose: frameC }
    ],
    skeleton,
    { angularVelocityRadiansPerSecond: 0.5, translationVelocityUnitsPerSecond: 1.5 }
  );
  assert.deepEqual(
    thresholdDiscontinuity.issues.map((issue) => issue.kind),
    ["angular-velocity-spike", "translation-velocity-spike"]
  );
  assert.equal(thresholdDiscontinuity.issues[0]!.jointName, "leftUpperArm");
  assert.equal(thresholdDiscontinuity.issues[0]!.value, thresholdDiscontinuity.angularVelocityRadiansPerSecond.max);
  assert.equal(thresholdDiscontinuity.issues[0]!.threshold, 0.5);
  assert.equal(thresholdDiscontinuity.issues[1]!.jointName, "spine");
  assert.equal(thresholdDiscontinuity.issues[1]!.value, 2);
  assert.equal(thresholdDiscontinuity.issues[1]!.threshold, 1.5);
}

function assertFiniteMetricOutput(value: unknown): void {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, "metric output should not contain NaN or Infinity");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteMetricOutput(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertFiniteMetricOutput(item);
  }
}
