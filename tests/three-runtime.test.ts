import type { AnimationClip } from "./test-api.js";
import {
  AnimationMixer,
  LoopOnce,
  Object3D,
  Quaternion,
  WAIFU_ANIMATION_BINARY_FORMAT,
  adaptNormalizedHumanoidRotationValuesForTargetVrmMetaVersion,
  assert,
  calculateThreeBaseLoopSeamWindow,
  calculateThreeBaseLoopTransitionWeights,
  calculateThreeOverlayFade,
  calculateThreeRuntimeInfluence,
  calculateThreeRuntimeStartTime,
  createThreeAnimationClip,
  createThreeRuntimeClipsForEntry,
  normalizedHumanoidDeltaFromSourceLocalSample,
  prepareThreeRuntimeAction,
  quatFromAxisAngle,
  readActiveThreeRuntimeClipSnapshots,
  readThreeRuntimeClipSnapshot,
  toFloat32Array
} from "./test-api.js";
import {
  makeRuntimeActionStub,
  makeRuntimeClipDiagnosticStub,
  nodClip,
  quaternionNearlyEqual,
  sampleThreeClipOnce
} from "./test-helpers.js";

export async function runThreeRuntimeTests(): Promise<void> {
  const headBone = new Object3D();
  headBone.name = "normalizedHead";
  const threeClip = createThreeAnimationClip(nodClip, {
    resolveBone: (humanBone) => (humanBone === "head" ? headBone : null)
  });
  assert.equal(threeClip.name, "nod");
  assert.equal(threeClip.tracks.length, 1);
  assert.equal(threeClip.tracks[0]!.name, `${headBone.uuid}.quaternion`);
  const nonFiniteDurationClip = createThreeAnimationClip(
    { ...nodClip, id: "non-finite-duration", duration: Number.NaN },
    {
      resolveBone: (humanBone) => (humanBone === "head" ? headBone : null)
    }
  );
  assert.equal(
    Number.isFinite(nonFiniteDurationClip.duration),
    true,
    "Three clip creation should not emit non-finite durations"
  );
  const staticThreeRoot = new Object3D();
  const staticThreeBone = new Object3D();
  staticThreeBone.name = "staticHead";
  staticThreeRoot.add(staticThreeBone);
  const staticThreeRotation = quatFromAxisAngle([0, 1, 0], Math.PI / 4);
  const staticThreeClip = createThreeAnimationClip(
    {
      id: "static-one-key-three",
      duration: 1,
      tracks: [
        {
          humanBone: "head",
          property: "quaternion",
          times: toFloat32Array([0]),
          values: toFloat32Array(staticThreeRotation)
        }
      ]
    },
    {
      resolveBone: (humanBone) => (humanBone === "head" ? staticThreeBone : null)
    }
  );
  assert.equal(staticThreeClip.tracks.length, 1, "Three binding should preserve valid single-key static pose tracks");
  assert.deepEqual(
    Array.from(staticThreeClip.tracks[0]!.times),
    [0, 1],
    "single-key Three tracks should be held across the runtime clip window"
  );
  sampleThreeClipOnce(staticThreeRoot, staticThreeClip, 0.5);
  assert.ok(
    quaternionNearlyEqual(staticThreeBone.quaternion.toArray(), staticThreeRotation, 1e-5),
    "single-key Three tracks should sample as static local rotations through AnimationMixer"
  );

  const canonicalVrm0SourceValues = [0.1, 0.2, 0.3, 0.9273618495, -0.4, 0.5, -0.1, 0.7615773106];
  const pixivOfficialVrm0Rule = canonicalVrm0SourceValues.map((value, index) => (index % 2 === 0 ? -value : value));
  assert.deepEqual(
    adaptNormalizedHumanoidRotationValuesForTargetVrmMetaVersion(canonicalVrm0SourceValues, "0"),
    pixivOfficialVrm0Rule,
    "VRM0 target normalized-humanoid rotations must match Pixiv's official quaternion X/Z sign adaptation"
  );
  assert.deepEqual(
    adaptNormalizedHumanoidRotationValuesForTargetVrmMetaVersion(canonicalVrm0SourceValues, "1"),
    canonicalVrm0SourceValues,
    "VRM1 target normalized-humanoid rotations must not receive the VRM0 sign adaptation"
  );
  const canonicalVrm0Bone = new Object3D();
  const canonicalVrm0Clip = createThreeAnimationClip(
    {
      id: "canonical-vrm0-target-adaptation",
      duration: 1,
      tracks: [
        {
          humanBone: "head",
          property: "quaternion",
          rotationSpace: "normalized-humanoid-delta",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array(canonicalVrm0SourceValues)
        }
      ]
    },
    {
      resolveBone: (humanBone) => (humanBone === "head" ? canonicalVrm0Bone : null),
      targetVrmMetaVersion: "0"
    }
  );
  const canonicalVrm0ActualValues = Array.from(canonicalVrm0Clip.tracks[0]!.values);
  assert.ok(
    canonicalVrm0ActualValues.every((value, index) => Math.abs(value - pixivOfficialVrm0Rule[index]!) < 1e-6),
    "Three binding should adapt canonical normalized-delta tracks for VRM0 targets without rebaking assets"
  );

  const officialNormalizedDelta = (
    parentWorldRest: readonly number[],
    sourceLocalSample: readonly number[],
    sourceLocalRest: readonly number[]
  ): number[] => {
    const parent = new Quaternion().fromArray(parentWorldRest).normalize();
    const parentInverse = parent.clone().invert();
    const sample = new Quaternion().fromArray(sourceLocalSample).normalize();
    const restInverse = new Quaternion().fromArray(sourceLocalRest).normalize().invert();
    return parent.clone().multiply(sample).multiply(restInverse).multiply(parentInverse).normalize().toArray();
  };
  const oracleBones = [
    "hips",
    "spine",
    "leftUpperArm",
    "rightUpperArm",
    "leftLowerArm",
    "rightLowerArm",
    "leftUpperLeg",
    "rightUpperLeg",
    "leftLowerLeg",
    "rightLowerLeg",
    "leftFoot",
    "rightFoot"
  ];
  const oracleParent = quatFromAxisAngle([0.31, 0.87, -0.22], 0.64);
  const oracleRest = quatFromAxisAngle([0.12, -0.28, 0.95], -0.37);
  const hingeThirty = quatFromAxisAngle([1, 0, 0], Math.PI / 6);
  const twistPreserved = quatFromAxisAngle([0, 1, 0], -Math.PI / 7);
  for (const bone of oracleBones) {
    const sample = new Quaternion()
      .fromArray(hingeThirty)
      .multiply(new Quaternion().fromArray(twistPreserved))
      .toArray();
    assert.ok(
      quaternionNearlyEqual(
        normalizedHumanoidDeltaFromSourceLocalSample(oracleParent, sample, oracleRest),
        officialNormalizedDelta(oracleParent, sample, oracleRest),
        1e-6
      ),
      `${bone} canonical bake must match Pixiv helper order P*S*R^-1*P^-1 and preserve hinge+twist`
    );
  }
  assert.ok(
    quaternionNearlyEqual(
      normalizedHumanoidDeltaFromSourceLocalSample(oracleParent, oracleRest, oracleRest),
      [0, 0, 0, 1],
      1e-6
    ),
    "identity rest samples should bake to identity normalized deltas"
  );
  const symmetricLeft = normalizedHumanoidDeltaFromSourceLocalSample(oracleParent, hingeThirty, [0, 0, 0, 1]);
  const symmetricRight = normalizedHumanoidDeltaFromSourceLocalSample(
    [-oracleParent[0], oracleParent[1], -oracleParent[2], oracleParent[3]],
    [-hingeThirty[0], hingeThirty[1], -hingeThirty[2], hingeThirty[3]],
    [0, 0, 0, 1]
  );
  assert.ok(
    Math.abs(symmetricLeft[0] + symmetricRight[0]) < 1e-6 &&
      Math.abs(symmetricLeft[1] - symmetricRight[1]) < 1e-6 &&
      Math.abs(symmetricLeft[2] + symmetricRight[2]) < 1e-6 &&
      Math.abs(symmetricLeft[3] - symmetricRight[3]) < 1e-6,
    "mirrored normalized-delta inputs should preserve VRM-style X/Z quaternion symmetry"
  );

  const invalidThreeTrackWarnings: string[] = [];
  const invalidThreeTimeClip = createThreeAnimationClip(
    {
      id: "invalid-three-time",
      duration: 1,
      tracks: [
        {
          humanBone: "head",
          property: "quaternion",
          times: toFloat32Array([0, Number.NaN]),
          values: toFloat32Array([0, 0, 0, 1, 0, 0, 0, 1])
        }
      ]
    },
    {
      resolveBone: (humanBone) => (humanBone === "head" ? headBone : null),
      logger: {
        warn: (...parts: unknown[]) => {
          invalidThreeTrackWarnings.push(parts.map(String).join(" "));
        }
      }
    }
  );
  assert.equal(
    invalidThreeTimeClip.tracks.length,
    0,
    "Three binding should skip tracks with non-finite keyframe times"
  );
  assert.ok(
    invalidThreeTrackWarnings.some((message) => message.includes("invalid animation track skipped")),
    "Three binding should report skipped malformed keyframe tracks"
  );

  const duplicateRoot = new Object3D();
  const duplicateWrongBone = new Object3D();
  duplicateWrongBone.name = "duplicateHead";
  const duplicateTargetBone = new Object3D();
  duplicateTargetBone.name = "duplicateHead";
  duplicateRoot.add(duplicateWrongBone);
  duplicateRoot.add(duplicateTargetBone);
  const duplicateBoundClip = createThreeAnimationClip(nodClip, {
    resolveBone: (humanBone) => (humanBone === "head" ? duplicateTargetBone : null)
  });
  const duplicateMixer = new AnimationMixer(duplicateRoot);
  const duplicateAction = duplicateMixer.clipAction(duplicateBoundClip);
  duplicateAction.setLoop(LoopOnce, 1);
  duplicateAction.play();
  duplicateMixer.setTime(0.5);
  assert.ok(
    Math.abs(duplicateWrongBone.quaternion.x) < 1e-6,
    "uuid binding should not animate the first same-named node"
  );
  assert.ok(Math.abs(duplicateTargetBone.quaternion.x) > 0.1, "uuid binding should animate the resolved target bone");

  const root = new Object3D();
  const mixer = new AnimationMixer(root);
  const runtimeClips = createThreeRuntimeClipsForEntry(
    { id: "nod", label: "Nod", url: "/nod.waifuanim.bin", format: WAIFU_ANIMATION_BINARY_FORMAT, loop: true },
    mixer,
    threeClip
  );
  assert.equal(runtimeClips.length, 2);
  assert.equal(runtimeClips[0]!.lane, "base");
  assert.equal(runtimeClips[1]!.instance, 1);

  const hipsTranslationRuntimeRoot = new Object3D();
  const hipsTranslationBone = new Object3D();
  hipsTranslationBone.name = "hips";
  hipsTranslationRuntimeRoot.add(hipsTranslationBone);
  const hipsTranslationSourceClip: AnimationClip = {
    id: "hips-translation-source",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "hips",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0.25, 0])
      }
    ]
  };
  const preservedHipsTranslationClip = createThreeAnimationClip(hipsTranslationSourceClip, {
    resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
  });
  createThreeRuntimeClipsForEntry(
    {
      id: "preserved-hips-translation",
      label: "Preserved Hips Translation",
      url: "/preserved-hips-translation.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      source: { rootMotion: { policy: "preserved" } }
    },
    new AnimationMixer(hipsTranslationRuntimeRoot),
    preservedHipsTranslationClip
  );
  assert.equal(
    preservedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
    true,
    "preserved root-motion runtime clips should keep hips position tracks for the Three mixer"
  );
  const metadataPreservedHipsTranslationClip = createThreeAnimationClip(
    {
      ...hipsTranslationSourceClip,
      id: "metadata-preserved-hips-translation",
      metadata: { rootMotionPolicy: "preserved" }
    },
    {
      resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
    }
  );
  createThreeRuntimeClipsForEntry(
    {
      id: "metadata-preserved-hips-translation",
      label: "Metadata Preserved Hips Translation",
      url: "/metadata-preserved-hips-translation.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    new AnimationMixer(hipsTranslationRuntimeRoot),
    metadataPreservedHipsTranslationClip
  );
  assert.equal(
    metadataPreservedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
    true,
    "clip metadata rootMotionPolicy=preserved should survive Three binding and keep hips position tracks"
  );
  const strippedHipsTranslationClip = createThreeAnimationClip(hipsTranslationSourceClip, {
    resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
  });
  const strippedHipsRuntimeClips = createThreeRuntimeClipsForEntry(
    {
      id: "stripped-hips-translation",
      label: "Stripped Hips Translation",
      url: "/stripped-hips-translation.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    new AnimationMixer(hipsTranslationRuntimeRoot),
    strippedHipsTranslationClip
  );
  assert.equal(
    strippedHipsTranslationClip.duration,
    1,
    "runtime root-translation stripping should preserve the playback duration even when no tracks remain"
  );
  assert.deepEqual(
    strippedHipsRuntimeClips.map((clip) => clip.duration),
    [1, 1],
    "stripped in-place base clip instances should keep the source playback duration for mixer scheduling"
  );
  assert.equal(
    strippedHipsTranslationClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
    false,
    "stripped-to-in-place runtime clips should still remove root carrier position tracks"
  );
  const verticalTransitionClip = createThreeAnimationClip(hipsTranslationSourceClip, {
    resolveBone: (humanBone) => (humanBone === "hips" ? hipsTranslationBone : null)
  });
  createThreeRuntimeClipsForEntry(
    {
      id: "vertical-transition-hips-y",
      label: "Vertical Transition Hips Y",
      url: "/vertical-transition-hips-y.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: false,
      source: {
        rootMotion: {
          policy: "stripped-to-in-place",
          provenance: "preserved-in-clip",
          owner: "director-xz",
          carrier: "hips",
          units: "meters-target-rest-offset",
          bakeMode: "reference",
          extractedAxes: ["x", "z"],
          preservedAxes: ["y"],
          support: "vertical-transition"
        }
      }
    },
    new AnimationMixer(hipsTranslationRuntimeRoot),
    verticalTransitionClip
  );
  assert.equal(
    verticalTransitionClip.tracks.some((track) => track.name === `${hipsTranslationBone.uuid}.position`),
    true,
    "non-looping vertical-transition runtime clips should retain the explicitly owned hips Y track"
  );

  const namedRootCarrierRuntimeRoot = new Object3D();
  const rootTranslationBone = new Object3D();
  rootTranslationBone.name = "root";
  const pelvisTranslationBone = new Object3D();
  pelvisTranslationBone.name = "pelvis";
  namedRootCarrierRuntimeRoot.add(rootTranslationBone);
  namedRootCarrierRuntimeRoot.add(pelvisTranslationBone);
  const namedRootCarrierSourceClip: AnimationClip = {
    id: "named-root-carrier-translation-source",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0.25, 0, 0])
      },
      {
        joint: "pelvis",
        property: "position",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 0.25])
      }
    ]
  };
  const strippedNamedRootCarrierClip = createThreeAnimationClip(namedRootCarrierSourceClip, {
    resolveBone: (bone) => {
      if (bone === "root") return rootTranslationBone;
      if (bone === "pelvis") return pelvisTranslationBone;
      return null;
    }
  });
  assert.equal(
    strippedNamedRootCarrierClip.tracks.some(
      (track) =>
        track.name === `${rootTranslationBone.uuid}.position` || track.name === `${pelvisTranslationBone.uuid}.position`
    ),
    true,
    "root carrier fixture should bind root and pelvis position tracks before runtime policy stripping"
  );
  createThreeRuntimeClipsForEntry(
    {
      id: "stripped-named-root-carrier-translation",
      label: "Stripped Named Root Carrier Translation",
      url: "/stripped-named-root-carrier-translation.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    new AnimationMixer(namedRootCarrierRuntimeRoot),
    strippedNamedRootCarrierClip
  );
  assert.equal(
    strippedNamedRootCarrierClip.tracks.some(
      (track) =>
        track.name === `${rootTranslationBone.uuid}.position` || track.name === `${pelvisTranslationBone.uuid}.position`
    ),
    false,
    "stripped-to-in-place runtime clips should remove root and pelvis position tracks after UUID binding"
  );

  assert.equal(calculateThreeRuntimeStartTime(-1, { startTime: 4 }), 0);
  assert.equal(calculateThreeRuntimeStartTime(2, { startTime: -0.25 }), 0);
  assert.equal(calculateThreeRuntimeStartTime(2, { startTime: 2.25 }), 0.25);
  assert.equal(
    calculateThreeRuntimeStartTime(4, { matchPhaseFrom: { action: { time: 1.5 }, duration: 3 }, random: () => 0.9 }),
    2
  );
  assert.equal(calculateThreeRuntimeStartTime(4, { random: () => 0.25 }), 1);
  assert.equal(calculateThreeRuntimeStartTime(4, { random: () => Number.NaN }), 0);
  assert.equal(calculateThreeRuntimeStartTime(4, { randomizeBaseTime: false }), 0);

  const preparedBaseAction = makeRuntimeActionStub(0.75);
  const preparedBaseClip = makeRuntimeClipDiagnosticStub({
    id: "prepared-base",
    label: "Prepared Base",
    lane: "base",
    weight: 0,
    targetWeight: 0,
    time: 0,
    duration: 4,
    scheduled: false,
    running: false,
    action: preparedBaseAction
  });
  const preparedStartTime = prepareThreeRuntimeAction(preparedBaseClip, {
    matchPhaseFrom: { action: { time: 1.5 }, duration: 3 },
    weight: 2,
    timeScale: Number.NaN
  });
  assert.equal(preparedStartTime, 2);
  assert.equal(preparedBaseAction.time, 2);
  assert.equal(preparedBaseAction.enabled, true);
  assert.equal(preparedBaseAction.paused, false);
  assert.equal(preparedBaseAction.effectiveWeight, 1);
  assert.equal(preparedBaseAction.effectiveTimeScale, 1);
  assert.equal(preparedBaseAction.resetCount, 1);
  assert.equal(preparedBaseAction.playCount, 1);
  assert.equal(preparedBaseAction.stopFadingCount, 1);
  assert.equal(preparedBaseAction.stopWarpingCount, 1);

  const preparedOverlayAction = makeRuntimeActionStub(0);
  const preparedOverlayClip = makeRuntimeClipDiagnosticStub({
    id: "prepared-overlay",
    label: "Prepared Overlay",
    lane: "overlay",
    weight: 0,
    targetWeight: 0,
    time: 0,
    duration: 1,
    scheduled: false,
    running: false,
    action: preparedOverlayAction
  });
  assert.equal(prepareThreeRuntimeAction(preparedOverlayClip, { startTime: 0.8, weight: -1, timeScale: 1.25 }), 0);
  assert.equal(preparedOverlayAction.time, 0);
  assert.equal(preparedOverlayAction.effectiveWeight, 0);
  assert.equal(preparedOverlayAction.effectiveTimeScale, 1.25);

  assert.equal(calculateThreeBaseLoopSeamWindow(Number.NaN), 0.32);
  assert.equal(calculateThreeBaseLoopSeamWindow(2), 0.36);
  assert.equal(calculateThreeBaseLoopSeamWindow(10), 0.72);
  assert.equal(
    calculateThreeBaseLoopSeamWindow(2, { min: Number.NaN, max: Number.NaN }),
    0.36,
    "base loop seam helper should sanitize non-finite bounds"
  );
  const transitionWeights = calculateThreeBaseLoopTransitionWeights({
    elapsed: 0.5,
    duration: 1,
    fromWeight: 0.8,
    toWeight: 0.5
  });
  assert.ok(Math.abs(transitionWeights.progress - 0.5) < 1e-6);
  assert.ok(Math.abs(transitionWeights.fromWeight - 0.4) < 1e-6);
  assert.ok(Math.abs(transitionWeights.toWeight - 0.25) < 1e-6);
  assert.equal(
    calculateThreeBaseLoopTransitionWeights({ elapsed: Number.NaN, duration: -1, fromWeight: 1, toWeight: 1 }).progress,
    0
  );
  assert.equal(
    calculateThreeBaseLoopTransitionWeights({ elapsed: 2, duration: 1, fromWeight: 1, toWeight: 1 }).complete,
    true
  );

  const overlayFadeIn = calculateThreeOverlayFade({
    time: 0.25,
    duration: 2,
    currentWeight: 0,
    targetWeight: 0.8,
    deltaSeconds: Math.log(2) / 6.5
  });
  assert.equal(overlayFadeIn.fadingOut, false);
  assert.equal(overlayFadeIn.targetWeight, 0.8);
  assert.ok(Math.abs(overlayFadeIn.nextWeight - 0.4) < 1e-6);
  const overlayFadeOut = calculateThreeOverlayFade({
    time: 1.7,
    duration: 2,
    currentWeight: 0.5,
    targetWeight: 0.8,
    deltaSeconds: Math.log(2) / 5.5
  });
  assert.equal(overlayFadeOut.fadeOutWindow, 0.42);
  assert.equal(overlayFadeOut.fadingOut, true);
  assert.equal(overlayFadeOut.targetWeight, 0);
  assert.ok(Math.abs(overlayFadeOut.nextWeight - 0.25) < 1e-6);
  const overlayFadeSanitizedBounds = calculateThreeOverlayFade({
    time: 1.7,
    duration: 2,
    currentWeight: 0.5,
    targetWeight: 0.8,
    deltaSeconds: 0,
    minWindow: Number.NaN,
    maxWindow: Number.NaN
  });
  assert.equal(
    overlayFadeSanitizedBounds.fadeOutWindow,
    0.42,
    "overlay fade helper should sanitize non-finite window bounds"
  );
  assert.equal(overlayFadeSanitizedBounds.fadingOut, true);
  assert.equal(
    calculateThreeOverlayFade({ time: 2, duration: 2, currentWeight: 0.005, targetWeight: 1, deltaSeconds: 0 })
      .shouldStop,
    true
  );

  const diagnosticBase = makeRuntimeClipDiagnosticStub({
    id: "bad-base",
    label: "Bad Base",
    lane: "base",
    weight: Number.POSITIVE_INFINITY,
    targetWeight: Number.NaN,
    time: Number.NaN,
    duration: Number.NEGATIVE_INFINITY,
    scheduled: true,
    running: true,
    instance: Number.NaN,
    states: ["idle"]
  });
  const diagnosticOverlay = makeRuntimeClipDiagnosticStub({
    id: "overlay",
    label: "Overlay",
    lane: "overlay",
    weight: 0.4,
    targetWeight: 2,
    time: 0.25,
    duration: 1.2,
    scheduled: false,
    running: false,
    gestures: ["wave"],
    source: { library: "test" }
  });
  const diagnosticDebug = makeRuntimeClipDiagnosticStub({
    id: "debug",
    label: "Debug",
    lane: "debug",
    weight: 0.65,
    targetWeight: 1,
    time: Number.POSITIVE_INFINITY,
    duration: 2,
    scheduled: false,
    running: true
  });
  const diagnosticSnapshot = readThreeRuntimeClipSnapshot(diagnosticBase, { loop: "seamed-once" });
  assert.equal(diagnosticSnapshot.weight, 0);
  assert.equal(diagnosticSnapshot.targetWeight, 0);
  assert.equal(diagnosticSnapshot.time, 0);
  assert.equal(diagnosticSnapshot.duration, 0);
  assert.equal(diagnosticSnapshot.instance, 0);
  assert.equal(diagnosticSnapshot.loop, "seamed-once");
  assert.deepEqual(diagnosticSnapshot.states, ["idle"]);
  diagnosticSnapshot.states.push("mutated");
  assert.deepEqual(
    diagnosticBase.states,
    ["idle"],
    "snapshot metadata arrays should be detached from manifest metadata"
  );

  const activeSnapshots = readActiveThreeRuntimeClipSnapshots([diagnosticBase, diagnosticOverlay, diagnosticDebug], {
    debugLoop: "loop"
  });
  assert.deepEqual(
    activeSnapshots.map((clip) => [clip.sourceId, clip.lane, clip.loop]),
    [
      ["bad-base", "base", "seamed-once"],
      ["overlay", "overlay", "once"],
      ["debug", "debug", "loop"]
    ]
  );
  assert.equal(activeSnapshots[1]!.targetWeight, 1);
  assert.equal(activeSnapshots[1]!.source?.library, "test");
  assert.equal(activeSnapshots[2]!.time, 0);

  assert.deepEqual(calculateThreeRuntimeInfluence([diagnosticBase, diagnosticOverlay], { debugWeight: 0.8 }), {
    base: 0,
    overlay: 0.8,
    debug: 0.8
  });
  assert.deepEqual(
    calculateThreeRuntimeInfluence([diagnosticOverlay, diagnosticDebug], { includeDebugAsOverlay: false }),
    { base: 0, overlay: 0.4, debug: 0.65 }
  );
}
