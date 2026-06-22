import { type Mat4, type Transform, cloneTransform, composeMat4, multiplyMat4 } from "./math.js";
import { type HumanoidBoneName, type Skeleton, resolveJointIndex } from "./skeleton.js";

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

export type AttachmentBindingInput = {
  skeleton: Skeleton;
  joint: AttachmentJointTarget;
  offset?: AttachmentOffset | undefined;
  id?: string | undefined;
};

export type AttachmentBindingDefinition = Omit<AttachmentBindingInput, "skeleton">;

export type AttachmentBinding = {
  readonly jointIndex: number;
  readonly joint: AttachmentJointTarget;
  readonly offsetMatrix: Mat4;
  readonly id?: string;
  readonly jointName?: string;
  readonly humanoid?: HumanoidBoneName;
};

export type BoundAttachmentTransformInput = {
  modelPose: readonly Mat4[];
  binding: AttachmentBinding;
};

export type BoundAttachmentTransformsInput = {
  modelPose: readonly Mat4[];
  bindings: readonly AttachmentBinding[];
};

export type BoundAttachmentTransform = {
  readonly jointIndex: number;
  readonly transform: Mat4;
  readonly id?: string;
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

export function createAttachmentBinding(input: AttachmentBindingInput): AttachmentBinding {
  const jointIndex = resolveAttachmentJointIndex(input.skeleton, input.joint);
  const joint = input.skeleton.joints[jointIndex];
  if (!joint) throw new Error(`attachment joint index ${jointIndex} has no skeleton joint`);
  const binding: AttachmentBinding = {
    jointIndex,
    joint: input.joint,
    offsetMatrix: attachmentOffsetMatrix(input.offset),
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(joint.name ? { jointName: joint.name } : {}),
    ...(joint.humanoid !== undefined ? { humanoid: joint.humanoid } : {})
  };
  return binding;
}

export function createAttachmentBindings(
  skeleton: Skeleton,
  attachments: readonly AttachmentBindingDefinition[]
): AttachmentBinding[];
export function createAttachmentBindings(inputs: readonly AttachmentBindingInput[]): AttachmentBinding[];
export function createAttachmentBindings(
  skeletonOrInputs: Skeleton | readonly AttachmentBindingInput[],
  attachments?: readonly AttachmentBindingDefinition[]
): AttachmentBinding[] {
  if (attachments !== undefined) {
    return attachments.map((attachment) =>
      createAttachmentBinding({ skeleton: skeletonOrInputs as Skeleton, ...attachment })
    );
  }
  return (skeletonOrInputs as readonly AttachmentBindingInput[]).map((input) => createAttachmentBinding(input));
}

export function computeAttachmentTransform(input: AttachmentTransformInput): Mat4 {
  if (!Number.isInteger(input.jointIndex) || input.jointIndex < 0 || input.jointIndex >= input.modelPose.length) {
    throw new Error(`attachment joint index ${input.jointIndex} is out of range`);
  }
  const jointModel = input.modelPose[input.jointIndex];
  if (!jointModel) throw new Error(`attachment joint index ${input.jointIndex} has no model matrix`);
  return multiplyMat4(
    cloneFiniteMat4(jointModel, `attachment joint ${input.jointIndex} model matrix`),
    attachmentOffsetMatrix(input.offset)
  );
}

export function computeSkeletonAttachmentTransform(input: SkeletonAttachmentTransformInput): Mat4 {
  return computeAttachmentTransform({
    modelPose: input.modelPose,
    jointIndex: resolveAttachmentJointIndex(input.skeleton, input.joint),
    offset: input.offset
  });
}

export function computeBoundAttachmentTransform(input: BoundAttachmentTransformInput): Mat4 {
  const jointIndex = input.binding.jointIndex;
  if (!Number.isInteger(jointIndex) || jointIndex < 0 || jointIndex >= input.modelPose.length) {
    throw new Error(`attachment binding joint index ${jointIndex} is out of range`);
  }
  const jointModel = input.modelPose[jointIndex];
  if (!jointModel) throw new Error(`attachment binding joint index ${jointIndex} has no model matrix`);
  return multiplyMat4(
    cloneFiniteMat4(jointModel, `attachment binding joint ${jointIndex} model matrix`),
    cloneFiniteMat4(input.binding.offsetMatrix, `attachment binding joint ${jointIndex} offset matrix`)
  );
}

export function computeBoundAttachmentTransforms(input: BoundAttachmentTransformsInput): BoundAttachmentTransform[] {
  return input.bindings.map((binding) => {
    const result: BoundAttachmentTransform = {
      jointIndex: binding.jointIndex,
      transform: computeBoundAttachmentTransform({ modelPose: input.modelPose, binding }),
      ...(binding.id !== undefined ? { id: binding.id } : {})
    };
    return result;
  });
}

function cloneFiniteMat4(matrix: Mat4, label: string): Mat4 {
  if (matrix.length !== 16) throw new Error(`${label} must contain 16 values`);
  if (!Array.from(matrix).every(Number.isFinite)) throw new Error(`${label} values must be finite`);
  return new Float32Array(matrix);
}
