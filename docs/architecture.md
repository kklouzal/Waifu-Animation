# Architecture

`Waifu-Animation` is the reusable animation core for humanoid avatars. The package stays renderer-agnostic: it does not load VRM files, own a Three.js scene, connect to websocket state, or play audio. Consumers provide skeletons, clips, masks, targets, and facial inputs; the package returns deterministic pose, facial, debug, and validation data.

## Module Boundaries

- `math`: vectors, quaternions, transforms, matrices, deterministic random helpers, damping, and interpolation.
- `skeleton`: parent-index skeletons, humanoid mappings, rest poses, and local-to-model conversion.
- `clip`: JSON clip tracks, finite-value checks, quaternion continuity, and sampling into local pose buffers.
- `pose`: pose cloning, normalized blending, additive deltas, joint masks, and pose validation.
- `runtime`: weighted layer stack, priorities, crossfade weights, additive layers, and final local/model pose evaluation.
- `masks`: declarative track-name policies for renderer adapters that need to strip root, finger, or lower-body tracks.
- `manifest`: manifest include loading, duplicate/id validation, clip asset inspection, usable/rejected manifest helpers.
- `retargeting`: rest-pose quaternion retargeting and humanoid-bone checks.
- `procedural`: look-at distribution, seeded attention scheduling, and breathing weights.
- `ik`: two-bone IK target solve foundation.
- `face`: viseme stack limiting, viseme smoothing, expression mixing, and blink scheduling.
- `debug` and `validation`: pose metrics, invalid pose reports, and deterministic input checks.

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

Ozz's C++ implementation and SIMD memory layout are not copied. This package keeps JSON-friendly track arrays and TypeScript transforms because Waifu currently ships converted animation clips to a browser renderer.

## Waifu Integration Contract

`/Warehouse/Waifu` owns app-specific behavior:

- VRM loading and Three.js scene setup.
- WebGL rendering, UI controls, debug panels, and screenshots/video capture.
- Websocket, server behavior events, Chatterbox speech, and local audio playback.
- Paid asset curation and project-specific behavior scoring.

Waifu consumes this package for reusable concerns:

- deterministic math and seeded randomness;
- retargeting quaternion tracks from source rest pose to active VRM rest pose;
- zeroing and limiting viseme stacks;
- declarative root/body/finger track policies;
- manifest/clip asset inspection in the runtime gate.

The next larger migration should move the Three `AnimationMixer` binding into a package adapter while keeping the current browser/runtime surface in Waifu.
