import type { NavigationPath, PathFollowerOutput, Vec3 } from "./test-api.js";
import {
  CharacterController,
  CharacterPathFollower,
  CharacterWorldCoordinator,
  assert,
  createFlatGroundCharacterWorld,
  resolvePathFollowerConfig,
  resolveWorldCoordinatorConfig
} from "./test-api.js";

export function runNavigationWorldCoordinatorTests(): void {
  runPathToTargetArrivalAndTurnTests();
  runInvalidPathAndAvoidanceHandlingTests();
  runBlockedAndRepathOutcomeTests();
  runCoordinatorConflictOrderingTests();
  runSnapshotReplayEqualityTests();
  runDeterministicActorReplayFixtureTests();
}

function runPathToTargetArrivalAndTurnTests(): void {
  const follower = new CharacterPathFollower({ arrivalRadius: 0.05, slowDownRadius: 0.5, minMoveMagnitude: 0.2 });
  const controller = new CharacterController(
    {
      fixedStepSeconds: 0.05,
      maxSubSteps: 4,
      acceleration: 20,
      deceleration: 20,
      turnSpeedRadians: Math.PI * 8,
      gaits: [{ id: "walk", speed: 1, acceleration: 20, deceleration: 20 }]
    },
    createFlatGroundCharacterWorld()
  );
  const path = makePath("target", [[0, 0, 0.5]], [0, 0, 1], { radius: 0.05, facingYaw: Math.PI / 2 });
  let output = follower.update(path, controller.snapshot(), { deltaSeconds: 0.05 });
  assert.equal(output.status, "following");
  assert.deepEqual(output.input.movement?.planarDirection, [0, 0, 1]);

  for (let index = 0; index < 80 && output.status !== "turning" && output.status !== "arrived"; index += 1) {
    controller.update(0.05, output.input);
    output = follower.update(path, controller.snapshot(), { deltaSeconds: 0.05 });
  }
  assert.ok(
    output.status === "turning" || output.status === "arrived",
    "follower should reach target and begin final facing"
  );
  if (output.status === "turning") {
    assert.equal(output.input.movement?.facing?.policy, "target-yaw");
  }
  for (let index = 0; index < 80 && output.status !== "arrived"; index += 1) {
    controller.update(0.05, output.input);
    output = follower.update(path, controller.snapshot(), { deltaSeconds: 0.05 });
  }
  assert.equal(output.status, "arrived");
  assert.equal(output.arrived, true);
  const stable = follower.update(path, controller.snapshot(), { deltaSeconds: 0.05 });
  assert.equal(stable.status, "arrived", "arrival should be stable inside hysteresis radius");
}

function runInvalidPathAndAvoidanceHandlingTests(): void {
  const follower = new CharacterPathFollower();
  const controller = new CharacterController({}, createFlatGroundCharacterWorld());
  const invalid = follower.update(
    { destination: { position: [Number.NaN, 0, 0] }, waypoints: [] },
    controller.snapshot(),
    { deltaSeconds: 0.1 }
  );
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.needsRepath, true);
  assert.ok(invalid.issues.some((issue) => issue.field === "path.destination.position"));

  const path = makePath("avoid", [], [0, 0, 1]);
  const avoided = follower.update(path, controller.snapshot(), {
    deltaSeconds: 0.1,
    localAvoidance: () => ({ planarDirection: [Number.NaN, 0, 0], speedScale: Number.NaN })
  });
  assert.equal(avoided.status, "following");
  assert.deepEqual(avoided.input.movement?.planarDirection, [0, 0, 1]);
  assert.ok(avoided.issues.some((issue) => issue.type === "adapter-failed"));

  const badController = { ...controller.snapshot(), position: [0, Number.POSITIVE_INFINITY, 0] as Vec3 };
  const rejected = follower.update(path, badController, { deltaSeconds: 0.1 });
  assert.equal(rejected.status, "invalid");
}

function runBlockedAndRepathOutcomeTests(): void {
  const staleFollower = new CharacterPathFollower();
  const controller = new CharacterController({}, createFlatGroundCharacterWorld());
  const stale = staleFollower.update({ ...makePath("stale", [], [0, 0, 2]), status: "stale" }, controller.snapshot(), {
    deltaSeconds: 0.1
  });
  assert.equal(stale.status, "needs-repath");

  const blockedFollower = new CharacterPathFollower({ blockedTimeoutSeconds: 0.2, blockedProgressEpsilon: 0.001 });
  const path = makePath("blocked", [], [0, 0, 2]);
  let output: PathFollowerOutput = blockedFollower.update(path, controller.snapshot(), { deltaSeconds: 0.1 });
  assert.equal(output.status, "following");
  output = blockedFollower.update(path, controller.snapshot(), { deltaSeconds: 0.1 });
  assert.equal(output.status, "following");
  output = blockedFollower.update(path, controller.snapshot(), { deltaSeconds: 0.1 });
  assert.equal(output.status, "blocked");
  assert.equal(output.blocked, true);

  const avoidanceRepath = new CharacterPathFollower().update(path, controller.snapshot(), {
    deltaSeconds: 0.1,
    localAvoidance: () => ({ requestRepath: true })
  });
  assert.equal(avoidanceRepath.status, "needs-repath");
}

function runCoordinatorConflictOrderingTests(): void {
  const alpha = makeController();
  const beta = makeController();
  const coordinator = new CharacterWorldCoordinator(
    [
      { id: "beta", controller: beta, pathFollower: new CharacterPathFollower(), priority: 0 },
      { id: "alpha", controller: alpha, pathFollower: new CharacterPathFollower(), priority: 0 }
    ],
    { seed: "conflicts" }
  );
  assert.deepEqual(coordinator.actorIds(), ["alpha", "beta"], "actor ordering should be stable by id");
  const shared = makePath("shared", [], [0, 0, 1], { reservationKey: "chair-1" });
  const result = coordinator.update(0.1, [
    { id: "beta", path: shared },
    { id: "alpha", path: shared }
  ]);
  const alphaResult = result.actors.find((actor) => actor.id === "alpha")!;
  const betaResult = result.actors.find((actor) => actor.id === "beta")!;
  assert.equal(alphaResult.grantedReservations.length, 1, "lexically first actor should win equal-priority conflict");
  assert.equal(betaResult.deniedReservations.length, 1);
  assert.equal(betaResult.controllerResult.state.position[2], 0, "denied actor should receive hold input");

  const priorityCoordinator = new CharacterWorldCoordinator(
    [
      { id: "alpha", controller: makeController(), pathFollower: new CharacterPathFollower(), priority: 0 },
      { id: "beta", controller: makeController(), pathFollower: new CharacterPathFollower(), priority: 5 }
    ],
    { seed: "conflicts" }
  );
  const priorityResult = priorityCoordinator.update(0.1, [
    { id: "alpha", path: shared },
    { id: "beta", path: shared }
  ]);
  assert.equal(priorityResult.actors.find((actor) => actor.id === "beta")!.grantedReservations.length, 1);
  assert.equal(priorityResult.actors.find((actor) => actor.id === "alpha")!.deniedReservations.length, 1);
}

function runSnapshotReplayEqualityTests(): void {
  const path = makePath("replay", [[0, 0, 0.5]], [0, 0, 1.5]);
  const original = new CharacterWorldCoordinator(
    [
      { id: "a", controller: makeController(), pathFollower: new CharacterPathFollower(), seed: "one" },
      { id: "b", controller: makeController([0.4, 0, 0]), pathFollower: new CharacterPathFollower(), seed: "two" }
    ],
    { seed: "snapshot" }
  );
  const requests = [
    { id: "a", path },
    { id: "b", path: makePath("replay-b", [[0.4, 0, 0.5]], [0.4, 0, 1.5]) }
  ];
  for (let step = 0; step < 6; step += 1) original.update(0.05, requests);
  const snapshot = original.snapshot();
  const restored = new CharacterWorldCoordinator(
    [
      { id: "a", controller: makeController(), pathFollower: new CharacterPathFollower(), seed: "one" },
      { id: "b", controller: makeController([0.4, 0, 0]), pathFollower: new CharacterPathFollower(), seed: "two" }
    ],
    { seed: "snapshot" }
  );
  restored.restore(snapshot);
  const originalOutputs = [];
  const restoredOutputs = [];
  for (let step = 0; step < 8; step += 1) {
    originalOutputs.push(summarizeUpdate(original.update(0.05, requests)));
    restoredOutputs.push(summarizeUpdate(restored.update(0.05, requests)));
  }
  assert.deepEqual(restoredOutputs, originalOutputs, "restored coordinator replay should exactly match original");
}

function runDeterministicActorReplayFixtureTests(): void {
  const actorCount = 20;
  const makeCoordinator = (): CharacterWorldCoordinator => {
    const actors = [];
    for (let index = 0; index < actorCount; index += 1) {
      actors.push({
        id: `actor-${index.toString().padStart(2, "0")}`,
        controller: makeController([index * 0.15, 0, 0]),
        pathFollower: new CharacterPathFollower({ arrivalRadius: 0.04 }),
        seed: index
      });
    }
    return new CharacterWorldCoordinator(actors, { seed: "fixture" });
  };
  const requests = Array.from({ length: actorCount }, (_, index) => ({
    id: `actor-${index.toString().padStart(2, "0")}`,
    path: makePath(`fixture-${index}`, [], [index * 0.15, 0, 1 + (index % 5) * 0.1])
  }));
  const first = makeCoordinator();
  const second = makeCoordinator();
  const firstSummary = [];
  const secondSummary = [];
  for (let step = 0; step < 30; step += 1) {
    firstSummary.push(summarizeUpdate(first.update(0.05, requests)));
    secondSummary.push(summarizeUpdate(second.update(0.05, requests)));
  }
  assert.deepEqual(secondSummary, firstSummary, "20 actor deterministic replay fixture should be stable");
}

function makeController(initialPosition: Vec3 = [0, 0, 0]): CharacterController {
  return new CharacterController(
    {
      fixedStepSeconds: 0.05,
      maxSubSteps: 4,
      initialPosition,
      acceleration: 20,
      deceleration: 20,
      turnSpeedRadians: Math.PI * 8,
      gaits: [{ id: "walk", speed: 1, acceleration: 20, deceleration: 20 }]
    },
    createFlatGroundCharacterWorld()
  );
}

function makePath(
  id: string,
  waypoints: readonly Vec3[],
  destination: Vec3,
  destinationOptions: Partial<NavigationPath["destination"]> = {}
): NavigationPath {
  return {
    id,
    waypoints: waypoints.map((position) => ({ position })),
    destination: { position: destination, ...destinationOptions }
  };
}

function summarizeUpdate(result: ReturnType<CharacterWorldCoordinator["update"]>): unknown {
  return {
    tick: result.tick,
    order: result.actorOrder,
    actors: result.actors.map((actor) => ({
      id: actor.id,
      randomState: actor.randomState,
      pathStatus: actor.pathOutput?.status,
      position: roundVec3(actor.controllerResult.state.position),
      velocity: roundVec3(actor.controllerResult.state.velocity),
      yaw: round(actor.controllerResult.state.yaw),
      grants: actor.grantedReservations.map((grant) => [grant.key, grant.kind, grant.holderId]),
      denials: actor.deniedReservations.map((grant) => [grant.key, grant.kind, grant.holderId])
    }))
  };
}

function roundVec3(value: Vec3): Vec3 {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const followerConfig = resolvePathFollowerConfig();
const worldConfig = resolveWorldCoordinatorConfig();
assert.ok(Object.isFrozen(followerConfig));
assert.ok(Object.isFrozen(worldConfig));
assert.equal(followerConfig.defaultGaitId, "walk");
assert.equal(worldConfig.maxDeltaSeconds, 0.25);
