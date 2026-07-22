import {
  type Mat4,
  type Transform,
  cloneTransformList,
  cloneTransform,
  composeMat4,
  isFiniteTransform,
  multiplyMat4,
  numericArraysEqual
} from "./math.js";

export const NO_PARENT = -1;
const OZZ_MAX_JOINTS = 1024;

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
export type HumanoidBoneNameLike = HumanoidBoneName | (string & {});

const VRM_HUMANOID_BONE_SET = new Set<unknown>(VRM_HUMANOID_BONES);

export function isHumanoidBoneName(value: unknown): value is HumanoidBoneName {
  return VRM_HUMANOID_BONE_SET.has(value);
}

const VRM_HUMANOID_ANCESTOR_RULES: readonly [child: HumanoidBoneName, ancestor: HumanoidBoneName][] = [
  ["spine", "hips"],
  ["chest", "spine"],
  ["upperChest", "chest"],
  ["neck", "spine"],
  ["head", "spine"],
  ["head", "neck"],
  ["leftEye", "head"],
  ["rightEye", "head"],
  ["jaw", "head"],
  ["leftShoulder", "spine"],
  ["leftUpperArm", "spine"],
  ["leftUpperArm", "leftShoulder"],
  ["leftLowerArm", "leftUpperArm"],
  ["leftHand", "leftLowerArm"],
  ["rightShoulder", "spine"],
  ["rightUpperArm", "spine"],
  ["rightUpperArm", "rightShoulder"],
  ["rightLowerArm", "rightUpperArm"],
  ["rightHand", "rightLowerArm"],
  ["leftUpperLeg", "hips"],
  ["leftLowerLeg", "leftUpperLeg"],
  ["leftFoot", "leftLowerLeg"],
  ["leftToes", "leftFoot"],
  ["rightUpperLeg", "hips"],
  ["rightLowerLeg", "rightUpperLeg"],
  ["rightFoot", "rightLowerLeg"],
  ["rightToes", "rightFoot"],
  ["leftThumbMetacarpal", "leftHand"],
  ["leftThumbProximal", "leftThumbMetacarpal"],
  ["leftThumbDistal", "leftThumbProximal"],
  ["leftIndexProximal", "leftHand"],
  ["leftIndexIntermediate", "leftIndexProximal"],
  ["leftIndexDistal", "leftIndexIntermediate"],
  ["leftMiddleProximal", "leftHand"],
  ["leftMiddleIntermediate", "leftMiddleProximal"],
  ["leftMiddleDistal", "leftMiddleIntermediate"],
  ["leftRingProximal", "leftHand"],
  ["leftRingIntermediate", "leftRingProximal"],
  ["leftRingDistal", "leftRingIntermediate"],
  ["leftLittleProximal", "leftHand"],
  ["leftLittleIntermediate", "leftLittleProximal"],
  ["leftLittleDistal", "leftLittleIntermediate"],
  ["rightThumbMetacarpal", "rightHand"],
  ["rightThumbProximal", "rightThumbMetacarpal"],
  ["rightThumbDistal", "rightThumbProximal"],
  ["rightIndexProximal", "rightHand"],
  ["rightIndexIntermediate", "rightIndexProximal"],
  ["rightIndexDistal", "rightIndexIntermediate"],
  ["rightMiddleProximal", "rightHand"],
  ["rightMiddleIntermediate", "rightMiddleProximal"],
  ["rightMiddleDistal", "rightMiddleIntermediate"],
  ["rightRingProximal", "rightHand"],
  ["rightRingIntermediate", "rightRingProximal"],
  ["rightRingDistal", "rightRingIntermediate"],
  ["rightLittleProximal", "rightHand"],
  ["rightLittleIntermediate", "rightLittleProximal"],
  ["rightLittleDistal", "rightLittleIntermediate"]
];

export type JointDefinition = {
  name: string;
  parentIndex?: number;
  parentName?: string;
  rest?: Partial<Transform>;
  humanoid?: HumanoidBoneName;
};

export type RawSkeletonJointDefinition = {
  name: string;
  rest?: Partial<Transform>;
  humanoid?: HumanoidBoneName;
  children?: readonly RawSkeletonJointDefinition[];
};

export type RawSkeletonJoint = {
  name: string;
  rest?: Partial<Transform>;
  humanoid?: HumanoidBoneName;
  children: RawSkeletonJoint[];
};

export type RawSkeleton = {
  roots: RawSkeletonJoint[];
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

export type RawSkeletonValidationIssue = {
  joint?: string;
  index?: number;
  path?: string;
  message: string;
};

export type LocalToModelPoseKernel = {
  tryUpdateLocalToModelPoseRange(
    skeleton: Skeleton,
    localPose: readonly Transform[],
    out: Mat4[],
    options?: Omit<LocalToModelPoseRangeOptions, "kernel">
  ): Mat4[] | undefined;
};

export type LocalToModelPoseRangeOptions = {
  /** Optional root/model matrix multiplied before root joints, matching Ozz LocalToModelJob::root. */
  root?: Mat4;
  /** First joint to update, or NO_PARENT/the default to update the whole hierarchy. */
  from?: number;
  /** Last joint index to update, inclusive. Defaults to the final skeleton joint. */
  to?: number;
  /** When true, keeps the `from` joint model matrix as-is and updates only its descendants. */
  fromExcluded?: boolean;
  /** Optional retained local-to-model context. If supplied, failure is explicit; this never falls back to TypeScript. */
  kernel?: LocalToModelPoseKernel;
};

export type JointReference = number | string;

export type SkeletonJointTraversalItem = {
  index: number;
  parentIndex: number;
  joint: SkeletonJoint;
};

export type RawSkeletonJointTraversalItem = {
  index: number;
  depth: number;
  path: string;
  joint: RawSkeletonJoint;
  parent: RawSkeletonJoint | undefined;
  parentName: string | undefined;
};

export function createRawSkeleton(roots: readonly RawSkeletonJointDefinition[] = []): RawSkeleton {
  return { roots: roots.map((root) => createRawSkeletonJoint(root)) };
}

export function createRawSkeletonJoint(definition: RawSkeletonJointDefinition): RawSkeletonJoint {
  const joint: RawSkeletonJoint = {
    name: definition.name,
    children: (definition.children ?? []).map((child) => createRawSkeletonJoint(child))
  };
  if (definition.rest !== undefined) joint.rest = cloneTransform(definition.rest);
  if (definition.humanoid !== undefined) joint.humanoid = definition.humanoid;
  return joint;
}

export function cloneRawSkeleton(rawSkeleton: RawSkeleton): RawSkeleton {
  const active = new Set<RawSkeletonJoint>();
  const visited = new Set<RawSkeletonJoint>();
  let jointCount = 0;

  function cloneJoint(joint: RawSkeletonJoint, path: string): RawSkeletonJoint {
    assertRawJointObject(joint, path);
    if (active.has(joint)) throw new Error(`raw skeleton contains a cycle at ${path}`);
    if (visited.has(joint)) throw new Error(`raw skeleton reuses the same joint object at ${path}`);
    active.add(joint);
    visited.add(joint);
    jointCount += 1;
    if (jointCount > OZZ_MAX_JOINTS) {
      active.delete(joint);
      throw new Error(`raw skeleton exceeds Ozz-style ${OZZ_MAX_JOINTS} joint safety limit`);
    }
    const cloned: RawSkeletonJoint = { name: joint.name, children: [] };
    if (joint.rest !== undefined) cloned.rest = cloneTransform(joint.rest);
    if (joint.humanoid !== undefined) cloned.humanoid = joint.humanoid;
    const children = readRawChildren(joint, path);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex]!;
      cloned.children.push(cloneJoint(child, `${path}/${rawPathSegment(child, childIndex)}`));
    }
    active.delete(joint);
    return cloned;
  }

  return {
    roots: readRawRoots(rawSkeleton).map((root, rootIndex) => cloneJoint(root, rawPathSegment(root, rootIndex)))
  };
}

export function countRawSkeletonJoints(rawSkeleton: RawSkeleton): number {
  return Array.from(iterateRawSkeletonDepthFirst(rawSkeleton)).length;
}

export function* iterateRawSkeletonDepthFirst(
  rawSkeleton: RawSkeleton
): IterableIterator<RawSkeletonJointTraversalItem> {
  let order = 0;
  const active = new Set<RawSkeletonJoint>();
  const visited = new Set<RawSkeletonJoint>();

  function* visit(
    joint: RawSkeletonJoint,
    parent: RawSkeletonJoint | undefined,
    depth: number,
    path: string
  ): IterableIterator<RawSkeletonJointTraversalItem> {
    assertRawJointObject(joint, path);
    if (active.has(joint)) throw new Error(`raw skeleton contains a cycle at ${path}`);
    if (visited.has(joint)) throw new Error(`raw skeleton reuses the same joint object at ${path}`);
    active.add(joint);
    visited.add(joint);
    if (order >= OZZ_MAX_JOINTS) {
      active.delete(joint);
      throw new Error(`raw skeleton exceeds Ozz-style ${OZZ_MAX_JOINTS} joint safety limit`);
    }
    yield {
      index: order,
      depth,
      path,
      joint,
      parent,
      parentName: parent?.name
    };
    order += 1;
    const children = readRawChildren(joint, path);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex]!;
      yield* visit(child, joint, depth + 1, `${path}/${rawPathSegment(child, childIndex)}`);
    }
    active.delete(joint);
  }

  const roots = readRawRoots(rawSkeleton);
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex]!;
    yield* visit(root, undefined, 0, rawPathSegment(root, rootIndex));
  }
}

export function* iterateRawSkeletonBreadthFirst(
  rawSkeleton: RawSkeleton
): IterableIterator<RawSkeletonJointTraversalItem> {
  let order = 0;
  const visited = new Set<RawSkeletonJoint>();

  function* visitSiblings(
    joints: readonly RawSkeletonJoint[],
    parent: RawSkeletonJoint | undefined,
    depth: number,
    parentPath: string
  ): IterableIterator<RawSkeletonJointTraversalItem> {
    for (let jointIndex = 0; jointIndex < joints.length; jointIndex += 1) {
      const joint = joints[jointIndex]!;
      const path = parentPath
        ? `${parentPath}/${rawPathSegment(joint, jointIndex)}`
        : rawPathSegment(joint, jointIndex);
      assertRawJointObject(joint, path);
      if (visited.has(joint)) throw new Error(`raw skeleton contains a cycle or shared joint at ${path}`);
      visited.add(joint);
      if (order >= OZZ_MAX_JOINTS) {
        throw new Error(`raw skeleton exceeds Ozz-style ${OZZ_MAX_JOINTS} joint safety limit`);
      }
      yield {
        index: order,
        depth,
        path,
        joint,
        parent,
        parentName: parent?.name
      };
      order += 1;
    }
    for (let jointIndex = 0; jointIndex < joints.length; jointIndex += 1) {
      const joint = joints[jointIndex]!;
      const path = parentPath
        ? `${parentPath}/${rawPathSegment(joint, jointIndex)}`
        : rawPathSegment(joint, jointIndex);
      yield* visitSiblings(readRawChildren(joint, path), joint, depth + 1, path);
    }
  }

  yield* visitSiblings(readRawRoots(rawSkeleton), undefined, 0, "");
}

export function validateRawSkeleton(rawSkeleton: RawSkeleton): RawSkeletonValidationIssue[] {
  const issues: RawSkeletonValidationIssue[] = [];
  const roots = Array.isArray(rawSkeleton?.roots) ? rawSkeleton.roots : undefined;
  if (!roots) {
    issues.push({ message: "raw skeleton roots must be an array" });
    return issues;
  }

  const names = new Map<string, number>();
  const humanoid = new Map<HumanoidBoneName, number>();
  const active = new Set<RawSkeletonJoint>();
  const visited = new Set<RawSkeletonJoint>();
  let jointCount = 0;
  let reportedJointLimit = false;

  function visit(joint: RawSkeletonJoint, path: string): void {
    if (!isRawJointObject(joint)) {
      issues.push({ path, message: "raw skeleton joint must be an object" });
      return;
    }
    const jointName = typeof joint.name === "string" ? joint.name : String(joint.name);
    if (active.has(joint)) {
      issues.push({ joint: jointName, path, message: "raw skeleton contains a cycle" });
      return;
    }
    if (visited.has(joint)) {
      issues.push({
        joint: jointName,
        path,
        message: "raw skeleton reuses the same joint object in more than one place"
      });
      return;
    }

    active.add(joint);
    visited.add(joint);
    const index = jointCount;
    jointCount += 1;
    if (jointCount > OZZ_MAX_JOINTS && !reportedJointLimit) {
      issues.push({
        index,
        joint: jointName,
        path,
        message: `raw skeleton exceeds Ozz-style ${OZZ_MAX_JOINTS} joint safety limit`
      });
      reportedJointLimit = true;
    }
    if (jointCount > OZZ_MAX_JOINTS) {
      active.delete(joint);
      return;
    }

    if (typeof joint.name !== "string" || joint.name.length === 0) {
      issues.push({ index, path, message: "raw skeleton joint is missing a name" });
    } else {
      const existingNameIndex = names.get(joint.name);
      if (existingNameIndex !== undefined) {
        issues.push({
          index,
          joint: joint.name,
          path,
          message: `duplicate raw skeleton joint name also assigned to index ${existingNameIndex}`
        });
      } else {
        names.set(joint.name, index);
      }
    }

    if (joint.humanoid !== undefined) {
      if (!isHumanoidBoneName(joint.humanoid)) {
        issues.push({
          index,
          joint: joint.name,
          path,
          message: `raw skeleton joint has invalid humanoid bone ${String(joint.humanoid)}`
        });
      } else {
        const existingHumanoidIndex = humanoid.get(joint.humanoid);
        if (existingHumanoidIndex !== undefined) {
          issues.push({
            index,
            joint: joint.name,
            path,
            message: `duplicate raw skeleton humanoid bone ${joint.humanoid} also assigned to index ${existingHumanoidIndex}`
          });
        } else {
          humanoid.set(joint.humanoid, index);
        }
      }
    }

    if (!Array.isArray(joint.children)) {
      issues.push({ index, joint: joint.name, path, message: "raw skeleton joint children must be an array" });
      active.delete(joint);
      return;
    }

    for (let childIndex = 0; childIndex < joint.children.length; childIndex += 1) {
      const child = joint.children[childIndex]!;
      visit(child, `${path}/${rawPathSegment(child, childIndex)}`);
      if (jointCount > OZZ_MAX_JOINTS) break;
    }
    active.delete(joint);
  }

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex]!;
    visit(root, rawPathSegment(root, rootIndex));
    if (jointCount > OZZ_MAX_JOINTS) break;
  }
  return issues;
}

export function buildSkeletonFromRawSkeleton(rawSkeleton: RawSkeleton): Skeleton {
  const issues = validateRawSkeleton(rawSkeleton);
  if (issues.length > 0) {
    throw new Error(`raw skeleton is invalid: ${issues.map((issue) => issue.message).join("; ")}`);
  }
  const definitions = Array.from(iterateRawSkeletonDepthFirst(rawSkeleton), (item): JointDefinition => {
    const definition: JointDefinition = {
      name: item.joint.name,
      rest: cloneTransform(item.joint.rest)
    };
    if (item.parentName === undefined) {
      definition.parentIndex = NO_PARENT;
    } else {
      definition.parentName = item.parentName;
    }
    if (item.joint.humanoid !== undefined) definition.humanoid = item.joint.humanoid;
    return definition;
  });
  if (definitions.length === 0) throw new Error("raw skeleton has no joints");
  return createSkeleton(definitions);
}

export class SkeletonBuilder {
  build(rawSkeleton: RawSkeleton): Skeleton {
    return buildSkeletonFromRawSkeleton(rawSkeleton);
  }
}

function readRawRoots(rawSkeleton: RawSkeleton): readonly RawSkeletonJoint[] {
  const roots = (rawSkeleton as RawSkeleton | undefined)?.roots;
  if (!Array.isArray(roots)) throw new Error("raw skeleton roots must be an array");
  return roots;
}

function readRawChildren(joint: RawSkeletonJoint, path = "joint"): readonly RawSkeletonJoint[] {
  const children = (joint as RawSkeletonJoint | undefined)?.children;
  if (!Array.isArray(children)) throw new Error(`raw skeleton joint children must be an array at ${path}`);
  return children;
}

function rawPathSegment(joint: RawSkeletonJoint, index: number): string {
  return isRawJointObject(joint) && typeof joint.name === "string" && joint.name.length > 0 ? joint.name : `#${index}`;
}

function isRawJointObject(value: unknown): value is RawSkeletonJoint {
  return typeof value === "object" && value !== null;
}

function assertRawJointObject(value: unknown, path: string): asserts value is RawSkeletonJoint {
  if (!isRawJointObject(value)) throw new Error(`raw skeleton joint must be an object at ${path}`);
}

export function createSkeleton(definitions: JointDefinition[]): Skeleton {
  if (definitions.length === 0) throw new Error("skeleton requires at least one joint");
  if (definitions.length > OZZ_MAX_JOINTS)
    throw new Error(`skeleton exceeds Ozz-style ${OZZ_MAX_JOINTS} joint safety limit`);

  const nameToIndex = new Map<string, number>();
  for (const [index, joint] of definitions.entries()) {
    if (typeof joint.name !== "string" || joint.name.length === 0) throw new Error(`joint ${index} is missing a name`);
    if (nameToIndex.has(joint.name)) throw new Error(`duplicate joint name ${joint.name}`);
    nameToIndex.set(joint.name, index);
  }

  const humanoid = new Map<HumanoidBoneName, number>();
  const joints = definitions.map((joint, index): SkeletonJoint => {
    const parentIndex = resolveParentIndex(joint, index, nameToIndex);
    if (!Number.isInteger(parentIndex)) throw new Error(`joint ${joint.name} parent index must be an integer`);
    if (parentIndex < NO_PARENT) throw new Error(`joint ${joint.name} parent index is invalid`);
    if (parentIndex >= index) throw new Error(`joint ${joint.name} parent must appear before child`);
    if ("humanoid" in joint && joint.humanoid !== undefined) {
      if (!isHumanoidBoneName(joint.humanoid)) {
        throw new Error(`joint ${joint.name} has invalid humanoid bone ${String(joint.humanoid)}`);
      }
      const existingIndex = humanoid.get(joint.humanoid);
      if (existingIndex !== undefined) {
        throw new Error(
          `duplicate humanoid bone ${joint.humanoid} on joints ${definitions[existingIndex]!.name} and ${joint.name}`
        );
      }
      humanoid.set(joint.humanoid, index);
    }
    return {
      name: joint.name,
      parentIndex,
      rest: cloneTransform(joint.rest),
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
  if (joint.parentIndex !== undefined) {
    if (!Number.isInteger(joint.parentIndex)) throw new Error(`joint ${joint.name} parent index must be an integer`);
    return joint.parentIndex;
  }
  if (joint.parentName !== undefined) {
    if (typeof joint.parentName !== "string" || joint.parentName.length === 0) {
      throw new Error(`joint ${joint.name} parent name must be a non-empty string`);
    }
    const parentIndex = nameToIndex.get(joint.parentName);
    if (parentIndex === undefined) throw new Error(`joint ${joint.name} parent ${joint.parentName} was not found`);
    return parentIndex;
  }
  return index === 0 ? NO_PARENT : 0;
}

export function validateSkeleton(skeleton: Skeleton): SkeletonValidationIssue[] {
  const issues: SkeletonValidationIssue[] = [];
  if (skeleton.joints.length === 0) issues.push({ message: "skeleton has no joints" });
  if (skeleton.joints.length > 1024) issues.push({ message: "skeleton exceeds Ozz-style 1024 joint safety limit" });
  if (skeleton.parents.length !== skeleton.joints.length)
    issues.push({ message: "parents length does not match joints" });
  if (skeleton.restPose.length !== skeleton.joints.length)
    issues.push({ message: "rest pose length does not match joints" });
  const nameToIndex =
    skeleton.nameToIndex instanceof Map ? (skeleton.nameToIndex as ReadonlyMap<string, number>) : undefined;
  const humanoid =
    skeleton.humanoid instanceof Map ? (skeleton.humanoid as ReadonlyMap<HumanoidBoneName, number>) : undefined;
  if (!nameToIndex) issues.push({ message: "nameToIndex map is invalid" });
  if (!humanoid) issues.push({ message: "humanoid map is invalid" });
  const names = new Map<string, number>();
  const humanoidToIndex = new Map<HumanoidBoneName, number>();
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const joint = skeleton.joints[index];
    if (!isSkeletonJointObject(joint)) {
      issues.push({ index, message: "joint is invalid" });
      continue;
    }
    const hasValidName = typeof joint.name === "string" && joint.name.length > 0;
    if (!hasValidName) issues.push({ index, message: "joint has no name" });
    const existingNameIndex = names.get(joint.name);
    if (hasValidName && existingNameIndex !== undefined) {
      issues.push({
        index,
        joint: joint.name,
        message: `duplicate joint name also assigned to index ${existingNameIndex}`
      });
    } else if (hasValidName) {
      names.set(joint.name, index);
    }
    if (!Number.isInteger(joint.parentIndex))
      issues.push({ index, joint: joint.name, message: "parent index must be an integer" });
    if (joint.parentIndex >= index)
      issues.push({ index, joint: joint.name, message: "parent index must be before child" });
    if (joint.parentIndex < NO_PARENT) issues.push({ index, joint: joint.name, message: "parent index is invalid" });
    if (!isFiniteSkeletonTransform(joint.rest))
      issues.push({ index, joint: joint.name, message: "rest transform is invalid" });
    if (index < skeleton.parents.length && skeleton.parents[index] !== joint.parentIndex) {
      issues.push({ index, joint: joint.name, message: "parents entry does not match joint parent" });
    }
    const restPoseTransform = skeleton.restPose[index];
    if (!isFiniteSkeletonTransform(restPoseTransform)) {
      issues.push({ index, joint: joint.name, message: "rest pose transform is invalid" });
    } else if (isFiniteSkeletonTransform(joint.rest) && !transformsEqual(restPoseTransform, joint.rest)) {
      issues.push({ index, joint: joint.name, message: "rest pose entry does not match joint rest" });
    }
    if (nameToIndex && hasValidName && nameToIndex.get(joint.name) !== index) {
      issues.push({ index, joint: joint.name, message: "nameToIndex entry does not match joint index" });
    }
    if (joint.humanoid !== undefined) {
      if (!isHumanoidBoneName(joint.humanoid)) {
        issues.push({ index, joint: joint.name, message: `joint has invalid humanoid bone ${String(joint.humanoid)}` });
        continue;
      }
      const existingIndex = humanoidToIndex.get(joint.humanoid);
      if (existingIndex !== undefined) {
        issues.push({
          index,
          joint: joint.name,
          message: `duplicate humanoid bone ${joint.humanoid} also assigned to ${skeleton.joints[existingIndex]!.name}`
        });
      } else {
        humanoidToIndex.set(joint.humanoid, index);
      }
      if (humanoid && humanoid.get(joint.humanoid) !== index) {
        issues.push({
          index,
          joint: joint.name,
          message: `humanoid map entry ${joint.humanoid} does not match joint index`
        });
      }
    }
  }
  if (nameToIndex) {
    for (const [name, index] of nameToIndex) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= skeleton.joints.length ||
        skeleton.joints[index]?.name !== name
      ) {
        issues.push({ message: `nameToIndex entry ${name} is stale` });
      }
    }
  }
  if (humanoid) {
    for (const [bone, index] of humanoid) {
      if (!isHumanoidBoneName(bone)) {
        issues.push({ message: `humanoid map entry ${String(bone)} has invalid humanoid bone name` });
        continue;
      }
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= skeleton.joints.length ||
        skeleton.joints[index]?.humanoid !== bone
      ) {
        issues.push({ message: `humanoid map entry ${bone} is stale` });
      }
    }
    issues.push(...validateHumanoidHierarchy(skeleton, humanoid));
  }
  return issues;
}

function validateHumanoidHierarchy(
  skeleton: Skeleton,
  humanoid: ReadonlyMap<HumanoidBoneName, number>
): SkeletonValidationIssue[] {
  const issues: SkeletonValidationIssue[] = [];
  for (const [childBone, ancestorBone] of VRM_HUMANOID_ANCESTOR_RULES) {
    const childIndex = humanoid.get(childBone);
    const ancestorIndex = humanoid.get(ancestorBone);
    if (childIndex === undefined || ancestorIndex === undefined) continue;
    const childJoint = skeleton.joints[childIndex];
    const ancestorJoint = skeleton.joints[ancestorIndex];
    if (!childJoint || !ancestorJoint || childJoint.humanoid !== childBone || ancestorJoint.humanoid !== ancestorBone)
      continue;
    if (!isDescendantJoint(skeleton, childIndex, ancestorIndex)) {
      issues.push({
        index: childIndex,
        joint: childJoint.name,
        message: `humanoid bone ${childBone} must be a descendant of ${ancestorBone}`
      });
    }
  }
  return issues;
}

function isDescendantJoint(skeleton: Skeleton, childIndex: number, ancestorIndex: number): boolean {
  let parentIndex = skeleton.joints[childIndex]?.parentIndex ?? NO_PARENT;
  const visited = new Set<number>();
  while (parentIndex !== NO_PARENT) {
    if (parentIndex === ancestorIndex) return true;
    if (
      !Number.isInteger(parentIndex) ||
      parentIndex < 0 ||
      parentIndex >= skeleton.joints.length ||
      visited.has(parentIndex)
    )
      return false;
    visited.add(parentIndex);
    parentIndex = skeleton.joints[parentIndex]?.parentIndex ?? NO_PARENT;
  }
  return false;
}

function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    numericArraysEqual(a.translation, b.translation) &&
    numericArraysEqual(a.rotation, b.rotation) &&
    numericArraysEqual(a.scale, b.scale)
  );
}

function isSkeletonJointObject(value: unknown): value is SkeletonJoint {
  return typeof value === "object" && value !== null;
}

function isFiniteSkeletonTransform(value: unknown): value is Transform {
  return isSkeletonTransformObject(value) && isFiniteTransform(value);
}

function isSkeletonTransformObject(value: unknown): value is Transform {
  return typeof value === "object" && value !== null;
}

export function createRestPose(skeleton: Skeleton): Transform[] {
  return cloneTransformList(skeleton.restPose);
}

export function getJointLocalRestPose(skeleton: Skeleton, joint: JointReference): Transform {
  const index = resolveRequiredJointIndex(skeleton, joint, "rest pose");
  return cloneTransform(skeleton.restPose[index] ?? skeleton.joints[index]!.rest);
}

export function isLeaf(skeleton: Skeleton, joint: JointReference): boolean {
  const index = resolveRequiredJointIndex(skeleton, joint, "leaf");
  for (let childIndex = 0; childIndex < skeleton.joints.length; childIndex += 1) {
    if (readParentIndex(skeleton, childIndex) === index) return false;
  }
  return true;
}

export function* iterateJointsDepthFirst(
  skeleton: Skeleton,
  from: JointReference = NO_PARENT
): IterableIterator<SkeletonJointTraversalItem> {
  const startIndex =
    from === NO_PARENT ? NO_PARENT : resolveRequiredJointIndex(skeleton, from, "depth-first traversal");
  const children = collectJointChildren(skeleton);
  const visited = new Set<number>();

  function* visit(index: number): IterableIterator<SkeletonJointTraversalItem> {
    if (visited.has(index)) return;
    visited.add(index);
    yield { index, parentIndex: readParentIndex(skeleton, index), joint: skeleton.joints[index]! };
    for (const childIndex of children[index]!) {
      yield* visit(childIndex);
    }
  }

  if (startIndex !== NO_PARENT) {
    yield* visit(startIndex);
    return;
  }

  for (let index = 0; index < skeleton.joints.length; index += 1) {
    if (readParentIndex(skeleton, index) === NO_PARENT) {
      yield* visit(index);
    }
  }
}

export function* iterateJointsReverseDepthFirst(skeleton: Skeleton): IterableIterator<SkeletonJointTraversalItem> {
  const items = Array.from(iterateJointsDepthFirst(skeleton));
  for (let index = items.length - 1; index >= 0; index -= 1) {
    yield items[index]!;
  }
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
  return updateLocalToModelPoseRange(skeleton, localPose, out);
}

export function updateLocalToModelPoseRange(
  skeleton: Skeleton,
  localPose: readonly Transform[],
  out: Mat4[],
  options: LocalToModelPoseRangeOptions = {}
): Mat4[] {
  if (localPose.length !== skeleton.joints.length) {
    throw new Error(`local pose length ${localPose.length} does not match skeleton ${skeleton.joints.length}`);
  }
  const jointCount = skeleton.joints.length;
  const from = sanitizeLocalToModelBoundary(options.from, NO_PARENT, jointCount, "from", false);
  const to = sanitizeLocalToModelBoundary(options.to, jointCount - 1, jointCount, "to", true);
  out.length = skeleton.joints.length;
  if (to < 0) return out;

  const kernelOptions = createKernelRangeOptions(options, from, to);
  if (options.kernel) {
    const retained = options.kernel.tryUpdateLocalToModelPoseRange(skeleton, localPose, out, kernelOptions);
    if (!retained) throw new Error("retained local-to-model job rejected the supplied skeleton or pose");
    return retained;
  }

  const selected = new Uint8Array(jointCount);
  for (let index = 0; index < jointCount; index += 1) {
    const parentIndex = skeleton.joints[index]!.parentIndex;
    if (from === NO_PARENT || index === from) {
      selected[index] = 1;
    } else if (parentIndex >= 0 && selected[parentIndex] === 1) {
      selected[index] = 1;
    }

    if (selected[index] !== 1 || index > to || (options.fromExcluded === true && index === from)) {
      continue;
    }

    const local = composeMat4(localPose[index]!);
    if (parentIndex === NO_PARENT) {
      out[index] = options.root ? multiplyMat4(options.root, local) : local;
      continue;
    }

    const parentModel = out[parentIndex];
    if (!parentModel) {
      throw new Error(`model pose for parent ${parentIndex} must be available before updating joint ${index}`);
    }
    out[index] = multiplyMat4(parentModel, local);
  }
  return out;
}

function createKernelRangeOptions(
  options: LocalToModelPoseRangeOptions,
  from: number,
  to: number
): Omit<LocalToModelPoseRangeOptions, "kernel"> {
  const kernelOptions: Omit<LocalToModelPoseRangeOptions, "kernel"> = { from, to };
  if (options.root !== undefined) kernelOptions.root = options.root;
  if (options.fromExcluded !== undefined) kernelOptions.fromExcluded = options.fromExcluded;
  return kernelOptions;
}

function sanitizeLocalToModelBoundary(
  value: number | undefined,
  fallback: number,
  jointCount: number,
  label: string,
  clampHigh: boolean
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved)) throw new Error(`local-to-model ${label} must be an integer`);
  if (resolved === NO_PARENT) return resolved;
  if (resolved < 0) throw new Error(`local-to-model ${label} is out of range`);
  if (resolved >= jointCount) {
    if (clampHigh && jointCount > 0) return jointCount - 1;
    throw new Error(`local-to-model ${label} is out of range`);
  }
  return resolved;
}

function resolveRequiredJointIndex(skeleton: Skeleton, joint: JointReference, label: string): number {
  if (typeof joint === "string") {
    const index = resolveJointIndex(skeleton, joint);
    if (index < 0) throw new Error(`${label} joint ${joint} was not found`);
    return index;
  }
  if (!Number.isInteger(joint) || joint < 0 || joint >= skeleton.joints.length) {
    throw new Error(`${label} joint index is out of range`);
  }
  return joint;
}

function readParentIndex(skeleton: Skeleton, index: number): number {
  return skeleton.parents[index] ?? skeleton.joints[index]!.parentIndex;
}

function collectJointChildren(skeleton: Skeleton): number[][] {
  const children = Array.from({ length: skeleton.joints.length }, () => [] as number[]);
  for (let index = 0; index < skeleton.joints.length; index += 1) {
    const parentIndex = readParentIndex(skeleton, index);
    if (parentIndex >= 0 && parentIndex < skeleton.joints.length) {
      children[parentIndex]!.push(index);
    }
  }
  return children;
}
