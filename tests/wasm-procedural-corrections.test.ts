import assert from "node:assert/strict";

import {
  WA_KERNEL_FEATURE_RETAINED_PROCEDURAL_CORRECTIONS,
  WaKernelStatus,
  applyAimIkModelCorrection,
  applyTwoBoneIkLocalCorrections,
  clonePose,
  copyModelPoseViewToMat4Array,
  createRestPose,
  createSkeleton,
  localToModelPose,
  solveAimIk,
  solveTwoBoneIkModel,
  type WaifuAnimationWasmKernel,
  type WasmProceduralCorrection
} from "../src/index.js";
import { quaternionNearlyEqual } from "./test-helpers.js";

export function runWasmProceduralCorrectionTests(kernel: WaifuAnimationWasmKernel): void {
  assert.ok(
    kernel.featureFlags & WA_KERNEL_FEATURE_RETAINED_PROCEDURAL_CORRECTIONS,
    "ABI v1.4 procedural feature should be advertised"
  );
  const skeleton = createSkeleton([
    { name: "root", rest: { translation: [1, 2, -1], rotation: [0, 0.130526, 0, 0.991445], scale: [1.25, 0.8, 1.1] } },
    { name: "hip", parentIndex: 0, rest: { translation: [0, 0.2, 0] } },
    { name: "knee", parentIndex: 1, rest: { translation: [0, -0.9, 0.15] } },
    { name: "ankle", parentIndex: 2, rest: { translation: [0, -0.85, -0.12] } },
    { name: "aim", parentIndex: 0, rest: { translation: [0, 0.8, 0] } },
    { name: "leaf", parentIndex: 4, rest: { translation: [0.4, 0, 0] } }
  ]);
  const cases: readonly WasmProceduralCorrection[][] = [
    [
      {
        kind: "two-bone",
        rootJoint: 1,
        midJoint: 2,
        endJoint: 3,
        target: [1.15, 0.3, -0.55],
        pole: [0, 0, 1],
        soften: 0.8,
        maxStretch: 0.9
      }
    ],
    [
      {
        kind: "two-bone",
        rootJoint: 1,
        midJoint: 2,
        endJoint: 3,
        target: [4, -1, 0],
        pole: [0, 0, 1],
        twistAngle: 0.2,
        weight: 0.4
      }
    ],
    [
      {
        kind: "aim",
        joint: 4,
        target: [2, 3.2, 0.7],
        forward: [1, 0, 0],
        up: [0, 1, 0],
        pole: [0, 1, 0],
        twistAngle: -0.15,
        weight: 0.65
      }
    ],
    [
      { kind: "aim", joint: 4, target: [2, 2.7, -0.2], weight: 0.35 },
      { kind: "aim", joint: 5, target: [2, 2.7, -0.2], weight: 0.75 }
    ],
    [
      {
        kind: "foot",
        hipJoint: 1,
        kneeJoint: 2,
        ankleJoint: 3,
        targetAnkle: [1.05, 0.25, -0.7],
        pole: [0, 0, 1],
        influence: 0.7,
        maxStretch: 0.95,
        orientationTarget: [1.05, 1.25, -0.7],
        orientationWeight: 0.5
      }
    ]
  ];

  for (const [caseIndex, corrections] of cases.entries()) {
    const arena = kernel.createPoseArenaContext(skeleton, { poseCapacity: 2 });
    const retained = kernel.createProceduralCorrectionContext(arena, { capacity: 8 });
    const pose = createRestPose(skeleton);
    arena.writePose(1, pose);
    assert.equal(arena.localToModel(1), WaKernelStatus.Ok);
    const expected = applyReference(skeleton, pose, corrections);
    const beforeBytes = kernel.memory.buffer.byteLength;
    const first = retained.run(1, corrections);
    assert.equal(first.kind, "wasm-scalar", `case ${caseIndex}: retained correction status`);
    const actual = arena.copyPoseToTransforms(1);
    for (let joint = 0; joint < actual.length; joint += 1) {
      assert.ok(
        quaternionNearlyEqual(actual[joint]!.rotation, expected[joint]!.rotation, 2e-3),
        `case ${caseIndex}: joint ${joint}`
      );
    }
    for (let repeat = 0; repeat < 10; repeat += 1) {
      arena.writePose(1, pose);
      arena.localToModel(1);
      assert.equal(retained.run(1, corrections).kind, "wasm-scalar");
    }
    assert.equal(kernel.memory.buffer.byteLength, beforeBytes, `case ${caseIndex}: no steady growth`);
    assert.equal(retained.invokeRawForTests({ count: 1, capacityBytes: 1 }), WaKernelStatus.Capacity);
    arena.destroy();
  }

  const fallbackArena = kernel.createPoseArenaContext(skeleton);
  const fallbackContext = kernel.createProceduralCorrectionContext(fallbackArena, { capacity: 1 });
  fallbackArena.writePose(1, createRestPose(skeleton));
  fallbackArena.localToModel(1);
  kernel.forceDisableForTests("procedural-fallback-test");
  const fallback = fallbackContext.run(1, cases[0]!);
  assert.equal(fallback.kind, "typescript", "disabled kernel should apply scalar fallback");
  kernel.clearForcedDisableForTests();
  fallbackArena.destroy();

  const independentA = kernel.createPoseArenaContext(skeleton);
  const independentB = kernel.createPoseArenaContext(skeleton);
  const contextA = kernel.createProceduralCorrectionContext(independentA, { capacity: 1 });
  const contextB = kernel.createProceduralCorrectionContext(independentB, { capacity: 1 });
  independentA.writePose(1, createRestPose(skeleton));
  independentA.localToModel(1);
  independentB.writePose(1, createRestPose(skeleton));
  independentB.localToModel(1);
  assert.equal(contextA.run(1, cases[0]!).kind, "wasm-scalar");
  assert.notDeepEqual(
    Array.from(independentA.poseView(1)),
    Array.from(independentB.poseView(1)),
    "avatars remain independent"
  );
  assert.equal(contextB.invokeRawForTests({ count: 2 }), WaKernelStatus.Capacity);
  independentA.destroy();
  independentB.destroy();
}

function applyReference(
  skeleton: ReturnType<typeof createSkeleton>,
  source: ReturnType<typeof createRestPose>,
  corrections: readonly WasmProceduralCorrection[]
): ReturnType<typeof createRestPose> {
  const localPose = clonePose(source);
  const modelPose = localToModelPose(skeleton, localPose);
  for (const correction of corrections) {
    if (correction.kind === "aim") {
      const solved = solveAimIk({
        joint: modelPose[correction.joint]!,
        target: [...correction.target],
        forward: [...(correction.forward ?? [1, 0, 0])],
        up: [...(correction.up ?? [0, 1, 0])],
        pole: [...(correction.pole ?? [0, 1, 0])],
        ...(correction.twistAngle === undefined ? {} : { twistAngle: correction.twistAngle }),
        ...(correction.weight === undefined ? {} : { weight: correction.weight })
      });
      applyAimIkModelCorrection({
        skeleton,
        localPose,
        modelPose,
        joint: correction.joint,
        jointCorrection: solved.jointCorrection
      });
      continue;
    }
    const rootJoint = correction.kind === "two-bone" ? correction.rootJoint : correction.hipJoint;
    const midJoint = correction.kind === "two-bone" ? correction.midJoint : correction.kneeJoint;
    const endJoint = correction.kind === "two-bone" ? correction.endJoint : correction.ankleJoint;
    const solved = solveTwoBoneIkModel({
      root: modelPose[rootJoint]!,
      mid: modelPose[midJoint]!,
      end: modelPose[endJoint]!,
      target: [...(correction.kind === "two-bone" ? correction.target : correction.targetAnkle)],
      ...(correction.pole ? { pole: [...correction.pole] } : {}),
      ...(correction.maxStretch === undefined ? {} : { maxStretch: correction.maxStretch }),
      ...((correction.kind === "two-bone" ? correction.weight : correction.influence) === undefined
        ? {}
        : { weight: correction.kind === "two-bone" ? correction.weight : correction.influence })
    });
    applyTwoBoneIkLocalCorrections({ skeleton, localPose, modelPose, rootJoint, midJoint, corrections: solved });
    if (correction.kind === "foot" && correction.orientationTarget) {
      const aim = solveAimIk({
        joint: modelPose[endJoint]!,
        target: [...correction.orientationTarget],
        forward: [...(correction.ankleUp ?? [0, 1, 0])],
        up: [...(correction.footForward ?? [0, 0, 1])],
        pole: [...(correction.footForward ?? [0, 0, 1])],
        weight: correction.orientationWeight ?? correction.influence ?? 1
      });
      applyAimIkModelCorrection({
        skeleton,
        localPose,
        modelPose,
        joint: endJoint,
        jointCorrection: aim.jointCorrection
      });
    }
  }
  void copyModelPoseViewToMat4Array;
  return localPose;
}
