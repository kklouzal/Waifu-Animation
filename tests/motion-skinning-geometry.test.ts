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
  skinThreeBufferGeometry,
  skinVertices,
  updateRigidInstanceMatrixBuffer,
  updateThreeRigidInstanceMatrices,
  validateSkinningJob
} from "./test-api.js";
import { assertMat4NearlyEqual, sampleNodPose, skeleton, vectorNearlyEqual } from "./test-helpers.js";

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
  const reusedSkinOutput = new Float32Array(6);
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
}
