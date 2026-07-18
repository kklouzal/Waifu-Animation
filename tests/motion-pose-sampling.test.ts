import type { AnimationClip, Pose, SampleRepairDiagnostic, Skeleton } from "./test-api.js";
import {
  AnimationRuntime,
  assert,
  clonePose,
  createSkeleton,
  diagnoseRetargetingRestAxes,
  localToModelPose,
  invertQuat,
  multiplyQuat,
  normalizeVec3,
  quatFromAxisAngle,
  quatFromUnitVectors,
  retargetQuaternionSample,
  sampleClipToPose,
  sampleTrack,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  transformPoint,
  validateClip
} from "./test-api.js";
import { assertFiniteEvaluation, quaternionNearlyEqual, skeleton, vectorNearlyEqual } from "./test-helpers.js";

export async function runMotionPoseSamplingTests(): Promise<void> {
  const coreRetargetSourceRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const coreRetargetTargetRest = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
  const coreRetargetDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
  const coreRetargetSourceSample = multiplyQuat(coreRetargetSourceRest, coreRetargetDelta);
  assert.ok(
    quaternionNearlyEqual(
      retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceRest),
      coreRetargetTargetRest,
      1e-5
    ),
    "retargeting a source rest sample should preserve the target rest rotation"
  );
  assert.ok(
    quaternionNearlyEqual(
      retargetQuaternionSample(coreRetargetSourceRest, coreRetargetTargetRest, coreRetargetSourceSample),
      multiplyQuat(multiplyQuat(coreRetargetSourceSample, invertQuat(coreRetargetSourceRest)), coreRetargetTargetRest),
      1e-5
    ),
    "retargeting should preserve canonical parent-frame deltas by pre-applying them to target rest"
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
  const coreRetargetExpected = multiplyQuat(multiplyQuat(coreRetargetSourceSample, invertQuat(coreRetargetSourceRest)), coreRetargetTargetRest);
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

  function modelDirectionBetween(
    skeleton: Skeleton,
    pose: Pose,
    parent: string,
    child: string
  ): [number, number, number] {
    const a = modelPoint(skeleton, pose, parent);
    const b = modelPoint(skeleton, pose, child);
    return normalizeVec3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  }

  function signedJointOffset(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    axis: [number, number, number]
  ): number {
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
    {
      name: "leftLowerLeg",
      parentName: "leftUpperLeg",
      humanoid: "leftLowerLeg",
      rest: { translation: [0, -0.46, 0] }
    },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
    {
      name: "rightLowerLeg",
      parentName: "rightUpperLeg",
      humanoid: "rightLowerLeg",
      rest: { translation: [0, -0.46, 0] }
    },
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
  assert.ok(
    rightKneeForward > 0.16,
    `right knee should flex forward in model space, got ${rightKneeForward.toFixed(4)}`
  );
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
    {
      name: "leftLowerArm",
      parentName: "leftUpperArm",
      humanoid: "leftLowerArm",
      rest: { translation: [-0.36, 0, 0] }
    },
    { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.34, 0, 0] } },
    { name: "rightUpperArm", parentName: "chest", humanoid: "rightUpperArm", rest: { translation: [0.18, 0.12, 0] } },
    {
      name: "rightLowerArm",
      parentName: "rightUpperArm",
      humanoid: "rightLowerArm",
      rest: { translation: [0.36, 0, 0] }
    },
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
  assert.ok(
    leftElbowForward > 0.12,
    `left elbow should flex to the authored forward bend plane, got ${leftElbowForward.toFixed(4)}`
  );
  assert.ok(
    rightElbowForward > 0.12,
    `right elbow should flex to the authored forward bend plane, got ${rightElbowForward.toFixed(4)}`
  );

  const fullAnatomicalSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "spine", parentName: "hips", humanoid: "spine", rest: { translation: [0, 0.28, 0] } },
    { name: "chest", parentName: "spine", humanoid: "chest", rest: { translation: [0, 0.28, 0] } },
    { name: "neck", parentName: "chest", humanoid: "neck", rest: { translation: [0, 0.24, 0] } },
    { name: "head", parentName: "neck", humanoid: "head", rest: { translation: [0, 0.18, 0] } },
    { name: "leftShoulder", parentName: "chest", humanoid: "leftShoulder", rest: { translation: [-0.12, 0.18, 0] } },
    { name: "leftUpperArm", parentName: "leftShoulder", humanoid: "leftUpperArm", rest: { translation: [-0.2, 0, 0] } },
    {
      name: "leftLowerArm",
      parentName: "leftUpperArm",
      humanoid: "leftLowerArm",
      rest: { translation: [-0.36, 0, 0] }
    },
    { name: "leftHand", parentName: "leftLowerArm", humanoid: "leftHand", rest: { translation: [-0.32, 0, 0] } },
    { name: "rightShoulder", parentName: "chest", humanoid: "rightShoulder", rest: { translation: [0.12, 0.18, 0] } },
    {
      name: "rightUpperArm",
      parentName: "rightShoulder",
      humanoid: "rightUpperArm",
      rest: { translation: [0.2, 0, 0] }
    },
    {
      name: "rightLowerArm",
      parentName: "rightUpperArm",
      humanoid: "rightLowerArm",
      rest: { translation: [0.36, 0, 0] }
    },
    { name: "rightHand", parentName: "rightLowerArm", humanoid: "rightHand", rest: { translation: [0.32, 0, 0] } },
    { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.12, 0] } },
    {
      name: "leftLowerLeg",
      parentName: "leftUpperLeg",
      humanoid: "leftLowerLeg",
      rest: { translation: [0, -0.46, 0] }
    },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "leftToes", parentName: "leftFoot", humanoid: "leftToes", rest: { translation: [0, 0, 0.18] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.12, 0] } },
    {
      name: "rightLowerLeg",
      parentName: "rightUpperLeg",
      humanoid: "rightLowerLeg",
      rest: { translation: [0, -0.46, 0] }
    },
    { name: "rightFoot", parentName: "rightLowerLeg", humanoid: "rightFoot", rest: { translation: [0, -0.46, 0] } },
    { name: "rightToes", parentName: "rightFoot", humanoid: "rightToes", rest: { translation: [0, 0, 0.18] } }
  ]);
  const fullAnatomicalClip: AnimationClip = {
    id: "full-anatomical-known-local-rotations",
    duration: 1,
    tracks: [
      {
        humanBone: "hips",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 10)])
      },
      {
        humanBone: "spine",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], Math.PI / 12)])
      },
      {
        humanBone: "neck",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 10)])
      },
      {
        humanBone: "leftShoulder",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], Math.PI / 8)])
      },
      {
        humanBone: "rightShoulder",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], -Math.PI / 8)])
      },
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
      },
      {
        humanBone: "leftHand",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], -Math.PI / 9)])
      },
      {
        humanBone: "rightHand",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 9)])
      },
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
      },
      {
        humanBone: "leftFoot",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)])
      },
      {
        humanBone: "rightFoot",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([1, 0, 0], -Math.PI / 10)])
      }
    ]
  };
  const fullAnatomicalPose = sampleClipToPose(fullAnatomicalSkeleton, fullAnatomicalClip, 1);
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "head")[2] > 0.08,
    "spine rotation should propagate through neck/head in model space"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm")[1] <
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftUpperArm")[1],
    "left shoulder should lower the upper arm rather than swap sides"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightUpperArm")[1] <
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightUpperArm")[1],
    "right shoulder should lower the upper arm rather than swap sides"
  );
  assert.ok(
    signedJointOffset(
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftUpperArm"),
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftLowerArm"),
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand"),
      [0, 0, 1]
    ) > 0.12,
    "left elbow and wrist should bend into the expected forward model-space plane"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftHand")[0] < 0,
    "left wrist/hand should remain on the left side"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightHand")[0] > 0,
    "right wrist/hand should remain on the right side"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "leftToes")[2] <
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "leftToes")[2],
    "left ankle/foot should plantarflex toes backward under the known local rotation"
  );
  assert.ok(
    modelPoint(fullAnatomicalSkeleton, fullAnatomicalPose, "rightToes")[2] <
      modelPoint(fullAnatomicalSkeleton, fullAnatomicalSkeleton.restPose, "rightToes")[2],
    "right ankle/foot should plantarflex toes backward under the known local rotation"
  );
  const fullAnatomicalDiagnostics = diagnoseRetargetingRestAxes(fullAnatomicalSkeleton, fullAnatomicalClip);
  assert.equal(
    fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerLeg")?.hingePlane,
    "sagittal",
    "diagnostic should classify left knee flexion as sagittal"
  );
  assert.equal(
    fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerLeg")?.hingePlane,
    "sagittal",
    "diagnostic should classify right knee flexion as sagittal"
  );
  assert.equal(
    fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "leftLowerArm")?.hingePlane,
    "sagittal",
    "diagnostic should classify left elbow flexion as sagittal"
  );
  assert.equal(
    fullAnatomicalDiagnostics.find((entry) => entry.humanBone === "rightLowerArm")?.hingePlane,
    "sagittal",
    "diagnostic should classify right elbow flexion as sagittal"
  );
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
    diagnoseRetargetingRestAxes(diagnosticRestDominatedSkeleton, diagnosticRestDominatedClip, {
      bones: ["leftLowerLeg"]
    })[0]?.hingePlane,
    "sagittal",
    "diagnostic should choose the strongest rest-relative local motion instead of the largest absolute source rotation"
  );
  const diagnosticTargetRest = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const diagnosticTargetDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 4);
  const diagnosticTargetSample = multiplyQuat(diagnosticTargetRest, diagnosticTargetDelta);
  const diagnosticTargetRestSkeleton = createSkeleton([
    { name: "upper", humanoid: "leftUpperLeg" },
    {
      name: "lower",
      parentName: "upper",
      humanoid: "leftLowerLeg",
      rest: { translation: [0, -1, 0], rotation: diagnosticTargetRest }
    },
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
  const diagnosticTargetRestEntry = diagnoseRetargetingRestAxes(
    diagnosticTargetRestSkeleton,
    diagnosticTargetRestClip,
    { bones: ["leftLowerLeg"] }
  )[0]!;
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
  assert.deepEqual(
    malformedFallbackPose[0]!.translation,
    [0, 0, 0],
    "missing translation samples should fall back to zero translation"
  );
  assert.deepEqual(
    malformedFallbackPose[1]!.rotation,
    [0, 0, 0, 1],
    "missing rotation samples should fall back to identity rotation"
  );
  assert.deepEqual(
    malformedFallbackPose[2]!.scale,
    [1, 1, 1],
    "missing scale samples should fall back to identity scale"
  );
  assert.deepEqual(malformedFallbackPose[3]!.scale, [1, 1, 1], "empty scale tracks should fall back to identity scale");
  const malformedFiniteSampleDiagnostics: SampleRepairDiagnostic[] = [];
  const malformedFiniteSampleClip: AnimationClip = {
    id: "malformed-finite-samples",
    duration: 1,
    tracks: [
      {
        humanBone: "spine",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([Number.NaN, 2, Number.POSITIVE_INFINITY, 4, 5, 6])
      },
      {
        humanBone: "head",
        property: "scale",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([1, Number.NEGATIVE_INFINITY, 1, Number.NaN, 3, 4])
      }
    ]
  };
  const malformedFiniteSamplePose = sampleClipToPose(skeleton, malformedFiniteSampleClip, 0.5, {
    diagnostics: malformedFiniteSampleDiagnostics
  });
  assert.deepEqual(
    malformedFiniteSamplePose[1]!.translation,
    [2, 3.5, 3],
    "non-finite translation sample components should be repaired before interpolation"
  );
  assert.deepEqual(
    malformedFiniteSamplePose[2]!.scale,
    [1, 2, 2.5],
    "non-finite scale sample components should be repaired before interpolation"
  );
  assert.ok(
    malformedFiniteSamplePose.every(
      (transform) => transform.translation.every(Number.isFinite) && transform.scale.every(Number.isFinite)
    )
  );
  assert.ok(
    malformedFiniteSampleDiagnostics.some(
      (issue) =>
        issue.property === "translation" &&
        issue.sample === 0 &&
        issue.message === "translation track sample values were repaired to finite defaults"
    ),
    "direct pose sampling should report repaired translation samples"
  );
  assert.ok(
    malformedFiniteSampleDiagnostics.some(
      (issue) =>
        issue.property === "scale" &&
        issue.sample === 0 &&
        issue.message === "scale track sample values were repaired to finite defaults"
    ),
    "direct pose sampling should report repaired scale samples"
  );
  assert.ok(
    malformedFiniteSampleDiagnostics.some(
      (issue) =>
        issue.property === "scale" &&
        issue.sample === 1 &&
        issue.message === "scale track sample values were repaired to finite defaults"
    ),
    "direct pose sampling should report each repaired scale key used for interpolation"
  );
  const shortSamplingRestPose = sampleClipToPose(
    skeleton,
    { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] },
    0,
    { restPose: [] }
  );
  assert.deepEqual(
    shortSamplingRestPose[2]!.translation,
    skeleton.restPose[2]!.translation,
    "short sampling rest poses should fall back missing base joints to skeleton rest pose"
  );
  const invalidSamplingRestPose = clonePose(skeleton.restPose);
  invalidSamplingRestPose[2]!.translation = [Number.NaN, 7, 7];
  invalidSamplingRestPose[2]!.rotation = [0, 0, 0, 0];
  invalidSamplingRestPose[2]!.scale = [Number.POSITIVE_INFINITY, 2, 3];
  const invalidSamplingRestFallback = sampleClipToPose(
    skeleton,
    { ...malformedFallbackClip, tracks: [malformedFallbackClip.tracks[2]!] },
    0,
    {
      restPose: invalidSamplingRestPose
    }
  );
  assert.deepEqual(
    invalidSamplingRestFallback[2]!.translation,
    skeleton.restPose[2]!.translation,
    "invalid sampling rest transforms should fall back per joint to skeleton rest pose"
  );

  const unsupportedPropertyClip = {
    id: "unsupported-property",
    duration: 1,
    tracks: [
      { humanBone: "hips", property: "visibility", times: toFloat32Array([0]), values: toFloat32Array([1, 1, 1]) }
    ]
  } as unknown as AnimationClip;
  const unsupportedPropertyIssues = validateClip(unsupportedPropertyClip, skeleton);
  assert.equal(
    unsupportedPropertyIssues.some(
      (issue) =>
        issue.track === 0 && issue.property === "visibility" && issue.message === "track property is unsupported"
    ),
    true,
    "unsupported external track properties should be reported instead of treated as 3-float transform channels"
  );
  const unknownHumanoidTrackClip = {
    id: "unknown-humanbone",
    duration: 1,
    tracks: [
      { humanBone: "pelvis", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  } as unknown as AnimationClip;
  assert.ok(
    validateClip(unknownHumanoidTrackClip).some(
      (issue) =>
        issue.track === 0 &&
        issue.joint === "pelvis" &&
        issue.property === "translation" &&
        issue.message === "track has unknown humanoid bone"
    ),
    "validateClip should report unknown humanoid track identifiers without requiring a skeleton"
  );
  const noSkeletonMixedTargetClip: AnimationClip = {
    id: "no-skeleton-mixed-targets",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  assert.equal(
    validateClip(noSkeletonMixedTargetClip).some((issue) => issue.message.startsWith("duplicate target channel")),
    false,
    "validateClip should not treat same-label joint and humanBone tracks as duplicate channels without a skeleton"
  );
  const noSkeletonDuplicateJointClip: AnimationClip = {
    id: "no-skeleton-duplicate-joint",
    duration: 1,
    tracks: [
      { joint: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  assert.ok(
    validateClip(noSkeletonDuplicateJointClip).some(
      (issue) =>
        issue.track === 1 &&
        issue.joint === "head" &&
        issue.property === "rotation" &&
        issue.message === "duplicate target channel head.rotation conflicts with track 0 (head.rotation)"
    ),
    "validateClip should still report same-kind duplicate channels without a skeleton"
  );
  const duplicateHumanoidRotationClip: AnimationClip = {
    id: "duplicate-humanoid-rotation",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  const duplicateHumanoidRotationIssues = validateClip(duplicateHumanoidRotationClip, skeleton);
  assert.ok(
    duplicateHumanoidRotationIssues.some(
      (issue) =>
        issue.track === 1 &&
        issue.joint === "head[2]" &&
        issue.property === "rotation" &&
        issue.message === "duplicate target channel head[2].rotation conflicts with track 0 (head[2].rotation)"
    ),
    "validateClip should report duplicate humanoid rotation channels by resolved skeleton joint"
  );
  const duplicateAliasRotationClip: AnimationClip = {
    id: "duplicate-alias-rotation",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "quaternion", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  assert.ok(
    validateClip(duplicateAliasRotationClip, skeleton).some(
      (issue) =>
        issue.track === 1 &&
        issue.joint === "head[2]" &&
        issue.property === "quaternion" &&
        issue.message === "duplicate target channel head[2].rotation conflicts with track 0 (head[2].rotation)"
    ),
    "validateClip should normalize rotation/quaternion aliases before checking duplicate skeleton channels"
  );
  const distinctSameJointPropertiesClip: AnimationClip = {
    id: "distinct-same-joint-properties",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  assert.equal(
    validateClip(distinctSameJointPropertiesClip, skeleton).some((issue) =>
      issue.message.startsWith("duplicate target channel")
    ),
    false,
    "validateClip should allow distinct transform properties on the same resolved joint"
  );
  const unresolvedDuplicateClip: AnimationClip = {
    id: "unresolved-duplicate",
    duration: 1,
    tracks: [
      { joint: "missing", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) },
      { joint: "missing", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 1]) }
    ]
  };
  const unresolvedDuplicateIssues = validateClip(unresolvedDuplicateClip, skeleton);
  assert.equal(
    unresolvedDuplicateIssues.filter((issue) => issue.message === "track does not map to skeleton").length,
    2,
    "validateClip should keep existing unresolved-target validation for each unmapped track"
  );
  assert.equal(
    unresolvedDuplicateIssues.some((issue) => issue.message.startsWith("duplicate target channel")),
    false,
    "validateClip should not report duplicate target channels for tracks that do not resolve to a skeleton joint"
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
  assert.equal(
    unsupportedPropertyRuntimeEvaluation.diagnostics,
    undefined,
    "runtime diagnostics should stay opt-in for unsupported external tracks"
  );
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
}
