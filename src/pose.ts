import {
  type Transform,
  applyTransformDelta,
  clamp01,
  cloneTransform,
  isFiniteTransform,
  lerpTransform,
  normalizeTransform,
  transformDelta
} from "./math.js";
import { type Skeleton, createRestPose } from "./skeleton.js";

export type Pose = Transform[];
export type JointMask = Float32Array;

export type BlendPoseOptions = {
  /**
   * Ozz-style bind/rest pose fallback threshold. When accumulated override
   * weight for a joint is below this value, the blended result is mixed back
   * toward rest pose instead of allowing a tiny-weight layer to fully own the
   * joint. Set to 0 to disable threshold fallback.
   */
  threshold?: number;
};

export const DEFAULT_BLEND_THRESHOLD = 0.1;

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
    if (index !== undefined) mask[index] = clamp01(weight);
  }
  return mask;
}

export function blendPoses(
  skeleton: Skeleton,
  layers: Array<{ pose: readonly Transform[]; weight: number; mask?: JointMask }>,
  options: BlendPoseOptions = {}
): Pose {
  const restPose = skeleton.restPose;
  const output = createRestPose(skeleton);
  const totalWeights = new Float32Array(skeleton.joints.length);

  for (const layer of layers) {
    const layerWeight = Number.isFinite(layer.weight) ? Math.max(0, layer.weight) : 0;
    if (layerWeight <= 0) continue;
    for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
      const maskWeight = clamp01(layer.mask?.[joint] ?? 1);
      const maskedWeight = layerWeight * maskWeight;
      if (maskedWeight <= 0) continue;
      const previous = totalWeights[joint]!;
      const nextTotal = previous + maskedWeight;
      const blend = maskedWeight / nextTotal;
      output[joint] = lerpTransform(output[joint]!, layer.pose[joint]!, blend);
      totalWeights[joint] = nextTotal;
    }
  }

  const threshold = Math.max(0, options.threshold ?? DEFAULT_BLEND_THRESHOLD);
  if (threshold > 0) {
    for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
      const accumulated = totalWeights[joint]!;
      if (accumulated <= 0) {
        output[joint] = cloneTransform(restPose[joint]);
      } else if (accumulated < threshold) {
        output[joint] = lerpTransform(restPose[joint]!, output[joint]!, accumulated / threshold);
      }
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

