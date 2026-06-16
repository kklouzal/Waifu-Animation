import { type Mat4, type Transform, cloneTransform, composeMat4, multiplyMat4 } from "./math.js";
import { type Skeleton, resolveJointIndex } from "./skeleton.js";

export type AttachmentJointTarget = number | string;
export type AttachmentOffset = Partial<Transform> | Mat4;

export type AttachmentTransformInput = {
  modelPose: readonly Mat4[];
  jointIndex: number;
  offset?: AttachmentOffset | undefined;
};

export type SkeletonAttachmentTransformInput = Omit<AttachmentTransformInput, "jointIndex"> & {
  skeleton: Skeleton;
  joint: AttachmentJointTarget;
};

export function resolveAttachmentJointIndex(skeleton: Skeleton, joint: AttachmentJointTarget): number {
  if (typeof joint === "number") {
    if (!Number.isInteger(joint) || joint < 0 || joint >= skeleton.joints.length) {
      throw new Error(`attachment joint index ${joint} is out of range`);
    }
    return joint;
  }

  const index = resolveJointIndex(skeleton, joint);
  if (index < 0) throw new Error(`attachment joint ${joint} was not found`);
  return index;
}

export function attachmentOffsetMatrix(offset: AttachmentOffset | undefined): Mat4 {
  if (offset instanceof Float32Array) return cloneFiniteMat4(offset, "attachment offset matrix");
  return composeMat4(cloneTransform(offset));
}

export function computeAttachmentTransform(input: AttachmentTransformInput): Mat4 {
  if (!Number.isInteger(input.jointIndex) || input.jointIndex < 0 || input.jointIndex >= input.modelPose.length) {
    throw new Error(`attachment joint index ${input.jointIndex} is out of range`);
  }
  const jointModel = input.modelPose[input.jointIndex];
  if (!jointModel) throw new Error(`attachment joint index ${input.jointIndex} has no model matrix`);
  return multiplyMat4(cloneFiniteMat4(jointModel, `attachment joint ${input.jointIndex} model matrix`), attachmentOffsetMatrix(input.offset));
}

export function computeSkeletonAttachmentTransform(input: SkeletonAttachmentTransformInput): Mat4 {
  return computeAttachmentTransform({
    modelPose: input.modelPose,
    jointIndex: resolveAttachmentJointIndex(input.skeleton, input.joint),
    offset: input.offset
  });
}

function cloneFiniteMat4(matrix: Mat4, label: string): Mat4 {
  if (matrix.length !== 16) throw new Error(`${label} must contain 16 values`);
  if (!Array.from(matrix).every(Number.isFinite)) throw new Error(`${label} values must be finite`);
  return new Float32Array(matrix);
}
