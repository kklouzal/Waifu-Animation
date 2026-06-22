import {
  type Quat,
  type Transform,
  applyTransformDelta,
  cloneTransformList,
  cloneTransform,
  dotQuat,
  finiteNonNegative,
  isFiniteTransform,
  normalizeQuat,
  normalizeTransform,
  transformDelta
} from "./math.js";
import { type Skeleton, createRestPose, resolveJointIndex } from "./skeleton.js";

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

export function clonePose(pose: readonly Transform[]): Pose {
  return cloneTransformList(pose);
}

export function normalizePose(pose: readonly Transform[]): Pose {
  return pose.map((transform) => normalizeTransform(transform));
}

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
    if (!isFiniteTransform(pose[index]!)) {
      issues.push({
        joint: skeleton.joints[index]!.name,
        index,
        message: "transform is not finite or quaternion is invalid"
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

function readMaskWeight(mask: JointMask | undefined, joint: number): number {
  if (!mask) return 1;
  if (joint < 0 || joint >= mask.length) return 0;
  const value = mask[joint]!;
  return finiteNonNegative(value, 0);
}

export function blendPoses(skeleton: Skeleton, layers: PoseLayer[], options: BlendPoseOptions = {}): Pose {
  const fallbackPose = options.fallbackPose ?? skeleton.restPose;
  const jointCount = skeleton.joints.length;
  const output = createRestPose(skeleton);
  const totalWeights = new Float32Array(jointCount);
  const rotationSums: Quat[] = Array.from({ length: jointCount }, () => [0, 0, 0, 0] as Quat);
  const translationSums = Array.from({ length: jointCount }, () => [0, 0, 0] as [number, number, number]);
  const scaleSums = Array.from({ length: jointCount }, () => [0, 0, 0] as [number, number, number]);
  let hasAnyLayer = false;

  for (const layer of layers) {
    const layerWeight = finiteNonNegative(layer.weight, 0);
    if (layerWeight <= 0) continue;
    hasAnyLayer = true;
    for (let joint = 0; joint < jointCount; joint += 1) {
      const poseTransform = layer.pose[joint];
      if (!poseTransform) continue;
      if (!isFiniteTransform(poseTransform)) continue;
      const maskWeight = readMaskWeight(layer.mask, joint);
      const weight = layerWeight * maskWeight;
      if (weight <= 0) continue;
      accumulateTransform(rotationSums[joint]!, translationSums[joint]!, scaleSums[joint]!, poseTransform, weight);
      totalWeights[joint] = (totalWeights[joint] ?? 0) + weight;
    }
  }

  const threshold = sanitizeBlendThreshold(options.threshold);
  for (let joint = 0; joint < jointCount; joint += 1) {
    const accumulated = totalWeights[joint]!;
    const fallbackTransform = readPoseTransformOrRest(skeleton, fallbackPose, joint);
    if (threshold > 0 && (!hasAnyLayer || accumulated < threshold)) {
      const restWeight = !hasAnyLayer ? 1 : threshold - accumulated;
      if (restWeight > 0) {
        accumulateTransform(
          rotationSums[joint]!,
          translationSums[joint]!,
          scaleSums[joint]!,
          fallbackTransform,
          restWeight
        );
        totalWeights[joint] = (totalWeights[joint] ?? 0) + restWeight;
      }
    }

    const total = totalWeights[joint]!;
    if (total <= 0) {
      output[joint] = cloneTransform(fallbackTransform);
      continue;
    }
    const invTotal = 1 / total;
    output[joint] = normalizeTransform({
      translation: [
        translationSums[joint]![0] * invTotal,
        translationSums[joint]![1] * invTotal,
        translationSums[joint]![2] * invTotal
      ],
      rotation: normalizeQuat(rotationSums[joint]!, fallbackTransform.rotation),
      scale: [scaleSums[joint]![0] * invTotal, scaleSums[joint]![1] * invTotal, scaleSums[joint]![2] * invTotal]
    });
  }

  return output;
}

function accumulateTransform(
  rotationSum: Quat,
  translationSum: [number, number, number],
  scaleSum: [number, number, number],
  transform: Transform,
  weight: number
): void {
  const hasExistingRotation =
    Math.abs(rotationSum[0]) + Math.abs(rotationSum[1]) + Math.abs(rotationSum[2]) + Math.abs(rotationSum[3]) > 0;
  const reference = hasExistingRotation ? normalizeQuat(rotationSum, transform.rotation) : transform.rotation;
  const rotation =
    dotQuat(reference, transform.rotation) < 0
      ? ([-transform.rotation[0], -transform.rotation[1], -transform.rotation[2], -transform.rotation[3]] as Quat)
      : transform.rotation;
  translationSum[0] += transform.translation[0] * weight;
  translationSum[1] += transform.translation[1] * weight;
  translationSum[2] += transform.translation[2] * weight;
  rotationSum[0] += rotation[0] * weight;
  rotationSum[1] += rotation[1] * weight;
  rotationSum[2] += rotation[2] * weight;
  rotationSum[3] += rotation[3] * weight;
  scaleSum[0] += transform.scale[0] * weight;
  scaleSum[1] += transform.scale[1] * weight;
  scaleSum[2] += transform.scale[2] * weight;
}

export function additiveDeltaPose(restPose: readonly Transform[], samplePose: readonly Transform[]): Pose {
  if (samplePose.length > restPose.length) throw new Error("additive delta pose length mismatch");
  return restPose.map((rest, index) => transformDelta(rest, samplePose[index] ?? rest));
}

export function applyAdditivePose(
  base: readonly Transform[],
  deltaPose: readonly Transform[],
  weight: number,
  mask?: JointMask
): Pose {
  if (base.length !== deltaPose.length) throw new Error("additive pose length mismatch");
  const layerWeight = Number.isFinite(weight) ? weight : 0;
  return base.map((transform, index) => {
    const baseTransform = cloneTransform(transform);
    const delta = deltaPose[index];
    if (!delta || !isFiniteTransform(delta)) return baseTransform;
    return applyTransformDelta(baseTransform, delta, layerWeight * readMaskWeight(mask, index));
  });
}
