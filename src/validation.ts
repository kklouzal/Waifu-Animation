import { type AnimationClip, type ClipValidationIssue, validateClip } from "./clip.js";
import { type PoseValidationIssue, validatePose } from "./pose.js";
import { type Skeleton, type SkeletonValidationIssue, validateSkeleton } from "./skeleton.js";

export type AnimationValidationReport = {
  accepted: boolean;
  skeletonIssues: SkeletonValidationIssue[];
  clipIssues: ClipValidationIssue[];
  poseIssues: PoseValidationIssue[];
};

export function validateAnimationInputs(skeleton: Skeleton, clip: AnimationClip): AnimationValidationReport {
  const skeletonIssues = validateSkeleton(skeleton);
  const clipIssues = validateClip(clip, skeleton);
  return {
    accepted: skeletonIssues.length === 0 && clipIssues.length === 0,
    skeletonIssues,
    clipIssues,
    poseIssues: validatePose(skeleton, skeleton.restPose)
  };
}

