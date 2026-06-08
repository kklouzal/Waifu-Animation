# Waifu-Animation

`Waifu-Animation` is a standalone TypeScript animation runtime for humanoid and VRM avatar projects. It is the reusable animation foundation for `/Warehouse/Waifu`. The core pose pipeline is browser-agnostic and renderer-agnostic, with a small optional Three.js adapter for the current Waifu browser renderer.

The architecture follows the Ozz Animation runtime model where it is useful for a TypeScript/VRM runtime:

- skeletons are stable parent-index arrays with local rest poses;
- animation clips are sampled into local-space pose buffers;
- ordinary blending, additive blending, partial masks, and priority are explicit;
- local poses are converted to model-space matrices at a clear pipeline boundary;
- IK, look-at, facial, viseme, scheduler, debug, and validation helpers are optional systems layered around the core pose pipeline.

This project does not embed Ozz C++ source. It mirrors Ozz concepts and math boundaries in TypeScript. Ozz Animation is MIT licensed; see `docs/ozz-reference.md` for attribution and design notes.

See also:

- `docs/architecture.md` for module boundaries, frame order, and the Waifu integration contract.
- `docs/validation.md` for package gates, Waifu visual gates, artifact paths, and current limitations.
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
- `clip`: binary-backed clip types, sampling, validation, quaternion continuity.
- `pose`: rest pose creation, blending, additive layers, masks, pose validation.
- `runtime`: deterministic layer stack, crossfades, priorities, final local/model pose evaluation.
- `procedural`: look-at distribution, seeded attention/idle scheduling helpers.
- `ik`: two-bone IK and target clamping foundations.
- `face`: viseme mixer, expression mixer, blink scheduler.
- `retargeting`: VRM humanoid helpers and rest-pose quaternion retargeting.
- `binary`: versioned `.waifuanim.bin` encode/decode for animation keyframe payloads.
- `three`: Three.js `AnimationClip`/`AnimationMixer` adapter for decoded animation clips, track policies, and runtime clip lanes.
- `debug`: pose metrics, invalid transform diagnostics, runtime snapshots.

## Pipeline

The canonical frame pipeline is:

1. Sample base clips into local-space transforms.
2. Blend base layers by normalized weights.
3. Apply posture, locomotion, and idle layers.
4. Apply partial-body and additive layers through masks.
5. Normalize and validate local pose quaternions.
6. Convert local pose to model-space matrices.
7. Apply procedural look-at/aim and IK corrections through explicit hooks.
8. Emit skeletal pose plus facial/viseme expression weights to the consumer.

Waifu remains responsible for VRM model loading, browser rendering, websocket state, audio playback, and visual capture. `Waifu-Animation` owns reusable math, manifests, validation, retargeting, Three clip binding, runtime clip lane setup, and deterministic animation decisions.
