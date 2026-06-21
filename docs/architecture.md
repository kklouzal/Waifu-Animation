# Architecture

`Waifu-Animation` is the reusable animation core for humanoid avatars. The package keeps the core pose pipeline renderer-agnostic: it does not load VRM files, own a Three.js scene, connect to websocket state, or play audio. Consumers provide skeletons, clips, masks, targets, and facial inputs; the package returns deterministic pose, facial, debug, and validation data. A dedicated `three` module bridges that core data into the current Waifu Three.js renderer without putting conversion logic back in the app.

## Module Boundaries

- `math`: vectors, quaternions, transforms, matrices, deterministic random helpers, damping, interpolation, and quaternion vector-alignment helpers.
- `skeleton`: parent-index skeletons, humanoid mappings, rest poses, and local-to-model conversion.
- `attachments`: Ozz-style joint attachment transform composition for props, targets, and other renderer-agnostic consumers, including reusable bindings that pre-resolve attachment joints and offset matrices.
- `clip`: decoded binary clip tracks, finite-value checks, quaternion continuity, and sampling into local pose buffers.
- `binary`: versioned `.waifuanim.bin` encoding and decoding for animation keyframe payloads.
- `pose`: pose cloning, normalized blending, additive deltas, joint masks, and pose validation.
- `runtime`: weighted layer stack, priorities, first-class override crossfade orchestration, additive layers, optional evaluation diagnostics, and final local/model pose evaluation.
- `masks`: declarative track-name policies for renderer adapters that need to strip root, finger, or lower-body tracks.
- `manifest`: manifest include loading, duplicate/id validation, clip asset inspection, usable/rejected manifest helpers.
- `retargeting`: rest-pose quaternion retargeting and humanoid-bone checks.
- `procedural`: look-at distribution, seeded attention scheduling, speech/backchannel cues, gaze targets, breathing/idle motion, and bounded body/arm/head target planning.
- `ik`: two-bone IK target solve foundation, world-space correction quaternions for consumers, and an Ozz-inspired foot-plant planning job with ankle target correction, pelvis compensation, target clamping, and explicit skipped/clamped statuses.
- `face`: viseme stack limiting, configurable viseme smoothing, reusable facial expression composition, mouth envelope smoothing, and blink scheduling.
- `debug` and `validation`: rotation/translation/scale pose delta metrics, invalid pose reports, and deterministic input checks.
- `three`: decoded clip to Three binding, rest-pose retargeting into normalized VRM bones, track policy application, base/overlay/debug runtime clip construction for Three `AnimationMixer`, and sanitized app-facing runtime clip snapshots/influence diagnostics.


### 2026-06-08 hardening update

- Override blending now exposes an Ozz-style `DEFAULT_BLEND_THRESHOLD` (`0.1`) and `BlendPoseOptions.threshold`.  Per-joint accumulated override weight below the threshold blends back toward the skeleton rest pose, matching Ozz's bind/rest fallback intent and preventing tiny-weight layers from fully owning a joint during fades or partial masks.
- `AnimationRuntime` accepts `AnimationRuntimeOptions.blendThreshold` and routes override evaluation through priority groups before additive layers and local-to-model conversion. Layers at the same priority use weighted blending; higher-priority groups blend over lower-priority results only for joints they own by weight and mask.
- `AnimationRuntime.crossfade` creates or replaces a target layer, preserves an existing layer's blend mode unless the caller overrides it, fades matching same-priority override sources toward zero only for override targets, leaves additive layers active, and relies on the existing priority/mask threshold evaluation for final pose composition.
- The optional Three adapter owns `applyThreePresenceTargets`, a reusable bridge for consumers that opt into applying package-planned procedural presence bone targets to Three/VRM bones with finite-target checks, clamped influence, damped quaternion slerp, and missing-bone telemetry.

### 2026-06-14 final polish

- Binary clip encoding now rejects malformed `sourceRestQuaternion` metadata before writing payloads, and decoding rejects float tables whose byte length is not aligned to `Float32Array` storage.
- Debug pose delta metrics compare rotation, translation, and scale across local pose buffers, preserving sign-equivalent quaternion behavior and surfacing max joint indices/names when skeleton data is supplied.
- Blink and Three adapter damping paths route non-finite elapsed time through shared damp-alpha sanitization, keeping scheduler decay, locomotion posture, and foot-plant application deterministic for bad frame timing.
- Two-bone IK projection keeps the solved joint on the upper-bone sphere without redundant trigonometric roundtrips.

## Ozz-Inspired Frame Model

The canonical model mirrors Ozz Animation's runtime flow:

1. Sample authored clips into local-space transforms.
2. Blend local poses by normalized layer weights.
3. Apply masks for partial-body ownership.
4. Apply additive layers only as deltas from a reference pose.
5. Normalize quaternions and validate finite transforms.
6. Convert local transforms to model-space matrices.
7. Let procedural jobs, look-at, foot planting, and IK consume explicit target inputs and return bounded corrections for consumers that opt into procedural skeletal application.
8. Emit skeletal pose data and expression/viseme weights to the consumer.

Runtime evaluation diagnostics are opt-in through `AnimationRuntime.evaluate({ diagnostics: true })`. When enabled, active sampled layer poses and the composed local pose are validated with layer/clip context before the final pose is normalized and converted to model space. The same path surfaces tolerant sampler repairs for malformed translation, scale, rotation, and source-rest quaternion samples, so consumers can log repaired or invalid source data without paying that cost on every frame by default.

Attachment helpers mirror the Ozz attach sample: consumers select a joint from the LocalToModel/model-space matrix array and concatenate a joint-relative offset matrix after that joint model matrix. `createAttachmentBinding` and `createAttachmentBindings` let consumers resolve joint names or humanoid aliases and sanitize offsets once during setup; `computeBoundAttachmentTransform` and `computeBoundAttachmentTransforms` then evaluate attachments directly from model-space pose matrices without per-frame name lookup or offset recomposition.

Ozz's C++ implementation and SIMD memory layout are not copied. Runtime animation keyframes are shipped as versioned binary payloads and decoded into typed arrays before sampling. JSON remains metadata-only for manifests, curation, includes, behavior hints, and validation policy.

## Waifu Integration Contract

`/Warehouse/Waifu` owns app-specific behavior:

- VRM loading and Three.js scene setup.
- WebGL rendering, UI controls, debug panels, and screenshots/video capture.
- Websocket, server behavior events, Chatterbox speech, and local audio playback.
- Paid asset curation and project-specific behavior scoring.

Waifu consumes this package for reusable concerns:

- deterministic math and seeded randomness;
- manifest include loading and clip asset inspection;
- decoding `.waifuanim.bin` payloads and converting decoded clips to Three tracks;
- retargeting quaternion tracks from source rest pose to active VRM rest pose;
- constructing base, overlay, and debug runtime clip lanes for authored clips played through Three `AnimationMixer`;
- reading sanitized Three runtime clip snapshots and base/overlay/debug influence diagnostics for app debug panels and procedural inputs;
- zeroing and limiting viseme stacks;
- smoothing mouth/viseme targets and composing blink, speech, mood, emotion, and thinking expression weights through `FacialExpressionMixer`;
- deterministic presence scheduling, gaze target planning, non-skeletal look-at cues, and reusable bounded procedural target planning through `PresencePlanner`;
- foot-plant planning data plus optional Three.js pelvis/leg/ankle correction application hooks as reusable library surfaces;
- declarative root/body/finger track policies.

Current Waifu runtime policy consumes authored skeletal animation through Three `AnimationMixer` plus non-skeletal look-at/face/viseme cues. Future migrations can move final pose application from Three `AnimationMixer` onto the package's local-pose runtime or opt into the package's reusable IK/look-at/foot-plant/procedural skeletal hooks.
