import type { AnimationClip, RawAnimation, RawSkeletonJoint, Skeleton } from "./test-api.js";
import {
  AdditiveAnimationBuilder,
  AnimationBuilder,
  AnimationOptimizer,
  AnimationRuntime,
  NO_PARENT,
  SkeletonBuilder,
  WAIFU_ANIMATION_BINARY_FORMAT,
  additiveDeltaPose,
  assert,
  buildAdditiveAnimationClip,
  buildAnimationFromRawAnimation,
  buildSkeletonFromRawSkeleton,
  clonePose,
  cloneRawAnimation,
  cloneRawSkeleton,
  cloneTransform,
  compareAnimationModelSpaceSampleError,
  compareAnimationSampleError,
  countRawSkeletonJoints,
  createFixedRateSamplingTimes,
  createRawAnimation,
  createRawAnimationJointTrack,
  createRawSkeleton,
  createRawSkeletonJoint,
  createSkeleton,
  extractRawAnimationTimePoints,
  getJointLocalRestPose,
  identityTransform,
  inspectClipAsset,
  isHumanoidBoneName,
  isLeaf,
  iterateJointsDepthFirst,
  iterateJointsReverseDepthFirst,
  iterateRawSkeletonBreadthFirst,
  iterateRawSkeletonDepthFirst,
  normalizeTransform,
  optimizeRawAnimation,
  quatFromAxisAngle,
  sampleClipToPose,
  sampleRawAnimation,
  sampleRawAnimationAtRatio,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  tryBuildAdditiveAnimationClip,
  tryBuildAnimationFromRawAnimation,
  tryOptimizeRawAnimation,
  validateAnimationInputs,
  validateClip,
  validateRawAnimation,
  validateRawSkeleton,
  validateSkeleton
} from "./test-api.js";
import {
  assertFiniteAnimationSampleError,
  assertFiniteModelSpaceSampleError,
  nodClip,
  quaternionNearlyEqual,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runCoreSkeletonAnimationTests(): Promise<{
  rawBuiltClip: AnimationClip;
  rawBuiltPose: ReturnType<typeof sampleClipToPose>;
}> {
  const repairedTransform = normalizeTransform({
    translation: [Number.NaN, 2, Infinity],
    rotation: [0, 0, 0, 0],
    scale: [1.5, Number.NEGATIVE_INFINITY, Number.NaN]
  });
  assert.deepEqual(repairedTransform.translation, [0, 2, 0]);
  assert.deepEqual(repairedTransform.rotation, [0, 0, 0, 1]);
  assert.deepEqual(repairedTransform.scale, [1.5, 1, 1]);
  const clonedTransform = cloneTransform({
    translation: [-3, Number.NaN, 4],
    rotation: [0, Number.POSITIVE_INFINITY, 0, 1],
    scale: [Number.NaN, 2, Number.NEGATIVE_INFINITY]
  });
  assert.deepEqual(clonedTransform.translation, [-3, 0, 4]);
  assert.deepEqual(clonedTransform.rotation, [0, 0, 0, 1]);
  assert.deepEqual(clonedTransform.scale, [1, 2, 1]);
  assert.deepEqual(identityTransform(), cloneTransform(undefined));
  const repairedRestSkeleton = createSkeleton([
    { name: "root", rest: { translation: [Number.NaN, 5, Infinity], scale: [Number.NaN, 3, -Infinity] } }
  ]);
  assert.deepEqual(repairedRestSkeleton.restPose[0]!.translation, [0, 5, 0]);
  assert.deepEqual(repairedRestSkeleton.restPose[0]!.scale, [1, 3, 1]);
  const explicitRootSkeleton = createSkeleton([
    { name: "hips", parentIndex: NO_PARENT },
    { name: "spine", parentIndex: 0 },
    { name: "detached", parentIndex: NO_PARENT }
  ]);
  assert.equal(explicitRootSkeleton.joints[0]!.parentIndex, NO_PARENT);
  assert.equal(explicitRootSkeleton.joints[2]!.parentIndex, NO_PARENT);
  assert.throws(
    () => createSkeleton([{ name: "root", parentIndex: Number.NaN }]),
    /joint root parent index must be an integer/,
    "createSkeleton should reject NaN parent indices"
  );
  assert.throws(
    () => createSkeleton([{ name: 123 } as unknown as Parameters<typeof createSkeleton>[0][number]]),
    /joint 0 is missing a name/,
    "createSkeleton should reject non-string runtime joint names"
  );
  assert.throws(
    () => createSkeleton([{ name: "root" }, { name: "child", parentIndex: 0.5 }]),
    /joint child parent index must be an integer/,
    "createSkeleton should reject non-integer parent indices"
  );
  assert.throws(
    () =>
      createSkeleton([
        { name: "root" },
        { name: "child", parentIndex: "0" } as unknown as Parameters<typeof createSkeleton>[0][number]
      ]),
    /joint child parent index must be an integer/,
    "createSkeleton should reject non-numeric runtime parent indices instead of falling through to default parenting"
  );
  assert.throws(
    () => createSkeleton([{ name: "root", parentIndex: NO_PARENT - 1 }]),
    /joint root parent index is invalid/,
    "createSkeleton should reject parent indices below NO_PARENT"
  );
  assert.throws(
    () => createSkeleton([{ name: "root", parentIndex: 0 }]),
    /joint root parent must appear before child/,
    "createSkeleton should reject self parent indices"
  );
  assert.throws(
    () =>
      createSkeleton([{ name: "root" }, { name: "child", parentIndex: 2 }, { name: "futureParent", parentIndex: 0 }]),
    /joint child parent must appear before child/,
    "createSkeleton should reject future parent indices"
  );
  assert.throws(
    () => createSkeleton([{ name: "root" }, { name: "child", parentName: "missing" }]),
    /joint child parent missing was not found/,
    "createSkeleton should reject missing parent names"
  );
  assert.throws(
    () => createSkeleton([{ name: "root" }, { name: "child", parentName: "" }]),
    /joint child parent name must be a non-empty string/,
    "createSkeleton should reject explicitly empty parent names instead of falling back to the default root"
  );
  assert.throws(
    () =>
      createSkeleton([
        { name: "hips", humanoid: "hips" },
        { name: "pelvis", humanoid: "hips" }
      ]),
    /duplicate humanoid bone hips on joints hips and pelvis/,
    "createSkeleton should reject duplicate humanoid bone assignments"
  );
  assert.throws(
    () =>
      createSkeleton([{ name: "root", humanoid: "pelvis" } as unknown as Parameters<typeof createSkeleton>[0][number]]),
    /joint root has invalid humanoid bone pelvis/,
    "createSkeleton should reject invalid humanoid bone identifiers from runtime input"
  );
  assert.equal(isHumanoidBoneName("head"), true, "known VRM humanoid names should pass the runtime guard");
  assert.equal(isHumanoidBoneName("pelvis"), false, "unknown humanoid names should fail the runtime guard");
  const duplicateHumanoidSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 3 ? { ...joint, humanoid: "head" as const } : joint))
  };
  assert.ok(
    validateSkeleton(duplicateHumanoidSkeleton).some(
      (issue) =>
        issue.index === 3 &&
        issue.joint === "leftUpperArm" &&
        issue.message === "duplicate humanoid bone head also assigned to head"
    ),
    "validateSkeleton should report duplicate humanoid bone assignments on malformed skeletons"
  );
  const invalidJointHumanoidSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, humanoid: "pelvis" } : joint))
  } as unknown as Skeleton;
  assert.ok(
    validateSkeleton(invalidJointHumanoidSkeleton).some(
      (issue) =>
        issue.index === 2 && issue.joint === "head" && issue.message === "joint has invalid humanoid bone pelvis"
    ),
    "validateSkeleton should report invalid humanoid bone identifiers on joints"
  );
  const nonIntegerParentSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, parentIndex: Number.NaN } : joint))
  };
  assert.ok(
    validateSkeleton(nonIntegerParentSkeleton).some(
      (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "parent index must be an integer"
    ),
    "validateSkeleton should report non-integer parent indices on malformed skeletons"
  );
  const duplicateJointNameSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 3 ? { ...joint, name: "head" } : joint))
  };
  assert.ok(
    validateSkeleton(duplicateJointNameSkeleton).some(
      (issue) =>
        issue.index === 3 && issue.joint === "head" && issue.message === "duplicate joint name also assigned to index 2"
    ),
    "validateSkeleton should report duplicate joint names on externally mutated skeletons"
  );
  const invalidJointNameSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, name: 123 as unknown as string } : joint))
  };
  assert.ok(
    validateSkeleton(invalidJointNameSkeleton).some(
      (issue) => issue.index === 2 && issue.message === "joint has no name"
    ),
    "validateSkeleton should report non-string joint names on externally mutated skeletons"
  );
  const staleParentsSkeleton = {
    ...skeleton,
    parents: Int16Array.from([-1, 0, 0, 1])
  };
  assert.ok(
    validateSkeleton(staleParentsSkeleton).some(
      (issue) =>
        issue.index === 2 && issue.joint === "head" && issue.message === "parents entry does not match joint parent"
    ),
    "validateSkeleton should report stale parents arrays"
  );
  const shortParentsSkeleton = {
    ...skeleton,
    parents: Int16Array.from([-1, 0])
  };
  assert.ok(
    validateSkeleton(shortParentsSkeleton).some((issue) => issue.message === "parents length does not match joints"),
    "validateSkeleton should report parents length mismatches"
  );
  const staleRestPoseSkeleton = {
    ...skeleton,
    restPose: skeleton.restPose.map((transform, index) =>
      index === 2
        ? { ...cloneTransform(transform), translation: [0, 99, 0] as [number, number, number] }
        : cloneTransform(transform)
    )
  };
  assert.ok(
    validateSkeleton(staleRestPoseSkeleton).some(
      (issue) =>
        issue.index === 2 && issue.joint === "head" && issue.message === "rest pose entry does not match joint rest"
    ),
    "validateSkeleton should report stale rest pose entries"
  );
  const shortRestPoseSkeleton = {
    ...skeleton,
    restPose: skeleton.restPose.slice(0, 2)
  };
  assert.ok(
    validateSkeleton(shortRestPoseSkeleton).some((issue) => issue.message === "rest pose length does not match joints"),
    "validateSkeleton should report rest pose length mismatches"
  );
  const staleNameToIndexSkeleton = {
    ...skeleton,
    nameToIndex: new Map([
      ["hips", 0],
      ["spine", 1],
      ["head", 3],
      ["leftUpperArm", 3],
      ["stale", 1]
    ])
  };
  const staleNameToIndexIssues = validateSkeleton(staleNameToIndexSkeleton);
  assert.ok(
    staleNameToIndexIssues.some(
      (issue) =>
        issue.index === 2 && issue.joint === "head" && issue.message === "nameToIndex entry does not match joint index"
    ),
    "validateSkeleton should report mismatched nameToIndex lookups"
  );
  assert.ok(
    staleNameToIndexIssues.some((issue) => issue.message === "nameToIndex entry stale is stale"),
    "validateSkeleton should report stale nameToIndex entries"
  );
  const staleHumanoidSkeleton = {
    ...skeleton,
    humanoid: new Map([
      ["hips", 0],
      ["spine", 1],
      ["head", 3],
      ["leftUpperArm", 3],
      ["rightHand", 1]
    ])
  } as unknown as Skeleton;
  const staleHumanoidIssues = validateSkeleton(staleHumanoidSkeleton);
  assert.ok(
    staleHumanoidIssues.some(
      (issue) =>
        issue.index === 2 &&
        issue.joint === "head" &&
        issue.message === "humanoid map entry head does not match joint index"
    ),
    "validateSkeleton should report mismatched humanoid map lookups"
  );
  assert.ok(
    staleHumanoidIssues.some((issue) => issue.message === "humanoid map entry rightHand is stale"),
    "validateSkeleton should report stale humanoid map entries"
  );
  const invalidHumanoidMapSkeleton = {
    ...skeleton,
    humanoid: new Map([
      ["hips", 0],
      ["spine", 1],
      ["head", 2],
      ["pelvis", 0]
    ])
  } as unknown as Skeleton;
  assert.ok(
    validateSkeleton(invalidHumanoidMapSkeleton).some(
      (issue) => issue.message === "humanoid map entry pelvis has invalid humanoid bone name"
    ),
    "validateSkeleton should report invalid humanoid map entry names"
  );
  const nonMapLookupSkeleton = {
    ...skeleton,
    nameToIndex: {} as Skeleton["nameToIndex"]
  };
  const nonMapLookupReport = validateAnimationInputs(nonMapLookupSkeleton, nodClip);
  assert.equal(
    nonMapLookupReport.accepted,
    false,
    "invalid skeleton lookup maps should make animation inputs unacceptable"
  );
  assert.ok(
    nonMapLookupReport.skeletonIssues.some((issue) => issue.message === "nameToIndex map is invalid"),
    "validateAnimationInputs should report malformed skeleton lookup maps instead of throwing during clip validation"
  );
  const validHumanoidHierarchySkeleton = createSkeleton([
    { name: "hips", humanoid: "hips" },
    { name: "spine", parentName: "hips", humanoid: "spine" },
    { name: "chest", parentName: "spine", humanoid: "chest" },
    { name: "neck", parentName: "chest", humanoid: "neck" },
    { name: "head", parentName: "neck", humanoid: "head" },
    { name: "leftShoulder", parentName: "chest", humanoid: "leftShoulder" },
    { name: "leftUpperArm", parentName: "leftShoulder", humanoid: "leftUpperArm" },
    { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm" },
    { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand" },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg" },
    { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg" },
    { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot" }
  ]);
  assert.deepEqual(
    validateSkeleton(validHumanoidHierarchySkeleton),
    [],
    "validateSkeleton should accept a coherent humanoid hierarchy"
  );
  const invalidHumanoidHierarchySkeleton = createSkeleton([
    { name: "hips", humanoid: "hips" },
    { name: "spine", parentName: "hips", humanoid: "spine" },
    { name: "chest", parentName: "spine", humanoid: "chest" },
    { name: "neck", parentName: "chest", humanoid: "neck" },
    { name: "head", parentName: "hips", humanoid: "head" },
    { name: "leftUpperArm", parentName: "chest", humanoid: "leftUpperArm" },
    { name: "leftLowerArm", parentName: "hips", humanoid: "leftLowerArm" },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg" },
    { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg" },
    { name: "rightFoot", parentName: "hips", humanoid: "rightFoot" }
  ]);
  const invalidHumanoidHierarchyIssues = validateSkeleton(invalidHumanoidHierarchySkeleton);
  assert.ok(
    invalidHumanoidHierarchyIssues.some(
      (issue) =>
        issue.index === 4 &&
        issue.joint === "head" &&
        issue.message === "humanoid bone head must be a descendant of neck"
    ),
    "validateSkeleton should report head mappings outside the neck chain"
  );
  assert.ok(
    invalidHumanoidHierarchyIssues.some(
      (issue) =>
        issue.index === 6 &&
        issue.joint === "leftLowerArm" &&
        issue.message === "humanoid bone leftLowerArm must be a descendant of leftUpperArm"
    ),
    "validateSkeleton should report lower-arm mappings outside the upper-arm chain"
  );
  assert.ok(
    invalidHumanoidHierarchyIssues.some(
      (issue) =>
        issue.index === 9 &&
        issue.joint === "rightFoot" &&
        issue.message === "humanoid bone rightFoot must be a descendant of rightLowerLeg"
    ),
    "validateSkeleton should report foot mappings outside the lower-leg chain"
  );
  const optionalMissingHumanoidHierarchySkeleton = createSkeleton([
    { name: "hips", humanoid: "hips" },
    { name: "spine", parentName: "hips", humanoid: "spine" },
    { name: "head", parentName: "spine", humanoid: "head" },
    { name: "leftLowerArm", parentName: "spine", humanoid: "leftLowerArm" },
    { name: "rightFoot", parentName: "hips", humanoid: "rightFoot" }
  ]);
  assert.deepEqual(
    validateSkeleton(optionalMissingHumanoidHierarchySkeleton),
    [],
    "validateSkeleton should not require optional humanoid parent bones before checking hierarchy"
  );
  const traversalSkeleton = createSkeleton([
    { name: "root", rest: { translation: [1, 0, 0] } },
    { name: "spine", parentName: "root", rest: { translation: [0, 1, 0] }, humanoid: "spine" },
    { name: "arm", parentName: "root", rest: { translation: [0, 0, 1] } },
    { name: "head", parentName: "spine", rest: { translation: [0, 2, 0] }, humanoid: "head" },
    { name: "propRoot", parentIndex: NO_PARENT, rest: { translation: [5, 0, 0] } },
    { name: "propTip", parentName: "propRoot", rest: { translation: [0, 0, 5] } }
  ]);
  const spineRest = getJointLocalRestPose(traversalSkeleton, "spine");
  assert.deepEqual(spineRest.translation, [0, 1, 0], "getJointLocalRestPose should resolve named joints");
  spineRest.translation[1] = 99;
  assert.deepEqual(
    traversalSkeleton.restPose[1]!.translation,
    [0, 1, 0],
    "getJointLocalRestPose should return a cloned transform"
  );
  assert.deepEqual(
    getJointLocalRestPose(traversalSkeleton, "head").translation,
    [0, 2, 0],
    "getJointLocalRestPose should resolve humanoid aliases"
  );
  assert.throws(() => getJointLocalRestPose(traversalSkeleton, -1), /rest pose joint index is out of range/);
  assert.equal(isLeaf(traversalSkeleton, "root"), false, "isLeaf should report joints with children as branches");
  assert.equal(isLeaf(traversalSkeleton, "arm"), true, "isLeaf should report childless joints as leaves");
  assert.equal(isLeaf(traversalSkeleton, "spine"), false, "isLeaf should detect non-contiguous descendants");
  assert.equal(isLeaf(traversalSkeleton, "propTip"), true, "isLeaf should handle additional roots");
  assert.deepEqual(
    Array.from(iterateJointsDepthFirst(traversalSkeleton), (item) => [item.index, item.parentIndex, item.joint.name]),
    [
      [0, NO_PARENT, "root"],
      [1, 0, "spine"],
      [3, 1, "head"],
      [2, 0, "arm"],
      [4, NO_PARENT, "propRoot"],
      [5, 4, "propTip"]
    ],
    "iterateJointsDepthFirst should traverse each root subtree in parent-child order"
  );
  assert.deepEqual(
    Array.from(iterateJointsDepthFirst(traversalSkeleton, "spine"), (item) => item.joint.name),
    ["spine", "head"],
    "iterateJointsDepthFirst should support starting from a resolved joint"
  );
  assert.deepEqual(
    Array.from(iterateJointsReverseDepthFirst(traversalSkeleton), (item) => item.joint.name),
    ["propTip", "propRoot", "arm", "head", "spine", "root"],
    "iterateJointsReverseDepthFirst should visit leaves before their parents"
  );
  assert.throws(
    () => Array.from(iterateJointsDepthFirst(traversalSkeleton, "missing")),
    /depth-first traversal joint missing was not found/
  );

  const rawSkeleton = createRawSkeleton([
    {
      name: "root",
      rest: { translation: [1, 0, 0] },
      children: [
        {
          name: "spine",
          humanoid: "spine",
          rest: { translation: [0, 1, 0] },
          children: [
            {
              name: "neck",
              children: [{ name: "head", humanoid: "head", rest: { translation: [0, 2, 0] } }]
            }
          ]
        },
        { name: "arm", rest: { translation: [0, 0, 1] } }
      ]
    },
    {
      name: "propRoot",
      children: [{ name: "propTip", rest: { translation: [0, 0, 5] } }]
    }
  ]);
  assert.deepEqual(
    validateRawSkeleton(rawSkeleton),
    [],
    "validateRawSkeleton should accept a named roots/children hierarchy"
  );
  assert.equal(
    countRawSkeletonJoints(rawSkeleton),
    7,
    "countRawSkeletonJoints should count all raw roots and descendants"
  );
  assert.deepEqual(
    Array.from(iterateRawSkeletonDepthFirst(rawSkeleton), (item) => ({
      index: item.index,
      depth: item.depth,
      name: item.joint.name,
      parent: item.parentName,
      path: item.path
    })),
    [
      { index: 0, depth: 0, name: "root", parent: undefined, path: "root" },
      { index: 1, depth: 1, name: "spine", parent: "root", path: "root/spine" },
      { index: 2, depth: 2, name: "neck", parent: "spine", path: "root/spine/neck" },
      { index: 3, depth: 3, name: "head", parent: "neck", path: "root/spine/neck/head" },
      { index: 4, depth: 1, name: "arm", parent: "root", path: "root/arm" },
      { index: 5, depth: 0, name: "propRoot", parent: undefined, path: "propRoot" },
      { index: 6, depth: 1, name: "propTip", parent: "propRoot", path: "propRoot/propTip" }
    ],
    "iterateRawSkeletonDepthFirst should traverse roots and children in Ozz-style pre-order"
  );
  assert.deepEqual(
    Array.from(iterateRawSkeletonBreadthFirst(rawSkeleton), (item) => item.joint.name),
    ["root", "propRoot", "spine", "arm", "neck", "head", "propTip"],
    "iterateRawSkeletonBreadthFirst should visit sibling groups before their descendants"
  );
  const builtRawSkeleton = buildSkeletonFromRawSkeleton(rawSkeleton);
  assert.deepEqual(
    builtRawSkeleton.joints.map((joint) => [joint.name, joint.parentIndex]),
    [
      ["root", NO_PARENT],
      ["spine", 0],
      ["neck", 1],
      ["head", 2],
      ["arm", 0],
      ["propRoot", NO_PARENT],
      ["propTip", 5]
    ],
    "buildSkeletonFromRawSkeleton should preserve deterministic depth-first ordering and parent-before-child indices"
  );
  assert.equal(
    builtRawSkeleton.nameToIndex.get("head"),
    3,
    "raw skeleton builder should preserve runtime parent/name lookup maps"
  );
  assert.equal(
    builtRawSkeleton.joints[builtRawSkeleton.nameToIndex.get("head")!]!.parentIndex,
    builtRawSkeleton.nameToIndex.get("neck")
  );
  assert.equal(builtRawSkeleton.humanoid.get("head"), 3, "raw skeleton builder should preserve humanoid aliases");
  assert.deepEqual(
    builtRawSkeleton.restPose[1]!.translation,
    [0, 1, 0],
    "raw skeleton builder should clone normalized local rest poses"
  );
  const classBuiltRawSkeleton = new SkeletonBuilder().build(rawSkeleton);
  assert.deepEqual(
    classBuiltRawSkeleton.joints.map((joint) => joint.name),
    builtRawSkeleton.joints.map((joint) => joint.name),
    "SkeletonBuilder should expose the raw-to-runtime build split"
  );
  const editableRawSkeleton = createRawSkeleton();
  assert.deepEqual(
    validateRawSkeleton(editableRawSkeleton),
    [],
    "empty raw skeletons should remain valid editable offline objects"
  );
  const editableRoot = createRawSkeletonJoint({ name: "editableRoot" });
  editableRoot.children.push(createRawSkeletonJoint({ name: "editableChild", rest: { translation: [0, 3, 0] } }));
  editableRawSkeleton.roots.push(editableRoot);
  assert.deepEqual(
    Array.from(iterateRawSkeletonDepthFirst(editableRawSkeleton), (item) => item.joint.name),
    ["editableRoot", "editableChild"],
    "raw skeleton roots and children should remain mutable for offline authoring"
  );
  const clonedRawSkeleton = cloneRawSkeleton(rawSkeleton);
  assert.notEqual(
    clonedRawSkeleton.roots[0],
    rawSkeleton.roots[0],
    "cloneRawSkeleton should create new root joint objects"
  );
  assert.notEqual(
    clonedRawSkeleton.roots[0]!.children[0],
    rawSkeleton.roots[0]!.children[0],
    "cloneRawSkeleton should deep-clone child joints"
  );
  clonedRawSkeleton.roots[0]!.children[0]!.rest!.translation![1] = 99;
  assert.deepEqual(
    rawSkeleton.roots[0]!.children[0]!.rest!.translation,
    [0, 1, 0],
    "cloneRawSkeleton should not alias rest pose arrays"
  );
  rawSkeleton.roots[0]!.children[0]!.rest!.translation[1] = 42;
  assert.deepEqual(
    builtRawSkeleton.restPose[1]!.translation,
    [0, 1, 0],
    "raw skeleton builds should not alias mutable raw rest poses"
  );
  rawSkeleton.roots[0]!.children[0]!.rest!.translation[1] = 1;
  const duplicateRawSkeleton = createRawSkeleton([{ name: "root", children: [{ name: "dup" }] }, { name: "dup" }]);
  assert.ok(
    validateRawSkeleton(duplicateRawSkeleton).some(
      (issue) => issue.message === "duplicate raw skeleton joint name also assigned to index 1"
    ),
    "validateRawSkeleton should reject duplicate names across roots and descendants"
  );
  assert.throws(
    () => buildSkeletonFromRawSkeleton(duplicateRawSkeleton),
    /duplicate raw skeleton joint name/,
    "raw skeleton builder should reject duplicate names"
  );
  const cycleRoot: RawSkeletonJoint = createRawSkeletonJoint({ name: "cycleRoot" });
  cycleRoot.children.push(cycleRoot);
  assert.ok(
    validateRawSkeleton({ roots: [cycleRoot] }).some((issue) => issue.message === "raw skeleton contains a cycle"),
    "validateRawSkeleton should report child cycles"
  );
  assert.throws(
    () => Array.from(iterateRawSkeletonDepthFirst({ roots: [cycleRoot] })),
    /cycle/,
    "raw depth-first traversal should guard cycles"
  );
  assert.throws(() => cloneRawSkeleton({ roots: [cycleRoot] }), /cycle/, "cloneRawSkeleton should guard cycles");
  assert.throws(
    () => buildSkeletonFromRawSkeleton({ roots: [cycleRoot] }),
    /cycle/,
    "raw skeleton builder should reject cycles"
  );
  const malformedRawSkeleton = { roots: [{ name: "root" } as RawSkeletonJoint] };
  assert.ok(
    validateRawSkeleton(malformedRawSkeleton).some(
      (issue) => issue.message === "raw skeleton joint children must be an array"
    ),
    "validateRawSkeleton should report malformed raw joints with missing children arrays"
  );
  assert.throws(
    () => buildSkeletonFromRawSkeleton({ roots: [] }),
    /raw skeleton has no joints/,
    "raw skeleton builder should reject empty runtime builds"
  );
  assert.ok(
    validateRawSkeleton({
      roots: [{ name: "root", humanoid: "pelvis", children: [] } as unknown as RawSkeletonJoint]
    }).some((issue) => issue.message === "raw skeleton joint has invalid humanoid bone pelvis"),
    "validateRawSkeleton should reject invalid humanoid identifiers"
  );

  const editableRawAnimationTrack = createRawAnimationJointTrack({ joint: "leftUpperArm" });
  editableRawAnimationTrack.translations.push({ time: 0, value: [0, 0, 0] }, { time: 2, value: [2, 0, 0] });
  editableRawAnimationTrack.rotations.push({ time: 0, value: [0, 0, 0, 2] }, { time: 2, value: [0, 0, 0, -1] });
  const rawAnimation = createRawAnimation({
    id: "raw-builder",
    name: "Raw Builder",
    duration: 2,
    loop: true,
    metadata: { source: "raw" },
    tracks: [
      editableRawAnimationTrack,
      {
        humanBone: "head",
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 2, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2) }
        ]
      },
      {
        joint: "spine",
        scales: [
          { time: 0, value: [1, 1, 1] },
          { time: 2, value: [2, 2, 2] }
        ]
      }
    ]
  });
  assert.deepEqual(
    validateRawAnimation(rawAnimation, skeleton),
    [],
    "validateRawAnimation should accept strict raw joint TRS tracks"
  );
  const rawBuiltClip = new AnimationBuilder().build(rawAnimation, skeleton);
  assert.equal(rawBuiltClip.id, "raw-builder");
  assert.equal(rawBuiltClip.name, "Raw Builder");
  assert.equal(rawBuiltClip.duration, 2);
  assert.equal(rawBuiltClip.loop, true);
  assert.deepEqual(rawBuiltClip.metadata, { source: "raw" });
  assert.deepEqual(
    rawBuiltClip.tracks.map((track) => `${track.joint ?? track.humanBone}.${track.property}`),
    ["spine.scale", "head.rotation", "leftUpperArm.translation", "leftUpperArm.rotation"],
    "AnimationBuilder should emit deterministic skeleton-order tracks with TRS property ordering"
  );
  const rawBuiltPose = sampleClipToPose(skeleton, rawBuiltClip, 1, { loop: false });
  assert.deepEqual(
    rawBuiltPose[3]!.translation,
    [1, 0, 0],
    "built raw animation clips should sample as ordinary AnimationClips"
  );
  assert.deepEqual(rawBuiltPose[1]!.scale, [1.5, 1.5, 1.5], "raw scale keys should build into runtime scale tracks");
  assert.ok(
    quaternionNearlyEqual(Array.from(rawBuiltClip.tracks[3]!.values.slice(0, 4)), [0, 0, 0, 1], 1e-6),
    "AnimationBuilder should normalize raw rotation quaternions"
  );
  assert.ok(
    quaternionNearlyEqual(Array.from(rawBuiltClip.tracks[3]!.values.slice(4, 8)), [0, 0, 0, 1], 1e-6),
    "AnimationBuilder should keep adjacent raw rotation keys in the shortest quaternion hemisphere"
  );
  assert.deepEqual(
    rawAnimation.tracks[0]!.rotations[1]!.value,
    [0, 0, 0, -1],
    "AnimationBuilder should not mutate raw rotation key values"
  );
  assert.equal(
    validateClip(rawBuiltClip, skeleton).length,
    0,
    "built raw animations should pass runtime clip validation"
  );
  assert.equal(
    buildAnimationFromRawAnimation(rawAnimation, skeleton).tracks.length,
    rawBuiltClip.tracks.length,
    "buildAnimationFromRawAnimation should expose the same builder path"
  );

  const rawOptimizerSource = createRawAnimation({
    id: "raw-optimizer",
    name: "Raw Optimizer",
    duration: 2,
    loop: true,
    metadata: { source: "optimizer-fixture" },
    tracks: [
      {
        joint: "hips",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [1, 2, 3] },
          { time: 2, value: [2, 4, 6] }
        ]
      },
      {
        joint: "spine",
        scales: [
          { time: 0, value: [1, 1, 1] },
          { time: 1, value: [1.5, 1.5, 1.5] },
          { time: 2, value: [2, 2, 2] }
        ]
      },
      {
        humanBone: "head",
        rotations: [
          { time: 0, value: quatFromAxisAngle([0, 1, 0], 0) },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI / 4) },
          { time: 2, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2) }
        ]
      }
    ]
  });
  const rawOptimizerSourceSnapshot = JSON.stringify(rawOptimizerSource);
  const rawOptimizerResult = new AnimationOptimizer().tryOptimize(rawOptimizerSource, {
    skeleton,
    tolerances: { translation: 1e-5, rotation: 1e-5, scale: 1e-5 }
  });
  assert.equal(
    rawOptimizerResult.ok,
    true,
    "AnimationOptimizer should return an optimized raw animation for valid input"
  );
  if (rawOptimizerResult.ok) {
    assert.equal(rawOptimizerResult.rawAnimation.id, rawOptimizerSource.id);
    assert.equal(rawOptimizerResult.rawAnimation.name, rawOptimizerSource.name);
    assert.equal(rawOptimizerResult.rawAnimation.loop, true);
    assert.deepEqual(rawOptimizerResult.rawAnimation.metadata, { source: "optimizer-fixture" });
    assert.equal(rawOptimizerResult.stats.inputKeyCount, 9);
    assert.equal(rawOptimizerResult.stats.outputKeyCount, 6);
    assert.equal(rawOptimizerResult.stats.removedKeyCount, 3);
    assert.equal(
      rawOptimizerResult.rawAnimation.tracks[0]!.translations.length,
      2,
      "linear translation keys should be reduced"
    );
    assert.equal(rawOptimizerResult.rawAnimation.tracks[1]!.scales.length, 2, "linear scale keys should be reduced");
    assert.equal(
      rawOptimizerResult.rawAnimation.tracks[2]!.rotations.length,
      2,
      "slerp-linear rotation keys should be reduced"
    );
    assert.deepEqual(
      rawOptimizerResult.rawAnimation.tracks[0]!.translations.map((key) => key.time),
      [0, 2],
      "raw animation optimization should preserve first and last translation keys"
    );
    assert.deepEqual(
      rawOptimizerResult.rawAnimation.tracks[1]!.scales.map((key) => key.time),
      [0, 2],
      "raw animation optimization should preserve first and last scale keys"
    );
    assert.deepEqual(
      rawOptimizerResult.rawAnimation.tracks[2]!.rotations.map((key) => key.time),
      [0, 2],
      "raw animation optimization should preserve first and last rotation keys"
    );
    assert.notEqual(
      rawOptimizerResult.rawAnimation.tracks[0]!.translations,
      rawOptimizerSource.tracks[0]!.translations
    );
    const optimizedRuntimeClip = buildAnimationFromRawAnimation(rawOptimizerResult.rawAnimation, skeleton);
    const runtimeSampleError = compareAnimationSampleError(rawOptimizerSource, optimizedRuntimeClip, {
      skeleton,
      sampleFrequency: 8
    });
    assert.equal(runtimeSampleError.sampleCount, 17);
    assert.ok(
      runtimeSampleError.translation.max < 1e-5,
      "raw/runtime sample-error comparison should report preserved translation samples"
    );
    assert.ok(
      runtimeSampleError.scale.max < 1e-5,
      "raw/runtime sample-error comparison should report preserved scale samples"
    );
    assert.ok(
      runtimeSampleError.rotation.max < 1e-5,
      "raw/runtime sample-error comparison should report preserved shortest-path rotation samples"
    );
  }
  assert.equal(
    JSON.stringify(rawOptimizerSource),
    rawOptimizerSourceSnapshot,
    "raw animation optimization should not mutate source raw animation data"
  );
  const optimizedRawViaFunction = optimizeRawAnimation(rawOptimizerSource, {
    skeleton,
    tolerances: { translation: 1e-5, rotation: 1e-5, scale: 1e-5 }
  });
  assert.equal(
    optimizedRawViaFunction.tracks[0]!.translations.length,
    2,
    "optimizeRawAnimation should expose the same reduction path"
  );

  const propagatedErrorSkeleton = createSkeleton([
    { name: "root" },
    { name: "child", parentName: "root", rest: { translation: [1, 0, 0] } },
    { name: "tip", parentName: "child", rest: { translation: [1, 0, 0] } }
  ]);
  const propagatedReferenceRaw = createRawAnimation({
    id: "propagated-reference",
    duration: 1,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0, 0, 0] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 1, value: [0, 0, 0, 1] }
        ]
      }
    ]
  });
  const propagatedCandidateRaw = createRawAnimation({
    id: "propagated-candidate",
    duration: 1,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0, 1, 0] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 1, value: quatFromAxisAngle([0, 0, 1], Math.PI / 2) }
        ]
      }
    ]
  });
  const propagatedSampleError = compareAnimationSampleError(propagatedReferenceRaw, propagatedCandidateRaw, {
    skeleton: propagatedErrorSkeleton,
    sampleTimes: [1],
    includeModelSpace: true
  });
  assert.ok(
    propagatedSampleError.modelSpace,
    "sample-error comparison should include model-space diagnostics when requested"
  );
  assert.equal(
    propagatedSampleError.modelSpace.position.maxJoint,
    "tip",
    "propagated model-space position error should identify the farthest affected descendant"
  );
  assert.ok(
    propagatedSampleError.modelSpace.joints[1]!.position.max > propagatedSampleError.translation.max,
    "parent translation/rotation should produce model-space position error on an unchanged child joint"
  );
  assert.ok(
    propagatedSampleError.modelSpace.joints[2]!.position.max > propagatedSampleError.modelSpace.joints[1]!.position.max,
    "parent rotation should accumulate larger propagated model-space position error on farther descendants"
  );
  assert.ok(
    propagatedSampleError.modelSpace.joints[2]!.rotation.max >= propagatedSampleError.rotation.max,
    "descendant model-space rotation error should inherit parent rotation differences"
  );
  assertFiniteAnimationSampleError(propagatedSampleError, "propagated model-space raw/raw sample error");

  const propagatedCandidateClip = buildAnimationFromRawAnimation(propagatedCandidateRaw, propagatedErrorSkeleton);
  const propagatedRuntimeModelError = compareAnimationModelSpaceSampleError(
    propagatedReferenceRaw,
    propagatedCandidateClip,
    {
      skeleton: propagatedErrorSkeleton,
      sampleTimes: [1]
    }
  );
  assert.equal(
    propagatedRuntimeModelError.position.maxJoint,
    "tip",
    "raw/runtime model-space comparison should preserve descendant max-joint diagnostics"
  );
  assertFiniteModelSpaceSampleError(propagatedRuntimeModelError, "propagated raw/runtime model-space sample error");

  const propagatedReferenceClip = buildAnimationFromRawAnimation(propagatedReferenceRaw, propagatedErrorSkeleton);
  const identicalRawError = compareAnimationSampleError(propagatedReferenceRaw, propagatedReferenceRaw, {
    skeleton: propagatedErrorSkeleton,
    sampleFrequency: 4,
    includeModelSpace: true
  });
  assert.equal(
    identicalRawError.translation.max,
    0,
    "identical raw sample comparison should have zero local translation error"
  );
  assert.equal(
    identicalRawError.rotation.max,
    0,
    "identical raw sample comparison should have zero local rotation error"
  );
  assert.equal(identicalRawError.scale.max, 0, "identical raw sample comparison should have zero local scale error");
  assert.equal(
    identicalRawError.modelSpace!.position.max,
    0,
    "identical raw sample comparison should have zero model-space position error"
  );
  assert.equal(
    identicalRawError.modelSpace!.rotation.max,
    0,
    "identical raw sample comparison should have zero model-space rotation error"
  );
  assert.equal(
    identicalRawError.modelSpace!.scale.max,
    0,
    "identical raw sample comparison should have zero model-space scale error"
  );
  assertFiniteAnimationSampleError(identicalRawError, "identical raw model-space sample error");

  const identicalRuntimeError = compareAnimationSampleError(propagatedReferenceClip, propagatedReferenceClip, {
    skeleton: propagatedErrorSkeleton,
    sampleFrequency: 4,
    includeModelSpace: true
  });
  assert.equal(
    identicalRuntimeError.modelSpace!.position.max,
    0,
    "identical runtime clip comparison should have zero model-space position error"
  );
  assert.equal(
    identicalRuntimeError.modelSpace!.rotation.max,
    0,
    "identical runtime clip comparison should have zero model-space rotation error"
  );
  assert.equal(
    identicalRuntimeError.modelSpace!.scale.max,
    0,
    "identical runtime clip comparison should have zero model-space scale error"
  );
  assertFiniteAnimationSampleError(identicalRuntimeError, "identical runtime model-space sample error");

  const optimizedRawWithSampleDiagnostics = tryOptimizeRawAnimation(rawOptimizerSource, {
    skeleton,
    tolerances: { translation: 1e-5, rotation: 1e-5, scale: 1e-5 },
    sampleError: { sampleFrequency: 8 }
  });
  assert.equal(
    optimizedRawWithSampleDiagnostics.ok,
    true,
    "AnimationOptimizer should attach optional sample-error diagnostics for valid input"
  );
  if (optimizedRawWithSampleDiagnostics.ok) {
    assert.ok(
      optimizedRawWithSampleDiagnostics.stats.sampleError?.modelSpace,
      "optimizer sample diagnostics should include propagated model-space error by default"
    );
    assert.ok(optimizedRawWithSampleDiagnostics.stats.sampleError.modelSpace.position.max < 1e-5);
    assertFiniteAnimationSampleError(
      optimizedRawWithSampleDiagnostics.stats.sampleError,
      "optimizer model-space sample diagnostics"
    );
  }

  const rawOptimizerShortestQuaternion = createRawAnimation({
    id: "raw-optimizer-shortest-quaternion",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 0.5, value: [0, 0, 0, -1] },
          { time: 1, value: [0, 0, 0, 1] }
        ]
      }
    ]
  });
  const optimizedShortestQuaternionRaw = optimizeRawAnimation(rawOptimizerShortestQuaternion, {
    skeleton,
    tolerances: { rotation: 0 }
  });
  assert.equal(
    optimizedShortestQuaternionRaw.tracks[0]!.rotations.length,
    2,
    "raw animation optimization should treat sign-equivalent quaternions as shortest-path equivalent"
  );

  const hierarchyToleranceRawAnimation = createRawAnimation({
    id: "hierarchy-tolerance-raw",
    duration: 2,
    tracks: [
      {
        joint: "hips",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0.05, 0, 0] },
          { time: 2, value: [0, 0, 0] }
        ]
      }
    ]
  });
  const hierarchyLooseOptimization = optimizeRawAnimation(hierarchyToleranceRawAnimation, {
    skeleton,
    tolerances: { translation: 0.1 }
  });
  assert.equal(
    hierarchyLooseOptimization.tracks[0]!.translations.length,
    2,
    "loose root tolerance should remove small root deviations"
  );
  const hierarchySensitiveOptimization = optimizeRawAnimation(hierarchyToleranceRawAnimation, {
    skeleton,
    tolerances: { translation: 0.1 },
    hierarchyWeight: 1
  });
  assert.equal(
    hierarchySensitiveOptimization.tracks[0]!.translations.length,
    3,
    "hierarchy weighting should make parent-joint optimization stricter when descendants would inherit the error"
  );
  const jointWeightedOptimization = optimizeRawAnimation(hierarchyToleranceRawAnimation, {
    skeleton,
    tolerances: { translation: 0.1 },
    jointTolerances: { hips: { weight: 10 } }
  });
  assert.equal(
    jointWeightedOptimization.tracks[0]!.translations.length,
    3,
    "per-joint optimizer weights should make matching joints stricter"
  );

  const firstFrameAdditiveSourceClip: AnimationClip = {
    id: "first-frame-additive-source",
    name: "First Frame Additive Source",
    duration: 1,
    loop: true,
    metadata: { source: "authored" },
    tracks: [
      {
        humanBone: "hips",
        property: "translation",
        times: toFloat32Array([0.25, 1]),
        values: toFloat32Array([4, 10, 0, 7, 16, 0])
      },
      {
        humanBone: "head",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([
          ...quatFromAxisAngle([0, 1, 0], Math.PI / 4),
          ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)
        ])
      }
    ]
  };
  const firstFrameAdditiveClip = new AdditiveAnimationBuilder().build(firstFrameAdditiveSourceClip, skeleton);
  assert.equal(firstFrameAdditiveClip.id, firstFrameAdditiveSourceClip.id);
  assert.equal(firstFrameAdditiveClip.name, firstFrameAdditiveSourceClip.name);
  assert.equal(firstFrameAdditiveClip.loop, true);
  assert.deepEqual(firstFrameAdditiveClip.metadata, { source: "authored" });
  assert.notEqual(
    firstFrameAdditiveClip.tracks[0]!.times,
    firstFrameAdditiveSourceClip.tracks[0]!.times,
    "additive builder should not alias source track times"
  );
  assert.equal(
    validateClip(firstFrameAdditiveClip, skeleton).length,
    0,
    "first-frame additive clips should be valid ordinary AnimationClips"
  );
  const firstFrameStartDelta = additiveDeltaPose(
    skeleton.restPose,
    sampleClipToPose(skeleton, firstFrameAdditiveClip, 0.25, { loop: false })
  );
  assert.ok(
    vectorNearlyEqual(firstFrameStartDelta[0]!.translation, [0, 0, 0], 1e-6),
    "default additive builder should use each channel's first key as the translation reference"
  );
  const firstFrameEndDelta = additiveDeltaPose(
    skeleton.restPose,
    sampleClipToPose(skeleton, firstFrameAdditiveClip, 1, { loop: false })
  );
  assert.ok(
    vectorNearlyEqual(firstFrameEndDelta[0]!.translation, [3, 6, 0], 1e-6),
    "first-frame additive builder should preserve translation deltas through rest-pose sampling"
  );
  assert.ok(
    quaternionNearlyEqual(firstFrameEndDelta[2]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "first-frame additive builder should encode rotation deltas from the first keyed rotation"
  );
  const runtimeFirstFrameAdditive = new AnimationRuntime(skeleton);
  runtimeFirstFrameAdditive.setLayer("additive", firstFrameAdditiveClip, {
    time: 1,
    loop: false,
    weight: 1,
    targetWeight: 1,
    blendMode: "additive"
  });
  assert.ok(
    vectorNearlyEqual(runtimeFirstFrameAdditive.evaluate().localPose[0]!.translation, [3, 7, 0], 1e-6),
    "generated additive clips should compose through the existing runtime additive layer path"
  );

  const explicitReferencePose = clonePose(skeleton.restPose);
  explicitReferencePose[3]!.translation = [1, 0, 0];
  explicitReferencePose[3]!.rotation = quatFromAxisAngle([0, 1, 0], Math.PI / 6);
  const explicitReferenceAdditiveSourceClip: AnimationClip = {
    id: "explicit-reference-additive-source",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperArm",
        property: "translation",
        times: toFloat32Array([0]),
        values: toFloat32Array([4, 0, 0])
      },
      {
        humanBone: "leftUpperArm",
        property: "rotation",
        times: toFloat32Array([0]),
        values: sanitizeQuaternionTrackValues(quatFromAxisAngle([0, 1, 0], (Math.PI * 5) / 12))
      }
    ]
  };
  const explicitReferenceAdditiveClip = buildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, {
    referencePose: explicitReferencePose
  });
  const explicitReferenceDelta = additiveDeltaPose(
    skeleton.restPose,
    sampleClipToPose(skeleton, explicitReferenceAdditiveClip, 0, { loop: false })
  );
  assert.ok(
    vectorNearlyEqual(explicitReferenceDelta[3]!.translation, [3, 0, 0], 1e-6),
    "explicit reference poses should drive additive translation deltas"
  );
  assert.ok(
    quaternionNearlyEqual(explicitReferenceDelta[3]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "explicit reference poses should drive additive rotation deltas"
  );
  const shortReferenceAdditiveBuild = tryBuildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, {
    referencePose: explicitReferencePose.slice(0, 1)
  });
  assert.equal(
    shortReferenceAdditiveBuild.ok,
    false,
    "additive builder should reject reference poses shorter than the skeleton"
  );
  if (!shortReferenceAdditiveBuild.ok) {
    assert.ok(
      shortReferenceAdditiveBuild.issues.some((issue) =>
        issue.message.includes("reference pose length 1 does not match skeleton 4")
      )
    );
  }
  const nonFiniteReferencePose = clonePose(skeleton.restPose);
  nonFiniteReferencePose[0]!.translation = [Number.NaN, 0, 0];
  assert.throws(
    () =>
      buildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, {
        referencePose: nonFiniteReferencePose
      }),
    /reference pose transform is not finite/,
    "additive builder should fail clearly on non-finite reference transforms"
  );

  const clonedRawAnimation = cloneRawAnimation(rawAnimation);
  assert.notEqual(clonedRawAnimation, rawAnimation, "cloneRawAnimation should create a new raw animation object");
  assert.notEqual(
    clonedRawAnimation.tracks[0],
    rawAnimation.tracks[0],
    "cloneRawAnimation should clone raw joint tracks"
  );
  clonedRawAnimation.tracks[0]!.translations[0]!.value[0] = 99;
  assert.deepEqual(
    rawAnimation.tracks[0]!.translations[0]!.value,
    [0, 0, 0],
    "cloneRawAnimation should not alias raw translation key values"
  );
  rawAnimation.tracks[0]!.translations[0]!.value[0] = 123;
  assert.equal(
    rawBuiltClip.tracks[2]!.values[0],
    0,
    "built AnimationClips should not alias mutable raw animation values"
  );
  rawAnimation.tracks[0]!.translations[0]!.value[0] = 0;

  const missingRawAnimation = createRawAnimation({
    id: "raw-missing-target",
    duration: 1,
    tracks: [{ joint: "missing", translations: [{ time: 0, value: [0, 0, 0] }] }]
  });
  const missingRawAnimationIssues = validateRawAnimation(missingRawAnimation, skeleton);
  assert.ok(
    missingRawAnimationIssues.some((issue) => issue.message === "raw animation track does not map to skeleton"),
    "validateRawAnimation should reject raw joint tracks that do not map to a supplied skeleton"
  );
  const missingRawAnimationBuild = tryBuildAnimationFromRawAnimation(missingRawAnimation, skeleton);
  assert.equal(
    missingRawAnimationBuild.ok,
    false,
    "tryBuildAnimationFromRawAnimation should return issues instead of a clip for invalid raw input"
  );
  const missingRawAnimationOptimization = tryOptimizeRawAnimation(missingRawAnimation, { skeleton });
  assert.equal(
    missingRawAnimationOptimization.ok,
    false,
    "tryOptimizeRawAnimation should return issues instead of optimized raw data for invalid input"
  );
  if (!missingRawAnimationOptimization.ok) {
    assert.equal(missingRawAnimationOptimization.rawAnimation, null);
    assert.equal(missingRawAnimationOptimization.stats, null);
    assert.ok(
      missingRawAnimationOptimization.issues.some(
        (issue) => issue.message === "raw animation track does not map to skeleton"
      )
    );
  }
  assert.throws(
    () => buildAnimationFromRawAnimation(missingRawAnimation, skeleton),
    /raw animation track does not map to skeleton/,
    "buildAnimationFromRawAnimation should reject skeleton mapping failures"
  );
  assert.throws(
    () => optimizeRawAnimation(missingRawAnimation, { skeleton }),
    /raw animation track does not map to skeleton/,
    "optimizeRawAnimation should reject skeleton mapping failures"
  );
  assert.equal(
    tryOptimizeRawAnimation(rawOptimizerSource, { tolerances: { translation: Number.NaN } }).ok,
    false,
    "tryOptimizeRawAnimation should reject invalid optimizer tolerances through structured issues"
  );

  const duplicateRawAnimation = createRawAnimation({
    id: "raw-duplicate-channel",
    duration: 1,
    tracks: [
      { joint: "head", rotations: [{ time: 0, value: [0, 0, 0, 1] }] },
      { humanBone: "head", rotations: [{ time: 0, value: [0, 0, 0, 1] }] }
    ]
  });
  assert.ok(
    validateRawAnimation(duplicateRawAnimation, skeleton).some((issue) =>
      issue.message.includes("duplicate raw animation target channel head[2].rotation")
    ),
    "validateRawAnimation should reject duplicate resolved target channels"
  );
  assert.throws(
    () => new AnimationBuilder().build(duplicateRawAnimation, skeleton),
    /duplicate raw animation target channel/,
    "AnimationBuilder should reject duplicate raw target channels"
  );

  const invalidRawKeyAnimation = createRawAnimation({
    id: "raw-invalid-keys",
    duration: 1,
    tracks: [
      {
        joint: "hips",
        translations: [
          { time: 0.75, value: [0, 0, 0] },
          { time: 0.5, value: [1, 0, 0] }
        ]
      },
      { joint: "spine", translations: [{ time: 1.25, value: [0, 0, 0] }] },
      { joint: "head", translations: [{ time: Number.NaN, value: [0, 0, 0] }] },
      { joint: "leftUpperArm", scales: [{ time: 0, value: [1, Number.POSITIVE_INFINITY, 1] }] }
    ]
  });
  const invalidRawKeyIssues = validateRawAnimation(invalidRawKeyAnimation, skeleton);
  assert.ok(
    invalidRawKeyIssues.some((issue) => issue.message === "raw animation key times must be in strict ascending order"),
    "validateRawAnimation should reject unsorted raw key times"
  );
  assert.ok(
    invalidRawKeyIssues.some(
      (issue) => issue.message === "raw animation key time must be within raw animation duration"
    ),
    "validateRawAnimation should reject raw key times outside the animation duration"
  );
  assert.ok(
    invalidRawKeyIssues.some((issue) => issue.message === "raw animation key time must be finite"),
    "validateRawAnimation should reject non-finite raw key times"
  );
  assert.ok(
    invalidRawKeyIssues.some((issue) => issue.message === "raw animation scale key values must be finite"),
    "validateRawAnimation should reject non-finite raw vector values"
  );

  const invalidQuaternionRawAnimation: RawAnimation = {
    id: "raw-invalid-quaternions",
    duration: 1,
    tracks: [
      {
        joint: "head",
        translations: [],
        rotations: [
          { time: 0, value: [0, 0, 0, 0] },
          { time: 0.5, value: [0, Number.NaN, 0, 1] },
          { time: 1, value: [0, 0, 1] as unknown as [number, number, number, number] }
        ],
        scales: []
      }
    ]
  };
  const invalidQuaternionRawIssues = validateRawAnimation(invalidQuaternionRawAnimation, skeleton);
  assert.ok(
    invalidQuaternionRawIssues.some(
      (issue) => issue.message === "raw animation rotation key quaternion must be normalizable"
    ),
    "validateRawAnimation should reject zero-length raw quaternions"
  );
  assert.ok(
    invalidQuaternionRawIssues.some((issue) => issue.message === "raw animation rotation key values must be finite"),
    "validateRawAnimation should reject non-finite raw quaternion components"
  );
  assert.ok(
    invalidQuaternionRawIssues.some(
      (issue) => issue.message === "raw animation rotation key value must contain exactly 4 values"
    ),
    "validateRawAnimation should reject malformed raw quaternion shapes"
  );

  const emptyRawAnimation = createRawAnimation({ id: "raw-empty", duration: 1 });
  assert.ok(
    validateRawAnimation(emptyRawAnimation).some(
      (issue) => issue.message === "raw animation has no keyed transform channels"
    ),
    "validateRawAnimation should reject empty raw animations"
  );
  assert.equal(tryBuildAnimationFromRawAnimation(emptyRawAnimation).ok, false, "empty raw animations should not build");
  assert.throws(
    () => buildAnimationFromRawAnimation(emptyRawAnimation),
    /no keyed transform channels/,
    "empty raw animation builds should fail explicitly"
  );
  const emptyTrackRawAnimation = createRawAnimation({
    id: "raw-empty-track",
    duration: 1,
    tracks: [{ joint: "head" }]
  });
  assert.ok(
    validateRawAnimation(emptyTrackRawAnimation).some(
      (issue) => issue.message === "raw animation joint track has no transform keys"
    ),
    "validateRawAnimation should reject raw joint tracks with no TRS keys"
  );
  const invalidHeaderRawAnimation = createRawAnimation({
    id: "",
    duration: 0,
    tracks: [{ joint: "head", translations: [{ time: 0, value: [0, 0, 0] }] }]
  });
  assert.ok(
    validateRawAnimation(invalidHeaderRawAnimation).some((issue) => issue.message === "raw animation id is required"),
    "validateRawAnimation should reject missing raw animation ids"
  );
  assert.ok(
    validateRawAnimation(invalidHeaderRawAnimation).some(
      (issue) => issue.message === "raw animation duration must be positive and finite"
    ),
    "validateRawAnimation should reject non-positive raw animation durations"
  );

  const rawUtilityAnimation = createRawAnimation({
    id: "raw-utilities",
    duration: 2,
    tracks: [
      {
        humanBone: "head",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 2, value: [2, 0, 0] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 0.5, value: [0, 0, 0, 1] },
          { time: 2, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2).map((value) => -value) }
        ]
      },
      {
        joint: "spine",
        scales: [
          { time: 0.25, value: [1, 1, 1] },
          { time: 1, value: [2, 2, 2] }
        ]
      },
      {
        joint: "leftUpperArm",
        translations: [
          { time: 0.75, value: [0, 0, 0] },
          { time: 2, value: [0, 2, 0] }
        ]
      }
    ]
  });
  assert.deepEqual(
    extractRawAnimationTimePoints(rawUtilityAnimation, { skeleton }),
    [0, 0.25, 0.5, 0.75, 1, 2],
    "extractRawAnimationTimePoints should return unique sorted raw key times across all TRS channels"
  );
  assert.deepEqual(
    extractRawAnimationTimePoints(rawUtilityAnimation, { skeleton, properties: ["rotation"] }),
    [0, 0.5, 2],
    "raw timepoint extraction should filter by transform property"
  );
  assert.deepEqual(
    extractRawAnimationTimePoints(rawUtilityAnimation, { skeleton, joints: ["spine"] }),
    [0.25, 1],
    "raw timepoint extraction should filter by skeleton joint"
  );
  assert.deepEqual(
    extractRawAnimationTimePoints(rawUtilityAnimation, { skeleton, joints: ["head"], properties: ["translation"] }),
    [0, 2],
    "raw timepoint extraction should combine joint and property filters"
  );
  assert.throws(
    () => extractRawAnimationTimePoints(rawUtilityAnimation, { skeleton, joints: ["missing"] }),
    /raw animation timepoint joint missing was not found/,
    "raw timepoint extraction should reject missing skeleton filter joints"
  );
  assert.throws(
    () => extractRawAnimationTimePoints(emptyRawAnimation),
    /no keyed transform channels/,
    "raw timepoint extraction should reject invalid raw animations"
  );

  const fixedRateSamples = createFixedRateSamplingTimes(1.01, 2);
  assert.equal(
    fixedRateSamples.sampleCount,
    4,
    "fixed-rate sampling should include a clipped final sample when duration is between periods"
  );
  assert.deepEqual(fixedRateSamples.times, [0, 0.5, 1, 1.01]);
  assert.ok(vectorNearlyEqual(fixedRateSamples.ratios, [0, 0.5 / 1.01, 1 / 1.01, 1], 1e-12));
  const zeroDurationFixedRateSamples = createFixedRateSamplingTimes(0, 30);
  assert.deepEqual(
    zeroDurationFixedRateSamples.times,
    [0],
    "zero-duration fixed-rate sampling should produce one bounded sample at time zero"
  );
  assert.deepEqual(zeroDurationFixedRateSamples.ratios, [0], "zero-duration fixed-rate ratios should stay bounded");
  assert.deepEqual(
    createFixedRateSamplingTimes(Number.NaN, 30).times,
    [0],
    "non-finite durations should sanitize to a bounded zero-duration sample"
  );
  assert.throws(
    () => createFixedRateSamplingTimes(1, 0),
    /frequency must be positive and finite/,
    "fixed-rate sampling should reject invalid frequencies"
  );

  const rawUtilityPose = sampleRawAnimation(rawUtilityAnimation, 1, { skeleton, loop: false });
  assert.deepEqual(
    rawUtilityPose[2]!.translation,
    [1, 0, 0],
    "sampleRawAnimation should interpolate raw translation keys onto a skeleton pose"
  );
  assert.ok(
    quaternionNearlyEqual(rawUtilityPose[2]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 6), 1e-5),
    "sampleRawAnimation should interpolate raw rotation keys along the shortest quaternion path"
  );
  assert.deepEqual(
    rawUtilityPose[1]!.scale,
    [2, 2, 2],
    "sampleRawAnimation should clamp to the last raw scale key before the sample time"
  );
  assert.deepEqual(
    rawUtilityPose[0]!.translation,
    [0, 1, 0],
    "sampleRawAnimation should keep rest transforms for unkeyed skeleton joints"
  );
  const rawRatioStartPose = sampleRawAnimationAtRatio(rawUtilityAnimation, Number.NaN, { skeleton });
  const rawRatioEndPose = sampleRawAnimationAtRatio(rawUtilityAnimation, 2, { skeleton });
  assert.deepEqual(
    rawRatioStartPose[2]!.translation,
    [0, 0, 0],
    "raw ratio sampling should clamp non-finite ratios to the first sample"
  );
  assert.deepEqual(
    rawRatioEndPose[2]!.translation,
    [2, 0, 0],
    "raw ratio sampling should clamp ratios above one to the last sample"
  );
  const rawTrackOrderSamples = sampleRawAnimation(rawUtilityAnimation, 1, { loop: false });
  assert.equal(
    rawTrackOrderSamples.length,
    rawUtilityAnimation.tracks.length,
    "sampling raw animation without a skeleton should return raw track-order transforms"
  );
  assert.deepEqual(
    rawTrackOrderSamples[2]!.translation,
    [0, 0.4, 0],
    "raw track-order sampling should use raw track identity defaults without skeleton rest mapping"
  );
  assert.throws(
    () => sampleRawAnimation(missingRawAnimation, 0.5, { skeleton }),
    /raw animation track does not map to skeleton/,
    "sampleRawAnimation should reject skeleton mapping failures"
  );
  assert.throws(
    () => sampleRawAnimation(emptyRawAnimation, 0),
    /no keyed transform channels/,
    "sampleRawAnimation should reject empty raw animations"
  );
  const rawNormalizationAnimation = createRawAnimation({
    id: "raw-normalized-sample",
    duration: 1,
    tracks: [{ joint: "head", rotations: [{ time: 0, value: [0, 0, 0, 2] }] }]
  });
  const rawNormalizationSample = sampleRawAnimation(rawNormalizationAnimation, 0, { skeleton });
  assert.deepEqual(
    rawNormalizationSample[2]!.rotation,
    [0, 0, 0, 1],
    "raw sampling should normalize quaternion samples"
  );
  assert.deepEqual(
    rawNormalizationAnimation.tracks[0]!.rotations[0]!.value,
    [0, 0, 0, 2],
    "raw sampling should not mutate raw quaternion key values"
  );
  rawUtilityPose[2]!.translation[0] = 99;
  assert.deepEqual(
    rawUtilityAnimation.tracks[0]!.translations[0]!.value,
    [0, 0, 0],
    "raw sampled poses should not alias raw translation keys"
  );
  assert.equal(validateAnimationInputs(skeleton, nodClip).accepted, true);
  assert.equal(
    inspectClipAsset(
      { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      nodClip
    ).accepted,
    true
  );

  return { rawBuiltClip, rawBuiltPose };
}
