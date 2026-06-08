# Architecture

`Waifu-Animation` is the reusable animation core for humanoid avatars. The package keeps the core pose pipeline renderer-agnostic: it does not load VRM files, own a Three.js scene, connect to websocket state, or play audio. Consumers provide skeletons, clips, masks, targets, and facial inputs; the package returns deterministic pose, facial, debug, and validation data. A dedicated `three` module bridges that core data into the current Waifu Three.js renderer without putting conversion logic back in the app.

## Module Boundaries

- `math`: vectors, quaternions, transforms, matrices, deterministic random helpers, damping, and interpolation.
- `skeleton`: parent-index skeletons, humanoid mappings, rest poses, and local-to-model conversion.
- `clip`: decoded binary clip tracks, finite-value checks, quaternion continuity, and sampling into local pose buffers.
- `binary`: versioned `.waifuanim.bin` encoding and decoding for animation keyframe payloads.
- `pose`: pose cloning, normalized blending, additive deltas, joint masks, and pose validation.
- `runtime`: weighted layer stack, priorities, crossfade weights, additive layers, and final local/model pose evaluation.
- `masks`: declarative track-name policies for renderer adapters that need to strip root, finger, or lower-body tracks.
- `manifest`: manifest include loading, duplicate/id validation, clip asset inspection, usable/rejected manifest helpers.
- `retargeting`: rest-pose quaternion retargeting and humanoid-bone checks.
- `procedural`: look-at distribution, seeded attention scheduling, speech/backchannel cues, gaze targets, breathing/idle motion, and bounded body/arm/head target planning.
- `ik`: two-bone IK target solve foundation.
- `face`: viseme stack limiting, configurable viseme smoothing, reusable facial expression composition, mouth envelope smoothing, and blink scheduling.
- `debug` and `validation`: pose metrics, invalid pose reports, and deterministic input checks.
- `three`: decoded clip to Three binding, rest-pose retargeting into normalized VRM bones, track policy application, and base/overlay/debug runtime clip construction for Three `AnimationMixer`.

## Ozz-Inspired Frame Model

The canonical model mirrors Ozz Animation's runtime flow:

1. Sample authored clips into local-space transforms.
2. Blend local poses by normalized layer weights.
3. Apply masks for partial-body ownership.
4. Apply additive layers only as deltas from a reference pose.
5. Normalize quaternions and validate finite transforms.
6. Convert local transforms to model-space matrices.
7. Let procedural jobs, look-at, and IK consume explicit target inputs and write bounded corrections.
8. Emit skeletal pose data and expression/viseme weights to the consumer.

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
- constructing base, overlay, and debug runtime clip lanes for Three `AnimationMixer`;
- zeroing and limiting viseme stacks;
- smoothing mouth/viseme targets and composing blink, speech, mood, emotion, and thinking expression weights through `FacialExpressionMixer`;
- deterministic presence scheduling, gaze target planning, and bounded procedural bone targets through `PresencePlanner`;
- declarative root/body/finger track policies.

Future migrations can move final pose application from Three `AnimationMixer` onto the package's local-pose runtime. The current baseline already keeps the Three adapter and animation plumbing in `Waifu-Animation`.
