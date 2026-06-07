import {
  type Mat4,
  type Transform,
  cloneTransform,
  composeMat4,
  identityTransform,
  isFiniteTransform,
  multiplyMat4,
  normalizeTransform
} from "./math.js";

export const NO_PARENT = -1;

export const VRM_HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal"
] as const;

export type HumanoidBoneName = (typeof VRM_HUMANOID_BONES)[number];

export type JointDefinition = {
  name: string;
  parentIndex?: number;
  parentName?: string;
  rest?: Partial<Transform>;
  humanoid?: HumanoidBoneName;
};

export type SkeletonJoint = {
  name: string;
  parentIndex: number;
  rest: Transform;
  humanoid?: HumanoidBoneName;
};

export type Skeleton = {
  joints: SkeletonJoint[];
  parents: Int16Array;
  restPose: Transform[];
  nameToIndex: ReadonlyMap<string, number>;
  humanoid: ReadonlyMap<HumanoidBoneName, number>;
};

export type SkeletonValidationIssue = {
  joint?: string;
  index?: number;
  message: string;
};

export function createSkeleton(definitions: JointDefinition[]): Skeleton {
  if (definitions.length === 0) throw new Error("skeleton requires at least one joint");
  if (definitions.length > 1024) throw new Error("skeleton exceeds Ozz-style 1024 joint safety limit");

  const nameToIndex = new Map<string, number>();
  for (const [index, joint] of definitions.entries()) {
    if (!joint.name) throw new Error(`joint ${index} is missing a name`);
    if (nameToIndex.has(joint.name)) throw new Error(`duplicate joint name ${joint.name}`);
    nameToIndex.set(joint.name, index);
  }

  const humanoid = new Map<HumanoidBoneName, number>();
  const joints = definitions.map((joint, index): SkeletonJoint => {
    const parentIndex = resolveParentIndex(joint, index, nameToIndex);
    if (parentIndex >= index) throw new Error(`joint ${joint.name} parent must appear before child`);
    if (joint.humanoid) humanoid.set(joint.humanoid, index);
    return {
      name: joint.name,
      parentIndex,
      rest: normalizeTransform(cloneTransform(joint.rest ?? identityTransform())),
      ...(joint.humanoid ? { humanoid: joint.humanoid } : {})
    };
  });

  return {
    joints,
    parents: Int16Array.from(joints.map((joint) => joint.parentIndex)),
    restPose: joints.map((joint) => cloneTransform(joint.rest)),
    nameToIndex,
    humanoid
  };
}

function resolveParentIndex(joint: JointDefinition, index: number, nameToIndex: ReadonlyMap<string, number>): number {
  if (typeof joint.parentIndex === "number") return joint.parentIndex;
  if (joint.parentName) {
    const parentIndex = nameToIndex.get(joint.parentName);
    if (parentIndex === undefined) throw new Error(`joint ${joint.name} parent ${joint.parentName} was not found`);
    return parentIndex;
  }
  return index === 0 ? NO_PARENT : 0;
}

export function validateSkeleton(skeleton: Skeleton): SkeletonValidationIssue[] {
  const issues: SkeletonValidationIssue[] = [];
  if (skeleton.joints.length === 0) issues.push({ message: "skeleton has no joints" });
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const joint = skeleton.joints[index]!;
    if (!joint.name) issues.push({ index, message: "joint has no name" });
    if (joint.parentIndex >= index) issues.push({ index, joint: joint.name, message: "parent index must be before child" });
    if (joint.parentIndex < NO_PARENT) issues.push({ index, joint: joint.name, message: "parent index is invalid" });
    if (!isFiniteTransform(joint.rest)) issues.push({ index, joint: joint.name, message: "rest transform is invalid" });
  }
  return issues;
}

export function createRestPose(skeleton: Skeleton): Transform[] {
  return skeleton.restPose.map((transform) => cloneTransform(transform));
}

export function resolveJointIndex(skeleton: Skeleton, nameOrHumanoid: string): number {
  const direct = skeleton.nameToIndex.get(nameOrHumanoid);
  if (direct !== undefined) return direct;
  return skeleton.humanoid.get(nameOrHumanoid as HumanoidBoneName) ?? -1;
}

export function resolveHumanoidIndex(skeleton: Skeleton, bone: HumanoidBoneName): number {
  return skeleton.humanoid.get(bone) ?? -1;
}

export function localToModelPose(skeleton: Skeleton, localPose: readonly Transform[], out: Mat4[] = []): Mat4[] {
  if (localPose.length !== skeleton.joints.length) {
    throw new Error(`local pose length ${localPose.length} does not match skeleton ${skeleton.joints.length}`);
  }
  out.length = skeleton.joints.length;
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const local = composeMat4(localPose[index]!);
    const parentIndex = skeleton.joints[index]!.parentIndex;
    out[index] = parentIndex === NO_PARENT ? local : multiplyMat4(out[parentIndex]!, local);
  }
  return out;
}

