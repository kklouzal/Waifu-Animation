# Architecture

## Mandatory numeric kernel boundary

The retained animation execution chain is initialized asynchronously through the ABI v1.5 Rust/WASM kernel and then used synchronously through per-avatar contexts. SIMD-capable browsers select the SIMD128 artifact; other browsers select scalar-WASM. Asset, instantiate, ABI, feature, memory, and job failures are explicit and never route the retained runtime through TypeScript numeric code. TypeScript remains responsible for scheduling, root-motion policy, contact acquisition, import/config/debug data, renderer adaptation, lifecycle, and final public object materialization. See `wasm-kernel-architecture.md` for the exact migrated/debt inventory and memory/epoch contract.

`Waifu-Animation` is the reusable animation core for humanoid avatars. The package keeps the core pose pipeline renderer-agnostic: it does not load VRM files, own a Three.js scene, connect to websocket state, or play audio. Consumers provide skeletons, clips, masks, targets, and facial inputs; the package returns deterministic pose, facial, debug, and validation data. A dedicated `three` module bridges that core data into the current Waifu Three.js renderer without putting conversion logic back in the app.

## Module Boundaries

- `math`: vectors, quaternions, transforms, matrices, deterministic random helpers, damping, interpolation, and quaternion vector-alignment helpers.
- `skeleton`: parent-index skeletons, humanoid mappings, rest poses, and local-to-model conversion.
- `attachments`: Ozz-style joint attachment transform composition for props, targets, and other renderer-agnostic consumers, including reusable bindings that pre-resolve attachment joints and offset matrices.
- `clip`: decoded binary clip tracks, finite-value checks, quaternion continuity, and sampling into local pose buffers.
- `binary`: versioned `.waifuanim.bin` encoding and decoding for animation keyframe payloads.
- `tracks`: generic Ozz-style user-channel track validation, build, sampling, optimization, and bounded trigger-edge queries.
- `pose`: pose cloning, normalized blending, additive deltas, joint masks, and pose validation.
- `runtime`: weighted layer stack, priorities, first-class override crossfade orchestration, additive layers, optional evaluation diagnostics, and final local/model pose evaluation.
- `root-motion-authority`: reusable authority/reconciliation layer for `AnimationRuntime.update(..., { collectRootMotion: true })` reports. It defines physics-driven, animation-driven, and hybrid authority policies; selects contributing runtime layers by explicit none/layer/clip/bone/metadata bindings; converts local actor deltas to world motion under the package Y-up/+Z-forward convention; routes the requested world displacement/yaw through an engine-agnostic collision adapter; and reports requested, consumed/applied, rejected, and residual motion with ownership tokens.
- `skinning`: reusable matrix-palette skinning for positions, normals, tangents, inverse-bind palettes, remaps, output reuse, and overlap diagnostics.
- `baked`: baked-sample helpers for camera joints, rigid-instance matrices, and rigid-instance bounds.
- `masks`: declarative track-name policies for renderer adapters that need to strip root, finger, or lower-body tracks.
- `manifest`: bounded manifest include loading, duplicate/id validation, root-motion policy/provenance metadata readers, clip asset inspection, usable/rejected manifest helpers. Runtime JSON readers ignore inherited/prototype-backed fields, reject sparse/non-record metadata shapes, bound public string/array/include inputs, preserve deterministic parent-before-include clip ordering, and use manifest root-motion metadata as the authority over clip fallbacks.
- `asset-validation`: manifest-entry asset loading, binary decode inspection, semantic coverage/root-motion/loop reports, and accepted/rejected/quarantined summaries. Reports reuse the same structural manifest rejection semantics before fetching binaries so malformed entries, duplicate ids, quarantines, stale rejection reasons, and invalid metadata cannot leak through as accepted assets.
- `importer-config`: app-agnostic Ozz-style offline import planning for additive references, raw motion extraction, optimization, user tracks, baked camera joints, and rigid instances.
- `retargeting`: rest-pose quaternion retargeting and humanoid-bone checks.
- `procedural`: look-at distribution, seeded attention scheduling, speech/backchannel cues, gaze targets, breathing/idle motion, and bounded body/arm/head target planning.
- `ik`: two-bone IK target solve foundation, world-space correction quaternions for consumers, and an Ozz-inspired foot-plant planning job with ankle target correction, optional ground-slope rejection, pelvis compensation, target clamping, and explicit skipped/clamped statuses.
- `face`: viseme stack limiting, configurable viseme smoothing, reusable facial expression composition, mouth envelope smoothing, and blink scheduling.
- `debug` and `validation`: rotation/translation/scale pose delta metrics, invalid pose reports, and deterministic input checks.
- `character-controller`: deterministic engine-agnostic controller core for avatar locomotion intent, facing/yaw, gait speed, posture/locomotion phases, jump buffering/coyote timing, traversal/contact world-adapter boundaries, moving-platform carry, clip-agnostic animation parameters/events, and snapshot/restore.
- `navigation`: renderer/physics-agnostic navigation contracts plus `CharacterPathFollower`. It defines destination/path/waypoint/corridor shapes, topology sampling/path-planning adapter boundaries, off-mesh/traversal link descriptors, local avoidance query/result boundaries, deterministic path-to-controller intent, stable arrival/turn-in-place/blocked/repath semantics, finite input hardening, and snapshot/restore. It intentionally does not implement or claim a concrete navmesh.
- `interactions`: deterministic reusable interaction/equipment contracts. It defines opaque character sockets, interactable resources/items/seats/stations, approach/align/contact/use/seat/exit anchors, capabilities, ownership/reservation/use locks, and `CharacterInteractionCoordinator` state machines for pickup/carry/drop/equip/unequip/use/sit/stand. Outputs are semantic animation requests/events, reach/IK target windows, and attach/detach handoff records only; Object3D, VRM, physics body, inventory, and content effects remain consumer-owned.
- `world-coordinator`: deterministic multi-actor coordinator for existing `CharacterController` instances. It provides stable actor ordering, per-actor seeded deterministic state, destination/resource/path-blocker reservation arbitration, path-follower batching, and batch snapshot/restore without owning Waifu AI, scene resources, schedules, or world assets.
- `character-animation-graph`: deterministic controller-to-animation request graph. It consumes `CharacterAnimationState` plus controller transitions/events and emits semantic, clip-agnostic playback, blend, transition, and action requests for locomotion gaits, posture/crouch, jump/rise/fall/landing, and action forwarding.
- `character-animation-binding`: deterministic semantic binding registry/resolver. It validates and freezes caller-owned clip asset ids and maps graph playback/blend/transition/action request ids to opaque clip ids plus runtime lane, layer, mask, priority, fade, loop, blend-mode, weight, and playback-speed policy metadata without importing Three/browser/VRM code or sampling clips.
- `character-animation-runtime-applier`: renderer-agnostic bridge from resolved character binding output to `AnimationRuntime` layers. Callers supply clip and mask lookups; the stateful applier namespaces/tracks owned layers, applies blend/playback/transition/action commands through runtime layer APIs, reports missing resources/conflicts/bounds, and deliberately leaves root-motion authority to the explicit `root-motion-authority` layer.
- `three`: decoded clip to Three binding, rest-pose retargeting into normalized VRM bones, track policy application, base/overlay/debug runtime clip construction for Three `AnimationMixer`, skinned/debug geometry and rigid-instance upload adapters, and sanitized app-facing runtime clip snapshots/influence diagnostics.

### 2026-07-20 character controller foundation

- `CharacterController` is now exported as a reusable library core with an explicit Y-up/+Z-forward coordinate contract. It owns deterministic fixed-step state, sanitized movement/facing/gait/posture/jump/action intent, controller velocity, yaw turning, acceleration/deceleration, gravity, jump buffering, coyote timing, crouch transition progress, grounded/rising/falling/landing phases, ordered events/transitions, and snapshot/restore.
- Physics remains adapter-owned through `CharacterWorldAdapter` (`queryGround`, `resolveStepUp`, `resolveStepDown`, `sweepCapsule`, `resolveMovement`, `resolveSteepSlopeSlide`, `checkCapsuleClearance`). Adapter failures or non-finite results are surfaced as events and do not import or bind any concrete physics engine.
- Animation remains clip-agnostic. The controller emits `CharacterAnimationState` parameters/events for the separate animation graph; it does not choose clip names or write bones.
- The controller now covers bounded step negotiation, support snap/down-step contracts, steep-slope non-grounding with single explicit slide application, low-level wall-plane displacement projection/high-level wall velocity projection, moving-platform velocity carry, and clearance-gated crouch exit. It intentionally stops before ledge vault/mantle, interaction/equipment execution, reach/IK coordination, concrete root-motion application, and Waifu app integration. See `docs/character-controller.md` for usage and roadmap boundaries.

### 2026-07-20 character animation graph, binding, and runtime-applier slices

- `CharacterAnimationGraph` is exported as a reusable deterministic layer above `CharacterController`. It has validated frozen config, deterministic snapshot/restore, optional output-buffer reuse, bounded event/transition scanning, finite input hardening, and no Three/browser/VRM imports.
- Request ids are semantic contracts, not asset names. Defaults are `locomotion:idle`, `locomotion:gait:<gaitId>`, `posture:standing`, `posture:crouching`, `airborne:rise`, `airborne:fall`, `airborne:landing`, and `action:<kind>`, all configurable by id/prefix.
- `CharacterAnimationBindingRegistry` is the next reusable layer. Callers configure opaque `clips[]` and semantic `bindings[]`; the registry validates duplicates/missing clip references/invalid runtime policy, freezes accepted entries, and resolves graph output to configured clip ids plus runtime lane/layer/mask/loop/fade/priority/blend/playback metadata.
- Binding resolution is truthful and deterministic: unbound semantic ids, layer mismatches, malformed graph records, hostile non-finite fields, and bounded scans are reported in `issues`; the resolver does not substitute arbitrary fallback clips. Optional `createCharacterAnimationBindingOutputBuffer()` lets callers reuse output arrays on hot paths.
- `CharacterAnimationRuntimeApplier` is the stateful runtime bridge. It consumes `CharacterAnimationBindingOutput`, caller-owned `AnimationClip`/`JointMask` lookups, and an existing `AnimationRuntime`; namespaces owned runtime layer ids, applies target weights/fades/speeds/priorities/masks/loop flags through `crossfade`, fades or removes only previously owned stale layers, seeds phase time only when a layer is new/replaced/action-triggered so repeated applies do not rewind runtime-owned playback, clears stale masks when an unmasked command replaces a masked owned layer, and keeps action command identities from retriggering every frame.
- Transition precedence is action forwarding first, then airborne, posture, and locomotion transitions in output order; `primaryRequestId` prefers airborne requests over locomotion while jump/fall/landing is active. Locomotion uses start/stop speed-ratio hysteresis, airborne rise-to-fall uses a `minRiseSeconds` debounce, and landing can be held for a short deterministic handoff window. The applier collapses graph blends/playback into one command per owned runtime layer so blend endpoints are not double-applied.
- These layers intentionally stop before skeletal pose evaluation ownership, root-motion reconciliation/application, IK/reach execution, action/equipment state machines, or Waifu app integration; the applier does not collect or apply world displacement.

### 2026-07-21 navigation and deterministic multi-actor coordination slice

- Navigation is now expressed as reusable contracts, not an embedded world system: callers own navmesh/topology construction, sampling, path planning, traversal execution, local-avoidance algorithms, and any tavern/guild-hall resources. `NavigationTopologyAdapter`, `NavigationPath`, `NavigationPathCorridor`, `NavigationTraversalLinkDescriptor`, and `NavigationLocalAvoidanceAdapter` are explicit data/API boundaries for those consumers.
- `CharacterPathFollower` translates a sanitized path and `CharacterControllerSnapshot` into `CharacterControllerInput` using the package-wide Y-up/+Z-forward convention. It advances waypoints deterministically, slows into the final destination, turns in place when final facing is required, reports `blocked`/`needs-repath`/`invalid` outcomes instead of hiding failures, validates finite path/controller/avoidance data, and supports schema-versioned snapshot/restore.
- `CharacterWorldCoordinator` batches existing controllers in lexicographic actor-id order, feeds registered path followers, exposes deterministic per-actor seeded state, and resolves destination/resource/path-blocker reservations by reservation priority, actor priority, then actor id. Denied actors hold position for that batch, while granted actors continue through their existing controllers.
- Ownership boundaries remain strict: Waifu or another consumer still owns behavior trees/GOAP/schedules, tavern/guild-hall fixtures, seats/tables/counters, crowd goals, concrete navmesh baking, physics collision, authored assets, path-planning adapters, and final integration. This package only provides deterministic reusable coordination primitives and typed handoff surfaces.

### 2026-07-21 interaction/equipment coordination slice

- Interaction and equipment are now reusable pure-data contracts rather than tavern content. `CharacterSocketRegistry` stores opaque sockets such as hand/back/hip ids with optional metadata; `InteractionResourceRegistry` stores items, seats, stations, capabilities, default/action sockets, and approach/align/contact/use/seat/exit anchors with strict finite transforms.
- `CharacterInteractionCoordinator` runs deterministic finite state machines for `pickup`, `carry`, `drop`, `equip`, `unequip`, `use`, `sit`, and `stand`. The normal phase path is approach → align → reach → contact/transfer or seated/equipped/use → release/exit as appropriate, with explicit terminal `completed`, `cancelled`, and `failed` states. Phase durations are finite and configurable, snapshots include active phase/time/emitted/applied keys, and replay is deterministic.
- Resource ownership is explicit and exclusive: resources can have at most one owner (`held`, `carried`, `equipped`, or `seated`), one active reservation, and one transient use lock. Cancellation/interruption clears reservations and transient use locks without inventing app inventory changes. Attach/detach handoff records are emitted exactly once per command/window and include actor, resource, socket, phase, and command ids.
- Coordinator integration is by typed reservation requests. `createInteractionReservationRequests()` emits resource and actor-socket reservation requests that can be arbitrated by `CharacterWorldCoordinator`; denied grants supplied back to the interaction coordinator fail deterministically instead of creating stale locks or double owners.
- Reach/IK and attachment are handoff outputs only. Results include target transforms/socket ids/windows/events and ownership changes; consumers still own Object3D/VRM lifecycle, IK solver execution, prop parenting, physics, audio, UI, world resources, and content-specific use effects.

### 2026-07-21 root-motion authority and collision reconciliation slice

- Root-motion authority is now a first-class reusable contract instead of an app-side convention. `RootMotionReconciler` consumes finite `AnimationRuntime` root-motion reports or direct `Transform` deltas, plus optional controller/physics displacement, and resolves one of three explicit modes: `physics-driven` (controller/physics displacement owns world motion), `animation-driven` (selected animation carrier delta owns world motion), or `hybrid` (finite weighted blend of the two, with separate translation/yaw weights).
- Carrier selection is metadata-driven and app-agnostic. `RootMotionCarrierBinding` can explicitly select `none`, the runtime blended report, a runtime layer id, a clip id, a carrier bone/joint, or arbitrary metadata filters. Candidate ranking is deterministic: binding priority, runtime layer priority, normalized weight, raw weight, then stable ids. The package does not name or curate Waifu clips.
- Coordinate semantics are explicit. Animation deltas default to local actor space and are rotated into world space by the actor yaw; `animationDeltaSpace: "world"` means the displacement is already world-space. Yaw is extracted as Y-up projected heading delta; final reports use yaw 0 = +Z and positive yaw toward +X.
- Collision reconciliation is adapter-owned. `RootMotionWorldAdapter.resolveRootMotion()` receives a pure-data query and may return a partial accepted displacement/yaw or final position/yaw; invalid or throwing adapters reject the request to identity motion with issues. Adapter results are clamped to no-gain bounds so they cannot introduce displacement/yaw the request did not contain.
- Ownership is explicit and report-only. Reusing an ownership token rejects the request, and declaring that the skeleton pose still contains root motion while a world owner is selected raises a double-apply issue (rejected by default). The reconciler does not mutate `CharacterController`, Three `AnimationMixer`, a VRM root, or any model transform. `CharacterWorldCoordinator` can batch report root-motion reconciliation for registered actors, but it remains a typed handoff surface; Waifu must apply the accepted motion to exactly one owner or intentionally keep it diagnostic-only.

### 2026-06-08 hardening update

- Override blending now exposes an Ozz-style `DEFAULT_BLEND_THRESHOLD` (`0.1`) and `BlendPoseOptions.threshold`. Per-joint accumulated override weight below the threshold blends back toward the skeleton rest pose, matching Ozz's bind/rest fallback intent and preventing tiny-weight layers from fully owning a joint during fades or partial masks.
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
7. Optionally collect root-motion carrier interval deltas from runtime override layers; this does not apply or strip those deltas from the local/model pose.
8. Optionally run `RootMotionReconciler` with explicit authority, carrier, space, collision, and ownership-token declarations; this returns accepted/residual world motion and still does not mutate controller/model state.
9. Optionally run `CharacterInteractionCoordinator` after world/coordinator reservations are known. It returns semantic animation ids/events, reach target windows, anchors, and attach/detach handoff records; it never parents props or mutates VRM/Three objects.
10. Let procedural jobs, look-at, foot planting, and IK consume explicit target inputs and return bounded corrections for consumers that opt into procedural skeletal application.
11. Emit skeletal pose data and expression/viseme weights to the consumer.

Runtime evaluation diagnostics are opt-in through `AnimationRuntime.evaluate({ diagnostics: true })`. When enabled, active sampled layer poses and the composed local pose are validated with layer/clip context before the final pose is normalized and converted to model space. The same path surfaces tolerant sampler repairs for malformed translation, scale, rotation, and source-rest quaternion samples, so consumers can log repaired or invalid source data without paying that cost on every frame by default.

Attachment helpers mirror the Ozz attach sample: consumers select a joint from the LocalToModel/model-space matrix array and concatenate a joint-relative offset matrix after that joint model matrix. `createAttachmentBinding` and `createAttachmentBindings` let consumers resolve joint names or humanoid aliases and sanitize offsets once during setup; `computeBoundAttachmentTransform` and `computeBoundAttachmentTransforms` then evaluate attachments directly from model-space pose matrices without per-frame name lookup or offset recomposition.

Ozz's C++ implementation and SIMD memory layout are not copied. Runtime animation keyframes are shipped as versioned binary payloads and decoded into typed arrays before sampling. JSON remains metadata-only for manifests, curation, includes, behavior hints, and validation policy.

## Waifu Integration Contract

A consuming Waifu app checkout, such as `<waifu-app-repo>`, owns app-specific behavior:

- VRM loading and Three.js scene setup.
- WebGL rendering, UI controls, debug panels, and screenshots/video capture.
- Websocket, server behavior events, Chatterbox speech, and local audio playback.
- Paid asset curation and project-specific behavior scoring.

Waifu consumes this package for reusable concerns:

- deterministic math and seeded randomness;
- manifest include loading, root-motion policy/provenance reporting, and clip asset inspection;
- decoding `.waifuanim.bin` payloads and converting decoded clips to Three tracks;
- retargeting quaternion tracks from source rest pose to active VRM rest pose;
- constructing base, overlay, and debug runtime clip lanes for authored clips played through Three `AnimationMixer`;
- reading sanitized Three runtime clip snapshots and base/overlay/debug influence diagnostics for app debug panels and procedural inputs;
- zeroing and limiting viseme stacks;
- smoothing mouth/viseme targets and composing blink, speech, mood, emotion, and thinking expression weights through `FacialExpressionMixer`;
- deterministic presence scheduling, gaze target planning, non-skeletal look-at cues, and reusable bounded procedural target planning through `PresencePlanner`;
- foot-plant planning data plus optional Three.js pelvis/leg/ankle correction application hooks as reusable library surfaces;
- optional root-motion carrier selection and authority/collision reconciliation reports with ownership-token guardrails;
- deterministic interaction/equipment state-machine outputs for sockets/resources/anchors/reach/attachment handoff;
- declarative root/body/finger track policies.

Root-motion policy is not treated as conversion provenance. `source.rootMotion.policy: "stripped-to-in-place"` still drives runtime root-carrier stripping where applicable, while optional `source.rootMotion.provenance` and asset-report carrier counts let consumers tell whether the current binary was already stripped during conversion or still contains carrier tracks that require runtime stripping. Older manifests without provenance remain valid and report unknown provenance.

Current Waifu runtime policy consumes authored skeletal animation through Three `AnimationMixer` plus non-skeletal look-at/face/viseme cues. Future migrations can move final pose application from Three `AnimationMixer` onto the package's local-pose runtime or opt into the package's reusable IK/look-at/foot-plant/procedural skeletal hooks. If Waifu applies root motion to a controller, physics body, or model root, it must ensure the same carrier motion is stripped/baked out of the skeleton path or choose diagnostic-only reconciliation to avoid double displacement. If Waifu consumes interaction outputs, it must also map opaque resource/socket ids to concrete world objects and apply attach/detach/use/sit effects exactly once at its chosen scene/physics ownership site.
