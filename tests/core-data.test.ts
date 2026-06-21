import {
  AdditiveAnimationBuilder,
  AnimationBuilder,
  AnimationClip,
  AnimationManifest,
  AnimationOptimizer,
  AnimationRuntime,
  AnimationSamplingContext,
  NO_PARENT,
  PACKED_RUNTIME_ANIMATION_FORMAT,
  PACKED_RUNTIME_ANIMATION_VERSION,
  RawAnimation,
  RawSkeletonJoint,
  RawUserTrack,
  Skeleton,
  SkeletonBuilder,
  WAIFU_ANIMATION_BINARY_FORMAT,
  additiveDeltaPose,
  assert,
  buildAdditiveAnimationClip,
  buildAnimationFromRawAnimation,
  buildPackedRuntimeAnimation,
  buildSkeletonFromRawSkeleton,
  buildUserTrack,
  clamp01,
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
  decodeAnimationBinary,
  encodeAnimationBinary,
  extractRawAnimationTimePoints,
  extractRawRootMotion,
  finiteSigned,
  getAnimationClipStats,
  getJointLocalRestPose,
  getPackedRuntimeAnimationStats,
  getRawUserTrackStats,
  identityTransform,
  inspectAnimationAsset,
  inspectClipAsset,
  invertQuat,
  isHumanoidBoneName,
  isLeaf,
  iterateJointsDepthFirst,
  iterateJointsReverseDepthFirst,
  iterateRawSkeletonBreadthFirst,
  iterateRawSkeletonDepthFirst,
  normalizeAdditiveReferenceImportConfig,
  normalizeAnimationOptimizationImportConfig,
  normalizeBakedImportConfig,
  normalizeOzzOfflineImportConfig,
  normalizeQuat,
  normalizeRawMotionExtractionImportConfig,
  normalizeTransform,
  normalizeUserTrackImportSpecs,
  normalizeVec3,
  optimizeRawAnimation,
  optimizeRawUserTrack,
  quatFromAxisAngle,
  readRootMotionMetadata,
  readRootMotionProvenance,
  rejectedAnimationReport,
  sampleClipToPose,
  sampleClipToPoseAtRatio,
  sampleClipToPoseWithContext,
  samplePackedRuntimeAnimationToPose,
  samplePackedRuntimeAnimationToPoseAtRatio,
  sampleRawAnimation,
  sampleRawAnimationAtRatio,
  sampleRawUserTrack,
  sampleUserTrack,
  sanitizeQuaternionTrackValues,
  toAdditiveAnimationOptions,
  toAnimationOptimizerOptions,
  toBakedCameraJointOptions,
  toFloat32Array,
  toRawRootMotionExtractionOptions,
  toRigidInstanceMatrixOptions,
  triggerFloatTrackEdges,
  tryBuildAdditiveAnimationClip,
  tryBuildAnimationFromRawAnimation,
  tryBuildPackedRuntimeAnimation,
  tryBuildUserTrack,
  tryOptimizeRawAnimation,
  usableManifestClips,
  validateAnimationInputs,
  validateAnimationManifestAssets,
  validateClip,
  validateManifest,
  validatePackedRuntimeAnimation,
  validateRawAnimation,
  validateRawSkeleton,
  validateRawUserTrack,
  validateSkeleton,
  validateUserTrack
} from "./test-api.js";
import {
  assertFiniteAnimationSampleError,
  assertFiniteModelSpaceSampleError,
  assertFinitePose,
  binaryFloatByteOffsetForTest,
  createLegacyV1NodBinary,
  invalidValidationStatusManifestEntry,
  makeSourceRestQuaternionClip,
  makeSourceRestQuaternionTrack,
  nodClip,
  quarantinedManifestEntry,
  quaternionNearlyEqual,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runCoreDataTests(): Promise<void> {
  assert.equal(clamp01(2), 1);
  assert.equal(finiteSigned(-0.75, 1), -0.75);
  assert.equal(finiteSigned(Number.NaN, 1), 1);
  assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [1, 0, 0]), [1, 0, 0]);
  assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [2, 0, 0]), [1, 0, 0]);
  assert.deepEqual(normalizeVec3([Infinity, 0, 0], [0, 1, 0]), [0, 1, 0]);
  assert.deepEqual(normalizeVec3([0, 0, 0], [Number.NaN, 0, 0]), [0, 0, 1]);
  const finiteQuatFallback = normalizeQuat([Number.NaN, 0, 0, 1], [0, 0, 0.5, 0.5]);
  assert.ok(Math.abs(finiteQuatFallback[2] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(finiteQuatFallback[3] - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(normalizeQuat([Infinity, 0, 0, 1], [0, 0, 0, 2]), [0, 0, 0, 1]);
  assert.deepEqual(normalizeQuat([0, 0, 0, 0], [Number.NaN, 0, 0, 0]), [0, 0, 0, 1]);
  assert.deepEqual(invertQuat([Number.POSITIVE_INFINITY, 0, 0, 1]), [0, 0, 0, 1]);
  assert.deepEqual(
    Array.from(sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, -1])),
    [0, 0, 0, 1, -0, -0, -0, 1],
    "quaternion track sanitization should keep equivalent samples in the shortest hemisphere"
  );
  const invalidRawUserTrack: RawUserTrack<"float"> = {
    type: "float",
    keyframes: [
      { ratio: 0.4, value: 1, interpolation: "linear" },
      { ratio: 0.4, value: 2, interpolation: "linear" }
    ]
  };
  const invalidRawUserTrackIssues = validateRawUserTrack(invalidRawUserTrack);
  assert.equal(invalidRawUserTrackIssues.some((issue) => issue.message.includes("strict ascending")), true, "raw user tracks should reject duplicate ratios");
  const invalidUserTrackBuild = tryBuildUserTrack(invalidRawUserTrack);
  assert.equal(invalidUserTrackBuild.ok, false, "invalid raw user tracks should not build");
  if (!invalidUserTrackBuild.ok) assert.equal(invalidUserTrackBuild.issues.length > 0, true);
  assert.throws(() => buildUserTrack(invalidRawUserTrack), /strict ascending/, "buildUserTrack should fail explicitly for invalid raw tracks");
  assert.throws(() => optimizeRawUserTrack(invalidRawUserTrack), /strict ascending/, "track optimization should reject invalid raw tracks through validation");
  assert.throws(
    () => optimizeRawUserTrack({ type: "float", keyframes: [{ ratio: 0, value: 0, interpolation: "linear" }] }, { tolerance: Number.NaN }),
    /tolerance/,
    "track optimization should reject invalid tolerances"
  );
  assert.throws(
    () => buildUserTrack({ type: "float", keyframes: [{ ratio: 0, value: Number.NaN, interpolation: "linear" }] }),
    /finite/,
    "buildUserTrack should not allow NaN values to leak into runtime tracks"
  );
  const patchedUserTrack = buildUserTrack({
    type: "float",
    name: "attach-weight",
    keyframes: [
      { ratio: 0.25, value: 10, interpolation: "linear" },
      { ratio: 0.75, value: 20, interpolation: "linear" }
    ]
  });
  assert.equal(patchedUserTrack.name, "attach-weight");
  assert.deepEqual(Array.from(patchedUserTrack.ratios), [0, 0.25, 0.75, 1], "runtime user tracks should be patched to cover [0,1]");
  assert.deepEqual(Array.from(patchedUserTrack.values), [10, 10, 20, 20]);
  assert.equal(sampleRawUserTrack({ type: "float", keyframes: [] }, 0.5), 0, "empty raw float tracks sample to identity");
  const rawTrackStats = getRawUserTrackStats({
    type: "float3",
    name: "stats-track",
    keyframes: [
      { ratio: 0, value: [0, 0, 0], interpolation: "linear" },
      { ratio: 0.5, value: [1, 1, 1], interpolation: "step" },
      { ratio: 1, value: [2, 2, 2], interpolation: "linear" }
    ]
  });
  assert.deepEqual(
    rawTrackStats,
    { type: "float3", name: "stats-track", keyCount: 3, linearKeyCount: 2, stepKeyCount: 1, valueComponentCount: 9 },
    "raw user track stats should report key counts and packed component counts"
  );
  const explicitAdditiveImport = normalizeAdditiveReferenceImportConfig({
    policy: "explicit",
    pose: [identityTransform()],
    source: { filename: "additive_pose.fbx" }
  });
  assert.equal(explicitAdditiveImport.issues.length, 0, "valid additive reference config should normalize without issues");
  assert.equal(explicitAdditiveImport.plan.policy, "explicit-pose");
  assert.equal(explicitAdditiveImport.plan.options.referencePose?.length, 1, "explicit additive references should map to additive builder options");
  assert.deepEqual(explicitAdditiveImport.plan.source, { filename: "additive_pose.fbx" }, "additive config should preserve source metadata");
  const skeletonRestAdditiveImport = normalizeAdditiveReferenceImportConfig({ reference: "skeleton" });
  assert.equal(skeletonRestAdditiveImport.plan.requiresSkeletonRestPose, true, "skeleton additive policy should request skeleton rest pose mapping");
  assert.equal(toAdditiveAnimationOptions(skeletonRestAdditiveImport.plan, skeleton).referencePose?.length, skeleton.joints.length, "skeleton additive policy should map to explicit rest-pose options when a skeleton is provided");
  const invalidAdditiveImport = normalizeAdditiveReferenceImportConfig({ policy: "explicit", pose: [{ translation: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }] });
  assert.equal(invalidAdditiveImport.plan.policy, "first-key", "invalid explicit additive references should fall back to first keyed sample");
  assert.ok(invalidAdditiveImport.issues.length > 0, "invalid additive reference config should report issues");
  const optimizationImport = normalizeAnimationOptimizationImportConfig({
    tolerance: 0.01,
    hierarchyWeight: 0.5,
    override: [{ name: "head", tolerance: 0.001, weight: 4 }],
    diagnostics: { sampleFrequency: 12, includeModelSpace: true },
    source: { config: "optimize" }
  });
  assert.equal(optimizationImport.issues.length, 0, "valid optimization import config should normalize without issues");
  assert.deepEqual(optimizationImport.plan.tolerances, { translation: 0.01, rotation: 0.01, scale: 0.01 });
  assert.equal(optimizationImport.plan.options.jointTolerances?.head?.translation, 0.001, "optimization import config should map per-joint overrides");
  assert.equal(optimizationImport.plan.diagnostics && optimizationImport.plan.diagnostics.sampleFrequency, 12, "optimization diagnostics should preserve sample frequency");
  assert.deepEqual(optimizationImport.plan.source, { config: "optimize" }, "optimization config should preserve source metadata");
  const invalidOptimizationImport = normalizeAnimationOptimizationImportConfig({
    tolerances: { translation: -1, rotation: Number.NaN },
    hierarchyWeight: -2,
    override: [{ name: "head", weight: 0 }]
  });
  assert.ok(invalidOptimizationImport.issues.length >= 3, "invalid optimization config should report tolerance and weight issues");
  assert.equal(Number.isFinite(invalidOptimizationImport.plan.tolerances.translation), true, "invalid optimization tolerances should fall back to finite defaults");
  const importOptimizerRaw = createRawAnimation({
    id: "import-optimizer",
    duration: 1,
    tracks: [
      {
        joint: "hips",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 0.5, value: [0.5, 0, 0] },
          { time: 1, value: [1, 0, 0] }
        ]
      }
    ]
  });
  const mappedOptimizationOptions = toAnimationOptimizerOptions(
    normalizeAnimationOptimizationImportConfig({ tolerances: { translation: 0.001 }, hierarchyWeight: 0 }).plan,
    skeleton
  );
  const mappedOptimizationResult = tryOptimizeRawAnimation(importOptimizerRaw, mappedOptimizationOptions);
  assert.equal(mappedOptimizationResult.ok, true, "normalized optimization options should be accepted by the existing raw optimizer");
  const motionImport = normalizeRawMotionExtractionImportConfig({
    carrier: { joint: "hips" },
    translation: { axes: ["x", "z"], reference: "absolute", bake: true, loop: true },
    rotation: { axes: ["y"], reference: "animation", bake: false, loop: true },
    rawAnimationId: "motion-in-place",
    source: { take: "walk" }
  });
  assert.equal(motionImport.issues.length, 0, "valid raw motion extraction config should normalize without issues");
  assert.deepEqual(motionImport.plan.translation?.axes, { x: true, y: false, z: true }, "motion translation axes should map to extraction options");
  assert.equal(motionImport.plan.rotation?.mode, "yaw", "yaw-only rotation axes should map to yaw extraction");
  assert.equal(motionImport.plan.nonMutatingBake, true, "baked motion config should expose non-mutating bake intent");
  assert.deepEqual(motionImport.plan.source, { take: "walk" }, "motion config should preserve source metadata");
  const invalidMotionImport = normalizeRawMotionExtractionImportConfig({
    translation: { axes: ["x", "w"], reference: "bad" },
    rotation: { axes: 123, mode: "pitch" }
  });
  assert.ok(invalidMotionImport.issues.length >= 3, "invalid motion config should report bad axes, references, and modes");
  const importMotionRaw = createRawAnimation({
    id: "import-motion",
    duration: 1,
    tracks: [
      {
        joint: "hips",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [2, 1, 3] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2) }
        ]
      }
    ]
  });
  const mappedMotionExtraction = extractRawRootMotion(skeleton, importMotionRaw, toRawRootMotionExtractionOptions(motionImport.plan));
  assert.notEqual(mappedMotionExtraction.rawAnimation, importMotionRaw, "raw motion extraction config should still use the existing non-mutating raw extraction path");
  assert.equal(mappedMotionExtraction.rawAnimation.id, "motion-in-place", "raw motion extraction config should preserve requested output raw animation id");
  assert.equal(mappedMotionExtraction.motion.position?.type, "float3", "raw motion extraction config should create position user tracks");
  assert.equal(mappedMotionExtraction.motion.rotation?.type, "quaternion", "raw motion extraction config should create rotation user tracks");
  const userTrackImport = normalizeUserTrackImportSpecs({
    animations: [
      {
        filename: "robot_animation.ozz",
        tracks: {
          properties: [
            { type: "float1", joint_name: "thumb2", property_name: "grasp", filename: "robot_track_grasp.ozz", interpolation: "step" }
          ]
        }
      }
    ]
  });
  assert.equal(userTrackImport.issues.length, 0, "valid user-channel import specs should normalize without issues");
  assert.equal(userTrackImport.plan.tracks[0]?.name, "thumb2.grasp", "user-channel specs should derive stable track names from source properties");
  assert.equal(userTrackImport.plan.tracks[0]?.type, "float", "Ozz float1 user properties should map to Waifu float tracks");
  assert.equal(userTrackImport.plan.tracks[0]?.interpolation, "step", "user-channel specs should preserve default interpolation metadata");
  assert.equal(userTrackImport.plan.tracks[0]?.source.outputFilename, "robot_track_grasp.ozz", "user-channel specs should preserve future importer output metadata");
  const invalidUserTrackImport = normalizeUserTrackImportSpecs([{ type: "bool", joint_name: "thumb2", property_name: "grasp" }]);
  assert.equal(invalidUserTrackImport.plan.tracks.length, 0, "unsupported user-channel types should be rejected from the normalized plan");
  assert.ok(invalidUserTrackImport.issues.some((issue) => issue.path.endsWith(".type")), "unsupported user-channel types should report explicit type issues");
  const bakedImport = normalizeBakedImportConfig({
    skeleton: { import: { types: { geometry: true, camera: true } } },
    camera: { includes: "Camera", caseSensitive: false },
    rigidInstances: { includes: ["spine"], excludes: ["head"], count: 2 }
  });
  assert.equal(bakedImport.issues.length, 0, "valid baked config should normalize without issues");
  assert.equal(bakedImport.plan.skeletonNodeTypes.geometry, true, "baked config should preserve geometry-as-joints import intent");
  assert.equal(toBakedCameraJointOptions(bakedImport.plan).includes, "Camera", "baked camera metadata should map to baked camera helper options");
  assert.deepEqual(toRigidInstanceMatrixOptions(bakedImport.plan, skeleton).jointIndices, [1], "baked rigid filters should resolve to helper joint indices when a skeleton is available");
  const invalidBakedImport = normalizeBakedImportConfig({ rigidInstances: { jointIndices: [0, -1, Number.NaN], fallbackMatrix: [Number.NaN] } });
  assert.ok(invalidBakedImport.issues.length >= 2, "invalid baked rigid options should report bad joint indices and matrices");
  const combinedImport = normalizeOzzOfflineImportConfig({
    source: { file: "robot.fbx" },
    additive_reference: "default",
    optimization_settings: { tolerance: 0.002, distance: 0.707 },
    animations: [
      {
        filename: "robot_animation.ozz",
        tracks: {
          properties: [{ type: "float1", joint_name: "thumb2", property_name: "grasp", filename: "robot_track_grasp.ozz" }]
        }
      }
    ],
    skeleton: { import: { types: { geometry: true } } }
  });
  assert.equal(combinedImport.plan.additive.policy, "first-key", "combined importer plan should normalize additive reference policy");
  assert.equal(combinedImport.plan.optimization.hierarchyWeight, 0.707, "combined importer plan should map Ozz distance to hierarchy weighting");
  assert.equal(combinedImport.plan.userTracks.tracks[0]?.source.animationName, "robot_animation.ozz", "combined importer plan should preserve animation source metadata for future tooling");
  assert.equal(combinedImport.plan.baked.skeletonNodeTypes.geometry, true, "combined importer plan should preserve baked skeleton node-type metadata");
  const optimizedIdentityTrack = optimizeRawUserTrack({
    type: "float3",
    name: "identity-track",
    keyframes: [
      { ratio: 0.2, value: [0, 0, 0], interpolation: "linear" },
      { ratio: 0.4, value: [0, 0, 0], interpolation: "linear" },
      { ratio: 0.8, value: [0, 0, 0], interpolation: "linear" }
    ]
  });
  assert.equal(optimizedIdentityTrack.track.name, "identity-track", "track optimization should preserve names");
  assert.equal(optimizedIdentityTrack.track.keyframes.length, 0, "identity linear tracks should reduce to no keys");
  assert.equal(optimizedIdentityTrack.removedKeyCount, 3, "optimization stats should count removed keys");
  const optimizedConstantTrack = optimizeRawUserTrack({
    type: "float2",
    keyframes: [
      { ratio: 0.2, value: [4, 6], interpolation: "linear" },
      { ratio: 0.5, value: [4, 6], interpolation: "linear" },
      { ratio: 0.8, value: [4, 6], interpolation: "linear" }
    ]
  });
  assert.deepEqual(optimizedConstantTrack.track.keyframes, [{ ratio: 0.2, value: [4, 6], interpolation: "linear" }], "constant non-identity tracks should reduce to one key");
  const optimizedStepTrack = optimizeRawUserTrack({
    type: "float",
    keyframes: [
      { ratio: 0.2, value: 0, interpolation: "linear" },
      { ratio: 0.4, value: 0, interpolation: "step" },
      { ratio: 0.8, value: 0, interpolation: "linear" }
    ]
  });
  assert.deepEqual(
    optimizedStepTrack.track.keyframes,
    [
      { ratio: 0.2, value: 0, interpolation: "linear" },
      { ratio: 0.4, value: 0, interpolation: "step" }
    ],
    "step keys needed for held segments should not be optimized away"
  );
  const optimizedLinearTrack = optimizeRawUserTrack({
    type: "float4",
    keyframes: [
      { ratio: 0, value: [6.9, 0, 0, 0], interpolation: "linear" },
      { ratio: 0.25, value: [4.6, 0, 0, 0], interpolation: "linear" },
      { ratio: 0.5, value: [2.3, 0, 0, 0], interpolation: "linear" },
      { ratio: 0.500001, value: [2.300001, 0, 0, 0], interpolation: "linear" },
      { ratio: 0.75, value: [0, 0, 0, 0], interpolation: "linear" },
      { ratio: 1, value: [0, 0, 0, 0], interpolation: "linear" }
    ]
  });
  assert.deepEqual(
    optimizedLinearTrack.track.keyframes,
    [
      { ratio: 0, value: [6.9, 0, 0, 0], interpolation: "linear" },
      { ratio: 0.75, value: [0, 0, 0, 0], interpolation: "linear" }
    ],
    "interpolable linear vector keys should be removed within tolerance"
  );
  const strictLinearTrack = optimizeRawUserTrack(
    {
      type: "float",
      keyframes: [
        { ratio: 0, value: 0, interpolation: "linear" },
        { ratio: 0.5, value: 0.01, interpolation: "linear" },
        { ratio: 1, value: 0, interpolation: "linear" }
      ]
    },
    { tolerance: 0.001 }
  );
  const looseLinearTrack = optimizeRawUserTrack(
    {
      type: "float",
      keyframes: [
        { ratio: 0, value: 0, interpolation: "linear" },
        { ratio: 0.5, value: 0.01, interpolation: "linear" },
        { ratio: 1, value: 0, interpolation: "linear" }
      ]
    },
    { tolerance: 0.02 }
  );
  assert.equal(strictLinearTrack.track.keyframes.length, 3, "strict tolerance should keep visible deviations");
  assert.equal(looseLinearTrack.track.keyframes.length, 0, "loose tolerance should remove near-identity deviations");
  const rawShortestQuatTrack: RawUserTrack<"quaternion"> = {
    type: "quaternion",
    name: "shortest-rotation",
    keyframes: [
      { ratio: 0, value: [0, 0, 0, -1], interpolation: "linear" },
      { ratio: 0.5, value: [0, 0, 0, 1], interpolation: "linear" },
      { ratio: 1, value: [0, 0, 0, -1], interpolation: "linear" }
    ]
  };
  const optimizedShortestQuatTrack = optimizeRawUserTrack(rawShortestQuatTrack);
  assert.equal(optimizedShortestQuatTrack.track.keyframes.length, 0, "sign-equivalent identity quaternions should optimize away");
  assert.ok(
    quaternionNearlyEqual(sampleRawUserTrack(rawShortestQuatTrack, 0.25) as readonly number[], sampleRawUserTrack(optimizedShortestQuatTrack.track, 0.25) as readonly number[], 1e-6),
    "optimized quaternion tracks should preserve shortest-path normalized sampling equivalence"
  );
  const invalidRuntimeUserTrack = {
    type: "float" as const,
    name: "bad-runtime",
    ratios: new Float32Array([0, 0]),
    values: new Float32Array([1, 2]),
    steps: new Uint8Array([0, 0])
  };
  assert.equal(validateUserTrack(invalidRuntimeUserTrack).some((issue) => issue.message.includes("strict ascending")), true);
  assert.throws(() => sampleUserTrack(invalidRuntimeUserTrack, 0.5), /strict ascending/, "runtime user track sampling should fail explicitly on invalid buffers");
  const mixedFloatUserTrack = buildUserTrack({
    type: "float",
    keyframes: [
      { ratio: 0, value: 0, interpolation: "linear" },
      { ratio: 0.5, value: 4.6, interpolation: "step" },
      { ratio: 0.7, value: 9.2, interpolation: "linear" },
      { ratio: 0.9, value: 0, interpolation: "linear" }
    ]
  });
  assert.ok(Math.abs(sampleUserTrack(mixedFloatUserTrack, 0.25) - 2.3) < 1e-5, "float user tracks should linearly interpolate");
  assert.ok(Math.abs(sampleUserTrack(mixedFloatUserTrack, 0.6) - 4.6) < 1e-5, "step user keys should hold the previous value");
  assert.ok(Math.abs(sampleUserTrack(mixedFloatUserTrack, 0.8) - 4.6) < 1e-5, "linear interpolation resumes after a step segment");
  assert.equal(sampleUserTrack(mixedFloatUserTrack, -1), 0, "user track sampling should clamp ratios below zero");
  assert.equal(sampleUserTrack(mixedFloatUserTrack, 2), 0, "user track sampling should clamp ratios above one");
  const float2UserTrack: RawUserTrack<"float2"> = {
    type: "float2",
    keyframes: [
      { ratio: 0, value: [0, 0], interpolation: "linear" },
      { ratio: 1, value: [2, 4], interpolation: "linear" }
    ]
  };
  const float3UserTrack: RawUserTrack<"float3"> = {
    type: "float3",
    keyframes: [
      { ratio: 0, value: [0, 0, 0], interpolation: "linear" },
      { ratio: 1, value: [2, 4, 6], interpolation: "linear" }
    ]
  };
  const float4UserTrack: RawUserTrack<"float4"> = {
    type: "float4",
    keyframes: [
      { ratio: 0, value: [0, 0, 0, 0], interpolation: "linear" },
      { ratio: 1, value: [2, 4, 6, 8], interpolation: "linear" }
    ]
  };
  assert.deepEqual(sampleUserTrack(buildUserTrack(float2UserTrack), 0.25), [0.5, 1]);
  assert.deepEqual(sampleUserTrack(buildUserTrack(float3UserTrack), 0.5), [1, 2, 3]);
  assert.deepEqual(sampleUserTrack(buildUserTrack(float4UserTrack), 0.25), [0.5, 1, 1.5, 2]);
  const shortestUserTrackEnd = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const shortestUserTrack: RawUserTrack<"quaternion"> = {
    type: "quaternion",
    keyframes: [
      { ratio: 0, value: [0, 0, 0, 1], interpolation: "linear" },
      {
        ratio: 1,
        value: [-shortestUserTrackEnd[0], -shortestUserTrackEnd[1], -shortestUserTrackEnd[2], -shortestUserTrackEnd[3]],
        interpolation: "linear"
      }
    ]
  };
  assert.ok(
    quaternionNearlyEqual(sampleUserTrack(buildUserTrack(shortestUserTrack), 0.5) as readonly number[], quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "quaternion user tracks should use shortest-path normalized interpolation"
  );
  const squareTriggerTrack = buildUserTrack({
    type: "float",
    keyframes: [
      { ratio: 0, value: 0, interpolation: "step" },
      { ratio: 0.5, value: 2, interpolation: "step" },
      { ratio: 1, value: 0, interpolation: "step" }
    ]
  });
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0, to: 1, threshold: 1 }), [
    { ratio: 0.5, rising: true },
    { ratio: 1, rising: false }
  ]);
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 1, to: 0, threshold: 1 }), [
    { ratio: 1, rising: true },
    { ratio: 0.5, rising: false }
  ]);
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0, to: 2, threshold: 1 }), [
    { ratio: 0.5, rising: true },
    { ratio: 1, rising: false },
    { ratio: 1.5, rising: true },
    { ratio: 2, rising: false }
  ]);
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 2, to: 0, threshold: 1 }), [
    { ratio: 2, rising: true },
    { ratio: 1.5, rising: false },
    { ratio: 1, rising: true },
    { ratio: 0.5, rising: false }
  ]);
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0, to: 0.5, threshold: 1 }), [], "edges at to should be excluded");
  assert.deepEqual(triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0.5, to: 1, threshold: 1 }), [
    { ratio: 0.5, rising: true },
    { ratio: 1, rising: false }
  ]);
  const linearTriggerTrack = buildUserTrack({
    type: "float",
    keyframes: [
      { ratio: 0, value: -1, interpolation: "linear" },
      { ratio: 0.5, value: 1, interpolation: "linear" },
      { ratio: 1, value: -1, interpolation: "linear" }
    ]
  });
  assert.deepEqual(triggerFloatTrackEdges({ track: linearTriggerTrack, from: 0, to: 1, threshold: 0 }), [
    { ratio: 0.25, rising: true },
    { ratio: 0.75, rising: false }
  ]);
  assert.throws(() => triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0, to: 3, threshold: 1, maxLoopCount: 2 }), /maxLoopCount/);
  assert.throws(() => triggerFloatTrackEdges({ track: squareTriggerTrack, from: 0, to: 2, threshold: 1, maxEdgeCount: 3 }), /maxEdgeCount/);
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
  const repairedRestSkeleton = createSkeleton([{ name: "root", rest: { translation: [Number.NaN, 5, Infinity], scale: [Number.NaN, 3, -Infinity] } }]);
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
    () =>
      createSkeleton([
        { name: "root" },
        { name: "child", parentIndex: 0.5 }
      ]),
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
      createSkeleton([
        { name: "root" },
        { name: "child", parentIndex: 2 },
        { name: "futureParent", parentIndex: 0 }
      ]),
    /joint child parent must appear before child/,
    "createSkeleton should reject future parent indices"
  );
  assert.throws(
    () =>
      createSkeleton([
        { name: "root" },
        { name: "child", parentName: "missing" }
      ]),
    /joint child parent missing was not found/,
    "createSkeleton should reject missing parent names"
  );
  assert.throws(
    () =>
      createSkeleton([
        { name: "root" },
        { name: "child", parentName: "" }
      ]),
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
    () => createSkeleton([{ name: "root", humanoid: "pelvis" } as unknown as Parameters<typeof createSkeleton>[0][number]]),
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
      (issue) => issue.index === 3 && issue.joint === "leftUpperArm" && issue.message === "duplicate humanoid bone head also assigned to head"
    ),
    "validateSkeleton should report duplicate humanoid bone assignments on malformed skeletons"
  );
  const invalidJointHumanoidSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, humanoid: "pelvis" } : joint))
  } as unknown as Skeleton;
  assert.ok(
    validateSkeleton(invalidJointHumanoidSkeleton).some(
      (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "joint has invalid humanoid bone pelvis"
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
      (issue) => issue.index === 3 && issue.joint === "head" && issue.message === "duplicate joint name also assigned to index 2"
    ),
    "validateSkeleton should report duplicate joint names on externally mutated skeletons"
  );
  const invalidJointNameSkeleton = {
    ...skeleton,
    joints: skeleton.joints.map((joint, index) => (index === 2 ? { ...joint, name: 123 as unknown as string } : joint))
  };
  assert.ok(
    validateSkeleton(invalidJointNameSkeleton).some((issue) => issue.index === 2 && issue.message === "joint has no name"),
    "validateSkeleton should report non-string joint names on externally mutated skeletons"
  );
  const staleParentsSkeleton = {
    ...skeleton,
    parents: Int16Array.from([-1, 0, 0, 1])
  };
  assert.ok(
    validateSkeleton(staleParentsSkeleton).some(
      (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "parents entry does not match joint parent"
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
    restPose: skeleton.restPose.map((transform, index) => (index === 2 ? { ...cloneTransform(transform), translation: [0, 99, 0] as [number, number, number] } : cloneTransform(transform)))
  };
  assert.ok(
    validateSkeleton(staleRestPoseSkeleton).some(
      (issue) => issue.index === 2 && issue.joint === "head" && issue.message === "rest pose entry does not match joint rest"
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
    staleNameToIndexIssues.some((issue) => issue.index === 2 && issue.joint === "head" && issue.message === "nameToIndex entry does not match joint index"),
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
    staleHumanoidIssues.some((issue) => issue.index === 2 && issue.joint === "head" && issue.message === "humanoid map entry head does not match joint index"),
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
    validateSkeleton(invalidHumanoidMapSkeleton).some((issue) => issue.message === "humanoid map entry pelvis has invalid humanoid bone name"),
    "validateSkeleton should report invalid humanoid map entry names"
  );
  const nonMapLookupSkeleton = {
    ...skeleton,
    nameToIndex: {} as Skeleton["nameToIndex"]
  };
  const nonMapLookupReport = validateAnimationInputs(nonMapLookupSkeleton, nodClip);
  assert.equal(nonMapLookupReport.accepted, false, "invalid skeleton lookup maps should make animation inputs unacceptable");
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
  assert.deepEqual(validateSkeleton(validHumanoidHierarchySkeleton), [], "validateSkeleton should accept a coherent humanoid hierarchy");
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
      (issue) => issue.index === 4 && issue.joint === "head" && issue.message === "humanoid bone head must be a descendant of neck"
    ),
    "validateSkeleton should report head mappings outside the neck chain"
  );
  assert.ok(
    invalidHumanoidHierarchyIssues.some(
      (issue) => issue.index === 6 && issue.joint === "leftLowerArm" && issue.message === "humanoid bone leftLowerArm must be a descendant of leftUpperArm"
    ),
    "validateSkeleton should report lower-arm mappings outside the upper-arm chain"
  );
  assert.ok(
    invalidHumanoidHierarchyIssues.some(
      (issue) => issue.index === 9 && issue.joint === "rightFoot" && issue.message === "humanoid bone rightFoot must be a descendant of rightLowerLeg"
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
  assert.throws(() => Array.from(iterateJointsDepthFirst(traversalSkeleton, "missing")), /depth-first traversal joint missing was not found/);

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
              children: [
                { name: "head", humanoid: "head", rest: { translation: [0, 2, 0] } }
              ]
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
  assert.deepEqual(validateRawSkeleton(rawSkeleton), [], "validateRawSkeleton should accept a named roots/children hierarchy");
  assert.equal(countRawSkeletonJoints(rawSkeleton), 7, "countRawSkeletonJoints should count all raw roots and descendants");
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
  assert.equal(builtRawSkeleton.nameToIndex.get("head"), 3, "raw skeleton builder should preserve runtime parent/name lookup maps");
  assert.equal(builtRawSkeleton.joints[builtRawSkeleton.nameToIndex.get("head")!]!.parentIndex, builtRawSkeleton.nameToIndex.get("neck"));
  assert.equal(builtRawSkeleton.humanoid.get("head"), 3, "raw skeleton builder should preserve humanoid aliases");
  assert.deepEqual(builtRawSkeleton.restPose[1]!.translation, [0, 1, 0], "raw skeleton builder should clone normalized local rest poses");
  const classBuiltRawSkeleton = new SkeletonBuilder().build(rawSkeleton);
  assert.deepEqual(
    classBuiltRawSkeleton.joints.map((joint) => joint.name),
    builtRawSkeleton.joints.map((joint) => joint.name),
    "SkeletonBuilder should expose the raw-to-runtime build split"
  );
  const editableRawSkeleton = createRawSkeleton();
  assert.deepEqual(validateRawSkeleton(editableRawSkeleton), [], "empty raw skeletons should remain valid editable offline objects");
  const editableRoot = createRawSkeletonJoint({ name: "editableRoot" });
  editableRoot.children.push(createRawSkeletonJoint({ name: "editableChild", rest: { translation: [0, 3, 0] } }));
  editableRawSkeleton.roots.push(editableRoot);
  assert.deepEqual(
    Array.from(iterateRawSkeletonDepthFirst(editableRawSkeleton), (item) => item.joint.name),
    ["editableRoot", "editableChild"],
    "raw skeleton roots and children should remain mutable for offline authoring"
  );
  const clonedRawSkeleton = cloneRawSkeleton(rawSkeleton);
  assert.notEqual(clonedRawSkeleton.roots[0], rawSkeleton.roots[0], "cloneRawSkeleton should create new root joint objects");
  assert.notEqual(clonedRawSkeleton.roots[0]!.children[0], rawSkeleton.roots[0]!.children[0], "cloneRawSkeleton should deep-clone child joints");
  clonedRawSkeleton.roots[0]!.children[0]!.rest!.translation![1] = 99;
  assert.deepEqual(rawSkeleton.roots[0]!.children[0]!.rest!.translation, [0, 1, 0], "cloneRawSkeleton should not alias rest pose arrays");
  rawSkeleton.roots[0]!.children[0]!.rest!.translation![1] = 42;
  assert.deepEqual(builtRawSkeleton.restPose[1]!.translation, [0, 1, 0], "raw skeleton builds should not alias mutable raw rest poses");
  rawSkeleton.roots[0]!.children[0]!.rest!.translation![1] = 1;
  const duplicateRawSkeleton = createRawSkeleton([
    { name: "root", children: [{ name: "dup" }] },
    { name: "dup" }
  ]);
  assert.ok(
    validateRawSkeleton(duplicateRawSkeleton).some((issue) => issue.message === "duplicate raw skeleton joint name also assigned to index 1"),
    "validateRawSkeleton should reject duplicate names across roots and descendants"
  );
  assert.throws(() => buildSkeletonFromRawSkeleton(duplicateRawSkeleton), /duplicate raw skeleton joint name/, "raw skeleton builder should reject duplicate names");
  const cycleRoot: RawSkeletonJoint = createRawSkeletonJoint({ name: "cycleRoot" });
  cycleRoot.children.push(cycleRoot);
  assert.ok(
    validateRawSkeleton({ roots: [cycleRoot] }).some((issue) => issue.message === "raw skeleton contains a cycle"),
    "validateRawSkeleton should report child cycles"
  );
  assert.throws(() => Array.from(iterateRawSkeletonDepthFirst({ roots: [cycleRoot] })), /cycle/, "raw depth-first traversal should guard cycles");
  assert.throws(() => cloneRawSkeleton({ roots: [cycleRoot] }), /cycle/, "cloneRawSkeleton should guard cycles");
  assert.throws(() => buildSkeletonFromRawSkeleton({ roots: [cycleRoot] }), /cycle/, "raw skeleton builder should reject cycles");
  const malformedRawSkeleton = { roots: [{ name: "root" } as RawSkeletonJoint] };
  assert.ok(
    validateRawSkeleton(malformedRawSkeleton).some((issue) => issue.message === "raw skeleton joint children must be an array"),
    "validateRawSkeleton should report malformed raw joints with missing children arrays"
  );
  assert.throws(
    () => buildSkeletonFromRawSkeleton({ roots: [] }),
    /raw skeleton has no joints/,
    "raw skeleton builder should reject empty runtime builds"
  );
  assert.ok(
    validateRawSkeleton({ roots: [{ name: "root", humanoid: "pelvis", children: [] } as unknown as RawSkeletonJoint] }).some(
      (issue) => issue.message === "raw skeleton joint has invalid humanoid bone pelvis"
    ),
    "validateRawSkeleton should reject invalid humanoid identifiers"
  );

  const editableRawAnimationTrack = createRawAnimationJointTrack({ joint: "leftUpperArm" });
  editableRawAnimationTrack.translations.push(
    { time: 0, value: [0, 0, 0] },
    { time: 2, value: [2, 0, 0] }
  );
  editableRawAnimationTrack.rotations.push(
    { time: 0, value: [0, 0, 0, 2] },
    { time: 2, value: [0, 0, 0, -1] }
  );
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
  assert.deepEqual(validateRawAnimation(rawAnimation, skeleton), [], "validateRawAnimation should accept strict raw joint TRS tracks");
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
  assert.deepEqual(rawBuiltPose[3]!.translation, [1, 0, 0], "built raw animation clips should sample as ordinary AnimationClips");
  assert.deepEqual(rawBuiltPose[1]!.scale, [1.5, 1.5, 1.5], "raw scale keys should build into runtime scale tracks");
  assert.ok(
    quaternionNearlyEqual(Array.from(rawBuiltClip.tracks[3]!.values.slice(0, 4)), [0, 0, 0, 1], 1e-6),
    "AnimationBuilder should normalize raw rotation quaternions"
  );
  assert.ok(
    quaternionNearlyEqual(Array.from(rawBuiltClip.tracks[3]!.values.slice(4, 8)), [0, 0, 0, 1], 1e-6),
    "AnimationBuilder should keep adjacent raw rotation keys in the shortest quaternion hemisphere"
  );
  assert.deepEqual(rawAnimation.tracks[0]!.rotations[1]!.value, [0, 0, 0, -1], "AnimationBuilder should not mutate raw rotation key values");
  assert.equal(validateClip(rawBuiltClip, skeleton).length, 0, "built raw animations should pass runtime clip validation");
  assert.equal(buildAnimationFromRawAnimation(rawAnimation, skeleton).tracks.length, rawBuiltClip.tracks.length, "buildAnimationFromRawAnimation should expose the same builder path");

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
  assert.equal(rawOptimizerResult.ok, true, "AnimationOptimizer should return an optimized raw animation for valid input");
  if (rawOptimizerResult.ok) {
    assert.equal(rawOptimizerResult.rawAnimation.id, rawOptimizerSource.id);
    assert.equal(rawOptimizerResult.rawAnimation.name, rawOptimizerSource.name);
    assert.equal(rawOptimizerResult.rawAnimation.loop, true);
    assert.deepEqual(rawOptimizerResult.rawAnimation.metadata, { source: "optimizer-fixture" });
    assert.equal(rawOptimizerResult.stats.inputKeyCount, 9);
    assert.equal(rawOptimizerResult.stats.outputKeyCount, 6);
    assert.equal(rawOptimizerResult.stats.removedKeyCount, 3);
    assert.equal(rawOptimizerResult.rawAnimation.tracks[0]!.translations.length, 2, "linear translation keys should be reduced");
    assert.equal(rawOptimizerResult.rawAnimation.tracks[1]!.scales.length, 2, "linear scale keys should be reduced");
    assert.equal(rawOptimizerResult.rawAnimation.tracks[2]!.rotations.length, 2, "slerp-linear rotation keys should be reduced");
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
    assert.notEqual(rawOptimizerResult.rawAnimation.tracks[0]!.translations, rawOptimizerSource.tracks[0]!.translations);
    const optimizedRuntimeClip = buildAnimationFromRawAnimation(rawOptimizerResult.rawAnimation, skeleton);
    const runtimeSampleError = compareAnimationSampleError(rawOptimizerSource, optimizedRuntimeClip, { skeleton, sampleFrequency: 8 });
    assert.equal(runtimeSampleError.sampleCount, 17);
    assert.ok(runtimeSampleError.translation.max < 1e-5, "raw/runtime sample-error comparison should report preserved translation samples");
    assert.ok(runtimeSampleError.scale.max < 1e-5, "raw/runtime sample-error comparison should report preserved scale samples");
    assert.ok(runtimeSampleError.rotation.max < 1e-5, "raw/runtime sample-error comparison should report preserved shortest-path rotation samples");
  }
  assert.equal(JSON.stringify(rawOptimizerSource), rawOptimizerSourceSnapshot, "raw animation optimization should not mutate source raw animation data");
  const optimizedRawViaFunction = optimizeRawAnimation(rawOptimizerSource, { skeleton, tolerances: { translation: 1e-5, rotation: 1e-5, scale: 1e-5 } });
  assert.equal(optimizedRawViaFunction.tracks[0]!.translations.length, 2, "optimizeRawAnimation should expose the same reduction path");

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
  assert.ok(propagatedSampleError.modelSpace, "sample-error comparison should include model-space diagnostics when requested");
  assert.equal(propagatedSampleError.modelSpace!.position.maxJoint, "tip", "propagated model-space position error should identify the farthest affected descendant");
  assert.ok(
    propagatedSampleError.modelSpace!.joints[1]!.position.max > propagatedSampleError.translation.max,
    "parent translation/rotation should produce model-space position error on an unchanged child joint"
  );
  assert.ok(
    propagatedSampleError.modelSpace!.joints[2]!.position.max > propagatedSampleError.modelSpace!.joints[1]!.position.max,
    "parent rotation should accumulate larger propagated model-space position error on farther descendants"
  );
  assert.ok(
    propagatedSampleError.modelSpace!.joints[2]!.rotation.max >= propagatedSampleError.rotation.max,
    "descendant model-space rotation error should inherit parent rotation differences"
  );
  assertFiniteAnimationSampleError(propagatedSampleError, "propagated model-space raw/raw sample error");

  const propagatedCandidateClip = buildAnimationFromRawAnimation(propagatedCandidateRaw, propagatedErrorSkeleton);
  const propagatedRuntimeModelError = compareAnimationModelSpaceSampleError(propagatedReferenceRaw, propagatedCandidateClip, {
    skeleton: propagatedErrorSkeleton,
    sampleTimes: [1]
  });
  assert.equal(propagatedRuntimeModelError.position.maxJoint, "tip", "raw/runtime model-space comparison should preserve descendant max-joint diagnostics");
  assertFiniteModelSpaceSampleError(propagatedRuntimeModelError, "propagated raw/runtime model-space sample error");

  const propagatedReferenceClip = buildAnimationFromRawAnimation(propagatedReferenceRaw, propagatedErrorSkeleton);
  const identicalRawError = compareAnimationSampleError(propagatedReferenceRaw, propagatedReferenceRaw, {
    skeleton: propagatedErrorSkeleton,
    sampleFrequency: 4,
    includeModelSpace: true
  });
  assert.equal(identicalRawError.translation.max, 0, "identical raw sample comparison should have zero local translation error");
  assert.equal(identicalRawError.rotation.max, 0, "identical raw sample comparison should have zero local rotation error");
  assert.equal(identicalRawError.scale.max, 0, "identical raw sample comparison should have zero local scale error");
  assert.equal(identicalRawError.modelSpace!.position.max, 0, "identical raw sample comparison should have zero model-space position error");
  assert.equal(identicalRawError.modelSpace!.rotation.max, 0, "identical raw sample comparison should have zero model-space rotation error");
  assert.equal(identicalRawError.modelSpace!.scale.max, 0, "identical raw sample comparison should have zero model-space scale error");
  assertFiniteAnimationSampleError(identicalRawError, "identical raw model-space sample error");

  const identicalRuntimeError = compareAnimationSampleError(propagatedReferenceClip, propagatedReferenceClip, {
    skeleton: propagatedErrorSkeleton,
    sampleFrequency: 4,
    includeModelSpace: true
  });
  assert.equal(identicalRuntimeError.modelSpace!.position.max, 0, "identical runtime clip comparison should have zero model-space position error");
  assert.equal(identicalRuntimeError.modelSpace!.rotation.max, 0, "identical runtime clip comparison should have zero model-space rotation error");
  assert.equal(identicalRuntimeError.modelSpace!.scale.max, 0, "identical runtime clip comparison should have zero model-space scale error");
  assertFiniteAnimationSampleError(identicalRuntimeError, "identical runtime model-space sample error");

  const optimizedRawWithSampleDiagnostics = tryOptimizeRawAnimation(rawOptimizerSource, {
    skeleton,
    tolerances: { translation: 1e-5, rotation: 1e-5, scale: 1e-5 },
    sampleError: { sampleFrequency: 8 }
  });
  assert.equal(optimizedRawWithSampleDiagnostics.ok, true, "AnimationOptimizer should attach optional sample-error diagnostics for valid input");
  if (optimizedRawWithSampleDiagnostics.ok) {
    assert.ok(optimizedRawWithSampleDiagnostics.stats.sampleError?.modelSpace, "optimizer sample diagnostics should include propagated model-space error by default");
    assert.ok(optimizedRawWithSampleDiagnostics.stats.sampleError!.modelSpace!.position.max < 1e-5);
    assertFiniteAnimationSampleError(optimizedRawWithSampleDiagnostics.stats.sampleError!, "optimizer model-space sample diagnostics");
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
  const optimizedShortestQuaternionRaw = optimizeRawAnimation(rawOptimizerShortestQuaternion, { skeleton, tolerances: { rotation: 0 } });
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
  const hierarchyLooseOptimization = optimizeRawAnimation(hierarchyToleranceRawAnimation, { skeleton, tolerances: { translation: 0.1 } });
  assert.equal(hierarchyLooseOptimization.tracks[0]!.translations.length, 2, "loose root tolerance should remove small root deviations");
  const hierarchySensitiveOptimization = optimizeRawAnimation(hierarchyToleranceRawAnimation, { skeleton, tolerances: { translation: 0.1 }, hierarchyWeight: 1 });
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
  assert.equal(jointWeightedOptimization.tracks[0]!.translations.length, 3, "per-joint optimizer weights should make matching joints stricter");

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
  assert.notEqual(firstFrameAdditiveClip.tracks[0]!.times, firstFrameAdditiveSourceClip.tracks[0]!.times, "additive builder should not alias source track times");
  assert.equal(validateClip(firstFrameAdditiveClip, skeleton).length, 0, "first-frame additive clips should be valid ordinary AnimationClips");
  const firstFrameStartDelta = additiveDeltaPose(skeleton.restPose, sampleClipToPose(skeleton, firstFrameAdditiveClip, 0.25, { loop: false }));
  assert.ok(vectorNearlyEqual(firstFrameStartDelta[0]!.translation, [0, 0, 0], 1e-6), "default additive builder should use each channel's first key as the translation reference");
  const firstFrameEndDelta = additiveDeltaPose(skeleton.restPose, sampleClipToPose(skeleton, firstFrameAdditiveClip, 1, { loop: false }));
  assert.ok(vectorNearlyEqual(firstFrameEndDelta[0]!.translation, [3, 6, 0], 1e-6), "first-frame additive builder should preserve translation deltas through rest-pose sampling");
  assert.ok(
    quaternionNearlyEqual(firstFrameEndDelta[2]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "first-frame additive builder should encode rotation deltas from the first keyed rotation"
  );
  const runtimeFirstFrameAdditive = new AnimationRuntime(skeleton);
  runtimeFirstFrameAdditive.setLayer("additive", firstFrameAdditiveClip, { time: 1, loop: false, weight: 1, targetWeight: 1, blendMode: "additive" });
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
  const explicitReferenceAdditiveClip = buildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, { referencePose: explicitReferencePose });
  const explicitReferenceDelta = additiveDeltaPose(skeleton.restPose, sampleClipToPose(skeleton, explicitReferenceAdditiveClip, 0, { loop: false }));
  assert.ok(vectorNearlyEqual(explicitReferenceDelta[3]!.translation, [3, 0, 0], 1e-6), "explicit reference poses should drive additive translation deltas");
  assert.ok(
    quaternionNearlyEqual(explicitReferenceDelta[3]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "explicit reference poses should drive additive rotation deltas"
  );
  const shortReferenceAdditiveBuild = tryBuildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, { referencePose: explicitReferencePose.slice(0, 1) });
  assert.equal(shortReferenceAdditiveBuild.ok, false, "additive builder should reject reference poses shorter than the skeleton");
  if (!shortReferenceAdditiveBuild.ok) {
    assert.ok(shortReferenceAdditiveBuild.issues.some((issue) => issue.message.includes("reference pose length 1 does not match skeleton 4")));
  }
  const nonFiniteReferencePose = clonePose(skeleton.restPose);
  nonFiniteReferencePose[0]!.translation = [Number.NaN, 0, 0];
  assert.throws(
    () => buildAdditiveAnimationClip(explicitReferenceAdditiveSourceClip, skeleton, { referencePose: nonFiniteReferencePose }),
    /reference pose transform is not finite/,
    "additive builder should fail clearly on non-finite reference transforms"
  );

  const clonedRawAnimation = cloneRawAnimation(rawAnimation);
  assert.notEqual(clonedRawAnimation, rawAnimation, "cloneRawAnimation should create a new raw animation object");
  assert.notEqual(clonedRawAnimation.tracks[0], rawAnimation.tracks[0], "cloneRawAnimation should clone raw joint tracks");
  clonedRawAnimation.tracks[0]!.translations[0]!.value[0] = 99;
  assert.deepEqual(rawAnimation.tracks[0]!.translations[0]!.value, [0, 0, 0], "cloneRawAnimation should not alias raw translation key values");
  rawAnimation.tracks[0]!.translations[0]!.value[0] = 123;
  assert.equal(rawBuiltClip.tracks[2]!.values[0], 0, "built AnimationClips should not alias mutable raw animation values");
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
  assert.equal(missingRawAnimationBuild.ok, false, "tryBuildAnimationFromRawAnimation should return issues instead of a clip for invalid raw input");
  const missingRawAnimationOptimization = tryOptimizeRawAnimation(missingRawAnimation, { skeleton });
  assert.equal(missingRawAnimationOptimization.ok, false, "tryOptimizeRawAnimation should return issues instead of optimized raw data for invalid input");
  if (!missingRawAnimationOptimization.ok) {
    assert.equal(missingRawAnimationOptimization.rawAnimation, null);
    assert.equal(missingRawAnimationOptimization.stats, null);
    assert.ok(missingRawAnimationOptimization.issues.some((issue) => issue.message === "raw animation track does not map to skeleton"));
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
    validateRawAnimation(duplicateRawAnimation, skeleton).some((issue) => issue.message.includes("duplicate raw animation target channel head[2].rotation")),
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
    invalidRawKeyIssues.some((issue) => issue.message === "raw animation key time must be within raw animation duration"),
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
    invalidQuaternionRawIssues.some((issue) => issue.message === "raw animation rotation key quaternion must be normalizable"),
    "validateRawAnimation should reject zero-length raw quaternions"
  );
  assert.ok(
    invalidQuaternionRawIssues.some((issue) => issue.message === "raw animation rotation key values must be finite"),
    "validateRawAnimation should reject non-finite raw quaternion components"
  );
  assert.ok(
    invalidQuaternionRawIssues.some((issue) => issue.message === "raw animation rotation key value must contain exactly 4 values"),
    "validateRawAnimation should reject malformed raw quaternion shapes"
  );

  const emptyRawAnimation = createRawAnimation({ id: "raw-empty", duration: 1 });
  assert.ok(
    validateRawAnimation(emptyRawAnimation).some((issue) => issue.message === "raw animation has no keyed transform channels"),
    "validateRawAnimation should reject empty raw animations"
  );
  assert.equal(tryBuildAnimationFromRawAnimation(emptyRawAnimation).ok, false, "empty raw animations should not build");
  assert.throws(() => buildAnimationFromRawAnimation(emptyRawAnimation), /no keyed transform channels/, "empty raw animation builds should fail explicitly");
  const emptyTrackRawAnimation = createRawAnimation({ id: "raw-empty-track", duration: 1, tracks: [{ joint: "head" }] });
  assert.ok(
    validateRawAnimation(emptyTrackRawAnimation).some((issue) => issue.message === "raw animation joint track has no transform keys"),
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
    validateRawAnimation(invalidHeaderRawAnimation).some((issue) => issue.message === "raw animation duration must be positive and finite"),
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
          { time: 2, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2).map((value) => -value) as [number, number, number, number] }
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
  assert.equal(fixedRateSamples.sampleCount, 4, "fixed-rate sampling should include a clipped final sample when duration is between periods");
  assert.deepEqual(fixedRateSamples.times, [0, 0.5, 1, 1.01]);
  assert.ok(vectorNearlyEqual(fixedRateSamples.ratios, [0, 0.5 / 1.01, 1 / 1.01, 1], 1e-12));
  const zeroDurationFixedRateSamples = createFixedRateSamplingTimes(0, 30);
  assert.deepEqual(zeroDurationFixedRateSamples.times, [0], "zero-duration fixed-rate sampling should produce one bounded sample at time zero");
  assert.deepEqual(zeroDurationFixedRateSamples.ratios, [0], "zero-duration fixed-rate ratios should stay bounded");
  assert.deepEqual(createFixedRateSamplingTimes(Number.NaN, 30).times, [0], "non-finite durations should sanitize to a bounded zero-duration sample");
  assert.throws(() => createFixedRateSamplingTimes(1, 0), /frequency must be positive and finite/, "fixed-rate sampling should reject invalid frequencies");

  const rawUtilityPose = sampleRawAnimation(rawUtilityAnimation, 1, { skeleton, loop: false });
  assert.deepEqual(rawUtilityPose[2]!.translation, [1, 0, 0], "sampleRawAnimation should interpolate raw translation keys onto a skeleton pose");
  assert.ok(
    quaternionNearlyEqual(rawUtilityPose[2]!.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 6), 1e-5),
    "sampleRawAnimation should interpolate raw rotation keys along the shortest quaternion path"
  );
  assert.deepEqual(rawUtilityPose[1]!.scale, [2, 2, 2], "sampleRawAnimation should clamp to the last raw scale key before the sample time");
  assert.deepEqual(rawUtilityPose[0]!.translation, [0, 1, 0], "sampleRawAnimation should keep rest transforms for unkeyed skeleton joints");
  const rawRatioStartPose = sampleRawAnimationAtRatio(rawUtilityAnimation, Number.NaN, { skeleton });
  const rawRatioEndPose = sampleRawAnimationAtRatio(rawUtilityAnimation, 2, { skeleton });
  assert.deepEqual(rawRatioStartPose[2]!.translation, [0, 0, 0], "raw ratio sampling should clamp non-finite ratios to the first sample");
  assert.deepEqual(rawRatioEndPose[2]!.translation, [2, 0, 0], "raw ratio sampling should clamp ratios above one to the last sample");
  const rawTrackOrderSamples = sampleRawAnimation(rawUtilityAnimation, 1, { loop: false });
  assert.equal(rawTrackOrderSamples.length, rawUtilityAnimation.tracks.length, "sampling raw animation without a skeleton should return raw track-order transforms");
  assert.deepEqual(rawTrackOrderSamples[2]!.translation, [0, 0.4, 0], "raw track-order sampling should use raw track identity defaults without skeleton rest mapping");
  assert.throws(
    () => sampleRawAnimation(missingRawAnimation, 0.5, { skeleton }),
    /raw animation track does not map to skeleton/,
    "sampleRawAnimation should reject skeleton mapping failures"
  );
  assert.throws(() => sampleRawAnimation(emptyRawAnimation, 0), /no keyed transform channels/, "sampleRawAnimation should reject empty raw animations");
  const rawNormalizationAnimation = createRawAnimation({
    id: "raw-normalized-sample",
    duration: 1,
    tracks: [{ joint: "head", rotations: [{ time: 0, value: [0, 0, 0, 2] }] }]
  });
  const rawNormalizationSample = sampleRawAnimation(rawNormalizationAnimation, 0, { skeleton });
  assert.deepEqual(rawNormalizationSample[2]!.rotation, [0, 0, 0, 1], "raw sampling should normalize quaternion samples");
  assert.deepEqual(
    rawNormalizationAnimation.tracks[0]!.rotations[0]!.value,
    [0, 0, 0, 2],
    "raw sampling should not mutate raw quaternion key values"
  );
  rawUtilityPose[2]!.translation[0] = 99;
  assert.deepEqual(rawUtilityAnimation.tracks[0]!.translations[0]!.value, [0, 0, 0], "raw sampled poses should not alias raw translation keys");
  assert.equal(validateAnimationInputs(skeleton, nodClip).accepted, true);
  assert.equal(inspectClipAsset({ id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, nodClip).accepted, true);

  const malformedValidationStatusManifest = {
    version: 1,
    clips: [
      { id: "valid", label: "Valid", url: "/valid.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      invalidValidationStatusManifestEntry,
      { id: "numeric-status", label: "Numeric Status", url: "/numeric-status.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: 1 } },
      quarantinedManifestEntry,
      { id: "rejected", label: "Rejected", url: "/rejected.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: "rejected" } },
      { id: "accepted", label: "Accepted", url: "/accepted.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, validation: { status: "accepted" } },
      { id: "invalid-root-motion-policy", label: "Invalid Root Motion Policy", url: "/invalid-root-motion-policy.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: { policy: "keep-everything" } } },
      { id: "invalid-root-motion-shape", label: "Invalid Root Motion Shape", url: "/invalid-root-motion-shape.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: true } },
      { id: "invalid-root-motion-policy-alias", label: "Invalid Root Motion Policy Alias", url: "/invalid-root-motion-policy-alias.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotionPolicy: "keep-everything" } },
      { id: "invalid-root-motion-provenance", label: "Invalid Root Motion Provenance", url: "/invalid-root-motion-provenance.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, source: { rootMotion: { policy: "stripped-to-in-place", provenance: "converted" } } }
    ]
  } as unknown as AnimationManifest;
  const malformedValidationStatusIssues = validateManifest(malformedValidationStatusManifest);
  assert.ok(
    malformedValidationStatusIssues.includes("typo-status has invalid validation status acceptted"),
    "validateManifest should report typo validation.status values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("numeric-status has invalid validation status 1"),
    "validateManifest should report non-string validation.status values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-policy has invalid source.rootMotion.policy keep-everything"),
    "validateManifest should report invalid source.rootMotion.policy values from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-shape has invalid source.rootMotion metadata"),
    "validateManifest should report malformed source.rootMotion shapes from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-policy-alias has invalid source.rootMotionPolicy keep-everything"),
    "validateManifest should report invalid source.rootMotionPolicy aliases from runtime JSON"
  );
  assert.ok(
    malformedValidationStatusIssues.includes("invalid-root-motion-provenance has invalid source.rootMotion.provenance converted"),
    "validateManifest should report invalid source.rootMotion.provenance values from runtime JSON"
  );
  assert.deepEqual(
    validateManifest({ version: 1 } as unknown as AnimationManifest),
    ["manifest clips must be an array"],
    "validateManifest should report malformed manifests whose clips table is missing"
  );
  const missingIdsManifest = {
    version: 1,
    clips: [
      { id: "", label: "Missing Id A", url: "/missing-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "", label: "Missing Id B", url: "/missing-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
    ]
  } as AnimationManifest;
  const missingIdsManifestIssues = validateManifest(missingIdsManifest);
  assert.equal(
    missingIdsManifestIssues.filter((issue) => issue === "manifest entry is missing id").length,
    2,
    "validateManifest should report each missing id"
  );
  assert.equal(
    missingIdsManifestIssues.some((issue) => issue === "duplicate clip id "),
    false,
    "missing manifest ids should not be classified as duplicate concrete ids"
  );
  assert.deepEqual(
    usableManifestClips(malformedValidationStatusManifest).map((entry) => entry.id),
    ["valid", "accepted"],
    "usableManifestClips should exclude malformed, rejected, and quarantined validation statuses"
  );
  assert.deepEqual(
    rejectedAnimationReport(malformedValidationStatusManifest).map((entry) => [entry.id, entry.reason]),
    [
      ["typo-status", "invalid validation status acceptted"],
      ["numeric-status", "invalid validation status 1"],
      ["quarantined", "manual hold"],
      ["rejected", "manifest marks clip rejected"],
      ["invalid-root-motion-policy", "has invalid source.rootMotion.policy keep-everything"],
      ["invalid-root-motion-shape", "has invalid source.rootMotion metadata"],
      ["invalid-root-motion-policy-alias", "has invalid source.rootMotionPolicy keep-everything"],
      ["invalid-root-motion-provenance", "has invalid source.rootMotion.provenance converted"]
    ],
    "rejectedAnimationReport should surface malformed validation status through the existing rejected logging path"
  );
  const convertedStrippedRootMotionEntry = {
    id: "root-motion-converted-stripped",
    label: "Root Motion Converted Stripped",
    url: "/root-motion-converted-stripped.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "stripped-to-in-place", provenance: "stripped-during-conversion" } }
  };
  assert.deepEqual(
    readRootMotionMetadata(convertedStrippedRootMotionEntry),
    { policy: "stripped-to-in-place", provenance: "stripped-during-conversion" },
    "root-motion metadata should expose conversion-time stripping separately from the runtime policy"
  );
  assert.equal(
    readRootMotionMetadata(
      {
        id: "invalid-root-motion-with-fallback",
        label: "Invalid Root Motion With Fallback",
        url: "/invalid-root-motion-with-fallback.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "keep-everything" }, rootMotionPolicy: "preserved" }
      },
      { ...nodClip, metadata: { rootMotionPolicy: "preserved", rootMotionProvenance: "preserved-in-clip" } }
    ),
    null,
    "invalid source.rootMotion metadata should not fall through to legacy aliases or clip metadata"
  );
  assert.equal(
    readRootMotionMetadata(
      {
        id: "invalid-root-motion-provenance-with-fallback",
        label: "Invalid Root Motion Provenance With Fallback",
        url: "/invalid-root-motion-provenance-with-fallback.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved", provenance: "converted" } }
      },
      { ...nodClip, metadata: { rootMotionPolicy: "preserved", rootMotionProvenance: "preserved-in-clip" } }
    ),
    null,
    "invalid source.rootMotion provenance should not be partially interpreted as a valid policy"
  );
  assert.deepEqual(
    validateManifest({ version: 1, clips: [convertedStrippedRootMotionEntry] }),
    [],
    "valid root-motion provenance metadata should pass manifest validation"
  );
  assert.equal(
    readRootMotionProvenance({
      id: "legacy-stripped",
      label: "Legacy Stripped",
      url: "/legacy-stripped.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    }),
    "unknown",
    "legacy stripped-to-in-place manifests should remain readable with unknown provenance"
  );
  const structurallyInvalidManifest = {
    version: 1,
    clips: [
      { id: "valid", label: "Valid", url: "/valid.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "missing-url", label: "Missing Url", url: "", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "bad-format", label: "Bad Format", url: "/bad-format.json", format: "json" },
      { id: "dup", label: "Duplicate A", url: "/dup-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      { id: "dup", label: "Duplicate B", url: "/dup-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
      {
        id: "accepted-with-reason",
        label: "Accepted With Reason",
        url: "/accepted-with-reason.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        validation: { status: "accepted", reason: "old rejection" }
      }
    ]
  } as AnimationManifest;
  assert.deepEqual(
    usableManifestClips(structurallyInvalidManifest).map((entry) => entry.id),
    ["valid"],
    "usableManifestClips should exclude entries rejected by manifest structure validation"
  );
  assert.deepEqual(
    rejectedAnimationReport(structurallyInvalidManifest).map((entry) => [entry.id, entry.reason]),
    [
      ["missing-url", "missing url"],
      ["bad-format", "unsupported format json"],
      ["dup", "duplicate clip id dup"],
      ["dup", "duplicate clip id dup"],
      ["accepted-with-reason", "accepted but still has rejection reason"]
    ],
    "rejectedAnimationReport should include structural manifest rejection reasons"
  );
  const invalidValidationStatusClipInspection = inspectClipAsset(
    invalidValidationStatusManifestEntry,
    nodClip
  );
  assert.equal(invalidValidationStatusClipInspection.accepted, false);
  assert.ok(
    invalidValidationStatusClipInspection.issues.some((issue) => issue.message === "invalid validation status acceptted"),
    "inspectClipAsset should reject malformed validation.status metadata"
  );
  const invalidValidationStatusAssetInspection = inspectAnimationAsset(
    invalidValidationStatusManifestEntry,
    nodClip,
    skeleton
  );
  assert.equal(invalidValidationStatusAssetInspection.status, "rejected");
  assert.equal(invalidValidationStatusAssetInspection.accepted, false);
  assert.ok(
    invalidValidationStatusAssetInspection.issues.some((issue) => issue.message === "invalid validation status acceptted"),
    "inspectAnimationAsset should reject malformed validation.status metadata"
  );
  const quarantinedAssetInspection = inspectAnimationAsset(
    quarantinedManifestEntry,
    nodClip,
    skeleton
  );
  assert.equal(quarantinedAssetInspection.status, "quarantined");
  assert.equal(quarantinedAssetInspection.accepted, false);
  assert.ok(
    quarantinedAssetInspection.issues.some((issue) => issue.message === "manual hold"),
    "inspectAnimationAsset should preserve manifest quarantine reasons as validation issues"
  );
  const quarantinedAssetValidationReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [quarantinedManifestEntry]
    },
    async () => encodeAnimationBinary(nodClip),
    { skeleton, now: new Date("2026-01-01T00:00:00.000Z") }
  );
  assert.equal(quarantinedAssetValidationReport.accepted, 0);
  assert.equal(quarantinedAssetValidationReport.rejected, 0);
  assert.equal(quarantinedAssetValidationReport.quarantined, 1);
  assert.equal(quarantinedAssetValidationReport.entries[0]!.status, "quarantined");
  assert.equal(quarantinedAssetValidationReport.entries[0]!.accepted, false);

  const unsupportedFormatAssetEntry = {
    id: "unsupported-format-asset",
    label: "Unsupported Format Asset",
    url: "/unsupported-format-asset.json",
    format: "json"
  };
  const unsupportedFormatAssetInspection = inspectAnimationAsset(
    unsupportedFormatAssetEntry,
    nodClip,
    skeleton
  );
  assert.equal(unsupportedFormatAssetInspection.status, "rejected");
  assert.ok(
    unsupportedFormatAssetInspection.issues.some((issue) => issue.message === "unsupported-format-asset has unsupported format json"),
    "inspectAnimationAsset should reject manifest entries whose declared format cannot be decoded as waifuanim binaries"
  );
  const structurallyRejectedAssetFetches: string[] = [];
  const structuralAssetValidationReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        unsupportedFormatAssetEntry,
        { id: "duplicate-asset", label: "Duplicate Asset A", url: "/duplicate-a.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
        { id: "duplicate-asset", label: "Duplicate Asset B", url: "/duplicate-b.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
        {
          id: "accepted-reason-asset",
          label: "Accepted Reason Asset",
          url: "/accepted-reason-asset.waifuanim.bin",
          format: WAIFU_ANIMATION_BINARY_FORMAT,
          validation: { status: "accepted", reason: "stale rejection reason" }
        },
        { id: "valid-asset", label: "Valid Asset", url: "/valid-asset.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
      ]
    },
    async (url) => {
      structurallyRejectedAssetFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(
    structurallyRejectedAssetFetches,
    ["/valid-asset.waifuanim.bin"],
    "asset report validation should not fetch entries already rejected by manifest structure"
  );
  assert.equal(structuralAssetValidationReport.accepted, 1);
  assert.equal(structuralAssetValidationReport.rejected, 4);
  assert.equal(structuralAssetValidationReport.quarantined, 0);
  const duplicateStructuralIssues = structuralAssetValidationReport.entries
    .slice(1, 3)
    .every((entry) => entry.issues.some((issue) => issue.message === "duplicate clip id duplicate-asset"));
  assert.ok(
    duplicateStructuralIssues,
    "asset report validation should reject all duplicate manifest ids before classifying binaries"
  );
  assert.ok(
    structuralAssetValidationReport.entries[3]!.issues.some((issue) => issue.message === "accepted-reason-asset is accepted but still has rejection reason"),
    "asset report validation should not accept entries whose manifest still carries a rejection reason"
  );
  const invalidRootMotionMetadataAssetEntry = {
    id: "invalid-root-motion-metadata-asset",
    label: "Invalid Root Motion Metadata Asset",
    url: "/invalid-root-motion-metadata-asset.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "keep-everything" } }
  };
  const metadataRejectedAssetFetches: string[] = [];
  const metadataRejectedAssetReport = await validateAnimationManifestAssets(
    {
      version: 1,
      clips: [
        invalidValidationStatusManifestEntry,
        invalidRootMotionMetadataAssetEntry,
        { id: "valid-metadata-asset", label: "Valid Metadata Asset", url: "/valid-metadata-asset.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }
      ]
    },
    async (url) => {
      metadataRejectedAssetFetches.push(url);
      return encodeAnimationBinary(nodClip);
    },
    { skeleton }
  );
  assert.deepEqual(
    metadataRejectedAssetFetches,
    ["/valid-metadata-asset.waifuanim.bin"],
    "asset report validation should not fetch entries rejected by manifest metadata validation"
  );
  assert.equal(metadataRejectedAssetReport.accepted, 1);
  assert.equal(metadataRejectedAssetReport.rejected, 2);
  assert.ok(metadataRejectedAssetReport.entries[0]!.issues.some((issue) => issue.message === "invalid validation status acceptted"));
  assert.ok(metadataRejectedAssetReport.entries[1]!.issues.some((issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"));

  const duplicateResolvedChannelClip: AnimationClip = {
    id: "duplicate-resolved-channel",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  const duplicateResolvedChannelReport = validateAnimationInputs(skeleton, duplicateResolvedChannelClip);
  assert.equal(duplicateResolvedChannelReport.accepted, false);
  assert.ok(
    duplicateResolvedChannelReport.clipIssues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")),
    "validateAnimationInputs should reject joint/humanBone aliases that resolve to one rotation channel"
  );
  const duplicateResolvedAsset = inspectAnimationAsset(
    { id: "duplicate-resolved-channel", label: "Duplicate Resolved Channel", url: "/duplicate-resolved-channel.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
    duplicateResolvedChannelClip,
    skeleton
  );
  assert.equal(duplicateResolvedAsset.status, "rejected");
  assert.ok(
    duplicateResolvedAsset.issues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation")),
    "inspectAnimationAsset should surface duplicate resolved target channels"
  );
  assert.equal(
    duplicateResolvedAsset.issues.find((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head[2].rotation"))?.property,
    "rotation",
    "inspectAnimationAsset should preserve clip issue property metadata in asset reports"
  );

  const duplicateDeclaredChannelClip: AnimationClip = {
    id: "duplicate-declared-channel",
    duration: 1,
    tracks: [
      { joint: "head", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  const duplicateDeclaredInspection = inspectClipAsset(
    { id: "duplicate-declared-channel", label: "Duplicate Declared Channel", url: "/duplicate-declared-channel.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT },
    duplicateDeclaredChannelClip
  );
  assert.equal(duplicateDeclaredInspection.accepted, false);
  assert.ok(
    duplicateDeclaredInspection.issues.some((issue) => issue.track === 1 && issue.message.includes("duplicate target channel head.translation")),
    "inspectClipAsset should reject obvious duplicate declared channels without a skeleton"
  );

  const distinctPropertyClip: AnimationClip = {
    id: "distinct-properties",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { joint: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([1, 1, 1]) }
    ]
  };
  assert.equal(validateAnimationInputs(skeleton, distinctPropertyClip).accepted, true, "distinct transform properties on one joint should remain valid");
  assert.equal(
    inspectClipAsset({ id: "distinct-properties", label: "Distinct Properties", url: "/distinct-properties.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, distinctPropertyClip)
      .accepted,
    true,
    "declared channels with distinct normalized properties should remain valid"
  );

  const ambiguousRuntimeTargetClip: AnimationClip = {
    id: "ambiguous-runtime-target",
    duration: 1,
    tracks: [
      {
        joint: "spine",
        humanBone: "head",
        property: "rotation",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  const ambiguousRuntimeTargetIssues = validateClip(ambiguousRuntimeTargetClip, skeleton);
  assert.ok(
    ambiguousRuntimeTargetIssues.some(
      (issue) => issue.track === 0 && issue.joint === "spine" && issue.property === "rotation" && issue.message === "track needs exactly one joint or humanBone target"
    ),
    "validateClip should reject runtime tracks whose joint and humanBone targets disagree"
  );
  const ambiguousRuntimePackedBuild = tryBuildPackedRuntimeAnimation(ambiguousRuntimeTargetClip, skeleton);
  assert.equal(ambiguousRuntimePackedBuild.ok, false, "packed runtime builds should inherit runtime target ambiguity validation");
  const ambiguousRuntimeSampleClip: AnimationClip = {
    id: "ambiguous-runtime-sample",
    duration: 1,
    tracks: [
      {
        joint: "spine",
        humanBone: "head",
        property: "rotation",
        times: toFloat32Array([0]),
        values: toFloat32Array(quatFromAxisAngle([0, 0, 1], Math.PI / 2))
      }
    ]
  };
  const ambiguousRuntimeSamplePose = sampleClipToPose(skeleton, ambiguousRuntimeSampleClip, 0);
  assert.ok(
    quaternionNearlyEqual(ambiguousRuntimeSamplePose[1]!.rotation, skeleton.restPose[1]!.rotation, 1e-6),
    "clip sampling should skip structurally invalid ambiguous target tracks before applying their joint target"
  );
  assert.ok(
    quaternionNearlyEqual(ambiguousRuntimeSamplePose[2]!.rotation, skeleton.restPose[2]!.rotation, 1e-6),
    "clip sampling should skip structurally invalid ambiguous target tracks before applying their humanBone target"
  );
  const ambiguousRuntime = new AnimationRuntime(skeleton);
  ambiguousRuntime.setLayer("ambiguous", ambiguousRuntimeSampleClip, { weight: 1, targetWeight: 1 });
  const ambiguousEvaluation = ambiguousRuntime.evaluate({ diagnostics: true });
  assert.ok(
    ambiguousEvaluation.diagnostics?.some((issue) => issue.track === 0 && issue.message === "track needs exactly one joint or humanBone target"),
    "runtime diagnostics should keep reporting ambiguous track targets"
  );
  assert.ok(
    quaternionNearlyEqual(ambiguousEvaluation.localPose[1]!.rotation, skeleton.restPose[1]!.rotation, 1e-6),
    "runtime evaluation should skip structurally invalid ambiguous target tracks"
  );

  const validSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("valid-source-rest-quaternion");
  assert.equal(validateAnimationInputs(skeleton, validSourceRestQuaternionClip).accepted, true, "valid source rest metadata on quaternion tracks should remain accepted");
  const decodedSourceRestQuaternionClip = decodeAnimationBinary(encodeAnimationBinary(validSourceRestQuaternionClip), "valid-source-rest-quaternion");
  assert.deepEqual(
    Array.from(decodedSourceRestQuaternionClip.tracks[0]!.sourceRestQuaternion ?? []),
    [0, 0, 0, 1],
    "binary roundtrips should preserve source rest quaternion metadata"
  );
  assert.throws(
    () => encodeAnimationBinary({ ...validSourceRestQuaternionClip, tracks: [{ ...validSourceRestQuaternionClip.tracks[0]!, sourceRestQuaternion: toFloat32Array([0, 0, 1]) }] }),
    /animation clip valid-source-rest-quaternion is invalid: track 0 head\.quaternion sourceRestQuaternion must contain exactly 4 values/,
    "binary encoding should reject malformed source rest quaternion metadata before writing a corrupt payload"
  );

  const invalidZeroSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("invalid-zero-source-rest-quaternion", { sourceRestQuaternion: [0, 0, 0, 0] });
  const invalidZeroSourceRestQuaternionReport = validateAnimationInputs(skeleton, invalidZeroSourceRestQuaternionClip);
  assert.equal(invalidZeroSourceRestQuaternionReport.accepted, false);
  assert.ok(
    invalidZeroSourceRestQuaternionReport.clipIssues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "quaternion" &&
        issue.message === "sourceRestQuaternion must be normalizable"
    ),
    "validateAnimationInputs should reject zero-length source rest quaternion metadata"
  );

  const invalidNonUnitSourceRestQuaternionClip: AnimationClip = makeSourceRestQuaternionClip("invalid-non-unit-source-rest-quaternion", { sourceRestQuaternion: [0, 0, 0, 2] });
  const invalidNonUnitSourceRestQuaternionInspection = inspectClipAsset(
    {
      id: "invalid-non-unit-source-rest-quaternion",
      label: "Invalid Non Unit Source Rest Quaternion",
      url: "/invalid-non-unit-source-rest-quaternion.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    invalidNonUnitSourceRestQuaternionClip
  );
  assert.equal(invalidNonUnitSourceRestQuaternionInspection.accepted, false);
  assert.ok(
    invalidNonUnitSourceRestQuaternionInspection.issues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "quaternion" &&
        issue.message === "sourceRestQuaternion must be normalized"
    ),
    "inspectClipAsset should reject non-unit source rest quaternion metadata"
  );

  const invalidSourceRestQuaternionShapeClip: AnimationClip = {
    id: "invalid-source-rest-quaternion-shape",
    duration: 1,
    tracks: [
      makeSourceRestQuaternionTrack({ sourceRestQuaternion: [0, 0, 1] }),
      makeSourceRestQuaternionTrack({ humanBone: "spine", property: "rotation", sourceRestQuaternion: [0, Number.NaN, 0, 1] })
    ]
  };
  const invalidSourceRestQuaternionShapeReport = validateAnimationInputs(skeleton, invalidSourceRestQuaternionShapeClip);
  assert.equal(invalidSourceRestQuaternionShapeReport.accepted, false);
  assert.ok(
    invalidSourceRestQuaternionShapeReport.clipIssues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "quaternion" &&
        issue.message === "sourceRestQuaternion must contain exactly 4 values"
    ),
    "validateAnimationInputs should reject source rest quaternions with the wrong component count"
  );
  assert.ok(
    invalidSourceRestQuaternionShapeReport.clipIssues.some(
      (issue) =>
        issue.track === 1 &&
        issue.joint === "spine" &&
        issue.property === "rotation" &&
        issue.message === "sourceRestQuaternion values must be finite"
    ),
    "validateAnimationInputs should reject non-finite source rest quaternion components"
  );

  const invalidSourceRestQuaternionPropertyClip: AnimationClip = makeSourceRestQuaternionClip("invalid-source-rest-quaternion-property", {
    joint: "head",
    property: "translation",
    values: [0, 0, 0]
  });
  const invalidSourceRestQuaternionPropertyInspection = inspectClipAsset(
    {
      id: "invalid-source-rest-quaternion-property",
      label: "Invalid Source Rest Quaternion Property",
      url: "/invalid-source-rest-quaternion-property.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    invalidSourceRestQuaternionPropertyClip
  );
  assert.equal(invalidSourceRestQuaternionPropertyInspection.accepted, false);
  assert.ok(
    invalidSourceRestQuaternionPropertyInspection.issues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "translation" &&
        issue.message === "sourceRestQuaternion is only valid on rotation tracks"
    ),
    "inspectClipAsset should reject source rest quaternion metadata on non-rotation tracks"
  );
  assert.throws(
    () => encodeAnimationBinary(invalidSourceRestQuaternionPropertyClip),
    /animation clip invalid-source-rest-quaternion-property is invalid: track 0 head\.translation sourceRestQuaternion is only valid on rotation tracks/,
    "binary encoding should reject source rest quaternion metadata on non-rotation tracks"
  );

  const invalidZeroRotationSampleClip: AnimationClip = {
    id: "invalid-zero-rotation-sample",
    duration: 1,
    tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }]
  };
  const invalidZeroRotationSampleReport = validateAnimationInputs(skeleton, invalidZeroRotationSampleClip);
  assert.equal(invalidZeroRotationSampleReport.accepted, false);
  assert.ok(
    invalidZeroRotationSampleReport.clipIssues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "quaternion" &&
        issue.message === "rotation track quaternions must be normalizable"
    ),
    "validateAnimationInputs should reject zero-length rotation samples"
  );
  assert.throws(
    () => encodeAnimationBinary(invalidZeroRotationSampleClip),
    /animation clip invalid-zero-rotation-sample is invalid: track 0 head\.quaternion rotation track quaternions must be normalizable/,
    "binary encoding should reject non-normalizable rotation sample quaternions"
  );

  const invalidNonUnitRotationSampleInspection = inspectClipAsset(
    {
      id: "invalid-non-unit-rotation-sample",
      label: "Invalid Non Unit Rotation Sample",
      url: "/invalid-non-unit-rotation-sample.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "invalid-non-unit-rotation-sample",
      duration: 1,
      tracks: [{ joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }]
    }
  );
  assert.equal(invalidNonUnitRotationSampleInspection.accepted, false);
  assert.ok(
    invalidNonUnitRotationSampleInspection.issues.some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.property === "rotation" &&
        issue.message === "rotation track quaternions must be normalized"
    ),
    "inspectClipAsset should reject materially non-normalized rotation samples"
  );

  const duplicateTrackTimeClip: AnimationClip = {
    id: "duplicate-track-time",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 0]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  };
  assert.equal(validateAnimationInputs(skeleton, duplicateTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, duplicateTrackTimeClip).clipIssues.some((issue) => issue.message === "track times must be sorted"),
    "equal track times should be rejected"
  );
  assert.throws(
    () => encodeAnimationBinary(duplicateTrackTimeClip),
    /animation clip duplicate-track-time is invalid: track 0 head\.translation track times must be sorted/,
    "binary encoding should reject unsorted or duplicate track times"
  );

  const negativeTrackTimeClip: AnimationClip = {
    id: "negative-track-time",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([-0.1, 0.5]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  };
  assert.equal(validateAnimationInputs(skeleton, negativeTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, negativeTrackTimeClip).clipIssues.some((issue) => issue.message === "track time must be within clip duration"),
    "negative track times should be rejected"
  );
  assert.throws(
    () => encodeAnimationBinary(negativeTrackTimeClip),
    /animation clip negative-track-time is invalid: track 0 head\.translation track time must be within clip duration/,
    "binary encoding should reject negative track times"
  );

  const overDurationTrackTimeClip: AnimationClip = {
    id: "over-duration-track-time",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1.1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  };
  assert.equal(validateAnimationInputs(skeleton, overDurationTrackTimeClip).accepted, false);
  assert.ok(
    validateAnimationInputs(skeleton, overDurationTrackTimeClip).clipIssues.some((issue) => issue.message === "track time must be within clip duration"),
    "track times beyond clip duration should be rejected"
  );
  assert.throws(
    () => encodeAnimationBinary(overDurationTrackTimeClip),
    /animation clip over-duration-track-time is invalid: track 0 head\.translation track time must be within clip duration/,
    "binary encoding should reject track times beyond the clip duration"
  );

  const endpointTrackTimeClip: AnimationClip = {
    id: "endpoint-track-time",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
  };
  assert.equal(validateAnimationInputs(skeleton, endpointTrackTimeClip).accepted, true, "endpoint track times should remain accepted");

  const decodedNodClip = decodeAnimationBinary(encodeAnimationBinary(nodClip), "nod");
  assert.equal(decodedNodClip.id, "nod");
  assert.equal(decodedNodClip.tracks.length, 1);
  assert.deepEqual(Array.from(decodedNodClip.tracks[0]!.times), [0, 0.5, 1]);
  assert.ok(decodedNodClip.tracks[0]!.values instanceof Float32Array);
  const decodedLegacyNodClip = decodeAnimationBinary(createLegacyV1NodBinary(), "legacy-nod");
  assert.equal(decodedLegacyNodClip.id, "legacy-nod");
  assert.equal(decodedLegacyNodClip.loop, true);
  assert.equal(decodedLegacyNodClip.tracks.length, 1);
  assert.equal(decodedLegacyNodClip.tracks[0]!.humanBone, "head");
  assert.equal(decodedLegacyNodClip.tracks[0]!.property, "rotation");
  assert.deepEqual(Array.from(decodedLegacyNodClip.tracks[0]!.times), [0, 0.5, 1]);
  assert.ok(
    quaternionNearlyEqual(Array.from(decodedLegacyNodClip.tracks[0]!.values.slice(4, 8)), [0.15, 0, 0, 0.9887], 1e-6),
    "decodeAnimationBinary should read legacy v1 track/string/float offsets using the v1 record size"
  );
  const absentSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 28, 0, true);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 32, 0, true);
  assert.equal(
    decodeAnimationBinary(absentSourceRestFlagBinary, "absent-source-rest-flag").tracks[0]!.sourceRestQuaternion,
    undefined,
    "decodeAnimationBinary should honor a false source-rest presence flag even when legacy offset bytes are non-empty"
  );
  const invalidSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidSourceRestFlagBinary).setUint32(32 + 32, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidSourceRestFlagBinary, "invalid-source-rest-flag"),
    /animation track 0 source-rest presence flag is invalid/,
    "decodeAnimationBinary should reject malformed source-rest presence flags"
  );
  const childDirectionBinaryClip: AnimationClip = {
    id: "binary-child-direction",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        sourceRestChildDirection: toFloat32Array([0, 1, 0]),
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  const absentChildDirectionFlagBinary = encodeAnimationBinary(childDirectionBinaryClip);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 36, 0, true);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 40, 0, true);
  assert.equal(
    decodeAnimationBinary(absentChildDirectionFlagBinary, "absent-child-direction-flag").tracks[0]!.sourceRestChildDirection,
    undefined,
    "decodeAnimationBinary should honor a false source-rest child direction presence flag"
  );
  assert.throws(
    () => encodeAnimationBinary({ ...nodClip, id: "binary-non-finite-duration", duration: Number.NaN }),
    /animation clip binary-non-finite-duration is invalid: clip duration must be positive and finite/,
    "binary encoding should reject non-finite clip durations"
  );
  assert.throws(
    () =>
      encodeAnimationBinary({
        id: "binary-non-finite-values",
        duration: 1,
        tracks: [{ joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, Number.NaN, 0]) }]
      }),
    /animation clip binary-non-finite-values is invalid: track 0 head\.translation track values must be finite/,
    "binary encoding should reject non-finite track values"
  );
  assert.throws(
    () =>
      encodeAnimationBinary({
        id: "binary-non-normalized-rotation",
        duration: 1,
        tracks: [{ joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }]
      }),
    /animation clip binary-non-normalized-rotation is invalid: track 0 head\.rotation rotation track quaternions must be normalized/,
    "binary encoding should reject non-normalized rotation sample quaternions"
  );
  assert.throws(
    () => encodeAnimationBinary(duplicateDeclaredChannelClip),
    /animation clip duplicate-declared-channel is invalid: track 1 head\.translation duplicate target channel head\.translation conflicts with track 0 \(head\.translation\)/,
    "binary encoding should reject duplicate target channels without a skeleton"
  );
  const invalidTargetKindBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidTargetKindBinary).setUint32(32, 99, true);
  assert.throws(
    () => decodeAnimationBinary(invalidTargetKindBinary, "invalid-target-kind"),
    /animation track 0 target kind is invalid/,
    "decodeAnimationBinary should reject unknown target kinds instead of treating them as joint tracks"
  );
  assert.throws(
    () => decodeAnimationBinary(invalidTargetKindBinary.slice(0, invalidTargetKindBinary.byteLength - 1), "misaligned-floats"),
    /animation binary float data is misaligned/,
    "decodeAnimationBinary should reject payloads whose float table is not 4-byte aligned"
  );
  const invalidFlagsBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidFlagsBinary).setUint32(20, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidFlagsBinary, "invalid-flags"),
    /animation binary flags are invalid/,
    "decodeAnimationBinary should reject unknown binary header flags"
  );
  const nonFiniteDurationBinary = encodeAnimationBinary(nodClip);
  new DataView(nonFiniteDurationBinary).setFloat32(16, Number.NaN, true);
  assert.throws(
    () => decodeAnimationBinary(nonFiniteDurationBinary, "non-finite-binary-duration"),
    /animation binary duration must be positive and finite/,
    "decodeAnimationBinary should reject non-finite binary durations before exposing clips"
  );
  const unsortedBinaryTimes = encodeAnimationBinary(endpointTrackTimeClip);
  new Float32Array(unsortedBinaryTimes, binaryFloatByteOffsetForTest(unsortedBinaryTimes))[1] = 0;
  assert.throws(
    () => decodeAnimationBinary(unsortedBinaryTimes, "unsorted-binary-times"),
    /animation track 0 time values must be sorted/,
    "decodeAnimationBinary should reject duplicate or unsorted binary time samples"
  );
  const nonFiniteBinaryValue = encodeAnimationBinary(nodClip);
  new Float32Array(nonFiniteBinaryValue, binaryFloatByteOffsetForTest(nonFiniteBinaryValue))[3] = Number.NaN;
  assert.throws(
    () => decodeAnimationBinary(nonFiniteBinaryValue, "non-finite-binary-value"),
    /animation track 0 values must be finite/,
    "decodeAnimationBinary should reject non-finite binary value samples"
  );

  const rootMotionRotationOnlyClip: AnimationClip = {
    ...nodClip,
    id: "root-motion-walk"
  };
  assert.equal(
    inspectClipAsset({ id: "root-motion-walk", label: "Root Motion Walk", url: "/root-motion-walk.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, rootMotionRotationOnlyClip)
      .accepted,
    false
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "root-motion-walk",
        label: "Root Motion Walk",
        url: "/root-motion-walk.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "stripped-to-in-place" } }
      },
      rootMotionRotationOnlyClip
    ).accepted,
    true
  );
  const convertedStrippedRootMotionInspection = inspectAnimationAsset(
    convertedStrippedRootMotionEntry,
    rootMotionRotationOnlyClip,
    skeleton
  );
  assert.equal(convertedStrippedRootMotionInspection.status, "accepted");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionPolicy, "stripped-to-in-place");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionProvenance, "stripped-during-conversion");
  assert.equal(convertedStrippedRootMotionInspection.rootCarrierTranslationTrackCount, 0);
  assert.equal(convertedStrippedRootMotionInspection.movingRootCarrierTranslationTrackCount, 0);
  const strippedRootMotionMovingHipsInspection = inspectClipAsset(
    {
      id: "root-motion-stripped-moving-hips",
      label: "Root Motion Stripped Moving Hips",
      url: "/root-motion-stripped-moving-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    {
      id: "root-motion-stripped-moving-hips",
      duration: 1,
      tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 0.25]) }]
    }
  );
  assert.equal(strippedRootMotionMovingHipsInspection.accepted, false);
  assert.ok(
    strippedRootMotionMovingHipsInspection.issues.some((issue) => issue.message === "root-motion policy is stripped-to-in-place but root carrier translation still moves"),
    "stripped-to-in-place clips should reject meaningful hips translation motion"
  );
  const noPolicyMovingHipsInspection = inspectClipAsset(
    {
      id: "walk-moving-hips",
      label: "Walk Moving Hips",
      url: "/walk-moving-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "walk-moving-hips",
      duration: 1,
      tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 0.25]) }]
    }
  );
  assert.equal(noPolicyMovingHipsInspection.accepted, false);
  assert.ok(
    noPolicyMovingHipsInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
    "moving hips translation should require an explicit root-motion policy even without root-motion naming"
  );
  const noPolicyMovingRootMetadataInspection = inspectClipAsset(
    {
      id: "walk-moving-root",
      label: "Walk Moving Root",
      url: "/walk-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "walk-moving-root",
      duration: 1,
      metadata: {},
      tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
    }
  );
  assert.equal(noPolicyMovingRootMetadataInspection.accepted, false);
  assert.ok(
    noPolicyMovingRootMetadataInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
    "moving root translation should require an explicit root-motion policy from manifest or clip metadata"
  );
  const nonePolicyMovingRootInspection = inspectClipAsset(
    {
      id: "walk-none-moving-root",
      label: "Walk None Moving Root",
      url: "/walk-none-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "none" } }
    },
    {
      id: "walk-none-moving-root",
      duration: 1,
      tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
    }
  );
  assert.equal(nonePolicyMovingRootInspection.accepted, false);
  assert.ok(
    nonePolicyMovingRootInspection.issues.some((issue) => issue.message === "root-motion policy is none but root carrier translation moves"),
    "policy none should reject moving root carrier translation"
  );
  const playbackWindowInPlaceRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-trimmed-in-place-root",
      label: "Walk Trimmed In Place Root",
      url: "/walk-trimmed-in-place-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      playback: { start: 0.25, end: 0.75 }
    },
    {
      id: "walk-trimmed-in-place-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 0.25, 0.75, 1]),
          values: toFloat32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0])
        }
      ]
    }
  );
  assert.equal(playbackWindowInPlaceRootCarrierInspection.accepted, true);
  assert.equal(
    playbackWindowInPlaceRootCarrierInspection.issues.some(
      (issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy" || issue.message === "root-motion policy is none but root carrier translation moves"
    ),
    false,
    "root carrier motion outside the playback window should not trigger root-motion policy failures for an in-place segment"
  );
  const playbackWindowMovingRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-trimmed-moving-root",
      label: "Walk Trimmed Moving Root",
      url: "/walk-trimmed-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "none" } },
      playback: { start: 0.25, end: 0.75 }
    },
    {
      id: "walk-trimmed-moving-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 0.25, 0.5, 0.75, 1]),
          values: toFloat32Array([0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0.5, 0, 0])
        }
      ]
    }
  );
  assert.equal(playbackWindowMovingRootCarrierInspection.accepted, false);
  assert.ok(
    playbackWindowMovingRootCarrierInspection.issues.some((issue) => issue.message === "root-motion policy is none but root carrier translation moves"),
    "root carrier motion inside the playback window should still trigger root-motion policy failures"
  );
  const invalidPlaybackWindowRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-invalid-playback-root",
      label: "Walk Invalid Playback Root",
      url: "/walk-invalid-playback-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      playback: { start: 0.75, end: 0.25 }
    },
    {
      id: "walk-invalid-playback-root",
      duration: 1,
      tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
    }
  );
  assert.equal(invalidPlaybackWindowRootCarrierInspection.accepted, false);
  assert.ok(
    invalidPlaybackWindowRootCarrierInspection.issues.some((issue) => issue.message === "invalid playback window 0.75..0.25"),
    "invalid playback windows should still be reported"
  );
  assert.equal(
    invalidPlaybackWindowRootCarrierInspection.issues.some((issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"),
    false,
    "invalid playback windows should not add a second root-motion movement failure"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "idle-stripped-stationary-pelvis",
        label: "Idle Stripped Stationary Pelvis",
        url: "/idle-stripped-stationary-pelvis.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "stripped-to-in-place" } }
      },
      {
        id: "idle-stripped-stationary-pelvis",
        duration: 1,
        tracks: [{ joint: "pelvis", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 0, 2, 1.00001, -0.00001, 2.00001]) }]
      }
    ).accepted,
    true,
    "stripped-to-in-place clips should tolerate tiny stationary root-carrier translation noise"
  );
  const preservedRootMotionHeadOnlyClip: AnimationClip = {
    id: "root-motion-head-only",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.1, 0]) }]
  };
  const preservedRootMotionHeadOnlyInspection = inspectClipAsset(
    {
      id: "root-motion-head-only",
      label: "Root Motion Head Only",
      url: "/root-motion-head-only.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    preservedRootMotionHeadOnlyClip
  );
  assert.equal(preservedRootMotionHeadOnlyInspection.accepted, false);
  assert.ok(
    preservedRootMotionHeadOnlyInspection.issues.some((issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"),
    "preserved root-motion clips should not accept arbitrary non-root translation tracks"
  );
  const preservedIdleHeadOnlyInspection = inspectClipAsset(
    {
      id: "idle-head-only",
      label: "Idle Head Only",
      url: "/idle-head-only.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    {
      id: "idle-head-only",
      duration: 1,
      tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.1, 0]) }]
    }
  );
  assert.equal(preservedIdleHeadOnlyInspection.accepted, false);
  assert.ok(
    preservedIdleHeadOnlyInspection.issues.some((issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"),
    "preserved root-motion policy should require a root carrier translation track even without root-motion naming"
  );
  const preservedRootMotionHipsClip: AnimationClip = {
    id: "root-motion-hips",
    duration: 1,
    tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 1]) }]
  };
  assert.equal(
    inspectClipAsset(
      {
        id: "root-motion-hips",
        label: "Root Motion Hips",
        url: "/root-motion-hips.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved" } }
      },
      preservedRootMotionHipsClip
    ).accepted,
    true,
    "preserved root-motion clips should accept hips translation tracks"
  );
  const preservedRootMotionReportInspection = inspectAnimationAsset(
    {
      id: "root-motion-hips-preserved-report",
      label: "Root Motion Hips Preserved Report",
      url: "/root-motion-hips-preserved-report.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", provenance: "preserved-in-clip" } }
    },
    preservedRootMotionHipsClip
  );
  assert.equal(preservedRootMotionReportInspection.rootMotionPolicy, "preserved");
  assert.equal(preservedRootMotionReportInspection.rootMotionProvenance, "preserved-in-clip");
  assert.equal(preservedRootMotionReportInspection.rootCarrierTranslationTrackCount, 1);
  assert.equal(preservedRootMotionReportInspection.movingRootCarrierTranslationTrackCount, 1);
  assert.equal(
    inspectClipAsset(
      {
        id: "idle-preserved-hips",
        label: "Idle Preserved Hips",
        url: "/idle-preserved-hips.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved" } }
      },
      {
        id: "idle-preserved-hips",
        duration: 1,
        tracks: [{ humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 1]) }]
      }
    ).accepted,
    true,
    "preserved root-motion policy should accept hips translation carriers even without root-motion naming"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "walk-clip-metadata-preserved-root",
        label: "Walk Clip Metadata Preserved Root",
        url: "/walk-clip-metadata-preserved-root.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT
      },
      {
        id: "walk-clip-metadata-preserved-root",
        duration: 1,
        metadata: { rootMotionPolicy: "preserved" },
        tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0]) }]
      }
    ).accepted,
    true,
    "preserved clip metadata should accept moving root carrier translation"
  );
  const invalidRootMotionPolicyInspection = inspectAnimationAsset(
    {
      id: "root-motion-walk",
      label: "Root Motion Walk",
      url: "/root-motion-walk.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "keep-everything" } }
    },
    rootMotionRotationOnlyClip
  );
  assert.equal(invalidRootMotionPolicyInspection.status, "rejected");
  assert.equal(invalidRootMotionPolicyInspection.rootMotionPolicy, "none");
  assert.ok(
    invalidRootMotionPolicyInspection.issues.some((issue) => issue.message === "root-motion clip must declare source.rootMotion.policy"),
    "asset validation should use the same root-motion policy interpretation as manifest inspection"
  );
  const invalidNonRootMotionPolicyInspection = inspectClipAsset(
    {
      id: "idle-invalid-root-motion-policy",
      label: "Idle Invalid Root Motion Policy",
      url: "/idle-invalid-root-motion-policy.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "keep-everything" } }
    },
    nodClip
  );
  assert.equal(invalidNonRootMotionPolicyInspection.accepted, false);
  assert.ok(
    invalidNonRootMotionPolicyInspection.issues.some((issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"),
    "inspectClipAsset should reject invalid root-motion metadata even when the clip name is not root-motion"
  );
  assert.equal(
    inspectAnimationAsset(
      { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true, states: ["idle"], source: { category: "idle", posture: "standing" } },
      nodClip,
      skeleton
    ).status,
    "accepted"
  );

  const loopEndpointWarning = "loop endpoints differ; crossfade or seam blending is required";
  const oppositeQuaternionEndpointClip: AnimationClip = {
    id: "opposite-quaternion-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0, 0, -1])
      }
    ]
  };
  const oppositeQuaternionEndpointInspection = inspectAnimationAsset(
    {
      id: "opposite-quaternion-endpoints",
      label: "Opposite Quaternion Endpoints",
      url: "/opposite-quaternion-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    oppositeQuaternionEndpointClip,
    skeleton
  );
  assert.equal(oppositeQuaternionEndpointInspection.status, "accepted", "sign-opposite normalized rotation endpoints should remain valid");
  assert.equal(
    oppositeQuaternionEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "looping rotation endpoints should compare quaternion-equivalent signs"
  );

  const mismatchedTranslationEndpointClip: AnimationClip = {
    id: "mismatched-translation-endpoints",
    duration: 1,
    loop: true,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0.25, 0, 0]) }]
  };
  const mismatchedTranslationEndpointInspection = inspectAnimationAsset(
    {
      id: "mismatched-translation-endpoints",
      label: "Mismatched Translation Endpoints",
      url: "/mismatched-translation-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    mismatchedTranslationEndpointClip,
    skeleton
  );
  const mismatchedTranslationEndpointIssue = mismatchedTranslationEndpointInspection.issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(mismatchedTranslationEndpointIssue, "translation loop endpoint validation should keep raw component behavior");
  assert.equal(mismatchedTranslationEndpointIssue.track, 0);
  assert.equal(mismatchedTranslationEndpointIssue.joint, "head");
  assert.equal(mismatchedTranslationEndpointIssue.property, "translation");
  assert.equal(mismatchedTranslationEndpointIssue.delta, 0.25);
  assert.ok(mismatchedTranslationEndpointIssue.message.includes("delta 0.2500"), "translation seam warning should include measured delta");

  const trimmedMatchedPlaybackEndpointClip: AnimationClip = {
    id: "trimmed-matched-playback-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.75, 1]),
        values: toFloat32Array([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0])
      }
    ]
  };
  const trimmedMatchedPlaybackEndpointInspection = inspectAnimationAsset(
    {
      id: "trimmed-matched-playback-endpoints",
      label: "Trimmed Matched Playback Endpoints",
      url: "/trimmed-matched-playback-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      playback: { start: 0.25, end: 0.75 }
    },
    trimmedMatchedPlaybackEndpointClip,
    skeleton
  );
  assert.equal(
    trimmedMatchedPlaybackEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "loop endpoint validation should compare sampled playback-window endpoints instead of raw keyframe endpoints"
  );

  const trimmedMismatchedPlaybackEndpointClip: AnimationClip = {
    id: "trimmed-mismatched-playback-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.75, 1]),
        values: toFloat32Array([0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0, 0, 0])
      }
    ]
  };
  const trimmedMismatchedPlaybackEndpointIssue = inspectAnimationAsset(
    {
      id: "trimmed-mismatched-playback-endpoints",
      label: "Trimmed Mismatched Playback Endpoints",
      url: "/trimmed-mismatched-playback-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      playback: { start: 0.25, end: 0.75 }
    },
    trimmedMismatchedPlaybackEndpointClip,
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(
    trimmedMismatchedPlaybackEndpointIssue,
    "loop endpoint validation should warn when sampled playback-window endpoints differ even if raw keyframe endpoints match"
  );
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.track, 0);
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.joint, "head");
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.property, "translation");
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.delta, 0.25);

  const inferredLoopEndpointIssue = inspectAnimationAsset(
    {
      id: "inferred-loop-endpoints",
      label: "Inferred Loop Endpoints",
      url: "/inferred-loop-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    { ...mismatchedTranslationEndpointClip, id: "inferred-loop-endpoints" },
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(inferredLoopEndpointIssue, "decoded clip.loop should enable loop endpoint validation when manifest loop is omitted");
  assert.equal(inferredLoopEndpointIssue.track, 0);
  assert.equal(inferredLoopEndpointIssue.joint, "head");
  assert.equal(inferredLoopEndpointIssue.property, "translation");

  const manifestLoopFalseEndpointInspection = inspectAnimationAsset(
    {
      id: "manifest-loop-false-endpoints",
      label: "Manifest Loop False Endpoints",
      url: "/manifest-loop-false-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: false
    },
    { ...mismatchedTranslationEndpointClip, id: "manifest-loop-false-endpoints" },
    skeleton
  );
  assert.equal(manifestLoopFalseEndpointInspection.loop, false, "manifest loop false should override decoded clip.loop in the validation report");
  assert.equal(
    manifestLoopFalseEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "manifest loop false should disable loop endpoint validation even when decoded clip.loop is true"
  );

  const mismatchedRotationEndpointClip: AnimationClip = {
    id: "mismatched-rotation-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0.5, 0, 0.8660254])
      }
    ]
  };
  const mismatchedRotationEndpointIssue = inspectAnimationAsset(
    {
      id: "mismatched-rotation-endpoints",
      label: "Mismatched Rotation Endpoints",
      url: "/mismatched-rotation-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    mismatchedRotationEndpointClip,
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(mismatchedRotationEndpointIssue, "rotation loop endpoint validation should report mismatched rotation endpoints");
  assert.equal(mismatchedRotationEndpointIssue.track, 0);
  assert.equal(mismatchedRotationEndpointIssue.joint, "head");
  assert.equal(mismatchedRotationEndpointIssue.property, "rotation");
  assert.ok((mismatchedRotationEndpointIssue.delta ?? 0) > 0.5, "rotation seam warning should include a meaningful measured delta");

  const malformedLoopEndpointClip: AnimationClip = {
    id: "malformed-loop-endpoints",
    duration: 1,
    loop: true,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0]) }]
  };
  const malformedLoopEndpointInspection = inspectAnimationAsset(
    {
      id: "malformed-loop-endpoints",
      label: "Malformed Loop Endpoints",
      url: "/malformed-loop-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    malformedLoopEndpointClip,
    skeleton
  );
  assert.equal(
    malformedLoopEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "malformed loop endpoint tracks should not crash or emit seam warnings from missing samples"
  );
  assert.ok(
    malformedLoopEndpointInspection.issues.some((issue) => issue.message === "track value count does not match times and stride"),
    "malformed loop endpoint tracks should still report structural validation errors"
  );

  const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
  assert.ok(sampled[2]!.rotation[0] > 0.1);

  const coherentSamplingClip: AnimationClip = {
    id: "coherent-sampling",
    name: "Coherent Sampling",
    duration: 2,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.5, 1, 1.5, 2]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0])
      },
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI)])
      },
      {
        humanBone: "spine",
        property: "scale",
        times: toFloat32Array([0, 2]),
        values: toFloat32Array([1, 1, 1, 2, 3, 4])
      }
    ]
  };
  const coherentSamplingContext = new AnimationSamplingContext(1);
  const coherentFirstPose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.125);
  assert.equal(coherentSamplingContext.snapshot().lastMode, "reset", "first coherent sample should reset the context for the animation");
  assert.equal(coherentSamplingContext.snapshot().maxTracks, coherentSamplingClip.tracks.length, "sampling context should resize to fit track count");
  assert.ok(Math.abs(coherentFirstPose[2]!.translation[0] - 0.5) < 1e-6, "ratio sampling should convert clamped ratios to clip time");
  const coherentReusePose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.2);
  const coherentReuseSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentReuseSnapshot.lastMode, "coherent-forward", "increasing samples should use coherent forward mode");
  assert.ok(coherentReuseSnapshot.reusedTrackCount >= 1, "coherent forward sampling should reuse cached intervals when the sample stays inside them");
  assert.equal(coherentReuseSnapshot.searchedTrackCount, 0, "coherent forward sampling should avoid binary seeking inside cached intervals");
  assert.ok(Math.abs(coherentReusePose[2]!.translation[0] - 0.8) < 1e-6);
  coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.4);
  const coherentAdvanceSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentAdvanceSnapshot.lastMode, "coherent-forward");
  assert.ok(coherentAdvanceSnapshot.advancedTrackCount >= 1, "coherent forward sampling should advance cached intervals when crossing keys");
  const coherentSeekPose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.1);
  const coherentSeekSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentSeekSnapshot.lastMode, "seek", "backward sampling should seek instead of reusing stale forward intervals");
  assert.ok(coherentSeekSnapshot.searchedTrackCount >= 1, "backward sampling should refresh intervals with a bounded search");
  assert.ok(Math.abs(coherentSeekPose[2]!.translation[0] - 0.4) < 1e-6);
  const coherentLoopPose = coherentSamplingContext.sampleTime(skeleton, coherentSamplingClip, 2.25, { loop: true });
  assert.ok(Math.abs(coherentLoopPose[2]!.translation[0] - 0.5) < 1e-6, "time sampling with loop should preserve existing wrapping semantics");
  const ratioClampStartPose = sampleClipToPoseAtRatio(skeleton, coherentSamplingClip, Number.NaN);
  const ratioClampEndPose = sampleClipToPoseAtRatio(skeleton, coherentSamplingClip, 2);
  assert.deepEqual(ratioClampStartPose[2]!.translation, [0, 0, 0], "non-finite ratios should clamp to the first sample");
  assert.deepEqual(ratioClampEndPose[2]!.translation, [4, 0, 0], "out-of-range ratios should clamp to the last sample");
  const changedSamplingClip: AnimationClip = {
    ...coherentSamplingClip,
    id: "coherent-sampling-changed",
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 2]),
        values: toFloat32Array([10, 0, 0, 20, 0, 0])
      }
    ]
  };
  const beforeAnimationChangeInvalidations = coherentSamplingContext.snapshot().invalidationCount;
  const changedPose = coherentSamplingContext.sampleRatio(skeleton, changedSamplingClip, 0.5);
  const changedSnapshot = coherentSamplingContext.snapshot();
  assert.equal(changedSnapshot.lastMode, "reset", "sampling a different animation should invalidate cached intervals");
  assert.equal(changedSnapshot.invalidationCount, beforeAnimationChangeInvalidations + 1);
  assert.deepEqual(changedPose[2]!.translation, [15, 0, 0]);
  const contextFunctionPose = sampleClipToPoseWithContext(skeleton, coherentSamplingClip, 1, coherentSamplingContext, { loop: false });
  assert.deepEqual(contextFunctionPose[2]!.translation, [2, 0, 0], "standalone context sampling should match ordinary time sampling");

  const nonFiniteSamplingClip: AnimationClip = {
    id: "non-finite-context-sampling",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([Number.NaN, Infinity, 1, 2, 3, 4]) },
      { humanBone: "spine", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }
    ]
  };
  const repairedContextPose = new AnimationSamplingContext().sampleTime(skeleton, nonFiniteSamplingClip, 0);
  assertFinitePose(repairedContextPose);
  assert.deepEqual(repairedContextPose[2]!.translation, [0, 0, 1], "context sampling should use the same finite vector repair path as sampleTrack");
  assert.deepEqual(repairedContextPose[1]!.rotation, [0, 0, 0, 1], "context sampling should repair non-normalizable rotation samples");

  const coherentSamplingStats = getAnimationClipStats(coherentSamplingClip, skeleton);
  assert.equal(coherentSamplingStats.duration, 2);
  assert.equal(coherentSamplingStats.trackCount, 3);
  assert.equal(coherentSamplingStats.jointCount, 2);
  assert.equal(coherentSamplingStats.soaTrackCount, 1);
  assert.equal(coherentSamplingStats.timepointCount, 5);
  assert.equal(coherentSamplingStats.translationTrackCount, 1);
  assert.equal(coherentSamplingStats.rotationTrackCount, 1);
  assert.equal(coherentSamplingStats.scaleTrackCount, 1);
  assert.equal(coherentSamplingStats.translationKeyCount, 5);
  assert.equal(coherentSamplingStats.rotationKeyCount, 2);
  assert.equal(coherentSamplingStats.scaleKeyCount, 2);
  assert.equal(coherentSamplingStats.totalKeyCount, 9);
  assert.deepEqual(
    coherentSamplingStats.perTrack.map((track) => [track.track, track.normalizedProperty, track.keyCount, track.jointIndex]),
    [
      [0, "translation", 5, 2],
      [1, "rotation", 2, 2],
      [2, "scale", 2, 1]
    ],
    "clip stats should expose per-track key-controller metadata"
  );

  const packedUnsortedClip: AnimationClip = {
    id: "packed-unsorted",
    name: "Packed Unsorted",
    duration: 2,
    loop: true,
    metadata: { source: "clip", nested: { tags: ["packed"] } },
    tracks: [
      {
        joint: "leftUpperArm",
        property: "quaternion",
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], Math.PI / 2)])
      },
      {
        humanBone: "head",
        property: "position",
        times: toFloat32Array([0, 1, 2]),
        values: toFloat32Array([0, 0, 0, 0, 2, 0, 0, 4, 0])
      },
      {
        joint: "spine",
        property: "scale",
        times: toFloat32Array([0.5, 1.5]),
        values: toFloat32Array([1, 1, 1, 2, 2, 2])
      },
      {
        humanBone: "head",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        sourceRestChildDirection: toFloat32Array([0, 1, 0]),
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  const packedRuntimeAnimation = buildPackedRuntimeAnimation(packedUnsortedClip, skeleton);
  assert.equal(Object.isFrozen(packedRuntimeAnimation), true, "packed runtime animations should be frozen objects");
  assert.equal(Object.isFrozen(packedRuntimeAnimation.times), true, "packed runtime time buffers should be immutable arrays");
  assert.equal(Object.isFrozen(packedRuntimeAnimation.keyControllers[0]), true, "packed key-controller metadata should be immutable");
  assert.equal(packedRuntimeAnimation.archive.format, PACKED_RUNTIME_ANIMATION_FORMAT);
  assert.equal(packedRuntimeAnimation.archive.version, PACKED_RUNTIME_ANIMATION_VERSION);
  assert.equal(packedRuntimeAnimation.archive.clipId, "packed-unsorted");
  assert.equal(packedRuntimeAnimation.archive.clipName, "Packed Unsorted");
  assert.equal(packedRuntimeAnimation.archive.trackCount, 4);
  assert.equal(packedRuntimeAnimation.archive.keyCount, 9);
  assert.equal(packedRuntimeAnimation.archive.iframeCount, 5);
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers.map((controller) => `${controller.joint ?? controller.humanBone}.${controller.normalizedProperty}:${controller.sourceTrack}`),
    ["spine.scale:2", "head.translation:1", "head.rotation:3", "leftUpperArm.rotation:0"],
    "packed runtime animation builder should sort key controllers deterministically by resolved joint and TRS property"
  );
  assert.deepEqual(packedRuntimeAnimation.iframeTable.times, [0, 0.5, 1, 1.5, 2], "packed iframe table should collect unique sorted animation key times");
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers[0]!.seekTable,
    { iframeLowerKeys: [0, 0, 0, 1, 1], iframeUpperKeys: [0, 0, 1, 1, 1] },
    "packed seek tables should clamp and bracket sparse track keys against global iframes"
  );
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers[1]!.seekTable,
    { iframeLowerKeys: [0, 0, 1, 1, 2], iframeUpperKeys: [0, 1, 1, 2, 2] },
    "packed seek tables should mark exact iframe keys and interpolation spans"
  );
  const singleKeyPacked = buildPackedRuntimeAnimation(
    {
      id: "packed-single-key",
      duration: 1,
      tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0.25]), values: toFloat32Array([1, 2, 3]) }]
    },
    skeleton
  );
  assert.deepEqual(singleKeyPacked.keyControllers[0]!.seekTable, { iframeLowerKeys: [0], iframeUpperKeys: [0] }, "single-key packed tracks should seek to their only key");
  const packedRuntimeStats = getPackedRuntimeAnimationStats(packedRuntimeAnimation);
  assert.equal(packedRuntimeStats.format, PACKED_RUNTIME_ANIMATION_FORMAT);
  assert.equal(packedRuntimeStats.version, PACKED_RUNTIME_ANIMATION_VERSION);
  assert.equal(packedRuntimeStats.packedTrackCount, 4);
  assert.equal(packedRuntimeStats.iframeCount, 5);
  assert.equal(packedRuntimeStats.totalKeyCount, 9);
  assert.deepEqual(
    packedRuntimeStats.perTrack.map((track) => [track.track, track.normalizedProperty, track.keyCount, track.jointIndex]),
    [
      [0, "scale", 2, 1],
      [1, "translation", 3, 2],
      [2, "rotation", 2, 2],
      [3, "rotation", 2, 3]
    ],
    "packed runtime stats should expose sorted key-controller metadata"
  );
  for (const time of [-0.25, 0, 0.25, 1, 1.75, 2.25]) {
    const ordinaryPose = sampleClipToPose(skeleton, packedUnsortedClip, time);
    const packedPose = samplePackedRuntimeAnimationToPose(skeleton, packedRuntimeAnimation, time);
    assert.ok(vectorNearlyEqual(packedPose[2]!.translation, ordinaryPose[2]!.translation, 1e-6), `packed head translation should match ordinary sampling at ${time}`);
    assert.ok(vectorNearlyEqual(packedPose[1]!.scale, ordinaryPose[1]!.scale, 1e-6), `packed spine scale should match ordinary sampling at ${time}`);
    assert.ok(quaternionNearlyEqual(packedPose[2]!.rotation, ordinaryPose[2]!.rotation, 1e-6), `packed head rotation should match ordinary sampling at ${time}`);
    assert.ok(quaternionNearlyEqual(packedPose[3]!.rotation, ordinaryPose[3]!.rotation, 1e-6), `packed arm rotation should match ordinary sampling at ${time}`);
  }
  const packedRatioPose = samplePackedRuntimeAnimationToPoseAtRatio(skeleton, packedRuntimeAnimation, 2);
  const ordinaryRatioPose = sampleClipToPoseAtRatio(skeleton, packedUnsortedClip, 2);
  assert.deepEqual(packedRatioPose[2]!.translation, ordinaryRatioPose[2]!.translation, "packed ratio sampling should clamp like ordinary ratio sampling");
  const rawPackedRuntimeAnimation = buildPackedRuntimeAnimation(rawBuiltClip, skeleton);
  const rawPackedPose = samplePackedRuntimeAnimationToPose(skeleton, rawPackedRuntimeAnimation, 1, { loop: false });
  assert.deepEqual(rawPackedPose[3]!.translation, rawBuiltPose[3]!.translation, "packed runtime animations should sample RawAnimation-built clips like ordinary clips");
  assert.deepEqual(rawPackedPose[1]!.scale, rawBuiltPose[1]!.scale, "packed runtime animations should preserve raw-built scale tracks");
  const emptyPackedBuild = tryBuildPackedRuntimeAnimation({ id: "packed-empty", duration: 1, tracks: [] }, skeleton);
  assert.equal(emptyPackedBuild.ok, false, "empty animation clips should not build into packed runtime animations");
  if (!emptyPackedBuild.ok) assert.ok(emptyPackedBuild.issues.some((issue) => issue.message === "clip has no transform tracks"));
  assert.throws(
    () => buildPackedRuntimeAnimation({ id: "packed-empty", duration: 1, tracks: [] }, skeleton),
    /clip has no transform tracks/,
    "packed runtime animation builds should fail explicitly for empty clips"
  );
  const duplicatePackedBuild = tryBuildPackedRuntimeAnimation(
    {
      id: "packed-duplicate",
      duration: 1,
      tracks: [
        { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
        { joint: "head", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
      ]
    },
    skeleton
  );
  assert.equal(duplicatePackedBuild.ok, false, "packed runtime animation builder should reject duplicate resolved channels");
  if (!duplicatePackedBuild.ok) assert.ok(duplicatePackedBuild.issues.some((issue) => issue.message.includes("duplicate target channel")));
  const invalidVersionPacked = {
    ...packedRuntimeAnimation,
    archive: { ...packedRuntimeAnimation.archive, version: 999 }
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(invalidVersionPacked, skeleton).some((issue) => issue.message === "packed runtime animation archive version is unsupported"),
    "packed runtime validation should reject unsupported archive versions"
  );
  const unsortedPacked = {
    ...packedRuntimeAnimation,
    keyControllers: [packedRuntimeAnimation.keyControllers[1]!, packedRuntimeAnimation.keyControllers[0]!, ...packedRuntimeAnimation.keyControllers.slice(2)]
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(unsortedPacked, skeleton).some((issue) => issue.message === "packed key controllers must be sorted"),
    "packed runtime validation should reject out-of-order key controllers"
  );
  const staleSeekTablePacked = {
    ...packedRuntimeAnimation,
    keyControllers: packedRuntimeAnimation.keyControllers.map((controller, index) =>
      index === 1
        ? {
            ...controller,
            seekTable: {
              iframeLowerKeys: [0, 0, 0, 0, 0],
              iframeUpperKeys: [0, 0, 0, 0, 0]
            }
          }
        : controller
    )
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(staleSeekTablePacked, skeleton).some((issue) => issue.message === "packed seek table does not match key times"),
    "packed runtime validation should reject seek tables stale against packed key times"
  );
  const stalePackedTargetKey = {
    ...packedRuntimeAnimation,
    keyControllers: packedRuntimeAnimation.keyControllers.map((controller, index) => (index === 1 ? { ...controller, targetKey: "stale-target" } : controller))
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(stalePackedTargetKey, skeleton).some((issue) => issue.message === "packed key controller targetKey does not match resolved target"),
    "packed runtime validation should reject key controllers whose targetKey no longer matches their resolved target"
  );
  const overlappingPackedBuffersBase = buildPackedRuntimeAnimation(
    {
      id: "packed-overlapping-buffers",
      duration: 1,
      tracks: [
        { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([1, 0, 0]) },
        { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }
      ]
    },
    skeleton
  );
  const overlappingPackedBuffers = {
    ...overlappingPackedBuffersBase,
    keyControllers: overlappingPackedBuffersBase.keyControllers.map((controller, index) =>
      index === 1
        ? {
            ...controller,
            timeOffset: overlappingPackedBuffersBase.keyControllers[0]!.timeOffset,
            valueOffset: overlappingPackedBuffersBase.keyControllers[0]!.valueOffset
          }
        : controller
    )
  } as unknown as typeof overlappingPackedBuffersBase;
  const overlappingPackedBufferIssues = validatePackedRuntimeAnimation(overlappingPackedBuffers, skeleton);
  assert.ok(
    overlappingPackedBufferIssues.some((issue) => issue.message === "packed key controller time ranges must not overlap"),
    "packed runtime validation should reject controllers that alias another controller's time buffer"
  );
  assert.ok(
    overlappingPackedBufferIssues.some((issue) => issue.message === "packed key controller value ranges must not overlap"),
    "packed runtime validation should reject controllers that alias another controller's value buffer"
  );
  const wrongPackedSkeleton = createSkeleton([{ name: "only" }]);
  assert.ok(
    validatePackedRuntimeAnimation(packedRuntimeAnimation, wrongPackedSkeleton).some((issue) => issue.message === "packed key controller does not map to skeleton"),
    "packed runtime validation should keep skeleton target checks explicit"
  );
  assert.throws(
    () => samplePackedRuntimeAnimationToPose(wrongPackedSkeleton, packedRuntimeAnimation, 0),
    /does not map to skeleton/,
    "packed sampling should reject skeletons that cannot resolve packed targets"
  );
  const packedHeadTranslation = packedRuntimeAnimation.keyControllers[1]!;
  packedUnsortedClip.tracks[1]!.times[1] = 0.25;
  packedUnsortedClip.tracks[1]!.values[4] = 99;
  assert.deepEqual(
    packedRuntimeAnimation.times.slice(packedHeadTranslation.timeOffset, packedHeadTranslation.timeOffset + packedHeadTranslation.keyCount),
    [0, 1, 2],
    "packed runtime animations should not alias source clip time arrays"
  );
  assert.equal(packedRuntimeAnimation.values[packedHeadTranslation.valueOffset + 4], 2, "packed runtime animations should not alias source clip value arrays");
  packedUnsortedClip.metadata!.source = "mutated";
  assert.equal(packedRuntimeAnimation.metadata?.source, "clip", "packed runtime metadata should be cloned from source clip metadata");
  assert.throws(() => {
    (packedRuntimeAnimation.times as number[])[0] = 99;
  }, TypeError, "packed runtime arrays should reject mutation");
  assert.throws(() => {
    (packedRuntimeAnimation.metadata as Record<string, unknown>).source = "mutated-again";
  }, TypeError, "packed runtime metadata should reject mutation");
}
