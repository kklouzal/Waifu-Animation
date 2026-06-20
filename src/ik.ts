import {
  EPSILON,
  IDENTITY_QUAT,
  type Mat4,
  type Quat,
  type Vec3,
  addVec3,
  clamp,
  clamp01,
  crossVec3,
  dotVec3,
  finiteNonNegative,
  invertQuat,
  lengthVec3,
  lerpVec3,
  multiplyQuat,
  normalizeVec3,
  normalizeQuat,
  quatFromAxisAngle,
  quatFromUnitVectors,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3
} from "./math.js";

const MIN_IK_REACH = 1e-5;
const DEFAULT_IK_SOFTEN = 0.998;

export type AimIkInput = {
  /** Joint model-space matrix. When provided, it is the authoritative joint transform. */
  joint?: Mat4;
  /** Joint model-space position used with jointRotation when no joint matrix is supplied. */
  jointPosition?: Vec3;
  /** Joint model-space rotation used when no joint matrix is supplied. */
  jointRotation?: Quat;
  /** Target model-space position. */
  target?: Vec3;
  /** Target model-space direction used when no target position is supplied. */
  targetDirection?: Vec3;
  /** Joint local-space forward axis to aim at the target. */
  forward?: Vec3;
  /** Joint local-space aiming offset. */
  offset?: Vec3;
  /** Joint local-space up axis used for pole alignment. */
  up?: Vec3;
  /** Model-space pole vector. */
  pole?: Vec3;
  twistAngle?: number;
  weight?: number;
};

export type AimIkResult = {
  /** Model-space correction applied before the current model rotation: correction * jointRotation. */
  jointCorrection: Quat;
  reached: boolean;
  weight: number;
  /** Model-space unit direction from the joint toward the target. */
  targetDirection: Vec3;
  /** Model-space offset-adjusted forward direction before applying jointCorrection. */
  offsettedForward: Vec3;
  /** Model-space forward axis after applying jointCorrection. */
  correctedForward: Vec3;
  /** Model-space up axis after applying jointCorrection. */
  correctedUp: Vec3;
  /** Angle in radians between corrected model-space offsettedForward and targetDirection. */
  alignmentError: number;
};

export type TwoBoneIkInput = {
  root: Vec3;
  joint: Vec3;
  end: Vec3;
  target: Vec3;
  pole?: Vec3;
  midAxis?: Vec3;
  twistAngle?: number;
  soften?: number;
  weight?: number;
  maxStretch?: number;
};

export type TwoBoneIkResult = {
  root: Vec3;
  joint: Vec3;
  end: Vec3;
  targetReach: number;
  solvedReach: number;
  reached: boolean;
  clamped: boolean;
  stretchLimited: boolean;
};

export type TwoBoneIkCorrectionResult = TwoBoneIkResult & {
  rootCorrection: Quat;
  jointCorrection: Quat;
  correctedUpperDirection: Vec3;
  correctedLowerDirection: Vec3;
};

export function solveAimIk(input: AimIkInput): AimIkResult {
  const joint = sanitizeAimJoint(input);
  const forward = normalizeVec3(finiteVec3(input.forward, [1, 0, 0]), [1, 0, 0]);
  const up = normalizeVec3(finiteVec3(input.up, [0, 1, 0]), fallbackPerpendicular(forward));
  const offset = finiteVec3(input.offset, [0, 0, 0]);
  const pole = finiteVec3(input.pole, [0, 1, 0]);
  const weight = sanitizeUnitWeight(input.weight, 1);
  const twistAngle = finiteSignedAngle(input.twistAngle);
  const targetLocal = resolveAimTargetLocal(input, joint, offset);
  const targetLength = finiteLength(targetLocal, 0);
  const targetDirection = normalizeVec3(targetLocal, forward);
  const offsetted = computeOffsettedForward(forward, offset, targetLocal);
  const forwardModel = normalizeVec3(transformAimVectorToModel(joint, forward), rotateVec3ByQuat(joint.rotation, forward));
  const upModel = normalizeVec3(transformAimVectorToModel(joint, up), rotateVec3ByQuat(joint.rotation, up));
  const targetDirectionModel = resolveAimTargetModelDirection(input, joint, targetDirection, forwardModel);

  if (!offsetted.reached || targetLength <= MIN_IK_REACH) {
    return aimResult(IDENTITY_QUAT, false, weight, targetDirectionModel, forwardModel, forwardModel, upModel);
  }

  const offsettedForward = normalizeVec3(offsetted.forward, forward);
  const aimCorrection = quatFromUnitVectors(offsettedForward, targetDirection, up);
  const aimedUp = rotateVec3ByQuat(aimCorrection, up);
  const poleLocal = transformAimVectorToLocal(joint, pole);
  const poleCorrection = rotationAroundTargetAxis(aimedUp, poleLocal, targetDirection);
  const twistedCorrection =
    Math.abs(twistAngle) > EPSILON
      ? multiplyQuat(quatFromAxisAngle(targetDirection, twistAngle), multiplyQuat(poleCorrection, aimCorrection))
      : multiplyQuat(poleCorrection, aimCorrection);
  const localCorrection = weightQuaternion(twistedCorrection, weight);
  const jointCorrection = localCorrectionToModel(joint, localCorrection);
  const offsettedForwardModel = normalizeVec3(transformAimVectorToModel(joint, offsettedForward), forwardModel);
  const correctedForward = normalizeVec3(rotateVec3ByQuat(jointCorrection, forwardModel), forwardModel);
  const correctedUp = normalizeVec3(rotateVec3ByQuat(jointCorrection, upModel), upModel);
  const correctedOffsetted = normalizeVec3(rotateVec3ByQuat(jointCorrection, offsettedForwardModel), correctedForward);
  const alignmentError = angleBetweenUnit(correctedOffsetted, targetDirectionModel);

  return {
    jointCorrection,
    reached: true,
    weight,
    targetDirection: targetDirectionModel,
    offsettedForward: offsettedForwardModel,
    correctedForward,
    correctedUp,
    alignmentError
  };
}

export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const safeInput = sanitizeTwoBoneIkInput(input);
  const upperLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(safeInput.joint, safeInput.root), MIN_IK_REACH));
  const lowerLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(safeInput.end, safeInput.joint), MIN_IK_REACH));
  const physicalMinReach = Math.abs(upperLength - lowerLength);
  const solveMinReach = Math.max(MIN_IK_REACH, physicalMinReach);
  const physicalMaxReach = upperLength + lowerLength;
  const rootToTarget = subVec3(safeInput.target, safeInput.root);
  const targetDistance = finiteLength(rootToTarget, 0);
  const softenedDistance = softenIkDistance(targetDistance, physicalMinReach, physicalMaxReach, safeInput.soften ?? DEFAULT_IK_SOFTEN);
  const hardMaxReach = physicalMaxReach * Math.min(1, finiteNonNegative(safeInput.maxStretch, 1));
  const maxReach = Math.max(solveMinReach, hardMaxReach);
  const clampedDistance = clamp(softenedDistance, solveMinReach, maxReach);
  const physicalReachDistance = clamp(targetDistance, physicalMinReach, physicalMaxReach);
  const physicalClamped = targetDistance < physicalMinReach - 1e-4 || targetDistance > physicalMaxReach + 1e-4;
  const stretchLimited = targetDistance > MIN_IK_REACH && !physicalClamped && Math.abs(clampedDistance - targetDistance) > 1e-4;
  const direction = normalizeVec3(rootToTarget, normalizeVec3(subVec3(safeInput.end, safeInput.root), [0, -1, 0]));
  const pole = applyIkTwist(bendPlanePole(safeInput.pole ?? subVec3(safeInput.joint, safeInput.root), direction), direction, safeInput.twistAngle);
  const cosAngle = clamp((upperLength * upperLength + clampedDistance * clampedDistance - lowerLength * lowerLength) / (2 * upperLength * clampedDistance), -1, 1);
  const along = cosAngle * upperLength;
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const solvedJoint = addVec3(addVec3(safeInput.root, scaleVec3(direction, along)), scaleVec3(pole, height));
  const solvedEnd = addVec3(safeInput.root, scaleVec3(direction, clampedDistance));
  const weight = sanitizeUnitWeight(safeInput.weight, 1);
  const newJoint = weight >= 1 ? solvedJoint : lerpVec3(safeInput.joint, solvedJoint, weight);
  const newEnd = weight >= 1 ? solvedEnd : lerpVec3(safeInput.end, solvedEnd, weight);
  const solvedReach = targetDistance <= 1e-5 ? 0 : finiteLength(subVec3(newEnd, safeInput.root), 0) / targetDistance;
  return {
    root: safeInput.root,
    joint: newJoint,
    end: newEnd,
    targetReach: targetDistance <= 1e-5 ? 0 : physicalClamped ? physicalReachDistance / targetDistance : 1,
    solvedReach,
    reached: targetDistance > MIN_IK_REACH && !physicalClamped && Math.abs(solvedReach - 1) <= 1e-4 && weight >= 1,
    clamped: physicalClamped,
    stretchLimited
  };
}

function bendPlanePole(pole: Vec3, direction: Vec3): Vec3 {
  const normalizedDirection = normalizeVec3(direction, [0, -1, 0]);
  const normalizedPole = normalizeVec3(pole, [0, 0, 1]);
  const projected = subVec3(normalizedPole, scaleVec3(normalizedDirection, dotVec3(normalizedPole, normalizedDirection)));
  return normalizeVec3(projected, fallbackPerpendicular(normalizedDirection));
}

function fallbackPerpendicular(direction: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const projected = subVec3(axis, scaleVec3(direction, dotVec3(axis, direction)));
  return normalizeVec3(projected, [0, 0, 1]);
}

export function solveTwoBoneIkCorrections(input: TwoBoneIkInput): TwoBoneIkCorrectionResult {
  const safeInput = sanitizeTwoBoneIkInput(input);
  const solved = solveTwoBoneIk(safeInput);
  const originalUpper = normalizeVec3(subVec3(safeInput.joint, safeInput.root), [0, -1, 0]);
  const correctedUpper = normalizeVec3(subVec3(solved.joint, solved.root), originalUpper);
  const pole = safeInput.pole ?? [0, 0, 1];
  const rootCorrection = quatFromUnitVectors(originalUpper, correctedUpper, pole);

  const originalLower = normalizeVec3(subVec3(safeInput.end, safeInput.joint), [0, -1, 0]);
  const rootCorrectedLower = normalizeVec3(rotateVec3ByQuat(rootCorrection, originalLower), originalLower);
  const correctedLower = normalizeVec3(subVec3(solved.end, solved.joint), rootCorrectedLower);
  const jointCorrection = quatFromUnitVectors(rootCorrectedLower, correctedLower, safeInput.midAxis ?? pole);

  return {
    ...solved,
    rootCorrection,
    jointCorrection,
    correctedUpperDirection: correctedUpper,
    correctedLowerDirection: correctedLower
  };
}

function sanitizeTwoBoneIkInput(input: TwoBoneIkInput): TwoBoneIkInput {
  const root = finiteVec3(input.root, [0, 0, 0]);
  const joint = finiteVec3(input.joint, addVec3(root, [0, -1, 0]));
  const end = finiteVec3(input.end, addVec3(joint, [0, -1, 0]));
  const target = finiteVec3(input.target, end);
  const pole = input.pole === undefined ? undefined : finiteVec3(input.pole, subVec3(joint, root));
  const midAxis = input.midAxis === undefined ? undefined : normalizeVec3(finiteVec3(input.midAxis, [0, 0, 1]), [0, 0, 1]);
  return {
    root,
    joint,
    end,
    target,
    ...(pole === undefined ? {} : { pole }),
    ...(midAxis === undefined ? {} : { midAxis }),
    ...(input.twistAngle === undefined ? {} : { twistAngle: finiteSignedAngle(input.twistAngle) }),
    ...(input.soften === undefined ? {} : { soften: sanitizeUnitWeight(input.soften, DEFAULT_IK_SOFTEN) }),
    ...(input.weight === undefined ? {} : { weight: sanitizeUnitWeight(input.weight, 1) }),
    ...(input.maxStretch === undefined ? {} : { maxStretch: input.maxStretch })
  };
}

type AimJointSpace = {
  matrix?: Mat4;
  position: Vec3;
  rotation: Quat;
};

function sanitizeAimJoint(input: AimIkInput): AimJointSpace {
  if (input.joint && isFiniteMat4(input.joint)) {
    return { matrix: input.joint, position: matrixTranslation(input.joint), rotation: rotationFromMat4(input.joint) };
  }
  const position = finiteVec3(input.jointPosition, [0, 0, 0]);
  const rotation = normalizeQuat(input.jointRotation ?? IDENTITY_QUAT);
  return { position, rotation };
}

function resolveAimTargetLocal(input: AimIkInput, joint: AimJointSpace, offset: Vec3): Vec3 {
  if (input.target !== undefined) {
    return transformAimPointToLocal(joint, finiteVec3(input.target, joint.position));
  }

  const direction = transformAimVectorToLocal(joint, finiteVec3(input.targetDirection, [1, 0, 0]));
  const offsetLength = finiteLength(offset, 0);
  return scaleVec3(normalizeVec3(direction, [1, 0, 0]), Math.max(1, offsetLength + 1));
}

function resolveAimTargetModelDirection(input: AimIkInput, joint: AimJointSpace, targetLocalDirection: Vec3, fallback: Vec3): Vec3 {
  if (input.target !== undefined) {
    const target = finiteVec3(input.target, joint.position);
    return normalizeVec3(subVec3(target, joint.position), fallback);
  }
  if (input.targetDirection !== undefined) {
    return normalizeVec3(finiteVec3(input.targetDirection, fallback), fallback);
  }
  return normalizeVec3(transformAimVectorToModel(joint, targetLocalDirection), fallback);
}

function computeOffsettedForward(forward: Vec3, offset: Vec3, targetLocal: Vec3): { reached: boolean; forward: Vec3 } {
  const projectedOffsetLength = dotVec3(forward, offset);
  const offsetPerpendicularLengthSquared = Math.max(0, dotVec3(offset, offset) - projectedOffsetLength * projectedOffsetLength);
  const targetLengthSquared = dotVec3(targetLocal, targetLocal);
  if (!Number.isFinite(targetLengthSquared) || offsetPerpendicularLengthSquared > targetLengthSquared + 1e-8) {
    return { reached: false, forward };
  }
  const intersectionLength = Math.sqrt(Math.max(0, targetLengthSquared - offsetPerpendicularLengthSquared));
  return { reached: true, forward: addVec3(offset, scaleVec3(forward, intersectionLength - projectedOffsetLength)) };
}

function rotationAroundTargetAxis(sourceUp: Vec3, pole: Vec3, targetDirection: Vec3): Quat {
  const projectedSource = projectOnPlane(sourceUp, targetDirection, fallbackPerpendicular(targetDirection));
  const projectedPole = projectOnPlane(pole, targetDirection, projectedSource);
  const axis = normalizeVec3(targetDirection, [1, 0, 0]);
  const sin = dotVec3(crossVec3(projectedSource, projectedPole), axis);
  const cos = clamp(dotVec3(projectedSource, projectedPole), -1, 1);
  if (Math.abs(sin) <= EPSILON && cos > 0.999999) return IDENTITY_QUAT;
  return quatFromAxisAngle(axis, Math.atan2(sin, cos));
}

function projectOnPlane(value: Vec3, normal: Vec3, fallback: Vec3): Vec3 {
  const unitNormal = normalizeVec3(normal, [0, 0, 1]);
  return normalizeVec3(subVec3(value, scaleVec3(unitNormal, dotVec3(value, unitNormal))), fallback);
}

function aimResult(
  jointCorrection: Quat,
  reached: boolean,
  weight: number,
  targetDirection: Vec3,
  offsettedForward: Vec3,
  correctedForward: Vec3,
  correctedUp: Vec3
): AimIkResult {
  return {
    jointCorrection,
    reached,
    weight,
    targetDirection,
    offsettedForward,
    correctedForward,
    correctedUp,
    alignmentError: angleBetweenUnit(normalizeVec3(correctedForward, offsettedForward), normalizeVec3(targetDirection, offsettedForward))
  };
}

function softenIkDistance(distance: number, minReach: number, maxReach: number, soften: number): number {
  if (!Number.isFinite(distance)) return minReach;
  const safeSoften = sanitizeUnitWeight(soften, DEFAULT_IK_SOFTEN);
  const softenStart = maxReach * safeSoften;
  const softenRange = maxReach - softenStart;
  if (distance <= softenStart || distance <= minReach || softenRange <= EPSILON) return distance;
  const alpha = Math.max(0, (distance - softenStart) / softenRange);
  const denominator = alpha + 3;
  const ratio = 81 / (denominator * denominator * denominator * denominator);
  return softenStart + softenRange - softenRange * ratio;
}

function applyIkTwist(pole: Vec3, direction: Vec3, twistAngle: number | undefined): Vec3 {
  const angle = finiteSignedAngle(twistAngle);
  if (Math.abs(angle) <= EPSILON) return pole;
  return normalizeVec3(rotateVec3ByQuat(quatFromAxisAngle(direction, angle), pole), pole);
}

function weightQuaternion(rotation: Quat, weight: number): Quat {
  const amount = sanitizeUnitWeight(weight, 1);
  const fixed = rotation[3] < 0 ? ([-rotation[0], -rotation[1], -rotation[2], -rotation[3]] as Quat) : normalizeQuat(rotation);
  if (amount <= EPSILON) return IDENTITY_QUAT;
  if (amount >= 1) return fixed;
  return normalizeQuat([fixed[0] * amount, fixed[1] * amount, fixed[2] * amount, 1 + (fixed[3] - 1) * amount]);
}

function sanitizeUnitWeight(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? clamp01(value) : clamp01(fallback);
}

function finiteSignedAngle(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function angleBetweenUnit(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dotVec3(normalizeVec3(a), normalizeVec3(b)), -1, 1));
}

function transformAimPointToLocal(joint: AimJointSpace, point: Vec3): Vec3 {
  if (joint.matrix) return inverseTransformPoint(joint.matrix, point);
  return rotateVec3ByQuat(invertQuat(joint.rotation), subVec3(point, joint.position));
}

function transformAimVectorToLocal(joint: AimJointSpace, vector: Vec3): Vec3 {
  if (joint.matrix) return inverseTransformVector(joint.matrix, vector);
  return rotateVec3ByQuat(invertQuat(joint.rotation), vector);
}

function transformAimVectorToModel(joint: AimJointSpace, vector: Vec3): Vec3 {
  if (joint.matrix) return transformLinearVector(joint.matrix, vector);
  return rotateVec3ByQuat(joint.rotation, vector);
}

function localCorrectionToModel(joint: AimJointSpace, localCorrection: Quat): Quat {
  return multiplyQuat(multiplyQuat(joint.rotation, localCorrection), invertQuat(joint.rotation));
}

function matrixTranslation(matrix: Mat4): Vec3 {
  return [finiteMat4Value(matrix, 12, 0), finiteMat4Value(matrix, 13, 0), finiteMat4Value(matrix, 14, 0)];
}

function isFiniteMat4(matrix: Mat4): boolean {
  return matrix.length >= 16 && Array.from(matrix).slice(0, 16).every(Number.isFinite);
}

function rotationFromMat4(matrix: Mat4): Quat {
  const xAxis = normalizeVec3([finiteMat4Value(matrix, 0, 1), finiteMat4Value(matrix, 1, 0), finiteMat4Value(matrix, 2, 0)], [1, 0, 0]);
  const yInput = normalizeVec3([finiteMat4Value(matrix, 4, 0), finiteMat4Value(matrix, 5, 1), finiteMat4Value(matrix, 6, 0)], [0, 1, 0]);
  const zAxis = normalizeVec3(crossVec3(xAxis, yInput), [0, 0, 1]);
  const yAxis = normalizeVec3(crossVec3(zAxis, xAxis), [0, 1, 0]);
  const trace = xAxis[0] + yAxis[1] + zAxis[2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return normalizeQuat([(yAxis[2] - zAxis[1]) / s, (zAxis[0] - xAxis[2]) / s, (xAxis[1] - yAxis[0]) / s, 0.25 * s]);
  }
  if (xAxis[0] > yAxis[1] && xAxis[0] > zAxis[2]) {
    const s = Math.sqrt(1 + xAxis[0] - yAxis[1] - zAxis[2]) * 2;
    return normalizeQuat([0.25 * s, (xAxis[1] + yAxis[0]) / s, (zAxis[0] + xAxis[2]) / s, (yAxis[2] - zAxis[1]) / s]);
  }
  if (yAxis[1] > zAxis[2]) {
    const s = Math.sqrt(1 + yAxis[1] - xAxis[0] - zAxis[2]) * 2;
    return normalizeQuat([(xAxis[1] + yAxis[0]) / s, 0.25 * s, (yAxis[2] + zAxis[1]) / s, (zAxis[0] - xAxis[2]) / s]);
  }
  const s = Math.sqrt(1 + zAxis[2] - xAxis[0] - yAxis[1]) * 2;
  return normalizeQuat([(zAxis[0] + xAxis[2]) / s, (yAxis[2] + zAxis[1]) / s, 0.25 * s, (xAxis[1] - yAxis[0]) / s]);
}

function inverseTransformPoint(matrix: Mat4, point: Vec3): Vec3 {
  return inverseTransformVector(matrix, subVec3(point, matrixTranslation(matrix)));
}

function transformLinearVector(matrix: Mat4, vector: Vec3): Vec3 {
  const x = vector[0], y = vector[1], z = vector[2];
  return [
    finiteMat4Value(matrix, 0, 1) * x + finiteMat4Value(matrix, 4, 0) * y + finiteMat4Value(matrix, 8, 0) * z,
    finiteMat4Value(matrix, 1, 0) * x + finiteMat4Value(matrix, 5, 1) * y + finiteMat4Value(matrix, 9, 0) * z,
    finiteMat4Value(matrix, 2, 0) * x + finiteMat4Value(matrix, 6, 0) * y + finiteMat4Value(matrix, 10, 1) * z
  ];
}

function inverseTransformVector(matrix: Mat4, vector: Vec3): Vec3 {
  const m00 = finiteMat4Value(matrix, 0, 1), m01 = finiteMat4Value(matrix, 4, 0), m02 = finiteMat4Value(matrix, 8, 0);
  const m10 = finiteMat4Value(matrix, 1, 0), m11 = finiteMat4Value(matrix, 5, 1), m12 = finiteMat4Value(matrix, 9, 0);
  const m20 = finiteMat4Value(matrix, 2, 0), m21 = finiteMat4Value(matrix, 6, 0), m22 = finiteMat4Value(matrix, 10, 1);
  const c00 = m11 * m22 - m12 * m21;
  const c01 = m02 * m21 - m01 * m22;
  const c02 = m01 * m12 - m02 * m11;
  const c10 = m12 * m20 - m10 * m22;
  const c11 = m00 * m22 - m02 * m20;
  const c12 = m02 * m10 - m00 * m12;
  const c20 = m10 * m21 - m11 * m20;
  const c21 = m01 * m20 - m00 * m21;
  const c22 = m00 * m11 - m01 * m10;
  const det = m00 * c00 + m01 * c10 + m02 * c20;
  if (!Number.isFinite(det) || Math.abs(det) <= EPSILON) return [0, 0, 0];
  const invDet = 1 / det;
  return [
    (c00 * vector[0] + c01 * vector[1] + c02 * vector[2]) * invDet,
    (c10 * vector[0] + c11 * vector[1] + c12 * vector[2]) * invDet,
    (c20 * vector[0] + c21 * vector[1] + c22 * vector[2]) * invDet
  ];
}

function finiteMat4Value(matrix: Mat4, index: number, fallback: number): number {
  const value = matrix[index];
  return Number.isFinite(value) ? value! : fallback;
}

export type GroundContact = {
  point: Vec3;
  normal?: Vec3;
  rayStart?: Vec3;
};

export type FootPlantLegInput = {
  id: string;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  ground?: GroundContact;
  pole?: Vec3;
  footHeight?: number;
  influence?: number;
  maxStretch?: number;
  maxAnkleCorrection?: number;
};

export type FootPlantOptions = {
  down?: Vec3;
  footHeight?: number;
  influence?: number;
  pelvisCompensation?: number;
  maxPelvisOffset?: number;
  maxAnkleCorrection?: number;
  maxStretch?: number;
};

export type FootPlantLegResult = {
  id: string;
  planted: boolean;
  clamped: boolean;
  initialAnkle: Vec3;
  targetAnkle: Vec3;
  ankleOffset: Vec3;
  correctionDistance: number;
  groundNormal: Vec3;
  targetReach: number;
  skippedReason?: string;
  groundPoint?: Vec3;
  ik?: TwoBoneIkCorrectionResult;
};

export type FootPlantResult = {
  pelvisOffset: Vec3;
  plantedCount: number;
  lowestCorrection: number;
  legs: FootPlantLegResult[];
  issues: string[];
};

export function computeAnkleTargetFromGround(contact: GroundContact, footHeight: number): Vec3 {
  const point = finiteVec3(contact.point, [0, 0, 0]);
  const normal = normalizeVec3(finiteVec3(contact.normal, [0, 1, 0]), [0, 1, 0]);
  const safeFootHeight = finiteNonNegative(footHeight, 0);
  const rayStart = finiteVec3(contact.rayStart, addVec3(point, [0, Math.max(0.001, safeFootHeight + 0.5), 0]));
  const ai = subVec3(rayStart, point);
  const abLength = dotVec3(ai, normal);
  if (!Number.isFinite(abLength) || Math.abs(abLength) <= 1e-5) return addVec3(point, scaleVec3(normal, safeFootHeight));

  const projected = subVec3(rayStart, scaleVec3(normal, abLength));
  const ib = subVec3(projected, point);
  const ibLength = finiteLength(ib, 0);
  if (ibLength <= 1e-5) return addVec3(point, scaleVec3(normal, safeFootHeight));

  const ih = scaleVec3(ib, (ibLength * safeFootHeight) / abLength / ibLength);
  return addVec3(addVec3(point, ih), scaleVec3(normal, safeFootHeight));
}

export function solveFootPlant(input: readonly FootPlantLegInput[], options: FootPlantOptions = {}): FootPlantResult {
  const down = normalizeVec3(options.down ?? [0, -1, 0], [0, -1, 0]);
  const defaultFootHeight = finiteNonNegative(options.footHeight, 0.08);
  const defaultInfluence = clamp01(options.influence ?? 1);
  const pelvisCompensation = clamp01(options.pelvisCompensation ?? 1);
  const maxPelvisOffset = finiteNonNegative(options.maxPelvisOffset, 0.35);
  const maxAnkleCorrection = finiteNonNegative(options.maxAnkleCorrection, 0.5);
  const legs: FootPlantLegResult[] = [];
  const issues: string[] = [];
  const sanitizedInput = input.map(sanitizeFootPlantLegInput);
  let lowestCorrection = 0;
  let reachPelvisCorrection = 0;

  for (const leg of sanitizedInput) {
    const groundNormal = normalizeVec3(leg.ground?.normal ?? [0, 1, 0], [0, 1, 0]);
    if (!leg.ground) {
      legs.push({
        id: leg.id,
        planted: false,
        clamped: false,
        initialAnkle: leg.ankle,
        targetAnkle: leg.ankle,
        ankleOffset: [0, 0, 0],
        correctionDistance: 0,
        groundNormal,
        targetReach: 1,
        skippedReason: "missing-ground-contact"
      });
      issues.push(`${leg.id}: missing ground contact`);
      continue;
    }

    const rawTarget = computeAnkleTargetFromGround(leg.ground, finiteNonNegative(leg.footHeight, defaultFootHeight));
    const rawOffset = subVec3(rawTarget, leg.ankle);
    const rawDistance = finiteLength(rawOffset, 0);
    const allowedCorrection = Math.min(finiteNonNegative(leg.maxAnkleCorrection, maxAnkleCorrection), maxAnkleCorrection);
    const clamped = rawDistance > allowedCorrection + 1e-6;
    const targetAnkle = clamped ? addVec3(leg.ankle, scaleVec3(normalizeVec3(rawOffset, [0, 0, 0]), allowedCorrection)) : rawTarget;
    const ankleOffset = subVec3(targetAnkle, leg.ankle);
    const correctionDistance = finiteLength(ankleOffset, 0);
    const downwardCorrection = Math.max(0, dotVec3(ankleOffset, down));
    lowestCorrection = Math.max(lowestCorrection, downwardCorrection);
    legs.push({
      id: leg.id,
      planted: true,
      clamped,
      initialAnkle: leg.ankle,
      targetAnkle,
      ankleOffset,
      correctionDistance,
      groundNormal,
      targetReach: 1,
      groundPoint: leg.ground.point
    });
    if (clamped) issues.push(`${leg.id}: ankle correction clamped`);
  }

  for (let i = 0; i < legs.length; i += 1) {
    const result = legs[i]!;
    if (!result.planted) continue;
    const leg = sanitizedInput[i]!;
    const influence = clamp01(leg.influence ?? defaultInfluence);
    if (influence <= 1e-5) continue;
    const configuredMaxStretch = leg.maxStretch ?? options.maxStretch;
    if (configuredMaxStretch === undefined) continue;
    const upperLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(leg.knee, leg.hip), MIN_IK_REACH));
    const lowerLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(leg.ankle, leg.knee), MIN_IK_REACH));
    const maxStretch = Math.min(1, finiteNonNegative(configuredMaxStretch, 0.998));
    const maxReach = (upperLength + lowerLength) * maxStretch;
    const target = lerpVec3(leg.ankle, result.targetAnkle, influence);
    const rootToTarget = subVec3(target, leg.hip);
    const downDistance = dotVec3(rootToTarget, down);
    if (downDistance <= 0) continue;
    const distance = lengthVec3(rootToTarget);
    const horizontalDistanceSquared = Math.max(0, distance * distance - downDistance * downDistance);
    const maxDownDistanceSquared = maxReach * maxReach - horizontalDistanceSquared;
    if (maxDownDistanceSquared < -1e-8) continue;
    const maxDownDistance = Math.sqrt(Math.max(0, maxDownDistanceSquared));
    reachPelvisCorrection = Math.max(reachPelvisCorrection, (downDistance - maxDownDistance) / influence);
  }

  const pelvisCorrection = Math.max(lowestCorrection * pelvisCompensation, reachPelvisCorrection);
  const pelvisOffset = pelvisCorrection <= 1e-12 ? ([0, 0, 0] as Vec3) : scaleVec3(down, Math.min(maxPelvisOffset, pelvisCorrection));
  let plantedCount = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const result = legs[i]!;
    if (!result.planted) continue;
    plantedCount += 1;
    const leg = sanitizedInput[i]!;
    const influence = clamp01(leg.influence ?? defaultInfluence);
    const root = addVec3(leg.hip, pelvisOffset);
    const joint = addVec3(leg.knee, pelvisOffset);
    const end = addVec3(leg.ankle, pelvisOffset);
    const target = lerpVec3(end, result.targetAnkle, influence);
    const maxStretch = leg.maxStretch ?? options.maxStretch;
    const ik = solveTwoBoneIkCorrections({
      root,
      joint,
      end,
      target,
      ...(leg.pole ? { pole: leg.pole } : {}),
      ...(maxStretch === undefined ? {} : { maxStretch })
    });
    result.ik = ik;
    result.targetReach = ik.targetReach;
    result.clamped = result.clamped || ik.clamped;
    if (ik.clamped) issues.push(`${leg.id}: ik target reach clamped`);
  }

  return {
    pelvisOffset,
    plantedCount,
    lowestCorrection,
    legs,
    issues
  };
}

function sanitizeFootPlantLegInput(input: FootPlantLegInput): FootPlantLegInput {
  const hip = finiteVec3(input.hip, [0, 0, 0]);
  const knee = finiteVec3(input.knee, addVec3(hip, [0, -1, 0]));
  const ankle = finiteVec3(input.ankle, addVec3(knee, [0, -1, 0]));
  return {
    ...input,
    hip,
    knee,
    ankle,
    ...(input.ground ? { ground: sanitizeGroundContact(input.ground, ankle) } : {})
  };
}

function sanitizeGroundContact(input: GroundContact, pointFallback: Vec3): GroundContact {
  const point = finiteVec3(input.point, pointFallback);
  return {
    point,
    ...(input.normal === undefined ? {} : { normal: finiteVec3(input.normal, [0, 1, 0]) }),
    ...(input.rayStart === undefined ? {} : { rayStart: finiteVec3(input.rayStart, addVec3(point, [0, 0.5, 0])) })
  };
}

function finiteVec3(value: Vec3 | undefined, fallback: Vec3): Vec3 {
  if (!value) return fallback;
  if (value.every(Number.isFinite)) return value;
  return [
    Number.isFinite(value[0]) ? value[0] : fallback[0],
    Number.isFinite(value[1]) ? value[1] : fallback[1],
    Number.isFinite(value[2]) ? value[2] : fallback[2]
  ];
}

function finiteLength(value: Vec3, fallback: number): number {
  const length = lengthVec3(value);
  return Number.isFinite(length) ? length : fallback;
}
