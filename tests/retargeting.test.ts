import {
  AnimationClip,
  AnimationRuntime,
  Object3D,
  assert,
  createSkeleton,
  createThreeAnimationClip,
  invertQuat,
  multiplyQuat,
  normalizeQuat,
  quatFromAxisAngle,
  quatFromUnitVectors,
  retargetQuaternionSample,
  retargetQuaternionTrackValues,
  rotateVec3ByQuat,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  toFloat32Array
} from "./test-api.js";
import {
  createMirroredLimbBones,
  createNamedBone,
  createSingleLimbBones,
  quaternionNearlyEqual,
  readChildDirection,
  sampleThreeClipOnce,
  vectorNearlyEqual
} from "./test-helpers.js";

export function runRetargetingTests(): void {
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

}
