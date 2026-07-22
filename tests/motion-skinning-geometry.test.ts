import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  NO_PARENT,
  assert,
  buildRigidInstanceMatrices,
  buildSkinningMatrixPalette,
  buildThreeSkinningDebugSegments,
  composeMat4,
  computeRigidInstanceBounds,
  createSkeleton,
  createThreeSkinningDebugGeometry,
  getBakedCameraJointOverride,
  identityTransform,
  localToModelPose,
  quatFromAxisAngle,
  resolveBakedCameraJointIndex,
  skinVertices,
  updateRigidInstanceMatrices,
  updateRigidInstanceMatrixBuffer,
  updateThreeRigidInstanceMatrices,
  validateSkinningJob
} from "./test-api.js";
import { assertMat4NearlyEqual, sampleNodPose, skeleton, vectorNearlyEqual } from "./test-helpers.js";
import { skinThreeBufferGeometry } from "./reference/three-geometry.js";
import { BufferAttribute, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from "three";

export async function runMotionSkinningGeometryTests(): Promise<void> {
  const sampled = sampleNodPose();
  const models = localToModelPose(skeleton, sampled);
  assert.equal(models.length, skeleton.joints.length);
  assert.equal(models[0]![13], 1);

  const bakedSkeleton = createSkeleton([
    { name: "box_a", parentIndex: NO_PARENT, rest: { translation: [1, 0, 0], scale: [2, 2, 2] } },
    { name: "render_Camera", parentIndex: NO_PARENT, rest: { translation: [0, 10, 20], scale: [0.1, 0.1, 0.1] } },
    { name: "box_b", parentIndex: NO_PARENT, rest: { translation: [-2, 3, 0], scale: [1, 4, 1] } }
  ]);
  const bakedModels = localToModelPose(bakedSkeleton, bakedSkeleton.restPose);
  assert.equal(
    resolveBakedCameraJointIndex(bakedSkeleton),
    1,
    "baked camera lookup should find a camera joint by default name text"
  );
  assert.equal(
    resolveBakedCameraJointIndex(bakedSkeleton, { predicate: (joint) => joint.name === "render_Camera" }),
    1,
    "baked camera lookup should support caller predicates"
  );
  const bakedCameraOverride = getBakedCameraJointOverride(bakedSkeleton, bakedModels);
  assert.equal(
    bakedCameraOverride?.jointName,
    "render_Camera",
    "baked camera override should report resolved joint metadata"
  );
  assertMat4NearlyEqual(
    bakedCameraOverride.matrix,
    bakedModels[1]!,
    1e-6,
    "baked camera override should clone the joint model matrix"
  );
  assert.equal(
    getBakedCameraJointOverride(bakedSkeleton, [bakedModels[0]!, new Float32Array([Number.NaN]), bakedModels[2]!])
      ?.matrix,
    undefined,
    "baked camera override should not return a non-finite candidate without an explicit fallback"
  );

  const bakedRigidMatrices = buildRigidInstanceMatrices(bakedModels, { jointIndices: [0, 2] });
  assert.equal(bakedRigidMatrices.length, 2, "baked rigid helpers should build one matrix per selected joint");
  assertMat4NearlyEqual(
    bakedRigidMatrices[0]!,
    bakedModels[0]!,
    1e-6,
    "baked rigid matrices should preserve animated scale columns"
  );
  assert.equal(bakedRigidMatrices[0]![0], 2, "baked rigid matrices should keep x scale from the joint model matrix");
  assert.equal(bakedRigidMatrices[0]![5], 2, "baked rigid matrices should keep y scale from the joint model matrix");
  assert.equal(bakedRigidMatrices[1]![5], 4, "baked rigid matrices should keep per-joint non-uniform scale");
  const rigidFallback = composeMat4({ translation: [7, 8, 9], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  const repairedRigidMatrices = buildRigidInstanceMatrices([new Float32Array([Number.NaN])], {
    fallbackMatrix: rigidFallback
  });
  assertMat4NearlyEqual(
    repairedRigidMatrices[0]!,
    rigidFallback,
    1e-6,
    "baked rigid helpers should repair missing/non-finite model matrices with a finite fallback"
  );
  const rigidMatrixBuffer = new Float32Array(32);
  updateRigidInstanceMatrixBuffer(bakedModels, rigidMatrixBuffer, { jointIndices: [0, 2] });
  assert.ok(
    vectorNearlyEqual(Array.from(rigidMatrixBuffer.slice(0, 16)), Array.from(bakedModels[0]!), 1e-6),
    "baked rigid buffer helper should write the first selected matrix"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(rigidMatrixBuffer.slice(16, 32)), Array.from(bakedModels[2]!), 1e-6),
    "baked rigid buffer helper should write the second selected matrix"
  );
  const rigidBounds = computeRigidInstanceBounds(bakedModels, { jointIndices: [0, 2] });
  assert.equal(rigidBounds.empty, false, "baked rigid bounds should report non-empty selected instances");
  assert.equal(rigidBounds.instanceCount, 2, "baked rigid bounds should report selected instance count");
  assert.ok(
    vectorNearlyEqual(rigidBounds.min, [-2.5, -1, -1], 1e-6),
    "baked rigid bounds should include translated and scaled unit cube minimums"
  );
  assert.ok(
    vectorNearlyEqual(rigidBounds.max, [2, 5, 1], 1e-6),
    "baked rigid bounds should include translated and scaled unit cube maximums"
  );

  const threeRigidMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  const threeRigidMeshVersion = threeRigidMesh.instanceMatrix.version;
  assert.equal(
    updateThreeRigidInstanceMatrices(threeRigidMesh, bakedModels, { jointIndices: [0, 2] }),
    2,
    "three baked rigid helper should update selected InstancedMesh entries"
  );
  assert.equal(threeRigidMesh.count, 2, "three baked rigid helper should keep the active InstancedMesh count aligned");
  assert.equal(
    threeRigidMesh.instanceMatrix.version,
    threeRigidMeshVersion + 1,
    "three baked rigid helper should mark InstancedMesh instance matrices for upload"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(threeRigidMesh.instanceMatrix.array.slice(0, 16)), Array.from(bakedModels[0]!), 1e-6),
    "three baked rigid helper should write the first InstancedMesh matrix"
  );
  const threeRigidAttribute = new Float32BufferAttribute(new Float32Array(32), 16);
  const threeRigidAttributeVersion = threeRigidAttribute.version;
  assert.equal(
    updateThreeRigidInstanceMatrices(threeRigidAttribute, bakedModels, { jointIndices: [0, 2] }),
    2,
    "three baked rigid helper should update standalone instanced matrix buffers"
  );
  assert.equal(
    threeRigidAttribute.version,
    threeRigidAttributeVersion + 1,
    "three baked rigid helper should mark matrix buffer attributes for upload"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(threeRigidAttribute.array.slice(16, 32)), Array.from(bakedModels[2]!), 1e-6),
    "three baked rigid helper should write matrix buffers in instance order"
  );

  const skinningIdentityMatrix = composeMat4(identityTransform());
  const identitySkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.deepEqual(identitySkin.issues, [], "single-joint identity skinning should validate cleanly");
  assert.ok(
    vectorNearlyEqual(Array.from(identitySkin.positions), [1, 2, 3], 1e-6),
    "single-joint identity skinning should preserve positions"
  );

  const translatedSkinPalette = buildSkinningMatrixPalette(
    [composeMat4({ translation: [5, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })],
    [composeMat4({ translation: [-2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })]
  );
  const inverseBindSkin = skinVertices({
    positions: { data: new Float32Array([2, 0, 0]) },
    jointMatrices: translatedSkinPalette,
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(inverseBindSkin.positions), [5, 0, 0], 1e-6),
    "model * inverse-bind palette skinning should move bind-space vertices into the animated joint frame"
  );

  const weightedSkin = skinVertices({
    positions: { data: new Float32Array([1, 0, 0]) },
    influences: 2,
    jointMatrices: [
      skinningIdentityMatrix,
      composeMat4({ translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    ],
    jointIndices: new Uint16Array([0, 1]),
    jointWeights: new Float32Array([0.25])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(weightedSkin.positions), [8.5, 0, 0], 1e-6),
    "skinning should restore the final Ozz influence weight"
  );

  const vectorSkin = skinVertices({
    positions: { data: new Float32Array([0, 0, 0]) },
    normals: { data: new Float32Array([1, 0, 0]) },
    tangents: { data: new Float32Array([0, 1, 0]) },
    jointMatrices: [
      composeMat4({ translation: [10, 20, 30], rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2), scale: [1, 1, 1] })
    ],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(vectorSkin.positions), [10, 20, 30], 1e-6),
    "skinning positions should include joint translation"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(vectorSkin.normals ?? []), [0, 1, 0], 1e-6),
    "skinning normals should transform as directions"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(vectorSkin.tangents ?? []), [-1, 0, 0], 1e-6),
    "skinning tangents should transform as directions"
  );

  const invalidSkinJob = {
    positions: { data: new Float32Array([Number.NaN, 1, 2]) },
    influences: 2,
    jointMatrices: [new Float32Array([Number.NaN])],
    jointIndices: new Uint16Array([99, 0]),
    jointWeights: new Float32Array([Number.NaN])
  };
  assert.ok(
    validateSkinningJob(invalidSkinJob).some((issue) => issue.field === "jointMatrices"),
    "skinning validation should report malformed matrix palettes"
  );
  const repairedSkin = skinVertices(invalidSkinJob);
  assert.ok(repairedSkin.issues.length > 0, "skinning should return validation issues alongside repaired output");
  assert.ok(
    vectorNearlyEqual(Array.from(repairedSkin.positions), [0, 1, 2], 1e-6),
    "skinning should repair invalid scalars to finite fallback output"
  );
  const emptySkin = skinVertices({ positions: { data: new Float32Array() }, jointMatrices: [] });
  assert.equal(emptySkin.vertexCount, 0, "empty skinning input should produce an empty result");
  assert.equal(emptySkin.positions.length, 0, "empty skinning input should not allocate vertex data");
  const reusedSkinOutput = new Float32Array([77, 78, 79, 0, 0, 0]);
  const reusedSkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0]),
    outPositions: { data: reusedSkinOutput, offset: 3 }
  });
  assert.equal(
    reusedSkin.positions,
    reusedSkinOutput,
    "skinning should reuse caller-owned output buffers when they are large enough"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(reusedSkinOutput.slice(3, 6)), [1, 2, 3], 1e-6),
    "reused skinning output should write at the requested offset"
  );
  assert.deepEqual(
    Array.from(reusedSkinOutput.slice(0, 3)),
    [77, 78, 79],
    "reused skinning output should preserve caller-owned components outside the write range"
  );
  assert.ok(
    skinVertices({
      positions: { data: new Float32Array([1, 2, 3]) },
      jointMatrices: [skinningIdentityMatrix],
      jointIndices: new Uint16Array([0]),
      outPositions: { data: new Float32Array(2) }
    }).issues.some((issue) => issue.field === "outPositions"),
    "skinning should report caller output capacity that cannot hold the requested range"
  );

  const threeSkinningGeometry = new BufferGeometry();
  const threePositionAttribute = new Float32BufferAttribute(new Float32Array([0, 0, 0]), 3);
  const threeNormalAttribute = new Float32BufferAttribute(new Float32Array([1, 0, 0]), 3);
  const threeTangentAttribute = new Float32BufferAttribute(new Float32Array([0, 1, 0, -1]), 4);
  threeSkinningGeometry.setAttribute("position", threePositionAttribute);
  threeSkinningGeometry.setAttribute("normal", threeNormalAttribute);
  threeSkinningGeometry.setAttribute("tangent", threeTangentAttribute);
  const threePositionVersion = threePositionAttribute.version;
  const threeNormalVersion = threeNormalAttribute.version;
  const threeTangentVersion = threeTangentAttribute.version;
  const threeSkin = skinThreeBufferGeometry(threeSkinningGeometry, {
    jointMatrices: [
      composeMat4({ translation: [10, 20, 30], rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2), scale: [1, 1, 1] })
    ],
    jointIndices: new Uint16Array([0])
  });
  assert.equal(
    threeSkin.attributes.position,
    threePositionAttribute,
    "three skinning should reuse compatible position attributes"
  );
  assert.equal(
    threeSkin.attributes.normal,
    threeNormalAttribute,
    "three skinning should reuse compatible normal attributes"
  );
  assert.equal(
    threeSkin.attributes.tangent,
    threeTangentAttribute,
    "three skinning should reuse compatible tangent attributes"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(threePositionAttribute.array), [10, 20, 30], 1e-6),
    "three skinning should upload translated positions into geometry attributes"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(threeNormalAttribute.array), [0, 1, 0], 1e-6),
    "three skinning should recompute normal attributes through skinVertices"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(threeTangentAttribute.array), [-1, 0, 0, -1], 1e-6),
    "three skinning should recompute tangent xyz and preserve tangent handedness"
  );
  assert.equal(
    threePositionAttribute.version,
    threePositionVersion + 1,
    "three skinning should mark position attributes for upload"
  );
  assert.equal(
    threeNormalAttribute.version,
    threeNormalVersion + 1,
    "three skinning should mark normal attributes for upload"
  );
  assert.equal(
    threeTangentAttribute.version,
    threeTangentVersion + 1,
    "three skinning should mark tangent attributes for upload"
  );
  const threeSkinningDebug = buildThreeSkinningDebugSegments({ geometry: threeSkinningGeometry, scale: 2 });
  assert.equal(
    threeSkinningDebug.segmentCount,
    3,
    "skinning debug data should include normal, tangent, and binormal segments when attributes exist"
  );
  assert.ok(
    vectorNearlyEqual(
      Array.from(threeSkinningDebug.positions),
      [10, 20, 30, 10, 22, 30, 10, 20, 30, 8, 20, 30, 10, 20, 30, 10, 20, 28],
      1e-6
    ),
    "skinning debug data should build normal, tangent, and handed binormal line segments"
  );
  const threeSkinningDebugGeometry = createThreeSkinningDebugGeometry({ geometry: threeSkinningGeometry, scale: 2 });
  assert.ok(
    vectorNearlyEqual(
      Array.from((threeSkinningDebugGeometry.getAttribute("position") as Float32BufferAttribute).array),
      Array.from(threeSkinningDebug.positions),
      1e-6
    ),
    "skinning debug geometry should expose segment positions as a BufferGeometry position attribute"
  );

  const remappedModels = [
    composeMat4({ translation: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
    composeMat4({ translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  ];
  const remappedInverseBinds = [
    composeMat4({ translation: [-2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
    composeMat4({ translation: [-3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  ];
  const aliasedPaletteOut = remappedModels.slice();
  const remappedPalette = buildSkinningMatrixPalette(aliasedPaletteOut, remappedInverseBinds, {
    jointRemaps: new Uint16Array([1, 0]),
    out: aliasedPaletteOut
  });
  assert.equal(remappedPalette, aliasedPaletteOut, "palette construction should reuse caller-owned matrix arrays");
  assert.equal(remappedPalette[0]![12], 8, "palette remaps should select model matrices before inverse-bind multiply");
  assert.equal(
    remappedPalette[1]![12],
    -2,
    "palette construction should snapshot aliased model input before overwriting reusable output"
  );
  assert.equal(
    buildSkinningMatrixPalette(remappedModels, remappedInverseBinds.slice(0, 1)).length,
    1,
    "mismatched direct palettes should not fabricate entries from an identity fallback"
  );
  assert.ok(
    validateSkinningJob({
      positions: { data: new Float32Array([0, 0, 0]) },
      modelMatrices: remappedModels,
      inverseBindMatrices: remappedInverseBinds.slice(0, 1),
      jointIndices: new Uint16Array([0])
    }).some((issue) => issue.field === "inverseBindMatrices"),
    "skinning validation should report direct model/inverse-bind dimension mismatches"
  );
  assert.ok(
    validateSkinningJob({
      positions: { data: new Float32Array([0, 0, 0]) },
      modelMatrices: remappedModels,
      inverseBindMatrices: remappedInverseBinds.slice(0, 1),
      jointRemaps: new Int16Array([2]),
      jointIndices: new Uint16Array([0])
    }).some((issue) => issue.field === "jointRemaps" && issue.index === 0),
    "skinning validation should report the exact out-of-range model remap"
  );

  const invalidWeightIssues = validateSkinningJob({
    positions: { data: new Float32Array([1, 0, 0]) },
    influences: 2,
    jointMatrices: [skinningIdentityMatrix, skinningIdentityMatrix],
    jointIndices: new Int16Array([-1, 1]),
    jointWeights: new Float32Array([1.25])
  });
  assert.ok(
    invalidWeightIssues.some((issue) => issue.field === "jointIndices" && issue.index === 0),
    "skinning validation should identify the exact invalid joint-index slot"
  );
  assert.ok(
    invalidWeightIssues.some((issue) => issue.field === "jointWeights" && issue.index === 0),
    "skinning validation should identify the exact overflowing weight slot"
  );
  const clampedRestoredSkin = skinVertices({
    positions: { data: new Float32Array([1, 0, 0, 1, 0, 0]) },
    vertexCount: 2,
    influences: 2,
    jointMatrices: [
      skinningIdentityMatrix,
      composeMat4({ translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    ],
    jointIndices: new Uint16Array([0, 1, 0, 1]),
    jointWeights: new Float32Array([1.25, -0.5])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(clampedRestoredSkin.positions), [1, 0, 0, 11, 0, 0], 1e-6),
    "restored-last skinning should clamp overflowing and negative stored weights without producing negative influence"
  );
  const normalizedExplicitSkin = skinVertices({
    positions: { data: new Float32Array([1, 0, 0]) },
    influences: 2,
    weightMode: "explicit",
    jointMatrices: [
      skinningIdentityMatrix,
      composeMat4({ translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    ],
    jointIndices: new Uint16Array([0, 1]),
    jointWeights: new Float32Array([1, 1])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedExplicitSkin.positions), [6, 0, 0], 1e-6),
    "explicit weights whose sum overflows one should be normalized deterministically"
  );

  const overlappingBacking = new Float32Array([1, 0, 0, 2, 0, 0, 99, 98, 97]);
  const overlappingSource = overlappingBacking.subarray(0, 6);
  const overlappingOutput = overlappingBacking.subarray(3, 9);
  const overlappingSkin = skinVertices({
    positions: { data: overlappingSource },
    vertexCount: 2,
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0, 0]),
    outPositions: { data: overlappingOutput }
  });
  assert.equal(overlappingSkin.positions, overlappingOutput, "skinning should retain compatible aliased output views");
  assert.ok(
    vectorNearlyEqual(Array.from(overlappingOutput), [1, 0, 0, 2, 0, 0], 1e-6),
    "skinning should snapshot typed-array inputs whose backing ranges overlap shifted outputs"
  );
  const sharedOutputs = new Float32Array(3);
  const detachedNormalSkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3]) },
    normals: { data: new Float32Array([0, 1, 0]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0]),
    outPositions: { data: sharedOutputs },
    outNormals: { data: sharedOutputs }
  });
  assert.equal(
    detachedNormalSkin.positions,
    sharedOutputs,
    "overlapping outputs should keep the primary position target"
  );
  assert.notEqual(
    detachedNormalSkin.normals,
    sharedOutputs,
    "overlapping normal output should be detached so neither result overwrites the other"
  );
  assert.ok(
    detachedNormalSkin.issues.some((issue) => issue.field === "outNormals"),
    "overlapping output repair should remain visible in validation issues"
  );
  const interleavedOutputs = new Float32Array(12);
  const interleavedOutputSkin = skinVertices({
    positions: { data: new Float32Array([1, 2, 3, 4, 5, 6]) },
    normals: { data: new Float32Array([0, 1, 0, 1, 0, 0]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0, 0]),
    outPositions: { data: interleavedOutputs, offset: 0, stride: 6 },
    outNormals: { data: interleavedOutputs, offset: 3, stride: 6 }
  });
  assert.equal(
    interleavedOutputSkin.normals,
    interleavedOutputs,
    "disjoint interleaved-like output lanes should reuse one caller-owned buffer"
  );
  assert.ok(
    !interleavedOutputSkin.issues.some((issue) => issue.field === "outNormals"),
    "disjoint strided outputs should not be misreported as overlapping"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(interleavedOutputs), [1, 2, 3, 0, 1, 0, 4, 5, 6, 1, 0, 0], 1e-6),
    "disjoint strided position and normal writes should preserve their exact lanes"
  );

  const nonUniformMatrix = composeMat4({
    translation: [5, 6, 7],
    rotation: [0, 0, 0, 1],
    scale: [2, 4, -8]
  });
  const nonUniformInverseTranspose = new Float32Array([0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, -0.125, 0, 0, 0, 0, 1]);
  const inverseTransposeSkin = skinVertices({
    positions: { data: new Float32Array([1, 1, 1]) },
    normals: { data: new Float32Array([1, 1, 1]) },
    tangents: { data: new Float32Array([1, 1, 1]) },
    jointMatrices: [nonUniformMatrix],
    jointInverseTransposeMatrices: [nonUniformInverseTranspose],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(inverseTransposeSkin.positions), [7, 10, -1], 1e-6),
    "non-uniform and mirrored joint matrices should transform positions as points"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(inverseTransposeSkin.normals ?? []), [0.5, 0.25, -0.125], 1e-6),
    "provided inverse-transpose matrices should transform normals without Ozz-incompatible implicit normalization"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(inverseTransposeSkin.tangents ?? []), [0.5, 0.25, -0.125], 1e-6),
    "provided inverse-transpose matrices should follow Ozz tangent-vector semantics"
  );
  const malformedInverseTransposeSkin = skinVertices({
    positions: { data: new Float32Array([0, 0, 0]) },
    normals: { data: new Float32Array([1, 0, 0]) },
    jointMatrices: [nonUniformMatrix],
    jointInverseTransposeMatrices: [new Float32Array([Number.NaN])],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(malformedInverseTransposeSkin.normals ?? []), [2, 0, 0], 1e-6),
    "a malformed inverse-transpose entry should fall back to its corresponding joint matrix, not identity"
  );
  assert.ok(
    validateSkinningJob({
      positions: { data: new Float32Array([0, 0, 0]) },
      jointMatrices: [new Float32Array(17)],
      jointIndices: new Uint16Array([0])
    }).some((issue) => issue.field === "jointMatrices"),
    "skinning validation should reject matrices whose dimensions are not exactly 4x4"
  );
  const excessiveInfluenceSkin = skinVertices({
    positions: { data: new Float32Array([3, 4, 5]) },
    influences: 257,
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.equal(
    excessiveInfluenceSkin.influences,
    256,
    "excessive influence counts should clamp to the bounded maximum"
  );
  assert.ok(
    excessiveInfluenceSkin.issues.some((issue) => issue.field === "influences"),
    "unsafe influence-count repair should be reported"
  );
  const zeroInfluenceSkin = skinVertices({
    positions: { data: new Float32Array([3, 4, 5]) },
    influences: 0,
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.equal(zeroInfluenceSkin.influences, 1, "zero influences should repair to one rigid influence");
  assert.ok(
    vectorNearlyEqual(Array.from(zeroInfluenceSkin.positions), [3, 4, 5], 1e-6),
    "zero-influence repair should remain finite and deterministic"
  );
  const hugeCountSkin = skinVertices({
    positions: { data: new Float32Array([6, 7, 8]) },
    vertexCount: Number.MAX_SAFE_INTEGER,
    influences: Number.MAX_SAFE_INTEGER,
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array(256),
    jointWeights: new Float32Array(255)
  });
  assert.equal(hugeCountSkin.vertexCount, 1, "huge requested vertex counts should clamp to available input data");
  assert.equal(hugeCountSkin.influences, 256, "huge influence counts should clamp before iteration");
  assert.ok(
    vectorNearlyEqual(Array.from(hugeCountSkin.positions), [6, 7, 8], 1e-6),
    "huge count repair should avoid unsafe allocation while preserving the available vertex"
  );
  const finiteOverflowSkin = skinVertices({
    positions: { data: [1e30, 0, 0] },
    jointMatrices: [[1e30, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    Array.from(finiteOverflowSkin.positions).every(Number.isFinite),
    "finite-but-overflowing transform arithmetic should not escape as Infinity in Float32 output"
  );
  assert.ok(
    finiteOverflowSkin.issues.some((issue) => issue.field === "positions"),
    "finite output overflow repair should be reported at the affected attribute"
  );

  const aliasRigidMatrices = [
    composeMat4({ translation: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
    composeMat4({ translation: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  ];
  updateRigidInstanceMatrices(aliasRigidMatrices, aliasRigidMatrices, { jointIndices: [1, 0] });
  assert.equal(aliasRigidMatrices[0]![12], 2, "rigid matrix-array updates should support reordered aliased sources");
  assert.equal(aliasRigidMatrices[1]![12], 1, "rigid matrix-array updates should snapshot every selected source");
  const aliasRigidBuffer = new Float32Array(32);
  aliasRigidBuffer.set(composeMat4({ translation: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }), 0);
  aliasRigidBuffer.set(composeMat4({ translation: [4, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }), 16);
  updateRigidInstanceMatrixBuffer(
    [aliasRigidBuffer.subarray(0, 16), aliasRigidBuffer.subarray(16, 32)],
    aliasRigidBuffer,
    { jointIndices: [1, 0], stride: 1 }
  );
  assert.equal(aliasRigidBuffer[12], 4, "rigid buffer updates should clamp undersized matrix strides to 16");
  assert.equal(aliasRigidBuffer[28], 3, "rigid buffer updates should preserve aliased sources before writing");
  const stridedRigidBuffer = new Array<number>(42).fill(123);
  updateRigidInstanceMatrixBuffer(bakedModels, stridedRigidBuffer, {
    jointIndices: [0, 2],
    offset: 2,
    stride: 20
  });
  assert.deepEqual(
    stridedRigidBuffer.slice(0, 2),
    [123, 123],
    "rigid buffer updates should preserve caller prefix components"
  );
  assert.deepEqual(
    stridedRigidBuffer.slice(18, 22),
    [123, 123, 123, 123],
    "rigid buffer updates should preserve stride padding between matrices"
  );
  assert.ok(
    vectorNearlyEqual(stridedRigidBuffer.slice(22, 38), Array.from(bakedModels[2]!), 1e-6),
    "rigid buffer updates should place later matrices at the requested stride"
  );
  assert.deepEqual(
    stridedRigidBuffer.slice(38),
    [123, 123, 123, 123],
    "rigid buffer updates should preserve caller suffix capacity"
  );
  assert.throws(
    () => updateRigidInstanceMatrixBuffer([skinningIdentityMatrix], [], { offset: Number.MAX_SAFE_INTEGER }),
    /safe array bounds/,
    "rigid buffer updates should reject unsafe component ranges before array mutation"
  );
  assert.equal(
    getBakedCameraJointOverride(bakedSkeleton, [bakedModels[0]!, new Float32Array([Number.NaN])], {
      fallbackMatrix: new Float32Array([Number.NaN])
    }),
    undefined,
    "camera overrides should not claim success when both source and fallback matrices are malformed"
  );
  assert.equal(
    resolveBakedCameraJointIndex(bakedSkeleton, { joint: "missing_joint" }),
    1,
    "an unresolved explicit camera reference should continue through predicate/name fallback resolution"
  );
  const shearedBounds = computeRigidInstanceBounds(
    [new Float32Array([-2, 0, 0, 0, 1, 3, 0, 0, 0, 1, -1, 0, 5, -2, 4, 1])],
    { localMin: [-1, -2, -3], localMax: [2, 1, 4] }
  );
  assert.ok(
    vectorNearlyEqual(shearedBounds.min, [-1, -11, 0], 1e-6),
    "rigid bounds should evaluate every local-box corner under shear and negative scale"
  );
  assert.ok(
    vectorNearlyEqual(shearedBounds.max, [8, 5, 7], 1e-6),
    "rigid bounds should retain the opposite transformed corner extrema"
  );

  const clampedThreeMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 4);
  assert.equal(
    updateThreeRigidInstanceMatrices(clampedThreeMesh, bakedModels.slice(0, 1), { count: 4 }),
    1,
    "three instance updates should report the number of available source matrices actually written"
  );
  assert.equal(clampedThreeMesh.count, 1, "three instance active count should match matrices actually written");
  assert.throws(
    () => updateThreeRigidInstanceMatrices(clampedThreeMesh, bakedModels, { offset: 16 }),
    /offset 0 and stride 16/,
    "InstancedMesh updates should reject raw-buffer offsets that cannot match Three instance semantics"
  );
  assert.throws(
    () =>
      updateThreeRigidInstanceMatrices(new BufferAttribute(new Uint16Array(32), 16), bakedModels, {
        jointIndices: [0, 2]
      }),
    /Float32Array/,
    "three matrix attributes should reject integer buffers that would quantize matrices"
  );
  assert.throws(
    () => updateThreeRigidInstanceMatrices(new Float32BufferAttribute(new Float32Array(32), 4), bakedModels),
    /itemSize 16/,
    "three matrix attributes should reject non-matrix item sizes"
  );
  const growingThreeMatrixArray: number[] = [91, 92];
  assert.equal(
    updateThreeRigidInstanceMatrices(growingThreeMatrixArray, bakedModels, { jointIndices: [0, 2] }),
    2,
    "three rigid updates should treat number arrays as expandable caller-owned outputs"
  );
  assert.equal(growingThreeMatrixArray.length, 32, "expandable three matrix arrays should grow to the required range");

  const interleavedGeometry = new BufferGeometry();
  const interleavedData = new InterleavedBuffer(new Float32Array([1, 2, 3, 0, 1, 0, 4, 5, 6, 1, 0, 0]), 6);
  interleavedGeometry.setAttribute("position", new InterleavedBufferAttribute(interleavedData, 3, 0));
  interleavedGeometry.setAttribute("normal", new InterleavedBufferAttribute(interleavedData, 3, 3));
  const interleavedSkin = skinThreeBufferGeometry(interleavedGeometry, {
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0, 0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(interleavedSkin.attributes.position.array), [1, 2, 3, 4, 5, 6], 1e-6),
    "three skinning should read interleaved position offsets and strides"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(interleavedSkin.attributes.normal?.array ?? []), [0, 1, 0, 1, 0, 0], 1e-6),
    "three skinning should read interleaved normal offsets and strides"
  );
  const normalizedGeometry = new BufferGeometry();
  normalizedGeometry.setAttribute("position", new BufferAttribute(new Int16Array([32767, 0, 0]), 3, true));
  normalizedGeometry.setAttribute("normal", new BufferAttribute(new Int8Array([127, 0, 0]), 3, true));
  normalizedGeometry.setAttribute("tangent", new BufferAttribute(new Int8Array([0, 127, 0, -128]), 4, true));
  const normalizedThreeSkin = skinThreeBufferGeometry(normalizedGeometry, {
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedThreeSkin.attributes.position.array), [1, 0, 0], 1e-5),
    "three skinning should decode normalized integer source positions instead of treating storage bits as floats"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedThreeSkin.attributes.normal?.array ?? []), [1, 0, 0], 1e-5),
    "three skinning should decode normalized integer source normals instead of treating storage bits as floats"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedThreeSkin.attributes.tangent?.array ?? []), [0, 1, 0, -1], 1e-5),
    "three skinning should decode normalized integer source tangents and preserve handedness"
  );
  const rawIntegerNormalSkin = skinVertices({
    positions: { data: new Float32Array([0, 0, 0]) },
    normals: { data: new Int8Array([127, 0, 0]) },
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(rawIntegerNormalSkin.normals ?? []), [127, 0, 0], 1e-6),
    "renderer-agnostic skinning should continue to read raw numeric arrays without Three normalization"
  );
  const normalizedInterleavedGeometry = new BufferGeometry();
  const normalizedInterleavedData = new InterleavedBuffer(new Int8Array([0, 0, 0, 127, 0, 0, 0, 127, 0, -128]), 10);
  normalizedInterleavedGeometry.setAttribute(
    "position",
    new InterleavedBufferAttribute(normalizedInterleavedData, 3, 0, true)
  );
  normalizedInterleavedGeometry.setAttribute(
    "normal",
    new InterleavedBufferAttribute(normalizedInterleavedData, 3, 3, true)
  );
  normalizedInterleavedGeometry.setAttribute(
    "tangent",
    new InterleavedBufferAttribute(normalizedInterleavedData, 4, 6, true)
  );
  const normalizedInterleavedSkin = skinThreeBufferGeometry(normalizedInterleavedGeometry, {
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedInterleavedSkin.attributes.normal?.array ?? []), [1, 0, 0], 1e-5),
    "three skinning should decode normalized interleaved normals with Three BufferAttribute semantics"
  );
  assert.ok(
    vectorNearlyEqual(Array.from(normalizedInterleavedSkin.attributes.tangent?.array ?? []), [0, 1, 0, -1], 1e-5),
    "three skinning should decode normalized interleaved tangent handedness with Three BufferAttribute semantics"
  );
  const float16Geometry = new BufferGeometry();
  const float16Position = new Float16BufferAttribute([0, 0, 0], 3);
  float16Position.setXYZ(0, 1, 2, 3);
  float16Geometry.setAttribute("position", float16Position);
  const float16ThreeSkin = skinThreeBufferGeometry(float16Geometry, {
    jointMatrices: [skinningIdentityMatrix],
    jointIndices: new Uint16Array([0])
  });
  assert.ok(
    vectorNearlyEqual(Array.from(float16ThreeSkin.attributes.position.array), [1, 2, 3], 1e-5),
    "three skinning should decode Float16BufferAttribute components through Three accessors"
  );
  const degenerateDebug = buildThreeSkinningDebugSegments({
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    tangents: new Float32Array([0, 0, 1, 0]),
    tangentStride: 4,
    includeNormals: false,
    includeTangents: false,
    includeBinormals: true
  });
  assert.ok(
    vectorNearlyEqual(Array.from(degenerateDebug.positions), [0, 0, 0, 0, 1, 0], 1e-6),
    "degenerate parallel normal/tangent debug vectors should use a deterministic orthogonal binormal"
  );
}
