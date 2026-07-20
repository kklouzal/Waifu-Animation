# Character Controller Foundation

`src/character-controller.ts` adds the first engine-agnostic Character Controller foundation for Waifu-Animation. It is deliberately a deterministic controller core, not a renderer, physics-engine, input, game-world, or VRM-loading system.

## Coordinate and ownership conventions

- World space is Y-up, +Z-forward, +X-right.
- `yaw = 0` faces +Z; positive yaw turns toward +X around +Y.
- `position` is the capsule bottom / feet-center reference point, not the geometric capsule center. Adapter queries receive the same convention with `radius` and total `height`; consumers that need a capsule center derive it from their own physics convention.
- Ground snap is vertical-only: when support is accepted and vertical velocity is not rising, the core sets `position.y` to the accepted ground point Y and keeps the integrated X/Z position. `CharacterGroundHit.distance` is the vertical gap from capsule bottom/feet center to that support point.
- Movement intent is world-planar XZ. Y in input direction vectors is ignored after finite validation.
- The controller owns sanitized intent, fixed-step timing, velocity, position, yaw, posture/locomotion phases, edge-triggered commands, and deterministic snapshots.
- A consumer-owned world adapter owns collision/physics details. It may provide ground probes, capsule sweeps, or a higher-level movement resolver. The core never imports a physics engine.
- Animation output is parameter/event data only. Core does not choose clip names, mutate bones, or apply direct skeleton transforms; gait `animationSpeed` is only a clip-agnostic playback-rate hint surfaced on `CharacterAnimationState`.

## Implemented in this foundation slice

Public API exported from `src/index.ts`:

- `CharacterController`
- `resolveCharacterControllerConfig`
- `createFlatGroundCharacterWorld`
- `CharacterAnimationGraph`
- `resolveCharacterAnimationGraphConfig`
- `createCharacterAnimationGraphOutputBuffer`
- `CharacterAnimationBindingRegistry`
- `createCharacterAnimationBindingRegistry`
- `resolveCharacterAnimationBindings`
- `createCharacterAnimationBindingOutputBuffer`
- `CharacterAnimationRuntimeApplier`
- `createCharacterAnimationRuntimeApplier`
- `resolveCharacterAnimationRuntimeApplierConfig`
- `createCharacterAnimationRuntimeApplyResultBuffer`
- controller config/input/snapshot/world-adapter/event/animation-state types
- animation graph config/snapshot/request/output/issue types
- animation binding registry/config/resolved-output/issue types
- runtime applier config/snapshot/apply-result/issue types
- item/socket/interaction/actor identifier aliases for future interaction/equipment contracts
- `CHARACTER_CONTROLLER_COORDINATE_SYSTEM` and `CHARACTER_CONTROLLER_SCHEMA_VERSION`

The foundation supports:

- validated finite configuration, including capsule height/radius/step/probe consistency and a hard `maxSubSteps` safety ceiling;
- deterministic fixed-step update with bounded catch-up (`fixedStepSeconds`, `maxSubSteps`). `cappedDeltaSeconds` is the capped accumulator budget for this call; catch-up time beyond `maxSubSteps` is discarded and reported with `catch-up-capped`;
- movement intent with planar direction, magnitude, facing policy, and gait/speed request;
- explicit standing/crouching posture state plus entering/exiting crouch transition progress and adapter-gated standing clearance when `checkCapsuleClearance` is supplied;
- grounded/rising/falling/landing locomotion phases;
- controller-owned velocity, acceleration/deceleration, gravity, yaw turning, jump buffering, and coyote timing;
- edge-triggered jump/action command identity so future pickup/equip/sit/use commands do not repeat every frame;
- world adapter boundaries for ground queries, capsule sweeps, high-level resolution, explicit step-up/step-down negotiation, wall-plane contacts, steep-slope slide planning, standing clearance, and moving-platform velocity carry;
- deterministic events/transitions ordered as input-edge events before fixed-step locomotion/posture events;
- executable flat-ground test adapter for replay and integration tests;
- snapshot/restore for deterministic save/load/replay, including schema-versioned blocked-stand state.

Input-edge events are sanitized before fixed substeps. Action, jump-buffer, and crouch-enter `posture-transition-start` events can therefore appear on an update that runs zero substeps; standing/exit `posture-transition-start` waits for the first fixed substep with valid capsule clearance. A zero-substep standing request from crouch is snapshotted as a pending crouched state (`crouchTarget: "standing"`, `standBlocked: false`) until clearance runs. Movement, facing, jump start, landing, and posture progress only advance on completed fixed substeps. `jumpBufferSeconds: 0` disables timer persistence, not the immediate grounded/coyote jump on the next fixed substep; the transient pending jump edge is included in snapshots until that substep runs.

## Minimal usage

```ts
import { CharacterController, createFlatGroundCharacterWorld } from "waifu-animation";

const world = createFlatGroundCharacterWorld({ y: 0, surfaceId: "floor" });
const controller = new CharacterController({ fixedStepSeconds: 1 / 60, maxSubSteps: 8 }, world);

const result = controller.update(1 / 60, {
  movement: {
    planarDirection: [0, 0, 1],
    magnitude: 1,
    gait: "walk",
    facing: { policy: "movement" }
  }
});

// Feed these into an animation graph/runtime adapter; do not treat them as clip names.
console.log(result.animation.planarSpeed, result.animation.locomotionPhase, result.animation.crouchAlpha);

const saved = controller.snapshot();
controller.restore(saved);
```

## Animation graph request layer

`src/character-animation-graph.ts` is the reusable clip-agnostic layer above `CharacterAnimationState`. It does not sample clips, name app assets, import Three/browser/VRM APIs, mutate bones, or decide masks. It emits semantic requests that an app or runtime adapter can map to authored clips later.

Key surfaces:

- `CharacterAnimationGraph` with deterministic `update()`, `snapshot()`, and `restore()`.
- `CharacterAnimationGraphConfig` / `resolveCharacterAnimationGraphConfig` for frozen, finite, bounded request ids, thresholds, fade hints, playback-speed clamps, and scan limits.
- `CharacterAnimationGraphOutput` with bounded `transitions`, `blends`, `playback`, `actions`, and `issues` arrays. Callers that care about hot-path allocation can pass `createCharacterAnimationGraphOutputBuffer()` as `update(animation, { output })`; the arrays are cleared and reused.
- `CharacterAnimationTransitionRequest`, `CharacterAnimationBlendRequest`, `CharacterAnimationPlaybackRequest`, and `CharacterAnimationActionRequest` for app/runtime adapters.

Default semantic request ids are:

- `locomotion:idle`
- `locomotion:gait:<controller gaitId>`
- `posture:standing` and `posture:crouching`
- `airborne:rise`, `airborne:fall`, and `airborne:landing`
- `action:<controller action kind>`

These ids are intentionally not clip names. The ids/prefixes are configurable for projects that want a different semantic namespace.

## Semantic binding registry

`src/character-animation-binding.ts` is the reusable adapter between graph semantics and caller-owned clip/runtime policy. It still does not import Three/browser/VRM APIs, sample clips, mutate runtime layers, or choose Waifu-specific assets.

Key surfaces:

- `CharacterAnimationBindingRegistry` / `createCharacterAnimationBindingRegistry(config)` validates and freezes `clips[]` plus `bindings[]`.
- `resolveCharacterAnimationBindings(registry, graphOutput)` and `registry.resolve(graphOutput)` convert graph playback/blend/transition/action arrays into configured clip ids and runtime metadata.
- `createCharacterAnimationBindingOutputBuffer()` supports caller-owned output reuse; arrays are cleared and reused.

Bindings map a semantic `requestId` to an opaque `clipId`, expected graph `layer`, and optional runtime policy:

- `laneId` and `layerId` for caller-owned runtime lanes/layers;
- `maskId` as an opaque mask/policy key (for `JointMask`, track policy, or renderer-specific masks owned by the consumer);
- `blendMode`, `priority`, `fadeSeconds`, `loop`, `playbackSpeedScale`, playback-speed clamps, and `weightScale`.

The resolver is truthful about missing or incompatible config: unbound request ids, layer mismatches, duplicate bindings, invalid clip ids, unknown clip references, malformed graph records, non-finite values, and bounded scans are reported in `issues`. It does not silently substitute an idle/walk clip for an unbound gait or action.

```ts
import {
  CharacterAnimationGraph,
  createCharacterAnimationBindingRegistry,
  createFlatGroundCharacterWorld,
  CharacterController
} from "waifu-animation";

const registry = createCharacterAnimationBindingRegistry({
  clips: [
    { id: "clip-idle", loop: true },
    { id: "clip-walk", loop: true },
    { id: "clip-pickup", loop: false }
  ],
  bindings: [
    { requestId: "locomotion:idle", clipId: "clip-idle", layer: "locomotion", runtime: { laneId: "base" } },
    { requestId: "locomotion:gait:walk", clipId: "clip-walk", layer: "locomotion", runtime: { laneId: "base" } },
    {
      requestId: "action:pickup",
      clipId: "clip-pickup",
      layer: "action",
      runtime: { laneId: "overlay", maskId: "upper-body", blendMode: "additive" }
    }
  ]
});

const controller = new CharacterController({}, createFlatGroundCharacterWorld());
const graph = new CharacterAnimationGraph();
const controllerResult = controller.update(1 / 60, { movement: { planarDirection: [0, 0, 1], magnitude: 1 } });
const graphOutput = graph.update(controllerResult.animation, { deltaSeconds: 1 / 60 });
const resolved = registry.resolve(graphOutput);

console.log(resolved.playback, resolved.actions, resolved.issues);
```

## Runtime application helper

`src/character-animation-runtime-applier.ts` is the reusable bridge from resolved character animation bindings into `AnimationRuntime`. It still stays renderer-agnostic: no Three, browser, VRM, app clip-name conventions, action/equipment state machines, or root-motion authority policy.

Key surfaces:

- `CharacterAnimationRuntimeApplier` / `createCharacterAnimationRuntimeApplier(config)` for stateful owned-layer application.
- `applier.apply(runtime, bindingOutput, { clips, masks }, { deltaSeconds, output })` where `clips` and `masks` are caller-owned maps/records/resolvers for `AnimationClip` and `JointMask` data.
- `createCharacterAnimationRuntimeApplyResultBuffer()` for caller-owned result reuse.
- `snapshot()` / `restore(snapshot)` for deterministic replay of applier ownership/action identity state; callers still own the matching `AnimationRuntime` state.

Runtime semantics:

- Final runtime layer ids are namespaced as `namespace:laneId:layerId` (actions append a stable action identity suffix), so stale cleanup only touches layers the applier previously owned.
- Graph blends are collapsed with matching playback metadata into one runtime command per owned layer; playback records covered by blend endpoints are not double-applied.
- `fadeSeconds`, target weights, priorities, blend modes, loop flags, playback speed, phase-derived local time, and masks are passed into the existing runtime `crossfade`/`fadeOut`/`removeLayer` APIs. `crossfade` is called with runtime-wide auto-fade disabled so unrelated layers at the same priority are not touched.
- Missing clips/masks, malformed resolved records, layer-id conflicts, duplicate action command identities, and bounded input/issue limits are reported in the apply result. The applier never substitutes arbitrary clips or masks.
- `deltaSeconds` is only used for bounded applier-owned one-shot action retirement timers. The runtime remains responsible for layer time advancement, sampling, blending, `update()`, and `evaluate()`.
- Root-motion authority remains unresolved here: the applier does not select `MotionCarrier`s, collect runtime root-motion deltas, or apply world displacement.

Transition precedence is explicit and stable:

1. Controller `action-command` events are forwarded as action requests with the highest priority, but they do not replace locomotion/posture output.
2. Airborne requests (`rise`, `fall`, `landing`) are the `primaryRequestId` while active and outrank grounded locomotion.
3. Posture/crouch emits an independent standing/crouching blend by `crouchAlpha`.
4. Grounded locomotion emits idle/gait blend and gait playback requests.

The graph adds start/stop hysteresis for grounded locomotion, a minimum-rise debounce before switching rise to fall, and an optional landing hold window for deterministic handoff after controller landing. Bad or non-finite runtime inputs produce `issues` and safe fallback values instead of poisoning request output. Event/transition scans and action forwarding are bounded by config.

```ts
import { CharacterAnimationGraph, CharacterController, createFlatGroundCharacterWorld } from "waifu-animation";

const controller = new CharacterController({}, createFlatGroundCharacterWorld());
const graph = new CharacterAnimationGraph();

const controllerResult = controller.update(1 / 60, {
  movement: { planarDirection: [0, 0, 1], magnitude: 1, gait: "walk" }
});

const requests = graph.update(controllerResult.animation, { deltaSeconds: 1 / 60 });

// Map semantic request ids to project clips in the app/runtime adapter, not here.
console.log(requests.primaryRequestId, requests.playback, requests.blends);

const savedGraph = graph.snapshot();
graph.restore(savedGraph);
```

## World adapter contract

Adapters can implement one or more methods:

- `queryGround(query)` returns finite Y-up support data, slope, surface id, and platform velocity. A valid post-move walkable `queryGround` result is authoritative when present.
- `resolveStepUp(query)` and `resolveStepDown(query)` are explicit traversal contracts for stairs/curbs. Accepted step-up positions are rejected if they rise above `stepHeight`; accepted step-down positions are rejected if they drop below `stepHeight + groundProbeDistance`. Accepted steps must return walkable support. Rejected steps can return an adapter-resolved blocked position/velocity and emit deterministic `step-rejected` events.
- `sweepCapsule(query)` is the low-level sweep path. It returns a finite swept capsule impact `position` and/or `travelFraction`, optional separate support `ground`, or a hit `normal` from which the core can derive support when `queryGround` is absent. For an explicit wall hit, the sweep position/fraction is treated as impact data and the core may project remaining displacement along the wall plane.
- `resolveMovement(query)` is the high-level resolver path. Its finite `position` is final and authoritative for the fixed step; if it also reports a wall `hit`, the core projects velocity onto the wall plane without appending additional remaining displacement. A valid movement-resolved ground is preserved when no valid post-move ground query overrides it.
- `resolveSteepSlopeSlide(query)` is called for adapter-reported non-walkable/too-steep support from `queryGround`, movement-resolved ground, or explicit sweep/movement hits with `contactKind: "steep-slope"`. Explicit steep-slope hits require finite `point` and `normal`; missing/invalid contact fields emit `world-adapter-failed` and are not grounded from their normal. The core emits exactly one `steep-slope`, never marks that support grounded, respects valid walkable `queryGround`, and applies the finite adapter slide position/displacement/velocity at most once for the chosen contact.
- `checkCapsuleClearance(query)` gates crouch exit. When this method exists, a blocked/invalid/throwing result keeps the controller crouched with `standBlocked: true` and emits `posture-blocked` once for the blocked episode; `posture-transition-start` for standing is emitted only after a valid clear result. When the method is absent, clearance defaults to clear and standing exit starts on the next fixed substep.

Movement and sweep queries separate `controllerDisplacement`, `platformVelocity`, `platformDisplacement`, and total `displacement`. The core applies moving-platform carry exactly once from the previously accepted support for the fixed step; adapter-returned `velocity` is interpreted as controller/self velocity, not platform carry. Ground `surfaceId` changes while staying grounded emit `surface-changed`.

Wall slides are driven by explicit adapter contacts: a sweep/movement `hit` with `contactKind: "wall"` and a finite `normal` projects velocity onto that plane with no speed gain. Low-level `sweepCapsule` hits may also have remaining displacement projected from the impact point; high-level `resolveMovement.position` remains final. The core does not infer wall geometry without an adapter contact, and an explicit wall normal is not treated as walkable ground unless a separate `ground` result is supplied.

Adapter exceptions or non-finite adapter data produce `world-adapter-failed` events and the core falls back to deterministic integration where possible. Explicit optional adapter fields are validated when present: `point`, `normal`, `distance`, `slopeAngleRadians`, `platformVelocity`, `surfaceId`, sweep `position`, and sweep `travelFraction` must be finite/in-range/non-empty as applicable. Invalid optional data is rejected rather than silently replacing it with a default.

Returned `surfaceId` values must be non-empty strings. Resolved controller config/gaits and `CHARACTER_CONTROLLER_COORDINATE_SYSTEM` constants are frozen at runtime so callers cannot mutate public constants/config and change deterministic behavior after construction.

## Current non-goals / roadmap

Not implemented in this slice:

- ledge vaulting/mantling, moving-platform transform parenting, root-motion authority policies, and physics-engine-specific collision ownership;
- action/equipment execution: the runtime applier can start/fade animation layers for action commands, but pickup/carry/drop/use/equip/unequip/sit/stand state machines, hand sockets, reach reservations, and multi-actor coordination remain consumer-owned;
- IK/reach solving integration: the controller only defines item/socket/interaction identifiers and future coordination boundaries;
- root-motion authority: the runtime can compute root-motion intervals, but this controller/applier slice does not choose carriers, integrate displacement, or decide physics-vs-animation authority;
- Waifu app integration: `/Warehouse/Waifu` will later own Three/VRM loading, browser input, scene/world/game behavior, physics-engine adapters, visual gates, and any app-specific clip/mask lookup tables.

Recommended next slice: wire the exported graph→binding→runtime-applier path into a consumer adapter with real clip/mask tables and visual gates, still keeping root-motion authority and interaction/equipment state machines explicit.
