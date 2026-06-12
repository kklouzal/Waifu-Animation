import assert from "node:assert/strict";
import { AnimationMixer, Object3D } from "three";
import {
  AnimationRuntime,
  type AnimationClip,
  BlinkScheduler,
  FacialExpressionMixer,
  PresencePlanner,
  WAIFU_ANIMATION_BINARY_FORMAT,
  VisemeMixer,
  applyThreeFootPlantResult,
  applyThreePresenceTargets,
  calculateThreeBaseLoopSeamWindow,
  calculateThreeBaseLoopTransitionWeights,
  calculateThreeOverlayFade,
  calculateThreeRuntimeStartTime,
  clearThreeFootPlantOffsets,
  blendPoses,
  clamp01,
  createJointMask,
  DEFAULT_BLEND_THRESHOLD,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  calculateThreeRuntimeInfluence,
  decodeAnimationBinary,
  encodeAnimationBinary,
  readActiveThreeRuntimeClipSnapshots,
  readThreeRuntimeClipSnapshot,
  prepareThreeRuntimeAction,
  createSkeleton,
  cloneTransform,
  distributeLookAt,
  filterTracksByNamePolicy,
  inspectAnimationAsset,
  inspectClipAsset,
  localToModelPose,
  normalizeQuat,
  normalizeTransform,
  normalizeVec3,
  poseRotationMetric,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  multiplyQuat,
  invertQuat,
  retargetQuaternionSample,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  solveFootPlant,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  toFloat32Array,
  validateAnimationInputs
} from "../src/index.js";

const skeleton = createSkeleton([
  { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "head", parentName: "spine", humanoid: "head" },
  { name: "leftUpperArm", parentName: "spine", humanoid: "leftUpperArm" }
]);

const nodClip: AnimationClip = {
  id: "nod",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0, 0.5, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0.15, 0, 0, 0.9887, 0, 0, 0, 1])
    }
  ]
};

assert.equal(clamp01(2), 1);
assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [1, 0, 0]), [1, 0, 0]);
assert.deepEqual(normalizeVec3([Number.NaN, 0, 0], [2, 0, 0]), [1, 0, 0]);
assert.deepEqual(normalizeVec3([Infinity, 0, 0], [0, 1, 0]), [0, 1, 0]);
assert.deepEqual(normalizeVec3([0, 0, 0], [Number.NaN, 0, 0]), [0, 0, 1]);
const finiteQuatFallback = normalizeQuat([Number.NaN, 0, 0, 1], [0, 0, 0.5, 0.5]);
assert.ok(Math.abs(finiteQuatFallback[2] - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(finiteQuatFallback[3] - Math.SQRT1_2) < 1e-12);
assert.deepEqual(normalizeQuat([Infinity, 0, 0, 1], [0, 0, 0, 2]), [0, 0, 0, 1]);
assert.deepEqual(normalizeQuat([0, 0, 0, 0], [Number.NaN, 0, 0, 0]), [0, 0, 0, 1]);
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
const repairedRestSkeleton = createSkeleton([{ name: "root", rest: { translation: [Number.NaN, 5, Infinity], scale: [Number.NaN, 3, -Infinity] } }]);
assert.deepEqual(repairedRestSkeleton.restPose[0]!.translation, [0, 5, 0]);
assert.deepEqual(repairedRestSkeleton.restPose[0]!.scale, [1, 3, 1]);
assert.equal(validateAnimationInputs(skeleton, nodClip).accepted, true);
assert.equal(inspectClipAsset({ id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT }, nodClip).accepted, true);

const decodedNodClip = decodeAnimationBinary(encodeAnimationBinary(nodClip), "nod");
assert.equal(decodedNodClip.id, "nod");
assert.equal(decodedNodClip.tracks.length, 1);
assert.deepEqual(Array.from(decodedNodClip.tracks[0]!.times), [0, 0.5, 1]);
assert.ok(decodedNodClip.tracks[0]!.values instanceof Float32Array);

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
assert.equal(
  inspectAnimationAsset(
    { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true, states: ["idle"], source: { category: "idle", posture: "standing" } },
    nodClip,
    skeleton
  ).status,
  "accepted"
);

const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
assert.ok(sampled[2]!.rotation[0] > 0.1);

const models = localToModelPose(skeleton, sampled);
assert.equal(models.length, skeleton.joints.length);
assert.equal(models[0]![13], 1);

const mask = createJointMask(skeleton, 0, { head: 1 });
const blended = blendPoses(skeleton, [
  { pose: skeleton.restPose, weight: 1 },
  { pose: sampled, weight: 1, mask }
]);
assert.ok(blended[2]!.rotation[0] > 0.05);
assert.equal(blended[1]!.rotation[3], 1);


const tinyWeightBlend = blendPoses(skeleton, [{ pose: sampled, weight: DEFAULT_BLEND_THRESHOLD * 0.5 }]);
assert.ok(tinyWeightBlend[2]!.rotation[0] > 0);
assert.ok(tinyWeightBlend[2]!.rotation[0] < sampled[2]!.rotation[0]);

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

const crossfadeOldClip: AnimationClip = {
  id: "crossfade-old",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }]
};
const crossfadeNewClip: AnimationClip = {
  id: "crossfade-new",
  duration: 1,
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([10, 0, 0]) }]
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
  tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([1, 0, 0]) }]
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

const runtime = new AnimationRuntime(skeleton);
runtime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
runtime.update(0.5);
const evaluated = runtime.evaluate();
assert.ok(evaluated.activeLayers.length === 1);
assert.ok(evaluated.localPose[2]!.rotation[0] > 0.1);
assert.equal(evaluated.diagnostics, undefined);

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
assert.ok(invalidEvaluation.diagnostics!.some((issue) => issue.stage === "final" && issue.joint === "spine"));
for (const transform of invalidEvaluation.localPose) {
  assert.ok(transform.translation.every(Number.isFinite));
  assert.ok(transform.rotation.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-5);
  assert.ok(transform.scale.every(Number.isFinite));
}
for (const matrix of invalidEvaluation.modelPose) {
  assert.ok(Array.from(matrix).every(Number.isFinite));
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


const presenceBone = new Object3D();
presenceBone.name = "head";
const presenceApply = applyThreePresenceTargets({
  resolveBone: (bone) => (bone === "head" ? presenceBone : null),
  deltaSeconds: 1 / 30,
  targets: [{ bone: "head", rotation: [0.1, 0.2, 0], influence: 1, speed: 12 }]
});
assert.equal(presenceApply.applied, true);
assert.ok(Math.abs(presenceBone.quaternion.w) < 0.99999);
assert.equal(
  applyThreePresenceTargets({
    resolveBone: () => null,
    deltaSeconds: 1 / 30,
    targets: [{ bone: "missing", rotation: [0, 0, 0], influence: 1 }]
  }).issues.length,
  1
);

const retargeted = retargetQuaternionSample([0, 0, 0, 1], [0, 0, 0, 1], [0, 0.2, 0, 0.98]);
assert.ok(Math.abs(Math.hypot(...retargeted) - 1) < 1e-5);

const sourceRestX = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
const localSourceDeltaY = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
const sourceSampleWithLocalDelta = multiplyQuat(sourceRestX, localSourceDeltaY);
const expectedNormalizedDelta = multiplyQuat(sourceSampleWithLocalDelta, invertQuat(sourceRestX));
const retargetedToNormalizedRest = retargetQuaternionSample(sourceRestX, [0, 0, 0, 1], sourceSampleWithLocalDelta);
assert.ok(
  Math.abs(retargetedToNormalizedRest[0] - expectedNormalizedDelta[0]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[1] - expectedNormalizedDelta[1]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[2] - expectedNormalizedDelta[2]) < 1e-5 &&
    Math.abs(retargetedToNormalizedRest[3] - expectedNormalizedDelta[3]) < 1e-5,
  "retargeting should apply source rest correction before target rest so non-commuting local deltas keep their parent-space direction"
);

const authoredRotationBone = new Object3D();
authoredRotationBone.name = "head";
authoredRotationBone.quaternion.set(0.3, 0, 0, 0.953939).normalize();
const authoredRotationClip = createThreeAnimationClip(
  {
    id: "authored-local-rotation",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0.2, 0, 0.98])
      }
    ]
  },
  { resolveBone: (bone) => (bone === "head" ? authoredRotationBone : null) }
);
const authoredTrackValues = Array.from(authoredRotationClip.tracks[0]!.values as ArrayLike<number>);
assert.deepEqual(authoredTrackValues.slice(0, 4), [0, 0, 0, 1], "authored target-local rotations must not be pre-multiplied by target rest");
assert.ok(authoredTrackValues[5]! > 0.19, "authored target-local rotations should preserve sampled components");

const look = distributeLookAt([0.4, 0.2, 2]);
assert.ok(look.head.yaw > 0);
assert.ok(look.eyes.pitch > 0);

const presenceA = new PresencePlanner("presence-test", 0);
const presenceB = new PresencePlanner("presence-test", 0);
presenceA.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
presenceB.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
const presenceFrameA = presenceA.update({
  nowMs: 260,
  elapsedSeconds: 1.25,
  deltaSeconds: 1 / 30,
  behavior: { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
  affect: { arousal: 0.45, curiosity: 0.6, attentiveness: 0.8 },
  targetMouth: 0.1,
  clipBaseInfluence: 0.8,
  clipOverlayInfluence: 0.1
});
const presenceFrameB = presenceB.update({
  nowMs: 260,
  elapsedSeconds: 1.25,
  deltaSeconds: 1 / 30,
  behavior: { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
  affect: { arousal: 0.45, curiosity: 0.6, attentiveness: 0.8 },
  targetMouth: 0.1,
  clipBaseInfluence: 0.8,
  clipOverlayInfluence: 0.1
});
assert.deepEqual(presenceFrameA.lookAtTarget, presenceFrameB.lookAtTarget);
assert.ok(presenceFrameA.cueAmounts.glance > 0);
assert.ok(presenceFrameA.boneTargets.some((target) => target.bone === "head" && target.influence > 0));
assert.ok(presenceFrameA.boneTargets.every((target) => target.rotation.every(Number.isFinite)));

const ik = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
assert.ok(ik.targetReach > 0.9);
assert.ok(Number.isFinite(ik.joint[0]));

const ikCorrections = solveTwoBoneIkCorrections({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
const correctedUpper = rotateVec3ByQuat(ikCorrections.rootCorrection, [0, -1, 0]);
assert.ok(Math.hypot(correctedUpper[0] - ikCorrections.correctedUpperDirection[0], correctedUpper[1] - ikCorrections.correctedUpperDirection[1], correctedUpper[2] - ikCorrections.correctedUpperDirection[2]) < 1e-5);
assert.ok(Math.abs(Math.hypot(...ikCorrections.rootCorrection) - 1) < 1e-5);
assert.ok(Math.abs(Math.hypot(...ikCorrections.jointCorrection) - 1) < 1e-5);

const footPlant = solveFootPlant(
  [
    {
      id: "left",
      hip: [-0.1, 1, 0],
      knee: [-0.1, 0.55, 0.02],
      ankle: [-0.1, 0.18, 0],
      ground: { point: [-0.1, 0, 0], normal: [0, 1, 0], rayStart: [-0.1, 0.68, 0] }
    },
    {
      id: "right",
      hip: [0.1, 1, 0],
      knee: [0.1, 0.6, 0.02],
      ankle: [0.1, 0.08, 0],
      ground: { point: [0.1, 0, 0], normal: [0, 1, 0], rayStart: [0.1, 0.58, 0] }
    }
  ],
  { footHeight: 0.08 }
);
assert.equal(footPlant.plantedCount, 2);
assert.ok(footPlant.pelvisOffset[1] < 0);
assert.ok(footPlant.legs.every((leg) => leg.ik && Number.isFinite(leg.ik.joint[1])));
assert.ok(footPlant.legs.every((leg) => leg.ik && Math.abs(Math.hypot(...leg.ik.rootCorrection) - 1) < 1e-5));

const missingGroundPlant = solveFootPlant([{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.1, 0] }]);
assert.equal(missingGroundPlant.plantedCount, 0);
assert.equal(missingGroundPlant.legs[0]!.skippedReason, "missing-ground-contact");

const clampedFootPlant = solveFootPlant(
  [{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.4, 0], ground: { point: [0, -1, 0], normal: [0, 1, 0] } }],
  { footHeight: 0.08, maxAnkleCorrection: 0.1 }
);
assert.equal(clampedFootPlant.legs[0]!.clamped, true);
assert.ok(clampedFootPlant.legs[0]!.correctionDistance <= 0.1001);

const pelvisBone = new Object3D();
pelvisBone.name = "hips";
const leftHipBone = new Object3D();
leftHipBone.name = "leftUpperLeg";
const leftKneeBone = new Object3D();
leftKneeBone.name = "leftLowerLeg";
const leftAnkleBone = new Object3D();
leftAnkleBone.name = "leftFoot";
pelvisBone.add(leftHipBone);
leftHipBone.add(leftKneeBone);
leftKneeBone.add(leftAnkleBone);
pelvisBone.updateMatrixWorld(true);
const footPlantApply = applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) =>
    ({
      hips: pelvisBone,
      leftUpperLeg: leftHipBone,
      leftLowerLeg: leftKneeBone,
      leftFoot: leftAnkleBone
    })[bone] ?? null,
  pelvis: "hips",
  legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot" }],
  applyPelvis: true,
  applyLegIk: true
});
assert.equal(footPlantApply.applied, true);
assert.equal(footPlantApply.pelvisApplied, true);
assert.ok(pelvisBone.position.y < 0);
assert.ok(Math.abs(leftHipBone.quaternion.w) < 0.99999 || Math.abs(leftKneeBone.quaternion.w) < 0.99999);
const firstPelvisY = pelvisBone.position.y;
applyThreeFootPlantResult(footPlant, {
  resolveBone: (bone) => ({ hips: pelvisBone })[bone] ?? null,
  pelvis: "hips",
  legs: [],
  applyPelvis: true,
  applyLegIk: false
});
assert.ok(Math.abs(pelvisBone.position.y - firstPelvisY) < 1e-6);
const clearedFootPlant = clearThreeFootPlantOffsets({
  resolveBone: (bone) => ({ hips: pelvisBone })[bone] ?? null,
  pelvis: "hips"
});
assert.equal(clearedFootPlant.cleared, true);
assert.ok(Math.abs(pelvisBone.position.y) < 1e-6);

const visemes = new VisemeMixer({ maxTotal: 0.4 });
visemes.setTarget({ aa: 0.4, ou: 0.4 });
const mixed = visemes.update(1 / 30);
assert.ok(mixed.aa + mixed.ou <= 0.4001);

const blink = new BlinkScheduler("test", 0);
assert.equal(Number.isFinite(blink.update(16, 1 / 60, 0.5)), true);
blink.trigger(32, 100);
assert.equal(blink.update(48, 1 / 60, 0.5), 1);

const facial = new FacialExpressionMixer({
  visemes: {
    maxTotal: 0.42,
    attack: { aa: 30, ih: 34, ou: 28, ee: 34, oh: 28 },
    release: { aa: 20, ih: 24, ou: 18, ee: 24, oh: 18 }
  }
});
facial.setTarget({ targetMouth: 0.3, targetVisemes: { aa: 0.3, ee: 0.2 } });
const faceState = facial.update(1 / 30, {
  talking: true,
  blink: 1,
  mood: "warm",
  emotion: "happy",
  state: "speaking",
  energy: 0.6,
  rapport: 0.5,
  cueSmile: 0.2
});
assert.ok(faceState.mouthLevel > 0);
assert.ok(faceState.visemes.aa + faceState.visemes.ee <= 0.4201);
assert.equal(faceState.expressions.blink, 1);
assert.ok(faceState.expressions.happy > 0.1);

const metric = poseRotationMetric(skeleton.restPose, evaluated.localPose);
assert.ok(metric.maxRotationDelta > 0);

const headBone = new Object3D();
headBone.name = "normalizedHead";
const threeClip = createThreeAnimationClip(nodClip, {
  resolveBone: (humanBone) => (humanBone === "head" ? headBone : null)
});
assert.equal(threeClip.name, "nod");
assert.equal(threeClip.tracks.length, 1);
assert.equal(threeClip.tracks[0]!.name, "normalizedHead.quaternion");

const root = new Object3D();
const mixer = new AnimationMixer(root);
const runtimeClips = createThreeRuntimeClipsForEntry(
  { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true },
  mixer,
  threeClip
);
assert.equal(runtimeClips.length, 2);
assert.equal(runtimeClips[0]!.lane, "base");
assert.equal(runtimeClips[1]!.instance, 1);

assert.equal(calculateThreeRuntimeStartTime(-1, { startTime: 4 }), 0);
assert.equal(calculateThreeRuntimeStartTime(2, { startTime: -0.25 }), 0);
assert.equal(calculateThreeRuntimeStartTime(2, { startTime: 2.25 }), 0.25);
assert.equal(
  calculateThreeRuntimeStartTime(4, { matchPhaseFrom: { action: { time: 1.5 }, duration: 3 }, random: () => 0.9 }),
  2
);
assert.equal(calculateThreeRuntimeStartTime(4, { random: () => 0.25 }), 1);
assert.equal(calculateThreeRuntimeStartTime(4, { random: () => Number.NaN }), 0);
assert.equal(calculateThreeRuntimeStartTime(4, { randomizeBaseTime: false }), 0);

const preparedBaseAction = makeRuntimeActionStub(0.75);
const preparedBaseClip = makeRuntimeClipDiagnosticStub({
  id: "prepared-base",
  label: "Prepared Base",
  lane: "base",
  weight: 0,
  targetWeight: 0,
  time: 0,
  duration: 4,
  scheduled: false,
  running: false,
  action: preparedBaseAction
});
const preparedStartTime = prepareThreeRuntimeAction(preparedBaseClip, {
  matchPhaseFrom: { action: { time: 1.5 }, duration: 3 },
  weight: 2,
  timeScale: Number.NaN
});
assert.equal(preparedStartTime, 2);
assert.equal(preparedBaseAction.time, 2);
assert.equal(preparedBaseAction.enabled, true);
assert.equal(preparedBaseAction.paused, false);
assert.equal(preparedBaseAction.effectiveWeight, 1);
assert.equal(preparedBaseAction.effectiveTimeScale, 1);
assert.equal(preparedBaseAction.resetCount, 1);
assert.equal(preparedBaseAction.playCount, 1);
assert.equal(preparedBaseAction.stopFadingCount, 1);
assert.equal(preparedBaseAction.stopWarpingCount, 1);

const preparedOverlayAction = makeRuntimeActionStub(0);
const preparedOverlayClip = makeRuntimeClipDiagnosticStub({
  id: "prepared-overlay",
  label: "Prepared Overlay",
  lane: "overlay",
  weight: 0,
  targetWeight: 0,
  time: 0,
  duration: 1,
  scheduled: false,
  running: false,
  action: preparedOverlayAction
});
assert.equal(prepareThreeRuntimeAction(preparedOverlayClip, { startTime: 0.8, weight: -1, timeScale: 1.25 }), 0);
assert.equal(preparedOverlayAction.time, 0);
assert.equal(preparedOverlayAction.effectiveWeight, 0);
assert.equal(preparedOverlayAction.effectiveTimeScale, 1.25);

assert.equal(calculateThreeBaseLoopSeamWindow(Number.NaN), 0.32);
assert.equal(calculateThreeBaseLoopSeamWindow(2), 0.36);
assert.equal(calculateThreeBaseLoopSeamWindow(10), 0.72);
const transitionWeights = calculateThreeBaseLoopTransitionWeights({ elapsed: 0.5, duration: 1, fromWeight: 0.8, toWeight: 0.5 });
assert.ok(Math.abs(transitionWeights.progress - 0.5) < 1e-6);
assert.ok(Math.abs(transitionWeights.fromWeight - 0.4) < 1e-6);
assert.ok(Math.abs(transitionWeights.toWeight - 0.25) < 1e-6);
assert.equal(calculateThreeBaseLoopTransitionWeights({ elapsed: Number.NaN, duration: -1, fromWeight: 1, toWeight: 1 }).progress, 0);
assert.equal(calculateThreeBaseLoopTransitionWeights({ elapsed: 2, duration: 1, fromWeight: 1, toWeight: 1 }).complete, true);

const overlayFadeIn = calculateThreeOverlayFade({
  time: 0.25,
  duration: 2,
  currentWeight: 0,
  targetWeight: 0.8,
  deltaSeconds: Math.log(2) / 6.5
});
assert.equal(overlayFadeIn.fadingOut, false);
assert.equal(overlayFadeIn.targetWeight, 0.8);
assert.ok(Math.abs(overlayFadeIn.nextWeight - 0.4) < 1e-6);
const overlayFadeOut = calculateThreeOverlayFade({
  time: 1.7,
  duration: 2,
  currentWeight: 0.5,
  targetWeight: 0.8,
  deltaSeconds: Math.log(2) / 5.5
});
assert.equal(overlayFadeOut.fadeOutWindow, 0.42);
assert.equal(overlayFadeOut.fadingOut, true);
assert.equal(overlayFadeOut.targetWeight, 0);
assert.ok(Math.abs(overlayFadeOut.nextWeight - 0.25) < 1e-6);
assert.equal(
  calculateThreeOverlayFade({ time: 2, duration: 2, currentWeight: 0.005, targetWeight: 1, deltaSeconds: 0 }).shouldStop,
  true
);

const diagnosticBase = makeRuntimeClipDiagnosticStub({
  id: "bad-base",
  label: "Bad Base",
  lane: "base",
  weight: Number.POSITIVE_INFINITY,
  targetWeight: Number.NaN,
  time: Number.NaN,
  duration: Number.NEGATIVE_INFINITY,
  scheduled: true,
  running: true,
  instance: Number.NaN,
  states: ["idle"]
});
const diagnosticOverlay = makeRuntimeClipDiagnosticStub({
  id: "overlay",
  label: "Overlay",
  lane: "overlay",
  weight: 0.4,
  targetWeight: 2,
  time: 0.25,
  duration: 1.2,
  scheduled: false,
  running: false,
  gestures: ["wave"],
  source: { library: "test" }
});
const diagnosticDebug = makeRuntimeClipDiagnosticStub({
  id: "debug",
  label: "Debug",
  lane: "debug",
  weight: 0.65,
  targetWeight: 1,
  time: Number.POSITIVE_INFINITY,
  duration: 2,
  scheduled: false,
  running: true
});
const diagnosticSnapshot = readThreeRuntimeClipSnapshot(diagnosticBase, { loop: "seamed-once" });
assert.equal(diagnosticSnapshot.weight, 0);
assert.equal(diagnosticSnapshot.targetWeight, 0);
assert.equal(diagnosticSnapshot.time, 0);
assert.equal(diagnosticSnapshot.duration, 0);
assert.equal(diagnosticSnapshot.instance, 0);
assert.equal(diagnosticSnapshot.loop, "seamed-once");
assert.deepEqual(diagnosticSnapshot.states, ["idle"]);
diagnosticSnapshot.states.push("mutated");
assert.deepEqual(diagnosticBase.states, ["idle"], "snapshot metadata arrays should be detached from manifest metadata");

const activeSnapshots = readActiveThreeRuntimeClipSnapshots([diagnosticBase, diagnosticOverlay, diagnosticDebug], { debugLoop: "loop" });
assert.deepEqual(activeSnapshots.map((clip) => [clip.sourceId, clip.lane, clip.loop]), [
  ["bad-base", "base", "seamed-once"],
  ["overlay", "overlay", "once"],
  ["debug", "debug", "loop"]
]);
assert.equal(activeSnapshots[1]!.targetWeight, 1);
assert.equal(activeSnapshots[1]!.source?.library, "test");
assert.equal(activeSnapshots[2]!.time, 0);

assert.deepEqual(calculateThreeRuntimeInfluence([diagnosticBase, diagnosticOverlay], { debugWeight: 0.8 }), { base: 0, overlay: 0.8, debug: 0.8 });
assert.deepEqual(calculateThreeRuntimeInfluence([diagnosticOverlay, diagnosticDebug], { includeDebugAsOverlay: false }), { base: 0, overlay: 0.4, debug: 0.65 });

console.log("waifu-animation tests passed");

function assertFiniteEvaluation(evaluation: ReturnType<AnimationRuntime["evaluate"]>): void {
  for (const transform of evaluation.localPose) {
    assert.ok(transform.translation.every(Number.isFinite));
    assert.ok(transform.rotation.every(Number.isFinite));
    assert.ok(transform.scale.every(Number.isFinite));
  }
  for (const matrix of evaluation.modelPose) {
    assert.ok(Array.from(matrix).every(Number.isFinite));
  }
}

function makeRuntimeClipDiagnosticStub(options: {
  id: string;
  label: string;
  lane: "base" | "overlay" | "debug";
  weight: number;
  targetWeight: number;
  time: number;
  duration: number;
  scheduled: boolean;
  running: boolean;
  instance?: number;
  states?: string[];
  emotions?: string[];
  gestures?: string[];
  source?: Record<string, unknown>;
  action?: ReturnType<typeof makeRuntimeActionStub>;
}) {
  const action =
    options.action ??
    ({
      time: options.time,
      getEffectiveWeight: () => options.weight,
      isRunning: () => options.running,
      isScheduled: () => options.scheduled
    } as const);
  return {
    id: options.id,
    label: options.label,
    url: `/${options.id}.waifuanim.bin`,
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    sourceId: options.id,
    instance: options.instance ?? 0,
    action,
    duration: options.duration,
    targetWeight: options.targetWeight,
    lastTriggeredAt: 0,
    lane: options.lane,
    ...(options.states ? { states: options.states } : {}),
    ...(options.emotions ? { emotions: options.emotions } : {}),
    ...(options.gestures ? { gestures: options.gestures } : {}),
    ...(options.source ? { source: options.source } : {})
  } as const;
}

function makeRuntimeActionStub(initialWeight: number) {
  return {
    time: 0,
    enabled: false,
    paused: true,
    effectiveWeight: initialWeight,
    effectiveTimeScale: 0,
    resetCount: 0,
    playCount: 0,
    stopFadingCount: 0,
    stopWarpingCount: 0,
    reset() {
      this.resetCount += 1;
      this.time = 0;
      return this;
    },
    play() {
      this.playCount += 1;
      return this;
    },
    stopFading() {
      this.stopFadingCount += 1;
      return this;
    },
    stopWarping() {
      this.stopWarpingCount += 1;
      return this;
    },
    setEffectiveTimeScale(value: number) {
      this.effectiveTimeScale = value;
      return this;
    },
    setEffectiveWeight(value: number) {
      this.effectiveWeight = value;
      return this;
    },
    getEffectiveWeight() {
      return this.effectiveWeight;
    },
    isRunning() {
      return false;
    },
    isScheduled() {
      return false;
    }
  };
}
