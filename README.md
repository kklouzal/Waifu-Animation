# Waifu-Animation

`Waifu-Animation` is a standalone TypeScript animation runtime for humanoid and VRM avatar projects. It is a reusable animation foundation for Waifu-style avatar applications. The core pose pipeline is browser-agnostic and renderer-agnostic, with a small optional Three.js adapter for browser renderers.

The architecture follows the Ozz Animation runtime model where it is useful for a TypeScript/VRM runtime:

- skeletons are stable parent-index arrays with local rest poses;
- animation clips are sampled into local-space pose buffers;
- ordinary blending, additive blending, partial masks, and priority are explicit;
- local poses are converted to model-space matrices at a clear pipeline boundary;
- IK, look-at, facial, viseme, scheduler, debug, and validation helpers are optional reusable systems layered around the core pose pipeline.

This project does not embed Ozz C++ source. It mirrors Ozz concepts and math boundaries in TypeScript. Ozz Animation is MIT licensed; see `docs/ozz-reference.md` for attribution and design notes.

See also:

- `docs/architecture.md` for module boundaries, frame order, and the Waifu integration contract.
- `docs/character-controller.md` for Character Controller conventions, current API, usage, and roadmap boundaries.
- `docs/validation.md` for package gates, Waifu visual gates, artifact examples, and current limitations.
- `docs/ozz-reference.md` for Ozz attribution and intentional differences.

## Install

For the sibling Waifu checkout:

```bash
npm install ../Waifu-Animation
```

During local development, build this package before running the Waifu app:

```bash
npm install
npm run build
npm test
```

## Public Modules

- `math`: deterministic random helpers, transform math, quaternion interpolation, matrix composition.
- `skeleton`: Ozz-style skeleton representation, humanoid mapping, local-to-model conversion.
- `attachments`: renderer-agnostic Ozz-style joint attachment transform helpers.
- `clip`: binary-backed clip types, sampling, validation, quaternion continuity.
- `tracks`: generic user-channel tracks, sampling, optimization, and bounded edge triggering.
- `motion`: explicit motion-carrier sampling and interval deltas for root-motion consumers.
- `character-controller`: deterministic, engine-agnostic avatar controller foundation for fixed-step movement intent, facing, gait speed, posture/locomotion phases, jump buffering/coyote timing, world-adapter boundaries, animation-facing parameters/events, and snapshot/restore.
- `pose`: rest pose creation, blending, additive layers, masks, pose validation.
- `skinning`: reusable matrix-palette skinning for positions, normals, and tangents.
- `baked`: Ozz baked-sample style camera-joint, rigid-instance matrix, and bounds helpers.
- `runtime`: deterministic layer stack, crossfades, priorities, explicit root-motion delta collection, and final local/model pose evaluation.
- `masks`: declarative track-name policies for renderer adapters.
- `manifest`: manifest includes, duplicate/id validation, clip asset inspection, usable/rejected clip helpers.
- `importer-config`: typed planning helpers for Ozz-style offline config slices without owning extraction tooling.
- `procedural`: look-at distribution, seeded attention/idle scheduling helpers.
- `ik`: two-bone IK and target clamping foundations.
- `face`: viseme mixer, expression mixer, blink scheduler.
- `retargeting`: VRM humanoid helpers and rest-pose quaternion retargeting.
- `binary`: versioned `.waifuanim.bin` encode/decode for animation keyframe payloads.
- `three`: Three.js `AnimationClip`/`AnimationMixer` adapter for decoded authored animation clips, track policies, runtime clip lanes, action preparation, base-loop seam/transition policy helpers, overlay fade helpers, sanitized clip snapshots, reusable procedural application hooks, skinned/debug geometry and instancing adapters, and base/overlay/debug influence diagnostics.
- `debug`, `validation`, and `asset-validation`: pose metrics, invalid transform diagnostics, runtime snapshots, input checks, and manifest/clip asset validation.
- `character-controller`: engine-agnostic Y-up/+Z-forward controller core with explicit movement/facing/gait/posture/jump/action intent, world query/resolution contracts, clip-agnostic animation parameters/events, bounded fixed-step catch-up, and deterministic snapshot/restore.

## Pipeline

The canonical frame pipeline is:

1. Sample base clips into local-space transforms.
2. Blend base layers by normalized weights.
3. Apply posture, locomotion, and idle layers.
4. Apply partial-body and additive layers through masks.
5. Normalize and validate local pose quaternions.
6. Convert local pose to model-space matrices.
7. Optionally collect blended motion-carrier interval deltas from active override layers as explicit root-motion output; collection does not apply or strip motion from the skeleton pose.
8. Optionally run procedural look-at/aim, foot-plant, and IK jobs through explicit library hooks for consumers that opt into procedural skeletal corrections.
9. Emit skeletal pose plus facial/viseme expression weights and non-skeletal cue data to the consumer.

Waifu remains responsible for VRM model loading, browser rendering, websocket state, audio playback, and visual capture. Under the current Waifu app policy, authored animation clips played through Three `AnimationMixer` are the only runtime source of skeletal bone/joint rotations. `Waifu-Animation` still owns reusable math, manifests, validation, retargeting, Three clip binding, runtime clip lane setup, generic lane blend/action policy, deterministic animation decisions, non-skeletal look-at/face/viseme cues, and optional IK/look-at/foot-plant/procedural job APIs for other consumers or future Waifu policies.
