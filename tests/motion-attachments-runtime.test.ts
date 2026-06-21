import {
  AnimationClip,
  AnimationRuntime,
  LOCOMOTION_BASE_SOURCE_TRACK_POLICY,
  Object3D,
  Quaternion,
  ROOT_TRANSLATION_SOURCE_EXCLUDE_POLICY,
  Vector3,
  applySourceTrackPolicy,
  applyThreeLocomotionUpperBodyPosture,
  assert,
  cloneTransform,
  composeMat4,
  computeAttachmentTransform,
  computeBoundAttachmentTransform,
  computeBoundAttachmentTransforms,
  computeSkeletonAttachmentTransform,
  createAttachmentBinding,
  createAttachmentBindings,
  createSkeleton,
  createThreeAnimationClip,
  createThreeLocomotionUpperBodyTargets,
  identityTransform,
  localToModelPose,
  multiplyMat4,
  quatFromAxisAngle,
  toFloat32Array,
  transformPoint
} from "./test-api.js";
import {
  assertFiniteEvaluation,
  assertMat4NearlyEqual,
  attachArmChain,
  makeAuthoredLoopClip,
  nodClip,
  sampleNodPose,
  signedJointForwardOffset,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runMotionAttachmentTests(): Promise<void> {
  const sampled = sampleNodPose();
  const models = localToModelPose(skeleton, sampled);
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
}

export async function runMotionThreeRuntimeUtilityTests(): Promise<void> {
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

}

export async function runMotionRuntimeDiagnosticTests(): Promise<void> {
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
