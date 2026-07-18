import {
  Object3D,
  Vector3,
  applyAimIkChainToPose,
  applyAimIkChildToParentChainToPose,
  applyAimIkModelCorrection,
  applyThreeFootPlantResult,
  applyFootPlantStabilizedInfluence,
  applyTwoBoneIkLocalCorrections,
  assert,
  clearThreeFootPlantOffsets,
  clonePose,
  composeMat4,
  createFootPlantStabilizerObservations,
  createHumanoidLookAtAimChain,
  createSkeleton,
  dotVec3,
  localToModelPose,
  modelCorrectionToLocalPostCorrection,
  multiplyQuat,
  normalizeVec3,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  solveAimIk,
  solveFootPlant,
  solveOzzFootIk,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  solveTwoBoneIkModel,
  updateFootPlantStabilizer,
  updateLocalToModelPoseRange
} from "./test-api.js";
import { distance3, matrixDirection, modelPosition, quaternionNearlyEqual, vectorNearlyEqual } from "./test-helpers.js";

export function runIkFootPlantTests(): void {
  const aim = solveAimIk({
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.equal(aim.reached, true);
  assert.ok(aim.alignmentError < 1e-5, "aim IK should align the offsetted forward axis to the target");
  assert.ok(
    Math.hypot(aim.correctedForward[0], aim.correctedForward[1] - 1, aim.correctedForward[2]) < 1e-5,
    "aim IK should rotate the model forward axis toward the target"
  );
  assert.ok(
    Math.hypot(aim.correctedUp[0], aim.correctedUp[1], aim.correctedUp[2] - 1) < 1e-5,
    "aim IK should keep model up aligned to the projected pole"
  );
  assert.ok(Math.abs(Math.hypot(...aim.jointCorrection) - 1) < 1e-5);

  const partialAim = solveAimIk({
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1],
    weight: 0.5
  });
  assert.ok(
    partialAim.alignmentError > 0.01 && partialAim.alignmentError < Math.PI / 2,
    "partial aim IK weight should leave a deterministic residual angle"
  );
  assert.ok(
    dotVec3(partialAim.correctedForward, [0, 1, 0]) > 0.25,
    "partial aim IK should still rotate toward the target"
  );

  const rotatedJointAim = solveAimIk({
    jointRotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2),
    target: [0, 2, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  assert.ok(
    rotatedJointAim.alignmentError < 1e-5,
    "aim IK should accept joint rotation as the model-space orientation input"
  );
  assert.ok(
    Math.hypot(...rotatedJointAim.jointCorrection.slice(0, 3)) < 1e-5,
    "already aligned rotated joints should produce an identity correction"
  );
  assert.ok(
    vectorNearlyEqual(rotatedJointAim.correctedForward, [0, 1, 0], 1e-5),
    "aim IK correctedForward should be reported in model space"
  );

  const rotatedJointCorrection = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const rotatedJointNeedsCorrectionAim = solveAimIk({
    jointRotation: rotatedJointCorrection,
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  const rotatedCorrectedModelRotation = multiplyQuat(
    rotatedJointNeedsCorrectionAim.jointCorrection,
    rotatedJointCorrection
  );
  const rotatedCorrectedForward = normalizeVec3(rotateVec3ByQuat(rotatedCorrectedModelRotation, [1, 0, 0]), [1, 0, 0]);
  const rotatedCorrectedUp = normalizeVec3(rotateVec3ByQuat(rotatedCorrectedModelRotation, [0, 1, 0]), [0, 1, 0]);
  assert.ok(
    rotatedJointNeedsCorrectionAim.alignmentError < 1e-5,
    "rotated aim IK should align the model-space correction to the target"
  );
  assert.ok(
    vectorNearlyEqual(rotatedCorrectedForward, [0, 1, 0], 1e-5),
    "aim IK jointCorrection should pre-multiply the model joint rotation"
  );
  assert.ok(
    vectorNearlyEqual(rotatedJointNeedsCorrectionAim.correctedForward, rotatedCorrectedForward, 1e-5),
    "correctedForward should match the documented model-space application order"
  );
  assert.ok(
    vectorNearlyEqual(rotatedJointNeedsCorrectionAim.correctedUp, rotatedCorrectedUp, 1e-5),
    "correctedUp should match the documented model-space application order"
  );
  assert.ok(
    vectorNearlyEqual(rotatedJointNeedsCorrectionAim.targetDirection, [0, 1, 0], 1e-5),
    "targetDirection should be reported in model space"
  );

  const matrixJointAim = solveAimIk({
    joint: composeMat4({ translation: [0, 0, 0], rotation: rotatedJointCorrection, scale: [1, 1, 1] }),
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  const matrixCorrectedModelRotation = multiplyQuat(matrixJointAim.jointCorrection, rotatedJointCorrection);
  const matrixCorrectedForward = normalizeVec3(rotateVec3ByQuat(matrixCorrectedModelRotation, [1, 0, 0]), [1, 0, 0]);
  assert.ok(matrixJointAim.alignmentError < 1e-5, "aim IK should derive model correction space from a joint matrix");
  assert.ok(
    vectorNearlyEqual(matrixCorrectedForward, [0, 1, 0], 1e-5),
    "matrix aim IK correction should pre-multiply the model joint rotation"
  );

  const directionAim = solveAimIk({
    targetDirection: [0, 0, 1],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  assert.ok(
    directionAim.alignmentError < 1e-5,
    "aim IK should accept a model-space target direction without a target point"
  );
  assert.ok(
    Math.hypot(
      directionAim.correctedForward[0],
      directionAim.correctedForward[1],
      directionAim.correctedForward[2] - 1
    ) < 1e-5
  );

  const poleOnlyAim = solveAimIk({
    target: [2, 0, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.ok(poleOnlyAim.alignmentError < 1e-5);
  assert.ok(
    Math.hypot(poleOnlyAim.correctedForward[0] - 1, poleOnlyAim.correctedForward[1], poleOnlyAim.correctedForward[2]) <
      1e-5,
    "aim IK pole correction must not disturb an already aligned forward axis"
  );
  assert.ok(Math.hypot(poleOnlyAim.correctedUp[0], poleOnlyAim.correctedUp[1], poleOnlyAim.correctedUp[2] - 1) < 1e-5);

  const opposedAim = solveAimIk({ target: [-1, 0, 0], forward: [1, 0, 0], up: [0, 1, 0], pole: [0, 1, 0] });
  assert.equal(opposedAim.reached, true);
  assert.ok(
    opposedAim.jointCorrection.every(Number.isFinite),
    "opposed aim targets should produce a finite 180-degree correction"
  );
  assert.ok(
    Math.hypot(opposedAim.correctedForward[0] + 1, opposedAim.correctedForward[1], opposedAim.correctedForward[2]) <
      1e-5
  );

  const offsetUnreachableAim = solveAimIk({
    target: [1, 0, 0],
    forward: [1, 0, 0],
    offset: [0, 2, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.equal(
    offsetUnreachableAim.reached,
    false,
    "aim IK should report offset targets outside the target sphere as unreachable"
  );
  assert.deepEqual(offsetUnreachableAim.jointCorrection, [0, 0, 0, 1]);

  const finiteAim = solveAimIk({
    jointPosition: [Number.NaN, 0, 0],
    jointRotation: [Number.NaN, 0, 0, 1],
    target: [Number.NaN, 0, 0],
    forward: [Number.NaN, 0, 0],
    up: [0, Number.NaN, 0],
    pole: [0, 0, Number.POSITIVE_INFINITY],
    twistAngle: Number.NaN,
    weight: Number.NaN
  });
  assert.ok(finiteAim.jointCorrection.every(Number.isFinite), "aim IK should sanitize non-finite job inputs");
  assert.ok(finiteAim.correctedForward.every(Number.isFinite) && finiteAim.correctedUp.every(Number.isFinite));
  const zeroAxisAim = solveAimIk({ target: [0, 1, 0], forward: [0, 0, 0], up: [0, 0, 0], pole: [0, 0, 0] });
  assert.ok(
    zeroAxisAim.jointCorrection.every(Number.isFinite),
    "aim IK should use stable fallbacks for zero-length axes"
  );
  assert.ok(zeroAxisAim.correctedForward.every(Number.isFinite) && zeroAxisAim.correctedUp.every(Number.isFinite));

  const ik = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0.5, -1.5, 0],
    pole: [0, 0, 1]
  });
  assert.ok(ik.targetReach > 0.9);
  assert.ok(Number.isFinite(ik.joint[0]));
  const finiteIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, 0, 1],
    maxStretch: Number.NaN
  });
  assert.ok(finiteIk.joint.every(Number.isFinite), "IK should keep solved joints finite for non-finite stretch limits");
  const nonFiniteInputIk = solveTwoBoneIk({
    root: [Number.NaN, 0, 0],
    joint: [0, Number.NaN, 0],
    end: [0, -2, Number.POSITIVE_INFINITY],
    target: [0, -1.5, Number.NaN],
    pole: [Number.NaN, Number.NaN, Number.NaN],
    maxStretch: Number.NaN
  });
  assert.ok(
    nonFiniteInputIk.joint.every(Number.isFinite) && nonFiniteInputIk.end.every(Number.isFinite),
    "IK should repair non-finite chain and target inputs"
  );
  assert.ok(
    Number.isFinite(nonFiniteInputIk.solvedReach),
    "IK reach reporting should stay finite for repaired non-finite inputs"
  );
  const minimumReachIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -1.5, 0],
    target: [0, -0.5, 0],
    pole: [0, 0, 1],
    maxStretch: 1
  });
  assert.equal(minimumReachIk.clamped, false, "exact minimum-reach targets should not be treated as clamped");
  assert.ok(minimumReachIk.solvedReach <= 1.000001, "minimum-reach solves must not report more than full target reach");
  assert.ok(
    Math.hypot(minimumReachIk.end[0], minimumReachIk.end[1] + 0.5, minimumReachIk.end[2]) < 1e-6,
    "minimum-reach solves should keep the endpoint on the target"
  );
  const diagonalIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [1, -1, 0],
    pole: [0, 0, 1],
    soften: 0
  });
  assert.ok(
    Math.abs(Math.hypot(...diagonalIk.joint) - 1) < 1e-5,
    "IK projection should keep the solved joint on the upper-bone sphere for diagonal targets"
  );

  const fullReachIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -2, 0],
    pole: [0, 0, 1]
  });
  assert.equal(
    fullReachIk.clamped,
    false,
    "default IK softening must not report a physical reach clamp at full extension"
  );
  assert.ok(
    Math.abs(fullReachIk.targetReach - 1) < 1e-5,
    "physically reachable targets should report full target reach"
  );
  assert.ok(
    fullReachIk.solvedReach < 1,
    "default IK softening may still keep the solved endpoint short of full extension"
  );
  assert.equal(fullReachIk.stretchLimited, true);
  const unsoftenedFullReachIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -2, 0],
    pole: [0, 0, 1],
    soften: 1
  });
  assert.ok(
    Math.abs(unsoftenedFullReachIk.solvedReach - 1) < 1e-5,
    "soften=1 should leave a reachable full-extension target unshortened"
  );

  const stretchLimitedIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, 0, 1],
    maxStretch: 0.5
  });
  assert.equal(
    stretchLimitedIk.clamped,
    false,
    "explicit stretch limits should not be mislabeled as physical reach clamps"
  );
  assert.equal(stretchLimitedIk.stretchLimited, true);
  assert.ok(stretchLimitedIk.solvedReach < 0.7, "explicit stretch limit should still shorten the solved endpoint");
  assert.ok(Math.abs(stretchLimitedIk.targetReach - 1) < 1e-5);

  const ikCorrections = solveTwoBoneIkCorrections({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0.5, -1.5, 0],
    pole: [0, 0, 1]
  });
  const correctedUpper = rotateVec3ByQuat(ikCorrections.rootCorrection, [0, -1, 0]);
  assert.ok(
    Math.hypot(
      correctedUpper[0] - ikCorrections.correctedUpperDirection[0],
      correctedUpper[1] - ikCorrections.correctedUpperDirection[1],
      correctedUpper[2] - ikCorrections.correctedUpperDirection[2]
    ) < 1e-5
  );
  assert.ok(Math.abs(Math.hypot(...ikCorrections.rootCorrection) - 1) < 1e-5);
  assert.ok(Math.abs(Math.hypot(...ikCorrections.jointCorrection) - 1) < 1e-5);

  const nonOrthogonalPoleIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, -1, 1]
  });
  assert.ok(
    Math.abs(Math.hypot(...nonOrthogonalPoleIk.joint) - 1) < 1e-5,
    "IK bend pole must not change the upper bone length"
  );
  const twistedPoleIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, 0, 1],
    twistAngle: Math.PI / 2,
    soften: 1
  });
  assert.ok(
    Math.abs(Math.abs(twistedPoleIk.joint[0]) - Math.hypot(twistedPoleIk.joint[0], twistedPoleIk.joint[2])) < 1e-5,
    "two-bone IK twist should rotate the bend plane around the target axis"
  );
  const weightedIkCorrections = solveTwoBoneIkCorrections({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0.5, -1.5, 0],
    pole: [0, 0, 1],
    weight: 0.5,
    midAxis: [0, 0, 1]
  });
  assert.ok(Math.abs(Math.hypot(...weightedIkCorrections.rootCorrection) - 1) < 1e-5);
  assert.ok(
    Math.hypot(weightedIkCorrections.end[0], weightedIkCorrections.end[1] + 2, weightedIkCorrections.end[2]) <
      Math.hypot(ikCorrections.end[0], ikCorrections.end[1] + 2, ikCorrections.end[2]),
    "two-bone IK weight should blend the solved endpoint back toward the input pose"
  );

  const ikApplicationSkeleton = createSkeleton([
    { name: "world", rest: { translation: [0.25, 0.1, -0.2], rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 5) } },
    { name: "hip", parentName: "world", rest: { rotation: quatFromAxisAngle([1, 0, 0], 0.2) } },
    {
      name: "knee",
      parentName: "hip",
      rest: { translation: [0, -1, 0], rotation: quatFromAxisAngle([0, 1, 0], -0.15) }
    },
    { name: "ankle", parentName: "knee", rest: { translation: [0, -1, 0] } },
    { name: "toe", parentName: "ankle", rest: { translation: [0, -0.25, 0] } }
  ]);
  const ikApplicationPose = clonePose(ikApplicationSkeleton.restPose);
  const ikApplicationModels = localToModelPose(ikApplicationSkeleton, ikApplicationPose);
  const initialAnklePosition = modelPosition(ikApplicationModels[3]!);
  const ikApplicationTarget: [number, number, number] = [
    initialAnklePosition[0] + 0.24,
    initialAnklePosition[1] + 0.18,
    initialAnklePosition[2] + 0.16
  ];
  const matrixIk = solveTwoBoneIkModel({
    root: ikApplicationModels[1]!,
    mid: ikApplicationModels[2]!,
    end: ikApplicationModels[3]!,
    target: ikApplicationTarget,
    pole: [0, 0, 1],
    midAxis: [0, 0, 1],
    soften: 1
  });
  assert.ok(matrixIk.reached, "matrix two-bone IK should report reachable targets with full weight");
  assert.ok(Math.abs(Math.hypot(...matrixIk.rootLocalCorrection) - 1) < 1e-5);
  assert.ok(Math.abs(Math.hypot(...matrixIk.midLocalCorrection) - 1) < 1e-5);
  assert.ok(
    quaternionNearlyEqual(
      modelCorrectionToLocalPostCorrection(ikApplicationModels[1]!, matrixIk.rootModelCorrection),
      matrixIk.rootLocalCorrection,
      1e-5
    ),
    "matrix IK should expose the root correction in local post-multiply space"
  );

  const appliedIkPose = clonePose(ikApplicationPose);
  const appliedIkModels = localToModelPose(ikApplicationSkeleton, appliedIkPose);
  applyTwoBoneIkLocalCorrections({
    skeleton: ikApplicationSkeleton,
    localPose: appliedIkPose,
    modelPose: appliedIkModels,
    rootJoint: 1,
    midJoint: 2,
    corrections: matrixIk
  });
  assert.ok(
    vectorNearlyEqual(modelPosition(appliedIkModels[3]!), matrixIk.end, 1e-4),
    "local two-bone corrections should place the ankle at the solved model-space endpoint"
  );

  const wrongIkPose = clonePose(ikApplicationPose);
  wrongIkPose[1] = {
    ...wrongIkPose[1]!,
    rotation: multiplyQuat(wrongIkPose[1]!.rotation, matrixIk.rootModelCorrection)
  };
  wrongIkPose[2] = {
    ...wrongIkPose[2]!,
    rotation: multiplyQuat(wrongIkPose[2]!.rotation, matrixIk.midModelCorrection)
  };
  const wrongIkModels = localToModelPose(ikApplicationSkeleton, wrongIkPose);
  assert.ok(
    distance3(modelPosition(wrongIkModels[3]!), matrixIk.end) > 0.01,
    "model-space two-bone corrections must not be applied directly as local post-multiply corrections under a rotated parent"
  );

  const partialIkPose = clonePose(ikApplicationPose);
  const partialIkModels = localToModelPose(ikApplicationSkeleton, partialIkPose);
  applyTwoBoneIkLocalCorrections({
    skeleton: ikApplicationSkeleton,
    localPose: partialIkPose,
    modelPose: partialIkModels,
    rootJoint: 1,
    midJoint: 2,
    corrections: matrixIk,
    updateTo: 3
  });
  const staleToePosition = modelPosition(partialIkModels[4]!);
  const fullyUpdatedIkModels = localToModelPose(ikApplicationSkeleton, partialIkPose);
  assert.ok(
    vectorNearlyEqual(modelPosition(partialIkModels[3]!), modelPosition(fullyUpdatedIkModels[3]!), 1e-5),
    "range update should include the requested end joint"
  );
  assert.ok(
    distance3(staleToePosition, modelPosition(fullyUpdatedIkModels[4]!)) > 1e-4,
    "range-limited updates should leave later descendants untouched"
  );
  updateLocalToModelPoseRange(ikApplicationSkeleton, partialIkPose, partialIkModels, { from: 3, fromExcluded: true });
  assert.ok(
    vectorNearlyEqual(modelPosition(partialIkModels[4]!), modelPosition(fullyUpdatedIkModels[4]!), 1e-5),
    "fromExcluded range update should refresh descendants from an existing model matrix"
  );

  const aimApplicationSkeleton = createSkeleton([
    { name: "root", rest: { translation: [0.4, -0.2, 0.1], rotation: quatFromAxisAngle([0, 0, 1], -Math.PI / 6) } },
    {
      name: "neck",
      parentName: "root",
      rest: { translation: [0, 1, 0], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4) }
    },
    {
      name: "head",
      parentName: "neck",
      rest: { translation: [0.25, 0, 0], rotation: quatFromAxisAngle([1, 0, 0], -0.2) }
    }
  ]);
  const aimApplicationPose = clonePose(aimApplicationSkeleton.restPose);
  const aimApplicationModels = localToModelPose(aimApplicationSkeleton, aimApplicationPose);
  const headTarget: [number, number, number] = [0.2, 1.8, 1.1];
  const headModelBeforeAim = aimApplicationModels[2]!;
  const headAim = solveAimIk({
    joint: headModelBeforeAim,
    target: headTarget,
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  const expectedHeadAimLocalCorrection = modelCorrectionToLocalPostCorrection(
    headModelBeforeAim,
    headAim.jointCorrection
  );
  const appliedHeadAim = applyAimIkModelCorrection({
    skeleton: aimApplicationSkeleton,
    localPose: aimApplicationPose,
    modelPose: aimApplicationModels,
    joint: 2,
    jointCorrection: headAim.jointCorrection
  });
  assert.ok(
    quaternionNearlyEqual(appliedHeadAim.localCorrection, expectedHeadAimLocalCorrection, 1e-5),
    "aim application should report the local post-multiply correction that was applied"
  );
  const appliedHeadPosition = modelPosition(aimApplicationModels[2]!);
  const appliedHeadTargetDirection = normalizeVec3([
    headTarget[0] - appliedHeadPosition[0],
    headTarget[1] - appliedHeadPosition[1],
    headTarget[2] - appliedHeadPosition[2]
  ]);
  assert.ok(
    dotVec3(matrixDirection(aimApplicationModels[2]!, [1, 0, 0]), appliedHeadTargetDirection) > 0.999,
    "aim application should preserve solveAimIk model-space semantics when writing back to local pose"
  );

  const aimChainPose = clonePose(aimApplicationSkeleton.restPose);
  const aimChainModels = localToModelPose(aimApplicationSkeleton, aimChainPose);
  const aimChain = applyAimIkChainToPose({
    skeleton: aimApplicationSkeleton,
    localPose: aimChainPose,
    modelPose: aimChainModels,
    joints: [
      { joint: 1, weight: 0.35 },
      { joint: 2, weight: 1 }
    ],
    target: headTarget,
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  const aimChainHeadPosition = modelPosition(aimChainModels[2]!);
  const aimChainTargetDirection = normalizeVec3([
    headTarget[0] - aimChainHeadPosition[0],
    headTarget[1] - aimChainHeadPosition[1],
    headTarget[2] - aimChainHeadPosition[2]
  ]);
  assert.equal(aimChain.corrections.length, 2);
  assert.ok(
    aimChain.corrections.every((correction) => correction.localCorrection.every(Number.isFinite)),
    "aim chain corrections should stay finite"
  );
  assert.ok(
    dotVec3(matrixDirection(aimChainModels[2]!, [1, 0, 0]), aimChainTargetDirection) > 0.999,
    "aim chain helper should solve and apply corrections in deterministic model/local spaces"
  );

  const humanoidLookAtSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips" },
    { name: "spine", parentName: "hips", humanoid: "spine" },
    { name: "neck", parentName: "spine", humanoid: "neck" },
    { name: "head", parentName: "neck", humanoid: "head" }
  ]);
  const humanoidLookAtChain = createHumanoidLookAtAimChain(humanoidLookAtSkeleton, {
    bones: ["head", "neck", "spine"],
    jointWeight: 0.5,
    guaranteeLast: true
  });
  assert.deepEqual(
    humanoidLookAtChain.map((joint) => joint.joint),
    [3, 2, 1],
    "humanoid look-at policy should choose an available child-to-parent aim chain from skeleton metadata"
  );
  assert.equal(
    humanoidLookAtChain[2]!.weight,
    1,
    "humanoid look-at policy can force the parent-most joint to full weight like the Ozz sample"
  );
  const propagatedAimPose = clonePose(aimApplicationSkeleton.restPose);
  const propagatedAimModels = localToModelPose(aimApplicationSkeleton, propagatedAimPose);
  const propagatedAim = applyAimIkChildToParentChainToPose({
    skeleton: aimApplicationSkeleton,
    localPose: propagatedAimPose,
    modelPose: propagatedAimModels,
    joints: [
      { joint: 2, weight: 0.45, offset: [0.05, 0, 0] },
      { joint: 1, weight: 1 }
    ],
    target: headTarget,
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  const propagatedHeadPosition = modelPosition(propagatedAimModels[2]!);
  const propagatedTargetDirection = normalizeVec3([
    headTarget[0] - propagatedHeadPosition[0],
    headTarget[1] - propagatedHeadPosition[1],
    headTarget[2] - propagatedHeadPosition[2]
  ]);
  assert.equal(propagatedAim.corrections.length, 2);
  assert.equal(
    propagatedAim.updatedFrom,
    1,
    "child-to-parent aim propagation should refresh the parent-most edited joint range once"
  );
  assert.ok(
    propagatedAim.corrections.every((correction) => correction.localCorrection.every(Number.isFinite)),
    "child-to-parent propagated aim corrections should stay finite"
  );
  assert.ok(
    dotVec3(matrixDirection(propagatedAimModels[2]!, [1, 0, 0]), propagatedTargetDirection) > 0.95,
    "child-to-parent aim propagation should keep the child joint directed toward the target"
  );
  const invalidAimChainSkeleton = createSkeleton([
    { name: "root" },
    { name: "spine", parentName: "root" },
    { name: "head", parentName: "spine" },
    { name: "leftArm", parentName: "root" }
  ]);
  const invalidAimChainPose = clonePose(invalidAimChainSkeleton.restPose);
  const invalidAimChainPoseBefore = clonePose(invalidAimChainPose);
  const invalidAimChainModels = localToModelPose(invalidAimChainSkeleton, invalidAimChainPose);
  assert.throws(
    () =>
      applyAimIkChildToParentChainToPose({
        skeleton: invalidAimChainSkeleton,
        localPose: invalidAimChainPose,
        modelPose: invalidAimChainModels,
        joints: [
          { joint: 2, weight: 0.5 },
          { joint: 3, weight: 1 }
        ],
        target: headTarget,
        forward: [1, 0, 0],
        up: [0, 1, 0],
        pole: [0, 1, 0]
      }),
    /must be an ancestor/,
    "child-to-parent aim propagation should reject non-ancestor chains like the Ozz look-at sample"
  );
  assert.deepEqual(
    invalidAimChainPose,
    invalidAimChainPoseBefore,
    "invalid child-to-parent aim chains should be rejected before mutating local pose"
  );

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

  const fullReachFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 0, 0],
        knee: [0, -1, 0],
        ankle: [0, -1.9, 0],
        ground: { point: [0, -2.08, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.5 }
  );
  assert.equal(fullReachFootPlant.legs[0]!.ik?.clamped, false);
  assert.equal(fullReachFootPlant.legs[0]!.ik?.stretchLimited, true);
  assert.ok(
    !fullReachFootPlant.issues.includes("left: ik target reach clamped"),
    "default IK softening must not emit foot-plant reach clamp issues"
  );

  const missingGroundPlant = solveFootPlant([{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.1, 0] }]);
  assert.equal(missingGroundPlant.plantedCount, 0);
  assert.equal(missingGroundPlant.legs[0]!.skippedReason, "missing-ground-contact");

  const clampedFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.4, 0],
        ground: { point: [0, -1, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.1 }
  );
  assert.equal(clampedFootPlant.plantedCount, 1);
  assert.equal(clampedFootPlant.legs[0]!.clamped, true);
  assert.equal(clampedFootPlant.legs[0]!.skippedReason, undefined);
  assert.ok(clampedFootPlant.legs[0]!.correctionDistance <= 0.1001);
  const rejectAnkleCorrectionFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.4, 0],
        ground: { point: [0, -1, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.1, rejectUnreachable: true }
  );
  assert.equal(rejectAnkleCorrectionFootPlant.plantedCount, 0);
  assert.equal(rejectAnkleCorrectionFootPlant.legs[0]!.planted, false);
  assert.equal(rejectAnkleCorrectionFootPlant.legs[0]!.skippedReason, "ankle-correction-unreachable");
  assert.ok(
    rejectAnkleCorrectionFootPlant.issues.includes("left: ankle correction unreachable"),
    "opt-in unreachable rejection should expose over-large ankle corrections as explicit issues"
  );
  const zeroMaxAnkleCorrectionPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.2, 0],
        ground: { point: [0, 0, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0 }
  );
  assert.equal(
    zeroMaxAnkleCorrectionPlant.legs[0]!.clamped,
    true,
    "zero max ankle correction should clamp any non-zero correction"
  );
  assert.equal(
    zeroMaxAnkleCorrectionPlant.legs[0]!.correctionDistance,
    0,
    "zero max ankle correction should leave the ankle target unchanged"
  );
  assert.deepEqual(zeroMaxAnkleCorrectionPlant.pelvisOffset, [0, 0, 0]);
  const moderateSlopeFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0],
        ground: { point: [0, 0, 0], normal: [0.5, Math.sqrt(0.75), 0] }
      },
      {
        id: "right",
        hip: [0.2, 1, 0],
        knee: [0.2, 0.5, 0],
        ankle: [0.2, 0.1, 0],
        ground: { point: [0.2, 0, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0.08, maxGroundSlopeAngle: Math.PI / 4 }
  );
  assert.equal(moderateSlopeFootPlant.plantedCount, 2, "flat and moderate contacts should pass the slope gate");
  assert.equal(moderateSlopeFootPlant.legs[0]!.skippedReason, undefined);
  const steepSlopeFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0],
        ground: { point: [0, 0, 0], normal: [Math.sqrt(0.75), 0.5, 0] }
      }
    ],
    { footHeight: 0.08, maxGroundSlopeAngle: Math.PI / 4 }
  );
  assert.equal(steepSlopeFootPlant.plantedCount, 0);
  assert.equal(steepSlopeFootPlant.legs[0]!.planted, false);
  assert.equal(steepSlopeFootPlant.legs[0]!.skippedReason, "ground-slope-too-steep");
  assert.deepEqual(steepSlopeFootPlant.legs[0]!.targetAnkle, [0, 0.1, 0]);
  assert.deepEqual(steepSlopeFootPlant.legs[0]!.groundPoint, [0, 0, 0]);
  assert.ok(
    steepSlopeFootPlant.legs[0]!.targetAnkle.every(Number.isFinite) &&
      steepSlopeFootPlant.legs[0]!.groundNormal.every(Number.isFinite),
    "slope-rejected foot plant results should stay finite"
  );
  assert.ok(
    steepSlopeFootPlant.issues.includes("left: ground slope too steep"),
    "slope-rejected foot plant results should expose a clear issue"
  );
  let stabilizer = updateFootPlantStabilizer(undefined, [{ id: "left", planted: true }], {
    deltaSeconds: 0.05,
    blendInSeconds: 0.1,
    blendOutSeconds: 0.2,
    contactGraceSeconds: 0.05
  });
  assert.equal(stabilizer.legs[0]!.active, true);
  assert.ok(
    stabilizer.legs[0]!.influence > 0.49 && stabilizer.legs[0]!.influence < 0.51,
    "foot-plant stabilizer should blend contact influence in over time"
  );
  stabilizer = updateFootPlantStabilizer(stabilizer.state, [{ id: "left", planted: true }], {
    deltaSeconds: 0.05,
    blendInSeconds: 0.1,
    blendOutSeconds: 0.2,
    contactGraceSeconds: 0.05
  });
  assert.equal(stabilizer.legs[0]!.influence, 1);
  const graceStabilizer = updateFootPlantStabilizer(
    stabilizer.state,
    [{ id: "left", planted: false, skippedReason: "missing-ground-contact" }],
    { deltaSeconds: 0.025, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.05 }
  );
  assert.equal(graceStabilizer.legs[0]!.active, true);
  assert.equal(
    graceStabilizer.legs[0]!.influence,
    1,
    "one-frame missing contacts inside grace should preserve stabilized influence"
  );
  const gracePlantedLegInput = {
    id: "left",
    hip: [0, 1, 0] as [number, number, number],
    knee: [0, 0.5, 0] as [number, number, number],
    ankle: [0, 0.1, 0] as [number, number, number],
    ground: {
      point: [0, 0, 0] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number]
    }
  };
  const cachedContactPlant = solveFootPlant([gracePlantedLegInput], { footHeight: 0.08 });
  const cachedContactStabilizer = updateFootPlantStabilizer(
    undefined,
    createFootPlantStabilizerObservations(cachedContactPlant),
    { deltaSeconds: 0.1, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.05 }
  );
  const missingContactPlant = solveFootPlant([
    {
      id: "left",
      hip: [0, 1, 0],
      knee: [0, 0.5, 0],
      ankle: [0, 0.1, 0]
    }
  ]);
  const missingContactGrace = updateFootPlantStabilizer(
    cachedContactStabilizer.state,
    createFootPlantStabilizerObservations(missingContactPlant),
    { deltaSeconds: 0.025, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.05 }
  );
  const graceStabilizedInputs = applyFootPlantStabilizedInfluence(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0]
      }
    ],
    missingContactGrace.legs
  );
  const graceSolvedFootPlant = solveFootPlant(graceStabilizedInputs, { footHeight: 0.08 });
  assert.deepEqual(
    graceStabilizedInputs[0]!.ground?.point,
    [0, 0, 0],
    "stabilized missing-contact grace should reuse the last valid ground contact"
  );
  assert.equal(
    graceSolvedFootPlant.plantedCount,
    1,
    "stabilized missing-contact grace should keep the leg solvable for one dropped raycast frame"
  );
  const blendOutStabilizer = updateFootPlantStabilizer(
    graceStabilizer.state,
    [{ id: "left", planted: false, skippedReason: "missing-ground-contact" }],
    { deltaSeconds: 0.1, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.05 }
  );
  assert.ok(
    blendOutStabilizer.legs[0]!.influence > 0.49 && blendOutStabilizer.legs[0]!.influence < 0.51,
    "foot-plant stabilizer should blend out after contact grace expires"
  );
  const blockedStabilizer = updateFootPlantStabilizer(
    stabilizer.state,
    [{ id: "left", planted: false, active: false, skippedReason: "ground-slope-too-steep" }],
    { deltaSeconds: 0.1, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.25 }
  );
  assert.equal(blockedStabilizer.legs[0]!.graceSecondsRemaining, 0);
  assert.equal(blockedStabilizer.legs[0]!.active, false);
  assert.equal(blockedStabilizer.legs[0]!.influence, 0);
  assert.equal(blockedStabilizer.legs[0]!.contactConfidence, 0);
  assert.equal(blockedStabilizer.legs[0]!.groundContact, undefined);
  assert.equal(
    blockedStabilizer.state.legs[0]!.groundContact,
    undefined,
    "blocked contacts should clear cached contacts immediately without missing-contact grace"
  );
  const finiteStabilizer = updateFootPlantStabilizer(
    {
      legs: [
        {
          id: "left",
          influence: Number.POSITIVE_INFINITY,
          contactConfidence: Number.NaN,
          graceSecondsRemaining: Number.NaN,
          planted: true,
          groundContact: {
            point: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
            normal: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
            rayStart: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
          }
        }
      ]
    },
    [
      {
        id: "left",
        planted: true,
        contactConfidence: Number.NaN,
        influence: Number.POSITIVE_INFINITY,
        groundContact: {
          point: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
          normal: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
          rayStart: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
        }
      }
    ],
    {
      deltaSeconds: Number.NaN,
      blendInSeconds: Number.NaN,
      blendOutSeconds: Number.NaN,
      contactGraceSeconds: Number.NaN,
      minInfluence: Number.NaN,
      maxInfluence: Number.POSITIVE_INFINITY
    }
  );
  assert.ok(
    finiteStabilizer.legs.every(
      (leg) =>
        Number.isFinite(leg.influence) &&
        leg.influence >= 0 &&
        leg.influence <= 1 &&
        Number.isFinite(leg.contactConfidence) &&
        Number.isFinite(leg.graceSecondsRemaining)
    ),
    "foot-plant stabilizer should keep non-finite state/options deterministic and clamped"
  );
  assert.ok(
    finiteStabilizer.legs.every(
      (leg) =>
        leg.groundContact !== undefined &&
        leg.groundContact.point.every(Number.isFinite) &&
        (leg.groundContact.normal?.every(Number.isFinite) ?? true) &&
        (leg.groundContact.rayStart?.every(Number.isFinite) ?? true)
    ),
    "foot-plant stabilizer should sanitize cached ground contacts"
  );
  const stabilizedInputs = applyFootPlantStabilizedInfluence(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0],
        ground: { point: [0, 0, 0], normal: [0, 1, 0] }
      }
    ],
    updateFootPlantStabilizer(undefined, createFootPlantStabilizerObservations(steepSlopeFootPlant), {
      deltaSeconds: 0.1,
      blendInSeconds: 0.1,
      blendOutSeconds: 0.1
    }).legs
  );
  const stabilizedFootPlant = solveFootPlant(stabilizedInputs, { footHeight: 0.08 });
  assert.equal(stabilizedInputs[0]!.ground, undefined);
  assert.equal(stabilizedFootPlant.plantedCount, 0, "stabilized inactive influence should feed solveFootPlant safely");
  const nonFiniteSlopeThresholdFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0],
        ground: { point: [0, 0, 0], normal: [1, 0, 0] }
      }
    ],
    { footHeight: 0.08, maxGroundSlopeAngle: Number.NaN }
  );
  assert.equal(
    nonFiniteSlopeThresholdFootPlant.plantedCount,
    1,
    "non-finite slope thresholds should preserve default no-gate foot-plant behavior"
  );
  const rejectMaxStretchFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 0, 0],
        knee: [0, -1, 0],
        ankle: [0, -2, 0],
        ground: { point: [0.8, -1, 0], normal: [0, 1, 0] },
        footHeight: 0,
        maxAnkleCorrection: 3,
        maxStretch: 0.5
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 3, maxPelvisOffset: 0.1, maxStretch: 0.5, rejectUnreachable: true }
  );
  assert.equal(rejectMaxStretchFootPlant.plantedCount, 0);
  assert.equal(rejectMaxStretchFootPlant.legs[0]!.planted, false);
  assert.equal(rejectMaxStretchFootPlant.legs[0]!.skippedReason, "ik-target-unreachable");
  assert.ok(
    rejectMaxStretchFootPlant.issues.includes("left: ik target unreachable"),
    "opt-in unreachable rejection should skip targets that remain beyond configured IK reach"
  );
  assert.deepEqual(
    rejectMaxStretchFootPlant.pelvisOffset,
    [0, 0, 0],
    "IK-rejected contacts should not keep their provisional ankle correction in pelvis lowering"
  );
  const physicallyUnreachableFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 0, 0],
        knee: [0, -1, 0],
        ankle: [0, -2, 0],
        ground: { point: [0, -5, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 10, maxPelvisOffset: 0.1, rejectUnreachable: true }
  );
  assert.equal(physicallyUnreachableFootPlant.plantedCount, 0);
  assert.equal(physicallyUnreachableFootPlant.legs[0]!.planted, false);
  assert.equal(physicallyUnreachableFootPlant.legs[0]!.skippedReason, "ik-target-unreachable");
  assert.deepEqual(
    physicallyUnreachableFootPlant.pelvisOffset,
    [0, 0, 0],
    "rejected physically unreachable contacts must not contribute pelvis compensation"
  );

  const unreachableContactStabilizer = updateFootPlantStabilizer(
    cachedContactStabilizer.state,
    createFootPlantStabilizerObservations(rejectMaxStretchFootPlant),
    { deltaSeconds: 0.025, blendInSeconds: 0.1, blendOutSeconds: 0.2, contactGraceSeconds: 0.25 }
  );
  assert.equal(unreachableContactStabilizer.legs[0]!.active, false);
  assert.equal(unreachableContactStabilizer.legs[0]!.influence, 0);
  assert.equal(unreachableContactStabilizer.legs[0]!.graceSecondsRemaining, 0);
  assert.equal(
    unreachableContactStabilizer.legs[0]!.groundContact,
    undefined,
    "unreachable IK contacts should be treated as blocked, not transient missing-contact grace"
  );
  const reachableRejectFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 0, 0],
        knee: [0, -1, 0],
        ankle: [0, -2, 0],
        ground: { point: [0, -2, 0], normal: [0, 1, 0] },
        footHeight: 0,
        maxAnkleCorrection: 1,
        maxStretch: 1
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 1, maxStretch: 1, rejectUnreachable: true }
  );
  assert.equal(reachableRejectFootPlant.plantedCount, 1, "reachable opt-in contacts should still plant");
  assert.equal(reachableRejectFootPlant.legs[0]!.skippedReason, undefined);
  const boundaryReachPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 0, 0],
        knee: [0, -1, 0],
        ankle: [0, -2, 0],
        ground: { point: [1, -1.08, 0], normal: [0, 1, 0], rayStart: [1, -0.5, 0] },
        footHeight: 0.08,
        maxAnkleCorrection: 2,
        maxStretch: 0.5
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 2, maxPelvisOffset: 2, maxStretch: 0.5 }
  );
  assert.ok(
    boundaryReachPlant.pelvisOffset[1] < -0.999,
    "reach compensation should handle targets exactly on the horizontal reach boundary"
  );
  assert.equal(
    boundaryReachPlant.legs[0]!.ik?.stretchLimited,
    false,
    "boundary reach compensation should avoid an artificial stretch-limited solve"
  );
  const finiteFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [0, 1, 0],
        knee: [0, 0.5, 0],
        ankle: [0, 0.1, 0],
        footHeight: Number.NaN,
        maxAnkleCorrection: Number.NaN,
        maxStretch: Number.NaN,
        ground: { point: [0, 0, 0], normal: [0, 1, 0] }
      }
    ],
    { footHeight: Number.NaN, maxAnkleCorrection: Number.NaN, maxPelvisOffset: Number.NaN, maxStretch: Number.NaN }
  );
  assert.ok(
    finiteFootPlant.pelvisOffset.every(Number.isFinite),
    "foot plant pelvis offset should stay finite for non-finite options"
  );
  assert.ok(
    finiteFootPlant.legs.every(
      (leg) => leg.targetAnkle.every(Number.isFinite) && (leg.ik?.joint.every(Number.isFinite) ?? true)
    ),
    "foot plant leg outputs should stay finite for non-finite options"
  );
  const invalidInputFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [Number.NaN, 1, 0],
        knee: [0, Number.NaN, 0],
        ankle: [0, 0.1, Number.NaN],
        ground: {
          point: [Number.NaN, 0, 0],
          normal: [Number.NaN, Number.NaN, Number.NaN],
          rayStart: [0, Number.NaN, 0]
        }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.5, maxPelvisOffset: 0.5, maxStretch: 1 }
  );
  assert.ok(
    invalidInputFootPlant.pelvisOffset.every(Number.isFinite),
    "foot plant should repair non-finite pelvis input data"
  );
  assert.ok(
    invalidInputFootPlant.legs.every(
      (leg) =>
        leg.initialAnkle.every(Number.isFinite) &&
        leg.targetAnkle.every(Number.isFinite) &&
        (leg.ik?.end.every(Number.isFinite) ?? true)
    ),
    "foot plant should keep leg outputs finite for non-finite contact inputs"
  );

  const ozzFootIkSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.05, 0] } },
    {
      name: "leftLowerLeg",
      parentName: "leftUpperLeg",
      humanoid: "leftLowerLeg",
      rest: { translation: [0, -0.46, 0.02] }
    },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.42, -0.02] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.05, 0] } },
    {
      name: "rightLowerLeg",
      parentName: "rightUpperLeg",
      humanoid: "rightLowerLeg",
      rest: { translation: [0, -0.46, 0.02] }
    },
    { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.42, -0.02] } }
  ]);
  const ozzFootIkPose = clonePose(ozzFootIkSkeleton.restPose);
  const ozzFootIkModels = localToModelPose(ozzFootIkSkeleton, ozzFootIkPose);
  const ozzFootIkRays: Array<{ id: string; start: [number, number, number]; ankle: [number, number, number] }> = [];
  const ozzFootIk = solveOzzFootIk({
    skeleton: ozzFootIkSkeleton,
    modelPose: ozzFootIkModels,
    footHeight: 0.08,
    rayHeight: 0.5,
    maxAnkleCorrection: 0.5,
    raycast: (ray) => {
      ozzFootIkRays.push({ id: ray.id, start: ray.start, ankle: ray.ankle });
      return { point: [ray.ankle[0], 0, ray.ankle[2]], normal: [0, 1, 0] };
    }
  });
  assert.equal(
    ozzFootIk.plantedCount,
    2,
    "Ozz-style foot IK wrapper should resolve default humanoid legs and floor contacts"
  );
  assert.deepEqual(
    ozzFootIk.legs.map((leg) => [leg.id, leg.hipJoint, leg.kneeJoint, leg.ankleJoint]),
    [
      ["left", 1, 2, 3],
      ["right", 4, 5, 6]
    ],
    "Ozz-style foot IK wrapper should expose resolved leg joint indices"
  );
  assert.ok(
    ozzFootIkRays.every((ray) => ray.start[1] > ray.ankle[1]),
    "Ozz-style foot IK wrapper should cast down from above each ankle by default"
  );
  assert.ok(
    ozzFootIk.legs.every((leg) => leg.ankleAim?.jointCorrection.every(Number.isFinite)),
    "Ozz-style foot IK wrapper should include finite ankle aim corrections for planted feet"
  );
  const steepOzzFootIk = solveOzzFootIk({
    skeleton: ozzFootIkSkeleton,
    modelPose: ozzFootIkModels,
    contacts: {
      left: { point: [-0.12, 0, 0], normal: [1, 0, 0] },
      right: { point: [0.12, 0, 0], normal: [0, 1, 0] }
    },
    maxGroundSlopeAngle: Math.PI / 4
  });
  assert.equal(
    steepOzzFootIk.plantedCount,
    1,
    "Ozz-style foot IK wrapper should pass the ground slope gate through to foot-plant planning"
  );
  assert.equal(steepOzzFootIk.legs[0]!.skippedReason, "ground-slope-too-steep");
  assert.equal(steepOzzFootIk.legs[0]!.ankleAim, undefined);
  assert.ok(steepOzzFootIk.issues.includes("left: ground slope too steep"));
  const suppressedContactRays: string[] = [];
  const suppressedContactOzzFootIk = solveOzzFootIk({
    skeleton: ozzFootIkSkeleton,
    modelPose: ozzFootIkModels,
    contacts: { left: null, right: undefined },
    raycast: (ray) => {
      suppressedContactRays.push(ray.id);
      return { point: [ray.ankle[0], 0, ray.ankle[2]], normal: [0, 1, 0] };
    }
  });
  assert.equal(
    suppressedContactOzzFootIk.plantedCount,
    0,
    "explicit empty Ozz foot IK contacts should suppress fallback floor hits"
  );
  assert.deepEqual(
    suppressedContactRays,
    [],
    "explicit null/undefined Ozz foot IK contacts should not fall through to raycasts"
  );
  const missingOzzFootIk = solveOzzFootIk({
    skeleton: ozzFootIkSkeleton,
    modelPose: ozzFootIkModels,
    legs: [{ id: "custom", hip: "missing", knee: "leftLowerLeg", ankle: "leftFoot" }]
  });
  assert.equal(missingOzzFootIk.plantedCount, 0);
  assert.ok(
    missingOzzFootIk.issues.some((issue) => issue === "custom: missing leg joints"),
    "Ozz-style foot IK wrapper should report unresolved explicit leg presets"
  );

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
  const poleRoot = new Object3D();
  const poleHip = new Object3D();
  poleHip.position.set(0, 1, 0);
  const poleKnee = new Object3D();
  poleKnee.position.set(0, -0.5, -0.02);
  const poleAnkle = new Object3D();
  poleAnkle.position.set(0, -0.5, 0.02);
  poleRoot.add(poleHip);
  poleHip.add(poleKnee);
  poleKnee.add(poleAnkle);
  poleRoot.updateMatrixWorld(true);
  const poleTarget = poleAnkle.getWorldPosition(new Vector3()).clone();
  poleTarget.y -= 0.08;
  const polePlant = solveFootPlant(
    [
      {
        id: "left",
        hip: poleHip.getWorldPosition(new Vector3()).toArray(),
        knee: poleKnee.getWorldPosition(new Vector3()).toArray(),
        ankle: poleAnkle.getWorldPosition(new Vector3()).toArray(),
        ground: { point: [poleTarget.x, poleTarget.y, poleTarget.z], normal: [0, 1, 0] },
        pole: [0, 0, 1],
        footHeight: 0,
        maxAnkleCorrection: 0.5,
        maxStretch: 1
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 0.5, maxPelvisOffset: 0, maxStretch: 1 }
  );
  applyThreeFootPlantResult(polePlant, {
    resolveBone: (bone) =>
      ({
        leftUpperLeg: poleHip,
        leftLowerLeg: poleKnee,
        leftFoot: poleAnkle
      })[bone] ?? null,
    legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot", pole: [0, 0, 1], alignAnkleToGround: false }],
    applyPelvis: false,
    applyLegIk: true
  });
  poleRoot.updateMatrixWorld(true);
  assert.ok(
    poleKnee.getWorldPosition(new Vector3()).z > 0,
    "Three foot-plant leg binding pole should keep the knee on the configured anatomical bend side"
  );
  assert.equal(footPlantApply.applied, true);
  assert.equal(footPlantApply.pelvisApplied, true);
  assert.ok(pelvisBone.position.y < 0);
  assert.ok(
    Math.hypot(leftHipBone.quaternion.x, leftHipBone.quaternion.y, leftHipBone.quaternion.z) > 1e-6 ||
      Math.hypot(leftKneeBone.quaternion.x, leftKneeBone.quaternion.y, leftKneeBone.quaternion.z) > 1e-6
  );
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
  const ikOnlyPelvis = new Object3D();
  ikOnlyPelvis.name = "hips";
  const ikOnlyHip = new Object3D();
  ikOnlyHip.name = "leftUpperLeg";
  ikOnlyHip.position.set(0, 1, 0);
  const ikOnlyKnee = new Object3D();
  ikOnlyKnee.name = "leftLowerLeg";
  ikOnlyKnee.position.set(0.5, -0.5, 0);
  const ikOnlyAnkle = new Object3D();
  ikOnlyAnkle.name = "leftFoot";
  ikOnlyAnkle.position.set(-0.5, -0.5, 0);
  ikOnlyPelvis.add(ikOnlyHip);
  ikOnlyHip.add(ikOnlyKnee);
  ikOnlyKnee.add(ikOnlyAnkle);
  ikOnlyPelvis.updateMatrixWorld(true);
  const ikOnlyInitialAnkle = ikOnlyAnkle.getWorldPosition(new Vector3()).clone();
  const ikOnlyPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: ikOnlyHip.getWorldPosition(new Vector3()).toArray(),
        knee: ikOnlyKnee.getWorldPosition(new Vector3()).toArray(),
        ankle: ikOnlyInitialAnkle.toArray(),
        ground: { point: [0, -0.2, 0], normal: [0, 1, 0], rayStart: [0, 1, 0] },
        footHeight: 0,
        maxAnkleCorrection: 2,
        maxStretch: 1
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 2, maxPelvisOffset: 1, pelvisCompensation: 1, maxStretch: 1 }
  );
  assert.ok(
    ikOnlyPlant.pelvisOffset[1] < -0.19,
    "IK-only foot plant fixture should normally assign the correction to pelvis motion"
  );
  const ikOnlyTarget = new Vector3(...ikOnlyPlant.legs[0]!.targetAnkle);
  const ikOnlyDistanceBefore = ikOnlyInitialAnkle.distanceTo(ikOnlyTarget);
  const ikOnlyApply = applyThreeFootPlantResult(ikOnlyPlant, {
    resolveBone: (bone) =>
      ({
        hips: ikOnlyPelvis,
        leftUpperLeg: ikOnlyHip,
        leftLowerLeg: ikOnlyKnee,
        leftFoot: ikOnlyAnkle
      })[bone] ?? null,
    pelvis: "hips",
    legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot", alignAnkleToGround: false }],
    applyPelvis: false,
    applyLegIk: true
  });
  ikOnlyPelvis.updateMatrixWorld(true);
  assert.equal(
    ikOnlyApply.pelvisApplied,
    false,
    "IK-only foot plant application should respect disabled pelvis motion"
  );
  assert.equal(ikOnlyApply.legs[0]!.appliedHip, true);
  assert.equal(ikOnlyApply.legs[0]!.appliedKnee, true);
  assert.ok(
    ikOnlyAnkle.getWorldPosition(new Vector3()).distanceTo(ikOnlyTarget) < ikOnlyDistanceBefore * 0.01,
    "Three foot plant IK should resolve from the actual applied pose when pelvis correction is disabled"
  );
  const fallbackSpeedPelvis = new Object3D();
  fallbackSpeedPelvis.name = "hips";
  const fallbackSpeedFootPlant = applyThreeFootPlantResult(footPlant, {
    resolveBone: (bone) => (bone === "hips" ? fallbackSpeedPelvis : null),
    pelvis: "hips",
    legs: [],
    deltaSeconds: 1 / 30,
    speed: Number.NaN,
    applyPelvis: true,
    applyLegIk: false
  });
  assert.equal(
    fallbackSpeedFootPlant.pelvisApplied,
    true,
    "Three foot plant application should fall back from non-finite speeds"
  );
  assert.ok(
    fallbackSpeedFootPlant.pelvisOffsetLocal.every(Number.isFinite),
    "Three foot plant fallback offsets should remain finite"
  );
  const nonFiniteDeltaPelvis = new Object3D();
  nonFiniteDeltaPelvis.name = "hips";
  const nonFiniteDeltaFootPlant = applyThreeFootPlantResult(footPlant, {
    resolveBone: (bone) => (bone === "hips" ? nonFiniteDeltaPelvis : null),
    pelvis: "hips",
    legs: [],
    deltaSeconds: Number.NaN,
    applyPelvis: true,
    applyLegIk: false
  });
  assert.equal(
    nonFiniteDeltaFootPlant.pelvisApplied,
    false,
    "Three foot plant damping should treat non-finite delta time as zero elapsed time"
  );
  assert.deepEqual(nonFiniteDeltaFootPlant.pelvisOffsetLocal, [0, 0, 0]);
  const scaledRoot = new Object3D();
  scaledRoot.name = "scaledRoot";
  scaledRoot.scale.set(2, 2, 2);
  const scaledPelvis = new Object3D();
  scaledPelvis.name = "hips";
  scaledRoot.add(scaledPelvis);
  scaledRoot.updateMatrixWorld(true);
  const scaledPelvisBefore = scaledPelvis.getWorldPosition(new Vector3()).clone();
  const scaledFootPlantApply = applyThreeFootPlantResult(
    { pelvisOffset: [0, -1, 0], plantedCount: 0, lowestCorrection: 1, legs: [], issues: [] },
    {
      resolveBone: (bone) => (bone === "hips" ? scaledPelvis : null),
      pelvis: "hips",
      legs: [],
      applyPelvis: true,
      applyLegIk: false
    }
  );
  scaledRoot.updateMatrixWorld(true);
  const scaledPelvisAfter = scaledPelvis.getWorldPosition(new Vector3());
  assert.equal(scaledFootPlantApply.pelvisApplied, true);
  assert.ok(
    Math.abs(scaledFootPlantApply.pelvisOffsetLocal[1] + 0.5) < 1e-6,
    "world pelvis offsets should be converted through parent scale"
  );
  assert.ok(
    Math.abs(scaledPelvisAfter.y - scaledPelvisBefore.y + 1) < 1e-6,
    "scaled parent transforms should not amplify world pelvis offsets"
  );

  const anchoredReachRoot = new Object3D();
  anchoredReachRoot.name = "anchoredReachRoot";
  const anchoredReachPelvis = new Object3D();
  anchoredReachPelvis.name = "hips";
  const anchoredReachHip = new Object3D();
  anchoredReachHip.name = "leftUpperLeg";
  anchoredReachHip.position.set(-0.1, -0.05, 0);
  const anchoredReachKnee = new Object3D();
  anchoredReachKnee.name = "leftLowerLeg";
  anchoredReachKnee.position.set(0, -0.45, 0.02);
  const anchoredReachAnkle = new Object3D();
  anchoredReachAnkle.name = "leftFoot";
  anchoredReachAnkle.position.set(0, -0.45, -0.02);
  anchoredReachRoot.add(anchoredReachPelvis);
  anchoredReachPelvis.add(anchoredReachHip);
  anchoredReachHip.add(anchoredReachKnee);
  anchoredReachKnee.add(anchoredReachAnkle);
  anchoredReachPelvis.position.set(0, 1, 0);
  anchoredReachRoot.updateMatrixWorld(true);
  const anchoredReachTarget = anchoredReachAnkle.getWorldPosition(new Vector3()).clone();
  anchoredReachRoot.position.z = -0.18;
  anchoredReachRoot.updateMatrixWorld(true);
  const anchoredReachCurrentAnkle = anchoredReachAnkle.getWorldPosition(new Vector3());
  const anchoredReachPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: anchoredReachHip.getWorldPosition(new Vector3()).toArray(),
        knee: anchoredReachKnee.getWorldPosition(new Vector3()).toArray(),
        ankle: anchoredReachCurrentAnkle.toArray(),
        ground: {
          point: [anchoredReachTarget.x, anchoredReachTarget.y - 0.08, anchoredReachTarget.z],
          normal: [0, 1, 0],
          rayStart: [anchoredReachTarget.x, anchoredReachTarget.y + 0.5, anchoredReachTarget.z]
        },
        footHeight: 0.08,
        maxAnkleCorrection: 0.5,
        maxStretch: 1
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.5, maxPelvisOffset: 0.08, pelvisCompensation: 1, maxStretch: 1 }
  );
  assert.ok(
    anchoredReachPlant.pelvisOffset[1] < -0.005,
    "foot plant should lower the pelvis when a planted ankle would otherwise overreach"
  );
  assert.ok(
    Math.abs(anchoredReachPlant.pelvisOffset[1]) <= 0.0801,
    "reach compensation should respect the configured pelvis limit"
  );
  assert.equal(
    anchoredReachPlant.legs[0]!.ik?.clamped,
    false,
    "pelvis reach compensation should keep the anchored ankle reachable"
  );
  applyThreeFootPlantResult(anchoredReachPlant, {
    resolveBone: (bone) =>
      ({
        hips: anchoredReachPelvis,
        leftUpperLeg: anchoredReachHip,
        leftLowerLeg: anchoredReachKnee,
        leftFoot: anchoredReachAnkle
      })[bone] ?? null,
    pelvis: "hips",
    legs: [{ id: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot", alignAnkleToGround: false }],
    applyPelvis: true,
    applyLegIk: true
  });
  anchoredReachRoot.updateMatrixWorld(true);
  const anchoredReachAppliedAnkle = anchoredReachAnkle.getWorldPosition(new Vector3());
  assert.ok(
    anchoredReachAppliedAnkle.distanceTo(anchoredReachTarget) < 0.003,
    "Three foot plant application should keep an anchored ankle world-stable while the avatar root advances"
  );

  const ozzGlobalInfluenceAnkleAim = solveOzzFootIk({
    skeleton: createSkeleton([{ name: "hip" }, { name: "knee", parentIndex: 0 }, { name: "ankle", parentIndex: 1 }]),
    modelPose: [
      composeMat4({ translation: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
      composeMat4({ translation: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
      composeMat4({ translation: [0, 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    ],
    legs: [{ id: "left", hip: 0, knee: 1, ankle: 2, ankleUp: [0, 1, 0], footForward: [0, 0, 1] }],
    contacts: { left: { point: [0, 0, 0], normal: [0, 1, 0] } },
    influence: 0.25,
    footHeight: 0.1,
    maxAnkleCorrection: 1
  });
  assert.equal(ozzGlobalInfluenceAnkleAim.plantedCount, 1);
  assert.equal(
    ozzGlobalInfluenceAnkleAim.legs[0]!.ankleAim?.weight,
    0.25,
    "Ozz foot IK ankle aim should respect global foot-plant influence when no per-leg influence is set"
  );
}
