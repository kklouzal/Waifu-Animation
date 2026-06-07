import {
  type Transform,
  applyTransformDelta,
  cloneTransform,
  isFiniteTransform,
  lerpTransform,
  normalizeTransform,
  transformDelta
} from "./math.js";
import { type Skeleton, createRestPose } from "./skeleton.js";

export type Pose = Transform[];
export type JointMask = Float32Array;

export type PoseValidationIssue = {
  joint: string;
  index: number;
  message: string;
};

export function clonePose(pose: readonly Transform[]): Pose {
  return pose.map((transform) => cloneTransform(transform));
}

export function normalizePose(pose: readonly Transform[]): Pose {
  return pose.map((transform) => normalizeTransform(transform));
}

export function validatePose(skeleton: Skeleton, pose: readonly Transform[]): PoseValidationIssue[] {
  const issues: PoseValidationIssue[] = [];
  if (pose.length !== skeleton.joints.length) {
    issues.push({ joint: "<pose>", index: -1, message: `pose length ${pose.length} does not match skeleton ${skeleton.joints.length}` });
    return issues;
  }
  for (let index = 0; index < pose.length; index += 1) {
    if (!isFiniteTransform(pose[index]!)) {
      issues.push({ joint: skeleton.joints[index]!.name, index, message: "transform is not finite or quaternion is invalid" });
    }
  }
  return issues;
}

export function createJointMask(skeleton: Skeleton, defaultWeight = 0, entries: Record<string, number> = {}): JointMask {
  const mask = new Float32Array(skeleton.joints.length);
  mask.fill(defaultWeight);
  for (const [jointName, weight] of Object.entries(entries)) {
    const index = skeleton.nameToIndex.get(jointName) ?? skeleton.humanoid.get(jointName as never);
    if (index !== undefined) mask[index] = weight;
  }
  return mask;
}

export function blendPoses(skeleton: Skeleton, layers: Array<{ pose: readonly Transform[]; weight: number; mask?: JointMask }>): Pose {
  const output = createRestPose(skeleton);
  const totalWeights = new Float32Array(skeleton.joints.length);

  for (const layer of layers) {
    if (layer.weight <= 0) continue;
    for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
      const maskedWeight = layer.weight * (layer.mask?.[joint] ?? 1);
      if (maskedWeight <= 0) continue;
      const previous = totalWeights[joint]!;
      const nextTotal = previous + maskedWeight;
      const blend = maskedWeight / nextTotal;
      output[joint] = lerpTransform(output[joint]!, layer.pose[joint]!, blend);
      totalWeights[joint] = nextTotal;
    }
  }

  return normalizePose(output);
}

export function additiveDeltaPose(restPose: readonly Transform[], samplePose: readonly Transform[]): Pose {
  if (restPose.length !== samplePose.length) throw new Error("additive delta pose length mismatch");
  return restPose.map((rest, index) => transformDelta(rest, samplePose[index]!));
}

export function applyAdditivePose(base: readonly Transform[], deltaPose: readonly Transform[], weight: number, mask?: JointMask): Pose {
  if (base.length !== deltaPose.length) throw new Error("additive pose length mismatch");
  return base.map((transform, index) => applyTransformDelta(transform, deltaPose[index]!, weight * (mask?.[index] ?? 1)));
}

