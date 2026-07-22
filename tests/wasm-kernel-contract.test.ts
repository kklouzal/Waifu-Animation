import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WaifuAnimationWasmKernel } from "./test-api.js";
import {
  AnimationSamplingContext,
  WA_KERNEL_ABI_MAJOR,
  WA_KERNEL_FEATURE_SCALAR_ADDITIVE,
  WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS,
  WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL,
  WA_KERNEL_FEATURE_SCALAR_POSE_BLEND,
  WA_KERNEL_FEATURE_SCALAR_POSE_JOBS,
  WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING,
  WaKernelStatus,
  additiveDeltaPose,
  applyAdditivePose,
  applyAimIkChainToPose,
  applyAimIkModelCorrection,
  applyTwoBoneIkLocalCorrections,
  assert,
  blendPoses,
  buildPackedRuntimeAnimation,
  clonePose,
  createRestPose,
  createSkeleton,
  detectWaKernelSimdSupport,
  localToModelPose,
  loadWaifuAnimationWasmKernel,
  normalizePose,
  sampleClipToPose,
  sampleClipToPoseWithContext,
  samplePackedRuntimeAnimationToPose,
  skinVertices,
  solveAimIk,
  solveFootPlant,
  solveTwoBoneIkModel,
  updateLocalToModelPoseRange,
  validateWaifuAnimationKernelExports,
  writeTransformPoseToSoa
} from "./test-api.js";
import { assertMat4NearlyEqual, quaternionNearlyEqual, vectorNearlyEqual } from "./test-helpers.js";
import { createSkinningJobForModelPose, createWasmKernelSyntheticFixture } from "./wasm-kernel-fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIST_PATH = join(REPO_ROOT, "dist", "wasm-kernel", "waifu_animation_kernel.wasm");
const WASM_TARGET_PATH = join(REPO_ROOT, "target", "wasm32-unknown-unknown", "release", "waifu_animation_kernel.wasm");

export async function runWasmKernelContractTests(): Promise<void> {
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

  await assertWasmLocalToModelParity();
}

async function assertWasmLocalToModelParity(): Promise<void> {
  const kernel = await loadRequiredKernel();
  assert.equal(
    kernel.featureFlags & WA_KERNEL_FEATURE_SCALAR_POSE_JOBS,
    WA_KERNEL_FEATURE_SCALAR_POSE_JOBS,
    "ABI v1.1 kernel should feature-gate blend/additive/mask jobs"
  );
  assertWasmPoseJobsParity(kernel);
  assertWasmPackedSamplingParity(kernel);
  assert.equal(
    typeof detectWaKernelSimdSupport(typeof WebAssembly === "undefined" ? undefined : WebAssembly),
    "boolean",
    "SIMD capability probe should be optional and not require SharedArrayBuffer"
  );

  const fixture = createWasmKernelSyntheticFixture({ jointCount: 9, keyCount: 4, vertexCount: 0, phase: 0.33 });
  const restPose = createRestPose(fixture.skeleton);
  const animatedPose = normalizePose(sampleClipToPose(fixture.skeleton, fixture.clip, 0.613, { restPose }));

  for (const jointCount of [1, 3, 4, 5, 8, 9]) {
    const localFixture = createWasmKernelSyntheticFixture({ jointCount, keyCount: 3, vertexCount: 0, phase: 0.07 });
    const pose = normalizePose(
      sampleClipToPose(localFixture.skeleton, localFixture.clip, 0.41, { restPose: localFixture.skeleton.restPose })
    );
    const context = kernel.createLocalToModelContext(localFixture.skeleton);
    const wasmOut = context.updateModelPoseFromTransformPose(pose, []);
    assert.ok(wasmOut, `WASM local-to-model should run for padded joint count ${jointCount}`);
    assertModelPosesNearlyEqual(wasmOut, localToModelPose(localFixture.skeleton, pose), `padded joints ${jointCount}`);
  }

  const context = kernel.createLocalToModelContext(fixture.skeleton);
  const restOut = context.updateModelPoseFromTransformPose(restPose, []);
  assert.ok(restOut, "WASM local-to-model should run for rest pose");
  assertModelPosesNearlyEqual(restOut, localToModelPose(fixture.skeleton, restPose), "rest local-to-model");

  const animatedOut = context.updateModelPoseFromTransformPose(animatedPose, []);
  assert.ok(animatedOut, "WASM local-to-model should run for animated pose");
  assertModelPosesNearlyEqual(animatedOut, localToModelPose(fixture.skeleton, animatedPose), "animated local-to-model");

  const multiRootSkeleton = createSkeleton([
    { name: "root_a", parentIndex: -1, rest: { translation: [0, 0, 0] } },
    { name: "root_b", parentIndex: -1, rest: { translation: [2, 0, 0] } },
    { name: "a_child", parentIndex: 0, rest: { translation: [0, 1, 0] } },
    { name: "b_child", parentIndex: 1, rest: { translation: [0, 2, 0] } },
    { name: "b_leaf", parentIndex: 3, rest: { translation: [0.5, 0, 0] } }
  ]);
  const multiContext = kernel.createLocalToModelContext(multiRootSkeleton);
  const multiPose = createRestPose(multiRootSkeleton);
  const paddedSoa = writeTransformPoseToSoa(multiPose, new Float32Array(Math.ceil(multiPose.length / 4) * 40));
  assert.equal(paddedSoa[40 + 24 + 1], 1, "padded SoA rotation lanes should default to identity");
  multiPose[3]!.rotation = [0, 0.3826834323650898, 0, 0.9238795325112867];
  const rootMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
  const multiOut = multiContext.updateModelPoseFromTransformPose(multiPose, [], { root: rootMatrix });
  assert.ok(multiOut, "WASM local-to-model should support multi-root skeletons and root matrix");
  assertModelPosesNearlyEqual(
    multiOut,
    localToModelPose(multiRootSkeleton, multiPose, []).map((matrix) => multiplyRootForReference(rootMatrix, matrix)),
    "multi-root rooted local-to-model"
  );

  const rangedFull = localToModelPose(fixture.skeleton, restPose);
  const rangedContext = kernel.createLocalToModelContext(fixture.skeleton);
  const rangedWasm = rangedContext.updateModelPoseFromTransformPose(restPose, []);
  assert.ok(rangedWasm, "WASM range setup should run");
  const changedPose = clonePose(restPose);
  changedPose[4]!.translation = [0.123, 0.456, -0.25];
  const tsRange = updateLocalToModelPoseRange(fixture.skeleton, changedPose, rangedFull, { from: 4, to: 7 });
  const wasmRange = updateLocalToModelPoseRange(fixture.skeleton, changedPose, rangedWasm, {
    from: 4,
    to: 7,
    kernel: rangedContext
  });
  assertModelPosesNearlyEqual(wasmRange, tsRange, "ranged partial update");

  const fromExcludedTs = updateLocalToModelPoseRange(
    fixture.skeleton,
    changedPose,
    localToModelPose(fixture.skeleton, restPose),
    {
      from: 3,
      to: 8,
      fromExcluded: true
    }
  );
  const fromExcludedWasmBase = context.updateModelPoseFromTransformPose(restPose, []);
  assert.ok(fromExcludedWasmBase, "WASM fromExcluded setup should run");
  const fromExcludedWasm = updateLocalToModelPoseRange(fixture.skeleton, changedPose, fromExcludedWasmBase, {
    from: 3,
    to: 8,
    fromExcluded: true,
    kernel: context
  });
  assertModelPosesNearlyEqual(fromExcludedWasm, fromExcludedTs, "fromExcluded partial update");

  const repeatA = context.updateModelPoseFromTransformPose(animatedPose, []);
  const repeatB = context.updateModelPoseFromTransformPose(animatedPose, repeatA ?? []);
  assert.ok(repeatA && repeatB, "WASM local-to-model deterministic repeat should run");
  assertModelPosesNearlyEqual(repeatB, repeatA, "deterministic repeats");

  const poisonedPose = clonePose(restPose);
  poisonedPose[2]!.translation = [Number.NaN, 0.25, Number.POSITIVE_INFINITY];
  poisonedPose[2]!.rotation = [Number.NaN, 0, 0, 0];
  poisonedPose[2]!.scale = [Number.NaN, 2, Number.NEGATIVE_INFINITY];
  const sanitizedReference = localToModelPose(fixture.skeleton, normalizePose(poisonedPose));
  const poisonedOut = context.updateModelPoseFromTransformPose(poisonedPose, []);
  assert.ok(poisonedOut, "WASM local-to-model should sanitize finite/NaN lanes");
  assertModelPosesNearlyEqual(poisonedOut, sanitizedReference, "finite/NaN sanitization");
  assert.ok(
    poisonedOut.every((matrix) => Array.from(matrix).every(Number.isFinite)),
    "sanitized matrices stay finite"
  );

  const hemisphereA = clonePose(restPose);
  const hemisphereB = clonePose(restPose);
  hemisphereA[1]!.rotation = [0, 0.7071067811865475, 0, 0.7071067811865476];
  hemisphereB[1]!.rotation = [0, -0.7071067811865475, 0, -0.7071067811865476];
  assertModelPosesNearlyEqual(
    context.updateModelPoseFromTransformPose(hemisphereA, [])!,
    context.updateModelPoseFromTransformPose(hemisphereB, [])!,
    "q and -q matrix equivalence"
  );

  context.writeLocalPose(animatedPose);
  assert.equal(context.updateModelPoseFromSoa(), WaKernelStatus.Ok, "contiguous SoA local-to-model should run");
  const oldBuffer = context.localPoseView.buffer;
  assert.equal(kernel.forceMemoryGrowthForTests(1), WaKernelStatus.Ok, "test growth export should grow memory");
  assert.notEqual(
    context.localPoseView.buffer,
    oldBuffer,
    "WASM context should refresh stale views after memory growth"
  );
  assert.equal(context.updateModelPoseFromSoa(), WaKernelStatus.Ok, "view refresh should keep context runnable");

  const rawContext = kernel.createLocalToModelContext(fixture.skeleton);
  rawContext.writeLocalPose(animatedPose);
  assert.equal(rawContext.updateModelPoseFromSoa(), WaKernelStatus.Ok, "raw status baseline should run");
  const view = new DataView(kernel.memory.buffer);
  view.setInt32(rawContext.parentIndicesOffset + 4, 1, true);
  assert.equal(
    rawContext.updateModelPoseFromSoa(),
    WaKernelStatus.InvalidArgument,
    "malformed hierarchy should be rejected"
  );
  view.setInt32(rawContext.parentIndicesOffset + 4, 0, true);
  assert.equal(
    rawContext.invokeRawLocalToModelForTests({ avatarHandle: 0 }),
    WaKernelStatus.BadHandle,
    "bad handle should be rejected"
  );
  assert.equal(
    rawContext.invokeRawLocalToModelForTests({ localPoseOffset: 3 }),
    WaKernelStatus.InvalidArgument,
    "bad offset alignment should be rejected"
  );
  assert.equal(
    rawContext.invokeRawLocalToModelForTests({ modelPoseOffset: kernel.memory.buffer.byteLength + 64 }),
    WaKernelStatus.OutOfBounds,
    "out-of-bounds model offset should be rejected"
  );
  view.setUint32(rawContext.optionsOffset + 8, 0, true);
  assert.equal(
    rawContext.invokeRawLocalToModelForTests({}),
    WaKernelStatus.Capacity,
    "capacity shortage should be rejected"
  );

  const disabledOut: ReturnType<typeof loadWaifuAnimationWasmKernel> = loadWaifuAnimationWasmKernel({ disabled: true });
  const disabledResult = await disabledOut;
  assert.equal(disabledResult.kind, "typescript", "forced disabled loader should fall back to TypeScript");
  const noSourceResult = await loadWaifuAnimationWasmKernel();
  assert.equal(noSourceResult.kind, "typescript", "missing WASM source should fall back to TypeScript");
  const invalidResult = await loadWaifuAnimationWasmKernel({ source: { bytes: new Uint8Array([0, 1, 2, 3]) } });
  assert.equal(invalidResult.kind, "typescript", "instantiate failure should fall back to TypeScript");
  const missingFeatureResult = await loadWaifuAnimationWasmKernel({
    source: { bytes: ensureWasmKernelBytes() },
    requiredFeatures: 1 << 30
  });
  assert.equal(missingFeatureResult.kind, "typescript", "missing required feature should fall back to TypeScript");
  assert.equal(
    validateWaifuAnimationKernelExports({
      memory: new WebAssembly.Memory({ initial: 1 }),
      wa_version_major: () => WA_KERNEL_ABI_MAJOR + 1,
      wa_version_minor: () => 0,
      wa_feature_flags: () => WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL,
      wa_memory_epoch: () => 0,
      wa_refresh_views_required: () => 0,
      wa_heap_base: () => 1024,
      wa_alloc: () => WaKernelStatus.Ok,
      wa_create_skeleton: () => WaKernelStatus.Ok,
      wa_create_avatar: () => WaKernelStatus.Ok,
      wa_destroy_handle: () => WaKernelStatus.Ok,
      wa_local_to_model: () => WaKernelStatus.Ok
    }).ok,
    false,
    "ABI major mismatch should reject the kernel"
  );
  const poseFeatureFlags =
    WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL |
    WA_KERNEL_FEATURE_SCALAR_POSE_BLEND |
    WA_KERNEL_FEATURE_SCALAR_ADDITIVE |
    WA_KERNEL_FEATURE_SCALAR_JOINT_MASKS;
  const oldMinorPoseExports = {
    memory: new WebAssembly.Memory({ initial: 1 }),
    wa_version_major: () => WA_KERNEL_ABI_MAJOR,
    wa_version_minor: () => 0,
    wa_feature_flags: () => poseFeatureFlags,
    wa_memory_epoch: () => 0,
    wa_refresh_views_required: () => 0,
    wa_heap_base: () => 1024,
    wa_alloc: () => WaKernelStatus.Ok,
    wa_create_skeleton: () => WaKernelStatus.Ok,
    wa_create_avatar: () => WaKernelStatus.Ok,
    wa_destroy_handle: () => WaKernelStatus.Ok,
    wa_local_to_model: () => WaKernelStatus.Ok,
    wa_blend_poses: () => WaKernelStatus.Ok,
    wa_additive_delta: () => WaKernelStatus.Ok,
    wa_apply_additive: () => WaKernelStatus.Ok,
    wa_normalize_pose: () => WaKernelStatus.Ok
  };
  assert.equal(
    validateWaifuAnimationKernelExports(oldMinorPoseExports, WA_KERNEL_FEATURE_SCALAR_POSE_JOBS).ok,
    false,
    "pose-job feature request should reject ABI v1.0 even if exports are spoofed"
  );
  assert.equal(
    validateWaifuAnimationKernelExports(
      {
        ...oldMinorPoseExports,
        wa_version_minor: () => 1,
        wa_feature_flags: () => WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL
      },
      WA_KERNEL_FEATURE_SCALAR_POSE_JOBS
    ).ok,
    false,
    "pose-job feature request should reject missing feature bits"
  );
  const missingPoseExport: Record<string, unknown> = {
    ...oldMinorPoseExports,
    wa_version_minor: () => 1
  };
  delete missingPoseExport.wa_apply_additive;
  assert.equal(
    validateWaifuAnimationKernelExports(missingPoseExport, WA_KERNEL_FEATURE_SCALAR_POSE_JOBS).ok,
    false,
    "pose-job feature request should reject missing additive export"
  );
  const packedSamplingExports: Record<string, unknown> = {
    ...oldMinorPoseExports,
    wa_version_minor: () => 2,
    wa_feature_flags: () => poseFeatureFlags | WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING,
    wa_create_packed_clip: () => WaKernelStatus.Ok,
    wa_create_sampling_context: () => WaKernelStatus.Ok,
    wa_reset_sampling_context: () => WaKernelStatus.Ok,
    wa_sample_packed_clip: () => WaKernelStatus.Ok,
    wa_sample_packed_clip_ratio: () => WaKernelStatus.Ok
  };
  assert.equal(
    validateWaifuAnimationKernelExports(
      { ...packedSamplingExports, wa_version_minor: () => 1 },
      WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING
    ).ok,
    false,
    "packed sampling should reject ABI v1.1"
  );
  assert.equal(
    validateWaifuAnimationKernelExports(
      { ...packedSamplingExports, wa_feature_flags: () => poseFeatureFlags },
      WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING
    ).ok,
    false,
    "packed sampling should reject a missing feature bit"
  );
  delete packedSamplingExports.wa_sample_packed_clip_ratio;
  assert.equal(
    validateWaifuAnimationKernelExports(packedSamplingExports, WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING).ok,
    false,
    "packed sampling should reject a missing ratio export"
  );

  const disabledContext = kernel.createLocalToModelContext(fixture.skeleton);
  kernel.forceDisableForTests("unit-test forced disable");
  const fallbackOut = updateLocalToModelPoseRange(fixture.skeleton, animatedPose, [], { kernel: disabledContext });
  assertModelPosesNearlyEqual(fallbackOut, localToModelPose(fixture.skeleton, animatedPose), "forced disable fallback");
  kernel.clearForcedDisableForTests();
}

function assertWasmPackedSamplingParity(kernel: WaifuAnimationWasmKernel): void {
  assert.equal(
    kernel.featureFlags & WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING,
    WA_KERNEL_FEATURE_RETAINED_PACKED_SAMPLING,
    "ABI v1.2 kernel should feature-gate retained packed sampling"
  );

  for (const jointCount of [1, 3, 4, 5, 8, 9]) {
    const fixture = createWasmKernelSyntheticFixture({ jointCount, keyCount: 5, vertexCount: 0, phase: 0.19 });
    const packed = buildPackedRuntimeAnimation(fixture.clip, fixture.skeleton);
    const asset = kernel.createPackedClipAsset(fixture.skeleton, packed);
    const arena = kernel.createPoseArenaContext(fixture.skeleton, { poseCapacity: 6 });
    const context = arena.createPackedSamplingContext(asset);
    const memoryAfterSetup = kernel.memory.buffer.byteLength;
    const cases = [
      { time: 0, loop: true },
      { time: fixture.clip.duration, loop: true },
      { time: fixture.clip.duration, loop: false },
      { time: -0.25, loop: true },
      { time: fixture.clip.duration * 3.25, loop: true },
      { time: 0.73, loop: false },
      { time: 0.31, loop: false },
      { time: 1.11, loop: false }
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index]!;
      assert.equal(context.sampleTime(testCase.time, 1, { loop: testCase.loop }), WaKernelStatus.Ok);
      const raw = sampleClipToPose(fixture.skeleton, fixture.clip, testCase.time, {
        loop: testCase.loop,
        restPose: fixture.skeleton.restPose
      });
      const packedReference = samplePackedRuntimeAnimationToPose(fixture.skeleton, packed, testCase.time, {
        loop: testCase.loop,
        restPose: fixture.skeleton.restPose
      });
      assertPoseNearlyEqual(packedReference, raw, 2e-5, `packed TS/raw parity ${jointCount}/${index}`);
      assertPoseNearlyEqual(
        arena.copyPoseToTransforms(1),
        packedReference,
        6e-5,
        `WASM packed parity ${jointCount}/${index}`
      );
    }
    assert.equal(context.sampleRatio(0, 2, { resetCache: true }), WaKernelStatus.Ok);
    assert.equal(context.sampleRatio(1, 2), WaKernelStatus.Ok);
    assertPoseNearlyEqual(
      arena.copyPoseToTransforms(2),
      samplePackedRuntimeAnimationToPose(fixture.skeleton, packed, packed.duration, { loop: false }),
      6e-5,
      `WASM ratio endpoint ${jointCount}`
    );
    assert.equal(context.reset(), WaKernelStatus.Ok);
    assert.equal(context.sampleTime(0.5, 1, { loop: false }), WaKernelStatus.Ok);
    const repeat = arena.poseView(1).slice();
    assert.equal(context.sampleTime(0.5, 1, { loop: false, resetCache: true }), WaKernelStatus.Ok);
    assert.deepEqual(arena.poseView(1), repeat, `WASM packed deterministic reset ${jointCount}`);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      assert.equal(context.sampleTime(iteration / 30, 1), WaKernelStatus.Ok);
    }
    assert.equal(
      kernel.memory.buffer.byteLength,
      memoryAfterSetup,
      `sampling must not grow memory for ${jointCount} joints`
    );
    assertPaddedIdentity(arena.poseView(1), jointCount);
    assert.equal(arena.localToModel(1), WaKernelStatus.Ok, "sampled SoA slot should feed local-to-model directly");
    assertModelViewNearlyEqual(
      arena.modelPoseView,
      localToModelPose(fixture.skeleton, arena.copyPoseToTransforms(1)),
      `sampled local-to-model ${jointCount}`
    );
    context.destroy();
    asset.destroy();
    arena.destroy();
  }

  const edgeSkeleton = createSkeleton([
    { name: "root", rest: { translation: [3, 4, 5], rotation: [0, 0.3826834324, 0, 0.9238795325], scale: [2, 3, 4] } },
    { name: "child", parentIndex: 0, rest: { translation: [0, 2, 0], scale: [1, 1, 1] } }
  ]);
  const unsupportedClip = {
    id: "unsupported-channel",
    duration: 1,
    loop: false,
    tracks: [
      {
        joint: "root",
        property: "weights" as never,
        times: new Float32Array([0, 1]),
        values: new Float32Array([0, 1])
      }
    ]
  };
  assert.deepEqual(
    sampleClipToPose(edgeSkeleton, unsupportedClip, 0.5, { skipUnsupportedTracks: true }),
    createRestPose(edgeSkeleton),
    "existing scalar object API keeps explicit skip-unsupported semantics outside numeric packed setup"
  );
  assert.throws(
    () => sampleClipToPose(edgeSkeleton, unsupportedClip, 0.5),
    /unsupported animation track property/,
    "unsupported object tracks still reject by default"
  );
  const sourceRest = new Float32Array([0, 0, 0.2588190451, 0.9659258263]);
  const edgeClip = {
    id: "packed-edge-cases",
    duration: 1,
    loop: false,
    tracks: [
      {
        joint: "root",
        property: "rotation" as const,
        times: new Float32Array([0, 0.25, 0.75, 1]),
        values: new Float32Array([
          ...sourceRest,
          0,
          0,
          0.70710677,
          0.70710677,
          0,
          0,
          -0.70710677,
          -0.70710677,
          0,
          0,
          0,
          1
        ]),
        sourceRestQuaternion: sourceRest
      },
      {
        joint: "child",
        property: "translation" as const,
        times: new Float32Array([0, 1]),
        values: new Float32Array([0, 2, 0, Number.NaN, 7, Number.POSITIVE_INFINITY])
      }
    ]
  };
  // Packing validation intentionally rejects non-finite source payloads, so build a finite archive then poison
  // retained WASM values to prove the kernel's finite repair contract independently of importer validation.
  edgeClip.tracks[1]!.values.set([0, 2, 0, 9, 7, 11]);
  const edgePacked = buildPackedRuntimeAnimation(edgeClip, edgeSkeleton);
  const edgeAsset = kernel.createPackedClipAsset(edgeSkeleton, edgePacked);
  const edgeArena = kernel.createPoseArenaContext(edgeSkeleton, { poseCapacity: 6 });
  const edgeContext = edgeArena.createPackedSamplingContext(edgeAsset);
  const edgeReference = samplePackedRuntimeAnimationToPose(edgeSkeleton, edgePacked, 0.5, { loop: false });
  assert.equal(edgeContext.sampleTime(0.5, 1, { loop: false }), WaKernelStatus.Ok);
  assertPoseNearlyEqual(
    edgeArena.copyPoseToTransforms(1),
    edgeReference,
    6e-5,
    "duplicate/source-rest/missing-channel parity"
  );
  const edgeTimesView = new Float32Array(kernel.memory.buffer, edgeAsset.timesOffset, edgePacked.times.length);
  const rotationController = edgePacked.keyControllers.find(
    (controller) => controller.normalizedProperty === "rotation"
  )!;
  edgeTimesView[rotationController.timeOffset + 2] = edgeTimesView[rotationController.timeOffset + 1]!;
  const duplicateClip = {
    ...edgeClip,
    tracks: edgeClip.tracks.map((track) =>
      track.property === "rotation" ? { ...track, times: new Float32Array([0, 0.25, 0.25, 1]) } : track
    )
  };
  assert.equal(edgeContext.sampleTime(0.4, 1, { loop: false, resetCache: true }), WaKernelStatus.Ok);
  assertPoseNearlyEqual(
    edgeArena.copyPoseToTransforms(1),
    sampleClipToPose(edgeSkeleton, duplicateClip, 0.4, { loop: false }),
    6e-5,
    "duplicate key deterministic parity"
  );
  const edgeValueView = new Float32Array(kernel.memory.buffer, edgeAsset.valuesOffset, edgePacked.values.length);
  edgeValueView[edgePacked.keyControllers[0]!.valueOffset + 12] = Number.NaN;
  edgeValueView[edgePacked.keyControllers[1]!.valueOffset + 3] = Number.NaN;
  assert.equal(edgeContext.sampleTime(1, 1, { loop: false, resetCache: true }), WaKernelStatus.Ok);
  assertPoseFinite(edgeArena.copyPoseToTransforms(1), "WASM packed invalid quaternion/vector repair");
  assert.deepEqual(
    edgeArena.copyPoseToTransforms(1)[1]!.scale,
    edgeSkeleton.restPose[1]!.scale,
    "missing scale stays rest"
  );

  assert.equal(
    edgeContext.invokeRawForTests({ outputPoseCapacityBytes: 0 }),
    WaKernelStatus.Capacity,
    "packed sampling output capacity validation"
  );
  assert.equal(
    edgeContext.invokeRawForTests({ outputPoseOffset: kernel.memory.buffer.byteLength + 64 }),
    WaKernelStatus.OutOfBounds,
    "packed sampling output range validation"
  );
  assert.equal(
    edgeContext.invokeRawForTests({ jointCount: edgeArena.jointCount + 1 }),
    WaKernelStatus.InvalidArgument,
    "packed sampling joint capacity validation"
  );
  const oldBuffer = edgeArena.poseView(1).buffer;
  assert.equal(kernel.forceMemoryGrowthForTests(1), WaKernelStatus.Ok);
  assert.notEqual(edgeArena.poseView(1).buffer, oldBuffer, "sampling arena views refresh after memory epoch change");
  assert.equal(edgeContext.sampleTime(0.25, 1), WaKernelStatus.Ok);
  kernel.forceDisableForTests("packed sampling forced fallback");
  const fallback = edgeContext.sampleTimeOrFallback(0.25, 2, { loop: false });
  assert.equal(fallback.kind, "typescript", "forced disable should take explicit scalar TS fallback");
  assertPoseNearlyEqual(
    edgeArena.copyPoseToTransforms(2),
    samplePackedRuntimeAnimationToPose(edgeSkeleton, edgePacked, 0.25, { loop: false }),
    2e-5,
    "forced packed fallback parity"
  );
  kernel.clearForcedDisableForTests();

  const secondFixture = createWasmKernelSyntheticFixture({ jointCount: 2, keyCount: 3, vertexCount: 0, phase: 0.77 });
  const secondPacked = buildPackedRuntimeAnimation(secondFixture.overlayClip, secondFixture.skeleton);
  const secondAsset = kernel.createPackedClipAsset(secondFixture.skeleton, secondPacked);
  const secondArena = kernel.createPoseArenaContext(secondFixture.skeleton, { poseCapacity: 4 });
  const secondContext = secondArena.createPackedSamplingContext(secondAsset);
  assert.equal(secondContext.sampleTime(0.66, 1), WaKernelStatus.Ok);
  assert.equal(edgeContext.sampleTime(0.33, 1, { loop: false }), WaKernelStatus.Ok);
  assertPoseNearlyEqual(
    secondArena.copyPoseToTransforms(1),
    samplePackedRuntimeAnimationToPose(secondFixture.skeleton, secondPacked, 0.66),
    6e-5,
    "multi-clip/multi-avatar independent context"
  );

  const staleContextHandle = secondContext.handle;
  assert.equal(secondContext.destroy(), WaKernelStatus.Ok);
  assert.equal(
    edgeContext.invokeRawForTests({ contextHandle: staleContextHandle, clipHandle: secondAsset.handle }),
    WaKernelStatus.BadHandle,
    "stale packed context generation"
  );
  const staleClipHandle = secondAsset.handle;
  assert.equal(secondAsset.destroy(), WaKernelStatus.Ok);
  assert.equal(
    edgeContext.invokeRawForTests({ clipHandle: staleClipHandle }),
    WaKernelStatus.BadHandle,
    "stale clip generation"
  );
  secondArena.destroy();
  edgeContext.destroy();
  edgeAsset.destroy();
  edgeArena.destroy();
}

function assertWasmPoseJobsParity(kernel: WaifuAnimationWasmKernel): void {
  for (const jointCount of [1, 3, 4, 5, 8, 9]) {
    const paddedSkeleton = createSkeleton(
      Array.from({ length: jointCount }, (_value, joint) => ({
        name: `padded_${joint}`,
        parentIndex: joint === 0 ? -1 : joint - 1,
        rest: { translation: [joint * 0.01, 0.1 + joint * 0.02, -joint * 0.005] as [number, number, number] }
      }))
    );
    const paddedRest = createRestPose(paddedSkeleton);
    const paddedPose = clonePose(paddedRest);
    for (let joint = 0; joint < jointCount; joint += 1) {
      paddedPose[joint]!.translation[0] += 0.025 * (joint + 1);
      paddedPose[joint]!.rotation = [0, Math.sin((joint + 1) * 0.05), 0, Math.cos((joint + 1) * 0.05)];
    }
    const paddedArena = kernel.createPoseArenaContext(paddedSkeleton, {
      poseCapacity: 3,
      maskCapacity: 1,
      layerCapacity: 1
    });
    paddedArena.writePose(1, paddedPose);
    assert.equal(
      paddedArena.blend([{ pose: 1, weight: 0.65 }], { outputPose: 2, threshold: 0.1 }),
      WaKernelStatus.Ok,
      `padded blend ${jointCount}: status`
    );
    assertPoseNearlyEqual(
      paddedArena.copyPoseToTransforms(2),
      blendPoses(paddedSkeleton, [{ pose: paddedPose, weight: 0.65 }], {
        threshold: 0.1,
        fallbackPose: paddedRest
      }),
      3e-5,
      `WASM padded blend ${jointCount}`
    );
    assertPaddedIdentity(paddedArena.poseView(2), jointCount);
    assert.equal(paddedArena.destroy(), WaKernelStatus.Ok, `padded arena ${jointCount}: destroy`);
  }

  const fixture = createWasmKernelSyntheticFixture({ jointCount: 9, keyCount: 4, vertexCount: 0, phase: 0.19 });
  const rest = createRestPose(fixture.skeleton);
  const base = sampleClipToPose(fixture.skeleton, fixture.clip, 0.37, { restPose: rest });
  const overlay = sampleClipToPose(fixture.skeleton, fixture.overlayClip, 0.61, { restPose: rest });
  const additive = sampleClipToPose(fixture.skeleton, fixture.additiveClip, 0.79, { restPose: rest });
  const fallback = clonePose(rest);
  fallback[0]!.translation = [0.25, 0.5, -0.75];
  const arena = kernel.createPoseArenaContext(fixture.skeleton, {
    poseCapacity: 10,
    maskCapacity: 4,
    maskValueCapacity: 11,
    layerCapacity: 6
  });
  arena.writePose(1, base);
  arena.writePose(2, overlay);
  arena.writePose(3, additive);
  arena.writePose(4, fallback);

  const zeroMask = new Float32Array(fixture.skeleton.joints.length);
  const shortMask = new Float32Array([1, 0.5, Number.NaN]);
  const denseSparseMask = new Float32Array(fixture.skeleton.joints.length);
  denseSparseMask[1] = 1;
  denseSparseMask[4] = 0.25;
  denseSparseMask[6] = -1;
  denseSparseMask[8] = 0.75;
  arena.writeMask(0, zeroMask);
  arena.writeMask(1, shortMask);
  arena.writeSparseMask(
    2,
    [
      { joint: 1, weight: 1 },
      { joint: 4, weight: 0.25 },
      { joint: 6, weight: -1 },
      { joint: 8, weight: 0.75 },
      { joint: 99, weight: 1 },
      { joint: -1, weight: 1 }
    ],
    fixture.skeleton.joints.length
  );
  const extraMask = new Float32Array(11);
  extraMask.fill(0.4);
  extraMask[9] = 999;
  extraMask[10] = Number.POSITIVE_INFINITY;
  arena.writeMask(3, extraMask);

  const blendCases: Array<{
    label: string;
    layers: Parameters<typeof arena.blend>[0];
    options: Parameters<typeof arena.blend>[1];
    reference: ReturnType<typeof blendPoses>;
  }> = [
    {
      label: "single override",
      layers: [{ pose: 1, weight: 0.75 }],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(fixture.skeleton, [{ pose: base, weight: 0.75 }], { threshold: 0.1, fallbackPose: rest })
    },
    {
      label: "multiple override and full mask",
      layers: [
        { pose: 1, weight: 0.7 },
        { pose: 2, weight: 0.35 }
      ],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(
        fixture.skeleton,
        [
          { pose: base, weight: 0.7 },
          { pose: overlay, weight: 0.35 }
        ],
        { threshold: 0.1, fallbackPose: rest }
      )
    },
    {
      label: "threshold custom fallback",
      layers: [{ pose: 1, weight: 0.02 }],
      options: { outputPose: 5, threshold: 0.2, fallbackPose: 4 },
      reference: blendPoses(fixture.skeleton, [{ pose: base, weight: 0.02 }], {
        threshold: 0.2,
        fallbackPose: fallback
      })
    },
    {
      label: "negative threshold clamps to zero",
      layers: [{ pose: 1, weight: 0.02 }],
      options: { outputPose: 5, threshold: -1, fallbackPose: 4 },
      reference: blendPoses(fixture.skeleton, [{ pose: base, weight: 0.02 }], {
        threshold: -1,
        fallbackPose: fallback
      })
    },
    {
      label: "zero mask",
      layers: [{ pose: 2, weight: 1, mask: 0 }],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(fixture.skeleton, [{ pose: overlay, weight: 1, mask: zeroMask }], {
        threshold: 0.1,
        fallbackPose: rest
      })
    },
    {
      label: "short invalid mask",
      layers: [{ pose: 2, weight: 0.8, mask: 1 }],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(fixture.skeleton, [{ pose: overlay, weight: 0.8, mask: shortMask }], {
        threshold: 0.1,
        fallbackPose: rest
      })
    },
    {
      label: "sparse-by-zero mask and ignored out-of-range entries",
      layers: [{ pose: 2, weight: 0.8, mask: 2 }],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(fixture.skeleton, [{ pose: overlay, weight: 0.8, mask: denseSparseMask }], {
        threshold: 0.1,
        fallbackPose: rest
      })
    },
    {
      label: "extra dense mask values ignored",
      layers: [{ pose: 2, weight: 0.8, mask: 3 }],
      options: { outputPose: 5, threshold: 0.1 },
      reference: blendPoses(fixture.skeleton, [{ pose: overlay, weight: 0.8, mask: extraMask }], {
        threshold: 0.1,
        fallbackPose: rest
      })
    },
    {
      label: "zero negative and nonfinite layer weights",
      layers: [
        { pose: 1, weight: 0 },
        { pose: 2, weight: -1 },
        { pose: 3, weight: Number.NaN }
      ],
      options: { outputPose: 5, threshold: Number.NaN },
      reference: blendPoses(
        fixture.skeleton,
        [
          { pose: base, weight: 0 },
          { pose: overlay, weight: -1 },
          { pose: additive, weight: Number.NaN }
        ],
        { threshold: Number.NaN, fallbackPose: rest }
      )
    }
  ];
  for (const testCase of blendCases) {
    assert.equal(arena.blend(testCase.layers, testCase.options), WaKernelStatus.Ok, `${testCase.label}: status`);
    assertPoseNearlyEqual(
      arena.copyPoseToTransforms(testCase.options.outputPose),
      testCase.reference,
      3e-5,
      `WASM blend ${testCase.label}`
    );
  }

  const antipode = clonePose(overlay);
  antipode[3]!.rotation = antipode[3]!.rotation.map((value) => -value) as [number, number, number, number];
  arena.writePose(2, antipode);
  assert.equal(
    arena.blend(
      [
        { pose: 1, weight: 0.5 },
        { pose: 2, weight: 0.5 }
      ],
      { outputPose: 5, threshold: 0 }
    ),
    WaKernelStatus.Ok,
    "quaternion antipode blend status"
  );
  assertPoseNearlyEqual(
    arena.copyPoseToTransforms(5),
    blendPoses(
      fixture.skeleton,
      [
        { pose: base, weight: 0.5 },
        { pose: antipode, weight: 0.5 }
      ],
      { threshold: 0, fallbackPose: rest }
    ),
    3e-5,
    "WASM quaternion hemisphere accumulation"
  );

  const invalidOverlay = clonePose(overlay);
  invalidOverlay[2]!.translation = [Number.NaN, 0, 0];
  arena.writePose(2, overlay);
  setSoaComponent(arena.poseView(2), 2, 0, Number.NaN);
  assert.equal(arena.blend([{ pose: 2, weight: 1 }], { outputPose: 5, threshold: 0.1 }), WaKernelStatus.Ok);
  assertPoseNearlyEqual(
    arena.copyPoseToTransforms(5),
    blendPoses(fixture.skeleton, [{ pose: invalidOverlay, weight: 1 }], { threshold: 0.1, fallbackPose: rest }),
    3e-5,
    "WASM invalid layer transform skip and finite fallback"
  );
  assert.ok(Array.from(arena.poseView(5)).every(Number.isFinite), "blend output and padded lanes should be finite");
  arena.writePose(2, overlay);

  const invalidFallback = clonePose(fallback);
  invalidFallback[0]!.rotation = [Number.NaN, 0, 0, 0];
  arena.writePose(4, fallback);
  setSoaComponent(arena.poseView(4), 0, 3, Number.NaN);
  assert.equal(
    arena.blend([], { outputPose: 5, threshold: 0, fallbackPose: 4 }),
    WaKernelStatus.Ok,
    "invalid custom fallback status"
  );
  assertPoseNearlyEqual(
    arena.copyPoseToTransforms(5),
    blendPoses(fixture.skeleton, [], { threshold: 0, fallbackPose: invalidFallback }),
    3e-5,
    "WASM invalid fallback should resolve to skeleton rest"
  );
  arena.writePose(4, fallback);

  assert.equal(arena.additiveDelta(0, 3, 6), WaKernelStatus.Ok, "additive delta generation status");
  assertPoseNearlyEqual(
    arena.copyPoseToTransforms(6),
    additiveDeltaPose(rest, additive),
    3e-5,
    "WASM additive delta generation"
  );
  const additiveWeights = [0.35, -0.35, 0, Number.NaN];
  for (const weight of additiveWeights) {
    assert.equal(arena.applyAdditive(1, 6, weight, 7, 2), WaKernelStatus.Ok, `additive weight ${weight}: status`);
    assertPoseNearlyEqual(
      arena.copyPoseToTransforms(7),
      applyAdditivePose(base, additiveDeltaPose(rest, additive), weight, denseSparseMask),
      4e-5,
      `WASM additive signed weight ${weight}`
    );
  }

  const scaleRest = clonePose(rest);
  const scaleSample = clonePose(additive);
  scaleRest[1]!.scale = [0, -0, -2];
  scaleSample[1]!.scale = [2, -3, 0];
  arena.writePose(0, scaleRest);
  arena.writePose(3, scaleSample);
  assert.equal(arena.additiveDelta(0, 3, 6), WaKernelStatus.Ok, "scale edge delta status");
  assertPoseNearlyEqual(
    arena.copyPoseToTransforms(6),
    additiveDeltaPose(scaleRest, scaleSample),
    6e-5,
    "WASM additive scale zero and negative edge cases"
  );
  arena.writePose(0, rest);
  arena.writePose(3, additive);
  assert.equal(arena.additiveDelta(0, 3, 6), WaKernelStatus.Ok);

  const delta = additiveDeltaPose(rest, additive);
  assert.equal(arena.applyAdditive(1, 6, 0.2, 7, 2), WaKernelStatus.Ok);
  assert.equal(arena.applyAdditive(7, 6, -0.1, 8, 1), WaKernelStatus.Ok);
  const orderedReference = applyAdditivePose(
    applyAdditivePose(base, delta, 0.2, denseSparseMask),
    delta,
    -0.1,
    shortMask
  );
  assertPoseNearlyEqual(arena.copyPoseToTransforms(8), orderedReference, 5e-5, "WASM additive layer ordering");

  setSoaComponent(arena.poseView(8), 0, 0, Number.NaN);
  setSoaComponent(arena.poseView(8), 1, 6, Number.POSITIVE_INFINITY);
  setSoaComponent(arena.poseView(8), 2, 7, Number.NEGATIVE_INFINITY);
  assert.equal(arena.normalize(8, 9), WaKernelStatus.Ok, "finite repair normalize status");
  assert.ok(Array.from(arena.poseView(9)).every(Number.isFinite), "normalized pose including padding should be finite");
  assertPaddedIdentity(arena.poseView(9), arena.jointCount);

  const retainedPoseView = arena.poseView(5);
  const retainedMaskView = arena.maskView(2);
  const retainedPoseOffset = arena.poseOffset(5);
  const materialized = arena.copyPoseToTransforms(5);
  const firstTransform = materialized[0];
  assert.equal(arena.blend([{ pose: 1, weight: 1 }], { outputPose: 5, threshold: 0.1 }), WaKernelStatus.Ok);
  assert.equal(arena.poseView(5), retainedPoseView, "steady-state pose view should be retained");
  assert.equal(arena.maskView(2), retainedMaskView, "steady-state mask view should be retained");
  assert.equal(arena.poseOffset(5), retainedPoseOffset, "caller-owned output offset should remain stable");
  assert.equal(arena.copyPoseToTransforms(5, materialized), materialized, "materialization should reuse caller array");
  assert.equal(materialized[0], firstTransform, "materialization should reuse caller transforms");
  const repeatA = Array.from(arena.poseView(5));
  assert.equal(arena.blend([{ pose: 1, weight: 1 }], { outputPose: 5, threshold: 0.1 }), WaKernelStatus.Ok);
  assert.deepEqual(Array.from(arena.poseView(5)), repeatA, "pose jobs should repeat deterministically");

  assert.equal(arena.invokeRawBlendForTests({ avatarHandle: 0 }), WaKernelStatus.BadHandle, "blend bad handle");
  assert.equal(
    arena.invokeRawBlendForTests({ fallbackPoseOffset: 3 }),
    WaKernelStatus.InvalidArgument,
    "blend misaligned fallback offset"
  );
  assert.equal(
    arena.invokeRawBlendForTests({ outputPoseCapacityBytes: 0 }),
    WaKernelStatus.Capacity,
    "blend output capacity"
  );
  assert.equal(
    arena.invokeRawBlendForTests({ layerCount: 1, layersCapacityBytes: 0 }),
    WaKernelStatus.Capacity,
    "blend descriptor capacity"
  );
  assert.equal(
    arena.invokeRawBlendForTests({
      layerCount: 1,
      layersOffset: kernel.memory.buffer.byteLength + 64,
      layersCapacityBytes: 24
    }),
    WaKernelStatus.OutOfBounds,
    "blend descriptor range"
  );
  const rawView = new DataView(kernel.memory.buffer);
  rawView.setUint32(arena.layerDescriptorsOffset + 12, arena.maskOffset(2), true);
  rawView.setUint32(arena.layerDescriptorsOffset + 16, arena.jointCount, true);
  rawView.setUint32(arena.layerDescriptorsOffset + 20, 0, true);
  assert.equal(
    arena.invokeRawBlendForTests({ layerCount: 1 }),
    WaKernelStatus.Capacity,
    "blend mask descriptor capacity"
  );
  assert.equal(
    arena.invokeRawAdditiveDeltaForTests({ samplePoseCapacityBytes: 0 }),
    WaKernelStatus.Capacity,
    "additive pose capacity"
  );
  assert.equal(
    arena.invokeRawAdditiveDeltaForTests({ samplePoseOffset: kernel.memory.buffer.byteLength + 64 }),
    WaKernelStatus.OutOfBounds,
    "additive pose range"
  );

  const oldBuffer = arena.poseView(1).buffer;
  assert.equal(kernel.forceMemoryGrowthForTests(1), WaKernelStatus.Ok, "pose arena memory growth status");
  assert.notEqual(arena.poseView(1).buffer, oldBuffer, "pose arena should refresh views after memory growth");
  assert.equal(arena.blend([{ pose: 1, weight: 1 }], { outputPose: 5 }), WaKernelStatus.Ok);

  kernel.forceDisableForTests("pose jobs forced fallback");
  assert.equal(arena.blend([{ pose: 1, weight: 1 }], { outputPose: 5 }), WaKernelStatus.Unsupported);
  assert.equal(arena.applyAdditive(1, 6, 0.2, 7), WaKernelStatus.Unsupported);
  kernel.clearForcedDisableForTests();
}

function setSoaComponent(view: Float32Array, joint: number, field: number, value: number): void {
  const groupBase = (joint >> 2) * 40;
  view[groupBase + field * 4 + (joint & 3)] = value;
}

function assertPaddedIdentity(view: Float32Array, jointCount: number): void {
  const paddedCount = Math.ceil(jointCount / 4) * 4;
  for (let joint = jointCount; joint < paddedCount; joint += 1) {
    const expected = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
    for (let field = 0; field < expected.length; field += 1) {
      const groupBase = (joint >> 2) * 40;
      assert.equal(view[groupBase + field * 4 + (joint & 3)], expected[field], `padded joint ${joint} field ${field}`);
    }
  }
}

async function loadRequiredKernel(): Promise<WaifuAnimationWasmKernel> {
  const bytes = ensureWasmKernelBytes();
  const result = await loadWaifuAnimationWasmKernel({ source: { bytes } });
  assert.equal(result.kind, "wasm-scalar", result.kind === "typescript" ? result.reason : "WASM kernel should load");
  return result.kernel;
}

function ensureWasmKernelBytes(): ArrayBuffer {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "build-wasm-kernel.mjs")], {
    cwd: REPO_ROOT,
    stdio: "inherit"
  });
  assert.equal(result.status, 0, "WASM kernel build script should succeed for contract tests");
  const path = existsSync(WASM_DIST_PATH) ? WASM_DIST_PATH : WASM_TARGET_PATH;
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function assertModelPosesNearlyEqual(
  actual: readonly Float32Array[],
  expected: readonly Float32Array[],
  label: string
): void {
  assert.equal(actual.length, expected.length, `${label}: joint count`);
  for (let joint = 0; joint < actual.length; joint += 1) {
    assertMat4NearlyEqual(actual[joint]!, expected[joint]!, 2e-5, `${label}: joint ${joint}`);
  }
}

function assertModelViewNearlyEqual(actual: Float32Array, expected: readonly Float32Array[], label: string): void {
  assert.equal(actual.length, expected.length * 16, `${label}: matrix float count`);
  for (let joint = 0; joint < expected.length; joint += 1) {
    assertMat4NearlyEqual(
      actual.subarray(joint * 16, joint * 16 + 16),
      expected[joint]!,
      2e-4,
      `${label}: joint ${joint}`
    );
  }
}

function multiplyRootForReference(root: Float32Array, matrix: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        root[row]! * matrix[col * 4]! +
        root[4 + row]! * matrix[col * 4 + 1]! +
        root[8 + row]! * matrix[col * 4 + 2]! +
        root[12 + row]! * matrix[col * 4 + 3]!;
    }
  }
  return out;
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
