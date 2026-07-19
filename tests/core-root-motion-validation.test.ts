import type { AnimationClip } from "./test-api.js";
import {
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  inspectAnimationAsset,
  inspectClipAsset,
  sanitizeQuaternionTrackValues,
  toFloat32Array
} from "./test-api.js";
import { nodClip, skeleton } from "./test-helpers.js";

export async function runCoreRootMotionValidationTests(): Promise<void> {
  const convertedStrippedRootMotionEntry = {
    id: "root-motion-converted-stripped",
    label: "Root Motion Converted Stripped",
    url: "/root-motion-converted-stripped.waifuanim.bin",
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    source: { rootMotion: { policy: "stripped-to-in-place", provenance: "stripped-during-conversion" } }
  };

  const rootMotionRotationOnlyClip: AnimationClip = {
    ...nodClip,
    id: "root-motion-walk"
  };
  assert.equal(
    inspectClipAsset(
      {
        id: "root-motion-walk",
        label: "Root Motion Walk",
        url: "/root-motion-walk.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT
      },
      rootMotionRotationOnlyClip
    ).accepted,
    false
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "root-motion-walk",
        label: "Root Motion Walk",
        url: "/root-motion-walk.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "stripped-to-in-place" } }
      },
      rootMotionRotationOnlyClip
    ).accepted,
    true
  );
  const convertedStrippedRootMotionInspection = inspectAnimationAsset(
    convertedStrippedRootMotionEntry,
    rootMotionRotationOnlyClip,
    skeleton
  );
  assert.equal(convertedStrippedRootMotionInspection.status, "accepted");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionPolicy, "stripped-to-in-place");
  assert.equal(convertedStrippedRootMotionInspection.rootMotionProvenance, "stripped-during-conversion");
  assert.equal(convertedStrippedRootMotionInspection.rootCarrierTranslationTrackCount, 0);
  assert.equal(convertedStrippedRootMotionInspection.movingRootCarrierTranslationTrackCount, 0);
  const strippedRootMotionMovingHipsInspection = inspectClipAsset(
    {
      id: "root-motion-stripped-moving-hips",
      label: "Root Motion Stripped Moving Hips",
      url: "/root-motion-stripped-moving-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "stripped-to-in-place" } }
    },
    {
      id: "root-motion-stripped-moving-hips",
      duration: 1,
      tracks: [
        {
          humanBone: "hips",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 0, 0, 0.25])
        }
      ]
    }
  );
  assert.equal(strippedRootMotionMovingHipsInspection.accepted, false);
  assert.ok(
    strippedRootMotionMovingHipsInspection.issues.some(
      (issue) => issue.message === "root-motion policy is stripped-to-in-place but root carrier translation still moves"
    ),
    "stripped-to-in-place clips should reject meaningful hips translation motion"
  );
  const noPolicyMovingHipsInspection = inspectClipAsset(
    {
      id: "walk-moving-hips",
      label: "Walk Moving Hips",
      url: "/walk-moving-hips.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "walk-moving-hips",
      duration: 1,
      tracks: [
        {
          humanBone: "hips",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 0, 0, 0.25])
        }
      ]
    }
  );
  assert.equal(noPolicyMovingHipsInspection.accepted, false);
  assert.ok(
    noPolicyMovingHipsInspection.issues.some(
      (issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"
    ),
    "moving hips translation should require an explicit root-motion policy even without root-motion naming"
  );
  const noPolicyMovingRootMetadataInspection = inspectClipAsset(
    {
      id: "walk-moving-root",
      label: "Walk Moving Root",
      url: "/walk-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    {
      id: "walk-moving-root",
      duration: 1,
      metadata: {},
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 1, 0, 0])
        }
      ]
    }
  );
  assert.equal(noPolicyMovingRootMetadataInspection.accepted, false);
  assert.ok(
    noPolicyMovingRootMetadataInspection.issues.some(
      (issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"
    ),
    "moving root translation should require an explicit root-motion policy from manifest or clip metadata"
  );
  const nonePolicyMovingRootInspection = inspectClipAsset(
    {
      id: "walk-none-moving-root",
      label: "Walk None Moving Root",
      url: "/walk-none-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "none" } }
    },
    {
      id: "walk-none-moving-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 1, 0, 0])
        }
      ]
    }
  );
  assert.equal(nonePolicyMovingRootInspection.accepted, false);
  assert.ok(
    nonePolicyMovingRootInspection.issues.some(
      (issue) => issue.message === "root-motion policy is none but root carrier translation moves"
    ),
    "policy none should reject moving root carrier translation"
  );
  const playbackWindowInPlaceRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-trimmed-in-place-root",
      label: "Walk Trimmed In Place Root",
      url: "/walk-trimmed-in-place-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      playback: { start: 0.25, end: 0.75 }
    },
    {
      id: "walk-trimmed-in-place-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 0.25, 0.75, 1]),
          values: toFloat32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0])
        }
      ]
    }
  );
  assert.equal(playbackWindowInPlaceRootCarrierInspection.accepted, true);
  assert.equal(
    playbackWindowInPlaceRootCarrierInspection.issues.some(
      (issue) =>
        issue.message === "moving root carrier translation requires source.rootMotion.policy" ||
        issue.message === "root-motion policy is none but root carrier translation moves"
    ),
    false,
    "root carrier motion outside the playback window should not trigger root-motion policy failures for an in-place segment"
  );
  const playbackWindowMovingRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-trimmed-moving-root",
      label: "Walk Trimmed Moving Root",
      url: "/walk-trimmed-moving-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "none" } },
      playback: { start: 0.25, end: 0.75 }
    },
    {
      id: "walk-trimmed-moving-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 0.25, 0.5, 0.75, 1]),
          values: toFloat32Array([0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0.5, 0, 0])
        }
      ]
    }
  );
  assert.equal(playbackWindowMovingRootCarrierInspection.accepted, false);
  assert.ok(
    playbackWindowMovingRootCarrierInspection.issues.some(
      (issue) => issue.message === "root-motion policy is none but root carrier translation moves"
    ),
    "root carrier motion inside the playback window should still trigger root-motion policy failures"
  );
  const invalidPlaybackWindowRootCarrierInspection = inspectClipAsset(
    {
      id: "walk-invalid-playback-root",
      label: "Walk Invalid Playback Root",
      url: "/walk-invalid-playback-root.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      playback: { start: 0.75, end: 0.25 }
    },
    {
      id: "walk-invalid-playback-root",
      duration: 1,
      tracks: [
        {
          joint: "root",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 1, 0, 0])
        }
      ]
    }
  );
  assert.equal(invalidPlaybackWindowRootCarrierInspection.accepted, false);
  assert.ok(
    invalidPlaybackWindowRootCarrierInspection.issues.some(
      (issue) => issue.message === "invalid playback window 0.75..0.25"
    ),
    "invalid playback windows should still be reported"
  );
  assert.equal(
    invalidPlaybackWindowRootCarrierInspection.issues.some(
      (issue) => issue.message === "moving root carrier translation requires source.rootMotion.policy"
    ),
    false,
    "invalid playback windows should not add a second root-motion movement failure"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "idle-stripped-stationary-pelvis",
        label: "Idle Stripped Stationary Pelvis",
        url: "/idle-stripped-stationary-pelvis.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "stripped-to-in-place" } }
      },
      {
        id: "idle-stripped-stationary-pelvis",
        duration: 1,
        tracks: [
          {
            joint: "pelvis",
            property: "translation",
            times: toFloat32Array([0, 1]),
            values: toFloat32Array([1, 0, 2, 1.00001, -0.00001, 2.00001])
          }
        ]
      }
    ).accepted,
    true,
    "stripped-to-in-place clips should tolerate tiny stationary root-carrier translation noise"
  );
  const verticalTransitionClip: AnimationClip = {
    id: "stand-to-crouch-vertical-transition",
    duration: 1,
    tracks: [
      {
        humanBone: "hips",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, -0.55, 0])
      }
    ]
  };
  const verticalTransitionRootMotion = {
    policy: "stripped-to-in-place" as const,
    provenance: "preserved-in-clip",
    owner: "director-xz",
    carrier: "hips",
    units: "meters-target-rest-offset",
    bakeMode: "reference",
    extractedAxes: ["x", "z"],
    preservedAxes: ["y"],
    support: "vertical-transition"
  };
  assert.equal(
    inspectClipAsset(
      {
        id: verticalTransitionClip.id,
        label: "Stand To Crouch Vertical Transition",
        url: "/stand-to-crouch-vertical-transition.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: verticalTransitionRootMotion }
      },
      verticalTransitionClip
    ).accepted,
    true,
    "a stripped in-place vertical transition should retain only its explicitly owned hips Y articulation"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "malformed-vertical-transition",
        label: "Malformed Vertical Transition",
        url: "/malformed-vertical-transition.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { ...verticalTransitionRootMotion, preservedAxes: ["x", "y"] } }
      },
      verticalTransitionClip
    ).accepted,
    false,
    "vertical-transition metadata must not authorize retained horizontal root-carrier motion"
  );

  const preservedRootMotionHeadOnlyClip: AnimationClip = {
    id: "root-motion-head-only",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0.1, 0])
      }
    ]
  };
  const preservedRootMotionHeadOnlyInspection = inspectClipAsset(
    {
      id: "root-motion-head-only",
      label: "Root Motion Head Only",
      url: "/root-motion-head-only.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    preservedRootMotionHeadOnlyClip
  );
  assert.equal(preservedRootMotionHeadOnlyInspection.accepted, false);
  assert.ok(
    preservedRootMotionHeadOnlyInspection.issues.some(
      (issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"
    ),
    "preserved root-motion clips should not accept arbitrary non-root translation tracks"
  );
  const preservedIdleHeadOnlyInspection = inspectClipAsset(
    {
      id: "idle-head-only",
      label: "Idle Head Only",
      url: "/idle-head-only.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved" } }
    },
    {
      id: "idle-head-only",
      duration: 1,
      tracks: [
        {
          humanBone: "head",
          property: "translation",
          times: toFloat32Array([0, 1]),
          values: toFloat32Array([0, 0, 0, 0, 0.1, 0])
        }
      ]
    }
  );
  assert.equal(preservedIdleHeadOnlyInspection.accepted, false);
  assert.ok(
    preservedIdleHeadOnlyInspection.issues.some(
      (issue) => issue.message === "root-motion policy is preserved but clip has no root carrier translation track"
    ),
    "preserved root-motion policy should require a root carrier translation track even without root-motion naming"
  );
  const preservedRootMotionHipsClip: AnimationClip = {
    id: "root-motion-hips",
    duration: 1,
    tracks: [
      {
        humanBone: "hips",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0, 0, 1])
      }
    ]
  };
  assert.equal(
    inspectClipAsset(
      {
        id: "root-motion-hips",
        label: "Root Motion Hips",
        url: "/root-motion-hips.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved" } }
      },
      preservedRootMotionHipsClip
    ).accepted,
    true,
    "preserved root-motion clips should accept hips translation tracks"
  );
  const preservedRootMotionReportInspection = inspectAnimationAsset(
    {
      id: "root-motion-hips-preserved-report",
      label: "Root Motion Hips Preserved Report",
      url: "/root-motion-hips-preserved-report.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "preserved", provenance: "preserved-in-clip" } }
    },
    preservedRootMotionHipsClip
  );
  assert.equal(preservedRootMotionReportInspection.rootMotionPolicy, "preserved");
  assert.equal(preservedRootMotionReportInspection.rootMotionProvenance, "preserved-in-clip");
  assert.equal(preservedRootMotionReportInspection.rootCarrierTranslationTrackCount, 1);
  assert.equal(preservedRootMotionReportInspection.movingRootCarrierTranslationTrackCount, 1);
  assert.equal(
    inspectClipAsset(
      {
        id: "idle-preserved-hips",
        label: "Idle Preserved Hips",
        url: "/idle-preserved-hips.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        source: { rootMotion: { policy: "preserved" } }
      },
      {
        id: "idle-preserved-hips",
        duration: 1,
        tracks: [
          {
            humanBone: "hips",
            property: "translation",
            times: toFloat32Array([0, 1]),
            values: toFloat32Array([0, 0, 0, 0, 0, 1])
          }
        ]
      }
    ).accepted,
    true,
    "preserved root-motion policy should accept hips translation carriers even without root-motion naming"
  );
  assert.equal(
    inspectClipAsset(
      {
        id: "walk-clip-metadata-preserved-root",
        label: "Walk Clip Metadata Preserved Root",
        url: "/walk-clip-metadata-preserved-root.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT
      },
      {
        id: "walk-clip-metadata-preserved-root",
        duration: 1,
        metadata: { rootMotionPolicy: "preserved" },
        tracks: [
          {
            joint: "root",
            property: "translation",
            times: toFloat32Array([0, 1]),
            values: toFloat32Array([0, 0, 0, 1, 0, 0])
          }
        ]
      }
    ).accepted,
    true,
    "preserved clip metadata should accept moving root carrier translation"
  );
  const invalidRootMotionPolicyInspection = inspectAnimationAsset(
    {
      id: "root-motion-walk",
      label: "Root Motion Walk",
      url: "/root-motion-walk.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "keep-everything" } }
    },
    rootMotionRotationOnlyClip
  );
  assert.equal(invalidRootMotionPolicyInspection.status, "rejected");
  assert.equal(invalidRootMotionPolicyInspection.rootMotionPolicy, "none");
  assert.ok(
    invalidRootMotionPolicyInspection.issues.some(
      (issue) => issue.message === "root-motion clip must declare source.rootMotion.policy"
    ),
    "asset validation should use the same root-motion policy interpretation as manifest inspection"
  );
  const invalidNonRootMotionPolicyInspection = inspectClipAsset(
    {
      id: "idle-invalid-root-motion-policy",
      label: "Idle Invalid Root Motion Policy",
      url: "/idle-invalid-root-motion-policy.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      source: { rootMotion: { policy: "keep-everything" } }
    },
    nodClip
  );
  assert.equal(invalidNonRootMotionPolicyInspection.accepted, false);
  assert.ok(
    invalidNonRootMotionPolicyInspection.issues.some(
      (issue) => issue.message === "has invalid source.rootMotion.policy keep-everything"
    ),
    "inspectClipAsset should reject invalid root-motion metadata even when the clip name is not root-motion"
  );
  assert.equal(
    inspectAnimationAsset(
      {
        id: "nod",
        label: "Nod",
        url: "/nod.waifuanim.bin",
        format: WAIFU_ANIMATION_BINARY_FORMAT,
        loop: true,
        states: ["idle"],
        source: { category: "idle", posture: "standing" }
      },
      nodClip,
      skeleton
    ).status,
    "accepted"
  );

  const loopEndpointWarning = "loop endpoints differ; crossfade or seam blending is required";
  const oppositeQuaternionEndpointClip: AnimationClip = {
    id: "opposite-quaternion-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0, 0, -1])
      }
    ]
  };
  const oppositeQuaternionEndpointInspection = inspectAnimationAsset(
    {
      id: "opposite-quaternion-endpoints",
      label: "Opposite Quaternion Endpoints",
      url: "/opposite-quaternion-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    oppositeQuaternionEndpointClip,
    skeleton
  );
  assert.equal(
    oppositeQuaternionEndpointInspection.status,
    "accepted",
    "sign-opposite normalized rotation endpoints should remain valid"
  );
  assert.equal(
    oppositeQuaternionEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "looping rotation endpoints should compare quaternion-equivalent signs"
  );

  const mismatchedTranslationEndpointClip: AnimationClip = {
    id: "mismatched-translation-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 0.25, 0, 0])
      }
    ]
  };
  const mismatchedTranslationEndpointInspection = inspectAnimationAsset(
    {
      id: "mismatched-translation-endpoints",
      label: "Mismatched Translation Endpoints",
      url: "/mismatched-translation-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    mismatchedTranslationEndpointClip,
    skeleton
  );
  const mismatchedTranslationEndpointIssue = mismatchedTranslationEndpointInspection.issues.find((issue) =>
    issue.message.startsWith(loopEndpointWarning)
  );
  assert.ok(
    mismatchedTranslationEndpointIssue,
    "translation loop endpoint validation should keep raw component behavior"
  );
  assert.equal(mismatchedTranslationEndpointIssue.track, 0);
  assert.equal(mismatchedTranslationEndpointIssue.joint, "head");
  assert.equal(mismatchedTranslationEndpointIssue.property, "translation");
  assert.equal(mismatchedTranslationEndpointIssue.delta, 0.25);
  assert.ok(
    mismatchedTranslationEndpointIssue.message.includes("delta 0.2500"),
    "translation seam warning should include measured delta"
  );

  const trimmedMatchedPlaybackEndpointClip: AnimationClip = {
    id: "trimmed-matched-playback-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.75, 1]),
        values: toFloat32Array([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0])
      }
    ]
  };
  const trimmedMatchedPlaybackEndpointInspection = inspectAnimationAsset(
    {
      id: "trimmed-matched-playback-endpoints",
      label: "Trimmed Matched Playback Endpoints",
      url: "/trimmed-matched-playback-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      playback: { start: 0.25, end: 0.75 }
    },
    trimmedMatchedPlaybackEndpointClip,
    skeleton
  );
  assert.equal(
    trimmedMatchedPlaybackEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "loop endpoint validation should compare sampled playback-window endpoints instead of raw keyframe endpoints"
  );

  const trimmedMismatchedPlaybackEndpointClip: AnimationClip = {
    id: "trimmed-mismatched-playback-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 0.25, 0.75, 1]),
        values: toFloat32Array([0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0, 0, 0])
      }
    ]
  };
  const trimmedMismatchedPlaybackEndpointIssue = inspectAnimationAsset(
    {
      id: "trimmed-mismatched-playback-endpoints",
      label: "Trimmed Mismatched Playback Endpoints",
      url: "/trimmed-mismatched-playback-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true,
      playback: { start: 0.25, end: 0.75 }
    },
    trimmedMismatchedPlaybackEndpointClip,
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(
    trimmedMismatchedPlaybackEndpointIssue,
    "loop endpoint validation should warn when sampled playback-window endpoints differ even if raw keyframe endpoints match"
  );
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.track, 0);
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.joint, "head");
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.property, "translation");
  assert.equal(trimmedMismatchedPlaybackEndpointIssue.delta, 0.25);

  const inferredLoopEndpointIssue = inspectAnimationAsset(
    {
      id: "inferred-loop-endpoints",
      label: "Inferred Loop Endpoints",
      url: "/inferred-loop-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT
    },
    { ...mismatchedTranslationEndpointClip, id: "inferred-loop-endpoints" },
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(
    inferredLoopEndpointIssue,
    "decoded clip.loop should enable loop endpoint validation when manifest loop is omitted"
  );
  assert.equal(inferredLoopEndpointIssue.track, 0);
  assert.equal(inferredLoopEndpointIssue.joint, "head");
  assert.equal(inferredLoopEndpointIssue.property, "translation");

  const manifestLoopFalseEndpointInspection = inspectAnimationAsset(
    {
      id: "manifest-loop-false-endpoints",
      label: "Manifest Loop False Endpoints",
      url: "/manifest-loop-false-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: false
    },
    { ...mismatchedTranslationEndpointClip, id: "manifest-loop-false-endpoints" },
    skeleton
  );
  assert.equal(
    manifestLoopFalseEndpointInspection.loop,
    false,
    "manifest loop false should override decoded clip.loop in the validation report"
  );
  assert.equal(
    manifestLoopFalseEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "manifest loop false should disable loop endpoint validation even when decoded clip.loop is true"
  );

  const mismatchedRotationEndpointClip: AnimationClip = {
    id: "mismatched-rotation-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0, 0.5, 0, 0.8660254])
      }
    ]
  };
  const mismatchedRotationEndpointIssue = inspectAnimationAsset(
    {
      id: "mismatched-rotation-endpoints",
      label: "Mismatched Rotation Endpoints",
      url: "/mismatched-rotation-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    mismatchedRotationEndpointClip,
    skeleton
  ).issues.find((issue) => issue.message.startsWith(loopEndpointWarning));
  assert.ok(
    mismatchedRotationEndpointIssue,
    "rotation loop endpoint validation should report mismatched rotation endpoints"
  );
  assert.equal(mismatchedRotationEndpointIssue.track, 0);
  assert.equal(mismatchedRotationEndpointIssue.joint, "head");
  assert.equal(mismatchedRotationEndpointIssue.property, "rotation");
  assert.ok(
    (mismatchedRotationEndpointIssue.delta ?? 0) > 0.5,
    "rotation seam warning should include a meaningful measured delta"
  );

  const malformedLoopEndpointClip: AnimationClip = {
    id: "malformed-loop-endpoints",
    duration: 1,
    loop: true,
    tracks: [
      { humanBone: "head", property: "translation", times: toFloat32Array([0, 1]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  const malformedLoopEndpointInspection = inspectAnimationAsset(
    {
      id: "malformed-loop-endpoints",
      label: "Malformed Loop Endpoints",
      url: "/malformed-loop-endpoints.waifuanim.bin",
      format: WAIFU_ANIMATION_BINARY_FORMAT,
      loop: true
    },
    malformedLoopEndpointClip,
    skeleton
  );
  assert.equal(
    malformedLoopEndpointInspection.issues.some((issue) => issue.message.startsWith(loopEndpointWarning)),
    false,
    "malformed loop endpoint tracks should not crash or emit seam warnings from missing samples"
  );
  assert.ok(
    malformedLoopEndpointInspection.issues.some(
      (issue) => issue.message === "track value count does not match times and stride"
    ),
    "malformed loop endpoint tracks should still report structural validation errors"
  );
}
