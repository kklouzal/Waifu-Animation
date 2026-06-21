import {
  RawUserTrack,
  assert,
  buildUserTrack,
  clamp01,
  createRawAnimation,
  extractRawRootMotion,
  finiteSigned,
  getRawUserTrackStats,
  identityTransform,
  invertQuat,
  normalizeAdditiveReferenceImportConfig,
  normalizeAnimationOptimizationImportConfig,
  normalizeBakedImportConfig,
  normalizeOzzOfflineImportConfig,
  normalizeQuat,
  normalizeRawMotionExtractionImportConfig,
  normalizeUserTrackImportSpecs,
  normalizeVec3,
  optimizeRawUserTrack,
  quatFromAxisAngle,
  sampleRawUserTrack,
  sampleUserTrack,
  sanitizeQuaternionTrackValues,
  toAdditiveAnimationOptions,
  toAnimationOptimizerOptions,
  toBakedCameraJointOptions,
  toRawRootMotionExtractionOptions,
  toRigidInstanceMatrixOptions,
  triggerFloatTrackEdges,
  tryBuildUserTrack,
  tryOptimizeRawAnimation,
  validateRawUserTrack,
  validateUserTrack
} from "./test-api.js";
import {
  quaternionNearlyEqual,
  skeleton
} from "./test-helpers.js";

export async function runCoreMathTrackTests(): Promise<void> {
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
}
