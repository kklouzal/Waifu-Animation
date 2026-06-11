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
  clearThreeFootPlantOffsets,
  blendPoses,
  clamp01,
  createJointMask,
  DEFAULT_BLEND_THRESHOLD,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  decodeAnimationBinary,
  encodeAnimationBinary,
  createSkeleton,
  distributeLookAt,
  filterTracksByNamePolicy,
  inspectAnimationAsset,
  inspectClipAsset,
  localToModelPose,
  poseRotationMetric,
  rotateVec3ByQuat,
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

console.log("waifu-animation tests passed");
