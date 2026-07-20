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
  const skeletonIssues = canInspectSkeletonStructure(skeleton)
    ? validateSkeleton(skeleton)
    : [{ message: "skeleton must include joints, parents, and restPose arrays" }];
  const clipIssues = validateClip(clip, canUseSkeletonForClipValidation(skeleton) ? skeleton : undefined);
  const poseIssues = canUseSkeletonForPoseValidation(skeleton) ? validatePose(skeleton, skeleton.restPose) : [];
  return {
    accepted: skeletonIssues.length === 0 && clipIssues.length === 0 && poseIssues.length === 0,
    skeletonIssues,
    clipIssues,
    poseIssues
  };
}

function canUseSkeletonForClipValidation(skeleton: Skeleton): boolean {
  return (
    canInspectSkeletonStructure(skeleton) && skeleton.nameToIndex instanceof Map && skeleton.humanoid instanceof Map
  );
}

function canUseSkeletonForPoseValidation(skeleton: Skeleton): boolean {
  return canInspectSkeletonStructure(skeleton);
}

function canInspectSkeletonStructure(skeleton: Skeleton): skeleton is Skeleton {
  return (
    typeof skeleton === "object" &&
    skeleton !== null &&
    Array.isArray(skeleton.joints) &&
    skeleton.parents instanceof Int16Array &&
    Array.isArray(skeleton.restPose)
  );
}
