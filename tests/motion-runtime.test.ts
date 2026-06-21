import {
  AUTHORED_BASE_SOURCE_TRACK_POLICY,
  AUTHORED_BASE_TRACK_POLICY,
  AnimationClip,
  AnimationRuntime,
  BASE_PROCEDURAL_SOURCE_TRACK_POLICY,
  BASE_PROCEDURAL_TRACK_POLICY,
  BoxGeometry,
  BufferGeometry,
  DEFAULT_BLEND_THRESHOLD,
  Float32BufferAttribute,
  InstancedMesh,
  LOCOMOTION_BASE_SOURCE_TRACK_POLICY,
  MeshBasicMaterial,
  MotionAccumulator,
  MotionExtractor,
  MotionSampler,
  NO_PARENT,
  Object3D,
  Pose,
  Quaternion,
  ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY,
  SampleRepairDiagnostic,
  Skeleton,
  Vector3,
  WAIFU_ANIMATION_BINARY_FORMAT,
  additiveDeltaPose,
  applyAdditivePose,
  applySourceTrackPolicy,
  applyThreeLocomotionUpperBodyPosture,
  assert,
  blendMotionDeltas,
  blendPoses,
  buildRigidInstanceMatrices,
  buildSkinningMatrixPalette,
  buildThreeSkinningDebugSegments,
  clonePose,
  cloneTransform,
  composeMat4,
  computeAttachmentTransform,
  computeBoundAttachmentTransform,
  computeBoundAttachmentTransforms,
  computeLocomotionBlendWeights,
  computeRigidInstanceBounds,
  computeSkeletonAttachmentTransform,
  createAttachmentBinding,
  createAttachmentBindings,
  createJointMask,
  createRawAnimation,
  createSkeleton,
  createSubtreeJointMask,
  createThreeAnimationClip,
  createThreeLocomotionUpperBodyTargets,
  createThreeSkinningDebugGeometry,
  diagnoseRetargetingRestAxes,
  extractRawRootMotion,
  extractRootMotion,
  filterTracksByNamePolicy,
  getBakedCameraJointOverride,
  identityTransform,
  inspectClipAsset,
  invertQuat,
  localToModelPose,
  multiplyMat4,
  multiplyQuat,
  normalizeQuat,
  normalizeVec3,
  quatFromAxisAngle,
  quatFromUnitVectors,
  resolveBakedCameraJointIndex,
  retargetQuaternionSample,
  rotateVec3ByQuat,
  sampleClipToPose,
  sampleMotionCarrier,
  sampleMotionIntervalDelta,
  sampleMotionTracks,
  sampleMotionTracksIntervalDelta,
  sampleTrack,
  sanitizeQuaternionTrackValues,
  skinThreeBufferGeometry,
  skinVertices,
  synchronizeLocomotionPlayback,
  toFloat32Array,
  transformPoint,
  updateRigidInstanceMatrixBuffer,
  updateThreeRigidInstanceMatrices,
  validateClip,
  validatePose,
  validateSkinningJob
} from "./test-api.js";
import {
  assertFiniteEvaluation,
  assertMat4NearlyEqual,
  attachArmChain,
  makeAuthoredLoopClip,
  makeTransformTrack,
  nodClip,
  quaternionNearlyEqual,
  signedJointForwardOffset,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runMotionRuntimeTests(): Promise<void> {
  const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
  const motionSkeleton = createSkeleton([
    { name: "root" },
    { name: "hips", parentName: "root", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "spine", parentName: "hips", humanoid: "spine" }
  ]);
  const motionClip: AnimationClip = {
    id: "root-motion",
    duration: 1,
    loop: true,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI)])
      },
      { humanBone: "hips", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 1, 0, 0, 1, 6]) }
    ]
  };
  const defaultRootMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25);
  assert.equal(defaultRootMotionSample.joint, "root", "motion sampling should default to the skeleton root carrier");
  assert.deepEqual(defaultRootMotionSample.transform.translation, [2.5, 0, 0]);
  const humanoidMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { humanBone: "hips" } });
  assert.equal(humanoidMotionSample.jointIndex, 1, "motion sampling should resolve explicit humanoid carriers");
  assert.deepEqual(humanoidMotionSample.transform.translation, [0, 1, 3]);
  const jointMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { joint: "hips" } });
  assert.deepEqual(jointMotionSample.transform.translation, humanoidMotionSample.transform.translation, "motion sampling should resolve explicit joint-name carriers");
  const indexedMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.5, { carrier: { jointIndex: 1 } });
  assert.deepEqual(indexedMotionSample.transform.translation, humanoidMotionSample.transform.translation, "motion sampling should resolve explicit joint-index carriers");
  const motionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.2, 0.7);
  assert.deepEqual(motionDelta.delta.translation, [5, 0, 0], "motion interval deltas should report carrier displacement");
  assert.ok(quaternionNearlyEqual(motionDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5), "motion interval deltas should report carrier rotation");
  const wrappedMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.75, 1.25);
  assert.deepEqual(wrappedMotionDelta.delta.translation, [5, 0, 0], "looped motion intervals should accumulate forward displacement across wrap");
  const negativeMotionDelta = sampleMotionIntervalDelta(motionSkeleton, motionClip, 0.7, 0.2);
  assert.deepEqual(negativeMotionDelta.delta.translation, [0, 0, 0], "negative motion intervals should return identity deltas");
  const signedScaleMotionClip: AnimationClip = {
    id: "signed-scale-motion",
    duration: 1,
    tracks: [{ joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([-2, 2, -4, -4, 6, 2]) }]
  };
  const signedScaleMotionDelta = sampleMotionIntervalDelta(motionSkeleton, signedScaleMotionClip, 0, 1, { loop: false });
  assert.deepEqual(signedScaleMotionDelta.delta.scale, [2, 3, -0.5], "motion interval scale deltas should preserve finite negative scale ratios");
  const nonFiniteMotionSample = sampleMotionCarrier(motionSkeleton, motionClip, Number.NaN);
  assert.equal(nonFiniteMotionSample.time, 0, "non-finite motion sample times should deterministically sample time zero");
  assert.deepEqual(nonFiniteMotionSample.transform.translation, [0, 0, 0]);
  const invalidCarrierDiagnostics: SampleRepairDiagnostic[] = [];
  const invalidCarrierSample = sampleMotionCarrier(motionSkeleton, motionClip, 0.25, {
    carrier: { humanBone: "pelvis" },
    diagnostics: invalidCarrierDiagnostics
  });
  assert.equal(invalidCarrierSample.joint, "root", "invalid motion carriers should fall back to the skeleton root");
  assert.ok(
    invalidCarrierDiagnostics.some((issue) => issue.message === "motion carrier humanoid bone pelvis does not map to skeleton; using root"),
    "invalid motion carriers should report diagnostics when requested"
  );
  const repairedMotionDiagnostics: SampleRepairDiagnostic[] = [];
  const repairedMotionClip: AnimationClip = {
    id: "repaired-root-motion",
    duration: 1,
    tracks: [
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 2, Number.NaN, 0, 0, 1])
      }
    ]
  };
  const repairedMotionSample = sampleMotionCarrier(motionSkeleton, repairedMotionClip, 0.5, { diagnostics: repairedMotionDiagnostics });
  assert.ok(repairedMotionSample.transform.rotation.every(Number.isFinite), "motion carrier sampling should repair non-finite rotation samples");
  assert.ok(Math.abs(Math.hypot(...repairedMotionSample.transform.rotation) - 1) < 1e-6, "motion carrier rotations should remain normalized");
  assert.ok(
    repairedMotionDiagnostics.some((issue) => issue.property === "rotation" && issue.message === "rotation track quaternion was normalized during sampling"),
    "motion carrier sampling should preserve rotation repair diagnostics"
  );
  assert.ok(
    repairedMotionDiagnostics.some((issue) => issue.property === "rotation" && issue.message === "rotation track quaternion values were repaired to finite defaults"),
    "motion carrier sampling should report non-finite rotation repairs"
  );

  const extractionClip: AnimationClip = {
    id: "extract-root-motion",
    duration: 1,
    loop: true,
    metadata: { rootMotionPolicy: "preserved" },
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 0.5, 1]), values: toFloat32Array([0, 0, 0, 5, 1, 2.5, 10, 2, 5]) },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      },
      { joint: "spine", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.25, 0]) }
    ]
  };
  const extractedRootMotion = extractRootMotion(motionSkeleton, extractionClip, {
    reference: "absolute",
    translation: { axes: { x: true, y: false, z: true }, bake: true },
    rotation: { mode: "yaw", bake: true },
    bakedClipId: "extract-root-motion-in-place"
  });
  assert.equal(extractedRootMotion.motion.carrier.joint, "root", "root-motion extraction should report the resolved carrier");
  assert.ok(extractedRootMotion.motion.position, "root-motion extraction should emit a position motion track by default");
  assert.ok(extractedRootMotion.motion.rotation, "root-motion extraction should emit a yaw motion track by default");
  const extractedHalfMotion = sampleMotionTracks(extractedRootMotion.motion, 0.5);
  assert.ok(vectorNearlyEqual(extractedHalfMotion.transform.translation, [5, 0, 2.5], 1e-6), "extracted translation should honor the selected axis mask");
  assert.ok(
    quaternionNearlyEqual(extractedHalfMotion.transform.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "extracted rotation should isolate carrier yaw"
  );
  assert.deepEqual(
    Array.from(extractionClip.tracks[0]!.values),
    [0, 0, 0, 5, 1, 2.5, 10, 2, 5],
    "root-motion extraction should not mutate the source clip"
  );
  assert.ok(extractedRootMotion.bakedClip, "baked root-motion extraction should return a cloned in-place clip");
  assert.notEqual(extractedRootMotion.bakedClip, extractionClip, "root-motion baking should clone rather than mutate the source clip");
  const bakedRootTranslation = extractedRootMotion.bakedClip!.tracks[0]!;
  assert.deepEqual(
    Array.from(bakedRootTranslation.values),
    [0, 0, 0, 0, 1, 0, 0, 2, 0],
    "baked root-motion translation should remove selected axes and preserve unselected authored motion"
  );
  assert.ok(
    quaternionNearlyEqual(sampleClipToPose(motionSkeleton, extractedRootMotion.bakedClip!, 1, { loop: false })[0]!.rotation, [0, 0, 0, 1], 1e-5),
    "baked root-motion rotation should remove extracted yaw from the carrier track"
  );
  assert.deepEqual(
    sampleClipToPose(motionSkeleton, extractedRootMotion.bakedClip!, 1, { loop: false })[2]!.translation,
    [0, 0.25, 0],
    "root-motion baking should leave unrelated tracks unchanged"
  );

  const rotationBakeTranslationClip: AnimationClip = {
    id: "rotation-bake-translation-compensation",
    duration: 1,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 1]) },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  const rotationBakeTranslation = extractRootMotion(motionSkeleton, rotationBakeTranslationClip, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true }
  });
  const rotationBakeTranslationRaw = createRawAnimation({
    id: "raw-rotation-bake-translation-compensation",
    duration: 1,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0, 0, 1] }
        ],
        rotations: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI / 2) }
        ]
      }
    ]
  });
  const rawRotationBakeTranslation = extractRawRootMotion(motionSkeleton, rotationBakeTranslationRaw, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true }
  });
  const compensatedTranslation = rotateVec3ByQuat(invertQuat(quatFromAxisAngle([0, 1, 0], Math.PI / 2)), [0, 0, 1]);
  assert.ok(rotationBakeTranslation.bakedClip, "rotation-only root-motion baking should still clone an in-place clip");
  assert.ok(
    vectorNearlyEqual(sampleClipToPose(motionSkeleton, rotationBakeTranslation.bakedClip!, 1, { loop: false })[0]!.translation, compensatedTranslation, 1e-6),
    "clip root-motion rotation baking should compensate carrier translation keys into the baked orientation"
  );
  assert.ok(
    vectorNearlyEqual(rawRotationBakeTranslation.rawAnimation.tracks[0]!.translations[1]!.value, compensatedTranslation, 1e-6),
    "raw root-motion rotation baking should document the matching translation compensation"
  );
  const wrappedExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.75, 2.25, { loop: true });
  assert.ok(vectorNearlyEqual(wrappedExtractedDelta.delta.translation, [15, 0, 7.5], 1e-5), "motion tracks should accumulate multi-loop forward deltas");
  assert.ok(
    quaternionNearlyEqual(wrappedExtractedDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI * 0.75), 1e-5),
    "motion tracks should accumulate multi-loop yaw deltas"
  );
  const backwardExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.25, -0.25, { loop: true });
  assert.ok(vectorNearlyEqual(backwardExtractedDelta.delta.translation, [-5, 0, -2.5], 1e-5), "motion tracks should support backward looping intervals");
  assert.ok(
    quaternionNearlyEqual(backwardExtractedDelta.delta.rotation, quatFromAxisAngle([0, 1, 0], -Math.PI / 4), 1e-5),
    "motion tracks should invert rotation for backward intervals"
  );
  const largeExtractedDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0, 100.5, { loop: true });
  assert.ok(vectorNearlyEqual(largeExtractedDelta.delta.translation, [1005, 0, 502.5], 1e-4), "large looping motion intervals should avoid per-loop drift");
  assert.ok(largeExtractedDelta.delta.rotation.every(Number.isFinite), "large looping motion intervals should keep finite rotations");
  const clampedBackwardDelta = sampleMotionTracksIntervalDelta(extractedRootMotion.motion, 0.75, 0.25, { loop: false });
  assert.ok(vectorNearlyEqual(clampedBackwardDelta.delta.translation, [-5, 0, -2.5], 1e-5), "non-looping motion tracks should clamp samples but preserve signed interval deltas");
  const motionSampler = new MotionSampler();
  motionSampler.update(extractedRootMotion.motion, 0, 0.5, { loop: true });
  assert.ok(vectorNearlyEqual(motionSampler.current.translation, [5, 0, 2.5], 1e-6), "motion sampler should accumulate its first interval");
  motionSampler.update(extractedRootMotion.motion, 0.5, 1.25, { loop: true });
  assert.ok(vectorNearlyEqual(motionSampler.current.translation, [12.5, 0, 6.25], 1e-5), "motion sampler should keep accumulating across wrapped intervals");
  const motionAccumulator = new MotionAccumulator();
  motionAccumulator.accumulateDelta({ translation: [2, 0, 0], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4), scale: [1, 1, 1] });
  motionAccumulator.accumulateDelta({ translation: [3, 0, 0], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4), scale: [1, 1, 1] });
  assert.ok(vectorNearlyEqual(motionAccumulator.current.translation, [5, 0, 0], 1e-6), "motion accumulator should compose translation deltas");
  assert.ok(
    quaternionNearlyEqual(motionAccumulator.current.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
    "motion accumulator should compose rotation deltas"
  );
  const blendedMotion = blendMotionDeltas([
    { weight: 3, delta: { translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: 1, delta: { translation: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { weight: -5, delta: { translation: [100, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }
  ]);
  assert.ok(vectorNearlyEqual(blendedMotion.translation, [8, 0, 0], 1e-6), "motion delta blending should normalize positive weights and ignore negative weights");
  const blendedScaledMotion = blendMotionDeltas([
    { weight: 1, delta: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 3, -4] } },
    { weight: 3, delta: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [4, 7, 8] } }
  ]);
  assert.ok(vectorNearlyEqual(blendedScaledMotion.scale, [3.5, 6, 5], 1e-6), "motion delta blending should preserve weighted scale deltas");
  assert.deepEqual(computeLocomotionBlendWeights(0.25, 3), [0.5, 0.5, 0], "locomotion blend weights should follow the Ozz walk/jog/run triangular profile");
  assert.deepEqual(computeLocomotionBlendWeights(Number.NaN, 3), [1, 0, 0], "non-finite blend ratios should fall back to the first locomotion layer");
  const synchronizedLocomotion = synchronizeLocomotionPlayback(
    [
      { id: "walk", duration: 1 },
      { id: "jog", duration: 0.5 },
      { id: "run", duration: 0.25 }
    ],
    { blendRatio: 0.25, phase: 0.5 }
  );
  assert.ok(Math.abs(synchronizedLocomotion.synchronizedDuration - 0.75) < 1e-6, "locomotion speed sync should use weighted clip durations as the shared cycle");
  assert.deepEqual(
    synchronizedLocomotion.layers.map((layer) => layer.weight),
    [0.5, 0.5, 0],
    "locomotion speed sync should expose deterministic derived weights"
  );
  assert.ok(Math.abs(synchronizedLocomotion.layers[0]!.playbackSpeed - 4 / 3) < 1e-6, "walk playback should speed up to the synchronized cycle");
  assert.ok(Math.abs(synchronizedLocomotion.layers[1]!.playbackSpeed - 2 / 3) < 1e-6, "jog playback should slow relative to walk when its authored duration is shorter");
  assert.ok(Math.abs(synchronizedLocomotion.layers[0]!.time - 0.5) < 1e-6 && Math.abs(synchronizedLocomotion.layers[1]!.time - 0.25) < 1e-6, "synchronized locomotion should report per-clip local times at the shared phase");
  const zeroLocomotionSync = synchronizeLocomotionPlayback([
    { id: "zero-duration", duration: 0, weight: 1 },
    { id: "zero-weight", duration: 1, weight: 0 }
  ]);
  assert.equal(zeroLocomotionSync.synchronizedDuration, 0, "zero-duration and zero-weight locomotion sets should not invent a synchronized cycle");
  assert.deepEqual(
    zeroLocomotionSync.layers.map((layer) => [layer.id, layer.playbackSpeed, layer.active]),
    [["zero-duration", 0, false], ["zero-weight", 0, false]],
    "locomotion speed sync should keep zero-duration/zero-weight layers deterministic"
  );

  const rawMotionSource = createRawAnimation({
    id: "raw-motion-source",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        translations: [
          { time: 0, value: [0, 0, 0] },
          { time: 0.5, value: [6, 1, 0] },
          { time: 1, value: [10, 2, 4] }
        ],
        rotations: [
          { time: 0, value: quatFromAxisAngle([0, 1, 0], 0) },
          { time: 0.5, value: quatFromAxisAngle([0, 1, 0], Math.PI) },
          { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 2) }
        ]
      },
      {
        joint: "spine",
        translations: [{ time: 0, value: [0, 0.25, 0] }]
      }
    ]
  });
  const rawMotionSnapshot = JSON.stringify(rawMotionSource);
  const rawMotionExtraction = extractRawRootMotion(motionSkeleton, rawMotionSource, {
    reference: "absolute",
    translation: { axes: { x: true, y: false, z: true }, bake: true, loop: true },
    rotation: { mode: "yaw", bake: true, loop: true },
    rawAnimationId: "raw-motion-in-place"
  });
  assert.equal(rawMotionExtraction.rawAnimation.id, "raw-motion-in-place");
  assert.equal(JSON.stringify(rawMotionSource), rawMotionSnapshot, "raw motion extraction should not mutate editable raw animation input");
  assert.ok(vectorNearlyEqual(sampleMotionTracks(rawMotionExtraction.motion, 0).transform.translation, sampleMotionTracks(rawMotionExtraction.motion, 1).transform.translation, 1e-6), "raw motion loop distribution should make extracted translation endpoints match");
  assert.ok(
    quaternionNearlyEqual(sampleMotionTracks(rawMotionExtraction.motion, 0).transform.rotation, sampleMotionTracks(rawMotionExtraction.motion, 1).transform.rotation, 1e-5),
    "raw motion loop distribution should make extracted rotation endpoints match"
  );
  assert.ok(vectorNearlyEqual(sampleMotionTracks(rawMotionExtraction.motion, 0.5).transform.translation, [1, 0, -2], 1e-5), "raw motion loop distribution should spread endpoint translation error across channel keys");
  assert.ok(
    quaternionNearlyEqual(sampleMotionTracks(rawMotionExtraction.motion, 0.5).transform.rotation, quatFromAxisAngle([0, 1, 0], Math.PI), 1e-5),
    "raw motion extraction should preserve the middle yaw channel while loopifying endpoints"
  );
  const unevenLoopDistributionClip: AnimationClip = {
    id: "uneven-loop-distribution",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 0.1, 1]), values: toFloat32Array([0, 0, 0, 1, 0, 0, 10, 0, 0]) }]
  };
  const unevenClipLoopDistribution = extractRootMotion(motionSkeleton, unevenLoopDistributionClip, {
    reference: "absolute",
    translation: { loop: true },
    rotation: false
  });
  assert.ok(
    vectorNearlyEqual(sampleMotionTracks(unevenClipLoopDistribution.motion, 0.1).transform.translation, [0, 0, 0], 1e-6),
    "clip root-motion loop distribution should spread endpoint drift by key time instead of key ordinal"
  );
  const loopedRotationBakeClip: AnimationClip = {
    id: "looped-rotation-bake-order",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 0.5, 1]),
        values: sanitizeQuaternionTrackValues([
          0,
          0,
          0,
          1,
          ...quatFromAxisAngle([0, 1, 0], Math.PI / 2),
          ...quatFromAxisAngle([0, 1, 0], Math.PI)
        ])
      }
    ]
  };
  const loopedRotationBake = extractRootMotion(motionSkeleton, loopedRotationBakeClip, {
    reference: "absolute",
    translation: false,
    rotation: { mode: "yaw", bake: true, loop: true }
  });
  assert.ok(loopedRotationBake.bakedClip, "looped clip root-motion rotation baking should still return a baked clip");
  assert.ok(
    quaternionNearlyEqual(sampleClipToPose(motionSkeleton, loopedRotationBake.bakedClip!, 0.5, { loop: false })[0]!.rotation, [0, 0, 0, 1], 1e-5),
    "clip root-motion baking should strip the original carrier rotation before loopifying the exported motion track"
  );
  assert.ok(
    quaternionNearlyEqual(sampleMotionTracks(loopedRotationBake.motion, 0.5).transform.rotation, [0, 0, 0, 1], 1e-5),
    "clip root-motion loop distribution should still loopify the returned motion rotation track"
  );
  const unevenRawLoopDistribution = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-uneven-loop-distribution",
      duration: 1,
      tracks: [
        {
          joint: "root",
          translations: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.1, value: [1, 0, 0] },
            { time: 1, value: [10, 0, 0] }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: { loop: true },
      rotation: false
    }
  );
  assert.ok(
    vectorNearlyEqual(sampleMotionTracks(unevenRawLoopDistribution.motion, 0.1).transform.translation, [0, 0, 0], 1e-6),
    "raw root-motion loop distribution should spread endpoint drift by key time instead of key ordinal"
  );
  const rawFullRotationLoopDistribution = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-full-rotation-loop-distribution",
      duration: 1,
      tracks: [
        {
          joint: "root",
          rotations: [
            { time: 0, value: [0, 0, 0, 1] },
            { time: 0.5, value: [0, 0, 0, 1] },
            { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 1.5) }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: false,
      rotation: { mode: "full", loop: true }
    }
  );
  assert.ok(
    quaternionNearlyEqual(sampleMotionTracks(rawFullRotationLoopDistribution.motion, 0.5).transform.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 4), 1e-5),
    "raw full-rotation loop distribution should use the shortest quaternion hemisphere"
  );
  const rawLoopedRotationBakeCompensation = extractRawRootMotion(
    motionSkeleton,
    createRawAnimation({
      id: "raw-looped-rotation-bake-compensation",
      duration: 1,
      tracks: [
        {
          joint: "root",
          translations: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.5, value: [0, 0, 1] },
            { time: 1, value: [0, 0, 1] }
          ],
          rotations: [
            { time: 0, value: [0, 0, 0, 1] },
            { time: 0.5, value: [0, 0, 0, 1] },
            { time: 1, value: quatFromAxisAngle([0, 1, 0], Math.PI * 1.5) }
          ]
        }
      ]
    }),
    {
      reference: "absolute",
      translation: false,
      rotation: { mode: "full", bake: true, loop: true }
    }
  );
  assert.ok(
    vectorNearlyEqual(rawLoopedRotationBakeCompensation.rawAnimation.tracks[0]!.translations[1]!.value, [0, 0, 1], 1e-6),
    "raw rotation baking should compensate translations with authored motion before loop distribution changes the exported motion track"
  );
  assert.deepEqual(
    rawMotionExtraction.rawAnimation.tracks[0]!.translations.map((key) => key.value),
    [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
    "raw motion baking should remove selected carrier translation axes and preserve unselected local motion"
  );
  assert.ok(
    quaternionNearlyEqual(rawMotionExtraction.rawAnimation.tracks[0]!.rotations[1]!.value, [0, 0, 0, 1], 1e-5),
    "raw motion baking should remove extracted yaw from the raw carrier rotation channel"
  );
  const rawClassExtraction = new MotionExtractor().extractRaw(motionSkeleton, rawMotionSource, { translation: false, rotation: false });
  assert.equal(rawClassExtraction.motion.position, undefined, "MotionExtractor class should expose raw extraction without forcing position tracks");
  assert.equal(rawClassExtraction.motion.rotation, undefined, "MotionExtractor class should expose raw extraction without forcing rotation tracks");
  const preservedExtractionInspection = inspectClipAsset(
    {
      id: "preserved-extracted-root-motion",
      label: "Preserved Extracted Root Motion",
      url: "/preserved-extracted-root-motion.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    extractionClip
  );
  assert.equal(preservedExtractionInspection.accepted, true, "root-motion extraction should not disturb preserved-policy source clips");
  const strippedExtraction = extractRootMotion(motionSkeleton, extractionClip, { reference: "absolute", translation: true, rotation: false, bake: true });
  const strippedExtractionInspection = inspectClipAsset(
    {
      id: "stripped-extracted-root-motion",
      label: "Stripped Extracted Root Motion",
      url: "/stripped-extracted-root-motion.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    strippedExtraction.bakedClip!
  );
  assert.equal(strippedExtractionInspection.accepted, true, "baked all-axis root motion should satisfy stripped-to-in-place policy validation");

  const coreRetargetSourceRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const coreRetargetTargetRest = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
  const coreRetargetDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
  const coreRetargetSourceSample = multiplyQuat(coreRetargetSourceRest, coreRetargetDelta);
  assert.ok(
    quaternionNearlyEqual(retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceRest), coreRetargetTargetRest, 1e-5),
    "retargeting a source rest sample should preserve the target rest rotation"
  );
  assert.ok(
    quaternionNearlyEqual(
      retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceSample),
      multiplyQuat(coreRetargetTargetRest, coreRetargetDelta),
      1e-5
    ),
    "retargeting should preserve source local deltas by post-applying them to target rest"
  );
  const coreRetargetSkeleton = createSkeleton([
    { name: "root" },
    { name: "upper", parentName: "root", humanoid: "leftUpperArm", rest: { rotation: coreRetargetTargetRest } }
  ]);
  const coreRetargetClip: AnimationClip = {
    id: "core-source-rest-retarget",
    duration: 1,
    tracks: [
      {
        humanBone: "leftUpperArm",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array(coreRetargetSourceRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...coreRetargetSourceRest, ...coreRetargetSourceSample])
      }
    ]
  };
  const coreRetargetExpected = multiplyQuat(coreRetargetTargetRest, coreRetargetDelta);
  const coreRetargetPose = sampleClipToPose(coreRetargetSkeleton, coreRetargetClip, 1);
  assert.ok(
    !quaternionNearlyEqual(coreRetargetSourceSample, coreRetargetExpected, 1e-4),
    "core retarget fixture should distinguish raw source-basis rotations from target-rest rotations"
  );
  assert.ok(
    quaternionNearlyEqual(coreRetargetPose[1]!.rotation, coreRetargetExpected, 1e-5),
    "sampleClipToPose should retarget source-rest rotation tracks into the skeleton rest basis"
  );
  const coreRetargetRuntime = new AnimationRuntime(coreRetargetSkeleton);
  coreRetargetRuntime.setLayer("retargeted", coreRetargetClip, { weight: 1, targetWeight: 1, time: 1 });
  const coreRetargetEvaluation = coreRetargetRuntime.evaluate();
  assert.ok(
    quaternionNearlyEqual(coreRetargetEvaluation.localPose[1]!.rotation, coreRetargetExpected, 1e-5),
    "AnimationRuntime.evaluate should use the retargeted core sampling path"
  );

  function modelPoint(skeleton: Skeleton, pose: Pose, joint: string): [number, number, number] {
    const index = skeleton.joints.findIndex((item) => item.name === joint);
    assert.ok(index >= 0, `fixture joint ${joint} should exist`);
    return transformPoint(localToModelPose(skeleton, pose)[index]!, [0, 0, 0]);
  }

  function modelDirectionBetween(skeleton: Skeleton, pose: Pose, parent: string, child: string): [number, number, number] {
    const a = modelPoint(skeleton, pose, parent);
    const b = modelPoint(skeleton, pose, child);
    return normalizeVec3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  }

  function signedJointOffset(a: [number, number, number], b: [number, number, number], c: [number, number, number], axis: [number, number, number]): number {
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as [number, number, number];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as [number, number, number];
    const acLengthSq = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2];
    assert.ok(acLengthSq > 1e-8, "signed joint fixture should not collapse the endpoint line");
    const t = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / acLengthSq;
    const closest = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t] as [number, number, number];
    const offset = [b[0] - closest[0], b[1] - closest[1], b[2] - closest[2]] as [number, number, number];
    return offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
  }

  const anatomicalLegSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.12, 0] } },
    { name: "leftLowerLeg", parentName: "leftUpperLeg", humanoid: "leftLowerLeg", rest: { translation: [0, -0.46, 0] } },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
    { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg", rest: { translation: [0, -0.46, 0] } },
    { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.46, 0] } }
  ]);
  const anatomicalKneeFlexion = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
  const anatomicalLegClip: AnimationClip = {
    id: "anatomical-knee-flexion",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion])
      },
      {
        humanBone: "rightLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion])
      }
    ]
  };
  const anatomicalLegPose = sampleClipToPose(anatomicalLegSkeleton, anatomicalLegClip, 1);
  const leftKneeForward = signedJointOffset(
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftUpperLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftLowerLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "leftFoot"),
    [0, 0, 1]
  );
  const rightKneeForward = signedJointOffset(
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightUpperLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightLowerLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalLegPose, "rightFoot"),
    [0, 0, 1]
  );
  assert.ok(leftKneeForward > 0.16, `left knee should flex forward in model space, got ${leftKneeForward.toFixed(4)}`);
  assert.ok(rightKneeForward > 0.16, `right knee should flex forward in model space, got ${rightKneeForward.toFixed(4)}`);
  const anatomicalBadBasisPose = sampleClipToPose(anatomicalLegSkeleton, anatomicalLegClip, 1, {
    sourceBasisQuaternion: () => quatFromUnitVectors([0, 0, 1], [1, 0, 0])
  });
  const badBasisKneeForward = signedJointOffset(
    modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftUpperLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftLowerLeg"),
    modelPoint(anatomicalLegSkeleton, anatomicalBadBasisPose, "leftFoot"),
    [0, 0, 1]
  );
  assert.ok(
    badBasisKneeForward < leftKneeForward * 0.25,
    `unneeded source-basis correction should be detectable as lost/backward knee flexion, got ${badBasisKneeForward.toFixed(4)}`
  );

  const anatomicalArmSkeleton = createSkeleton([
    { name: "chest", humanoid: "chest", rest: { translation: [0, 1.35, 0] } },
    { name: "leftUpperArm", parentName: "chest", humanoid: "leftUpperArm", rest: { translation: [-0.18, 0.12, 0] } },
    { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm", rest: { translation: [-0.36, 0, 0] } },
    { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.34, 0, 0] } },
    { name: "rightUpperArm", parentName: "chest", humanoid: "rightUpperArm", rest: { translation: [0.18, 0.12, 0] } },
    { name: "rightLowerArm", parentName: "rightUpperArm", humanoid: "rightLowerArm", rest: { translation: [0.36, 0, 0] } },
    { name: "rightHand", parentName: "rightLowerArm", humanoid: "rightHand", rest: { translation: [0.34, 0, 0] } }
  ]);
  const leftElbowFlexion = quatFromAxisAngle([0, 1, 0], -Math.PI / 3);
  const rightElbowFlexion = quatFromAxisAngle([0, 1, 0], Math.PI / 3);
  const anatomicalArmClip: AnimationClip = {
    id: "anatomical-elbow-flexion",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerArm",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...leftElbowFlexion])
      },
      {
        humanBone: "rightLowerArm",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...rightElbowFlexion])
      }
    ]
  };
  const anatomicalArmPose = sampleClipToPose(anatomicalArmSkeleton, anatomicalArmClip, 1);
  const leftElbowForward = signedJointOffset(
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftUpperArm"),
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftLowerArm"),
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "leftHand"),
    [0, 0, 1]
  );
  const rightElbowForward = signedJointOffset(
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightUpperArm"),
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightLowerArm"),
    modelPoint(anatomicalArmSkeleton, anatomicalArmPose, "rightHand"),
    [0, 0, 1]
  );
  assert.ok(leftElbowForward > 0.12, `left elbow should flex to the authored forward bend plane, got ${leftElbowForward.toFixed(4)}`);
  assert.ok(rightElbowForward > 0.12, `right elbow should flex to the authored forward bend plane, got ${rightElbowForward.toFixed(4)}`);

  const fullAnatomicalSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "spine", parentName: "hips", humanoid: "spine", rest: { translation: [0, 0.28, 0] } },
    { name: "chest", parentName: "spine", humanoid: "chest", rest: { translation: [0, 0.28, 0] } },
    { name: "neck", parentName: "chest", humanoid: "neck", rest: { translation: [0, 0.24, 0] } },
    { name: "head", parentName: "neck", humanoid: "head", rest: { translation: [0, 0.18, 0] } },
    { name: "leftShoulder", parentName: "chest", humanoid: "leftShoulder", rest: { translation: [-0.12, 0.18, 0] } },
    { name: "leftUpperArm", parentName: "leftShoulder", humanoid: "leftUpperArm", rest: { translation: [-0.2, 0, 0] } },
    { name: "leftLowerArm", parentName: "leftUpperArm", humanoid: "leftLowerArm", rest: { translation: [-0.36, 0, 0] } },
    { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.32, 0, 0] } },
    { name: "rightShoulder", parentName: "chest", humanoid: "rightShoulder", rest: { translation: [0.12, 0.18, 0] } },
    { name: "rightUpperArm", parentName: "rightShoulder", humanoid: "rightUpperArm", rest: { translation: [0.2, 0, 0] } },
    { name: "rightLowerArm", parentName: "rightUpperArm", humanoid: "rightLowerArm", rest: { translation: [0.36, 0, 0] } },
    { name: "rightHand", parentName: "rightLowerArm", humanoid: "rightHand", rest: { translation: [0.32, 0, 0] } },
    { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.12, 0] } },
    { name: "leftLowerLeg", parentName: "leftUpperLeg", humanoid: "leftLowerLeg", rest: { translation: [0, -0.46, 0] } },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "leftToes", parentName: "leftFoot", humanoid: "leftToes", rest: { translation: [0, 0, 0.18] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
    { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg", rest: { translation: [0, -0.46, 0] } },
    { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "rightToes", parentName: "rightFoot", humanoid: "rightToes", rest: { translation: [0, 0, 0.18] } }
  ]);
  const fullAnatomicalClip: AnimationClip = {
    id: "full-anatomical-known-local-rotations",
    duration: 1,
    tracks: [
      { humanBone: "hips", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 10)]) },
      { humanBone: "spine", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 12)]) },
      { humanBone: "neck", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 10)]) },
      { humanBone: "leftShoulder", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], Math.PI / 8)]) },
      { humanBone: "rightShoulder", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], -Math.PI / 8)]) },
      { humanBone: "leftLowerArm", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...leftElbowFlexion]) },
      { humanBone: "rightLowerArm", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...rightElbowFlexion]) },
      { humanBone: "leftHand", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 9)]) },
      { humanBone: "rightHand", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 9)]) },
      { humanBone: "leftLowerLeg", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion]) },
      { humanBone: "rightLowerLeg", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...anatomicalKneeFlexion]) },
      { humanBone: "leftFoot", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)]) },
      { humanBone: "rightFoot", property: "quaternion", sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]), times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)]) }
    ]
  };
  const fullAnatomicalPose = sampleClipToPose(fullAnatomicalSkeleton, fullAnatomicalClip, 1);
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "head")[2]! > 0.08, "spine rotation should propagate through neck/head in model space");
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm")[1]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftUpperArm")[1]!, "left shoulder should lower the upper arm rather than swap sides");
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightUpperArm")[1]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightUpperArm")[1]!, "right shoulder should lower the upper arm rather than swap sides");
  assert.ok(
    signedJointOffset(
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm"),
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftLowerArm"),
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand"),
      [0, 0, 1]
    ) > 0.12,
    "left elbow and wrist should bend into the expected forward model-space plane"
  );
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand")[0]! < 0, "left wrist/hand should remain on the left side");
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightHand")[0]! > 0, "right wrist/hand should remain on the right side");
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftToes")[2]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftToes")[2]!, "left ankle/foot should plantarflex toes backward under the known local rotation");
  assert.ok(modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightToes")[2]! < modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightToes")[2]!, "right ankle/foot should plantarflex toes backward under the known local rotation");
  const fullAnatomicalDiagnostics = diagnoseRetargetingRestAxes(fullAnatomicalSkeleton, fullAnatomicalClip);
  assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerLeg")?.hingePlane, "sagittal", "diagnostic should classify left knee flexion as sagittal");
  assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerLeg")?.hingePlane, "sagittal", "diagnostic should classify right knee flexion as sagittal");
  assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerArm")?.hingePlane, "sagittal", "diagnostic should classify left elbow flexion as sagittal");
  assert.equal(fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerArm")?.hingePlane, "sagittal", "diagnostic should classify right elbow flexion as sagittal");
  const unsupportedDiagnostics = diagnoseRetargetingRestAxes(fullAnatomicalSkeleton);
  assert.match(
    unsupportedDiagnostics.find((entry) => entry.humanBone === "leftLowerLeg")?.issue ?? "",
    /missing source rest quaternion/,
    "diagnostic should prove when actual source rest data is missing instead of pretending hinge retargeting is supported"
  );
  const diagnosticSourceRest = quatFromAxisAngle([1, 0, 0], (170 * Math.PI) / 180);
  const diagnosticLocalFlexion = quatFromAxisAngle([1, 0, 0], -Math.PI / 3);
  const diagnosticFlexedSample = multiplyQuat(diagnosticSourceRest, diagnosticLocalFlexion);
  const diagnosticRestDominatedSkeleton = createSkeleton([
    { name: "upper", humanoid: "leftUpperLeg" },
    { name: "lower", parentName: "upper", humanoid: "leftLowerLeg", rest: { translation: [0, -1, 0] } },
    { name: "foot", parentName: "lower", humanoid: "leftFoot", rest: { translation: [0, -1, 0] } }
  ]);
  const diagnosticRestDominatedClip: AnimationClip = {
    id: "diagnostic-rest-relative-strongest-sample",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array(diagnosticSourceRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...diagnosticSourceRest, ...diagnosticFlexedSample])
      }
    ]
  };
  assert.equal(
    diagnoseRetargetingRestAxes(diagnosticRestDominatedSkeleton, diagnosticRestDominatedClip, { bones: ["leftLowerLeg"] })[0]?.hingePlane,
    "sagittal",
    "diagnostic should choose the strongest rest-relative local motion instead of the largest absolute source rotation"
  );
  const diagnosticTargetRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const diagnosticTargetDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 4);
  const diagnosticTargetSample = multiplyQuat(diagnosticTargetRest, diagnosticTargetDelta);
  const diagnosticTargetRestSkeleton = createSkeleton([
    { name: "upper", humanoid: "leftUpperLeg" },
    { name: "lower", parentName: "upper", humanoid: "leftLowerLeg", rest: { translation: [0, -1, 0], rotation: diagnosticTargetRest } },
    { name: "foot", parentName: "lower", humanoid: "leftFoot", rest: { translation: [0, -1, 0] } }
  ]);
  const diagnosticTargetRestClip: AnimationClip = {
    id: "diagnostic-target-rest-model-direction",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array(diagnosticTargetRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...diagnosticTargetRest, ...diagnosticTargetSample])
      }
    ]
  };
  const diagnosticTargetRestPose = sampleClipToPose(diagnosticTargetRestSkeleton, diagnosticTargetRestClip, 1);
  const diagnosticTargetRestEntry = diagnoseRetargetingRestAxes(diagnosticTargetRestSkeleton, diagnosticTargetRestClip, { bones: ["leftLowerLeg"] })[0]!;
  assert.ok(
    vectorNearlyEqual(
      diagnosticTargetRestEntry.retargetedChildDirection ?? [0, 0, 0],
      modelDirectionBetween(diagnosticTargetRestSkeleton, diagnosticTargetRestPose, "lower", "foot"),
      1e-5
    ),
    "diagnostic retargeted child direction should match sampled model-space pose for non-identity target rest rotations"
  );

  const malformedFallbackClip: AnimationClip = {
    id: "malformed-fallbacks",
    duration: 1,
    tracks: [
      { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([]) },
      { humanBone: "spine", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([]) },
      { humanBone: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([]) },
      { humanBone: "leftUpperArm", property: "scale", times: toFloat32Array([]), values: toFloat32Array([]) }
    ]
  };
  const malformedFallbackPose = sampleClipToPose(skeleton, malformedFallbackClip, 0);
  assert.deepEqual(malformedFallbackPose[0]!.translation, [0, 0, 0], "missing translation samples should fall back to zero translation");
  assert.deepEqual(malformedFallbackPose[1]!.rotation, [0, 0, 0, 1], "missing rotation samples should fall back to identity rotation");
  assert.deepEqual(malformedFallbackPose[2]!.scale, [1, 1, 1], "missing scale samples should fall back to identity scale");
  assert.deepEqual(malformedFallbackPose[3]!.scale, [1, 1, 1], "empty scale tracks should fall back to identity scale");
  const malformedFiniteSampleDiagnostics: SampleRepairDiagnostic[] = [];
  const malformedFiniteSampleClip: AnimationClip = {
    id: "malformed-finite-samples",
    duration: 1,
    tracks: [
      { humanBone: "spine", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([Number.NaN, 2, Number.POSITIVE_INFINITY, 4, 5, 6]) },
      { humanBone: "head", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, Number.NEGATIVE_INFINITY, 1, Number.NaN, 3, 4]) }
    ]
  };
  const malformedFiniteSamplePose = sampleClipToPose(skeleton, malformedFiniteSampleClip, 0.5, { diagnostics: malformedFiniteSampleDiagnostics });
  assert.deepEqual(malformedFiniteSamplePose[1]!.translation, [2, 3.5, 3], "non-finite translation sample components should be repaired before interpolation");
  assert.deepEqual(malformedFiniteSamplePose[2]!.scale, [1, 2, 2.5], "non-finite scale sample components should be repaired before interpolation");
  assert.ok(malformedFiniteSamplePose.every((transform) => transform.translation.every(Number.isFinite) && transform.scale.every(Number.isFinite)));
  assert.ok(
    malformedFiniteSampleDiagnostics.some((issue) => issue.property === "translation" && issue.sample === 0 && issue.message === "translation track sample values were repaired to finite defaults"),
    "direct pose sampling should report repaired translation samples"
  );
  assert.ok(
    malformedFiniteSampleDiagnostics.some((issue) => issue.property === "scale" && issue.sample === 0 && issue.message === "scale track sample values were repaired to finite defaults"),
    "direct pose sampling should report repaired scale samples"
  );
  assert.ok(
    malformedFiniteSampleDiagnostics.some((issue) => issue.property === "scale" && issue.sample === 1 && issue.message === "scale track sample values were repaired to finite defaults"),
    "direct pose sampling should report each repaired scale key used for interpolation"
  );
  const shortSamplingRestPose = sampleClipToPose(skeleton, { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] }, 0, { restPose: [] });
  assert.deepEqual(shortSamplingRestPose[2]!.translation, skeleton.restPose[2]!.translation, "short sampling rest poses should fall back missing base joints to skeleton rest pose");
  const invalidSamplingRestPose = clonePose(skeleton.restPose);
  invalidSamplingRestPose[2]!.translation = [Number.NaN, 7, 7];
  invalidSamplingRestPose[2]!.rotation = [0, 0, 0, 0];
  invalidSamplingRestPose[2]!.scale = [Number.POSITIVE_INFINITY, 2, 3];
  const invalidSamplingRestFallback = sampleClipToPose(skeleton, { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] }, 0, {
    restPose: invalidSamplingRestPose
  });
  assert.deepEqual(invalidSamplingRestFallback[2]!.translation, skeleton.restPose[2]!.translation, "invalid sampling rest transforms should fall back per joint to skeleton rest pose");

  const unsupportedPropertyClip = {
    id: "unsupported-property",
    duration: 1,
    tracks: [{ humanBone: "hips", property: "visibility", times: toFloat32Array([0]), values: toFloat32Array([1, 1, 1]) }]
  } as unknown as AnimationClip;
  const unsupportedPropertyIssues = validateClip(unsupportedPropertyClip, skeleton);
  assert.equal(
    unsupportedPropertyIssues.some(
      (issue) => issue.track === 0 && issue.property === "visibility" && issue.message === "track property is unsupported"
    ),
    true,
    "unsupported external track properties should be reported instead of treated as 3-float transform channels"
  );
  const unknownHumanoidTrackClip = {
    id: "unknown-humanbone",
    duration: 1,
    tracks: [{ humanBone: "pelvis", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }]
  } as unknown as AnimationClip;
  assert.ok(
    validateClip(unknownHumanoidTrackClip).some(
      (issue) => issue.track === 0 && issue.joint === "pelvis" && issue.property === "translation" && issue.message === "track has unknown humanoid bone"
    ),
    "validateClip should report unknown humanoid track identifiers without requiring a skeleton"
  );
  assert.throws(
    () => sampleTrack(unsupportedPropertyClip.tracks[0]!, 0),
    /unsupported animation track property visibility/,
    "unsupported external track properties should fail during direct sampling"
  );
  assert.throws(
    () => sampleClipToPose(skeleton, unsupportedPropertyClip, 0),
    /unsupported animation track property visibility/,
    "unsupported mapped track properties should not be silently ignored during pose sampling"
  );
  const unsupportedPropertyRuntime = new AnimationRuntime(skeleton);
  unsupportedPropertyRuntime.setLayer("external-invalid", unsupportedPropertyClip, { weight: 1, targetWeight: 1 });
  const unsupportedPropertyRuntimeEvaluation = unsupportedPropertyRuntime.evaluate();
  assertFiniteEvaluation(unsupportedPropertyRuntimeEvaluation);
  assert.equal(unsupportedPropertyRuntimeEvaluation.diagnostics, undefined, "runtime diagnostics should stay opt-in for unsupported external tracks");
  const unsupportedPropertyRuntimeDiagnostics = unsupportedPropertyRuntime.evaluate({ diagnostics: true });
  assertFiniteEvaluation(unsupportedPropertyRuntimeDiagnostics);
  assert.ok(
    unsupportedPropertyRuntimeDiagnostics.diagnostics!.some(
      (issue) =>
        issue.stage === "sample" &&
        issue.layerId === "external-invalid" &&
        issue.clipId === "unsupported-property" &&
        issue.track === 0 &&
        issue.property === "visibility" &&
        issue.joint === "hips" &&
        issue.index === 0 &&
        issue.message === "track property is unsupported"
    ),
    "runtime diagnostics should report unsupported external track properties with layer/clip/track context"
  );

  const models = localToModelPose(skeleton, sampled);
  assert.equal(models.length, skeleton.joints.length);
  assert.equal(models[0]![13], 1);

  const bakedSkeleton = createSkeleton([
    { name: "box_a", parentIndex: NO_PARENT, rest: { translation: [1, 0, 0], scale: [2, 2, 2] } },
    { name: "render_Camera", parentIndex: NO_PARENT, rest: { translation: [0, 10, 20], scale: [0.1, 0.1, 0.1] } },
    { name: "box_b", parentIndex: NO_PARENT, rest: { translation: [-2, 3, 0], scale: [1, 4, 1] } }
  ]);
  const bakedModels = localToModelPose(bakedSkeleton, bakedSkeleton.restPose);
  assert.equal(resolveBakedCameraJointIndex(bakedSkeleton), 1, "baked camera lookup should find a camera joint by default name text");
  assert.equal(
    resolveBakedCameraJointIndex(bakedSkeleton, { predicate: (joint) => joint.name === "render_Camera" }),
    1,
    "baked camera lookup should support caller predicates"
  );
  const bakedCameraOverride = getBakedCameraJointOverride(bakedSkeleton, bakedModels);
  assert.equal(bakedCameraOverride?.jointName, "render_Camera", "baked camera override should report resolved joint metadata");
  assertMat4NearlyEqual(bakedCameraOverride!.matrix, bakedModels[1]!, 1e-6, "baked camera override should clone the joint model matrix");
  assert.equal(
    getBakedCameraJointOverride(bakedSkeleton, [bakedModels[0]!, new Float32Array([Number.NaN]), bakedModels[2]!])?.matrix,
    undefined,
    "baked camera override should not return a non-finite candidate without an explicit fallback"
  );

  const bakedRigidMatrices = buildRigidInstanceMatrices(bakedModels, { jointIndices: [0, 2] });
  assert.equal(bakedRigidMatrices.length, 2, "baked rigid helpers should build one matrix per selected joint");
  assertMat4NearlyEqual(bakedRigidMatrices[0]!, bakedModels[0]!, 1e-6, "baked rigid matrices should preserve animated scale columns");
  assert.equal(bakedRigidMatrices[0]![0], 2, "baked rigid matrices should keep x scale from the joint model matrix");
  assert.equal(bakedRigidMatrices[0]![5], 2, "baked rigid matrices should keep y scale from the joint model matrix");
  assert.equal(bakedRigidMatrices[1]![5], 4, "baked rigid matrices should keep per-joint non-uniform scale");
  const rigidFallback = composeMat4({ translation: [7, 8, 9], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  const repairedRigidMatrices = buildRigidInstanceMatrices([new Float32Array([Number.NaN])], { fallbackMatrix: rigidFallback });
  assertMat4NearlyEqual(repairedRigidMatrices[0]!, rigidFallback, 1e-6, "baked rigid helpers should repair missing/non-finite model matrices with a finite fallback");
  const rigidMatrixBuffer = new Float32Array(32);
  updateRigidInstanceMatrixBuffer(bakedModels, rigidMatrixBuffer, { jointIndices: [0, 2] });
  assert.ok(
    vectorNearlyEqual(Array.from(rigidMatrixBuffer.slice(0, 16)), Array.from(bakedModels[0]!), 1e-6),
    "baked rigid buffer helper should write the first selected matrix"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(rigidMatrixBuffer.slice(16, 32)), Array.from(bakedModels[2]!), 1e-6),
    "baked rigid buffer helper should write the second selected matrix"
  );
  const rigidBounds = computeRigidInstanceBounds(bakedModels, { jointIndices: [0, 2] });
  assert.equal(rigidBounds.empty, false, "baked rigid bounds should report non-empty selected instances");
  assert.equal(rigidBounds.instanceCount, 2, "baked rigid bounds should report selected instance count");
  assert.ok(vectorNearlyEqual(rigidBounds.min, [-2.5, -1, -1], 1e-6), "baked rigid bounds should include translated and scaled unit cube minimums");
  assert.ok(vectorNearlyEqual(rigidBounds.max, [2, 5, 1], 1e-6), "baked rigid bounds should include translated and scaled unit cube maximums");

  const threeRigidMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  const threeRigidMeshVersion = threeRigidMesh.instanceMatrix.version;
  assert.equal(
    updateThreeRigidInstanceMatrices(threeRigidMesh, bakedModels, { jointIndices: [0, 2] }),
    2,
    "three baked rigid helper should update selected InstancedMesh entries"
  );
  assert.equal(threeRigidMesh.count, 2, "three baked rigid helper should keep the active InstancedMesh count aligned");
  assert.equal(threeRigidMesh.instanceMatrix.version, threeRigidMeshVersion + 1, "three baked rigid helper should mark InstancedMesh instance matrices for upload");
  assert.ok(
    vectorNearlyEqual(Array.from(threeRigidMesh.instanceMatrix.array.slice(0, 16)), Array.from(bakedModels[0]!), 1e-6),
    "three baked rigid helper should write the first InstancedMesh matrix"
  );
  const threeRigidAttribute = new Float32BufferAttribute(new Float32Array(32), 16);
  const threeRigidAttributeVersion = threeRigidAttribute.version;
  assert.equal(
    updateThreeRigidInstanceMatrices(threeRigidAttribute, bakedModels, { jointIndices: [0, 2] }),
    2,
    "three baked rigid helper should update standalone instanced matrix buffers"
  );
  assert.equal(threeRigidAttribute.version, threeRigidAttributeVersion + 1, "three baked rigid helper should mark matrix buffer attributes for upload");
  assert.ok(
    vectorNearlyEqual(Array.from(threeRigidAttribute.array.slice(16, 32)), Array.from(bakedModels[2]!), 1e-6),
    "three baked rigid helper should write matrix buffers in instance order"
  );

  const skinningIdentityMatrix = composeMat4(identityTransform());
  const identitySkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.deepEqual(identitySkin.issues, [], "single-joint identity skinning should validate cleanly");
  assert.ok(vectorNearlyEqual(Array.from(identitySkin.positions), [1, 2, 3], 1e-6), "single-joint identity skinning should preserve positions");

  const translatedSkinPalette = buildSkinningMatrixPalette(
    [composeMat4({ translation: [5, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })],
    [composeMat4({ translation: [-2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })]
  );
  const inverseBindSkin = skinVertices({
    positions: { data: new Float32Array([2, 0, 0]) },
    jointMatrices: translatedSkinPalette,
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(inverseBindSkin.positions), [5, 0, 0], 1e-6),
    "model * inverse-bind palette skinning should move bind-space vertices into the animated joint frame"
  );

  const weightedSkin = skinVertices({
    positions: { data: new Float32Array([1, 0, 0]) },
    influences: 2,
    jointMatrices: [skinningIdentityMatrix, composeMat4({ translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })],
    jointIndices: new Uint16Array([0, 1]),
    jointWeights: new Float32Array([0.25])
  });
  assert.ok(vectorNearlyEqual(Array.from(weightedSkin.positions), [8.5, 0, 0], 1e-6), "skinning should restore the final Ozz influence weight");

  const vectorSkin = skinVertices({
    positions: { data: new Float32Array([0, 0, 0]) },
    normals: { data: new Float32Array([1, 0, 0]) },
    tangents: { data: new Float32Array([0, 1, 0]) },
    jointMatrices: [composeMat4({ translation: [10, 20, 30], rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2), scale: [1, 1, 1] })],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(vectorNearlyEqual(Array.from(vectorSkin.positions), [10, 20, 30], 1e-6), "skinning positions should include joint translation");
  assert.ok(vectorNearlyEqual(Array.from(vectorSkin.normals ?? []), [0, 1, 0], 1e-6), "skinning normals should transform as directions");
  assert.ok(vectorNearlyEqual(Array.from(vectorSkin.tangents ?? []), [-1, 0, 0], 1e-6), "skinning tangents should transform as directions");

  const invalidSkinJob = {
    positions: { data: new Float32Array([Number.NaN, 1, 2]) },
    influences: 2,
    jointMatrices: [new Float32Array([Number.NaN])],
    jointIndices: new Uint16Array([99, 0]),
    jointWeights: new Float32Array([Number.NaN])
  };
  assert.ok(
    validateSkinningJob(invalidSkinJob).some((issue) => issue.field === "jointMatrices"),
    "skinning validation should report malformed matrix palettes"
  );
  const repairedSkin = skinVertices(invalidSkinJob);
  assert.ok(repairedSkin.issues.length > 0, "skinning should return validation issues alongside repaired output");
  assert.ok(vectorNearlyEqual(Array.from(repairedSkin.positions), [0, 1, 2], 1e-6), "skinning should repair invalid scalars to finite fallback output");
  const emptySkin = skinVertices({ positions: { data: new Float32Array() }, jointMatrices: [] });
  assert.equal(emptySkin.vertexCount, 0, "empty skinning input should produce an empty result");
  assert.equal(emptySkin.positions.length, 0, "empty skinning input should not allocate vertex data");
  const reusedSkinOutput = new Float32Array(6);
  const reusedSkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0]),
    outPositions: { data: reusedSkinOutput, offset: 3 }
  });
  assert.equal(reusedSkin.positions, reusedSkinOutput, "skinning should reuse caller-owned output buffers when they are large enough");
  assert.ok(vectorNearlyEqual(Array.from(reusedSkinOutput.slice(3, 6)), [1, 2, 3], 1e-6), "reused skinning output should write at the requested offset");

  const threeSkinningGeometry = new BufferGeometry();
  const threePositionAttribute = new Float32BufferAttribute(new Float32Array([0, 0, 0]), 3);
  const threeNormalAttribute = new Float32BufferAttribute(new Float32Array([1, 0, 0]), 3);
  const threeTangentAttribute = new Float32BufferAttribute(new Float32Array([0, 1, 0, -1]), 4);
  threeSkinningGeometry.setAttribute("position", threePositionAttribute);
  threeSkinningGeometry.setAttribute("normal", threeNormalAttribute);
  threeSkinningGeometry.setAttribute("tangent", threeTangentAttribute);
  const threePositionVersion = threePositionAttribute.version;
  const threeNormalVersion = threeNormalAttribute.version;
  const threeTangentVersion = threeTangentAttribute.version;
  const threeSkin = skinThreeBufferGeometry(threeSkinningGeometry, {
    jointMatrices: [composeMat4({ translation: [10, 20, 30], rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2), scale: [1, 1, 1] })],
    jointIndices: new Uint16Array([0])
  });
  assert.equal(threeSkin.attributes.position, threePositionAttribute, "three skinning should reuse compatible position attributes");
  assert.equal(threeSkin.attributes.normal, threeNormalAttribute, "three skinning should reuse compatible normal attributes");
  assert.equal(threeSkin.attributes.tangent, threeTangentAttribute, "three skinning should reuse compatible tangent attributes");
  assert.ok(vectorNearlyEqual(Array.from(threePositionAttribute.array), [10, 20, 30], 1e-6), "three skinning should upload translated positions into geometry attributes");
  assert.ok(vectorNearlyEqual(Array.from(threeNormalAttribute.array), [0, 1, 0], 1e-6), "three skinning should recompute normal attributes through skinVertices");
  assert.ok(
    vectorNearlyEqual(Array.from(threeTangentAttribute.array), [-1, 0, 0, -1], 1e-6),
    "three skinning should recompute tangent xyz and preserve tangent handedness"
  );
  assert.equal(threePositionAttribute.version, threePositionVersion + 1, "three skinning should mark position attributes for upload");
  assert.equal(threeNormalAttribute.version, threeNormalVersion + 1, "three skinning should mark normal attributes for upload");
  assert.equal(threeTangentAttribute.version, threeTangentVersion + 1, "three skinning should mark tangent attributes for upload");
  const threeSkinningDebug = buildThreeSkinningDebugSegments({ geometry: threeSkinningGeometry, scale: 2 });
  assert.equal(threeSkinningDebug.segmentCount, 3, "skinning debug data should include normal, tangent, and binormal segments when attributes exist");
  assert.ok(
    vectorNearlyEqual(Array.from(threeSkinningDebug.positions), [10, 20, 30, 10, 22, 30, 10, 20, 30, 8, 20, 30, 10, 20, 30, 10, 20, 28], 1e-6),
    "skinning debug data should build normal, tangent, and handed binormal line segments"
  );
  const threeSkinningDebugGeometry = createThreeSkinningDebugGeometry({ geometry: threeSkinningGeometry, scale: 2 });
  assert.ok(
    vectorNearlyEqual(Array.from((threeSkinningDebugGeometry.getAttribute("position") as Float32BufferAttribute).array), Array.from(threeSkinningDebug.positions), 1e-6),
    "skinning debug geometry should expose segment positions as a BufferGeometry position attribute"
  );

  const attachmentOffset = composeMat4({ translation: [0.25, 0.5, -0.75], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4), scale: [1, 2, 1] });
  const expectedAttachment = multiplyMat4(models[2]!, attachmentOffset);
  assertMat4NearlyEqual(
    computeAttachmentTransform({ modelPose: models, jointIndex: 2, offset: attachmentOffset }),
    expectedAttachment,
    1e-6,
    "attachment transform should concatenate joint model matrix then offset matrix"
  );
  assertMat4NearlyEqual(
    computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
    expectedAttachment,
    1e-6,
    "attachment transform should resolve joints by name"
  );
  const boundHeadAttachment = createAttachmentBinding({ skeleton, joint: "head", offset: attachmentOffset, id: "hat" });
  assert.equal(boundHeadAttachment.jointIndex, 2, "attachment binding should resolve joint names once");
  assert.equal(boundHeadAttachment.jointName, "head", "attachment binding should retain resolved joint metadata");
  assert.equal(boundHeadAttachment.id, "hat", "attachment binding should retain stable ids");
  assertMat4NearlyEqual(
    computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
    expectedAttachment,
    1e-6,
    "bound attachment transform should concatenate joint model matrix then precomputed offset matrix"
  );
  assertMat4NearlyEqual(
    computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
    computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "head", offset: attachmentOffset }),
    0,
    "attachment transform should be deterministic for repeated evaluation"
  );
  const humanoidAttachment = computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] } });
  assertMat4NearlyEqual(
    humanoidAttachment,
    computeAttachmentTransform({ modelPose: models, jointIndex: 3, offset: { translation: [0, 0.25, 0] } }),
    1e-6,
    "attachment transform should resolve humanoid aliases through the skeleton map"
  );
  const boundHumanoidAttachment = createAttachmentBinding({ skeleton, joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] }, id: "armband" });
  assert.equal(boundHumanoidAttachment.jointIndex, 3, "attachment binding should resolve humanoid aliases once");
  assert.equal(boundHumanoidAttachment.humanoid, "leftUpperArm", "attachment binding should retain humanoid metadata");
  assertMat4NearlyEqual(
    computeBoundAttachmentTransform({ modelPose: models, binding: boundHumanoidAttachment }),
    humanoidAttachment,
    1e-6,
    "bound attachment transform should evaluate humanoid alias bindings"
  );
  const rotatedAttachmentSkeleton = createSkeleton([
    { name: "root", rest: { rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2) } },
    { name: "rightHandJoint", parentName: "root", humanoid: "rightHand" }
  ]);
  const rotatedAttachmentModels = localToModelPose(rotatedAttachmentSkeleton, rotatedAttachmentSkeleton.restPose);
  assert.ok(
    vectorNearlyEqual(
      transformPoint(computeSkeletonAttachmentTransform({ skeleton: rotatedAttachmentSkeleton, modelPose: rotatedAttachmentModels, joint: "rightHand", offset: { translation: [1, 0, 0] } }), [0, 0, 0]),
      [0, 1, 0],
      1e-6
    ),
    "attachment translation offsets should rotate with the parent/joint model matrix"
  );
  assert.throws(
    () => computeSkeletonAttachmentTransform({ skeleton, modelPose: models, joint: "missingJoint" }),
    /attachment joint missingJoint was not found/,
    "missing attachment joints should be explicit failures"
  );
  assert.throws(
    () => computeAttachmentTransform({ modelPose: models, jointIndex: 99 }),
    /attachment joint index 99 is out of range/,
    "out-of-range attachment joint indices should be explicit failures"
  );
  assert.throws(
    () => createAttachmentBinding({ skeleton, joint: 99 }),
    /attachment joint index 99 is out of range/,
    "out-of-range numeric attachment bindings should fail during binding"
  );
  const staleBoundAttachment = createAttachmentBinding({ skeleton, joint: "head" });
  const shortModelPose = models.slice(0, 2);
  assert.throws(
    () => computeBoundAttachmentTransform({ modelPose: shortModelPose, binding: staleBoundAttachment }),
    /attachment binding joint index 2 is out of range/,
    "bound attachment evaluation should reject model poses without the resolved joint"
  );
  const nonFiniteJointModels = [...models];
  nonFiniteJointModels[2] = new Float32Array(models[2]!);
  nonFiniteJointModels[2]![12] = Number.NaN;
  assert.throws(
    () => computeAttachmentTransform({ modelPose: nonFiniteJointModels, jointIndex: 2 }),
    /attachment joint 2 model matrix values must be finite/,
    "non-finite joint model matrices should not produce plausible attachment output"
  );
  assert.throws(
    () => computeBoundAttachmentTransform({ modelPose: nonFiniteJointModels, binding: boundHeadAttachment }),
    /attachment binding joint 2 model matrix values must be finite/,
    "bound attachment evaluation should reject non-finite joint model matrices"
  );
  const sanitizedOffsetAttachment = computeAttachmentTransform({
    modelPose: [composeMat4(identityTransform())],
    jointIndex: 0,
    offset: {
      translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
      rotation: [0, Number.NaN, 0, 1],
      scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
    }
  });
  assertMat4NearlyEqual(
    sanitizedOffsetAttachment,
    composeMat4(cloneTransform({
      translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
      rotation: [0, Number.NaN, 0, 1],
      scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
    })),
    0,
    "attachment transform offsets should sanitize Partial<Transform> inputs through cloneTransform"
  );
  const sanitizedBoundAttachment = createAttachmentBinding({
    skeleton,
    joint: "head",
    offset: {
      translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
      rotation: [0, Number.NaN, 0, 1],
      scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
    }
  });
  assertMat4NearlyEqual(
    sanitizedBoundAttachment.offsetMatrix,
    composeMat4(cloneTransform({
      translation: [Number.NaN, 2, Number.POSITIVE_INFINITY],
      rotation: [0, Number.NaN, 0, 1],
      scale: [Number.NaN, 3, Number.NEGATIVE_INFINITY]
    })),
    0,
    "attachment bindings should sanitize Partial<Transform> offsets once during binding"
  );
  const nonFiniteOffsetMatrix = new Float32Array(16);
  nonFiniteOffsetMatrix[0] = Number.NaN;
  assert.throws(
    () => createAttachmentBinding({ skeleton, joint: "head", offset: nonFiniteOffsetMatrix }),
    /attachment offset matrix values must be finite/,
    "attachment bindings should reject non-finite offset matrices"
  );
  const mutatedBoundAttachment = createAttachmentBinding({ skeleton, joint: "head", offset: attachmentOffset });
  mutatedBoundAttachment.offsetMatrix[0] = Number.NaN;
  assert.throws(
    () => computeBoundAttachmentTransform({ modelPose: models, binding: mutatedBoundAttachment }),
    /attachment binding joint 2 offset matrix values must be finite/,
    "bound attachment evaluation should reject offset matrices mutated after binding"
  );
  assertMat4NearlyEqual(
    computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
    computeBoundAttachmentTransform({ modelPose: models, binding: boundHeadAttachment }),
    0,
    "bound attachment transform should be deterministic for repeated evaluation"
  );
  const boundAttachments = createAttachmentBindings(skeleton, [
    { joint: "head", offset: attachmentOffset, id: "hat" },
    { joint: "leftUpperArm", offset: { translation: [0, 0.25, 0] }, id: "armband" }
  ]);
  const boundAttachmentTransforms = computeBoundAttachmentTransforms({ modelPose: models, bindings: boundAttachments });
  assert.deepEqual(
    boundAttachmentTransforms.map((result) => result.id),
    ["hat", "armband"],
    "batch bound attachment evaluation should preserve attachment id order"
  );
  assert.deepEqual(
    boundAttachmentTransforms.map((result) => result.jointIndex),
    [2, 3],
    "batch bound attachment evaluation should preserve resolved joint order"
  );
  assertMat4NearlyEqual(boundAttachmentTransforms[0]!.transform, expectedAttachment, 1e-6, "batch bound attachment should evaluate the first binding");
  assertMat4NearlyEqual(boundAttachmentTransforms[1]!.transform, humanoidAttachment, 1e-6, "batch bound attachment should evaluate the second binding");

  const mask = createJointMask(skeleton, 0, { head: 1 });
  const blended = blendPoses(skeleton, [
    { pose: skeleton.restPose, weight: 1 },
    { pose: sampled, weight: 1, mask }
  ]);
  assert.ok(blended[2]!.rotation[0] > 0.05);
  assert.equal(blended[1]!.rotation[3], 1);

  const ozzStyleMask = createJointMask(skeleton, 1.25, {
    hips: -2,
    head: 2.5,
    leftUpperArm: Number.NaN,
    missingJoint: 7
  });
  assert.equal(ozzStyleMask[0], 0, "createJointMask should clamp negative named entries to zero");
  assert.equal(ozzStyleMask[1], 1.25, "createJointMask should preserve positive default weights above 1");
  assert.equal(ozzStyleMask[2], 2.5, "createJointMask should preserve positive named weights above 1");
  assert.equal(ozzStyleMask[3], 0, "createJointMask should sanitize non-finite named entries to zero");

  const negativeDefaultMask = createJointMask(skeleton, -1, { spine: 0.5 });
  assert.equal(negativeDefaultMask[0], 0, "createJointMask should clamp negative defaults to zero");
  assert.equal(negativeDefaultMask[1], 0.5, "createJointMask should still apply finite entries over negative defaults");

  const nonFiniteDefaultMask = createJointMask(skeleton, Number.POSITIVE_INFINITY, {
    head: Number.NEGATIVE_INFINITY,
    leftUpperArm: 1.5
  });
  assert.deepEqual(
    Array.from(nonFiniteDefaultMask),
    [0, 0, 0, 1.5],
    "createJointMask should sanitize non-finite defaults and entries without clamping positive overweight entries"
  );

  const subtreeMaskSkeleton = createSkeleton([
    { name: "root" },
    { name: "torso", parentName: "root", humanoid: "spine" },
    { name: "head", parentName: "torso", humanoid: "head" },
    { name: "leftArm", parentName: "torso", humanoid: "leftUpperArm" },
    { name: "rightArm", parentName: "torso", humanoid: "rightUpperArm" },
    { name: "prop", parentName: "root" }
  ]);
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "leftArm")),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should select the named root without selecting parents or siblings"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "torso", { defaultWeight: 0.25, weight: 2 })),
    [0.25, 2, 2, 2, 2, 0.25],
    "createSubtreeJointMask should select a named root and all descendants"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "leftUpperArm")),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should resolve humanoid bone roots"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, ["head", "rightUpperArm"])),
    [0, 0, 1, 0, 1, 0],
    "createSubtreeJointMask should compose multiple roots"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, ["missing", "leftArm"], { defaultWeight: Number.NaN, weight: Number.POSITIVE_INFINITY })),
    [0, 0, 0, 1, 0, 0],
    "createSubtreeJointMask should ignore missing roots and sanitize malformed weights"
  );
  assert.deepEqual(
    Array.from(createSubtreeJointMask(subtreeMaskSkeleton, "missing", { defaultWeight: -1, weight: -2 })),
    [0, 0, 0, 0, 0, 0],
    "createSubtreeJointMask should return a sanitized default-only mask when no roots resolve"
  );

  const malformedMaskPose = clonePose(skeleton.restPose);
  malformedMaskPose[0]!.translation = [5, 1, 0];
  malformedMaskPose[1]!.translation = [4, 0, 0];
  malformedMaskPose[2]!.translation = [20, 0, 0];
  malformedMaskPose[3]!.translation = [8, 0, 0];
  const armSubtreeBlend = blendPoses(skeleton, [{ pose: malformedMaskPose, weight: 1, mask: createSubtreeJointMask(skeleton, "leftUpperArm") }], { threshold: 0.01 });
  assert.equal(armSubtreeBlend[1]!.translation[0], 0, "subtree masks should leave unselected parents on fallback pose");
  assert.equal(armSubtreeBlend[2]!.translation[0], 0, "subtree masks should leave unselected siblings on fallback pose");
  assert.equal(armSubtreeBlend[3]!.translation[0], 8, "subtree masks should allow selected joints to own the blended pose");
  const malformedPartialMask = new Float32Array([1, Number.NaN]);
  const malformedMaskedBlend = blendPoses(skeleton, [{ pose: malformedMaskPose, weight: 1, mask: malformedPartialMask }], { threshold: 0.01 });
  assert.equal(malformedMaskedBlend[0]!.translation[0], 5, "finite mask entries should still own their joints");
  assert.equal(malformedMaskedBlend[1]!.translation[0], 0, "NaN mask entries should not affect override blending");
  assert.equal(malformedMaskedBlend[2]!.translation[0], 0, "missing mask entries should not affect override blending");
  assert.equal(malformedMaskedBlend[3]!.translation[0], 0, "short partial masks should leave unspecified joints on fallback pose");

  const shortOverridePose = clonePose(skeleton.restPose);
  shortOverridePose[0]!.translation = [6, 0, 0];
  shortOverridePose[1]!.translation = [7, 0, 0];
  shortOverridePose.length = 2;
  const shortOverrideBlend = blendPoses(skeleton, [{ pose: shortOverridePose, weight: 1 }], { threshold: 0.01 });
  assert.equal(shortOverrideBlend[0]!.translation[0], 6, "short override poses should still blend available joints");
  assert.equal(shortOverrideBlend[1]!.translation[0], 7, "short override poses should still blend available child joints");
  assert.deepEqual(shortOverrideBlend[2]!.translation, skeleton.restPose[2]!.translation, "short override poses should fall back missing joints to rest pose");
  assert.deepEqual(shortOverrideBlend[3]!.translation, skeleton.restPose[3]!.translation, "short override poses should keep trailing missing joints on rest pose");

  const shortFallbackPose = clonePose(skeleton.restPose);
  shortFallbackPose[0]!.translation = [9, 0, 0];
  shortFallbackPose.length = 1;
  const shortFallbackBlend = blendPoses(skeleton, [], { threshold: 0.01, fallbackPose: shortFallbackPose });
  assert.equal(shortFallbackBlend[0]!.translation[0], 9, "valid fallback joints should still be used when fallback pose is short");
  assert.deepEqual(shortFallbackBlend[1]!.translation, skeleton.restPose[1]!.translation, "short fallback poses should use skeleton rest pose for missing joints");
  assert.deepEqual(shortFallbackBlend[2]!.translation, skeleton.restPose[2]!.translation, "short fallback poses should use skeleton rest pose for missing threshold fallback");

  const invalidFallbackPose = clonePose(skeleton.restPose);
  invalidFallbackPose[0]!.translation = [Number.NaN, 9, 9];
  invalidFallbackPose[0]!.rotation = [0, 0, 0, 0];
  invalidFallbackPose[0]!.scale = [Number.POSITIVE_INFINITY, 2, 3];
  invalidFallbackPose[1]!.translation = [8, 0, 0];
  const invalidFallbackBlend = blendPoses(skeleton, [], { threshold: 0.01, fallbackPose: invalidFallbackPose });
  assert.deepEqual(
    invalidFallbackBlend[0]!,
    skeleton.restPose[0]!,
    "invalid fallback transforms should fall back per joint to skeleton rest pose"
  );
  assert.equal(invalidFallbackBlend[1]!.translation[0], 8, "valid fallback joints should still be used when neighboring fallback joints are invalid");

  const overweightMask = new Float32Array(skeleton.joints.length);
  overweightMask[2] = 2;
  const overweightMaskedBlend = blendPoses(
    skeleton,
    [
      { pose: skeleton.restPose, weight: 1 },
      { pose: malformedMaskPose, weight: 1, mask: overweightMask }
    ],
    { threshold: 0.01 }
  );
  assert.ok(Math.abs(overweightMaskedBlend[2]!.translation[0] - 40 / 3) < 1e-6, "positive mask weights above 1 should remain supported");

  const nonZeroFallbackPose = clonePose(skeleton.restPose);
  nonZeroFallbackPose[0]!.translation = [3, 2, 1];
  nonZeroFallbackPose[1]!.translation = [4, 5, 6];
  nonZeroFallbackPose[1]!.rotation = normalizeQuat([0, 0.4, 0, 0.9]);
  nonZeroFallbackPose[1]!.scale = [1.5, 1.25, 0.75];
  const invalidLayerPose = clonePose(skeleton.restPose);
  invalidLayerPose[1]!.translation = [Number.NaN, 100, 100];
  invalidLayerPose[1]!.rotation = [0, 0, 0, 0];
  invalidLayerPose[1]!.scale = [Number.POSITIVE_INFINITY, 0.2, 0.3];
  assert.ok(
    validatePose(skeleton, invalidLayerPose).some((issue) => issue.index === 1 && issue.message === "transform is not finite or quaternion is invalid"),
    "validatePose should still report malformed layer transforms"
  );
  const invalidBlend = blendPoses(skeleton, [{ pose: invalidLayerPose, weight: 1 }], { threshold: 0.01, fallbackPose: nonZeroFallbackPose });
  assert.ok(
    invalidBlend[1]!.translation.every((value, index) => Math.abs(value - nonZeroFallbackPose[1]!.translation[index]!) < 1e-6),
    "invalid layer transforms should not wipe non-zero fallback translations"
  );
  assert.ok(
    invalidBlend[1]!.scale.every((value, index) => Math.abs(value - nonZeroFallbackPose[1]!.scale[index]!) < 1e-6),
    "invalid layer transforms should not wipe non-zero fallback scales"
  );
  assert.ok(Math.abs(invalidBlend[1]!.rotation[1] - nonZeroFallbackPose[1]!.rotation[1]) < 1e-12, "invalid layer transforms should keep fallback rotations");
  assert.ok(
    [invalidBlend[1]!.translation, invalidBlend[1]!.rotation, invalidBlend[1]!.scale].flat().every(Number.isFinite),
    "invalid layer transforms should still produce finite output"
  );
  assert.ok(Math.abs(Math.hypot(...invalidBlend[1]!.rotation) - 1) < 1e-12, "invalid layer output rotations should stay normalized");

  const validSameJointPose = clonePose(skeleton.restPose);
  validSameJointPose[1]!.translation = [10, 5, 0];
  validSameJointPose[1]!.rotation = normalizeQuat([0.2, 0, 0, 0.98]);
  validSameJointPose[1]!.scale = [2, 3, 4];
  const mixedValidityBlend = blendPoses(
    skeleton,
    [
      { pose: invalidLayerPose, weight: 3 },
      { pose: validSameJointPose, weight: 1 }
    ],
    { threshold: 0.01, fallbackPose: nonZeroFallbackPose }
  );
  assert.deepEqual(mixedValidityBlend[1]!.translation, validSameJointPose[1]!.translation, "valid same-joint layers should still own joints ignored from malformed layers");
  assert.deepEqual(mixedValidityBlend[1]!.scale, validSameJointPose[1]!.scale, "valid same-joint layers should still blend scale normally");
  assert.ok(Math.abs(mixedValidityBlend[1]!.rotation[0] - validSameJointPose[1]!.rotation[0]) < 1e-12, "valid same-joint layers should still blend rotations normally");
  for (const transform of mixedValidityBlend) {
    assert.ok(
      transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite),
      "malformed override layers should not produce non-finite transforms"
    );
    assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-12, "malformed override layers should not produce denormalized rotations");
  }

  const malformedAdditiveDelta = clonePose(skeleton.restPose);
  malformedAdditiveDelta[0]!.translation = [Number.NaN, 0, 0];
  malformedAdditiveDelta[1]!.translation = [4, 0, 0];
  malformedAdditiveDelta[2]!.translation = [20, 0, 0];
  malformedAdditiveDelta[3]!.translation = [8, 0, 0];
  const malformedAdditiveMask = new Float32Array([Number.NaN, Number.NaN]);
  const malformedAdditivePose = applyAdditivePose(skeleton.restPose, malformedAdditiveDelta, 1, malformedAdditiveMask);
  assert.equal(malformedAdditivePose[0]!.translation[0], 0, "NaN mask entries should block non-finite additive deltas");
  assert.equal(malformedAdditivePose[1]!.translation[0], 0, "NaN mask entries should not affect additive pose application");
  assert.equal(malformedAdditivePose[2]!.translation[0], 0, "missing mask entries should not affect additive pose application");
  assert.equal(malformedAdditivePose[3]!.translation[0], 0, "short additive masks should leave unspecified joints unchanged");
  for (const transform of malformedAdditivePose) {
    assert.ok(
      transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite),
      "malformed additive masks should not produce non-finite transforms"
    );
  }
  const invalidUnmaskedAdditiveDelta = clonePose(skeleton.restPose);
  invalidUnmaskedAdditiveDelta[1]!.translation = [Number.NaN, 0, 0];
  invalidUnmaskedAdditiveDelta[1]!.rotation = [0, 0, 0, 0];
  invalidUnmaskedAdditiveDelta[1]!.scale = [1, Number.POSITIVE_INFINITY, 1];
  const invalidUnmaskedAdditivePose = applyAdditivePose(skeleton.restPose, invalidUnmaskedAdditiveDelta, 1);
  assert.deepEqual(
    invalidUnmaskedAdditivePose[1],
    skeleton.restPose[1],
    "invalid unmasked additive deltas should leave the base joint unchanged instead of leaking non-finite output"
  );
  assert.ok(
    invalidUnmaskedAdditivePose.every((transform) => transform.translation.every(Number.isFinite) && transform.rotation.every(Number.isFinite) && transform.scale.every(Number.isFinite)),
    "invalid unmasked additive deltas should not produce non-finite transforms"
  );

  const shortAdditiveSample = clonePose(skeleton.restPose);
  shortAdditiveSample[0]!.translation = [3, 0, 0];
  shortAdditiveSample.length = 1;
  const shortAdditiveDelta = additiveDeltaPose(skeleton.restPose, shortAdditiveSample);
  const shortAdditivePose = applyAdditivePose(skeleton.restPose, shortAdditiveDelta, 1);
  assert.equal(shortAdditivePose[0]!.translation[0], 3, "short additive samples should apply available deltas");
  assert.deepEqual(shortAdditivePose[1]!.translation, skeleton.restPose[1]!.translation, "short additive samples should use rest deltas for missing joints");
  assert.deepEqual(shortAdditivePose[2]!.translation, skeleton.restPose[2]!.translation, "short additive samples should leave trailing missing joints unchanged");
  assert.throws(
    () => additiveDeltaPose(skeleton.restPose, [...clonePose(skeleton.restPose), cloneTransform(skeleton.restPose[0]!)]),
    /additive delta pose length mismatch/,
    "oversized additive samples should still fail clearly"
  );
  const signedScaleRestPose = [cloneTransform({ scale: [-2, 2, -4] })];
  const signedScaleSamplePose = [cloneTransform({ scale: [-4, 6, 2] })];
  const signedScaleDeltaPose = additiveDeltaPose(signedScaleRestPose, signedScaleSamplePose);
  assert.deepEqual(signedScaleDeltaPose[0]!.scale, [2, 3, -0.5], "additive scale deltas should preserve finite negative rest-scale ratios");
  const signedScaleAppliedPose = applyAdditivePose(signedScaleRestPose, signedScaleDeltaPose, 1);
  assert.deepEqual(signedScaleAppliedPose[0]!.scale, signedScaleSamplePose[0]!.scale, "positive additive scale weights should apply signed scale ratios");
  const signedScaleSubtractedPose = applyAdditivePose(signedScaleSamplePose, signedScaleDeltaPose, -1);
  assert.deepEqual(signedScaleSubtractedPose[0]!.scale, signedScaleRestPose[0]!.scale, "negative additive scale weights should invert signed scale ratios");

  const tinyWeightBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }]);
  assert.ok(tinyWeightBlend[2]!.rotation[0] > 0);
  assert.ok(tinyWeightBlend[2]!.rotation[0] < sampled[2]!.rotation[0]);

  const nanThresholdBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], { threshold: Number.NaN });
  assert.ok(nanThresholdBlend[2]!.rotation[0] > 0, "NaN thresholds should not discard finite weak layer influence");
  assert.ok(nanThresholdBlend[2]!.rotation[0] < sampled[2]!.rotation[0], "NaN thresholds should preserve rest-pose fallback for tiny weights");

  const weakFallbackPose = clonePose(skeleton.restPose);
  weakFallbackPose[2]!.translation = [Number.NaN, 7, 7];
  weakFallbackPose[2]!.rotation = [0, 0, 0, 0];
  weakFallbackPose[2]!.scale = [Number.NaN, 2, 3];
  const weakLayerPose = clonePose(skeleton.restPose);
  weakLayerPose[2]!.translation = [10, 0, 0];
  const weakInvalidFallbackBlend = blendPoses(skeleton, [{ pose: weakLayerPose, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], {
    fallbackPose: weakFallbackPose
  });
  assert.ok(
    Math.abs(weakInvalidFallbackBlend[2]!.translation[0] - 5) < 1e-6,
    "invalid fallback transforms should not contaminate weak-layer threshold blending"
  );
  assert.ok(
    weakInvalidFallbackBlend[2]!.translation.every(Number.isFinite) &&
      weakInvalidFallbackBlend[2]!.rotation.every(Number.isFinite) &&
      weakInvalidFallbackBlend[2]!.scale.every(Number.isFinite),
    "weak-layer blending with an invalid fallback transform should stay finite"
  );

  const infiniteThresholdBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }], { threshold: Number.POSITIVE_INFINITY });
  assert.ok(infiniteThresholdBlend[2]!.rotation[0] > 0, "infinite thresholds should not discard finite weak layer influence");
  assert.ok(infiniteThresholdBlend[2]!.rotation[0] < sampled[2]!.rotation[0], "infinite thresholds should preserve rest-pose fallback for tiny weights");

  const weightedPoseA = sampleClipToPose(
    skeleton,
    {
      id: "weighted-a",
      duration: 1,
      tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: sanitizeQuaternionTrackValues([0.2, 0, 0, 0.98]) }]
    },
    0
  );
  const weightedPoseB = sampleClipToPose(
    skeleton,
    {
      id: "weighted-b",
      duration: 1,
      tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: sanitizeQuaternionTrackValues([0, 0.2, 0, 0.98]) }]
    },
    0
  );
  const weightedBlend = blendPoses(skeleton, [{ pose: weightedPoseA, weight: 2 }, { pose: weightedPoseB, weight: 1 }], { threshold: 0.01 });
  assert.ok(weightedBlend[2]!.rotation[0] > weightedBlend[2]!.rotation[1], "higher layer weights should influence normalized blend more");
  assert.ok(Math.abs(Math.hypot(...weightedBlend[2]!.rotation) - 1) < 1e-5);

  const lowerPriorityTranslateClip: AnimationClip = {
    id: "lower-priority-translate",
    duration: 1,
    tracks: [
      { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([4, 0, 0]) },
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([10, 0, 0]) }
    ]
  };
  const highPriorityHeadClip: AnimationClip = {
    id: "high-priority-head",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([20, 0, 0]) }]
  };
  const samePriorityTranslateClip: AnimationClip = {
    id: "same-priority-translate",
    duration: 1,
    tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }]
  };
  const runtimeSamePriority = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeSamePriority.setLayer("weighted-a", lowerPriorityTranslateClip, { weight: 3, targetWeight: 3, priority: 2 });
  runtimeSamePriority.setLayer("weighted-b", samePriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 2 });
  const samePriorityRuntimePose = runtimeSamePriority.evaluate().localPose;
  const samePriorityExpectedPose = blendPoses(
    skeleton,
    [
      { pose: sampleClipToPose(skeleton, lowerPriorityTranslateClip, 0), weight: 3 },
      { pose: sampleClipToPose(skeleton, samePriorityTranslateClip, 0), weight: 1 }
    ],
    { threshold: 0.01 }
  );
  assert.equal(samePriorityRuntimePose[2]!.translation[0], samePriorityExpectedPose[2]!.translation[0], "same-priority override layers should keep weighted blending");

  const runtimeMaskedPriority = new AnimationRuntime(skeleton);
  runtimeMaskedPriority.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0 });
  runtimeMaskedPriority.setLayer("head", highPriorityHeadClip, { weight: 1, targetWeight: 1, priority: 10, mask });
  const maskedPriorityPose = runtimeMaskedPriority.evaluate().localPose;
  assert.ok(Math.abs(maskedPriorityPose[1]!.translation[0] - 4) < 1e-6, "higher-priority masked layers should leave unowned joints on the lower-priority pose");
  assert.ok(Math.abs(maskedPriorityPose[2]!.translation[0] - 20) < 1e-6, "higher-priority masked layers should own masked joints");

  const runtimeWeakPriority = new AnimationRuntime(skeleton, { blendThreshold: 0.1 });
  runtimeWeakPriority.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeWeakPriority.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const weakPriorityPose = runtimeWeakPriority.evaluate().localPose;
  assert.ok(Math.abs(weakPriorityPose[2]!.translation[0] - 15) < 1e-6, "weak higher-priority layers should blend over the lower-priority fallback until threshold is reached");

  const runtimeNaNThreshold = new AnimationRuntime(skeleton, { blendThreshold: Number.NaN });
  runtimeNaNThreshold.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeNaNThreshold.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const nanThresholdRuntimePose = runtimeNaNThreshold.evaluate().localPose;
  assert.ok(Math.abs(nanThresholdRuntimePose[2]!.translation[0] - 15) < 1e-6, "runtime NaN blend thresholds should preserve weak-layer fallback behavior");

  const runtimeInfiniteThreshold = new AnimationRuntime(skeleton, { blendThreshold: Number.POSITIVE_INFINITY });
  runtimeInfiniteThreshold.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0, mask });
  runtimeInfiniteThreshold.setLayer("weak-head", highPriorityHeadClip, { weight: 0.05, targetWeight: 0.05, priority: 10, mask });
  const infiniteThresholdRuntimePose = runtimeInfiniteThreshold.evaluate().localPose;
  assert.ok(Math.abs(infiniteThresholdRuntimePose[2]!.translation[0] - 15) < 1e-6, "runtime infinite blend thresholds should preserve weak-layer fallback behavior");

  const crossfadeOldClip: AnimationClip = {
    id: "crossfade-old",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [2, 0, 0])]
  };
  const crossfadeNewClip: AnimationClip = {
    id: "crossfade-new",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [10, 0, 0])]
  };
  const runtimeCrossfade = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfade.setLayer("old", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeCrossfade.crossfade("new", crossfadeNewClip, { priority: 4, fadeSpeed: 1 });
  runtimeCrossfade.update(Math.log(2));
  const midCrossfade = runtimeCrossfade.evaluate();
  assert.ok(midCrossfade.activeLayers.some((layer) => layer.id === "old" && Math.abs(layer.weight - 0.5) < 1e-6));
  assert.ok(midCrossfade.activeLayers.some((layer) => layer.id === "new" && Math.abs(layer.weight - 0.5) < 1e-6));
  assert.ok(Math.abs(midCrossfade.localPose[2]!.translation[0] - 6) < 1e-6, "in-progress crossfade should normalize same-priority override weights");
  runtimeCrossfade.update(20);
  const finishedCrossfade = runtimeCrossfade.evaluate();
  assert.equal(finishedCrossfade.activeLayers.some((layer) => layer.id === "old"), false, "crossfade should remove fully faded source layers");
  assert.ok(Math.abs(finishedCrossfade.localPose[2]!.translation[0] - 10) < 1e-4, "crossfade target should dominate after fade completion");

  const additiveNudgeClip: AnimationClip = {
    id: "additive-nudge",
    duration: 1,
    tracks: [makeTransformTrack("head", "translation", [1, 0, 0])]
  };
  const runtimeCrossfadeAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeAdditive.setLayer("old", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeCrossfadeAdditive.setLayer("additive", additiveNudgeClip, { weight: 1, targetWeight: 1, priority: 2, blendMode: "additive" });
  runtimeCrossfadeAdditive.crossfade("new", crossfadeNewClip, { priority: 2, fadeSpeed: 8 });
  runtimeCrossfadeAdditive.update(20);
  const additiveCrossfadePose = runtimeCrossfadeAdditive.evaluate();
  const additiveLayer = additiveCrossfadePose.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(additiveLayer?.blendMode, "additive", "override crossfade should not fade additive layers implicitly");
  assert.ok(Math.abs(additiveLayer!.targetWeight - 1) < 1e-6);
  assert.ok(Math.abs(additiveCrossfadePose.localPose[2]!.translation[0] - 11) < 1e-4);

  const runtimeCrossfadeToAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeToAdditive.setLayer("base", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeCrossfadeToAdditive.crossfade("additive", additiveNudgeClip, { priority: 2, fadeSpeed: 1, blendMode: "additive" });
  runtimeCrossfadeToAdditive.update(Math.log(2));
  const midAdditiveTargetCrossfade = runtimeCrossfadeToAdditive.evaluate();
  const baseDuringAdditiveTarget = midAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "base");
  const additiveTargetDuringFade = midAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "additive");
  assert.ok(baseDuringAdditiveTarget, "additive crossfade should leave same-priority override base layers active");
  assert.equal(baseDuringAdditiveTarget!.targetWeight, 1, "additive crossfade should not retarget same-priority override base layers");
  assert.equal(baseDuringAdditiveTarget!.weight, 1, "additive crossfade should not fade same-priority override base influence");
  assert.ok(additiveTargetDuringFade, "additive crossfade target should become active while fading in");
  assert.equal(additiveTargetDuringFade!.blendMode, "additive");
  assert.ok(Math.abs(additiveTargetDuringFade!.weight - 0.5) < 1e-6, "additive crossfade target should fade in independently");
  assert.ok(Math.abs(midAdditiveTargetCrossfade.localPose[2]!.translation[0] - 2.5) < 1e-6, "additive crossfade target should compose on top of the base pose while fading");
  runtimeCrossfadeToAdditive.update(20);
  const finishedAdditiveTargetCrossfade = runtimeCrossfadeToAdditive.evaluate();
  const baseAfterAdditiveTarget = finishedAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "base");
  const additiveTargetAfterFade = finishedAdditiveTargetCrossfade.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(baseAfterAdditiveTarget?.targetWeight, 1, "additive crossfade should keep base target weight after completion");
  assert.ok(Math.abs(additiveTargetAfterFade!.weight - 1) < 1e-4, "additive crossfade target should finish fading in");
  assert.ok(Math.abs(finishedAdditiveTargetCrossfade.localPose[2]!.translation[0] - 3) < 1e-4, "additive crossfade target should compose fully on top of the base pose");

  const runtimeReplaceExistingAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeReplaceExistingAdditive.setLayer("base", crossfadeOldClip, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeReplaceExistingAdditive.setLayer("additive", additiveNudgeClip, { weight: 1, targetWeight: 1, priority: 2, blendMode: "additive" });
  runtimeReplaceExistingAdditive.crossfade(
    "additive",
    { id: "additive-replacement", duration: 1, tracks: [makeTransformTrack("head", "translation", [4, 0, 0])] },
    { resetTime: true, fadeSpeed: 1 }
  );
  runtimeReplaceExistingAdditive.update(Math.log(2));
  const replacedExistingAdditive = runtimeReplaceExistingAdditive.evaluate();
  const baseDuringExistingAdditiveReplace = replacedExistingAdditive.activeLayers.find((layer) => layer.id === "base");
  const replacedExistingAdditiveLayer = replacedExistingAdditive.activeLayers.find((layer) => layer.id === "additive");
  assert.equal(replacedExistingAdditiveLayer?.blendMode, "additive", "crossfading an existing additive layer should preserve its blend mode by default");
  assert.equal(baseDuringExistingAdditiveReplace?.targetWeight, 1, "replacing an additive layer should not implicitly fade same-priority override layers");
  assert.ok(Math.abs(replacedExistingAdditiveLayer!.weight - 0.5) < 1e-6, "replaced additive layers should still honor resetTime fade-in");
  assert.ok(Math.abs(replacedExistingAdditive.localPose[2]!.translation[0] - 4) < 1e-6, "replaced additive layers should compose over the base pose instead of replacing it");

  const runtimeSubtractiveAdditive = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeSubtractiveAdditive.setLayer("base", crossfadeNewClip, { weight: 1, targetWeight: 1 });
  runtimeSubtractiveAdditive.setLayer("subtract", additiveNudgeClip, { weight: -2, targetWeight: -2, blendMode: "additive" });
  const subtractiveAdditiveEvaluation = runtimeSubtractiveAdditive.evaluate();
  assert.ok(Math.abs(subtractiveAdditiveEvaluation.localPose[2]!.translation[0] - 8) < 1e-6, "negative additive runtime weights should subtract from the base pose");
  assert.equal(subtractiveAdditiveEvaluation.activeLayers.find((layer) => layer.id === "subtract")?.weight, -2);

  const runtimeAdditiveNegativeFade = new AnimationRuntime(skeleton);
  runtimeAdditiveNegativeFade.setLayer("fade-subtract", additiveNudgeClip, { weight: 0, targetWeight: -1, fadeSpeed: 1, blendMode: "additive" });
  runtimeAdditiveNegativeFade.update(Math.log(2));
  const additiveNegativeFadeEvaluation = runtimeAdditiveNegativeFade.evaluate();
  const additiveNegativeFadeLayer = additiveNegativeFadeEvaluation.activeLayers.find((layer) => layer.id === "fade-subtract");
  assert.ok(additiveNegativeFadeLayer, "additive layers should remain active while fading toward a negative target");
  assert.ok(Math.abs(additiveNegativeFadeLayer!.weight + 0.5) < 1e-6, "additive targetWeight should fade toward negative values");
  assert.equal(additiveNegativeFadeLayer!.targetWeight, -1);
  assert.ok(Math.abs(additiveNegativeFadeEvaluation.localPose[2]!.translation[0] + 0.5) < 1e-6);

  const runtimeNegativeOverride = new AnimationRuntime(skeleton);
  runtimeNegativeOverride.setLayer("negative-override", crossfadeNewClip, { weight: -1, targetWeight: -1 });
  const negativeOverrideEvaluation = runtimeNegativeOverride.evaluate();
  assert.equal(negativeOverrideEvaluation.activeLayers.length, 0, "negative override weights should sanitize to no influence");
  assert.equal(negativeOverrideEvaluation.localPose[2]!.translation[0], skeleton.restPose[2]!.translation[0]);

  const runtimeCrossfadeMasked = new AnimationRuntime(skeleton, { blendThreshold: 0.01 });
  runtimeCrossfadeMasked.setLayer("lower", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 0 });
  runtimeCrossfadeMasked.setLayer("old", lowerPriorityTranslateClip, { weight: 1, targetWeight: 1, priority: 5 });
  runtimeCrossfadeMasked.crossfade("head", highPriorityHeadClip, { priority: 5, mask, fadeSpeed: 8 });
  runtimeCrossfadeMasked.update(20);
  const maskedCrossfadePose = runtimeCrossfadeMasked.evaluate().localPose;
  assert.ok(Math.abs(maskedCrossfadePose[1]!.translation[0] - 4) < 1e-6, "masked crossfade should keep unowned joints on lower-priority fallback pose");
  assert.ok(Math.abs(maskedCrossfadePose[2]!.translation[0] - 20) < 1e-4, "masked crossfade target should own masked joints after fade completion");

  assert.deepEqual(
    filterTracksByNamePolicy(
      [{ name: "hips.position" }, { name: "head.quaternion" }, { name: "leftThumbProximal.quaternion" }],
      { exclude: [/hips\.position$/, /thumb/i] }
    ).map((track) => track.name),
    ["head.quaternion"]
  );
  const globalThumbMaskRule = /thumb/gi;
  assert.deepEqual(
    filterTracksByNamePolicy(
      [{ name: "leftThumbProximal.quaternion" }, { name: "rightThumbDistal.quaternion" }, { name: "head.quaternion" }],
      { exclude: [globalThumbMaskRule] }
    ).map((track) => track.name),
    ["head.quaternion"],
    "global regex track masks should not leak lastIndex state between tracks"
  );
  assert.equal(globalThumbMaskRule.lastIndex, 0, "global regex track masks should leave caller regex state deterministic");

  assert.deepEqual(
    filterTracksByNamePolicy(
      [
        { name: "hips.position" },
        { name: "spine.quaternion" },
        { name: "leftShoulder.quaternion" },
        { name: "leftUpperArm.quaternion" },
        { name: "rightLowerArm.quaternion" },
        { name: "rightHand.quaternion" },
        { name: "leftUpperLeg.quaternion" }
      ],
      AUTHORED_BASE_TRACK_POLICY
    ).map((track) => track.name),
    [
      "hips.position",
      "spine.quaternion",
      "leftShoulder.quaternion",
      "leftUpperArm.quaternion",
      "rightLowerArm.quaternion",
      "rightHand.quaternion",
      "leftUpperLeg.quaternion"
    ],
    "authored base policy should preserve source-driven arm and leg rotations"
  );

  const baseAuthoredClip = makeAuthoredLoopClip("base-authored-upper", ["hips.position", "spine", "leftShoulder", "rightUpperArm", "leftHand", "rightIndexProximal", "leftUpperLeg"]);
  const sourcePropertyPolicyClip: AnimationClip = {
    id: "source-property-policy",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  assert.deepEqual(
    applySourceTrackPolicy(sourcePropertyPolicyClip, { include: [/^head\.quaternion$/] }).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    ["head.rotation"],
    "source track regex rules should match Three-facing quaternion source names before UUID binding"
  );
  assert.deepEqual(
    applySourceTrackPolicy(sourcePropertyPolicyClip, { exclude: [/^head\.position$/] }).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    ["head.rotation", "hips.translation"],
    "source track regex rules should distinguish properties on the same source bone"
  );
  assert.deepEqual(
    applySourceTrackPolicy(baseAuthoredClip, AUTHORED_BASE_SOURCE_TRACK_POLICY).tracks.map((track) => track.humanBone ?? track.joint),
    ["hips", "spine", "leftShoulder", "rightUpperArm", "leftHand", "leftUpperLeg"],
    "authored base source policy should keep arm tracks before Three track names become UUID based"
  );
  assert.deepEqual(
    filterTracksByNamePolicy(
      [
        { name: "leftShoulder.quaternion" },
        { name: "leftUpperArm.quaternion" },
        { name: "rightLowerArm.quaternion" },
        { name: "rightHand.quaternion" },
        { name: "leftIndexProximal.quaternion" },
        { name: "leftUpperLeg.quaternion" }
      ],
      BASE_PROCEDURAL_TRACK_POLICY
    ).map((track) => track.name),
    ["leftShoulder.quaternion", "leftUpperArm.quaternion", "rightLowerArm.quaternion", "rightHand.quaternion", "leftUpperLeg.quaternion"],
    "legacy base policy alias should no longer underdrive authored arms"
  );
  assert.deepEqual(
    applySourceTrackPolicy(baseAuthoredClip, BASE_PROCEDURAL_SOURCE_TRACK_POLICY).tracks.map((track) => track.humanBone ?? track.joint),
    ["hips", "spine", "leftShoulder", "rightUpperArm", "leftHand", "leftUpperLeg"],
    "legacy base source policy alias should no longer underdrive authored arms"
  );

  const locomotionAuthoredClip = makeAuthoredLoopClip("locomotion-authored-upper", [
    "hips.position",
    "spine",
    "leftShoulder",
    "leftUpperArm",
    "rightLowerArm",
    "rightHand",
    "leftIndexProximal",
    "rightThumbDistal",
    "leftUpperLeg",
    "leftLowerLeg",
    "rightFoot"
  ]);
  const locomotionBaseClip = applySourceTrackPolicy(locomotionAuthoredClip, LOCOMOTION_BASE_SOURCE_TRACK_POLICY);
  assert.deepEqual(
    locomotionBaseClip.tracks.map((track) => track.humanBone ?? track.joint),
    ["hips", "spine", "leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "rightFoot"],
    "locomotion base policy should keep authored full-body tracks while stripping finger detail"
  );
  assert.deepEqual(
    applySourceTrackPolicy(locomotionBaseClip, ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    [
      "spine.quaternion",
      "leftShoulder.quaternion",
      "leftUpperArm.quaternion",
      "rightLowerArm.quaternion",
      "rightHand.quaternion",
      "leftUpperLeg.quaternion",
      "leftLowerLeg.quaternion",
      "rightFoot.quaternion"
    ],
    "source root translation policy should remove hips translation before runtime tracks are renamed to UUIDs"
  );
  const rootCarrierSourcePolicyClip: AnimationClip = {
    id: "root-carrier-source-policy",
    duration: 1,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { joint: "pelvis", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { humanBone: "hips", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  assert.deepEqual(
    applySourceTrackPolicy(rootCarrierSourcePolicyClip, ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY).tracks.map((track) => `${track.humanBone ?? track.joint}.${track.property}`),
    ["head.quaternion"],
    "source root translation policy should strip root, hips, and pelvis translation carriers"
  );
  assert.equal(locomotionAuthoredClip.tracks.length, 11, "source track policy should not mutate the original clip");

  const locomotionRuntimeRoot = new Object3D();
  const locomotionRuntimeBones = new Map<string, Object3D>();
  for (const name of ["hips", "spine", "leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand", "leftIndexProximal", "rightThumbDistal", "leftUpperLeg", "leftLowerLeg", "rightFoot"]) {
    const bone = new Object3D();
    bone.name = name;
    locomotionRuntimeRoot.add(bone);
    locomotionRuntimeBones.set(name, bone);
  }
  const locomotionThreeClip = createThreeAnimationClip(locomotionBaseClip, {
    resolveBone: (bone) => locomotionRuntimeBones.get(bone)
  });
  assert.deepEqual(
    locomotionThreeClip.tracks.map((track) => track.name.split(".").at(-1)),
    ["position", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion", "quaternion"],
    "runtime clip creation should consume source-filtered locomotion tracks"
  );
  assert.equal(
    locomotionThreeClip.tracks.some((track) =>
      ["leftIndexProximal", "rightThumbDistal"].some((name) => track.name.includes(locomotionRuntimeBones.get(name)!.uuid))
    ),
    false,
    "runtime locomotion clip should not contain authored finger tracks after policy filtering"
  );
  assert.equal(
    locomotionThreeClip.tracks.some((track) =>
      ["leftShoulder", "leftUpperArm", "rightLowerArm", "rightHand"].some((name) => track.name.includes(locomotionRuntimeBones.get(name)!.uuid))
    ),
    true,
    "runtime locomotion clip should retain authored shoulder, arm, and hand tracks"
  );

  const locomotionUpperBodyTargets = createThreeLocomotionUpperBodyTargets({ influence: 1.5, phase: 0.25, speed: 20 });
  assert.deepEqual(
    locomotionUpperBodyTargets.map((target) => target.bone),
    ["leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand"],
    "locomotion posture helper should expose a reusable full arm target set"
  );
  assert.equal(locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.influence, 1, "locomotion posture influence should clamp");
  assert.ok(
    (locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.rotation[2] ?? 0) > 1,
    "locomotion posture should roll the left upper arm down from a horizontal source-stripped pose"
  );
  assert.ok(
    (locomotionUpperBodyTargets.find((target) => target.bone === "rightUpperArm")?.rotation[2] ?? 0) < -1,
    "locomotion posture should roll the right upper arm down from a horizontal source-stripped pose"
  );
  assert.ok(
    (locomotionUpperBodyTargets.find((target) => target.bone === "leftUpperArm")?.rotation[0] ?? 0) >
      (createThreeLocomotionUpperBodyTargets({ influence: 1, phase: 0.75 }).find((target) => target.bone === "leftUpperArm")?.rotation[0] ?? 0),
    "locomotion posture should phase arm swing"
  );

  const locomotionPostureBones = new Map<string, Object3D>();
  const locomotionPostureRoot = new Object3D();
  for (const name of locomotionUpperBodyTargets.map((target) => target.bone)) {
    const bone = new Object3D();
    bone.name = name;
    locomotionPostureBones.set(name, bone);
  }
  const locomotionPostureHips = new Object3D();
  locomotionPostureHips.name = "hips";
  locomotionPostureBones.set("hips", locomotionPostureHips);
  locomotionPostureRoot.add(locomotionPostureHips);
  attachArmChain(locomotionPostureRoot, locomotionPostureBones, "left", 1);
  attachArmChain(locomotionPostureRoot, locomotionPostureBones, "right", -1);
  const locomotionPostureResult = applyThreeLocomotionUpperBodyPosture({
    resolveBone: (bone) => locomotionPostureBones.get(bone),
    deltaSeconds: 1,
    phase: 0,
    influence: 1,
    speed: 100
  });
  assert.equal(locomotionPostureResult.applied, true, "locomotion posture should apply through the same target path as presence");
  locomotionPostureRoot.updateMatrixWorld(true);
  const leftPostureRoot = locomotionPostureBones.get("leftUpperArm")!.getWorldPosition(new Vector3());
  const leftPostureJoint = locomotionPostureBones.get("leftLowerArm")!.getWorldPosition(new Vector3());
  const leftPostureUpperDirection = leftPostureJoint.sub(leftPostureRoot).normalize();
  const rightPostureRoot = locomotionPostureBones.get("rightUpperArm")!.getWorldPosition(new Vector3());
  const rightPostureJoint = locomotionPostureBones.get("rightLowerArm")!.getWorldPosition(new Vector3());
  const rightPostureUpperDirection = rightPostureJoint.sub(rightPostureRoot).normalize();
  assert.ok(
    leftPostureUpperDirection.y < -0.6 && Math.abs(leftPostureUpperDirection.x) < 0.25 && rightPostureUpperDirection.y < -0.6 && Math.abs(rightPostureUpperDirection.x) < 0.25,
    "locomotion posture application should keep upper arms close to the torso in model space"
  );
  assert.ok(
    Math.abs(locomotionPostureBones.get("leftLowerArm")!.quaternion.x) > 0.05 || Math.abs(locomotionPostureBones.get("leftLowerArm")!.quaternion.z) > 0.05,
    "locomotion posture IK should bend the lower arm toward the hand target"
  );

  const rotatedLocomotionPostureBones = new Map<string, Object3D>();
  const rotatedLocomotionPostureRoot = new Object3D();
  rotatedLocomotionPostureRoot.rotation.y = Math.PI / 2;
  for (const name of locomotionUpperBodyTargets.map((target) => target.bone)) {
    const bone = new Object3D();
    bone.name = name;
    rotatedLocomotionPostureBones.set(name, bone);
  }
  const rotatedLocomotionPostureHips = new Object3D();
  rotatedLocomotionPostureHips.name = "hips";
  rotatedLocomotionPostureBones.set("hips", rotatedLocomotionPostureHips);
  rotatedLocomotionPostureRoot.add(rotatedLocomotionPostureHips);
  attachArmChain(rotatedLocomotionPostureRoot, rotatedLocomotionPostureBones, "left", 1);
  attachArmChain(rotatedLocomotionPostureRoot, rotatedLocomotionPostureBones, "right", -1);
  const rotatedPostureResult = applyThreeLocomotionUpperBodyPosture({
    resolveBone: (bone) => rotatedLocomotionPostureBones.get(bone),
    deltaSeconds: 1,
    phase: 0.125,
    influence: 1,
    speed: 100
  });
  assert.equal(rotatedPostureResult.applied, true, "locomotion posture should apply on a yawed avatar root");
  rotatedLocomotionPostureRoot.updateMatrixWorld(true);
  const rotatedForward = new Vector3(0, 0, -1)
    .applyQuaternion(rotatedLocomotionPostureHips.getWorldQuaternion(new Quaternion()))
    .setY(0)
    .normalize();
  for (const side of ["left", "right"] as const) {
    const shoulder = rotatedLocomotionPostureBones.get(`${side}UpperArm`)!.getWorldPosition(new Vector3());
    const elbow = rotatedLocomotionPostureBones.get(`${side}LowerArm`)!.getWorldPosition(new Vector3());
    const hand = rotatedLocomotionPostureBones.get(`${side}Hand`)!.getWorldPosition(new Vector3());
    assert.ok(signedJointForwardOffset(shoulder, elbow, hand, rotatedForward) > -0.005, "locomotion posture elbows should follow avatar forward on yawed roots");
  }

  const runtime = new AnimationRuntime(skeleton);
  runtime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
  runtime.update(0.5);
  const evaluated = runtime.evaluate();
  assert.ok(evaluated.activeLayers.length === 1);
  assert.ok(evaluated.localPose[2]!.rotation[0] > 0.1);
  assert.equal(evaluated.diagnostics, undefined);

  const runtimeBackwardCompatibleUpdate = new AnimationRuntime(skeleton);
  runtimeBackwardCompatibleUpdate.setLayer("fading", nodClip, { weight: 0.0004, targetWeight: 0, fadeSpeed: 8 });
  runtimeBackwardCompatibleUpdate.update(1);
  assert.equal(runtimeBackwardCompatibleUpdate.evaluate().activeLayers.length, 0, "update without root-motion collection should keep removing faded layers");

  const runtimeRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeRootMotion.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true });
  const runtimeRootMotionUpdate = runtimeRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(runtimeRootMotionUpdate.rootMotionDelta.translation, [5, 0, 0], "runtime root motion should collect root carrier interval translation");
  assert.ok(
    quaternionNearlyEqual(runtimeRootMotionUpdate.rootMotionDelta.rotation, quatFromAxisAngle([0, 1, 0], Math.PI / 2), 1e-5),
    "runtime root motion should collect root carrier interval rotation"
  );
  assert.equal(runtimeRootMotionUpdate.rootMotionLayers[0]?.carrier.joint, "root");
  assert.equal(runtimeRootMotion.evaluate().localPose[0]!.translation[0], 5, "root-motion collection should not strip or separately apply pose motion");

  const runtimeLoopingTime = new AnimationRuntime(motionSkeleton);
  runtimeLoopingTime.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.75 });
  const runtimeLoopingTimeUpdate = runtimeLoopingTime.update(2.5, { collectRootMotion: true });
  assert.equal(runtimeLoopingTime.evaluate().activeLayers[0]?.time, 0.25, "looping runtime layers should store wrapped clip time after update");
  assert.equal(runtimeLoopingTimeUpdate.rootMotionLayers[0]?.fromTime, 0.75, "root-motion diagnostics should keep the unwrapped interval start");
  assert.equal(runtimeLoopingTimeUpdate.rootMotionLayers[0]?.toTime, 3.25, "root-motion diagnostics should keep the unwrapped interval end");
  assert.deepEqual(runtimeLoopingTimeUpdate.rootMotionDelta.translation, [25, 0, 0], "multi-loop runtime root motion should accumulate the full update span");

  const runtimeLoopBoundary = new AnimationRuntime(motionSkeleton);
  runtimeLoopBoundary.setLayer("move", motionClip, { weight: 1, targetWeight: 1, loop: true, time: 0.5 });
  runtimeLoopBoundary.update(0.5);
  assert.equal(runtimeLoopBoundary.evaluate().activeLayers[0]?.time, 0, "looping runtime layers should wrap exact duration endpoints to zero");

  const runtimeNonLoopingTime = new AnimationRuntime(motionSkeleton);
  runtimeNonLoopingTime.setLayer("move-once", motionClip, { weight: 1, targetWeight: 1, loop: false, time: 0.75 });
  runtimeNonLoopingTime.update(2.5);
  assert.equal(runtimeNonLoopingTime.evaluate().activeLayers[0]?.time, 1, "non-looping runtime layers should clamp to finite clip duration");

  const runtimeZeroDurationClip: AnimationClip = { id: "runtime-zero-duration", duration: 0, loop: true, tracks: [] };
  const runtimeNonFiniteDurationClip: AnimationClip = { id: "runtime-non-finite-duration", duration: Number.NaN, loop: true, tracks: [] };
  const runtimeInvalidDurationTime = new AnimationRuntime(motionSkeleton);
  runtimeInvalidDurationTime.setLayer("zero", runtimeZeroDurationClip, { weight: 1, targetWeight: 1, loop: true, time: 0.25 });
  runtimeInvalidDurationTime.setLayer("nan", runtimeNonFiniteDurationClip, { weight: 1, targetWeight: 1, loop: true, time: 0.25 });
  runtimeInvalidDurationTime.update(0.5);
  assert.deepEqual(
    runtimeInvalidDurationTime.evaluate().activeLayers.map((layer) => [layer.id, layer.time]),
    [["nan", 0.75], ["zero", 0.75]],
    "invalid-duration runtime layers should keep finite advanced times instead of wrapping through invalid durations"
  );

  const runtimeHumanoidRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeHumanoidRootMotion.setLayer("hips-move", motionClip, { weight: 1, targetWeight: 1, motionCarrier: { humanBone: "hips" } });
  const runtimeHumanoidMotionUpdate = runtimeHumanoidRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(runtimeHumanoidMotionUpdate.rootMotionDelta.translation, [0, 0, 3], "runtime root motion should support explicit humanoid carriers");
  assert.equal(runtimeHumanoidMotionUpdate.rootMotionLayers[0]?.carrier.joint, "hips");

  const runtimeInvalidRootMotion = new AnimationRuntime(motionSkeleton);
  const runtimeInvalidLayer = runtimeInvalidRootMotion.setLayer("invalid", motionClip, { weight: 1, targetWeight: 1, loop: true });
  runtimeInvalidLayer.time = Number.POSITIVE_INFINITY;
  runtimeInvalidLayer.speed = Number.POSITIVE_INFINITY;
  const invalidRootMotionUpdate = runtimeInvalidRootMotion.update(Number.NaN, { collectRootMotion: true });
  assert.deepEqual(invalidRootMotionUpdate.rootMotionDelta, identityTransform(), "non-finite root-motion update input should produce identity motion");
  assert.equal(invalidRootMotionUpdate.rootMotionLayers.length, 0, "non-finite root-motion update input should not emit unsafe layer deltas");

  const runtimeZeroWeightRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeZeroWeightRootMotion.setLayer("zero", motionClip, { weight: 0, targetWeight: 0, loop: true });
  const zeroWeightRootMotionUpdate = runtimeZeroWeightRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(zeroWeightRootMotionUpdate.rootMotionDelta, identityTransform(), "zero-weight root-motion layers should produce identity motion");
  assert.equal(zeroWeightRootMotionUpdate.rootMotionLayers.length, 0, "zero-weight root-motion layers should not emit diagnostics");

  const maskedMotionPoseClip: AnimationClip = {
    id: "masked-motion-pose",
    duration: 1,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
      { joint: "spine", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0.5, 0]) }
    ]
  };
  const runtimeMaskedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeMaskedRootMotion.setLayer("upper-body", maskedMotionPoseClip, {
    weight: 1,
    targetWeight: 1,
    mask: createJointMask(motionSkeleton, 0, { spine: 1 })
  });
  const maskedRootMotionUpdate = runtimeMaskedRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(maskedRootMotionUpdate.rootMotionDelta, identityTransform(), "masked-out root carrier should not contribute root motion");
  assert.equal(maskedRootMotionUpdate.rootMotionLayers.length, 0, "masked-out root carrier should not emit root-motion diagnostics");
  assert.deepEqual(
    runtimeMaskedRootMotion.evaluate().localPose[2]!.translation,
    [0, 0.25, 0],
    "root-motion masking should still allow the layer to own unmasked pose joints"
  );

  const weightedMotionA: AnimationClip = {
    id: "weighted-motion-a",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
  };
  const weightedMotionB: AnimationClip = {
    id: "weighted-motion-b",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 2, 0, 0]) }]
  };
  const runtimeWeightedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeWeightedRootMotion.setLayer("motion-a", weightedMotionA, { weight: 3, targetWeight: 3, priority: 2 });
  runtimeWeightedRootMotion.setLayer("motion-b", weightedMotionB, { weight: 1, targetWeight: 1, priority: 2 });
  const weightedRootMotionUpdate = runtimeWeightedRootMotion.update(0.5, { collectRootMotion: true });
  assert.ok(Math.abs(weightedRootMotionUpdate.rootMotionDelta.translation[0] - 4) < 1e-6, "same-priority root motion should normalize positive override weights");
  assert.ok(weightedRootMotionUpdate.rootMotionDelta.translation.every(Number.isFinite), "weighted root motion should stay finite");
  assert.deepEqual(
    weightedRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
    [["motion-a", 0.75], ["motion-b", 0.25]],
    "weighted root-motion diagnostics should be deterministic"
  );
  const scaledMotionA: AnimationClip = {
    id: "scaled-motion-a",
    duration: 1,
    tracks: [{ joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 1, 1, 2, 3, 4]) }]
  };
  const scaledMotionB: AnimationClip = {
    id: "scaled-motion-b",
    duration: 1,
    tracks: [{ joint: "root", property: "scale", times: toFloat32Array([0, 1]), values: toFloat32Array([1, 1, 1, 4, 7, 8]) }]
  };
  const runtimeScaledRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeScaledRootMotion.setLayer("scaled-a", scaledMotionA, { weight: 1, targetWeight: 1, priority: 2 });
  runtimeScaledRootMotion.setLayer("scaled-b", scaledMotionB, { weight: 3, targetWeight: 3, priority: 2 });
  const scaledRootMotionUpdate = runtimeScaledRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    vectorNearlyEqual(scaledRootMotionUpdate.rootMotionDelta.scale, [3.5, 6, 7], 1e-6),
    "runtime root-motion blending should preserve weighted carrier scale deltas"
  );

  const runtimeSteadyIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeSteadyIntervalRootMotion.setLayer("steady", weightedMotionA, { weight: 0.5, targetWeight: 0.5, fadeSpeed: 8 });
  const steadyIntervalRootMotionUpdate = runtimeSteadyIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(steadyIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 5) < 1e-6,
    "steady root-motion weights should preserve the existing threshold-scaled behavior"
  );
  assert.deepEqual(
    steadyIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["steady", 0.5, 1]],
    "steady root-motion diagnostics should report the unchanged effective weight"
  );

  const runtimeFadeInIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeFadeInIntervalRootMotion.setLayer("fade-in", weightedMotionA, { weight: 0, targetWeight: 1, fadeSpeed: Math.log(4) });
  const fadeInIntervalRootMotionUpdate = runtimeFadeInIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fadeInIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 3.75) < 1e-6,
    "fade-in root motion should use interval-average weight instead of applying the endpoint weight to the whole interval"
  );
  assert.deepEqual(
    fadeInIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["fade-in", 0.375, 1]],
    "fade-in root-motion diagnostics should expose the interval effective weight"
  );

  const runtimeFadeOutIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeFadeOutIntervalRootMotion.setLayer("fade-out", weightedMotionA, { weight: 1, targetWeight: 0, fadeSpeed: Math.log(4) });
  const fadeOutIntervalRootMotionUpdate = runtimeFadeOutIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fadeOutIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 6.25) < 1e-6,
    "fade-out root motion should use interval-average weight symmetrically"
  );
  assert.deepEqual(
    fadeOutIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["fade-out", 0.625, 1]],
    "fade-out root-motion diagnostics should expose the interval effective weight"
  );

  const runtimeFractionalMaskedRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeFractionalMaskedRootMotion.setLayer("masked-motion-a", weightedMotionA, {
    weight: 1,
    targetWeight: 1,
    priority: 2,
    mask: createJointMask(motionSkeleton, 0, { root: 0.5 })
  });
  runtimeFractionalMaskedRootMotion.setLayer("motion-b", weightedMotionB, { weight: 1, targetWeight: 1, priority: 2 });
  const fractionalMaskedRootMotionUpdate = runtimeFractionalMaskedRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(fractionalMaskedRootMotionUpdate.rootMotionDelta.translation[0] - 14 / 3) < 1e-6,
    "fractional carrier mask weight should attenuate root-motion blend weight"
  );
  assert.deepEqual(
    fractionalMaskedRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["masked-motion-a", 0.5, 1 / 3], ["motion-b", 1, 2 / 3]],
    "fractional carrier masks should be reflected in root-motion diagnostics"
  );

  const runtimeMaskedFadeIntervalRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 1 });
  runtimeMaskedFadeIntervalRootMotion.setLayer("masked-fade-in", weightedMotionA, {
    weight: 0,
    targetWeight: 1,
    fadeSpeed: Math.log(4),
    mask: createJointMask(motionSkeleton, 0, { root: 0.5 })
  });
  const maskedFadeIntervalRootMotionUpdate = runtimeMaskedFadeIntervalRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(maskedFadeIntervalRootMotionUpdate.rootMotionDelta.translation[0] - 1.875) < 1e-6,
    "masked fade-in root motion should average the masked effective weights across the traversed interval"
  );
  assert.deepEqual(
    maskedFadeIntervalRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.weight, layer.normalizedWeight]),
    [["masked-fade-in", 0.1875, 1]],
    "masked fade-in root-motion diagnostics should report the interval masked effective weight"
  );

  const weakPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
  weakPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
  weakPriorityRootMotion.setLayer("weak-override-motion", weightedMotionB, { weight: 0.05, targetWeight: 0.05, priority: 1 });
  const weakPriorityRootMotionUpdate = weakPriorityRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(weakPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 6) < 1e-6,
    "under-threshold higher-priority root motion should partially blend with lower-priority fallback motion"
  );
  assert.deepEqual(
    weakPriorityRootMotionUpdate.rootMotionLayers.map((layer) => [layer.id, layer.normalizedWeight]),
    [["base-motion", 1], ["weak-override-motion", 1]],
    "priority fallback root-motion diagnostics should preserve per-group normalized weights"
  );

  const thresholdPriorityRootMotion = new AnimationRuntime(motionSkeleton, { blendThreshold: 0.1 });
  thresholdPriorityRootMotion.setLayer("base-motion", weightedMotionA, { weight: 1, targetWeight: 1, priority: 0 });
  thresholdPriorityRootMotion.setLayer("threshold-override-motion", weightedMotionB, { weight: 0.1, targetWeight: 0.1, priority: 1 });
  const thresholdPriorityRootMotionUpdate = thresholdPriorityRootMotion.update(1, { collectRootMotion: true });
  assert.ok(
    Math.abs(thresholdPriorityRootMotionUpdate.rootMotionDelta.translation[0] - 2) < 1e-6,
    "at-threshold higher-priority root motion should fully replace lower-priority fallback motion"
  );

  const oppositeMotionA: AnimationClip = {
    id: "opposite-motion-a",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
  };
  const oppositeMotionB: AnimationClip = {
    id: "opposite-motion-b",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, -10, 0, 0]) }]
  };
  const runtimeOppositeRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeOppositeRootMotion.setLayer("opposite-a", oppositeMotionA, { weight: 1, targetWeight: 1, priority: 3 });
  runtimeOppositeRootMotion.setLayer("opposite-b", oppositeMotionB, { weight: 1, targetWeight: 1, priority: 3 });
  const oppositeRootMotionUpdate = runtimeOppositeRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(oppositeRootMotionUpdate.rootMotionDelta.translation, [0, 0, 0], "opposite equal root-motion directions should cancel instead of sequentially accumulating length");
  assert.deepEqual(oppositeRootMotionUpdate.rootMotionDelta.scale, [1, 1, 1], "blended root-motion deltas should keep identity scale");

  const orthogonalMotionA: AnimationClip = {
    id: "orthogonal-motion-a",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) }]
  };
  const orthogonalMotionB: AnimationClip = {
    id: "orthogonal-motion-b",
    duration: 1,
    tracks: [{ joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 10]) }]
  };
  const runtimeOrthogonalRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeOrthogonalRootMotion.setLayer("orthogonal-a", orthogonalMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeOrthogonalRootMotion.setLayer("orthogonal-b", orthogonalMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  const orthogonalRootMotionUpdate = runtimeOrthogonalRootMotion.update(1, { collectRootMotion: true });
  assert.deepEqual(orthogonalRootMotionUpdate.rootMotionDelta.translation, [5, 0, 5], "orthogonal equal root-motion deltas should blend to the weighted vector average");

  const rotationOrderMotionA: AnimationClip = {
    id: "rotation-order-motion-a",
    duration: 1,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 0, 0, 10]) },
      { joint: "root", property: "quaternion", times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)]) }
    ]
  };
  const rotationOrderMotionB: AnimationClip = {
    id: "rotation-order-motion-b",
    duration: 1,
    tracks: [
      { joint: "root", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0, 10, 0, 0]) },
      { joint: "root", property: "quaternion", times: toFloat32Array([0, 1]), values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 2)]) }
    ]
  };
  const runtimeRootMotionOrderA = new AnimationRuntime(motionSkeleton);
  runtimeRootMotionOrderA.setLayer("first", rotationOrderMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeRootMotionOrderA.setLayer("second", rotationOrderMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  const rootMotionOrderUpdateA = runtimeRootMotionOrderA.update(0.5, { collectRootMotion: true });
  const runtimeRootMotionOrderB = new AnimationRuntime(motionSkeleton);
  runtimeRootMotionOrderB.setLayer("z-second", rotationOrderMotionB, { weight: 1, targetWeight: 1, priority: 4 });
  runtimeRootMotionOrderB.setLayer("a-first", rotationOrderMotionA, { weight: 1, targetWeight: 1, priority: 4 });
  const rootMotionOrderUpdateB = runtimeRootMotionOrderB.update(0.5, { collectRootMotion: true });
  assert.deepEqual(rootMotionOrderUpdateA.rootMotionDelta.translation, rootMotionOrderUpdateB.rootMotionDelta.translation, "same-priority root-motion translation should be independent of layer id/order");
  assert.ok(
    quaternionNearlyEqual(rootMotionOrderUpdateA.rootMotionDelta.rotation, rootMotionOrderUpdateB.rootMotionDelta.rotation, 1e-6),
    "same-priority root-motion rotation should be independent of layer id/order"
  );

  const runtimeAdditiveRootMotion = new AnimationRuntime(motionSkeleton);
  runtimeAdditiveRootMotion.setLayer("base", weightedMotionB, { weight: 1, targetWeight: 1 });
  runtimeAdditiveRootMotion.setLayer("additive-motion", weightedMotionA, { weight: 1, targetWeight: 1, blendMode: "additive" });
  const additiveRootMotionUpdate = runtimeAdditiveRootMotion.update(0.5, { collectRootMotion: true });
  assert.deepEqual(additiveRootMotionUpdate.rootMotionDelta.translation, [1, 0, 0], "additive layers should not contribute to runtime root motion");
  assert.deepEqual(additiveRootMotionUpdate.rootMotionLayers.map((layer) => layer.id), ["base"]);

  const sanitizedRuntime = new AnimationRuntime(skeleton);
  const sanitizedLayer = sanitizedRuntime.setLayer("bad-inputs", nodClip, {
    time: Number.NaN,
    weight: Number.NEGATIVE_INFINITY,
    targetWeight: -2,
    fadeSpeed: Number.POSITIVE_INFINITY,
    speed: -1,
    priority: -3
  });
  assert.equal(sanitizedLayer.time, 0);
  assert.equal(sanitizedLayer.weight, 0);
  assert.equal(sanitizedLayer.targetWeight, 0);
  assert.equal(sanitizedLayer.fadeSpeed, 8);
  assert.equal(sanitizedLayer.speed, 0);
  assert.equal(sanitizedLayer.priority, 0);

  const sanitizedCrossfade = sanitizedRuntime.crossfade("bad-crossfade", nodClip, {
    time: -1,
    weight: Number.NaN,
    targetWeight: Number.POSITIVE_INFINITY,
    fadeSpeed: -4,
    speed: Number.NaN,
    priority: Number.NEGATIVE_INFINITY
  });
  assert.equal(sanitizedCrossfade.time, 0);
  assert.equal(sanitizedCrossfade.weight, 0);
  assert.equal(sanitizedCrossfade.targetWeight, 1);
  assert.equal(sanitizedCrossfade.fadeSpeed, 0);
  assert.equal(sanitizedCrossfade.speed, 1);
  assert.equal(sanitizedCrossfade.priority, 0);
  sanitizedRuntime.fadeOut("bad-crossfade", Number.NaN);
  assert.equal(sanitizedCrossfade.fadeSpeed, 8);

  const corruptedRuntime = new AnimationRuntime(skeleton);
  const corruptedLayer = corruptedRuntime.setLayer("corrupted", nodClip, { weight: 1, targetWeight: 1, loop: true });
  corruptedLayer.time = Number.POSITIVE_INFINITY;
  corruptedLayer.targetWeight = Number.NaN;
  corruptedLayer.fadeSpeed = Number.NEGATIVE_INFINITY;
  corruptedLayer.speed = Number.POSITIVE_INFINITY;
  corruptedLayer.priority = Number.NaN;
  corruptedRuntime.update(Number.NaN);
  corruptedRuntime.update(-1);
  const corruptedEvaluation = corruptedRuntime.evaluate();
  const corruptedActiveLayer = corruptedEvaluation.activeLayers.find((layer) => layer.id === "corrupted");
  assert.ok(corruptedActiveLayer);
  assert.equal(corruptedActiveLayer.time, 0);
  assert.equal(corruptedActiveLayer.weight, 1);
  assert.equal(corruptedActiveLayer.targetWeight, 0);
  assert.equal(corruptedActiveLayer.priority, 0);
  assert.ok(corruptedEvaluation.activeLayers.every((layer) => [layer.time, layer.weight, layer.targetWeight, layer.priority].every(Number.isFinite)));
  assertFiniteEvaluation(corruptedEvaluation);

  const invalidRuntime = new AnimationRuntime(skeleton);
  const invalidTranslationScaleClip: AnimationClip = {
    id: "invalid-translation-scale",
    duration: 1,
    tracks: [
      { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([Number.NaN, 0, 0]) },
      { humanBone: "head", property: "scale", times: toFloat32Array([0]), values: toFloat32Array([1, Number.POSITIVE_INFINITY, 1]) }
    ]
  };
  invalidRuntime.setLayer("invalid-source", invalidTranslationScaleClip, { weight: 1, targetWeight: 1, blendMode: "additive" });
  assert.equal(invalidRuntime.evaluate().diagnostics, undefined, "runtime diagnostics should stay opt-in");
  const invalidEvaluation = invalidRuntime.evaluate({ diagnostics: true });
  assert.ok(invalidEvaluation.diagnostics!.some((issue) => issue.stage === "sample" && issue.layerId === "invalid-source" && issue.clipId === "invalid-translation-scale"));
  assert.ok(
    invalidEvaluation.diagnostics!.some(
      (issue) =>
        issue.stage === "sample" &&
        issue.layerId === "invalid-source" &&
        issue.clipId === "invalid-translation-scale" &&
        issue.track === 0 &&
        issue.sample === 0 &&
        issue.joint === "spine" &&
        issue.index === 1 &&
        issue.message === "translation track sample values were repaired to finite defaults"
    ),
    "runtime diagnostics should report translation samples repaired during sampling"
  );
  assert.ok(
    invalidEvaluation.diagnostics!.some(
      (issue) =>
        issue.stage === "sample" &&
        issue.layerId === "invalid-source" &&
        issue.clipId === "invalid-translation-scale" &&
        issue.track === 1 &&
        issue.sample === 0 &&
        issue.joint === "head" &&
        issue.index === 2 &&
        issue.message === "scale track sample values were repaired to finite defaults"
    ),
    "runtime diagnostics should report scale samples repaired during sampling"
  );
  assert.equal(
    invalidEvaluation.diagnostics!.some((issue) => issue.stage === "final" && issue.joint === "spine"),
    false,
    "translation and scale sample repairs should prevent final-pose diagnostics for the repaired joints"
  );
  assertFiniteEvaluation(invalidEvaluation);
  for (const transform of invalidEvaluation.localPose) {
    assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-5);
  }

  const invalidRotationRuntime = new AnimationRuntime(skeleton);
  const invalidRotationClip: AnimationClip = {
    id: "invalid-rotation",
    duration: 1,
    tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, Number.NaN, 0, 1]) }]
  };
  invalidRotationRuntime.setLayer("invalid-rotation-source", invalidRotationClip, { weight: 1, targetWeight: 1 });
  const invalidRotationEvaluation = invalidRotationRuntime.evaluate({ diagnostics: true });
  assert.ok(
    invalidRotationEvaluation.diagnostics!.some((issue) => issue.stage === "sample" && issue.layerId === "invalid-rotation-source" && issue.clipId === "invalid-rotation"),
    "runtime diagnostics should report invalid active rotation source tracks"
  );

  const repairedRotationRuntime = new AnimationRuntime(skeleton);
  const repairedRotationClip: AnimationClip = {
    id: "repaired-runtime-rotation",
    duration: 1,
    tracks: [{ humanBone: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }]
  };
  repairedRotationRuntime.setLayer("repaired-runtime-rotation-source", repairedRotationClip, { weight: 1, targetWeight: 1 });
  const repairedRotationEvaluation = repairedRotationRuntime.evaluate({ diagnostics: true });
  assert.ok(
    repairedRotationEvaluation.diagnostics!.some(
      (issue) =>
        issue.stage === "sample" &&
        issue.layerId === "repaired-runtime-rotation-source" &&
        issue.clipId === "repaired-runtime-rotation" &&
        issue.track === 0 &&
        issue.sample === 0 &&
        issue.joint === "head" &&
        issue.index === 2 &&
        issue.message === "rotation track quaternion was repaired to a normalizable fallback"
    ),
    "runtime diagnostics should report rotation samples repaired during sampling"
  );
  assert.ok(repairedRotationEvaluation.localPose[2]!.rotation.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...repairedRotationEvaluation.localPose[2]!.rotation) - 1) < 1e-5);

  const repairedSourceRestRuntime = new AnimationRuntime(skeleton);
  const repairedSourceRestClip: AnimationClip = {
    id: "repaired-runtime-source-rest",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1]),
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 0])
      }
    ]
  };
  repairedSourceRestRuntime.setLayer("repaired-runtime-source-rest-source", repairedSourceRestClip, { weight: 1, targetWeight: 1 });
  const repairedSourceRestEvaluation = repairedSourceRestRuntime.evaluate({ diagnostics: true });
  assert.ok(
    repairedSourceRestEvaluation.diagnostics!.some(
      (issue) =>
        issue.stage === "sample" &&
        issue.layerId === "repaired-runtime-source-rest-source" &&
        issue.clipId === "repaired-runtime-source-rest" &&
        issue.track === 0 &&
        issue.joint === "head" &&
        issue.index === 2 &&
        issue.message === "sourceRestQuaternion was repaired to a normalizable fallback"
    ),
    "runtime diagnostics should report malformed source-rest metadata repaired during sampling"
  );
  assert.ok(repairedSourceRestEvaluation.localPose[2]!.rotation.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...repairedSourceRestEvaluation.localPose[2]!.rotation) - 1) < 1e-5);
}
