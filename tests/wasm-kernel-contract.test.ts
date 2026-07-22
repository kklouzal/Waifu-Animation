import {
  AnimationSamplingContext,
  applyAimIkChainToPose,
  applyAimIkModelCorrection,
  applyTwoBoneIkLocalCorrections,
  assert,
  blendPoses,
  clonePose,
  createRestPose,
  localToModelPose,
  normalizePose,
  sampleClipToPose,
  sampleClipToPoseWithContext,
  skinVertices,
  solveAimIk,
  solveFootPlant,
  solveTwoBoneIkModel
} from "./test-api.js";
import { assertMat4NearlyEqual, quaternionNearlyEqual, vectorNearlyEqual } from "./test-helpers.js";
import { createSkinningJobForModelPose, createWasmKernelSyntheticFixture } from "./wasm-kernel-fixtures.js";

export function runWasmKernelContractTests(): void {
  const fixture = createWasmKernelSyntheticFixture({ jointCount: 8, keyCount: 4, vertexCount: 16, phase: 0.125 });
  const restPose = createRestPose(fixture.skeleton);

  const directSample = sampleClipToPose(fixture.skeleton, fixture.clip, 0.437, { restPose });
  const contextSample = sampleClipToPoseWithContext(
    fixture.skeleton,
    fixture.clip,
    0.437,
    new AnimationSamplingContext(fixture.clip.tracks.length),
    { restPose }
  );
  assertPoseNearlyEqual(contextSample, directSample, 1e-6, "context clip sampling should define WASM parity");

  const blended = blendPoses(
    fixture.skeleton,
    [
      { pose: directSample, weight: 0.7 },
      {
        pose: sampleClipToPose(fixture.skeleton, fixture.overlayClip, 0.437, { restPose }),
        weight: 0.3,
        mask: fixture.upperBodyMask
      }
    ],
    { threshold: 0.01, fallbackPose: restPose }
  );
  const normalized = normalizePose(blended);
  assertPoseFinite(normalized, "blended pose");

  const modelPose = localToModelPose(fixture.skeleton, normalized);
  assert.equal(modelPose.length, fixture.skeleton.joints.length, "model pose count should match skeleton joints");
  assertMat4NearlyEqual(
    modelPose[0]!,
    localToModelPose(fixture.skeleton, normalized, [])[0]!,
    1e-6,
    "local-to-model output should be deterministic with fresh or caller-owned output arrays"
  );

  const skinningJob = createSkinningJobForModelPose(fixture, modelPose);
  const skinned = skinVertices(skinningJob);
  assert.equal(
    skinned.positions,
    fixture.skinning.outPositions,
    "skinning must support caller-owned position output reuse"
  );
  assert.equal(skinned.normals, fixture.skinning.outNormals, "skinning must support caller-owned normal output reuse");
  assert.equal(
    skinned.tangents,
    fixture.skinning.outTangents,
    "skinning must support caller-owned tangent output reuse"
  );
  assert.ok(
    skinned.issues.every((issue) => !issue.message.includes("produced out-of-range values")),
    "synthetic skinning baseline should not repair finite deterministic outputs"
  );
  assert.ok(Array.from(skinned.positions).every(Number.isFinite), "skinned positions must stay finite");
  assert.ok(Array.from(skinned.normals ?? []).every(Number.isFinite), "skinned normals must stay finite");
  assert.ok(Array.from(skinned.tangents ?? []).every(Number.isFinite), "skinned tangents must stay finite");

  const poisonedSkin = skinVertices({
    vertexCount: 1,
    influences: 2,
    jointMatrices: [new Float32Array(16), modelPose[0]!],
    positions: { data: new Float32Array([Number.NaN, 2, 3]) },
    normals: { data: new Float32Array([Infinity, 0, 0]) },
    jointIndices: new Uint16Array([9999, 1]),
    jointWeights: new Float32Array([Number.NaN])
  });
  assert.ok(
    Array.from(poisonedSkin.positions).every(Number.isFinite) &&
      Array.from(poisonedSkin.normals ?? []).every(Number.isFinite),
    "WASM fallback contract must match TS finite-repair behavior for malformed skinning inputs"
  );

  const twoBone = solveTwoBoneIkModel({
    root: modelPose[fixture.ik.rootJoint]!,
    mid: modelPose[fixture.ik.midJoint]!,
    end: modelPose[fixture.ik.endJoint]!,
    target: [0.05, 1.2, 0.05],
    pole: [0, 0, 1],
    weight: 0.75,
    maxStretch: 1.25
  });
  assertAllFinite(twoBone, "two-bone IK result");
  const ikLocalPose = clonePose(normalized);
  const ikModelPose = localToModelPose(fixture.skeleton, ikLocalPose);
  applyTwoBoneIkLocalCorrections({
    skeleton: fixture.skeleton,
    localPose: ikLocalPose,
    modelPose: ikModelPose,
    rootJoint: fixture.ik.rootJoint,
    midJoint: fixture.ik.midJoint,
    corrections: twoBone
  });
  assertPoseFinite(ikLocalPose, "two-bone corrected pose");

  const aim = solveAimIk({
    joint: modelPose[fixture.ik.aimJoint]!,
    target: [0.2, 1.3, 0.4],
    forward: [0, 1, 0],
    up: [0, 0, 1],
    pole: [0, 0, 1],
    weight: 0.5
  });
  assertAllFinite(aim, "aim IK result");
  const aimLocalPose = clonePose(normalized);
  const aimModelPose = localToModelPose(fixture.skeleton, aimLocalPose);
  applyAimIkModelCorrection({
    skeleton: fixture.skeleton,
    localPose: aimLocalPose,
    modelPose: aimModelPose,
    joint: fixture.ik.aimJoint,
    jointCorrection: aim.jointCorrection
  });
  assertPoseFinite(aimLocalPose, "aim corrected pose");

  const chainPose = clonePose(normalized);
  const chainModel = localToModelPose(fixture.skeleton, chainPose);
  const chain = applyAimIkChainToPose({
    skeleton: fixture.skeleton,
    localPose: chainPose,
    modelPose: chainModel,
    joints: [fixture.ik.aimJoint],
    target: [0.25, 1.35, 0.35],
    forward: [0, 1, 0],
    up: [0, 0, 1],
    weight: 0.4
  });
  assert.equal(chain.corrections.length, 1, "aim-chain fixture should apply exactly one correction");
  assertPoseFinite(chain.localPose, "aim-chain corrected pose");

  const foot = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1.05, 0],
        knee: [0.05, 0.58, 0.03],
        ankle: [0.08, 0.08, 0.02],
        ground: { point: [0.08, 0, 0.02], normal: [0, 1, 0] },
        influence: 0.8
      },
      {
        id: "right",
        hip: [0, 1.04, 0],
        knee: [-0.04, 0.6, 0.01],
        ankle: [-0.08, 0.1, 0.03],
        ground: { point: [-0.08, 0, 0.03], normal: [0, 1, 0] },
        influence: 0.6
      }
    ],
    { footHeight: 0.05, maxAnkleCorrection: 0.3 }
  );
  assertAllFinite(foot, "foot-plant result");
  assert.equal(foot.legs.length, 2, "foot-plant contract fixture should keep both legs in order");
}

function assertPoseNearlyEqual(
  actual: ReturnType<typeof sampleClipToPose>,
  expected: ReturnType<typeof sampleClipToPose>,
  tolerance: number,
  message: string
): void {
  assert.equal(actual.length, expected.length, `${message}: pose length`);
  for (let joint = 0; joint < actual.length; joint += 1) {
    assert.ok(
      vectorNearlyEqual(actual[joint]!.translation, expected[joint]!.translation, tolerance),
      `${message}: joint ${joint} translation`
    );
    assert.ok(
      quaternionNearlyEqual(actual[joint]!.rotation, expected[joint]!.rotation, tolerance),
      `${message}: joint ${joint} rotation`
    );
    assert.ok(
      vectorNearlyEqual(actual[joint]!.scale, expected[joint]!.scale, tolerance),
      `${message}: joint ${joint} scale`
    );
  }
}

function assertPoseFinite(pose: ReturnType<typeof sampleClipToPose>, label: string): void {
  for (let joint = 0; joint < pose.length; joint += 1) {
    assert.ok(pose[joint]!.translation.every(Number.isFinite), `${label}: joint ${joint} translation finite`);
    assert.ok(pose[joint]!.rotation.every(Number.isFinite), `${label}: joint ${joint} rotation finite`);
    assert.ok(pose[joint]!.scale.every(Number.isFinite), `${label}: joint ${joint} scale finite`);
  }
}

function assertAllFinite(value: unknown, path: string): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    Array.from(value as ArrayLike<unknown>).forEach((entry, index) => assertAllFinite(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertAllFinite(entry, `${path}.${key}`);
  }
}
