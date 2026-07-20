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
- controller config/input/snapshot/world-adapter/event/animation-state types
- item/socket/interaction/actor identifier aliases for future interaction/equipment contracts
- `CHARACTER_CONTROLLER_COORDINATE_SYSTEM` and `CHARACTER_CONTROLLER_SCHEMA_VERSION`

The foundation supports:

- validated finite configuration, including capsule height/radius/step/probe consistency and a hard `maxSubSteps` safety ceiling;
- deterministic fixed-step update with bounded catch-up (`fixedStepSeconds`, `maxSubSteps`). `cappedDeltaSeconds` is the capped accumulator budget for this call; catch-up time beyond `maxSubSteps` is discarded and reported with `catch-up-capped`;
- movement intent with planar direction, magnitude, facing policy, and gait/speed request;
- explicit standing/crouching posture state plus entering/exiting crouch transition progress;
- grounded/rising/falling/landing locomotion phases;
- controller-owned velocity, acceleration/deceleration, gravity, yaw turning, jump buffering, and coyote timing;
- edge-triggered jump/action command identity so future pickup/equip/sit/use commands do not repeat every frame;
- world adapter boundaries for ground queries, capsule sweeps, high-level resolution, slopes, steps, and platform velocity;
- deterministic events/transitions ordered as input-edge events before fixed-step locomotion/posture events;
- executable flat-ground test adapter for replay and integration tests;
- snapshot/restore for deterministic save/load/replay.

Input-edge events are sanitized before fixed substeps. Action, jump-buffer, and posture-transition-start events can therefore appear on an update that runs zero substeps; movement, facing, jump start, landing, and posture progress only advance on completed fixed substeps. `jumpBufferSeconds: 0` disables timer persistence, not the immediate grounded/coyote jump on the next fixed substep; the transient pending jump edge is included in snapshots until that substep runs.

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

## World adapter contract

Adapters can implement one or more methods:

- `queryGround(query)` returns finite Y-up support data, slope, surface id, and platform velocity. A valid post-move `queryGround` result is authoritative when present.
- `sweepCapsule(query)` returns a finite swept capsule hit, travel fraction, optional support `ground`, or a walkable hit `normal` from which the core can derive support when `queryGround` is absent.
- `resolveMovement(query)` returns a final finite position and optional velocity/ground hit. A valid movement-resolved ground is preserved when no valid post-move ground query overrides it.

Adapter exceptions or non-finite adapter data produce `world-adapter-failed` events and the core falls back to deterministic integration where possible. Explicit optional adapter fields are validated when present: `point`, `normal`, `distance`, `slopeAngleRadians`, `platformVelocity`, `surfaceId`, sweep `position`, and sweep `travelFraction` must be finite/in-range/non-empty as applicable. Invalid optional data is rejected rather than silently replacing it with a default.

Returned `surfaceId` values must be non-empty strings. Resolved controller config/gaits and `CHARACTER_CONTROLLER_COORDINATE_SYSTEM` constants are frozen at runtime so callers cannot mutate public constants/config and change deterministic behavior after construction.

## Current non-goals / roadmap

Not implemented in this slice:

- full traversal: stairs/steps, slope slide, wall sliding, ledge vaulting, moving-platform transform parenting, crouch clearance, root-motion authority policies;
- action execution: pickup/carry/drop/use/equip/unequip/sit/stand state machines, hand sockets, reach reservations, multi-actor coordination;
- IK/reach solving integration: the controller only defines item/socket/interaction identifiers and future coordination boundaries;
- animation graph selection: output events/parameters are clip-agnostic; consumers or later library slices map them to clip blends;
- Waifu app integration: `/Warehouse/Waifu` will later own Three/VRM loading, browser input, scene/world/game behavior, physics-engine adapters, and visual gates.

Recommended next slice: implement a reusable animation-graph/request layer that consumes `CharacterAnimationState` and maps gait/posture/locomotion events into clip-agnostic transition requests, still without choosing app-specific clip names.
