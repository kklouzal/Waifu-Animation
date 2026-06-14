import {
  type Quat,
  type Vec3,
  addVec3,
  clamp,
  clamp01,
  dotVec3,
  lengthVec3,
  lerpVec3,
  normalizeVec3,
  quatFromUnitVectors,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3
} from "./math.js";

export type TwoBoneIkInput = {
  root: Vec3;
  joint: Vec3;
  end: Vec3;
  target: Vec3;
  pole?: Vec3;
  maxStretch?: number;
};

export type TwoBoneIkResult = {
  root: Vec3;
  joint: Vec3;
  end: Vec3;
  targetReach: number;
  solvedReach: number;
  clamped: boolean;
  stretchLimited: boolean;
};

export type TwoBoneIkCorrectionResult = TwoBoneIkResult & {
  rootCorrection: Quat;
  jointCorrection: Quat;
  correctedUpperDirection: Vec3;
  correctedLowerDirection: Vec3;
};

export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const upperLength = Math.max(1e-5, lengthVec3(subVec3(input.joint, input.root)));
  const lowerLength = Math.max(1e-5, lengthVec3(subVec3(input.end, input.joint)));
  const physicalMinReach = Math.abs(upperLength - lowerLength) + 1e-5;
  const physicalMaxReach = upperLength + lowerLength;
  const maxReach = physicalMaxReach * finiteNonNegative(input.maxStretch, 0.998);
  const rootToTarget = subVec3(input.target, input.root);
  const targetDistance = lengthVec3(rootToTarget);
  const clampedDistance = clamp(targetDistance, physicalMinReach, maxReach);
  const physicalReachDistance = clamp(targetDistance, physicalMinReach, physicalMaxReach);
  const physicalClamped = targetDistance < physicalMinReach - 1e-4 || targetDistance > physicalMaxReach + 1e-4;
  const stretchLimited = !physicalClamped && Math.abs(clampedDistance - targetDistance) > 1e-4;
  const direction = normalizeVec3(rootToTarget, normalizeVec3(subVec3(input.end, input.root), [0, -1, 0]));
  const pole = bendPlanePole(input.pole ?? subVec3(input.joint, input.root), direction);
  const cosAngle = clamp((upperLength * upperLength + clampedDistance * clampedDistance - lowerLength * lowerLength) / (2 * upperLength * clampedDistance), -1, 1);
  const along = cosAngle * upperLength;
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const newJoint = addVec3(addVec3(input.root, scaleVec3(direction, along)), scaleVec3(pole, height));
  const newEnd = addVec3(input.root, scaleVec3(direction, clampedDistance));
  return {
    root: input.root,
    joint: newJoint,
    end: newEnd,
    targetReach: targetDistance <= 1e-5 ? 0 : physicalClamped ? physicalReachDistance / targetDistance : 1,
    solvedReach: targetDistance <= 1e-5 ? 0 : clampedDistance / targetDistance,
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
  const solved = solveTwoBoneIk(input);
  const originalUpper = normalizeVec3(subVec3(input.joint, input.root), [0, -1, 0]);
  const correctedUpper = normalizeVec3(subVec3(solved.joint, solved.root), originalUpper);
  const pole = input.pole ?? [0, 0, 1];
  const rootCorrection = quatFromUnitVectors(originalUpper, correctedUpper, pole);

  const originalLower = normalizeVec3(subVec3(input.end, input.joint), [0, -1, 0]);
  const rootCorrectedLower = normalizeVec3(rotateVec3ByQuat(rootCorrection, originalLower), originalLower);
  const correctedLower = normalizeVec3(subVec3(solved.end, solved.joint), rootCorrectedLower);
  const jointCorrection = quatFromUnitVectors(rootCorrectedLower, correctedLower, pole);

  return {
    ...solved,
    rootCorrection,
    jointCorrection,
    correctedUpperDirection: correctedUpper,
    correctedLowerDirection: correctedLower
  };
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
  const normal = normalizeVec3(contact.normal ?? [0, 1, 0], [0, 1, 0]);
  const safeFootHeight = finiteNonNegative(footHeight, 0);
  const rayStart = contact.rayStart ?? addVec3(contact.point, [0, Math.max(0.001, safeFootHeight + 0.5), 0]);
  const ai = subVec3(rayStart, contact.point);
  const abLength = dotVec3(ai, normal);
  if (Math.abs(abLength) <= 1e-5) return addVec3(contact.point, scaleVec3(normal, safeFootHeight));

  const projected = subVec3(rayStart, scaleVec3(normal, abLength));
  const ib = subVec3(projected, contact.point);
  const ibLength = lengthVec3(ib);
  if (ibLength <= 1e-5) return addVec3(contact.point, scaleVec3(normal, safeFootHeight));

  const ih = scaleVec3(ib, (ibLength * safeFootHeight) / abLength / ibLength);
  return addVec3(addVec3(contact.point, ih), scaleVec3(normal, safeFootHeight));
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
  let lowestCorrection = 0;

  for (const leg of input) {
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
    const rawDistance = lengthVec3(rawOffset);
    const allowedCorrection = Math.min(finiteNonNegative(leg.maxAnkleCorrection, maxAnkleCorrection), maxAnkleCorrection);
    const clamped = rawDistance > allowedCorrection && allowedCorrection > 0;
    const targetAnkle = clamped ? addVec3(leg.ankle, scaleVec3(normalizeVec3(rawOffset, [0, 0, 0]), allowedCorrection)) : rawTarget;
    const ankleOffset = subVec3(targetAnkle, leg.ankle);
    const correctionDistance = lengthVec3(ankleOffset);
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

  const pelvisOffset = scaleVec3(down, Math.min(maxPelvisOffset, lowestCorrection * pelvisCompensation));
  let plantedCount = 0;
  for (const result of legs) {
    if (!result.planted) continue;
    plantedCount += 1;
    const leg = input.find((candidate) => candidate.id === result.id);
    if (!leg) continue;
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

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
