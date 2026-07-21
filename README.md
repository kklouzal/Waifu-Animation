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
- `root-motion-authority`: explicit physics-driven, animation-driven, and hybrid root-motion authority contracts, runtime carrier selection from `AnimationRuntime` reports, no-double-apply ownership tokens, and engine-agnostic collision reconciliation.
- `character-controller`: deterministic, engine-agnostic avatar controller foundation for fixed-step movement intent, facing, gait speed, posture/locomotion phases, jump buffering/coyote timing, world-adapter boundaries, animation-facing parameters/events, and snapshot/restore.
- `navigation`: renderer/physics-agnostic destination/path/waypoint/corridor, topology sampling/path-planning, traversal-link, and local-avoidance contracts plus deterministic `CharacterPathFollower` output to controller movement/facing intent.
- `interactions`: reusable deterministic pickup/carry/drop/equip/unequip/use/sit/stand contracts with opaque socket/resource/anchor registries, resource/socket reservation requests, ownership locks, reach/attachment handoff outputs, semantic animation requests/events, cancellation/failure, and snapshot/restore.
- `world-coordinator`: deterministic multi-actor batching for existing controllers with stable actor ordering, per-actor seeded state, destination/resource/path-blocker reservation arbitration, path-follower coordination, and batch snapshot/restore.
- `character-animation-graph`: deterministic, clip-agnostic request graph that turns controller animation state/events into semantic locomotion, posture, airborne, and action playback/blend/transition requests with hysteresis, debouncing, bounds, and snapshot/restore.
- `character-animation-binding`: reusable semantic binding registry/resolver that maps graph request ids to opaque clip asset ids plus runtime lane, layer, mask, loop, fade, priority, blend-mode, and playback policy metadata without importing Three/VRM APIs or choosing app-specific assets.
- `character-animation-runtime-applier`: stateful renderer-agnostic bridge from resolved graph bindings to `AnimationRuntime` layers with owned layer namespacing, caller-supplied clip/mask lookup, stale layer retirement, one-shot action identity tracking, and no root-motion authority decisions.
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

## Pipeline

The canonical frame pipeline is:

1. Sample base clips into local-space transforms.
2. Blend base layers by normalized weights.
3. Apply posture, locomotion, and idle layers.
4. Apply partial-body and additive layers through masks.
5. Normalize and validate local pose quaternions.
6. Convert local pose to model-space matrices.
7. Optionally collect blended motion-carrier interval deltas from active override layers as explicit root-motion output; collection does not apply or strip motion from the skeleton pose.
8. If a consumer opts into world root motion, route the selected finite animation delta plus any controller/physics displacement through `RootMotionReconciler` using explicit local-vs-world space, authority mode, collision adapter, and ownership token declarations. The result is report-only until Waifu applies it to exactly one owner.
9. Optionally run interaction/equipment coordination after controller/navigation reservation resolution. `CharacterInteractionCoordinator` emits semantic animation requests, approach/alignment/contact/exit anchors, reach target windows, and attach/detach ownership changes; consumers apply those outputs to their own world objects, IK solvers, and renderers.
10. Optionally run procedural look-at/aim, foot-plant, and IK jobs through explicit library hooks for consumers that opt into procedural skeletal corrections.
11. Emit skeletal pose plus facial/viseme expression weights and non-skeletal cue data to the consumer.

Waifu remains responsible for VRM model loading, browser rendering, websocket state, audio playback, visual capture, concrete navmesh/topology/collision adapters, local avoidance implementations, AI/schedules, concrete tavern/guild-hall resources, Object3D/VRM prop lifecycle, physics bodies, and content-specific use effects. Under the current Waifu app policy, authored animation clips played through Three `AnimationMixer` are the only runtime source of skeletal bone/joint rotations. `Waifu-Animation` still owns reusable math, manifests, validation, retargeting, Three clip binding, semantic request-to-clip/lane binding, runtime clip lane setup, generic lane blend/action policy, deterministic controller/navigation/interactions/coordinator/root-motion decisions, non-skeletal look-at/face/viseme cues, and optional IK/look-at/foot-plant/procedural job APIs for other consumers or future Waifu policies.
