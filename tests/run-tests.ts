import assert from "node:assert/strict";
import { AnimationMixer, Object3D } from "three";
import {
  AnimationRuntime,
  type AnimationClip,
  BlinkScheduler,
  FacialExpressionMixer,
  PresencePlanner,
  VisemeMixer,
  blendPoses,
  clamp01,
  createJointMask,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  createSkeleton,
  distributeLookAt,
  filterTracksByNamePolicy,
  inspectClipAsset,
  localToModelPose,
  poseRotationMetric,
  retargetQuaternionSample,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  solveTwoBoneIk,
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
      times: [0, 0.5, 1],
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0.15, 0, 0, 0.9887, 0, 0, 0, 1])
    }
  ]
};

assert.equal(clamp01(2), 1);
assert.equal(validateAnimationInputs(skeleton, nodClip).accepted, true);
assert.equal(inspectClipAsset({ id: "nod", label: "Nod", url: "/nod.json", format: "waifu-animation-json" }, nodClip).accepted, true);

const rootMotionRotationOnlyClip: AnimationClip = {
  ...nodClip,
  id: "root-motion-walk"
};
assert.equal(
  inspectClipAsset({ id: "root-motion-walk", label: "Root Motion Walk", url: "/root-motion-walk.json", format: "waifu-animation-json" }, rootMotionRotationOnlyClip)
    .accepted,
  false
);
assert.equal(
  inspectClipAsset(
    {
      id: "root-motion-walk",
      label: "Root Motion Walk",
      url: "/root-motion-walk.json",
      format: "waifu-animation-json",
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    rootMotionRotationOnlyClip
  ).accepted,
  true
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

const retargeted = retargetQuaternionSample([0, 0, 0, 1], [0, 0, 0, 1], [0, 0.2, 0, 0.98]);
assert.ok(Math.abs(Math.hypot(...retargeted) - 1) < 1e-5);

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
  { id: "nod", label: "Nod", url: "/nod.json", format: "waifu-animation-json", loop: true },
  mixer,
  threeClip
);
assert.equal(runtimeClips.length, 2);
assert.equal(runtimeClips[0]!.lane, "base");
assert.equal(runtimeClips[1]!.instance, 1);

console.log("waifu-animation tests passed");
