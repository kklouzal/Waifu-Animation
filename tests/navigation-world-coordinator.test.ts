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

  const badRadius = follower.update(
    makePath("bad-radius", [[0, 0, 0.5]], [0, 0, 1], { radius: "wide" as unknown as number }),
    controller.snapshot(),
    { deltaSeconds: 0.1 }
  );
  assert.equal(badRadius.status, "following");
  assert.ok(badRadius.issues.some((issue) => issue.field === "path.destination.radius"));

  const badWaypointRadiusPath = makePath("bad-waypoint-radius", [[0, 0, 0.5]], [0, 0, 1]);
  const badWaypointRadius = follower.update(
    { ...badWaypointRadiusPath, waypoints: [{ position: [0, 0, 0.5], radius: "wide" as unknown as number }] },
    controller.snapshot(),
    { deltaSeconds: 0.1 }
  );
  assert.ok(badWaypointRadius.issues.some((issue) => issue.field === "path.waypoints[0].radius"));

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

  const neighborPosition: Vec3 = [1, 0, 0];
  const obstaclePosition: Vec3 = [2, 0, 0];
  let observedNeighborPosition: Vec3 | undefined;
  let observedObstaclePosition: Vec3 | undefined;
  const sanitizedAvoidance = follower.update(path, controller.snapshot(), {
    deltaSeconds: 0.1,
    neighbors: [
      {
        actorId: "neighbor",
        position: neighborPosition,
        velocity: [0, 0, 0],
        radius: 0.4,
        desiredVelocity: [0, 0, 1],
        priority: 3
      },
      { position: [Number.NaN, 0, 0], velocity: [0, 0, 0], radius: 0.4, desiredVelocity: [0, 0, 1], priority: 0 }
    ],
    obstacles: [
      { id: "pillar", position: obstaclePosition, radius: 0.5, velocity: [0, 0, 0] },
      { id: "bad", position: [0, 0, 0], radius: 0.5, velocity: [Number.POSITIVE_INFINITY, 0, 0] }
    ],
    localAvoidance(query) {
      observedNeighborPosition = query.neighbors?.[0]?.position;
      observedObstaclePosition = query.obstacles?.[0]?.position;
      if (observedNeighborPosition) observedNeighborPosition[0] = 99;
      if (observedObstaclePosition) observedObstaclePosition[0] = 99;
      return undefined;
    }
  });
  assert.equal(sanitizedAvoidance.status, "following");
  assert.equal(sanitizedAvoidance.issues.filter((issue) => issue.type === "input-rejected").length, 2);
  assert.deepEqual(neighborPosition, [1, 0, 0], "avoidance neighbor query should not alias caller vectors");
  assert.deepEqual(obstaclePosition, [2, 0, 0], "avoidance obstacle query should not alias caller vectors");
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

  const turningFollower = new CharacterPathFollower({
    slowDownRadius: 1,
    turnInPlaceAngleRadians: Math.PI / 8,
    blockedTimeoutSeconds: 0.1
  });
  const turnPath = makePath("turn-only", [], [0, 0, -0.5]);
  for (let step = 0; step < 5; step += 1) {
    const turning = turningFollower.update(turnPath, controller.snapshot(), { deltaSeconds: 0.1 });
    assert.equal(turning.status, "turning");
    assert.equal(turningFollower.snapshot().blockedSeconds, 0, "turn-in-place should not accrue blocked time");
  }
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

  const duplicateOwnReservation = new CharacterWorldCoordinator([
    { id: "solo", controller: makeController(), pathFollower: new CharacterPathFollower() }
  ]);
  const duplicateResult = duplicateOwnReservation.update(0.1, [
    {
      id: "solo",
      path: shared,
      reservations: [{ key: "chair-1", kind: "destination", exclusive: true }]
    }
  ]);
  const soloResult = duplicateResult.actors[0]!;
  assert.equal(soloResult.grantedReservations.length, 1, "same-actor duplicate exclusive reservations should coalesce");
  assert.equal(soloResult.deniedReservations.length, 0);
  assert.equal(soloResult.pathOutput?.status, "following");

  const invalidBlockers = duplicateOwnReservation.update(0.1, [
    { id: "solo", pathBlockers: "door" as unknown as string[] }
  ]);
  assert.ok(invalidBlockers.issues.some((issue) => issue.field === "pathBlockers"));

  const invalidReservationReason = duplicateOwnReservation.update(0.1, [
    { id: "solo", reservations: [{ key: "custom-lock", kind: "custom", reason: 7 as unknown as string }] }
  ]);
  assert.ok(invalidReservationReason.issues.some((issue) => issue.field === "reservations.reason"));
  assert.equal(invalidReservationReason.actors[0]?.grantedReservations[0]?.reason, undefined);
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

  const missingFollower = {
    ...snapshot,
    actors: snapshot.actors.map((actorSnapshot) => {
      if (actorSnapshot.id !== "a") return actorSnapshot;
      const { pathFollower: _pathFollower, ...withoutFollower } = actorSnapshot;
      return withoutFollower;
    })
  };
  assert.throws(
    () => restored.restore(missingFollower),
    /missing path follower state/,
    "restore should reject snapshots that omit registered follower state"
  );

  const atomic = new CharacterWorldCoordinator(
    [
      { id: "a", controller: makeController(), pathFollower: new CharacterPathFollower() },
      { id: "b", controller: makeController(), pathFollower: new CharacterPathFollower() }
    ],
    { seed: "atomic" }
  );
  const atomicSnapshot = atomic.snapshot();
  const corrupted = {
    ...atomicSnapshot,
    actors: atomicSnapshot.actors.map((actorSnapshot) => {
      if (actorSnapshot.id === "a")
        return { ...actorSnapshot, controller: { ...actorSnapshot.controller, position: [5, 0, 0] as Vec3 } };
      if (actorSnapshot.id === "b")
        return {
          ...actorSnapshot,
          controller: { ...actorSnapshot.controller, position: [Number.NaN, 0, 0] as Vec3 }
        };
      return actorSnapshot;
    })
  };
  assert.throws(() => atomic.restore(corrupted), /position/, "failed restore should reject invalid actor snapshots");
  assert.deepEqual(
    atomic.snapshot().actors.find((actorSnapshot) => actorSnapshot.id === "a")?.controller.position,
    [0, 0, 0],
    "failed restore should roll back earlier actor mutations"
  );
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
