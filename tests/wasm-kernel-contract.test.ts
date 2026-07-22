import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WaifuAnimationWasmKernel } from "./test-api.js";
import {
  AnimationSamplingContext,
  WA_KERNEL_ABI_MAJOR,
  WA_KERNEL_FEATURE_SCALAR_LOCAL_TO_MODEL,
  WaKernelStatus,
  applyAimIkChainToPose,
  applyAimIkModelCorrection,
  applyTwoBoneIkLocalCorrections,
  assert,
  blendPoses,
  clonePose,
  createRestPose,
  createSkeleton,
  detectWaKernelSimdSupport,
  localToModelPose,
  loadWaifuAnimationWasmKernel,
  normalizePose,
  sampleClipToPose,
  sampleClipToPoseWithContext,
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

  const disabledContext = kernel.createLocalToModelContext(fixture.skeleton);
  kernel.forceDisableForTests("unit-test forced disable");
  const fallbackOut = updateLocalToModelPoseRange(fixture.skeleton, animatedPose, [], { kernel: disabledContext });
  assertModelPosesNearlyEqual(fallbackOut, localToModelPose(fixture.skeleton, animatedPose), "forced disable fallback");
  kernel.clearForcedDisableForTests();
}

async function loadRequiredKernel(): Promise<WaifuAnimationWasmKernel> {
  const bytes = ensureWasmKernelBytes();
  const result = await loadWaifuAnimationWasmKernel({ source: { bytes } });
  assert.equal(result.kind, "wasm-scalar", result.kind === "typescript" ? result.reason : "WASM kernel should load");
  return result.kernel;
}

function ensureWasmKernelBytes(): ArrayBuffer {
  if (!existsSync(WASM_DIST_PATH) && !existsSync(WASM_TARGET_PATH)) {
    const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "build-wasm-kernel.mjs")], {
      cwd: REPO_ROOT,
      stdio: "inherit"
    });
    assert.equal(result.status, 0, "WASM kernel build script should succeed for contract tests");
  }
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
