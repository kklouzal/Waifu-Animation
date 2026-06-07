import { type Vec3, addVec3, clamp, lengthVec3, normalizeVec3, scaleVec3, subVec3 } from "./math.js";

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
  clamped: boolean;
};

export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const upperLength = Math.max(1e-5, lengthVec3(subVec3(input.joint, input.root)));
  const lowerLength = Math.max(1e-5, lengthVec3(subVec3(input.end, input.joint)));
  const maxReach = (upperLength + lowerLength) * (input.maxStretch ?? 0.998);
  const rootToTarget = subVec3(input.target, input.root);
  const targetDistance = lengthVec3(rootToTarget);
  const clampedDistance = clamp(targetDistance, Math.abs(upperLength - lowerLength) + 1e-5, maxReach);
  const direction = normalizeVec3(rootToTarget, normalizeVec3(subVec3(input.end, input.root), [0, -1, 0]));
  const pole = normalizeVec3(input.pole ?? subVec3(input.joint, input.root), [0, 0, 1]);
  const cosAngle = clamp((upperLength * upperLength + clampedDistance * clampedDistance - lowerLength * lowerLength) / (2 * upperLength * clampedDistance), -1, 1);
  const along = Math.cos(Math.acos(cosAngle)) * upperLength;
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const newJoint = addVec3(addVec3(input.root, scaleVec3(direction, along)), scaleVec3(pole, height));
  const newEnd = addVec3(input.root, scaleVec3(direction, clampedDistance));
  return {
    root: input.root,
    joint: newJoint,
    end: newEnd,
    targetReach: targetDistance <= 1e-5 ? 0 : clampedDistance / targetDistance,
    clamped: Math.abs(clampedDistance - targetDistance) > 1e-4
  };
}

