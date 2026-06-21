import {
  AnimationClip,
  AnimationRuntime,
  AttentionScheduler,
  BlinkScheduler,
  FacialExpressionMixer,
  Object3D,
  PresencePlanner,
  Vector3,
  VisemeMixer,
  applyAimIkChainToPose,
  applyAimIkChildToParentChainToPose,
  applyAimIkModelCorrection,
  applyThreeFootPlantResult,
  applyThreePresenceTargets,
  applyTwoBoneIkLocalCorrections,
  assert,
  breathingWeight,
  clearThreeFootPlantOffsets,
  clonePose,
  composeFacialExpressions,
  composeMat4,
  createHumanoidLookAtAimChain,
  createSkeleton,
  createThreeAnimationClip,
  dampAlpha,
  distributeLookAt,
  dotVec3,
  invertQuat,
  limitVisemeStack,
  localToModelPose,
  modelCorrectionToLocalPostCorrection,
  multiplyQuat,
  normalizeQuat,
  normalizeVec3,
  poseDeltaMetric,
  poseRotationMetric,
  quatFromAxisAngle,
  quatFromUnitVectors,
  retargetQuaternionSample,
  retargetQuaternionTrackValues,
  rotateVec3ByQuat,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  solveAimIk,
  solveFootPlant,
  solveOzzFootIk,
  solveTwoBoneIk,
  solveTwoBoneIkCorrections,
  solveTwoBoneIkModel,
  toFloat32Array,
  updateLocalToModelPoseRange,
  zeroVisemes
} from "./test-api.js";
import {
  createMirroredLimbBones,
  createNamedBone,
  createSingleLimbBones,
  distance3,
  matrixDirection,
  modelPosition,
  nodClip,
  quaternionNearlyEqual,
  readChildDirection,
  sampleThreeClipOnce,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runRetargetingIkFacialTests(): Promise<void> {
  const metricRuntime = new AnimationRuntime(skeleton);
  metricRuntime.setLayer("base", nodClip, { weight: 1, targetWeight: 1, loop: true });
  metricRuntime.update(0.5);
  const evaluated = metricRuntime.evaluate();
  const presenceBone = new Object3D();
  presenceBone.name = "head";
  const presenceApply = applyThreePresenceTargets({
    resolveBone: (bone) => (bone === "head" ? presenceBone : null),
    deltaSeconds: 1 / 30,
    targets: [{ bone: "head", rotation: [0.1, 0.2, 0], influence: 1, speed: 12 }]
  });
  assert.equal(presenceApply.applied, true);
  assert.ok(Math.abs(presenceBone.quaternion.w) < 0.99999);
  const presenceFallbackSpeedBone = new Object3D();
  const presenceFallbackSpeed = applyThreePresenceTargets({
    resolveBone: (bone) => (bone === "head" ? presenceFallbackSpeedBone : null),
    deltaSeconds: 1 / 30,
    targets: [{ bone: "head", rotation: [0.1, 0.2, 0], influence: 1, speed: Number.NaN }]
  });
  assert.equal(presenceFallbackSpeed.applied, true, "Three presence application should fall back from non-finite target speeds");
  assert.ok(
    [
      presenceFallbackSpeedBone.quaternion.x,
      presenceFallbackSpeedBone.quaternion.y,
      presenceFallbackSpeedBone.quaternion.z,
      presenceFallbackSpeedBone.quaternion.w
    ].every(Number.isFinite),
    "Three presence application should keep bone quaternions finite for non-finite target speeds"
  );
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
  const targetRestZ = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
  const retargetedZeroSample = retargetQuaternionSample(sourceRestX, targetRestZ, [0, 0, 0, 0]);
  assert.ok(
    Math.abs(retargetedZeroSample[0] - targetRestZ[0]) < 1e-5 &&
      Math.abs(retargetedZeroSample[1] - targetRestZ[1]) < 1e-5 &&
      Math.abs(retargetedZeroSample[2] - targetRestZ[2]) < 1e-5 &&
      Math.abs(retargetedZeroSample[3] - targetRestZ[3]) < 1e-5,
    "retargeting should treat non-normalizable source samples as identity source deltas"
  );
  const retargetedNonUnitSample = retargetQuaternionSample(sourceRestX, targetRestZ, sourceSampleWithLocalDelta.map((component) => component * 2) as [number, number, number, number]);
  const retargetedUnitSample = retargetQuaternionSample(sourceRestX, targetRestZ, sourceSampleWithLocalDelta);
  assert.ok(
    Math.abs(retargetedNonUnitSample[0] - retargetedUnitSample[0]) < 1e-5 &&
      Math.abs(retargetedNonUnitSample[1] - retargetedUnitSample[1]) < 1e-5 &&
      Math.abs(retargetedNonUnitSample[2] - retargetedUnitSample[2]) < 1e-5 &&
      Math.abs(retargetedNonUnitSample[3] - retargetedUnitSample[3]) < 1e-5,
    "retargeting should repair non-unit source samples without changing their rotation"
  );
  const expectedEquivalentRestDelta = multiplyQuat(invertQuat(sourceRestX), sourceSampleWithLocalDelta);
  const retargetedToEquivalentRest = retargetQuaternionSample(sourceRestX, sourceRestX, sourceSampleWithLocalDelta);
  assert.ok(
    Math.abs(retargetedToEquivalentRest[0] - sourceSampleWithLocalDelta[0]) < 1e-5 &&
      Math.abs(retargetedToEquivalentRest[1] - sourceSampleWithLocalDelta[1]) < 1e-5 &&
      Math.abs(retargetedToEquivalentRest[2] - sourceSampleWithLocalDelta[2]) < 1e-5 &&
      Math.abs(retargetedToEquivalentRest[3] - sourceSampleWithLocalDelta[3]) < 1e-5,
    "retargeting should keep equivalent source and target rest bases stable"
  );
  const expectedNormalizedDelta = expectedEquivalentRestDelta;
  const retargetedToNormalizedRest = retargetQuaternionSample(sourceRestX, [0, 0, 0, 1], sourceSampleWithLocalDelta);
  assert.ok(
    Math.abs(retargetedToNormalizedRest[0] - expectedNormalizedDelta[0]) < 1e-5 &&
      Math.abs(retargetedToNormalizedRest[1] - expectedNormalizedDelta[1]) < 1e-5 &&
      Math.abs(retargetedToNormalizedRest[2] - expectedNormalizedDelta[2]) < 1e-5 &&
      Math.abs(retargetedToNormalizedRest[3] - expectedNormalizedDelta[3]) < 1e-5,
    "retargeting should preserve source local rotation deltas before applying normalized target rest"
  );
  assert.deepEqual(
    retargetQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, -1], undefined, [0, 0, 0, 1]).values,
    [0, 0, 0, 1, -0, -0, -0, 1],
    "retargeted quaternion tracks should keep equivalent samples in the shortest hemisphere"
  );
  const retargetedNaNTrack = retargetQuaternionTrackValues([0, Number.NaN, 0, 1], undefined, [0, 0, 0, 1]);
  assert.equal(retargetedNaNTrack.invalidSamples, 1, "retargeted quaternion tracks should count NaN source samples as invalid");
  assert.ok(
    quaternionNearlyEqual(retargetedNaNTrack.values, [0, 0, 0, 1], 1e-5),
    "retargeted quaternion tracks should repair NaN source samples to a normalized fallback"
  );
  const retargetedZeroTrack = retargetQuaternionTrackValues([0, 0, 0, 0], undefined, [0, 0, 0, 1]);
  assert.equal(retargetedZeroTrack.invalidSamples, 1, "retargeted quaternion tracks should count zero source samples as invalid");
  assert.ok(
    quaternionNearlyEqual(retargetedZeroTrack.values, [0, 0, 0, 1], 1e-5),
    "retargeted quaternion tracks should repair zero source samples to a normalized fallback"
  );
  const retargetedZeroTrackWithSourceRest = retargetQuaternionTrackValues([0, 0, 0, 0], sourceRestX, targetRestZ);
  assert.equal(retargetedZeroTrackWithSourceRest.invalidSamples, 1, "source-rest retargeted tracks should count zero source samples as invalid");
  assert.ok(
    quaternionNearlyEqual(retargetedZeroTrackWithSourceRest.values, targetRestZ, 1e-5),
    "source-rest retargeted tracks should repair zero source samples to the target rest instead of applying an inverse source-rest delta"
  );
  const retargetedNaNTrackWithSourceRest = retargetQuaternionTrackValues([Number.NaN, 0, 0, 1], sourceRestX, targetRestZ);
  assert.equal(retargetedNaNTrackWithSourceRest.invalidSamples, 1, "source-rest retargeted tracks should count non-finite source samples as invalid");
  assert.ok(
    quaternionNearlyEqual(retargetedNaNTrackWithSourceRest.values, targetRestZ, 1e-5),
    "source-rest retargeted tracks should repair non-finite source samples to the target rest"
  );
  const retargetedNonUnitTrack = retargetQuaternionTrackValues([0, 0, 0, 2], undefined, [0, 0, 0, 1]);
  assert.equal(retargetedNonUnitTrack.invalidSamples, 0, "retargeted quaternion tracks should accept normalizable non-unit source samples");
  assert.ok(
    quaternionNearlyEqual(retargetedNonUnitTrack.values, [0, 0, 0, 1], 1e-5),
    "retargeted quaternion tracks should normalize non-unit source samples without changing their rotation"
  );
  const childDirectionMetadataDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
  const childDirectionMetadataRetargeted = retargetQuaternionSample(
    [0, 0, 0, 1],
    [0, 0, 0, 1],
    childDirectionMetadataDelta,
    "leftUpperArm",
    undefined,
    [0, 1, 0],
    [1, 0, 0]
  );
  assert.ok(
    quaternionNearlyEqual(childDirectionMetadataRetargeted, childDirectionMetadataDelta, 1e-5),
    "source/target child-direction metadata must not silently conjugate local rotation deltas"
  );
  const targetChildDirectionHingeDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
  const targetChildDirectionHingeRetargeted = retargetQuaternionSample(
    [0, 0, 0, 1],
    [0, 0, 0, 1],
    targetChildDirectionHingeDelta,
    "leftLowerLeg",
    undefined,
    undefined,
    [0, -1, 0]
  );
  assert.ok(
    quaternionNearlyEqual(targetChildDirectionHingeRetargeted, targetChildDirectionHingeDelta, 1e-5),
    "target child direction alone must not trigger hidden hinge-axis remapping"
  );
  const explicitSourceBasis = quatFromUnitVectors([0, 0, 1], [1, 0, 0]);
  const explicitBasisDelta = quatFromAxisAngle([0, 0, 1], Math.PI / 5);
  const explicitBasisExpected = multiplyQuat(multiplyQuat(explicitSourceBasis, explicitBasisDelta), invertQuat(explicitSourceBasis));
  const explicitBasisWithChildDirections = retargetQuaternionSample(
    [0, 0, 0, 1],
    [0, 0, 0, 1],
    explicitBasisDelta,
    "leftLowerLeg",
    explicitSourceBasis,
    [0, 1, 0],
    [1, 0, 0]
  );
  assert.ok(
    quaternionNearlyEqual(explicitBasisWithChildDirections, explicitBasisExpected, 1e-5),
    "explicit source-basis correction must not be overridden by child-direction metadata"
  );

  const mismatchedBasisSourceRest = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
  const mismatchedBasisTargetRest = [0, 0, 0, 1] as const;
  const mismatchedBasisDelta = quatFromAxisAngle([1, 0, 0], Math.PI / 3);
  const mismatchedBasisSample = multiplyQuat(mismatchedBasisSourceRest, mismatchedBasisDelta);
  const mismatchedBasisBones = createSingleLimbBones(mismatchedBasisTargetRest);
  const mismatchedBasisClip = createThreeAnimationClip(
    {
      id: "mismatched-rest-basis",
      duration: 1,
      tracks: [
        {
          humanBone: "leftUpperArm",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(mismatchedBasisSourceRest),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...mismatchedBasisSourceRest, ...mismatchedBasisSample])
        }
      ]
    },
    {
      resolveBone: (bone) => (bone === "leftUpperArm" ? mismatchedBasisBones.upper : null)
    }
  );
  sampleThreeClipOnce(mismatchedBasisBones.root, mismatchedBasisClip);
  const mismatchedBasisActual = readChildDirection(mismatchedBasisBones.upper, mismatchedBasisBones.lower);
  const mismatchedBasisExpectedRotation = retargetQuaternionSample(mismatchedBasisSourceRest, [...mismatchedBasisTargetRest], mismatchedBasisSample);
  const mismatchedBasisExpected = rotateVec3ByQuat(mismatchedBasisExpectedRotation, [0, 1, 0]);
  const mismatchedBasisConjugatedPath = rotateVec3ByQuat(
    multiplyQuat(
      mismatchedBasisSample,
      invertQuat(mismatchedBasisSourceRest)
    ),
    [0, 1, 0]
  );
  assert.ok(
    !vectorNearlyEqual(mismatchedBasisExpected, mismatchedBasisConjugatedPath, 1e-4),
    "basis fixture should distinguish local delta retargeting from rest-basis conjugation"
  );
  assert.ok(vectorNearlyEqual(mismatchedBasisActual, mismatchedBasisExpected, 1e-5), "Three retargeting should render child direction from the source local delta");

  const invalidSourceRestTrackBones = createSingleLimbBones([0, 0, 0, 1], "leftUpperArm", "leftLowerArm", [0, 1, 0]);
  const invalidSourceRestTrackClip = createThreeAnimationClip(
    {
      id: "invalid-source-rest-sample",
      duration: 1,
      tracks: [
        {
          humanBone: "leftUpperArm",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(sourceRestX),
          times: toFloat32Array([0, 1]),
          values: Float32Array.from([...sourceRestX, 0, 0, 0, 0])
        }
      ]
    },
    {
      resolveBone: (bone) => (bone === "leftUpperArm" ? invalidSourceRestTrackBones.upper : null),
      targetRestQuaternion: () => targetRestZ
    }
  );
  sampleThreeClipOnce(invalidSourceRestTrackBones.root, invalidSourceRestTrackClip);
  const invalidSourceRestTrackActual = readChildDirection(invalidSourceRestTrackBones.upper, invalidSourceRestTrackBones.lower);
  const invalidSourceRestTrackExpected = rotateVec3ByQuat(targetRestZ, [0, 1, 0]);
  assert.ok(
    vectorNearlyEqual(invalidSourceRestTrackActual, invalidSourceRestTrackExpected, 1e-5),
    "Three source-rest retargeting should hold target rest for invalid samples instead of applying inverse source-rest rotation"
  );

  const motusRightUpperLegRest: [number, number, number, number] = [-0.0006, 0.1254, 0.9682, -0.2166];
  const motusRightUpperLegSample: [number, number, number, number] = [-0.0035, 0.1166, 0.9636, -0.2406];
  const motusTargetRest: [number, number, number, number] = [0, 0, 0, 1];
  const motusLegBones = createSingleLimbBones(motusTargetRest, "rightUpperLeg", "rightLowerLeg", [0, -1, 0]);
  const motusLegClip = createThreeAnimationClip(
    {
      id: "motus-right-leg-pre-rotation",
      duration: 1,
      tracks: [
        {
          humanBone: "rightUpperLeg",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(motusRightUpperLegRest),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...motusRightUpperLegRest, ...motusRightUpperLegSample])
        }
      ]
    },
    {
      resolveBone: (bone) => (bone === "rightUpperLeg" ? motusLegBones.upper : null)
    }
  );
  sampleThreeClipOnce(motusLegBones.root, motusLegClip);
  const motusLegActual = readChildDirection(motusLegBones.upper, motusLegBones.lower);
  const motusLegExpectedRotation = retargetQuaternionSample(motusRightUpperLegRest, motusTargetRest, motusRightUpperLegSample, "rightUpperLeg");
  const motusLegExpected = rotateVec3ByQuat(motusLegExpectedRotation, [0, -1, 0]);
  assert.ok(vectorNearlyEqual(motusLegActual, motusLegExpected, 1e-5), "right leg should preserve forward local stride instead of twisting inward");

  const realMotusWalkLegSamples: Array<{
    bone: "leftUpperLeg" | "rightUpperLeg" | "leftLowerLeg" | "rightLowerLeg";
    rest: [number, number, number, number];
    sample: [number, number, number, number];
  }> = [
    {
      bone: "leftUpperLeg",
      rest: [0.073705, -0.062139, -0.008584, 0.995305],
      sample: [0.180756, 0.001265, 0.277474, 0.943575]
    },
    {
      bone: "rightUpperLeg",
      rest: [0.062139, 0.073705, 0.995305, 0.008584],
      sample: [0.004475, 0.157648, 0.956273, -0.246312]
    },
    {
      bone: "leftLowerLeg",
      rest: [-0.048884, 0.018864, -0.065522, 0.996474],
      sample: [-0.084341, -0.082607, -0.595885, 0.794345]
    },
    {
      bone: "rightLowerLeg",
      rest: [-0.048884, 0.018864, -0.065522, 0.996474],
      sample: [-0.03445, -0.020477, -0.584123, 0.810675]
    }
  ];
  for (const fixture of realMotusWalkLegSamples) {
    const unremappedDirection = rotateVec3ByQuat(retargetQuaternionSample(fixture.rest, motusTargetRest, fixture.sample), [0, -1, 0]);
    const retargetedDirection = rotateVec3ByQuat(retargetQuaternionSample(fixture.rest, motusTargetRest, fixture.sample, fixture.bone), [0, -1, 0]);
    assert.ok(
      vectorNearlyEqual(retargetedDirection, unremappedDirection, 1e-5),
      `${fixture.bone} retargeting must not apply hidden bone-name axis swizzles`
    );
  }

  const mirroredLegSourceRestLeft = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const mirroredLegSourceRestRight = quatFromAxisAngle([0, 1, 0], -Math.PI / 2);
  const mirroredLegFlexion = quatFromAxisAngle([1, 0, 0], Math.PI / 4);
  const mirroredLegRoot = new Object3D();
  mirroredLegRoot.name = "mirroredLegRoot";
  const mirroredLegBones = {
    left: createSingleLimbBones([0, 0, 0, 1], "leftUpperLeg", "leftLowerLeg", [0, -1, 0]),
    right: createSingleLimbBones([0, 0, 0, 1], "rightUpperLeg", "rightLowerLeg", [0, -1, 0])
  };
  mirroredLegRoot.add(mirroredLegBones.left.upper);
  mirroredLegRoot.add(mirroredLegBones.right.upper);
  const mirroredLegClip = createThreeAnimationClip(
    {
      id: "mirrored-leg-pre-rotation-flexion",
      duration: 1,
      tracks: [
        {
          humanBone: "leftUpperLeg",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(mirroredLegSourceRestLeft),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestLeft, ...multiplyQuat(mirroredLegSourceRestLeft, mirroredLegFlexion)])
        },
        {
          humanBone: "rightUpperLeg",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(mirroredLegSourceRestRight),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...mirroredLegSourceRestRight, ...multiplyQuat(mirroredLegSourceRestRight, mirroredLegFlexion)])
        }
      ]
    },
    {
      resolveBone: (bone) => {
        if (bone === "leftUpperLeg") return mirroredLegBones.left.upper;
        if (bone === "rightUpperLeg") return mirroredLegBones.right.upper;
        return null;
      },
      targetRestQuaternion: () => [0, 0, 0, 1]
    }
  );
  sampleThreeClipOnce(mirroredLegRoot, mirroredLegClip);
  const mirroredLegActualLeft = readChildDirection(mirroredLegBones.left.upper, mirroredLegBones.left.lower);
  const mirroredLegActualRight = readChildDirection(mirroredLegBones.right.upper, mirroredLegBones.right.lower);
  const mirroredLegExpected = rotateVec3ByQuat(mirroredLegFlexion, [0, -1, 0]);
  const oldOrderMirroredLeft = rotateVec3ByQuat(multiplyQuat(multiplyQuat(mirroredLegSourceRestLeft, mirroredLegFlexion), invertQuat(mirroredLegSourceRestLeft)), [0, -1, 0]);
  const oldOrderMirroredRight = rotateVec3ByQuat(multiplyQuat(multiplyQuat(mirroredLegSourceRestRight, mirroredLegFlexion), invertQuat(mirroredLegSourceRestRight)), [0, -1, 0]);
  assert.ok(Math.abs(oldOrderMirroredLeft[0]!) > 0.65 && Math.abs(oldOrderMirroredRight[0]!) > 0.65, "old retarget order would split mirrored leg flexion laterally across the centerline");
  assert.ok(mirroredLegActualLeft[2]! < -0.65 && Math.abs(mirroredLegActualLeft[0]!) < 1e-5, "left leg flexion should bend backward instead of inward");
  assert.ok(vectorNearlyEqual(mirroredLegActualLeft, mirroredLegExpected, 1e-5), "left leg rendered direction should preserve source flexion axis");
  assert.ok(vectorNearlyEqual(mirroredLegActualRight, mirroredLegExpected, 1e-5), "right leg rendered direction should preserve source flexion axis");

  const motusLeftLowerLegRest: [number, number, number, number] = [-0.0344, 0.0344, -0.2013, 0.9783];
  const motusLeftLowerLegInwardSample: [number, number, number, number] = [-0.1252, -0.0155, -0.5739, 0.8091];
  const motusRightLowerLegRest: [number, number, number, number] = [-0.0266, -0.0186, -0.5677, 0.8226];
  const motusRightLowerLegInwardSample: [number, number, number, number] = [-0.0164, 0.0277, -0.2138, 0.9763];
  const motusLeftLowerLegRawDirection = rotateVec3ByQuat(retargetQuaternionSample(motusLeftLowerLegRest, [0, 0, 0, 1], motusLeftLowerLegInwardSample), [0, -1, 0]);
  const motusRightLowerLegRawDirection = rotateVec3ByQuat(retargetQuaternionSample(motusRightLowerLegRest, [0, 0, 0, 1], motusRightLowerLegInwardSample), [0, -1, 0]);
  const motusLeftLowerLegRetargetedDirection = rotateVec3ByQuat(
    retargetQuaternionSample(motusLeftLowerLegRest, [0, 0, 0, 1], motusLeftLowerLegInwardSample, "leftLowerLeg"),
    [0, -1, 0]
  );
  const motusRightLowerLegRetargetedDirection = rotateVec3ByQuat(
    retargetQuaternionSample(motusRightLowerLegRest, [0, 0, 0, 1], motusRightLowerLegInwardSample, "rightLowerLeg"),
    [0, -1, 0]
  );
  assert.ok(
    Math.abs(motusLeftLowerLegRawDirection[0]!) > 0.65 && Math.abs(motusRightLowerLegRawDirection[0]!) > 0.65,
    "Motus lower-leg fixture keeps documenting the source/target basis incompatibility"
  );
  assert.ok(
    vectorNearlyEqual(motusLeftLowerLegRetargetedDirection, motusLeftLowerLegRawDirection, 1e-5) &&
      vectorNearlyEqual(motusRightLowerLegRetargetedDirection, motusRightLowerLegRawDirection, 1e-5),
    "Motus lower-leg labels must not alter the mathematically defined local delta"
  );

  const normalLowerLegRest: [number, number, number, number] = quatFromAxisAngle([1, 0, 0], Math.PI / 7);
  const normalLowerLegLocalDelta = quatFromAxisAngle([0, 1, 0], Math.PI / 5);
  const normalLowerLegSample = multiplyQuat(normalLowerLegRest, normalLowerLegLocalDelta);
  assert.ok(
    quaternionNearlyEqual(
      retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample, "leftLowerLeg"),
      retargetQuaternionSample(normalLowerLegRest, [0, 0, 0, 1], normalLowerLegSample),
      1e-5
    ),
    "lower-leg bone labels should not affect source-rest local delta retargeting"
  );

  const motusManLimbSourceBasis = quatFromUnitVectors([0, 0, 1], [1, 0, 0]);
  const motusLowerLegSourceRest = quatFromAxisAngle([0, 0, 1], 0.2);
  const motusLowerLegSourceFlexion = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
  const motusLowerLegSourceSample = multiplyQuat(motusLowerLegSourceRest, motusLowerLegSourceFlexion);
  const motusLowerLegUncorrectedDirection = rotateVec3ByQuat(
    retargetQuaternionSample(motusLowerLegSourceRest, [0, 0, 0, 1], motusLowerLegSourceSample),
    [0, -1, 0]
  );
  const motusLowerLegCorrectedDirection = rotateVec3ByQuat(
    retargetQuaternionSample(motusLowerLegSourceRest, [0, 0, 0, 1], motusLowerLegSourceSample, "leftLowerLeg", motusManLimbSourceBasis),
    [0, -1, 0]
  );
  assert.ok(Math.abs(motusLowerLegUncorrectedDirection[0]!) > 0.85, "MotusMan lower-leg Z-axis flexion reproduces sideways VRM shin motion without a source-basis correction");
  assert.ok(
    Math.abs(motusLowerLegCorrectedDirection[0]!) < 1e-5 && motusLowerLegCorrectedDirection[2]! < -0.85,
    "MotusMan lower-leg source-basis correction should turn sideways shin motion into forward/back flexion"
  );

  const motusBasisThreeBones = createSingleLimbBones([0, 0, 0, 1], "leftLowerLeg", "leftFoot", [0, -1, 0]);
  const motusBasisThreeClip = createThreeAnimationClip(
    {
      id: "motusman-source-basis-lower-leg",
      duration: 1,
      tracks: [
        {
          humanBone: "leftLowerLeg",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(motusLowerLegSourceRest),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...motusLowerLegSourceRest, ...motusLowerLegSourceSample])
        }
      ]
    },
    {
      resolveBone: (bone) => (bone === "leftLowerLeg" ? motusBasisThreeBones.upper : null),
      targetRestQuaternion: () => [0, 0, 0, 1],
      sourceBasisQuaternion: () => motusManLimbSourceBasis
    }
  );
  sampleThreeClipOnce(motusBasisThreeBones.root, motusBasisThreeClip);
  const motusBasisThreeDirection = readChildDirection(motusBasisThreeBones.upper, motusBasisThreeBones.lower);
  assert.ok(
    vectorNearlyEqual(motusBasisThreeDirection, motusLowerLegCorrectedDirection, 1e-5),
    "Three retargeting should apply caller-provided source-basis correction before binding MotusMan limb tracks"
  );

  const motusBasisCoreSkeleton = createSkeleton([
    { name: "leftLowerLeg", humanoid: "leftLowerLeg" },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -1, 0] } }
  ]);
  const motusBasisCoreClip: AnimationClip = {
    id: "motusman-source-basis-core-lower-leg",
    duration: 1,
    tracks: [
      {
        humanBone: "leftLowerLeg",
        property: "quaternion",
        sourceRestQuaternion: Float32Array.from(motusLowerLegSourceRest),
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([...motusLowerLegSourceRest, ...motusLowerLegSourceSample])
      }
    ]
  };
  const motusBasisCorePose = sampleClipToPose(motusBasisCoreSkeleton, motusBasisCoreClip, 1, {
    sourceBasisQuaternion: () => motusManLimbSourceBasis
  });
  assert.ok(
    vectorNearlyEqual(rotateVec3ByQuat(motusBasisCorePose[0]!.rotation, [0, -1, 0]), motusLowerLegCorrectedDirection, 1e-5),
    "core pose sampling should apply caller-provided source-basis correction before local-pose retargeting"
  );
  const motusBasisCoreRuntime = new AnimationRuntime(motusBasisCoreSkeleton);
  motusBasisCoreRuntime.setLayer("motus-lower-leg", motusBasisCoreClip, {
    time: 1,
    weight: 1,
    sourceBasisQuaternion: () => motusManLimbSourceBasis
  });
  assert.ok(
    vectorNearlyEqual(rotateVec3ByQuat(motusBasisCoreRuntime.evaluate().localPose[0]!.rotation, [0, -1, 0]), motusLowerLegCorrectedDirection, 1e-5),
    "AnimationRuntime should pass source-basis correction through to sampled mocap layers"
  );

  const mirroredLimbSourceRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const mirroredLimbSourceRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
  const mirroredLimbTargetRestLeft = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  const mirroredLimbTargetRestRight = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
  const mirroredLimbDelta = quatFromAxisAngle([0, 0, 1], Math.PI / 3);
  const mirroredLimbSourceSampleLeft = multiplyQuat(mirroredLimbSourceRestLeft, mirroredLimbDelta);
  const mirroredLimbSourceSampleRight = multiplyQuat(mirroredLimbSourceRestRight, mirroredLimbDelta);
  const mirroredLimbBones = createMirroredLimbBones(mirroredLimbTargetRestLeft, mirroredLimbTargetRestRight);
  const mirroredLimbClip = createThreeAnimationClip(
    {
      id: "mirrored-limb-local-axis",
      duration: 1,
      tracks: [
        {
          humanBone: "leftUpperArm",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(mirroredLimbSourceRestLeft),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestLeft, ...mirroredLimbSourceSampleLeft])
        },
        {
          humanBone: "rightUpperArm",
          property: "quaternion",
          sourceRestQuaternion: Float32Array.from(mirroredLimbSourceRestRight),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([...mirroredLimbSourceRestRight, ...mirroredLimbSourceSampleRight])
        }
      ]
    },
    {
      resolveBone: (bone) => {
        if (bone === "leftUpperArm") return mirroredLimbBones.leftUpperArm;
        if (bone === "rightUpperArm") return mirroredLimbBones.rightUpperArm;
        return null;
      }
    }
  );
  sampleThreeClipOnce(mirroredLimbBones.root, mirroredLimbClip);
  const mirroredLimbActual = {
    left: readChildDirection(mirroredLimbBones.leftUpperArm, mirroredLimbBones.leftLowerArm),
    right: readChildDirection(mirroredLimbBones.rightUpperArm, mirroredLimbBones.rightLowerArm)
  };
  const mirroredLimbExpected = {
    left: rotateVec3ByQuat(multiplyQuat(mirroredLimbTargetRestLeft, mirroredLimbDelta), [0, 1, 0]),
    right: rotateVec3ByQuat(multiplyQuat(mirroredLimbTargetRestRight, mirroredLimbDelta), [0, 1, 0])
  };
  assert.ok(vectorNearlyEqual(mirroredLimbActual.left, mirroredLimbExpected.left, 1e-5), "left limb rendered direction should preserve target-local rotation axis");
  assert.ok(vectorNearlyEqual(mirroredLimbActual.right, mirroredLimbExpected.right, 1e-5), "right limb rendered direction should preserve target-local rotation axis");

  const authoredRotationBone = createNamedBone("head", normalizeQuat([0.3, 0, 0, 0.953939]));
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

  const posedDuringAsyncLoadBone = createNamedBone("leftUpperLeg", quatFromAxisAngle([0, 0, 1], Math.PI / 2));
  const explicitRestClip = createThreeAnimationClip(
    {
      id: "explicit-target-rest",
      duration: 1,
      tracks: [
        {
          humanBone: "leftUpperLeg",
          property: "quaternion",
          sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
          times: toFloat32Array([0, 1]),
          values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0, 0, 1])
        }
      ]
    },
    {
      resolveBone: (bone) => (bone === "leftUpperLeg" ? posedDuringAsyncLoadBone : null),
      targetRestQuaternion: () => [0, 0, 0, 1]
    }
  );
  const explicitRestValues = Array.from(explicitRestClip.tracks[0]!.values as ArrayLike<number>);
  assert.deepEqual(
    explicitRestValues.slice(0, 4),
    [0, 0, 0, 1],
    "explicit target rest should prevent live async-loaded bone poses from being baked into retargeted tracks"
  );

  const look = distributeLookAt([0.4, 0.2, 2]);
  assert.ok(look.head.yaw > 0);
  assert.ok(look.eyes.pitch > 0);
  const behindLook = distributeLookAt([0, 0, -1], { maxYaw: 0.5 });
  assert.equal(behindLook.eyes.yaw, 0.21, "directly behind targets should clamp toward the yaw limit instead of collapsing to center");
  const hostileLook = distributeLookAt([Number.NaN, Infinity, -1], {
    maxYaw: Number.POSITIVE_INFINITY,
    maxPitch: Number.NaN,
    eyeLead: Number.NaN,
    headWeight: Number.POSITIVE_INFINITY,
    neckWeight: Number.NEGATIVE_INFINITY,
    spineWeight: -4,
    torsoWeight: 3
  });
  assert.ok(
    Object.values(hostileLook).every((part) => Number.isFinite(part.yaw) && Number.isFinite(part.pitch) && Number.isFinite(part.weight)),
    "look-at distribution should stay finite when options contain non-finite limits or weights"
  );
  assert.ok(
    Object.values(hostileLook).every((part) => Math.abs(part.yaw) <= 0.85 && Math.abs(part.pitch) <= 0.52),
    "look-at distribution should clamp unsafe option multipliers to bounded corrections"
  );
  const attention = new AttentionScheduler("attention-safety");
  const noPositiveAttention = attention.choose(Number.NaN, [
    { id: "nan", position: [Number.NaN, 0, 0], weight: Number.NaN },
    { id: "zero", position: [0, 0, 1], weight: 0 },
    { id: "infinite", position: [0, 1, 0], weight: Number.POSITIVE_INFINITY },
    { id: "negative", position: [1, 0, 0], weight: -4 }
  ]);
  assert.equal(noPositiveAttention, null, "attention scheduler should return null when no target has a positive finite weight");
  const weightedAttention = new AttentionScheduler("attention-weighted-safety");
  const finiteWeightedAttention = weightedAttention.choose(1_000, [
    { id: "ignored-nan", position: [0, 0, 1], weight: Number.NaN },
    { id: "valid", position: [1, 0, 0], weight: 1 }
  ]);
  assert.equal(finiteWeightedAttention?.id, "valid", "NaN attention weights should not poison weighted selection");
  const invalidPositionAttention = new AttentionScheduler("attention-position-safety");
  const finitePositionAttention = invalidPositionAttention.choose(1_000, [
    { id: "ignored-nan-position", position: [Number.NaN, 0, 1], weight: 100 },
    { id: "ignored-infinite-position", position: [0, Number.POSITIVE_INFINITY, 1], weight: 100 },
    { id: "valid-position", position: [0, 1, 1], weight: 1 }
  ]);
  assert.equal(finitePositionAttention?.id, "valid-position", "invalid attention target positions should be ignored");
  const reorderedDwellAttention = new AttentionScheduler("attention-reorder-dwell");
  assert.equal(
    reorderedDwellAttention.choose(
      100,
      [
        { id: "focus", position: [0, 0, 1], weight: 1 },
        { id: "future", position: [1, 0, 1], weight: 0 }
      ],
      10_000,
      10_000
    )?.id,
    "focus"
  );
  assert.equal(
    reorderedDwellAttention.choose(
      101,
      [
        { id: "future", position: [1, 0, 1], weight: 5 },
        { id: "focus", position: [0, 0, 1], weight: 1 }
      ],
      10_000,
      10_000
    )?.id,
    "focus",
    "attention scheduler should preserve the same target id through reordering before dwell expires"
  );
  const missingDwellAttention = new AttentionScheduler("attention-missing-dwell");
  assert.equal(
    missingDwellAttention.choose(100, [{ id: "initial", position: [0, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
    "initial"
  );
  assert.equal(
    missingDwellAttention.choose(101, [{ id: "replacement", position: [1, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
    "replacement",
    "missing current attention target id should be reselected before dwell expires"
  );
  const disabledDwellAttention = new AttentionScheduler("attention-disabled-dwell");
  assert.equal(
    disabledDwellAttention.choose(100, [{ id: "initial", position: [0, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
    "initial"
  );
  assert.equal(
    disabledDwellAttention.choose(
      101,
      [
        { id: "initial-disabled", position: [0, 0, 1], weight: 0 },
        { id: "replacement", position: [1, 0, 1], weight: 1 }
      ],
      10_000,
      10_000
    )?.id,
    "replacement",
    "disabled current attention target should not be retained until dwell expires"
  );
  const invalidDwellAttention = new AttentionScheduler("attention-invalid-dwell");
  assert.equal(
    invalidDwellAttention.choose(100, [{ id: "initial", position: [0, 0, 1], weight: 1 }], 10_000, 10_000)?.id,
    "initial"
  );
  assert.equal(
    invalidDwellAttention.choose(
      101,
      [
        { id: "initial-invalid", position: [0, Number.NaN, 1], weight: 1 },
        { id: "replacement", position: [1, 0, 1], weight: 1 }
      ],
      10_000,
      10_000
    )?.id,
    "replacement",
    "invalid current attention target should not be retained until dwell expires"
  );
  const deterministicAttentionA = new AttentionScheduler("attention-deterministic");
  const deterministicAttentionB = new AttentionScheduler("attention-deterministic");
  const deterministicTargets: Parameters<AttentionScheduler["choose"]>[1] = [
    { id: "low", position: [0, 0, 1], weight: 1 },
    { id: "high", position: [1, 0, 1], weight: 5 },
    { id: "ignored", position: [0, 1, 1], weight: 0 }
  ];
  assert.equal(
    deterministicAttentionA.choose(500, deterministicTargets)?.id,
    deterministicAttentionB.choose(500, deterministicTargets)?.id,
    "positive-weight attention selection should remain deterministic under a fixed seed"
  );
  const overflowAttention = new AttentionScheduler("attention-overflow");
  assert.equal(
    overflowAttention.choose(
      100,
      [
        { id: "first-huge", position: [0, 0, 1], weight: Number.MAX_VALUE },
        { id: "second-huge", position: [1, 0, 1], weight: Number.MAX_VALUE }
      ],
      1000,
      1000
    )?.id,
    "first-huge",
    "huge finite attention weights should preserve weighted selection instead of overflowing to the last target"
  );
  const finiteDwellAttention = new AttentionScheduler("attention-dwell");
  assert.equal(
    finiteDwellAttention.choose(Number.POSITIVE_INFINITY, [{ id: "finite-dwell", position: [0, 0, 1], weight: 1 }], Number.NaN, Number.POSITIVE_INFINITY)?.id,
    "finite-dwell",
    "non-finite dwell and now inputs should not prevent a finite scheduler choice"
  );
  assert.equal(Number.isFinite(breathingWeight(Number.NaN, 0.5)), true, "breathing weight should ignore non-finite elapsed time");

  const presenceA = new PresencePlanner("presence-test", 0);
  const presenceB = new PresencePlanner("presence-test", 0);
  presenceA.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
  presenceB.onBehaviorChange({ state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 }, { attentiveness: 0.8 }, 100);
  const deterministicPresenceInput: Parameters<PresencePlanner["update"]>[0] = {
    nowMs: 260,
    elapsedSeconds: 1.25,
    deltaSeconds: 1 / 30,
    behavior: { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
    affect: { arousal: 0.45, curiosity: 0.6, attentiveness: 0.8 },
    targetMouth: 0.1,
    clipBaseInfluence: 0.8,
    clipOverlayInfluence: 0.1
  };
  const presenceFrameA = presenceA.update(deterministicPresenceInput);
  const presenceFrameB = presenceB.update(deterministicPresenceInput);
  assert.deepEqual(presenceFrameA.lookAtTarget, presenceFrameB.lookAtTarget);
  assert.ok(presenceFrameA.cueAmounts.glance > 0);
  assert.ok(presenceFrameA.boneTargets.some((target) => target.bone === "head" && target.influence > 0));
  assert.ok(presenceFrameA.boneTargets.every((target) => target.rotation.every(Number.isFinite)));
  const finitePresenceFrame = presenceA.update({
    nowMs: 300,
    elapsedSeconds: Number.NaN,
    deltaSeconds: Number.NaN,
    behavior: { state: "speaking", energy: Number.NaN },
    affect: { arousal: Number.NaN, curiosity: Number.NaN, attentiveness: Number.NaN },
    targetMouth: Number.NaN,
    clipBaseInfluence: Number.NaN,
    clipOverlayInfluence: Number.NaN
  });
  assert.ok(finitePresenceFrame.lookAtTarget.every(Number.isFinite), "presence look target should stay finite for non-finite timing");
  assert.ok(finitePresenceFrame.boneTargets.every((target) => target.rotation.every(Number.isFinite)), "presence bone targets should stay finite for non-finite timing");
  const hostileCuePresence = new PresencePlanner("presence-hostile-cue", Number.NaN);
  hostileCuePresence.scheduleCue("nod", Number.NaN, Number.NaN, Number.NaN, 1);
  const hostileCuePresenceFrame = hostileCuePresence.update({
    nowMs: 0.5,
    elapsedSeconds: Number.NaN,
    deltaSeconds: 1 / 30
  });
  assert.ok(hostileCuePresenceFrame.cueAmounts.nod > 0, "presence cues should sanitize non-finite schedule times instead of being dropped");
  assert.ok(
    Object.values(hostileCuePresenceFrame.cueAmounts).every(Number.isFinite) &&
      hostileCuePresenceFrame.lookAtTarget.every(Number.isFinite) &&
      hostileCuePresenceFrame.boneTargets.every((target) => target.rotation.every(Number.isFinite)),
    "presence planning should stay finite after hostile cue timing"
  );
  const hostileSpeechPresence = new PresencePlanner("presence-hostile-speech");
  hostileSpeechPresence.scheduleSpeechPerformance("hello world", Number.NaN, Number.NaN);
  const hostileSpeechPresenceFrame = hostileSpeechPresence.update({
    nowMs: 0.5,
    elapsedSeconds: 0,
    deltaSeconds: 1 / 30
  });
  assert.ok(
    Object.values(hostileSpeechPresenceFrame.cueAmounts).every(Number.isFinite),
    "speech performance scheduling should sanitize non-finite duration and start times"
  );

  const aim = solveAimIk({
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.equal(aim.reached, true);
  assert.ok(aim.alignmentError < 1e-5, "aim IK should align the offsetted forward axis to the target");
  assert.ok(Math.hypot(aim.correctedForward[0], aim.correctedForward[1] - 1, aim.correctedForward[2]) < 1e-5, "aim IK should rotate the model forward axis toward the target");
  assert.ok(Math.hypot(aim.correctedUp[0], aim.correctedUp[1], aim.correctedUp[2] - 1) < 1e-5, "aim IK should keep model up aligned to the projected pole");
  assert.ok(Math.abs(Math.hypot(...aim.jointCorrection) - 1) < 1e-5);

  const partialAim = solveAimIk({
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1],
    weight: 0.5
  });
  assert.ok(partialAim.alignmentError > 0.01 && partialAim.alignmentError < Math.PI / 2, "partial aim IK weight should leave a deterministic residual angle");
  assert.ok(dotVec3(partialAim.correctedForward, [0, 1, 0]) > 0.25, "partial aim IK should still rotate toward the target");

  const rotatedJointAim = solveAimIk({
    jointRotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2),
    target: [0, 2, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  assert.ok(rotatedJointAim.alignmentError < 1e-5, "aim IK should accept joint rotation as the model-space orientation input");
  assert.ok(Math.hypot(...rotatedJointAim.jointCorrection.slice(0, 3)) < 1e-5, "already aligned rotated joints should produce an identity correction");
  assert.ok(vectorNearlyEqual(rotatedJointAim.correctedForward, [0, 1, 0], 1e-5), "aim IK correctedForward should be reported in model space");

  const rotatedJointCorrection = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const rotatedJointNeedsCorrectionAim = solveAimIk({
    jointRotation: rotatedJointCorrection,
    target: [0, 1, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  const rotatedCorrectedModelRotation = multiplyQuat(rotatedJointNeedsCorrectionAim.jointCorrection, rotatedJointCorrection);
  const rotatedCorrectedForward = normalizeVec3(rotateVec3ByQuat(rotatedCorrectedModelRotation, [1, 0, 0]), [1, 0, 0]);
  const rotatedCorrectedUp = normalizeVec3(rotateVec3ByQuat(rotatedCorrectedModelRotation, [0, 1, 0]), [0, 1, 0]);
  assert.ok(rotatedJointNeedsCorrectionAim.alignmentError < 1e-5, "rotated aim IK should align the model-space correction to the target");
  assert.ok(vectorNearlyEqual(rotatedCorrectedForward, [0, 1, 0], 1e-5), "aim IK jointCorrection should pre-multiply the model joint rotation");
  assert.ok(vectorNearlyEqual(rotatedJointNeedsCorrectionAim.correctedForward, rotatedCorrectedForward, 1e-5), "correctedForward should match the documented model-space application order");
  assert.ok(vectorNearlyEqual(rotatedJointNeedsCorrectionAim.correctedUp, rotatedCorrectedUp, 1e-5), "correctedUp should match the documented model-space application order");
  assert.ok(vectorNearlyEqual(rotatedJointNeedsCorrectionAim.targetDirection, [0, 1, 0], 1e-5), "targetDirection should be reported in model space");

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
  assert.ok(vectorNearlyEqual(matrixCorrectedForward, [0, 1, 0], 1e-5), "matrix aim IK correction should pre-multiply the model joint rotation");

  const directionAim = solveAimIk({
    targetDirection: [0, 0, 1],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 1, 0]
  });
  assert.ok(directionAim.alignmentError < 1e-5, "aim IK should accept a model-space target direction without a target point");
  assert.ok(Math.hypot(directionAim.correctedForward[0], directionAim.correctedForward[1], directionAim.correctedForward[2] - 1) < 1e-5);

  const poleOnlyAim = solveAimIk({
    target: [2, 0, 0],
    forward: [1, 0, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.ok(poleOnlyAim.alignmentError < 1e-5);
  assert.ok(Math.hypot(poleOnlyAim.correctedForward[0] - 1, poleOnlyAim.correctedForward[1], poleOnlyAim.correctedForward[2]) < 1e-5, "aim IK pole correction must not disturb an already aligned forward axis");
  assert.ok(Math.hypot(poleOnlyAim.correctedUp[0], poleOnlyAim.correctedUp[1], poleOnlyAim.correctedUp[2] - 1) < 1e-5);

  const opposedAim = solveAimIk({ target: [-1, 0, 0], forward: [1, 0, 0], up: [0, 1, 0], pole: [0, 1, 0] });
  assert.equal(opposedAim.reached, true);
  assert.ok(opposedAim.jointCorrection.every(Number.isFinite), "opposed aim targets should produce a finite 180-degree correction");
  assert.ok(Math.hypot(opposedAim.correctedForward[0] + 1, opposedAim.correctedForward[1], opposedAim.correctedForward[2]) < 1e-5);

  const offsetUnreachableAim = solveAimIk({
    target: [1, 0, 0],
    forward: [1, 0, 0],
    offset: [0, 2, 0],
    up: [0, 1, 0],
    pole: [0, 0, 1]
  });
  assert.equal(offsetUnreachableAim.reached, false, "aim IK should report offset targets outside the target sphere as unreachable");
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
  assert.ok(zeroAxisAim.jointCorrection.every(Number.isFinite), "aim IK should use stable fallbacks for zero-length axes");
  assert.ok(zeroAxisAim.correctedForward.every(Number.isFinite) && zeroAxisAim.correctedUp.every(Number.isFinite));

  const ik = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
  assert.ok(ik.targetReach > 0.9);
  assert.ok(Number.isFinite(ik.joint[0]));
  const finiteIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0, -1.5, 0], pole: [0, 0, 1], maxStretch: Number.NaN });
  assert.ok(finiteIk.joint.every(Number.isFinite), "IK should keep solved joints finite for non-finite stretch limits");
  const nonFiniteInputIk = solveTwoBoneIk({
    root: [Number.NaN, 0, 0],
    joint: [0, Number.NaN, 0],
    end: [0, -2, Number.POSITIVE_INFINITY],
    target: [0, -1.5, Number.NaN],
    pole: [Number.NaN, Number.NaN, Number.NaN],
    maxStretch: Number.NaN
  });
  assert.ok(nonFiniteInputIk.joint.every(Number.isFinite) && nonFiniteInputIk.end.every(Number.isFinite), "IK should repair non-finite chain and target inputs");
  assert.ok(Number.isFinite(nonFiniteInputIk.solvedReach), "IK reach reporting should stay finite for repaired non-finite inputs");
  const minimumReachIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -1.5, 0], target: [0, -0.5, 0], pole: [0, 0, 1], maxStretch: 1 });
  assert.equal(minimumReachIk.clamped, false, "exact minimum-reach targets should not be treated as clamped");
  assert.ok(minimumReachIk.solvedReach <= 1.000001, "minimum-reach solves must not report more than full target reach");
  assert.ok(Math.hypot(minimumReachIk.end[0], minimumReachIk.end[1] + 0.5, minimumReachIk.end[2]) < 1e-6, "minimum-reach solves should keep the endpoint on the target");
  const diagonalIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [1, -1, 0], pole: [0, 0, 1], soften: 0 });
  assert.ok(
    Math.abs(Math.hypot(...diagonalIk.joint) - 1) < 1e-5,
    "IK projection should keep the solved joint on the upper-bone sphere for diagonal targets"
  );

  const fullReachIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0, -2, 0], pole: [0, 0, 1] });
  assert.equal(fullReachIk.clamped, false, "default IK softening must not report a physical reach clamp at full extension");
  assert.ok(Math.abs(fullReachIk.targetReach - 1) < 1e-5, "physically reachable targets should report full target reach");
  assert.ok(fullReachIk.solvedReach < 1, "default IK softening may still keep the solved endpoint short of full extension");
  assert.equal(fullReachIk.stretchLimited, true);
  const unsoftenedFullReachIk = solveTwoBoneIk({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0, -2, 0], pole: [0, 0, 1], soften: 1 });
  assert.ok(Math.abs(unsoftenedFullReachIk.solvedReach - 1) < 1e-5, "soften=1 should leave a reachable full-extension target unshortened");

  const stretchLimitedIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, 0, 1],
    maxStretch: 0.5
  });
  assert.equal(stretchLimitedIk.clamped, false, "explicit stretch limits should not be mislabeled as physical reach clamps");
  assert.equal(stretchLimitedIk.stretchLimited, true);
  assert.ok(stretchLimitedIk.solvedReach < 0.7, "explicit stretch limit should still shorten the solved endpoint");
  assert.ok(Math.abs(stretchLimitedIk.targetReach - 1) < 1e-5);

  const ikCorrections = solveTwoBoneIkCorrections({ root: [0, 0, 0], joint: [0, -1, 0], end: [0, -2, 0], target: [0.5, -1.5, 0], pole: [0, 0, 1] });
  const correctedUpper = rotateVec3ByQuat(ikCorrections.rootCorrection, [0, -1, 0]);
  assert.ok(Math.hypot(correctedUpper[0] - ikCorrections.correctedUpperDirection[0], correctedUpper[1] - ikCorrections.correctedUpperDirection[1], correctedUpper[2] - ikCorrections.correctedUpperDirection[2]) < 1e-5);
  assert.ok(Math.abs(Math.hypot(...ikCorrections.rootCorrection) - 1) < 1e-5);
  assert.ok(Math.abs(Math.hypot(...ikCorrections.jointCorrection) - 1) < 1e-5);

  const nonOrthogonalPoleIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, -1, 1]
  });
  assert.ok(Math.abs(Math.hypot(...nonOrthogonalPoleIk.joint) - 1) < 1e-5, "IK bend pole must not change the upper bone length");
  const twistedPoleIk = solveTwoBoneIk({
    root: [0, 0, 0],
    joint: [0, -1, 0],
    end: [0, -2, 0],
    target: [0, -1.5, 0],
    pole: [0, 0, 1],
    twistAngle: Math.PI / 2,
    soften: 1
  });
  assert.ok(Math.abs(Math.abs(twistedPoleIk.joint[0]) - Math.hypot(twistedPoleIk.joint[0], twistedPoleIk.joint[2])) < 1e-5, "two-bone IK twist should rotate the bend plane around the target axis");
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
    { name: "knee", parentName: "hip", rest: { translation: [0, -1, 0], rotation: quatFromAxisAngle([0, 1, 0], -0.15) } },
    { name: "ankle", parentName: "knee", rest: { translation: [0, -1, 0] } },
    { name: "toe", parentName: "ankle", rest: { translation: [0, -0.25, 0] } }
  ]);
  const ikApplicationPose = clonePose(ikApplicationSkeleton.restPose);
  const ikApplicationModels = localToModelPose(ikApplicationSkeleton, ikApplicationPose);
  const initialAnklePosition = modelPosition(ikApplicationModels[3]!);
  const ikApplicationTarget: [number, number, number] = [initialAnklePosition[0] + 0.24, initialAnklePosition[1] + 0.18, initialAnklePosition[2] + 0.16];
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
    quaternionNearlyEqual(modelCorrectionToLocalPostCorrection(ikApplicationModels[1]!, matrixIk.rootModelCorrection), matrixIk.rootLocalCorrection, 1e-5),
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
  assert.ok(vectorNearlyEqual(modelPosition(appliedIkModels[3]!), matrixIk.end, 1e-4), "local two-bone corrections should place the ankle at the solved model-space endpoint");

  const wrongIkPose = clonePose(ikApplicationPose);
  wrongIkPose[1] = { ...wrongIkPose[1]!, rotation: multiplyQuat(wrongIkPose[1]!.rotation, matrixIk.rootModelCorrection) };
  wrongIkPose[2] = { ...wrongIkPose[2]!, rotation: multiplyQuat(wrongIkPose[2]!.rotation, matrixIk.midModelCorrection) };
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
  assert.ok(vectorNearlyEqual(modelPosition(partialIkModels[3]!), modelPosition(fullyUpdatedIkModels[3]!), 1e-5), "range update should include the requested end joint");
  assert.ok(distance3(staleToePosition, modelPosition(fullyUpdatedIkModels[4]!)) > 1e-4, "range-limited updates should leave later descendants untouched");
  updateLocalToModelPoseRange(ikApplicationSkeleton, partialIkPose, partialIkModels, { from: 3, fromExcluded: true });
  assert.ok(vectorNearlyEqual(modelPosition(partialIkModels[4]!), modelPosition(fullyUpdatedIkModels[4]!), 1e-5), "fromExcluded range update should refresh descendants from an existing model matrix");

  const aimApplicationSkeleton = createSkeleton([
    { name: "root", rest: { translation: [0.4, -0.2, 0.1], rotation: quatFromAxisAngle([0, 0, 1], -Math.PI / 6) } },
    { name: "neck", parentName: "root", rest: { translation: [0, 1, 0], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 4) } },
    { name: "head", parentName: "neck", rest: { translation: [0.25, 0, 0], rotation: quatFromAxisAngle([1, 0, 0], -0.2) } }
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
  const expectedHeadAimLocalCorrection = modelCorrectionToLocalPostCorrection(headModelBeforeAim, headAim.jointCorrection);
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
  assert.ok(dotVec3(matrixDirection(aimApplicationModels[2]!, [1, 0, 0]), appliedHeadTargetDirection) > 0.999, "aim application should preserve solveAimIk model-space semantics when writing back to local pose");

  const aimChainPose = clonePose(aimApplicationSkeleton.restPose);
  const aimChainModels = localToModelPose(aimApplicationSkeleton, aimChainPose);
  const aimChain = applyAimIkChainToPose({
    skeleton: aimApplicationSkeleton,
    localPose: aimChainPose,
    modelPose: aimChainModels,
    joints: [{ joint: 1, weight: 0.35 }, { joint: 2, weight: 1 }],
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
  assert.ok(aimChain.corrections.every((correction) => correction.localCorrection.every(Number.isFinite)), "aim chain corrections should stay finite");
  assert.ok(dotVec3(matrixDirection(aimChainModels[2]!, [1, 0, 0]), aimChainTargetDirection) > 0.999, "aim chain helper should solve and apply corrections in deterministic model/local spaces");

  const humanoidLookAtSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips" },
    { name: "spine", parentName: "hips", humanoid: "spine" },
    { name: "neck", parentName: "spine", humanoid: "neck" },
    { name: "head", parentName: "neck", humanoid: "head" }
  ]);
  const humanoidLookAtChain = createHumanoidLookAtAimChain(humanoidLookAtSkeleton, { bones: ["head", "neck", "spine"], jointWeight: 0.5, guaranteeLast: true });
  assert.deepEqual(
    humanoidLookAtChain.map((joint) => joint.joint),
    [3, 2, 1],
    "humanoid look-at policy should choose an available child-to-parent aim chain from skeleton metadata"
  );
  assert.equal(humanoidLookAtChain[2]!.weight, 1, "humanoid look-at policy can force the parent-most joint to full weight like the Ozz sample");
  const propagatedAimPose = clonePose(aimApplicationSkeleton.restPose);
  const propagatedAimModels = localToModelPose(aimApplicationSkeleton, propagatedAimPose);
  const propagatedAim = applyAimIkChildToParentChainToPose({
    skeleton: aimApplicationSkeleton,
    localPose: propagatedAimPose,
    modelPose: propagatedAimModels,
    joints: [{ joint: 2, weight: 0.45, offset: [0.05, 0, 0] }, { joint: 1, weight: 1 }],
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
  assert.equal(propagatedAim.updatedFrom, 1, "child-to-parent aim propagation should refresh the parent-most edited joint range once");
  assert.ok(propagatedAim.corrections.every((correction) => correction.localCorrection.every(Number.isFinite)), "child-to-parent propagated aim corrections should stay finite");
  assert.ok(dotVec3(matrixDirection(propagatedAimModels[2]!, [1, 0, 0]), propagatedTargetDirection) > 0.95, "child-to-parent aim propagation should keep the child joint directed toward the target");

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
    [{ id: "left", hip: [0, 0, 0], knee: [0, -1, 0], ankle: [0, -1.9, 0], ground: { point: [0, -2.08, 0], normal: [0, 1, 0] } }],
    { footHeight: 0.08, maxAnkleCorrection: 0.5 }
  );
  assert.equal(fullReachFootPlant.legs[0]!.ik?.clamped, false);
  assert.equal(fullReachFootPlant.legs[0]!.ik?.stretchLimited, true);
  assert.ok(!fullReachFootPlant.issues.includes("left: ik target reach clamped"), "default IK softening must not emit foot-plant reach clamp issues");

  const missingGroundPlant = solveFootPlant([{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.1, 0] }]);
  assert.equal(missingGroundPlant.plantedCount, 0);
  assert.equal(missingGroundPlant.legs[0]!.skippedReason, "missing-ground-contact");

  const clampedFootPlant = solveFootPlant(
    [{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.4, 0], ground: { point: [0, -1, 0], normal: [0, 1, 0] } }],
    { footHeight: 0.08, maxAnkleCorrection: 0.1 }
  );
  assert.equal(clampedFootPlant.legs[0]!.clamped, true);
  assert.ok(clampedFootPlant.legs[0]!.correctionDistance <= 0.1001);
  const zeroMaxAnkleCorrectionPlant = solveFootPlant(
    [{ id: "left", hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0.2, 0], ground: { point: [0, 0, 0], normal: [0, 1, 0] } }],
    { footHeight: 0.08, maxAnkleCorrection: 0 }
  );
  assert.equal(zeroMaxAnkleCorrectionPlant.legs[0]!.clamped, true, "zero max ankle correction should clamp any non-zero correction");
  assert.equal(zeroMaxAnkleCorrectionPlant.legs[0]!.correctionDistance, 0, "zero max ankle correction should leave the ankle target unchanged");
  assert.deepEqual(zeroMaxAnkleCorrectionPlant.pelvisOffset, [0, 0, 0]);
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
  assert.ok(boundaryReachPlant.pelvisOffset[1] < -0.999, "reach compensation should handle targets exactly on the horizontal reach boundary");
  assert.equal(boundaryReachPlant.legs[0]!.ik?.stretchLimited, false, "boundary reach compensation should avoid an artificial stretch-limited solve");
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
  assert.ok(finiteFootPlant.pelvisOffset.every(Number.isFinite), "foot plant pelvis offset should stay finite for non-finite options");
  assert.ok(finiteFootPlant.legs.every((leg) => leg.targetAnkle.every(Number.isFinite) && (leg.ik?.joint.every(Number.isFinite) ?? true)), "foot plant leg outputs should stay finite for non-finite options");
  const invalidInputFootPlant = solveFootPlant(
    [
      {
        id: "left",
        hip: [Number.NaN, 1, 0],
        knee: [0, Number.NaN, 0],
        ankle: [0, 0.1, Number.NaN],
        ground: { point: [Number.NaN, 0, 0], normal: [Number.NaN, Number.NaN, Number.NaN], rayStart: [0, Number.NaN, 0] }
      }
    ],
    { footHeight: 0.08, maxAnkleCorrection: 0.5, maxPelvisOffset: 0.5, maxStretch: 1 }
  );
  assert.ok(invalidInputFootPlant.pelvisOffset.every(Number.isFinite), "foot plant should repair non-finite pelvis input data");
  assert.ok(
    invalidInputFootPlant.legs.every((leg) => leg.initialAnkle.every(Number.isFinite) && leg.targetAnkle.every(Number.isFinite) && (leg.ik?.end.every(Number.isFinite) ?? true)),
    "foot plant should keep leg outputs finite for non-finite contact inputs"
  );

  const ozzFootIkSkeleton = createSkeleton([
    { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "leftUpperLeg", parentName: "hips", humanoid: "leftUpperLeg", rest: { translation: [-0.12, -0.05, 0] } },
    { name: "leftLowerLeg", parentName: "leftUpperLeg", humanoid: "leftLowerLeg", rest: { translation: [0, -0.46, 0.02] } },
    { name: "leftFoot", parentName: "leftLowerLeg", humanoid: "leftFoot", rest: { translation: [0, -0.42, -0.02] } },
    { name: "rightUpperLeg", parentName: "hips", humanoid: "rightUpperLeg", rest: { translation: [0.12, -0.05, 0] } },
    { name: "rightLowerLeg", parentName: "rightUpperLeg", humanoid: "rightLowerLeg", rest: { translation: [0, -0.46, 0.02] } },
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
  assert.equal(ozzFootIk.plantedCount, 2, "Ozz-style foot IK wrapper should resolve default humanoid legs and floor contacts");
  assert.deepEqual(
    ozzFootIk.legs.map((leg) => [leg.id, leg.hipJoint, leg.kneeJoint, leg.ankleJoint]),
    [["left", 1, 2, 3], ["right", 4, 5, 6]],
    "Ozz-style foot IK wrapper should expose resolved leg joint indices"
  );
  assert.ok(ozzFootIkRays.every((ray) => ray.start[1] > ray.ankle[1]), "Ozz-style foot IK wrapper should cast down from above each ankle by default");
  assert.ok(ozzFootIk.legs.every((leg) => leg.ankleAim?.jointCorrection.every(Number.isFinite)), "Ozz-style foot IK wrapper should include finite ankle aim corrections for planted feet");
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
  assert.equal(suppressedContactOzzFootIk.plantedCount, 0, "explicit empty Ozz foot IK contacts should suppress fallback floor hits");
  assert.deepEqual(suppressedContactRays, [], "explicit null/undefined Ozz foot IK contacts should not fall through to raycasts");
  const missingOzzFootIk = solveOzzFootIk({
    skeleton: ozzFootIkSkeleton,
    modelPose: ozzFootIkModels,
    legs: [{ id: "custom", hip: "missing", knee: "leftLowerLeg", ankle: "leftFoot" }]
  });
  assert.equal(missingOzzFootIk.plantedCount, 0);
  assert.ok(missingOzzFootIk.issues.some((issue) => issue === "custom: missing leg joints"), "Ozz-style foot IK wrapper should report unresolved explicit leg presets");

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
        hip: ikOnlyHip.getWorldPosition(new Vector3()).toArray() as [number, number, number],
        knee: ikOnlyKnee.getWorldPosition(new Vector3()).toArray() as [number, number, number],
        ankle: ikOnlyInitialAnkle.toArray() as [number, number, number],
        ground: { point: [0, -0.2, 0], normal: [0, 1, 0], rayStart: [0, 1, 0] },
        footHeight: 0,
        maxAnkleCorrection: 2,
        maxStretch: 1
      }
    ],
    { footHeight: 0, maxAnkleCorrection: 2, maxPelvisOffset: 1, pelvisCompensation: 1, maxStretch: 1 }
  );
  assert.ok(ikOnlyPlant.pelvisOffset[1] < -0.19, "IK-only foot plant fixture should normally assign the correction to pelvis motion");
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
  assert.equal(ikOnlyApply.pelvisApplied, false, "IK-only foot plant application should respect disabled pelvis motion");
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
  assert.equal(fallbackSpeedFootPlant.pelvisApplied, true, "Three foot plant application should fall back from non-finite speeds");
  assert.ok(fallbackSpeedFootPlant.pelvisOffsetLocal.every(Number.isFinite), "Three foot plant fallback offsets should remain finite");
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
  assert.equal(nonFiniteDeltaFootPlant.pelvisApplied, false, "Three foot plant damping should treat non-finite delta time as zero elapsed time");
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
  assert.ok(Math.abs(scaledFootPlantApply.pelvisOffsetLocal[1] + 0.5) < 1e-6, "world pelvis offsets should be converted through parent scale");
  assert.ok(Math.abs(scaledPelvisAfter.y - scaledPelvisBefore.y + 1) < 1e-6, "scaled parent transforms should not amplify world pelvis offsets");

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
        hip: anchoredReachHip.getWorldPosition(new Vector3()).toArray() as [number, number, number],
        knee: anchoredReachKnee.getWorldPosition(new Vector3()).toArray() as [number, number, number],
        ankle: anchoredReachCurrentAnkle.toArray() as [number, number, number],
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
  assert.ok(anchoredReachPlant.pelvisOffset[1] < -0.005, "foot plant should lower the pelvis when a planted ankle would otherwise overreach");
  assert.ok(Math.abs(anchoredReachPlant.pelvisOffset[1]) <= 0.0801, "reach compensation should respect the configured pelvis limit");
  assert.equal(anchoredReachPlant.legs[0]!.ik?.clamped, false, "pelvis reach compensation should keep the anchored ankle reachable");
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

  const visemes = new VisemeMixer({ maxTotal: 0.4 });
  visemes.setTarget({ aa: 0.4, ou: 0.4 });
  const mixed = visemes.update(1 / 30);
  assert.ok(mixed.aa + mixed.ou <= 0.4001);
  assert.deepEqual(limitVisemeStack({ aa: 0.2, ih: 0.2, ou: 0.2, ee: 0.2, oh: 0.2 }, Number.NaN), zeroVisemes());
  const hostileLimitedVisemes = limitVisemeStack({ aa: Number.NaN, ih: -1, ou: 2, ee: 0.5, oh: Number.POSITIVE_INFINITY }, 1);
  assert.ok(
    Object.values(hostileLimitedVisemes).every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
    "limitVisemeStack should sanitize hostile viseme weights before normalization"
  );
  assert.ok(
    Object.values(hostileLimitedVisemes).reduce((sum, value) => sum + value, 0) <= 1.000001,
    "limitVisemeStack should keep sanitized hostile viseme totals under the requested maximum"
  );
  const invalidVisemes = new VisemeMixer({ maxTotal: Number.NaN });
  invalidVisemes.setTarget({ aa: 1, ih: 1 });
  assert.ok(Object.values(invalidVisemes.update(Number.NaN)).every(Number.isFinite), "viseme mixer should keep weights finite for non-finite timing and limits");
  const invalidIntensityVisemes = new VisemeMixer({ intensity: Number.NaN });
  invalidIntensityVisemes.setTarget({ aa: 1 });
  assert.ok(Object.values(invalidIntensityVisemes.update(1 / 30)).every(Number.isFinite), "viseme mixer should keep weights finite for non-finite intensity");

  const partialAttackVisemes = new VisemeMixer({ attack: { aa: 60 }, release: 20, maxTotal: 1 });
  partialAttackVisemes.setTarget({ aa: 0.5, ih: 0.5 });
  const partialAttackMixed = partialAttackVisemes.update(1 / 30);
  assert.ok(partialAttackMixed.ih > 0, "partial viseme attack maps should fall back for unspecified visemes");
  assert.ok(Math.abs(partialAttackMixed.aa - 0.5 * dampAlpha(60, 1 / 30)) < 1e-6, "partial viseme attack maps should respect specified speeds");
  assert.ok(Math.abs(partialAttackMixed.ih - 0.5 * dampAlpha(30, 1 / 30)) < 1e-6, "partial viseme attack maps should use the default attack speed");

  const partialReleaseVisemes = new VisemeMixer({ attack: 30, release: { aa: 40 }, maxTotal: 1 });
  partialReleaseVisemes.setTarget({ aa: 0.5, ih: 0.5 });
  partialReleaseVisemes.update(1 / 30);
  partialReleaseVisemes.setTarget({});
  const beforePartialRelease = { ...partialReleaseVisemes.current };
  const partialReleaseMixed = partialReleaseVisemes.update(1 / 30);
  assert.ok(partialReleaseMixed.ih < beforePartialRelease.ih, "partial viseme release maps should fall back for unspecified visemes");
  assert.ok(Math.abs(partialReleaseMixed.aa - beforePartialRelease.aa * (1 - dampAlpha(40, 1 / 30))) < 1e-6, "partial viseme release maps should respect specified speeds");
  assert.ok(Math.abs(partialReleaseMixed.ih - beforePartialRelease.ih * (1 - dampAlpha(20, 1 / 30))) < 1e-6, "partial viseme release maps should use the default release speed");
  const malformedSpeedVisemes = new VisemeMixer({ attack: { aa: Number.NaN }, release: { aa: Number.NaN }, maxTotal: 1 });
  malformedSpeedVisemes.setTarget({ aa: 0.5 });
  const malformedSpeedAttack = malformedSpeedVisemes.update(1 / 30);
  assert.ok(
    Math.abs(malformedSpeedAttack.aa - 0.5 * dampAlpha(30, 1 / 30)) < 1e-6,
    "malformed viseme attack speeds should fall back instead of freezing the channel"
  );
  malformedSpeedVisemes.setTarget({});
  const beforeMalformedSpeedRelease = { ...malformedSpeedVisemes.current };
  const malformedSpeedRelease = malformedSpeedVisemes.update(1 / 30);
  assert.ok(
    Math.abs(malformedSpeedRelease.aa - beforeMalformedSpeedRelease.aa * (1 - dampAlpha(20, 1 / 30))) < 1e-6,
    "malformed viseme release speeds should fall back instead of freezing the channel"
  );
  const hostileComposedExpressions = composeFacialExpressions({
    visemes: { aa: Number.NaN, ih: -0.5, ou: 2, ee: 0.4, oh: Number.POSITIVE_INFINITY },
    blink: Number.NaN,
    energy: Number.POSITIVE_INFINITY,
    rapport: Number.NEGATIVE_INFINITY,
    cueSmile: Number.NaN
  });
  const facialScalarNames = ["aa", "ih", "ou", "ee", "oh", "blink"];
  assert.ok(
    facialScalarNames.every((name) => {
      const value = hostileComposedExpressions[name]!;
      return Number.isFinite(value) && value >= 0 && value <= 1;
    }),
    "composeFacialExpressions should clamp direct viseme/blink inputs to finite morph weights"
  );

  const blink = new BlinkScheduler("test", 0);
  assert.equal(Number.isFinite(blink.update(16, 1 / 60, 0.5)), true);
  blink.trigger(32, 100);
  assert.equal(blink.update(48, 1 / 60, 0.5), 1);
  assert.equal(Number.isFinite(blink.update(200, Number.NaN, 0.5)), true, "blink scheduler should ignore non-finite delta time");
  assert.equal(blink.update(216, Number.NaN, 0.5), blink.update(216, Number.NaN, 0.5), "blink scheduler should keep non-finite delta decay deterministic");
  const hostileBlink = new BlinkScheduler("hostile-blink", Number.NaN);
  hostileBlink.trigger(Number.NaN, Number.NaN);
  assert.equal(hostileBlink.update(0, 1 / 60, 0.5), 1, "blink triggers should sanitize non-finite hold timing");
  assert.ok(
    Number.isFinite(hostileBlink.state.nextAtMs) && Number.isFinite(hostileBlink.state.holdUntilMs),
    "blink scheduler should keep timing state finite after hostile trigger inputs"
  );

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
  assert.ok((faceState.expressions.happy ?? 0) > 0.1);
  const malformedSpeedFacial = new FacialExpressionMixer({ mouthAttack: Number.NaN, mouthRelease: Number.NaN });
  malformedSpeedFacial.setTarget({ targetMouth: 1 });
  const malformedMouthAttackState = malformedSpeedFacial.update(1 / 30, { talking: true });
  assert.ok(
    Math.abs(malformedMouthAttackState.mouthLevel - dampAlpha(28, 1 / 30)) < 1e-6,
    "malformed mouth attack speeds should fall back instead of freezing mouth motion"
  );
  const beforeMalformedMouthRelease = malformedSpeedFacial.mouthLevel;
  const malformedMouthReleaseState = malformedSpeedFacial.update(1 / 30, { talking: false });
  assert.ok(
    Math.abs(malformedMouthReleaseState.mouthLevel - beforeMalformedMouthRelease * (1 - dampAlpha(18, 1 / 30))) < 1e-6,
    "malformed mouth release speeds should fall back instead of freezing mouth motion"
  );

  const metric = poseRotationMetric(skeleton.restPose, evaluated.localPose);
  assert.ok(metric.maxRotationDelta > 0);
  const signEquivalentPose = clonePose(skeleton.restPose);
  signEquivalentPose[2]!.rotation = signEquivalentPose[2]!.rotation.map((component) => -component) as [number, number, number, number];
  assert.equal(
    poseRotationMetric(skeleton.restPose, signEquivalentPose).maxRotationDelta,
    0,
    "pose rotation metrics should treat sign-opposite quaternions as equivalent rotations"
  );
  const nonUnitRotationPose = clonePose(skeleton.restPose);
  nonUnitRotationPose[2]!.rotation = [0, 2, 0, 2];
  const nonUnitRotationMetric = poseRotationMetric(skeleton.restPose, nonUnitRotationPose);
  assert.ok(
    nonUnitRotationMetric.maxRotationDelta > 1.56 && nonUnitRotationMetric.maxRotationDelta < 1.58,
    "pose rotation metrics should normalize finite non-unit quaternions before measuring angular error"
  );
  const invalidRotationMetricPose = clonePose(nonUnitRotationPose);
  invalidRotationMetricPose[1]!.rotation = [Number.NaN, 0, 0, 1];
  invalidRotationMetricPose[3]!.rotation = [0, 0, 0, 0];
  const invalidRotationMetric = poseRotationMetric(skeleton.restPose, invalidRotationMetricPose);
  assert.equal(Number.isFinite(invalidRotationMetric.rmsRotationDelta), true, "pose rotation RMS should stay finite for invalid quaternions");
  assert.equal(Number.isFinite(invalidRotationMetric.maxRotationDelta), true, "pose rotation max should stay finite for invalid quaternions");
  assert.equal(invalidRotationMetric.invalidSamples, 2, "pose rotation metrics should count skipped invalid quaternion samples");
  assert.ok(
    invalidRotationMetric.maxRotationDelta > 1.56 && invalidRotationMetric.maxRotationDelta < 1.58,
    "pose rotation metrics should keep valid finite quaternion samples when invalid samples are skipped"
  );
  const poseDeltaA = clonePose(skeleton.restPose);
  const poseDeltaB = clonePose(skeleton.restPose);
  poseDeltaB[1]!.translation = [0, 2, 0];
  poseDeltaB[3]!.scale = [1, 3, 1];
  poseDeltaB[2]!.rotation = poseDeltaB[2]!.rotation.map((component) => -component) as [number, number, number, number];
  const poseDelta = poseDeltaMetric(poseDeltaA, poseDeltaB, skeleton);
  assert.equal(poseDelta.samples, skeleton.restPose.length);
  assert.equal(poseDelta.rotation.max, 0, "pose delta metrics should preserve sign-equivalent quaternion behavior");
  assert.equal(poseDelta.translation.max, 2);
  assert.equal(poseDelta.translation.maxIndex, 1);
  assert.equal(poseDelta.translation.maxJoint, "spine");
  assert.equal(poseDelta.scale.max, 2);
  assert.equal(poseDelta.scale.maxIndex, 3);
  assert.equal(poseDelta.scale.maxJoint, "leftUpperArm");
  assert.ok(Math.abs(poseDelta.translation.rms - 1) < 1e-12);
  assert.ok(Math.abs(poseDelta.scale.rms - 1) < 1e-12);
  const nonUnitPoseDelta = poseDeltaMetric(skeleton.restPose, nonUnitRotationPose, skeleton);
  assert.ok(
    nonUnitPoseDelta.rotation.max > 1.56 && nonUnitPoseDelta.rotation.max < 1.58,
    "pose delta metrics should not report zero rotation error for finite non-unit quaternions"
  );
  assert.equal(nonUnitPoseDelta.rotation.maxJoint, "head");
  const invalidPoseDeltaA = clonePose(skeleton.restPose);
  const invalidPoseDeltaB = clonePose(skeleton.restPose);
  invalidPoseDeltaA[0]!.translation = [Number.NaN, 0, 0];
  invalidPoseDeltaB[1]!.translation = [0, Number.POSITIVE_INFINITY, 0];
  invalidPoseDeltaB[2]!.translation = [0, 3, 0];
  invalidPoseDeltaA[0]!.scale = [1, Number.NEGATIVE_INFINITY, 1];
  invalidPoseDeltaB[1]!.scale = [1, Number.NaN, 1];
  invalidPoseDeltaB[3]!.scale = [1, 4, 1];
  invalidPoseDeltaA[1]!.rotation = [Number.NaN, 0, 0, 1];
  invalidPoseDeltaB[2]!.rotation = [0, 0, Number.POSITIVE_INFINITY, 1];
  invalidPoseDeltaB[3]!.rotation = [0, 2, 0, 2];
  const invalidPoseDelta = poseDeltaMetric(invalidPoseDeltaA, invalidPoseDeltaB, skeleton);
  assert.equal(invalidPoseDelta.samples, skeleton.restPose.length);
  assert.equal(invalidPoseDelta.translation.invalidSamples, 2, "pose delta metrics should count skipped invalid translation samples");
  assert.equal(invalidPoseDelta.scale.invalidSamples, 2, "pose delta metrics should count skipped invalid scale samples");
  assert.equal(invalidPoseDelta.rotation.invalidSamples, 2, "pose delta metrics should count skipped invalid rotation samples");
  assert.equal(Number.isFinite(invalidPoseDelta.translation.rms), true, "translation RMS should stay finite for invalid samples");
  assert.equal(Number.isFinite(invalidPoseDelta.scale.rms), true, "scale RMS should stay finite for invalid samples");
  assert.equal(Number.isFinite(invalidPoseDelta.rotation.rms), true, "rotation RMS should stay finite for invalid samples");
  assert.equal(invalidPoseDelta.translation.max, 3);
  assert.equal(invalidPoseDelta.translation.maxJoint, "head");
  assert.equal(invalidPoseDelta.scale.max, 3);
  assert.equal(invalidPoseDelta.scale.maxJoint, "leftUpperArm");
  assert.ok(
    invalidPoseDelta.rotation.max > 1.56 && invalidPoseDelta.rotation.max < 1.58,
    "pose delta metrics should keep valid finite rotation samples when invalid samples are skipped"
  );
  const malformedVec3PoseA = clonePose(skeleton.restPose);
  const malformedVec3PoseB = clonePose(skeleton.restPose);
  malformedVec3PoseA[0]!.translation = [0, 0] as unknown as [number, number, number];
  malformedVec3PoseB[1]!.scale = [1] as unknown as [number, number, number];
  const malformedVec3PoseDelta = poseDeltaMetric(malformedVec3PoseA, malformedVec3PoseB, skeleton);
  assert.equal(malformedVec3PoseDelta.translation.invalidSamples, 1, "pose delta metrics should count short translation tuples as invalid samples");
  assert.equal(malformedVec3PoseDelta.scale.invalidSamples, 1, "pose delta metrics should count short scale tuples as invalid samples");
  assert.equal(Number.isFinite(malformedVec3PoseDelta.translation.rms), true, "short translation tuples should not poison translation RMS");
  assert.equal(Number.isFinite(malformedVec3PoseDelta.scale.rms), true, "short scale tuples should not poison scale RMS");
}
