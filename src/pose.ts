import {
  type Quat,
  type Transform,
  applyTransformDelta,
  cloneTransform,
  dotQuat,
  isFiniteTransform,
  normalizeQuat,
  normalizeTransform,
  transformDelta
} from "./math.js";
import { type Skeleton, createRestPose } from "./skeleton.js";

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

function sanitizeMaskWeight(weight: number): number {
  return Number.isFinite(weight) ? Math.max(0, weight) : 0;
}

export function createJointMask(skeleton: Skeleton, defaultWeight = 0, entries: Record<string, number> = {}): JointMask {
  const mask = new Float32Array(skeleton.joints.length);
  mask.fill(sanitizeMaskWeight(defaultWeight));
  for (const [jointName, weight] of Object.entries(entries)) {
    const index = skeleton.nameToIndex.get(jointName) ?? skeleton.humanoid.get(jointName as never);
    if (index !== undefined) mask[index] = sanitizeMaskWeight(weight);
  }
  return mask;
}

function readMaskWeight(mask: JointMask | undefined, joint: number): number {
  if (!mask) return 1;
  if (joint < 0 || joint >= mask.length) return 0;
  const value = mask[joint]!;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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
    const layerWeight = Number.isFinite(layer.weight) ? Math.max(0, layer.weight) : 0;
    if (layerWeight <= 0) continue;
    hasAnyLayer = true;
    for (let joint = 0; joint < jointCount; joint += 1) {
      const poseTransform = layer.pose[joint];
      if (!poseTransform) continue;
      const maskWeight = readMaskWeight(layer.mask, joint);
      const weight = layerWeight * maskWeight;
      if (weight <= 0) continue;
      accumulateTransform(rotationSums[joint]!, translationSums[joint]!, scaleSums[joint]!, poseTransform, weight);
      totalWeights[joint] = (totalWeights[joint] ?? 0) + weight;
    }
  }

  const threshold = Math.max(0, options.threshold ?? DEFAULT_BLEND_THRESHOLD);
  for (let joint = 0; joint < jointCount; joint += 1) {
    const accumulated = totalWeights[joint]!;
    if (threshold > 0 && (!hasAnyLayer || accumulated < threshold)) {
      const restWeight = !hasAnyLayer ? 1 : threshold - accumulated;
      if (restWeight > 0) {
        accumulateTransform(rotationSums[joint]!, translationSums[joint]!, scaleSums[joint]!, readFallbackTransform(skeleton, fallbackPose, joint), restWeight);
        totalWeights[joint] = (totalWeights[joint] ?? 0) + restWeight;
      }
    }

    const total = totalWeights[joint]!;
    if (total <= 0) {
      output[joint] = cloneTransform(readFallbackTransform(skeleton, fallbackPose, joint));
      continue;
    }
    const invTotal = 1 / total;
    const fallbackTransform = readFallbackTransform(skeleton, fallbackPose, joint);
    output[joint] = normalizeTransform({
      translation: [translationSums[joint]![0] * invTotal, translationSums[joint]![1] * invTotal, translationSums[joint]![2] * invTotal],
      rotation: normalizeQuat(rotationSums[joint]!, fallbackTransform.rotation),
      scale: [scaleSums[joint]![0] * invTotal, scaleSums[joint]![1] * invTotal, scaleSums[joint]![2] * invTotal]
    });
  }

  return output;
}

function readFallbackTransform(skeleton: Skeleton, fallbackPose: readonly Transform[], joint: number): Transform {
  return fallbackPose[joint] ?? skeleton.restPose[joint]!;
}

function accumulateTransform(rotationSum: Quat, translationSum: [number, number, number], scaleSum: [number, number, number], transform: Transform, weight: number): void {
  const hasExistingRotation = Math.abs(rotationSum[0]) + Math.abs(rotationSum[1]) + Math.abs(rotationSum[2]) + Math.abs(rotationSum[3]) > 0;
  const reference = hasExistingRotation ? normalizeQuat(rotationSum, transform.rotation) : transform.rotation;
  const rotation = dotQuat(reference, transform.rotation) < 0 ? ([-transform.rotation[0], -transform.rotation[1], -transform.rotation[2], -transform.rotation[3]] as Quat) : transform.rotation;
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

export function applyAdditivePose(base: readonly Transform[], deltaPose: readonly Transform[], weight: number, mask?: JointMask): Pose {
  if (base.length !== deltaPose.length) throw new Error("additive pose length mismatch");
  const layerWeight = Number.isFinite(weight) ? weight : 0;
  return base.map((transform, index) => applyTransformDelta(transform, deltaPose[index]!, layerWeight * readMaskWeight(mask, index)));
}
