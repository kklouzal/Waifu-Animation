import { type Transform, finiteNonNegative, isFiniteTransform } from "./math.js";
import { type Skeleton, resolveJointIndex } from "./skeleton.js";

export type Pose = Transform[];
export type JointMask = Float32Array;

export type BlendPoseOptions = {
  /**
   * Ozz-style bind/rest pose fallback threshold. When accumulated override
   * weight for a joint is below this value, missing weight is supplied by the
   * rest pose before normalization. This prevents weak layers from fully owning
   * a joint and matches Ozz's bind-pose fallback semantics.
   */
  threshold?: number;
  /** Pose used to supply missing per-joint weight below the threshold. */
  fallbackPose?: readonly Transform[];
};

export type PoseLayer = { pose: readonly Transform[]; weight: number; mask?: JointMask };

export type SubtreeJointMaskOptions = {
  /** Weight assigned to joints outside the selected subtrees. */
  defaultWeight?: number;
  /** Weight assigned to each selected root and all descendants. */
  weight?: number;
};

export const DEFAULT_BLEND_THRESHOLD = 0.1;

export function sanitizeBlendThreshold(value: number | undefined, fallback = DEFAULT_BLEND_THRESHOLD): number {
  return finiteNonNegative(value, fallback);
}

export type PoseValidationIssue = {
  joint: string;
  index: number;
  message: string;
};

export type JointMaskValidationIssue = {
  joint: string;
  index: number;
  message: string;
};

export function validatePose(skeleton: Skeleton, pose: readonly Transform[]): PoseValidationIssue[] {
  const issues: PoseValidationIssue[] = [];
  if (pose.length !== skeleton.joints.length) {
    issues.push({
      joint: "<pose>",
      index: -1,
      message: `pose length ${pose.length} does not match skeleton ${skeleton.joints.length}`
    });
    return issues;
  }
  for (let index = 0; index < pose.length; index += 1) {
    const transform = pose[index];
    if (!transform || !isFiniteTransform(transform)) {
      issues.push({
        joint: skeleton.joints[index]!.name,
        index,
        message: "transform is not finite or quaternion is invalid"
      });
    }
  }
  return issues;
}

export function validateJointMask(skeleton: Skeleton, mask: JointMask): JointMaskValidationIssue[] {
  const issues: JointMaskValidationIssue[] = [];
  if (mask.length !== skeleton.joints.length) {
    const lengthDetail =
      mask.length < skeleton.joints.length
        ? "missing joints will be treated as zero"
        : "extra joint weights will be ignored";
    issues.push({
      joint: "<mask>",
      index: -1,
      message: `mask length ${mask.length} does not match skeleton ${skeleton.joints.length}; ${lengthDetail}`
    });
  }
  const jointCount = Math.min(mask.length, skeleton.joints.length);
  for (let index = 0; index < jointCount; index += 1) {
    const value = mask[index]!;
    if (!Number.isFinite(value) || value < 0) {
      issues.push({
        joint: skeleton.joints[index]!.name,
        index,
        message: "mask weight is negative or non-finite and will be treated as zero"
      });
    }
  }
  return issues;
}

export function readPoseTransformOrRest(skeleton: Skeleton, pose: readonly Transform[], joint: number): Transform {
  const transform = pose[joint];
  return transform && isFiniteTransform(transform) ? transform : skeleton.restPose[joint]!;
}

export function createJointMask(
  skeleton: Skeleton,
  defaultWeight = 0,
  entries: Record<string, number> = {}
): JointMask {
  const mask = new Float32Array(skeleton.joints.length);
  mask.fill(finiteNonNegative(defaultWeight, 0));
  for (const [jointName, weight] of Object.entries(entries)) {
    const index = skeleton.nameToIndex.get(jointName) ?? skeleton.humanoid.get(jointName as never);
    if (index !== undefined) mask[index] = finiteNonNegative(weight, 0);
  }
  return mask;
}

export function createSubtreeJointMask(
  skeleton: Skeleton,
  roots: string | readonly string[],
  options: SubtreeJointMaskOptions = {}
): JointMask {
  const defaultWeight = finiteNonNegative(options.defaultWeight, 0);
  const subtreeWeight = finiteNonNegative(options.weight, 1);
  const mask = new Float32Array(skeleton.joints.length);
  mask.fill(defaultWeight);

  const rootNames = typeof roots === "string" ? [roots] : roots;
  const rootIndices = new Set<number>();
  for (const root of rootNames) {
    const index = resolveJointIndex(skeleton, root);
    if (index >= 0) rootIndices.add(index);
  }
  if (rootIndices.size === 0) return mask;

  const selected = new Uint8Array(skeleton.joints.length);
  for (let joint = 0; joint < skeleton.joints.length; joint += 1) {
    const parent = skeleton.parents[joint] ?? skeleton.joints[joint]!.parentIndex;
    if (rootIndices.has(joint) || (parent >= 0 && selected[parent] === 1)) {
      selected[joint] = 1;
      mask[joint] = subtreeWeight;
    }
  }
  return mask;
}
