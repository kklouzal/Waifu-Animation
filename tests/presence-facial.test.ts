import {
  AttentionScheduler,
  BlinkScheduler,
  FacialExpressionMixer,
  Object3D,
  PresencePlanner,
  VisemeMixer,
  applyThreePresenceTargets,
  assert,
  breathingWeight,
  composeFacialExpressions,
  dampAlpha,
  distributeLookAt,
  limitVisemeStack,
  zeroVisemes
} from "./test-api.js";

export function runPresenceTargetTests(): void {
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
  assert.equal(
    presenceFallbackSpeed.applied,
    true,
    "Three presence application should fall back from non-finite target speeds"
  );
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
}
export function runPresencePlanningTests(): void {
  const look = distributeLookAt([0.4, 0.2, 2]);
  assert.ok(look.head.yaw > 0);
  assert.ok(look.eyes.pitch > 0);
  const behindLook = distributeLookAt([0, 0, -1], { maxYaw: 0.5 });
  assert.equal(
    behindLook.eyes.yaw,
    0.21,
    "directly behind targets should clamp toward the yaw limit instead of collapsing to center"
  );
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
    Object.values(hostileLook).every(
      (part) => Number.isFinite(part.yaw) && Number.isFinite(part.pitch) && Number.isFinite(part.weight)
    ),
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
  assert.equal(
    noPositiveAttention,
    null,
    "attention scheduler should return null when no target has a positive finite weight"
  );
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
    finiteDwellAttention.choose(
      Number.POSITIVE_INFINITY,
      [{ id: "finite-dwell", position: [0, 0, 1], weight: 1 }],
      Number.NaN,
      Number.POSITIVE_INFINITY
    )?.id,
    "finite-dwell",
    "non-finite dwell and now inputs should not prevent a finite scheduler choice"
  );
  assert.equal(
    Number.isFinite(breathingWeight(Number.NaN, 0.5)),
    true,
    "breathing weight should ignore non-finite elapsed time"
  );

  const presenceA = new PresencePlanner("presence-test", 0);
  const presenceB = new PresencePlanner("presence-test", 0);
  presenceA.onBehaviorChange(
    { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
    { attentiveness: 0.8 },
    100
  );
  presenceB.onBehaviorChange(
    { state: "thinking", gesture: "thinking", gaze: "down", energy: 0.52 },
    { attentiveness: 0.8 },
    100
  );
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
  assert.ok(
    finitePresenceFrame.lookAtTarget.every(Number.isFinite),
    "presence look target should stay finite for non-finite timing"
  );
  assert.ok(
    finitePresenceFrame.boneTargets.every((target) => target.rotation.every(Number.isFinite)),
    "presence bone targets should stay finite for non-finite timing"
  );
  const hostileCuePresence = new PresencePlanner("presence-hostile-cue", Number.NaN);
  hostileCuePresence.scheduleCue("nod", Number.NaN, Number.NaN, Number.NaN, 1);
  const hostileCuePresenceFrame = hostileCuePresence.update({
    nowMs: 0.5,
    elapsedSeconds: Number.NaN,
    deltaSeconds: 1 / 30
  });
  assert.ok(
    hostileCuePresenceFrame.cueAmounts.nod > 0,
    "presence cues should sanitize non-finite schedule times instead of being dropped"
  );
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
}
export function runFacialAnimationTests(): void {
  const visemes = new VisemeMixer({ maxTotal: 0.4 });
  visemes.setTarget({ aa: 0.4, ou: 0.4 });
  const mixed = visemes.update(1 / 30);
  assert.ok(mixed.aa + mixed.ou <= 0.4001);
  assert.deepEqual(limitVisemeStack({ aa: 0.2, ih: 0.2, ou: 0.2, ee: 0.2, oh: 0.2 }, Number.NaN), zeroVisemes());
  const hostileLimitedVisemes = limitVisemeStack(
    { aa: Number.NaN, ih: -1, ou: 2, ee: 0.5, oh: Number.POSITIVE_INFINITY },
    1
  );
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
  assert.ok(
    Object.values(invalidVisemes.update(Number.NaN)).every(Number.isFinite),
    "viseme mixer should keep weights finite for non-finite timing and limits"
  );
  const invalidIntensityVisemes = new VisemeMixer({ intensity: Number.NaN });
  invalidIntensityVisemes.setTarget({ aa: 1 });
  assert.ok(
    Object.values(invalidIntensityVisemes.update(1 / 30)).every(Number.isFinite),
    "viseme mixer should keep weights finite for non-finite intensity"
  );

  const partialAttackVisemes = new VisemeMixer({ attack: { aa: 60 }, release: 20, maxTotal: 1 });
  partialAttackVisemes.setTarget({ aa: 0.5, ih: 0.5 });
  const partialAttackMixed = partialAttackVisemes.update(1 / 30);
  assert.ok(partialAttackMixed.ih > 0, "partial viseme attack maps should fall back for unspecified visemes");
  assert.ok(
    Math.abs(partialAttackMixed.aa - 0.5 * dampAlpha(60, 1 / 30)) < 1e-6,
    "partial viseme attack maps should respect specified speeds"
  );
  assert.ok(
    Math.abs(partialAttackMixed.ih - 0.5 * dampAlpha(30, 1 / 30)) < 1e-6,
    "partial viseme attack maps should use the default attack speed"
  );

  const partialReleaseVisemes = new VisemeMixer({ attack: 30, release: { aa: 40 }, maxTotal: 1 });
  partialReleaseVisemes.setTarget({ aa: 0.5, ih: 0.5 });
  partialReleaseVisemes.update(1 / 30);
  partialReleaseVisemes.setTarget({});
  const beforePartialRelease = { ...partialReleaseVisemes.current };
  const partialReleaseMixed = partialReleaseVisemes.update(1 / 30);
  assert.ok(
    partialReleaseMixed.ih < beforePartialRelease.ih,
    "partial viseme release maps should fall back for unspecified visemes"
  );
  assert.ok(
    Math.abs(partialReleaseMixed.aa - beforePartialRelease.aa * (1 - dampAlpha(40, 1 / 30))) < 1e-6,
    "partial viseme release maps should respect specified speeds"
  );
  assert.ok(
    Math.abs(partialReleaseMixed.ih - beforePartialRelease.ih * (1 - dampAlpha(20, 1 / 30))) < 1e-6,
    "partial viseme release maps should use the default release speed"
  );
  const malformedSpeedVisemes = new VisemeMixer({
    attack: { aa: Number.NaN },
    release: { aa: Number.NaN },
    maxTotal: 1
  });
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
  assert.equal(
    Number.isFinite(blink.update(200, Number.NaN, 0.5)),
    true,
    "blink scheduler should ignore non-finite delta time"
  );
  assert.equal(
    blink.update(216, Number.NaN, 0.5),
    blink.update(216, Number.NaN, 0.5),
    "blink scheduler should keep non-finite delta decay deterministic"
  );
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
}
