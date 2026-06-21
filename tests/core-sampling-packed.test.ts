import {
  AnimationClip,
  AnimationSamplingContext,
  PACKED_RUNTIME_ANIMATION_FORMAT,
  PACKED_RUNTIME_ANIMATION_VERSION,
  assert,
  buildPackedRuntimeAnimation,
  createSkeleton,
  getAnimationClipStats,
  getPackedRuntimeAnimationStats,
  quatFromAxisAngle,
  sampleClipToPose,
  sampleClipToPoseAtRatio,
  sampleClipToPoseWithContext,
  samplePackedRuntimeAnimationToPose,
  samplePackedRuntimeAnimationToPoseAtRatio,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  tryBuildPackedRuntimeAnimation,
  validatePackedRuntimeAnimation
} from "./test-api.js";
import {
  assertFinitePose,
  nodClip,
  quaternionNearlyEqual,
  skeleton,
  vectorNearlyEqual
} from "./test-helpers.js";

export async function runCoreSamplingPackedTests(rawAnimationFixtures: { rawBuiltClip: AnimationClip; rawBuiltPose: ReturnType<typeof sampleClipToPose> }): Promise<void> {
  const { rawBuiltClip, rawBuiltPose } = rawAnimationFixtures;
  const sampled = sampleClipToPose(skeleton, nodClip, 0.5);
  assert.ok(sampled[2]!.rotation[0] > 0.1);

  const coherentSamplingClip: AnimationClip = {
    id: "coherent-sampling",
    name: "Coherent Sampling",
    duration: 2,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.5, 1, 1.5, 2]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0])
      },
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI)])
      },
      {
        humanBone: "spine",
        property: "scale",
        times: toFloat32Array([0, 2]),
        values: toFloat32Array([1, 1, 1, 2, 3, 4])
      }
    ]
  };
  const coherentSamplingContext = new AnimationSamplingContext(1);
  const coherentFirstPose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.125);
  assert.equal(coherentSamplingContext.snapshot().lastMode, "reset", "first coherent sample should reset the context for the animation");
  assert.equal(coherentSamplingContext.snapshot().maxTracks, coherentSamplingClip.tracks.length, "sampling context should resize to fit track count");
  assert.ok(Math.abs(coherentFirstPose[2]!.translation[0] - 0.5) < 1e-6, "ratio sampling should convert clamped ratios to clip time");
  const coherentReusePose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.2);
  const coherentReuseSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentReuseSnapshot.lastMode, "coherent-forward", "increasing samples should use coherent forward mode");
  assert.ok(coherentReuseSnapshot.reusedTrackCount >= 1, "coherent forward sampling should reuse cached intervals when the sample stays inside them");
  assert.equal(coherentReuseSnapshot.searchedTrackCount, 0, "coherent forward sampling should avoid binary seeking inside cached intervals");
  assert.ok(Math.abs(coherentReusePose[2]!.translation[0] - 0.8) < 1e-6);
  coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.4);
  const coherentAdvanceSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentAdvanceSnapshot.lastMode, "coherent-forward");
  assert.ok(coherentAdvanceSnapshot.advancedTrackCount >= 1, "coherent forward sampling should advance cached intervals when crossing keys");
  const coherentSeekPose = coherentSamplingContext.sampleRatio(skeleton, coherentSamplingClip, 0.1);
  const coherentSeekSnapshot = coherentSamplingContext.snapshot();
  assert.equal(coherentSeekSnapshot.lastMode, "seek", "backward sampling should seek instead of reusing stale forward intervals");
  assert.ok(coherentSeekSnapshot.searchedTrackCount >= 1, "backward sampling should refresh intervals with a bounded search");
  assert.ok(Math.abs(coherentSeekPose[2]!.translation[0] - 0.4) < 1e-6);
  const coherentLoopPose = coherentSamplingContext.sampleTime(skeleton, coherentSamplingClip, 2.25, { loop: true });
  assert.ok(Math.abs(coherentLoopPose[2]!.translation[0] - 0.5) < 1e-6, "time sampling with loop should preserve existing wrapping semantics");
  const ratioClampStartPose = sampleClipToPoseAtRatio(skeleton, coherentSamplingClip, Number.NaN);
  const ratioClampEndPose = sampleClipToPoseAtRatio(skeleton, coherentSamplingClip, 2);
  assert.deepEqual(ratioClampStartPose[2]!.translation, [0, 0, 0], "non-finite ratios should clamp to the first sample");
  assert.deepEqual(ratioClampEndPose[2]!.translation, [4, 0, 0], "out-of-range ratios should clamp to the last sample");
  const changedSamplingClip: AnimationClip = {
    ...coherentSamplingClip,
    id: "coherent-sampling-changed",
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 2]),
        values: toFloat32Array([10, 0, 0, 20, 0, 0])
      }
    ]
  };
  const beforeAnimationChangeInvalidations = coherentSamplingContext.snapshot().invalidationCount;
  const changedPose = coherentSamplingContext.sampleRatio(skeleton, changedSamplingClip, 0.5);
  const changedSnapshot = coherentSamplingContext.snapshot();
  assert.equal(changedSnapshot.lastMode, "reset", "sampling a different animation should invalidate cached intervals");
  assert.equal(changedSnapshot.invalidationCount, beforeAnimationChangeInvalidations + 1);
  assert.deepEqual(changedPose[2]!.translation, [15, 0, 0]);
  const contextFunctionPose = sampleClipToPoseWithContext(skeleton, coherentSamplingClip, 1, coherentSamplingContext, { loop: false });
  assert.deepEqual(contextFunctionPose[2]!.translation, [2, 0, 0], "standalone context sampling should match ordinary time sampling");

  const nonFiniteSamplingClip: AnimationClip = {
    id: "non-finite-context-sampling",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([Number.NaN, Infinity, 1, 2, 3, 4]) },
      { humanBone: "spine", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 0]) }
    ]
  };
  const repairedContextPose = new AnimationSamplingContext().sampleTime(skeleton, nonFiniteSamplingClip, 0);
  assertFinitePose(repairedContextPose);
  assert.deepEqual(repairedContextPose[2]!.translation, [0, 0, 1], "context sampling should use the same finite vector repair path as sampleTrack");
  assert.deepEqual(repairedContextPose[1]!.rotation, [0, 0, 0, 1], "context sampling should repair non-normalizable rotation samples");

  const coherentSamplingStats = getAnimationClipStats(coherentSamplingClip, skeleton);
  assert.equal(coherentSamplingStats.duration, 2);
  assert.equal(coherentSamplingStats.trackCount, 3);
  assert.equal(coherentSamplingStats.jointCount, 2);
  assert.equal(coherentSamplingStats.soaTrackCount, 1);
  assert.equal(coherentSamplingStats.timepointCount, 5);
  assert.equal(coherentSamplingStats.translationTrackCount, 1);
  assert.equal(coherentSamplingStats.rotationTrackCount, 1);
  assert.equal(coherentSamplingStats.scaleTrackCount, 1);
  assert.equal(coherentSamplingStats.translationKeyCount, 5);
  assert.equal(coherentSamplingStats.rotationKeyCount, 2);
  assert.equal(coherentSamplingStats.scaleKeyCount, 2);
  assert.equal(coherentSamplingStats.totalKeyCount, 9);
  assert.deepEqual(
    coherentSamplingStats.perTrack.map((track) => [track.track, track.normalizedProperty, track.keyCount, track.jointIndex]),
    [
      [0, "translation", 5, 2],
      [1, "rotation", 2, 2],
      [2, "scale", 2, 1]
    ],
    "clip stats should expose per-track key-controller metadata"
  );

  const packedUnsortedClip: AnimationClip = {
    id: "packed-unsorted",
    name: "Packed Unsorted",
    duration: 2,
    loop: true,
    metadata: { source: "clip", nested: { tags: ["packed"] } },
    tracks: [
      {
        joint: "leftUpperArm",
        property: "quaternion",
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 0, 1], Math.PI / 2)])
      },
      {
        humanBone: "head",
        property: "position",
        times: toFloat32Array([0, 1, 2]),
        values: toFloat32Array([0, 0, 0, 0, 2, 0, 0, 4, 0])
      },
      {
        joint: "spine",
        property: "scale",
        times: toFloat32Array([0.5, 1.5]),
        values: toFloat32Array([1, 1, 1, 2, 2, 2])
      },
      {
        humanBone: "head",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        sourceRestChildDirection: toFloat32Array([0, 1, 0]),
        times: toFloat32Array([0, 2]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  const packedRuntimeAnimation = buildPackedRuntimeAnimation(packedUnsortedClip, skeleton);
  assert.equal(Object.isFrozen(packedRuntimeAnimation), true, "packed runtime animations should be frozen objects");
  assert.equal(Object.isFrozen(packedRuntimeAnimation.times), true, "packed runtime time buffers should be immutable arrays");
  assert.equal(Object.isFrozen(packedRuntimeAnimation.keyControllers[0]), true, "packed key-controller metadata should be immutable");
  assert.equal(packedRuntimeAnimation.archive.format, PACKED_RUNTIME_ANIMATION_FORMAT);
  assert.equal(packedRuntimeAnimation.archive.version, PACKED_RUNTIME_ANIMATION_VERSION);
  assert.equal(packedRuntimeAnimation.archive.clipId, "packed-unsorted");
  assert.equal(packedRuntimeAnimation.archive.clipName, "Packed Unsorted");
  assert.equal(packedRuntimeAnimation.archive.trackCount, 4);
  assert.equal(packedRuntimeAnimation.archive.keyCount, 9);
  assert.equal(packedRuntimeAnimation.archive.iframeCount, 5);
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers.map((controller) => `${controller.joint ?? controller.humanBone}.${controller.normalizedProperty}:${controller.sourceTrack}`),
    ["spine.scale:2", "head.translation:1", "head.rotation:3", "leftUpperArm.rotation:0"],
    "packed runtime animation builder should sort key controllers deterministically by resolved joint and TRS property"
  );
  assert.deepEqual(packedRuntimeAnimation.iframeTable.times, [0, 0.5, 1, 1.5, 2], "packed iframe table should collect unique sorted animation key times");
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers[0]!.seekTable,
    { iframeLowerKeys: [0, 0, 0, 1, 1], iframeUpperKeys: [0, 0, 1, 1, 1] },
    "packed seek tables should clamp and bracket sparse track keys against global iframes"
  );
  assert.deepEqual(
    packedRuntimeAnimation.keyControllers[1]!.seekTable,
    { iframeLowerKeys: [0, 0, 1, 1, 2], iframeUpperKeys: [0, 1, 1, 2, 2] },
    "packed seek tables should mark exact iframe keys and interpolation spans"
  );
  const singleKeyPacked = buildPackedRuntimeAnimation(
    {
      id: "packed-single-key",
      duration: 1,
      tracks: [{ humanBone: "head", property: "translation", times: toFloat32Array([0.25]), values: toFloat32Array([1, 2, 3]) }]
    },
    skeleton
  );
  assert.deepEqual(singleKeyPacked.keyControllers[0]!.seekTable, { iframeLowerKeys: [0], iframeUpperKeys: [0] }, "single-key packed tracks should seek to their only key");
  const packedRuntimeStats = getPackedRuntimeAnimationStats(packedRuntimeAnimation);
  assert.equal(packedRuntimeStats.format, PACKED_RUNTIME_ANIMATION_FORMAT);
  assert.equal(packedRuntimeStats.version, PACKED_RUNTIME_ANIMATION_VERSION);
  assert.equal(packedRuntimeStats.packedTrackCount, 4);
  assert.equal(packedRuntimeStats.iframeCount, 5);
  assert.equal(packedRuntimeStats.totalKeyCount, 9);
  assert.deepEqual(
    packedRuntimeStats.perTrack.map((track) => [track.track, track.normalizedProperty, track.keyCount, track.jointIndex]),
    [
      [0, "scale", 2, 1],
      [1, "translation", 3, 2],
      [2, "rotation", 2, 2],
      [3, "rotation", 2, 3]
    ],
    "packed runtime stats should expose sorted key-controller metadata"
  );
  for (const time of [-0.25, 0, 0.25, 1, 1.75, 2.25]) {
    const ordinaryPose = sampleClipToPose(skeleton, packedUnsortedClip, time);
    const packedPose = samplePackedRuntimeAnimationToPose(skeleton, packedRuntimeAnimation, time);
    assert.ok(vectorNearlyEqual(packedPose[2]!.translation, ordinaryPose[2]!.translation, 1e-6), `packed head translation should match ordinary sampling at ${time}`);
    assert.ok(vectorNearlyEqual(packedPose[1]!.scale, ordinaryPose[1]!.scale, 1e-6), `packed spine scale should match ordinary sampling at ${time}`);
    assert.ok(quaternionNearlyEqual(packedPose[2]!.rotation, ordinaryPose[2]!.rotation, 1e-6), `packed head rotation should match ordinary sampling at ${time}`);
    assert.ok(quaternionNearlyEqual(packedPose[3]!.rotation, ordinaryPose[3]!.rotation, 1e-6), `packed arm rotation should match ordinary sampling at ${time}`);
  }
  const packedRatioPose = samplePackedRuntimeAnimationToPoseAtRatio(skeleton, packedRuntimeAnimation, 2);
  const ordinaryRatioPose = sampleClipToPoseAtRatio(skeleton, packedUnsortedClip, 2);
  assert.deepEqual(packedRatioPose[2]!.translation, ordinaryRatioPose[2]!.translation, "packed ratio sampling should clamp like ordinary ratio sampling");
  const rawPackedRuntimeAnimation = buildPackedRuntimeAnimation(rawBuiltClip, skeleton);
  const rawPackedPose = samplePackedRuntimeAnimationToPose(skeleton, rawPackedRuntimeAnimation, 1, { loop: false });
  assert.deepEqual(rawPackedPose[3]!.translation, rawBuiltPose[3]!.translation, "packed runtime animations should sample RawAnimation-built clips like ordinary clips");
  assert.deepEqual(rawPackedPose[1]!.scale, rawBuiltPose[1]!.scale, "packed runtime animations should preserve raw-built scale tracks");
  const emptyPackedBuild = tryBuildPackedRuntimeAnimation({ id: "packed-empty", duration: 1, tracks: [] }, skeleton);
  assert.equal(emptyPackedBuild.ok, false, "empty animation clips should not build into packed runtime animations");
  if (!emptyPackedBuild.ok) assert.ok(emptyPackedBuild.issues.some((issue) => issue.message === "clip has no transform tracks"));
  assert.throws(
    () => buildPackedRuntimeAnimation({ id: "packed-empty", duration: 1, tracks: [] }, skeleton),
    /clip has no transform tracks/,
    "packed runtime animation builds should fail explicitly for empty clips"
  );
  const duplicatePackedBuild = tryBuildPackedRuntimeAnimation(
    {
      id: "packed-duplicate",
      duration: 1,
      tracks: [
        { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
        { joint: "head", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
      ]
    },
    skeleton
  );
  assert.equal(duplicatePackedBuild.ok, false, "packed runtime animation builder should reject duplicate resolved channels");
  if (!duplicatePackedBuild.ok) assert.ok(duplicatePackedBuild.issues.some((issue) => issue.message.includes("duplicate target channel")));
  const invalidVersionPacked = {
    ...packedRuntimeAnimation,
    archive: { ...packedRuntimeAnimation.archive, version: 999 }
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(invalidVersionPacked, skeleton).some((issue) => issue.message === "packed runtime animation archive version is unsupported"),
    "packed runtime validation should reject unsupported archive versions"
  );
  const unsortedPacked = {
    ...packedRuntimeAnimation,
    keyControllers: [packedRuntimeAnimation.keyControllers[1]!, packedRuntimeAnimation.keyControllers[0]!, ...packedRuntimeAnimation.keyControllers.slice(2)]
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(unsortedPacked, skeleton).some((issue) => issue.message === "packed key controllers must be sorted"),
    "packed runtime validation should reject out-of-order key controllers"
  );
  const staleSeekTablePacked = {
    ...packedRuntimeAnimation,
    keyControllers: packedRuntimeAnimation.keyControllers.map((controller, index) =>
      index === 1
        ? {
            ...controller,
            seekTable: {
              iframeLowerKeys: [0, 0, 0, 0, 0],
              iframeUpperKeys: [0, 0, 0, 0, 0]
            }
          }
        : controller
    )
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(staleSeekTablePacked, skeleton).some((issue) => issue.message === "packed seek table does not match key times"),
    "packed runtime validation should reject seek tables stale against packed key times"
  );
  const stalePackedTargetKey = {
    ...packedRuntimeAnimation,
    keyControllers: packedRuntimeAnimation.keyControllers.map((controller, index) => (index === 1 ? { ...controller, targetKey: "stale-target" } : controller))
  } as unknown as typeof packedRuntimeAnimation;
  assert.ok(
    validatePackedRuntimeAnimation(stalePackedTargetKey, skeleton).some((issue) => issue.message === "packed key controller targetKey does not match resolved target"),
    "packed runtime validation should reject key controllers whose targetKey no longer matches their resolved target"
  );
  const overlappingPackedBuffersBase = buildPackedRuntimeAnimation(
    {
      id: "packed-overlapping-buffers",
      duration: 1,
      tracks: [
        { humanBone: "spine", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([1, 0, 0]) },
        { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }
      ]
    },
    skeleton
  );
  const overlappingPackedBuffers = {
    ...overlappingPackedBuffersBase,
    keyControllers: overlappingPackedBuffersBase.keyControllers.map((controller, index) =>
      index === 1
        ? {
            ...controller,
            timeOffset: overlappingPackedBuffersBase.keyControllers[0]!.timeOffset,
            valueOffset: overlappingPackedBuffersBase.keyControllers[0]!.valueOffset
          }
        : controller
    )
  } as unknown as typeof overlappingPackedBuffersBase;
  const overlappingPackedBufferIssues = validatePackedRuntimeAnimation(overlappingPackedBuffers, skeleton);
  assert.ok(
    overlappingPackedBufferIssues.some((issue) => issue.message === "packed key controller time ranges must not overlap"),
    "packed runtime validation should reject controllers that alias another controller's time buffer"
  );
  assert.ok(
    overlappingPackedBufferIssues.some((issue) => issue.message === "packed key controller value ranges must not overlap"),
    "packed runtime validation should reject controllers that alias another controller's value buffer"
  );
  const wrongPackedSkeleton = createSkeleton([{ name: "only" }]);
  assert.ok(
    validatePackedRuntimeAnimation(packedRuntimeAnimation, wrongPackedSkeleton).some((issue) => issue.message === "packed key controller does not map to skeleton"),
    "packed runtime validation should keep skeleton target checks explicit"
  );
  assert.throws(
    () => samplePackedRuntimeAnimationToPose(wrongPackedSkeleton, packedRuntimeAnimation, 0),
    /does not map to skeleton/,
    "packed sampling should reject skeletons that cannot resolve packed targets"
  );
  const packedHeadTranslation = packedRuntimeAnimation.keyControllers[1]!;
  packedUnsortedClip.tracks[1]!.times[1] = 0.25;
  packedUnsortedClip.tracks[1]!.values[4] = 99;
  assert.deepEqual(
    packedRuntimeAnimation.times.slice(packedHeadTranslation.timeOffset, packedHeadTranslation.timeOffset + packedHeadTranslation.keyCount),
    [0, 1, 2],
    "packed runtime animations should not alias source clip time arrays"
  );
  assert.equal(packedRuntimeAnimation.values[packedHeadTranslation.valueOffset + 4], 2, "packed runtime animations should not alias source clip value arrays");
  packedUnsortedClip.metadata!.source = "mutated";
  assert.equal(packedRuntimeAnimation.metadata?.source, "clip", "packed runtime metadata should be cloned from source clip metadata");
  assert.throws(() => {
    (packedRuntimeAnimation.times as number[])[0] = 99;
  }, TypeError, "packed runtime arrays should reject mutation");
  assert.throws(() => {
    (packedRuntimeAnimation.metadata as Record<string, unknown>).source = "mutated-again";
  }, TypeError, "packed runtime metadata should reject mutation");
}
