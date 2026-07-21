import type { RuntimeUpdateResult, Transform, Vec3, WorldCoordinatorActorRequest } from "./test-api.js";
import {
  CharacterController,
  CharacterWorldCoordinator,
  ROOT_MOTION_COORDINATE_SYSTEM,
  RootMotionReconciler,
  assert,
  createFlatGroundCharacterWorld,
  createRootMotionActorStateFromControllerSnapshot,
  quatFromAxisAngle,
  resolveRootMotionCarrier
} from "./test-api.js";
import { vectorNearlyEqual } from "./test-helpers.js";

export function runRootMotionAuthorityTests(): void {
  runAuthorityModeTests();
  runCarrierResolutionTests();
  runCollisionReconciliationTests();
  runAdapterFailureTests();
  runBoundedInvalidInputTests();
  runOwnershipAndSnapshotTests();
  runSnapshotReplayTests();
  runWorldCoordinatorRootMotionIntegrationTests();
}

function runAuthorityModeTests(): void {
  const controller = new CharacterController({ initialYaw: Math.PI / 2 }, createFlatGroundCharacterWorld());
  const actor = createRootMotionActorStateFromControllerSnapshot(controller.snapshot(), { actorId: "mode-actor" });
  assert.deepEqual(ROOT_MOTION_COORDINATE_SYSTEM.forward, [0, 0, 1]);

  const animationDelta = makeDelta([0, 0, 2], Math.PI / 2);
  const physicsDisplacement: Vec3 = [0, 0, 4];
  const reconciler = new RootMotionReconciler();

  const physics = reconciler.reconcile({
    actor,
    animationDelta,
    physicsDisplacement,
    physicsYawDelta: -Math.PI / 2,
    policy: { mode: "physics-driven" },
    ownership: { token: "mode-physics" }
  });
  assert.ok(vectorNearlyEqual(physics.animation.worldDisplacement, [2, 0, 0], 1e-9));
  assert.ok(vectorNearlyEqual(physics.requested.displacement, [0, 0, 4], 1e-9));
  assert.ok(nearlyEqual(physics.requested.yawDelta, -Math.PI / 2, 1e-9));

  const animation = reconciler.reconcile({
    actor,
    animationDelta,
    physicsDisplacement,
    physicsYawDelta: -Math.PI / 2,
    policy: { mode: "animation-driven" },
    ownership: { token: "mode-animation" }
  });
  assert.ok(vectorNearlyEqual(animation.requested.displacement, [2, 0, 0], 1e-9));
  assert.ok(nearlyEqual(animation.requested.yawDelta, Math.PI / 2, 1e-9));

  const hybrid = reconciler.reconcile({
    actor,
    animationDelta,
    physicsDisplacement,
    physicsYawDelta: -Math.PI / 2,
    policy: { mode: "hybrid", animationTranslationWeight: 0.25, animationYawWeight: 0.25 },
    ownership: { token: "mode-hybrid" }
  });
  assert.ok(vectorNearlyEqual(hybrid.requested.displacement, [0.5, 0, 3], 1e-9));
  assert.ok(nearlyEqual(hybrid.requested.yawDelta, -Math.PI / 4, 1e-9));
}

function runCarrierResolutionTests(): void {
  const runtime = makeRuntimeReport();
  const defaultSelection = resolveRootMotionCarrier(runtime, undefined);
  assert.equal(defaultSelection.select, "runtime-blend");
  assert.ok(vectorNearlyEqual(defaultSelection.delta.translation, [9, 0, 0], 1e-9));

  const none = resolveRootMotionCarrier(runtime, undefined, {
    carrierBindings: [{ id: "in-place", select: "none", priority: 10 }]
  });
  assert.equal(none.select, "none");
  assert.equal(none.bindingId, "in-place");
  assert.ok(vectorNearlyEqual(none.delta.translation, [0, 0, 0], 1e-9));

  const clipTie = resolveRootMotionCarrier(runtime, undefined, {
    carrierBindings: [{ select: "clip", clipId: "walk" }]
  });
  assert.equal(clipTie.layer?.id, "a", "equal clip candidates should tie-break by runtime layer id");
  assert.ok(vectorNearlyEqual(clipTie.delta.translation, [0, 0, 2], 1e-9));

  const bindingPriority = resolveRootMotionCarrier(runtime, undefined, {
    carrierBindings: [
      { select: "clip", clipId: "walk", priority: 0 },
      { select: "layer", layerId: "high", priority: 2 }
    ]
  });
  assert.equal(bindingPriority.layer?.id, "high", "binding priority should win before layer priority/weight");

  const bone = resolveRootMotionCarrier(runtime, undefined, {
    carrierBindings: [{ select: "bone", jointIndex: 1 }]
  });
  assert.equal(bone.layer?.clipId, "turn");
  assert.ok(vectorNearlyEqual(bone.delta.translation, [0, 0, 3], 1e-9));
}

function runCollisionReconciliationTests(): void {
  const reconciler = new RootMotionReconciler();
  const actor = { actorId: "collision", position: [0, 0, 0] as Vec3, yaw: 0 };
  const partial = reconciler.reconcile({
    actor,
    animationDelta: makeDelta([0, 0, 5], Math.PI / 2),
    policy: { mode: "animation-driven", animationDeltaSpace: "world" },
    ownership: { token: "collision-frame" },
    world: {
      resolveRootMotion(query) {
        assert.ok(vectorNearlyEqual(query.requestedDisplacement, [0, 0, 5], 1e-9));
        return { displacement: [0, 0, 2], yawDelta: Math.PI / 4 };
      }
    }
  });

  assert.ok(vectorNearlyEqual(partial.requested.displacement, [0, 0, 5], 1e-9));
  assert.ok(vectorNearlyEqual(partial.consumed.displacement, [0, 0, 2], 1e-9));
  assert.ok(vectorNearlyEqual(partial.residual.displacement, [0, 0, 3], 1e-9));
  assert.ok(nearlyEqual(partial.consumed.yawDelta, Math.PI / 4, 1e-9));
  assert.ok(nearlyEqual(partial.residual.yawDelta, Math.PI / 4, 1e-9));
  assert.ok(vectorNearlyEqual(partial.applied.position, [0, 0, 2], 1e-9));
}

function runAdapterFailureTests(): void {
  const actor = { actorId: "bad-adapter", position: [0, 0, 0] as Vec3, yaw: 0 };
  const invalid = new RootMotionReconciler().reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: { token: "invalid-adapter" },
    world: { resolveRootMotion: () => ({ displacement: [Number.NaN, 0, 0] as Vec3 }) }
  });
  assert.ok(invalid.issues.some((issue) => issue.type === "adapter-failed"));
  assert.ok(vectorNearlyEqual(invalid.consumed.displacement, [0, 0, 0], 1e-9));
  assert.ok(vectorNearlyEqual(invalid.residual.displacement, [1, 0, 0], 1e-9));

  const thrown = new RootMotionReconciler().reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: { token: "throwing-adapter" },
    world: {
      resolveRootMotion() {
        throw new Error("adapter exploded");
      }
    }
  });
  assert.ok(thrown.issues.some((issue) => issue.type === "adapter-failed" && issue.code === "throw"));
  assert.ok(vectorNearlyEqual(thrown.consumed.displacement, [0, 0, 0], 1e-9));
}

function runBoundedInvalidInputTests(): void {
  const actor = { actorId: "bounded", position: [0, 0, 0] as Vec3, yaw: 0 };
  const bounded = new RootMotionReconciler({ maxRequestedTranslation: 1, maxRequestedYawRadians: 0.5 }).reconcile({
    actor,
    animationDelta: makeDelta([10, 0, 0], Math.PI),
    ownership: { token: "bounded-frame" }
  });
  assert.ok(nearlyEqual(Math.hypot(...bounded.requested.displacement), 1, 1e-9));
  assert.ok(nearlyEqual(Math.abs(bounded.requested.yawDelta), 0.5, 1e-9));
  assert.ok(bounded.issues.some((issue) => issue.type === "bounded"));

  const invalid = new RootMotionReconciler().reconcile({
    actor,
    animationDelta: { translation: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ownership: { token: "invalid-input" }
  });
  assert.ok(invalid.issues.some((issue) => issue.type === "input-rejected"));
  assert.ok(vectorNearlyEqual(invalid.requested.displacement, [0, 0, 0], 1e-9));
}

function runOwnershipAndSnapshotTests(): void {
  const reconciler = new RootMotionReconciler();
  const actor = { actorId: "owner", position: [0, 0, 0] as Vec3, yaw: 0 };
  const first = reconciler.reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: { token: "frame-1" }
  });
  assert.ok(vectorNearlyEqual(first.consumed.displacement, [1, 0, 0], 1e-9));

  const snapshot = reconciler.snapshot();
  const duplicate = reconciler.reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: { token: "frame-1" }
  });
  assert.equal(duplicate.ownership.duplicateToken, true);
  assert.ok(duplicate.issues.some((issue) => issue.type === "duplicate"));
  assert.ok(vectorNearlyEqual(duplicate.consumed.displacement, [0, 0, 0], 1e-9));

  const restored = new RootMotionReconciler();
  restored.restore(snapshot);
  const restoredDuplicate = restored.reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: { token: "frame-1" }
  });
  assert.equal(restoredDuplicate.ownership.duplicateToken, true, "token history should survive snapshot/restore");

  const doubleApplyRisk = new RootMotionReconciler().reconcile({
    actor,
    animationDelta: makeDelta([1, 0, 0]),
    ownership: {
      token: "pose-risk",
      translationOwner: "model-root",
      skeletonPoseContainsRootMotion: true,
      doubleApplyPolicy: "reject"
    }
  });
  assert.ok(doubleApplyRisk.issues.some((issue) => issue.type === "ownership"));
  assert.ok(vectorNearlyEqual(doubleApplyRisk.requested.displacement, [0, 0, 0], 1e-9));
}

function runSnapshotReplayTests(): void {
  const actor = { actorId: "replay", position: [0, 0, 0] as Vec3, yaw: 0 };
  const adapter = {
    resolveRootMotion(query: { requestedDisplacement: Vec3; requestedYawDelta: number }) {
      return {
        displacement: [query.requestedDisplacement[0] * 0.5, 0, query.requestedDisplacement[2] * 0.5] as Vec3,
        yawDelta: query.requestedYawDelta * 0.5
      };
    }
  };
  const original = new RootMotionReconciler();
  original.reconcile({ actor, animationDelta: makeDelta([1, 0, 0]), ownership: { token: "seed" } });
  const snapshot = original.snapshot();
  const restored = new RootMotionReconciler();
  restored.restore(snapshot);

  const makeInputs = (prefix: string) => [
    { token: `${prefix}-1`, delta: makeDelta([2, 0, 0], Math.PI / 4) },
    { token: `${prefix}-2`, delta: makeDelta([0, 0, 4], -Math.PI / 2) }
  ];
  const originalSummary = makeInputs("replay").map((input) =>
    summarizeRootMotionResult(
      original.reconcile({ actor, animationDelta: input.delta, ownership: { token: input.token }, world: adapter })
    )
  );
  const restoredSummary = makeInputs("replay").map((input) =>
    summarizeRootMotionResult(
      restored.reconcile({ actor, animationDelta: input.delta, ownership: { token: input.token }, world: adapter })
    )
  );
  assert.deepEqual(restoredSummary, originalSummary, "root motion replay after restore should be deterministic");
}

function runWorldCoordinatorRootMotionIntegrationTests(): void {
  const makeCoordinator = (): CharacterWorldCoordinator =>
    new CharacterWorldCoordinator(
      [
        { id: "b", controller: makeController([1, 0, 0]), rootMotionReconciler: new RootMotionReconciler(), seed: "b" },
        { id: "a", controller: makeController([0, 0, 0]), rootMotionReconciler: new RootMotionReconciler(), seed: "a" }
      ],
      { seed: "root-motion" }
    );
  const makeRequests = (step: number): WorldCoordinatorActorRequest[] => [
    {
      id: "b",
      rootMotion: {
        animationDelta: makeDelta([0, 0, 1 + step]),
        useControllerDelta: false,
        policy: { mode: "animation-driven", animationDeltaSpace: "world" },
        ownership: { token: `b-${step}` }
      }
    },
    {
      id: "a",
      rootMotion: {
        animationDelta: makeDelta([1 + step, 0, 0]),
        useControllerDelta: false,
        policy: { mode: "animation-driven", animationDeltaSpace: "world" },
        ownership: { token: `a-${step}` }
      }
    }
  ];
  const first = makeCoordinator();
  const second = makeCoordinator();
  const firstSummary: CoordinatorRootMotionSummary[] = [];
  const secondSummary: CoordinatorRootMotionSummary[] = [];
  for (let step = 0; step < 4; step += 1) {
    firstSummary.push(summarizeCoordinatorRootMotion(first.update(0.05, makeRequests(step))));
    secondSummary.push(summarizeCoordinatorRootMotion(second.update(0.05, makeRequests(step))));
  }
  assert.deepEqual(
    secondSummary,
    firstSummary,
    "coordinator root-motion reports should be deterministic by actor order"
  );
  assert.deepEqual(firstSummary[0]?.order, ["a", "b"], "coordinator should preserve stable actor ordering");
}

function makeRuntimeReport(): RuntimeUpdateResult {
  return {
    rootMotionDelta: makeDelta([9, 0, 0]),
    rootMotionLayers: [
      makeLayer("b", "walk", 1, 0.5, [0, 0, 1], 0, "root"),
      makeLayer("a", "walk", 1, 0.5, [0, 0, 2], 0, "root"),
      makeLayer("high", "turn", 2, 0.1, [0, 0, 3], 1, "hips")
    ]
  };
}

function makeLayer(
  id: string,
  clipId: string,
  priority: number,
  weight: number,
  translation: Vec3,
  jointIndex: number,
  joint: string
): RuntimeUpdateResult["rootMotionLayers"][number] {
  return {
    id,
    clipId,
    priority,
    weight,
    normalizedWeight: weight,
    fromTime: 0,
    toTime: 0.1,
    carrier: { jointIndex, joint },
    delta: makeDelta(translation)
  };
}

function makeDelta(translation: Vec3, yaw = 0): Transform {
  return { translation, rotation: quatFromAxisAngle([0, 1, 0], yaw), scale: [1, 1, 1] };
}

function makeController(initialPosition: Vec3): CharacterController {
  return new CharacterController({ fixedStepSeconds: 0.05, initialPosition }, createFlatGroundCharacterWorld());
}

function summarizeRootMotionResult(result: ReturnType<RootMotionReconciler["reconcile"]>): unknown {
  return {
    sequence: result.sequence,
    requested: roundMotion(result.requested),
    consumed: roundMotion(result.consumed),
    residual: roundMotion(result.residual),
    issueCodes: result.issues.map((issue) => issue.code)
  };
}

type CoordinatorRootMotionSummary = {
  tick: number;
  order: string[];
  actors: Array<{
    id: string;
    rootSequence: number | undefined;
    consumed: { displacement: Vec3; yawDelta: number } | null;
    issues: string[];
  }>;
};

function summarizeCoordinatorRootMotion(
  result: ReturnType<CharacterWorldCoordinator["update"]>
): CoordinatorRootMotionSummary {
  return {
    tick: result.tick,
    order: result.actorOrder,
    actors: result.actors.map((actor) => ({
      id: actor.id,
      rootSequence: actor.rootMotion?.sequence,
      consumed: actor.rootMotion ? roundMotion(actor.rootMotion.consumed) : null,
      issues: actor.rootMotion?.issues.map((issue) => issue.code) ?? []
    }))
  };
}

function roundMotion(value: { displacement: Vec3; yawDelta: number }): { displacement: Vec3; yawDelta: number } {
  return { displacement: roundVec3(value.displacement), yawDelta: round(value.yawDelta) };
}

function roundVec3(value: Vec3): Vec3 {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}
