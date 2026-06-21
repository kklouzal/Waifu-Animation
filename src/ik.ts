import {
  EPSILON,
  IDENTITY_QUAT,
  type Mat4,
  type Quat,
  type Transform,
  type Vec3,
  addVec3,
  clamp,
  clamp01,
  composeMat4,
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
import { type HumanoidBoneName, type Skeleton, isHumanoidBoneName, resolveHumanoidIndex, resolveJointIndex, updateLocalToModelPoseRange } from "./skeleton.js";

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
  /** Root/start joint model-space position. */
  root: Vec3;
  /** Middle joint model-space position. */
  joint: Vec3;
  /** End joint model-space position. */
  end: Vec3;
  /** Target model-space position. */
  target: Vec3;
  /** Pole vector in model space. */
  pole?: Vec3;
  /** Fallback middle-joint rotation axis in model space for the position solver. */
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
  /** Model-space correction that pre-multiplies the root/start joint model rotation. */
  rootCorrection: Quat;
  /** Model-space correction that pre-multiplies the middle joint model rotation after rootCorrection. */
  jointCorrection: Quat;
  correctedUpperDirection: Vec3;
  correctedLowerDirection: Vec3;
};

export type ModelJointTransform = Mat4 | Transform;

export type TwoBoneIkModelInput = {
  /** Root/start joint model-space matrix or decomposed model transform. */
  root: ModelJointTransform;
  /** Middle joint model-space matrix or decomposed model transform. */
  mid: ModelJointTransform;
  /** End joint model-space matrix or decomposed model transform. */
  end: ModelJointTransform;
  /** Target model-space position. */
  target: Vec3;
  /** Pole vector in model space. */
  pole?: Vec3;
  /** Ozz-style middle joint axis in middle-joint local space. */
  midAxis?: Vec3;
  twistAngle?: number;
  soften?: number;
  weight?: number;
  maxStretch?: number;
};

export type TwoBoneIkModelResult = TwoBoneIkCorrectionResult & {
  /** Model-space correction that pre-multiplies the root/start joint model rotation. */
  rootModelCorrection: Quat;
  /** Model-space correction that pre-multiplies the middle joint model rotation after rootModelCorrection. */
  midModelCorrection: Quat;
  /**
   * Ozz-style local-space correction for the root/start joint.
   * Post-multiply it into the joint local rotation: local.rotation = local.rotation * rootLocalCorrection.
   */
  rootLocalCorrection: Quat;
  /**
   * Ozz-style local-space correction for the middle joint, computed after rootLocalCorrection.
   * Post-multiply it into the joint local rotation: local.rotation = local.rotation * midLocalCorrection.
   */
  midLocalCorrection: Quat;
};

export type ApplyTwoBoneIkLocalCorrectionsInput = {
  skeleton: Skeleton;
  localPose: Transform[];
  modelPose: Mat4[];
  rootJoint: number;
  midJoint: number;
  corrections: Pick<TwoBoneIkModelResult, "rootLocalCorrection" | "midLocalCorrection">;
  /** Last joint index to refresh in modelPose, inclusive. Defaults to all descendants after rootJoint. */
  updateTo?: number;
};

export type ApplyTwoBoneIkLocalCorrectionsResult = {
  localPose: Transform[];
  modelPose: Mat4[];
  updatedFrom: number;
  updatedTo: number;
};

export type ApplyAimIkModelCorrectionInput = {
  skeleton: Skeleton;
  localPose: Transform[];
  modelPose: Mat4[];
  joint: number;
  /** Model-space correction returned by solveAimIk().jointCorrection. */
  jointCorrection: Quat;
  /** Last joint index to refresh in modelPose, inclusive. Defaults to all descendants after joint. */
  updateTo?: number;
};

export type ApplyAimIkModelCorrectionResult = {
  localPose: Transform[];
  modelPose: Mat4[];
  /** Ozz-style local-space correction post-multiplied into the joint local rotation. */
  localCorrection: Quat;
  updatedFrom: number;
  updatedTo: number;
};

export type AimIkChainJointInput = {
  joint: number;
  forward?: Vec3;
  offset?: Vec3;
  up?: Vec3;
  pole?: Vec3;
  twistAngle?: number;
  weight?: number;
};

export type ApplyAimIkChainInput = {
  skeleton: Skeleton;
  localPose: Transform[];
  modelPose: Mat4[];
  /** Joints are solved and applied in array order. Model matrices are refreshed after each correction. */
  joints: readonly (number | AimIkChainJointInput)[];
  target?: Vec3;
  targetDirection?: Vec3;
  forward?: Vec3;
  offset?: Vec3;
  up?: Vec3;
  pole?: Vec3;
  twistAngle?: number;
  weight?: number;
  updateTo?: number;
};

export type AimIkChainCorrection = {
  joint: number;
  aim: AimIkResult;
  localCorrection: Quat;
};

export type ApplyAimIkChainResult = {
  localPose: Transform[];
  modelPose: Mat4[];
  corrections: AimIkChainCorrection[];
};

export type ApplyAimIkChildToParentChainResult = ApplyAimIkChainResult & {
  updatedFrom: number;
  updatedTo: number;
};

export type HumanoidLookAtAimBone = "head" | "neck" | "upperChest" | "chest" | "spine";

export type HumanoidLookAtAimChainOptions = {
  bones?: readonly HumanoidLookAtAimBone[];
  weights?: Partial<Record<HumanoidLookAtAimBone, number>>;
  jointWeight?: number;
  chainWeight?: number;
  guaranteeLast?: boolean;
  forward?: Vec3;
  offset?: Vec3;
  up?: Vec3;
  pole?: Vec3;
  twistAngle?: number;
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

export function solveTwoBoneIkModel(input: TwoBoneIkModelInput): TwoBoneIkModelResult {
  const rootModel = modelMatrixFromTransform(input.root);
  const midModel = modelMatrixFromTransform(input.mid);
  const endModel = modelMatrixFromTransform(input.end);
  const rootModelRotation = rotationFromMat4(rootModel);
  const midModelRotation = rotationFromMat4(midModel);
  const root = matrixTranslation(rootModel);
  const mid = matrixTranslation(midModel);
  const end = matrixTranslation(endModel);
  const target = finiteVec3(input.target, end);
  const pole = input.pole === undefined ? undefined : finiteVec3(input.pole, subVec3(mid, root));
  const midAxisModel =
    input.midAxis === undefined
      ? undefined
      : normalizeVec3(transformLinearVector(midModel, finiteVec3(input.midAxis, [0, 0, 1])), transformLinearVector(midModel, [0, 0, 1]));
  const solvedPosition = solveTwoBoneIk({
    root,
    joint: mid,
    end,
    target,
    ...(pole === undefined ? {} : { pole }),
    ...(input.twistAngle === undefined ? {} : { twistAngle: input.twistAngle }),
    ...(input.soften === undefined ? {} : { soften: input.soften }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
    ...(input.maxStretch === undefined ? {} : { maxStretch: input.maxStretch })
  });
  const originalUpper = normalizeVec3(subVec3(mid, root), [0, -1, 0]);
  const correctedUpper = normalizeVec3(subVec3(solvedPosition.joint, solvedPosition.root), originalUpper);
  const correctionPole = pole ?? ([0, 0, 1] as Vec3);
  const rootCorrection = quatFromUnitVectors(originalUpper, correctedUpper, correctionPole);
  const originalLower = normalizeVec3(subVec3(end, mid), [0, -1, 0]);
  const rootCorrectedLower = normalizeVec3(rotateVec3ByQuat(rootCorrection, originalLower), originalLower);
  const correctedLower = normalizeVec3(subVec3(solvedPosition.end, solvedPosition.joint), rootCorrectedLower);
  const rootedMidAxis = midAxisModel === undefined ? undefined : rotateVec3ByQuat(rootCorrection, midAxisModel);
  const jointCorrection = quatFromUnitVectors(rootCorrectedLower, correctedLower, rootedMidAxis ?? correctionPole);
  const solved: TwoBoneIkCorrectionResult = {
    ...solvedPosition,
    rootCorrection,
    jointCorrection,
    correctedUpperDirection: correctedUpper,
    correctedLowerDirection: correctedLower
  };
  const rootLocalCorrection = modelCorrectionToLocalPostCorrectionForRotation(rootModelRotation, solved.rootCorrection);
  const rootCorrectedMidModelRotation = multiplyQuat(solved.rootCorrection, midModelRotation);
  const midLocalCorrection = modelCorrectionToLocalPostCorrectionForRotation(rootCorrectedMidModelRotation, solved.jointCorrection);

  return {
    ...solved,
    rootModelCorrection: solved.rootCorrection,
    midModelCorrection: solved.jointCorrection,
    rootLocalCorrection,
    midLocalCorrection
  };
}

export function modelCorrectionToLocalPostCorrection(jointModel: Mat4, modelCorrection: Quat): Quat {
  return modelCorrectionToLocalPostCorrectionForRotation(rotationFromMat4(jointModel), modelCorrection);
}

export function applyTwoBoneIkLocalCorrections(input: ApplyTwoBoneIkLocalCorrectionsInput): ApplyTwoBoneIkLocalCorrectionsResult {
  const rootJoint = requireJointIndex(input.skeleton, input.rootJoint, "rootJoint");
  const midJoint = requireJointIndex(input.skeleton, input.midJoint, "midJoint");
  if (!isJointDescendantOrSelf(input.skeleton, midJoint, rootJoint)) {
    throw new Error(`midJoint ${midJoint} must be a descendant of rootJoint ${rootJoint}`);
  }
  multiplyPoseRotation(input.localPose, rootJoint, input.corrections.rootLocalCorrection, "rootJoint");
  multiplyPoseRotation(input.localPose, midJoint, input.corrections.midLocalCorrection, "midJoint");
  const updatedTo = sanitizeUpdateTo(input.updateTo, input.skeleton.joints.length);
  updateLocalToModelPoseRange(input.skeleton, input.localPose, input.modelPose, { from: rootJoint, to: updatedTo });
  return { localPose: input.localPose, modelPose: input.modelPose, updatedFrom: rootJoint, updatedTo };
}

export function applyAimIkModelCorrection(input: ApplyAimIkModelCorrectionInput): ApplyAimIkModelCorrectionResult {
  const joint = requireJointIndex(input.skeleton, input.joint, "joint");
  const jointModel = input.modelPose[joint];
  if (!jointModel) throw new Error(`modelPose is missing joint ${joint}`);
  const localCorrection = modelCorrectionToLocalPostCorrection(jointModel, input.jointCorrection);
  multiplyPoseRotation(input.localPose, joint, localCorrection, "joint");
  const updatedTo = sanitizeUpdateTo(input.updateTo, input.skeleton.joints.length);
  updateLocalToModelPoseRange(input.skeleton, input.localPose, input.modelPose, { from: joint, to: updatedTo });
  return { localPose: input.localPose, modelPose: input.modelPose, localCorrection, updatedFrom: joint, updatedTo };
}

export function applyAimIkChainToPose(input: ApplyAimIkChainInput): ApplyAimIkChainResult {
  const corrections: AimIkChainCorrection[] = [];
  for (const jointInput of input.joints) {
    const jointConfig = typeof jointInput === "number" ? { joint: jointInput } : jointInput;
    const joint = requireJointIndex(input.skeleton, jointConfig.joint, "joint");
    const jointModel = input.modelPose[joint];
    if (!jointModel) throw new Error(`modelPose is missing joint ${joint}`);
    const aim = solveAimIk({
      joint: jointModel,
      ...(input.target === undefined ? {} : { target: input.target }),
      ...(input.targetDirection === undefined ? {} : { targetDirection: input.targetDirection }),
      ...(jointConfig.forward === undefined && input.forward === undefined ? {} : { forward: jointConfig.forward ?? input.forward! }),
      ...(jointConfig.offset === undefined && input.offset === undefined ? {} : { offset: jointConfig.offset ?? input.offset! }),
      ...(jointConfig.up === undefined && input.up === undefined ? {} : { up: jointConfig.up ?? input.up! }),
      ...(jointConfig.pole === undefined && input.pole === undefined ? {} : { pole: jointConfig.pole ?? input.pole! }),
      ...(jointConfig.twistAngle === undefined && input.twistAngle === undefined ? {} : { twistAngle: jointConfig.twistAngle ?? input.twistAngle! }),
      ...(jointConfig.weight === undefined && input.weight === undefined ? {} : { weight: jointConfig.weight ?? input.weight! })
    });
    const applied = applyAimIkModelCorrection({
      skeleton: input.skeleton,
      localPose: input.localPose,
      modelPose: input.modelPose,
      joint,
      jointCorrection: aim.jointCorrection,
      ...(input.updateTo === undefined ? {} : { updateTo: input.updateTo })
    });
    corrections.push({ joint, aim, localCorrection: applied.localCorrection });
  }
  return { localPose: input.localPose, modelPose: input.modelPose, corrections };
}

export function applyAimIkChildToParentChainToPose(input: ApplyAimIkChainInput): ApplyAimIkChildToParentChainResult {
  const corrections: AimIkChainCorrection[] = [];
  let previousJoint = -1;
  let previousForward = input.forward ?? ([1, 0, 0] as Vec3);
  let previousOffset = input.offset ?? ([0, 0, 0] as Vec3);
  let previousLocalCorrection: Quat | null = null;
  let updatedFrom = input.skeleton.joints.length;

  for (const jointInput of input.joints) {
    const jointConfig = typeof jointInput === "number" ? { joint: jointInput } : jointInput;
    const joint = requireJointIndex(input.skeleton, jointConfig.joint, "joint");
    const jointModel = input.modelPose[joint];
    if (!jointModel) throw new Error(`modelPose is missing joint ${joint}`);

    const propagated = previousLocalCorrection && previousJoint >= 0
      ? propagateAimChainOffset(input.modelPose[previousJoint]!, jointModel, previousForward, previousOffset, previousLocalCorrection)
      : null;
    const forward = jointConfig.forward ?? propagated?.forward ?? input.forward;
    const offset = jointConfig.offset ?? propagated?.offset ?? input.offset;
    const aim = solveAimIk({
      joint: jointModel,
      ...(input.target === undefined ? {} : { target: input.target }),
      ...(input.targetDirection === undefined ? {} : { targetDirection: input.targetDirection }),
      ...(forward === undefined ? {} : { forward }),
      ...(offset === undefined ? {} : { offset }),
      ...(jointConfig.up === undefined && input.up === undefined ? {} : { up: jointConfig.up ?? input.up! }),
      ...(jointConfig.pole === undefined && input.pole === undefined ? {} : { pole: jointConfig.pole ?? input.pole! }),
      ...(jointConfig.twistAngle === undefined && input.twistAngle === undefined ? {} : { twistAngle: jointConfig.twistAngle ?? input.twistAngle! }),
      ...(jointConfig.weight === undefined && input.weight === undefined ? {} : { weight: jointConfig.weight ?? input.weight! })
    });
    const localCorrection = modelCorrectionToLocalPostCorrection(jointModel, aim.jointCorrection);
    multiplyPoseRotation(input.localPose, joint, localCorrection, "joint");
    corrections.push({ joint, aim, localCorrection });
    updatedFrom = Math.min(updatedFrom, joint);
    previousJoint = joint;
    previousForward = forward ?? previousForward;
    previousOffset = offset ?? previousOffset;
    previousLocalCorrection = localCorrection;
  }

  const updatedTo = sanitizeUpdateTo(input.updateTo, input.skeleton.joints.length);
  if (corrections.length > 0) {
    updateLocalToModelPoseRange(input.skeleton, input.localPose, input.modelPose, { from: updatedFrom, to: updatedTo });
  } else {
    updatedFrom = updatedTo;
  }
  return { localPose: input.localPose, modelPose: input.modelPose, corrections, updatedFrom, updatedTo };
}

export function createHumanoidLookAtAimChain(skeleton: Skeleton, options: HumanoidLookAtAimChainOptions = {}): AimIkChainJointInput[] {
  const bones = options.bones ?? DEFAULT_HUMANOID_LOOK_AT_AIM_CHAIN;
  const chain: AimIkChainJointInput[] = [];
  const chainWeight = sanitizeUnitWeight(options.chainWeight, 1);
  const jointWeight = sanitizeUnitWeight(options.jointWeight, 0.5);

  for (const bone of bones) {
    const joint = resolveHumanoidIndex(skeleton, bone as HumanoidBoneName);
    if (joint < 0) continue;
    const configured = options.weights?.[bone];
    const weight = configured === undefined ? jointWeight * DEFAULT_HUMANOID_LOOK_AT_WEIGHTS[bone] : sanitizeUnitWeight(configured, DEFAULT_HUMANOID_LOOK_AT_WEIGHTS[bone]);
    const item: AimIkChainJointInput = { joint, weight: weight * chainWeight };
    if (options.forward !== undefined) item.forward = options.forward;
    if (options.offset !== undefined) item.offset = options.offset;
    if (options.up !== undefined) item.up = options.up;
    if (options.pole !== undefined) item.pole = options.pole;
    if (options.twistAngle !== undefined) item.twistAngle = options.twistAngle;
    chain.push(item);
  }

  if (options.guaranteeLast && chain.length > 0) {
    chain[chain.length - 1] = { ...chain[chain.length - 1]!, weight: chainWeight };
  }
  return chain;
}

const DEFAULT_HUMANOID_LOOK_AT_AIM_CHAIN: readonly HumanoidLookAtAimBone[] = ["head", "neck", "upperChest", "chest", "spine"];
const DEFAULT_HUMANOID_LOOK_AT_WEIGHTS: Readonly<Record<HumanoidLookAtAimBone, number>> = {
  head: 1,
  neck: 0.72,
  upperChest: 0.42,
  chest: 0.3,
  spine: 0.2
};

function propagateAimChainOffset(previousModel: Mat4, jointModel: Mat4, forward: Vec3, offset: Vec3, correction: Quat): { forward: Vec3; offset: Vec3 } {
  const correctedForwardModel = transformLinearVector(previousModel, rotateVec3ByQuat(correction, forward));
  const correctedOffsetModel = addVec3(matrixTranslation(previousModel), transformLinearVector(previousModel, rotateVec3ByQuat(correction, offset)));
  return {
    forward: inverseTransformVector(jointModel, correctedForwardModel),
    offset: inverseTransformPoint(jointModel, correctedOffsetModel)
  };
}

function modelMatrixFromTransform(value: ModelJointTransform): Mat4 {
  if ("length" in value) return value;
  return composeMat4(value);
}

function modelCorrectionToLocalPostCorrectionForRotation(modelRotation: Quat, modelCorrection: Quat): Quat {
  const rotation = normalizeQuat(modelRotation);
  const correction = normalizeQuat(modelCorrection);
  return multiplyQuat(multiplyQuat(invertQuat(rotation), correction), rotation);
}

function requireJointIndex(skeleton: Skeleton, index: number, label: string): number {
  if (!Number.isInteger(index) || index < 0 || index >= skeleton.joints.length) {
    throw new Error(`${label} ${index} is outside skeleton joint range`);
  }
  return index;
}

function sanitizeUpdateTo(updateTo: number | undefined, jointCount: number): number {
  if (updateTo === undefined) return jointCount - 1;
  if (!Number.isInteger(updateTo) || updateTo < 0) throw new Error("updateTo must be a non-negative joint index");
  return Math.min(updateTo, jointCount - 1);
}

function isJointDescendantOrSelf(skeleton: Skeleton, child: number, ancestor: number): boolean {
  if (child === ancestor) return true;
  let parent = skeleton.joints[child]?.parentIndex ?? -1;
  while (parent >= 0) {
    if (parent === ancestor) return true;
    parent = skeleton.joints[parent]?.parentIndex ?? -1;
  }
  return false;
}

function multiplyPoseRotation(localPose: Transform[], joint: number, correction: Quat, label: string): void {
  const transform = localPose[joint];
  if (!transform) throw new Error(`localPose is missing ${label} ${joint}`);
  localPose[joint] = {
    translation: transform.translation,
    rotation: multiplyQuat(transform.rotation, correction),
    scale: transform.scale
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

export type OzzFootIkSide = "left" | "right";

export type OzzFootIkRay = {
  id: string;
  side?: OzzFootIkSide;
  ankle: Vec3;
  start: Vec3;
  direction: Vec3;
  length: number;
};

export type OzzFootIkRaycast = (ray: OzzFootIkRay) => GroundContact | null | undefined;

export type OzzFootIkLegPreset = {
  id?: string;
  side?: OzzFootIkSide;
  hip?: number | string;
  knee?: number | string;
  ankle?: number | string;
  pole?: Vec3;
  ankleUp?: Vec3;
  footForward?: Vec3;
  footHeight?: number;
  influence?: number;
  maxStretch?: number;
  maxAnkleCorrection?: number;
};

export type OzzFootIkOptions = FootPlantOptions & {
  skeleton: Skeleton;
  modelPose: readonly Mat4[];
  legs?: readonly OzzFootIkLegPreset[];
  contacts?: Readonly<Record<string, GroundContact | null | undefined>>;
  raycast?: OzzFootIkRaycast;
  rayHeight?: number;
  rayLength?: number;
  aimAnkles?: boolean;
};

export type OzzFootIkLegResult = FootPlantLegResult & {
  side?: OzzFootIkSide;
  hipJoint: number;
  kneeJoint: number;
  ankleJoint: number;
  ray?: OzzFootIkRay;
  ankleAim?: AimIkResult;
};

export type OzzFootIkResult = Omit<FootPlantResult, "legs"> & {
  legs: OzzFootIkLegResult[];
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

export function solveOzzFootIk(input: OzzFootIkOptions): OzzFootIkResult {
  const issues: string[] = [];
  const resolvedLegs = resolveOzzFootIkLegs(input, issues);
  const footPlantInput: FootPlantLegInput[] = [];

  for (const leg of resolvedLegs) {
    const hip = matrixTranslation(input.modelPose[leg.hipJoint]!);
    const knee = matrixTranslation(input.modelPose[leg.kneeJoint]!);
    const ankle = matrixTranslation(input.modelPose[leg.ankleJoint]!);
    const contact = resolveOzzFootIkContact(input, leg, ankle);
    if (!contact.ground) issues.push(`${leg.id}: missing floor contact`);
    footPlantInput.push({
      id: leg.id,
      hip,
      knee,
      ankle,
      ...(contact.ground ? { ground: contact.ground } : {}),
      ...(leg.pole ? { pole: leg.pole } : {}),
      ...(leg.footHeight === undefined ? {} : { footHeight: leg.footHeight }),
      ...(leg.influence === undefined ? {} : { influence: leg.influence }),
      ...(leg.maxStretch === undefined ? {} : { maxStretch: leg.maxStretch }),
      ...(leg.maxAnkleCorrection === undefined ? {} : { maxAnkleCorrection: leg.maxAnkleCorrection })
    });
  }

  const plan = solveFootPlant(footPlantInput, input);
  const legs = plan.legs.map((leg, index): OzzFootIkLegResult => {
    const resolved = resolvedLegs[index]!;
    const result: OzzFootIkLegResult = {
      ...leg,
      hipJoint: resolved.hipJoint,
      kneeJoint: resolved.kneeJoint,
      ankleJoint: resolved.ankleJoint
    };
    if (resolved.side !== undefined) result.side = resolved.side;
    if (resolved.ray !== undefined) result.ray = resolved.ray;
    if (input.aimAnkles !== false && leg.planted) {
      const ankleModel = input.modelPose[resolved.ankleJoint];
      if (ankleModel) {
        const footForward = resolved.footForward ?? ([0, 0, 1] as Vec3);
        result.ankleAim = solveAimIk({
          joint: ankleModel,
          target: addVec3(leg.targetAnkle, leg.groundNormal),
          forward: resolved.ankleUp ?? [0, 1, 0],
          up: footForward,
          pole: transformLinearVector(ankleModel, footForward),
          ...(resolved.influence === undefined ? {} : { weight: resolved.influence })
        });
      }
    }
    return result;
  });

  return {
    pelvisOffset: plan.pelvisOffset,
    plantedCount: plan.plantedCount,
    lowestCorrection: plan.lowestCorrection,
    legs,
    issues: [...issues, ...plan.issues]
  };
}

type ResolvedOzzFootIkLeg = Required<Pick<OzzFootIkLegResult, "id" | "hipJoint" | "kneeJoint" | "ankleJoint">> &
  Pick<OzzFootIkLegPreset, "side" | "pole" | "ankleUp" | "footForward" | "footHeight" | "influence" | "maxStretch" | "maxAnkleCorrection"> & {
    ray?: OzzFootIkRay;
  };

const DEFAULT_OZZ_FOOT_IK_LEGS: readonly OzzFootIkLegPreset[] = [
  { id: "left", side: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot" },
  { id: "right", side: "right", hip: "rightUpperLeg", knee: "rightLowerLeg", ankle: "rightFoot" }
];

function resolveOzzFootIkLegs(input: OzzFootIkOptions, issues: string[]): ResolvedOzzFootIkLeg[] {
  const presets = input.legs ?? DEFAULT_OZZ_FOOT_IK_LEGS;
  const legs: ResolvedOzzFootIkLeg[] = [];
  for (const preset of presets) {
    const side = preset.side;
    const id = preset.id ?? side ?? String(legs.length);
    const hipJoint = resolveOzzFootIkJoint(input.skeleton, preset.hip ?? sideHumanoid(side, "UpperLeg"));
    const kneeJoint = resolveOzzFootIkJoint(input.skeleton, preset.knee ?? sideHumanoid(side, "LowerLeg"));
    const ankleJoint = resolveOzzFootIkJoint(input.skeleton, preset.ankle ?? sideHumanoid(side, "Foot"));
    if (hipJoint < 0 || kneeJoint < 0 || ankleJoint < 0) {
      issues.push(`${id}: missing leg joints`);
      continue;
    }
    if (!input.modelPose[hipJoint] || !input.modelPose[kneeJoint] || !input.modelPose[ankleJoint]) {
      issues.push(`${id}: missing model pose joints`);
      continue;
    }
    const leg: ResolvedOzzFootIkLeg = { id, hipJoint, kneeJoint, ankleJoint };
    if (side !== undefined) leg.side = side;
    if (preset.pole !== undefined) leg.pole = preset.pole;
    if (preset.ankleUp !== undefined) leg.ankleUp = preset.ankleUp;
    if (preset.footForward !== undefined) leg.footForward = preset.footForward;
    if (preset.footHeight !== undefined) leg.footHeight = preset.footHeight;
    if (preset.influence !== undefined) leg.influence = preset.influence;
    if (preset.maxStretch !== undefined) leg.maxStretch = preset.maxStretch;
    if (preset.maxAnkleCorrection !== undefined) leg.maxAnkleCorrection = preset.maxAnkleCorrection;
    legs.push(leg);
  }
  return legs;
}

function resolveOzzFootIkContact(input: OzzFootIkOptions, leg: ResolvedOzzFootIkLeg, ankle: Vec3): { ground?: GroundContact } {
  if (input.contacts && Object.prototype.hasOwnProperty.call(input.contacts, leg.id)) {
    const configured = input.contacts[leg.id];
    return configured ? { ground: configured } : {};
  }
  const rayHeight = finiteNonNegative(input.rayHeight, 0.5);
  const direction = normalizeVec3(input.down ?? [0, -1, 0], [0, -1, 0]);
  const ray: OzzFootIkRay = {
    id: leg.id,
    ankle,
    start: addVec3(ankle, scaleVec3(direction, -rayHeight)),
    direction,
    length: finiteNonNegative(input.rayLength, rayHeight + finiteNonNegative(input.maxAnkleCorrection, 0.5) + finiteNonNegative(input.footHeight, 0.08) + 0.25)
  };
  if (leg.side !== undefined) ray.side = leg.side;
  leg.ray = ray;
  const hit = input.raycast?.(ray) ?? null;
  if (!hit) return {};
  return { ground: { ...hit, rayStart: hit.rayStart ?? ray.start } };
}

function resolveOzzFootIkJoint(skeleton: Skeleton, reference: number | string | undefined): number {
  if (reference === undefined) return -1;
  if (typeof reference === "number") return Number.isInteger(reference) && reference >= 0 && reference < skeleton.joints.length ? reference : -1;
  if (isHumanoidBoneName(reference)) {
    const humanoid = resolveHumanoidIndex(skeleton, reference);
    if (humanoid >= 0) return humanoid;
  }
  return resolveJointIndex(skeleton, reference);
}

function sideHumanoid(side: OzzFootIkSide | undefined, suffix: "UpperLeg" | "LowerLeg" | "Foot"): HumanoidBoneName | undefined {
  if (!side) return undefined;
  return `${side}${suffix}` as HumanoidBoneName;
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
