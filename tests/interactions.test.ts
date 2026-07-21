import type {
  CharacterInteractionCoordinator,
  CharacterSocketDefinition,
  InteractableResourceDefinition,
  InteractionActorRequest,
  InteractionActorResult,
  InteractionTimingConfig,
  InteractionUpdateResult,
  WorldCoordinatorReservationGrant
} from "./test-api.js";
import {
  CharacterController,
  CharacterWorldCoordinator,
  assert,
  createFlatGroundCharacterWorld,
  createInteractionReservationRequests,
  interactionRequestFromControllerAction,
  interactionResourceReservationKey,
  interactionSocketReservationKey,
  CharacterInteractionCoordinator as InteractionCoordinator,
  CharacterSocketRegistry,
  InteractionResourceRegistry
} from "./test-api.js";

export function runInteractionCoordinatorTests(): void {
  runLifecycleTests();
  runConflictAndLockTests();
  runInvalidInputTests();
  runCancellationAndInterruptionTests();
  runTimingBoundaryTests();
  runSnapshotReplayEqualityTests();
  runDeterministicActorFixtureTests();
  runControllerActionBridgeTests();
}

function runLifecycleTests(): void {
  const coordinator = makeCoordinator();

  const pickup = runCommand(coordinator, {
    actorId: "alice",
    action: "pickup",
    commandId: "pickup-mug",
    resourceId: "mug",
    socketId: "right-hand"
  });
  assert.equal(pickup.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("mug")?.owner?.mode, "carried");
  assert.equal(coordinator.resourceState("mug")?.owner?.socketId, "right-hand");
  assert.equal(allAttachments(pickup).filter((change) => change.type === "attach").length, 1);

  const use = runCommand(coordinator, {
    actorId: "alice",
    action: "use",
    commandId: "use-mug",
    resourceId: "mug"
  });
  assert.equal(use.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("mug")?.use, undefined, "use locks should clear on release");
  assert.ok(allEvents(use).some((event) => event.type === "use-started"));
  assert.ok(allEvents(use).some((event) => event.type === "use-ended"));

  const drop = runCommand(coordinator, {
    actorId: "alice",
    action: "drop",
    commandId: "drop-mug",
    resourceId: "mug"
  });
  assert.equal(drop.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("mug")?.owner, undefined);
  assert.equal(allAttachments(drop).filter((change) => change.type === "detach").length, 1);

  const carry = runCommand(coordinator, {
    actorId: "alice",
    action: "carry",
    commandId: "carry-crate",
    resourceId: "crate",
    socketId: "left-hand"
  });
  assert.equal(carry.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("crate")?.owner?.mode, "carried");
  assert.equal(allAttachments(carry).filter((change) => change.type === "attach").length, 1);
  runCommand(coordinator, {
    actorId: "alice",
    action: "drop",
    commandId: "drop-crate",
    resourceId: "crate"
  });

  const equip = runCommand(coordinator, {
    actorId: "alice",
    action: "equip",
    commandId: "equip-sword",
    resourceId: "sword",
    socketId: "back"
  });
  assert.equal(equip.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("sword")?.owner?.mode, "equipped");
  assert.equal(coordinator.resourceState("sword")?.owner?.socketId, "back");
  assert.equal(allAttachments(equip).filter((change) => change.type === "attach").length, 1);

  const unequip = runCommand(coordinator, {
    actorId: "alice",
    action: "unequip",
    commandId: "unequip-sword",
    resourceId: "sword",
    socketId: "right-hand"
  });
  assert.equal(unequip.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("sword")?.owner?.mode, "carried");
  assert.equal(coordinator.resourceState("sword")?.owner?.socketId, "right-hand");
  assert.equal(allAttachments(unequip).filter((change) => change.type === "detach").length, 1);
  assert.equal(allAttachments(unequip).filter((change) => change.type === "attach").length, 1);

  const sit = runCommand(coordinator, {
    actorId: "alice",
    action: "sit",
    commandId: "sit-chair",
    resourceId: "chair"
  });
  assert.equal(sit.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("chair")?.owner?.mode, "seated");
  assert.ok(allEvents(sit).some((event) => event.type === "seated"));

  const stand = runCommand(
    coordinator,
    { actorId: "alice", action: "stand", commandId: "stand-chair", resourceId: "chair" },
    { clearance: () => ({ clear: true }) }
  );
  assert.equal(stand.terminal.phase, "completed");
  assert.equal(coordinator.resourceState("chair")?.owner, undefined);
  assert.ok(allEvents(stand).some((event) => event.type === "standing"));
}

function runConflictAndLockTests(): void {
  const coordinator = makeCoordinator();
  const conflict = coordinator.update(0, [
    { actorId: "beta", action: "pickup", commandId: "beta-mug", resourceId: "mug", socketId: "right-hand" },
    { actorId: "alpha", action: "pickup", commandId: "alpha-mug", resourceId: "mug", socketId: "right-hand" }
  ]);
  assert.equal(actor(conflict, "alpha").phase, "approach", "lexically first actor should reserve equal-priority item");
  assert.equal(actor(conflict, "beta").phase, "failed");
  assert.ok(actor(conflict, "beta").issues.some((issue) => issue.type === "conflict"));

  const priorityCoordinator = makeCoordinator();
  const priorityConflict = priorityCoordinator.update(0, [
    {
      actorId: "alpha",
      action: "pickup",
      commandId: "alpha-mug",
      resourceId: "mug",
      socketId: "right-hand",
      priority: 0
    },
    { actorId: "beta", action: "pickup", commandId: "beta-mug", resourceId: "mug", socketId: "right-hand", priority: 5 }
  ]);
  assert.equal(actor(priorityConflict, "beta").phase, "approach", "higher request priority should reserve first");
  assert.equal(actor(priorityConflict, "alpha").phase, "failed");

  const socketCoordinator = makeCoordinator();
  runCommand(socketCoordinator, {
    actorId: "alpha",
    action: "pickup",
    commandId: "socket-mug",
    resourceId: "mug",
    socketId: "right-hand"
  });
  const socketDenied = socketCoordinator.update(0, [
    { actorId: "alpha", action: "pickup", commandId: "socket-sword", resourceId: "sword", socketId: "right-hand" }
  ]);
  assert.equal(actor(socketDenied, "alpha").phase, "failed");
  assert.ok(actor(socketDenied, "alpha").issues.some((issue) => issue.code === "socket-owned"));

  const seatCoordinator = makeCoordinator();
  runCommand(seatCoordinator, { actorId: "alpha", action: "sit", commandId: "alpha-sit", resourceId: "chair" });
  const deniedSeat = seatCoordinator.update(0, [
    { actorId: "beta", action: "sit", commandId: "beta-sit", resourceId: "chair" }
  ]);
  assert.equal(actor(deniedSeat, "beta").phase, "failed");
  assert.ok(actor(deniedSeat, "beta").issues.some((issue) => issue.code === "owned"));
  seatCoordinator.addResource({
    id: "bench",
    kind: "seat",
    capabilities: ["sit", "stand"],
    anchors: [
      { id: "bench-approach", kind: "approach", transform: { translation: [1, 0, 3] } },
      { id: "bench-align", kind: "align", transform: { translation: [1, 0, 3.2] } },
      { id: "bench-seat", kind: "seat", transform: { translation: [1, 0.45, 3.4] } },
      { id: "bench-exit", kind: "exit", transform: { translation: [1, 0, 2.4] } }
    ]
  });
  const alreadySeated = seatCoordinator.update(0, [
    { actorId: "alpha", action: "sit", commandId: "alpha-sit-bench", resourceId: "bench" }
  ]);
  assert.equal(actor(alreadySeated, "alpha").phase, "failed");
  assert.ok(actor(alreadySeated, "alpha").issues.some((issue) => issue.code === "already-seated"));

  const blockedStand = seatCoordinator.update(
    0,
    [{ actorId: "alpha", action: "stand", commandId: "alpha-stand-blocked", resourceId: "chair" }],
    { clearance: () => ({ clear: false, reason: "low beam" }) }
  );
  assert.equal(actor(blockedStand, "alpha").phase, "failed");
  assert.ok(actor(blockedStand, "alpha").issues.some((issue) => issue.type === "blocked"));
  assert.equal(seatCoordinator.resourceState("chair")?.owner?.mode, "seated");

  const world = new CharacterWorldCoordinator([
    { id: "beta", controller: new CharacterController({}, createFlatGroundCharacterWorld()) },
    { id: "alpha", controller: new CharacterController({}, createFlatGroundCharacterWorld()) }
  ]);
  const worldReservationResult = world.update(0, [
    {
      id: "beta",
      reservations: createInteractionReservationRequests({
        actorId: "beta",
        action: "pickup",
        resourceId: "mug",
        socketId: "right-hand",
        priority: 0
      })
    },
    {
      id: "alpha",
      reservations: createInteractionReservationRequests({
        actorId: "alpha",
        action: "pickup",
        resourceId: "mug",
        socketId: "right-hand",
        priority: 0
      })
    }
  ]);
  const integrated = makeCoordinator().update(0, [
    {
      actorId: "beta",
      action: "pickup",
      commandId: "world-beta",
      resourceId: "mug",
      socketId: "right-hand",
      reservationGrants: [
        ...worldReservationResult.actors.find((entry) => entry.id === "beta")!.grantedReservations,
        ...worldReservationResult.actors.find((entry) => entry.id === "beta")!.deniedReservations
      ]
    },
    {
      actorId: "alpha",
      action: "pickup",
      commandId: "world-alpha",
      resourceId: "mug",
      socketId: "right-hand",
      reservationGrants: [
        ...worldReservationResult.actors.find((entry) => entry.id === "alpha")!.grantedReservations,
        ...worldReservationResult.actors.find((entry) => entry.id === "alpha")!.deniedReservations
      ]
    }
  ]);
  assert.equal(actor(integrated, "alpha").phase, "approach");
  assert.equal(actor(integrated, "beta").phase, "failed");
  assert.ok(actor(integrated, "beta").issues.some((issue) => issue.type === "reservation-denied"));

  const deniedGrant: WorldCoordinatorReservationGrant = {
    key: interactionResourceReservationKey("mug"),
    kind: "resource",
    granted: false,
    holderId: "holder",
    requesterId: "alpha"
  };
  const externalDenied = makeCoordinator().update(0, [
    {
      actorId: "alpha",
      action: "pickup",
      commandId: "external-denied",
      resourceId: "mug",
      socketId: "right-hand",
      reservationGrants: [deniedGrant]
    }
  ]);
  assert.equal(actor(externalDenied, "alpha").phase, "failed");
  assert.ok(actor(externalDenied, "alpha").issues.some((issue) => issue.type === "reservation-denied"));
}

function runInvalidInputTests(): void {
  const coordinator = makeCoordinator();
  const missing = coordinator.update(0, [
    { actorId: "alice", action: "pickup", commandId: "missing", resourceId: "ghost", socketId: "right-hand" }
  ]);
  assert.equal(actor(missing, "alice").phase, "failed");
  assert.ok(actor(missing, "alice").issues.some((issue) => issue.type === "invalid-resource"));

  const badSocket = coordinator.update(0, [
    { actorId: "alice", action: "pickup", commandId: "bad-socket", resourceId: "mug", socketId: "ghost" }
  ]);
  assert.equal(actor(badSocket, "alice").phase, "failed");
  assert.ok(actor(badSocket, "alice").issues.some((issue) => issue.type === "invalid-socket"));

  const badAnchors = new InteractionCoordinator({
    sockets: makeSockets(),
    resources: [
      {
        id: "bad-item",
        kind: "item",
        capabilities: ["pickup"],
        defaultSocketId: "right-hand",
        anchors: [{ id: "exit", kind: "exit", transform: { translation: [0, 0, 0] } }]
      }
    ],
    config: { defaultTimings: fastTimings(), maxDeltaSeconds: 1 }
  });
  const invalidAnchor = badAnchors.update(0, [
    { actorId: "alice", action: "pickup", commandId: "bad-anchor", resourceId: "bad-item" }
  ]);
  assert.equal(actor(invalidAnchor, "alice").phase, "failed");
  assert.ok(actor(invalidAnchor, "alice").issues.some((issue) => issue.type === "invalid-anchor"));

  assert.throws(
    () => new CharacterSocketRegistry([{ id: "bad", localOffset: { translation: [Number.NaN, 0, 0] } }]),
    /values must be finite/,
    "socket transforms should be strict finite values"
  );
  assert.throws(
    () =>
      new InteractionResourceRegistry([
        {
          id: "dupe-anchor",
          kind: "item",
          capabilities: ["pickup"],
          anchors: [
            { id: "same", kind: "contact", transform: { translation: [0, 0, 0] } },
            { id: "same", kind: "exit", transform: { translation: [0, 0, 0] } }
          ]
        }
      ]),
    /duplicated/,
    "anchor ids should be unique per resource"
  );
}

function runCancellationAndInterruptionTests(): void {
  const coordinator = makeCoordinator();
  coordinator.update(0, [
    { actorId: "alice", action: "pickup", commandId: "cancel-pickup", resourceId: "mug", socketId: "right-hand" }
  ]);
  const cancelled = coordinator.update(0, [{ actorId: "alice", cancel: true }]);
  assert.equal(actor(cancelled, "alice").phase, "cancelled");
  assert.ok(actor(cancelled, "alice").issues.some((issue) => issue.type === "cancelled"));
  assert.equal(coordinator.resourceState("mug")?.reservation, undefined);
  assert.equal(coordinator.resourceState("mug")?.owner, undefined);

  const afterCancel = coordinator.update(0, [
    { actorId: "beta", action: "pickup", commandId: "after-cancel", resourceId: "mug", socketId: "right-hand" }
  ]);
  assert.equal(actor(afterCancel, "beta").phase, "approach");

  const useCoordinator = makeCoordinator();
  useCoordinator.update(0, [{ actorId: "alice", action: "use", commandId: "use-station", resourceId: "station" }]);
  useCoordinator.update(0.03);
  assert.equal(useCoordinator.resourceState("station")?.use?.actorId, "alice");
  const interrupted = useCoordinator.update(0, [{ actorId: "alice", interrupt: { reason: "higher priority hit" } }]);
  assert.equal(actor(interrupted, "alice").phase, "cancelled");
  assert.ok(actor(interrupted, "alice").events.some((event) => event.type === "interrupted"));
  assert.equal(
    useCoordinator.resourceState("station")?.use,
    undefined,
    "interruption should release transient use locks"
  );
}

function runTimingBoundaryTests(): void {
  const timings = uniformTimings(0.05);
  const coordinator = makeCoordinator(timings);
  const start = coordinator.update(0, [
    { actorId: "alice", action: "pickup", commandId: "timed", resourceId: "mug", socketId: "right-hand" }
  ]);
  assert.equal(actor(start, "alice").phase, "approach");
  assert.deepEqual(
    actor(start, "alice").events.map((event) => event.type),
    ["started", "phase-started"]
  );
  assert.equal(actor(start, "alice").animation?.semanticId, "interaction.pickup.approach");

  const align = coordinator.update(0.05);
  assert.equal(actor(align, "alice").phase, "align");
  assert.equal(actor(align, "alice").events[0]?.type, "phase-started");

  const reach = coordinator.update(0.05);
  assert.equal(actor(reach, "alice").phase, "reach");
  assert.ok(actor(reach, "alice").events.some((event) => event.type === "reach-window-open"));
  assert.equal(actor(reach, "alice").reach[0]?.window.active, true);

  const contact = coordinator.update(0.05);
  assert.equal(actor(contact, "alice").phase, "contact");
  assert.ok(actor(contact, "alice").events.some((event) => event.type === "contact"));
  assert.ok(actor(contact, "alice").events.some((event) => event.type === "reach-window-close"));
  assert.equal(actor(contact, "alice").attachments.filter((change) => change.type === "attach").length, 1);

  const transfer = coordinator.update(0.05);
  assert.equal(actor(transfer, "alice").phase, "transfer");
  assert.equal(actor(transfer, "alice").animation?.semanticId, "interaction.pickup.transfer");

  const terminal = drain(coordinator).terminal;
  assert.equal(terminal.phase, "completed");
  assert.equal(
    allEvents({ results: [start, align, reach, contact, transfer], terminal }).filter(
      (event) => event.type === "reach-window-open"
    ).length,
    1
  );
  assert.equal(
    allEvents({ results: [start, align, reach, contact, transfer], terminal }).filter(
      (event) => event.type === "reach-window-close"
    ).length,
    1
  );
}

function runSnapshotReplayEqualityTests(): void {
  const original = makeCoordinator(uniformTimings(0.05));
  original.update(0, [
    { actorId: "alice", action: "pickup", commandId: "replay", resourceId: "mug", socketId: "right-hand" }
  ]);
  original.update(0.03);
  const snapshot = original.snapshot();

  const restored = makeCoordinator(uniformTimings(0.05));
  restored.restore(snapshot);

  const originalSummaries = [];
  const restoredSummaries = [];
  for (let step = 0; step < 6; step += 1) {
    originalSummaries.push(summarize(original.update(0.05)));
    restoredSummaries.push(summarize(restored.update(0.05)));
  }
  assert.deepEqual(restoredSummaries, originalSummaries, "interaction snapshot replay should be deterministic");
}

function runDeterministicActorFixtureTests(): void {
  const actorCount = 12;
  const resources = makeResources([
    ...Array.from({ length: actorCount }, (_, index) => ({
      id: `fixture-item-${index.toString().padStart(2, "0")}`,
      kind: "item" as const,
      capabilities: ["pickup", "drop"] as const,
      defaultSocketId: index % 2 === 0 ? "right-hand" : "left-hand",
      anchors: itemAnchors(index * 0.25)
    }))
  ]);
  const makeFixture = (): CharacterInteractionCoordinator =>
    new InteractionCoordinator({
      sockets: makeSockets(),
      resources,
      config: { defaultTimings: fastTimings(), maxDeltaSeconds: 1 }
    });
  const requests = Array.from({ length: actorCount }, (_, index) => ({
    actorId: `actor-${index.toString().padStart(2, "0")}`,
    action: "pickup" as const,
    commandId: `pickup-${index}`,
    resourceId: `fixture-item-${index.toString().padStart(2, "0")}`,
    socketId: index % 2 === 0 ? "right-hand" : "left-hand",
    priority: index % 3
  }));
  const first = makeFixture();
  const second = makeFixture();
  const firstSummary = [];
  const secondSummary = [];
  firstSummary.push(summarize(first.update(0, requests)));
  secondSummary.push(summarize(second.update(0, requests)));
  for (let step = 0; step < 5; step += 1) {
    firstSummary.push(summarize(first.update(0.05)));
    secondSummary.push(summarize(second.update(0.05)));
  }
  assert.deepEqual(secondSummary, firstSummary, "12 actor interaction fixture should replay deterministically");
  assert.equal(first.snapshot().resources.filter((state) => state.owner?.mode === "carried").length, actorCount);
}

function runControllerActionBridgeTests(): void {
  const request = interactionRequestFromControllerAction("alice", {
    kind: "pickup",
    commandId: "controller-pickup",
    itemId: "mug",
    socketId: "right-hand"
  });
  assert.deepEqual(request, {
    actorId: "alice",
    controllerAction: {
      kind: "pickup",
      commandId: "controller-pickup",
      itemId: "mug",
      socketId: "right-hand"
    },
    action: "pickup",
    commandId: "controller-pickup",
    resourceId: "mug",
    itemId: "mug",
    socketId: "right-hand"
  });
  assert.throws(
    () => interactionRequestFromControllerAction("alice", { kind: "custom", commandId: "custom" }),
    /not supported/,
    "custom controller actions should remain app-owned"
  );
  assert.deepEqual(
    createInteractionReservationRequests({
      actorId: "alice",
      action: "pickup",
      resourceId: "mug",
      socketId: "right-hand",
      priority: 2
    }),
    [
      {
        key: interactionResourceReservationKey("mug"),
        kind: "resource",
        exclusive: true,
        priority: 2,
        reason: "interaction:pickup"
      },
      {
        key: interactionSocketReservationKey("alice", "right-hand"),
        kind: "custom",
        exclusive: true,
        priority: 2,
        reason: "interaction:pickup:socket"
      }
    ]
  );
}

function makeCoordinator(defaultTimings: InteractionTimingConfig = fastTimings()): CharacterInteractionCoordinator {
  return new InteractionCoordinator({
    sockets: makeSockets(),
    resources: makeResources(),
    config: { defaultTimings, maxDeltaSeconds: 1 }
  });
}

function makeSockets(): CharacterSocketDefinition[] {
  return [
    { id: "right-hand", label: "Right hand", tags: ["hand", "primary"] },
    { id: "left-hand", label: "Left hand", tags: ["hand", "secondary"] },
    { id: "back", label: "Back", tags: ["equipment"] },
    { id: "hip", label: "Hip", tags: ["equipment"] }
  ];
}

function makeResources(extra: readonly InteractableResourceDefinition[] = []): InteractableResourceDefinition[] {
  return [
    {
      id: "mug",
      kind: "item",
      capabilities: ["pickup", "carry", "drop", "use"],
      defaultSocketId: "right-hand",
      anchors: itemAnchors(0)
    },
    {
      id: "crate",
      kind: "item",
      capabilities: ["carry", "drop"],
      defaultSocketId: "left-hand",
      anchors: itemAnchors(1)
    },
    {
      id: "sword",
      kind: "item",
      capabilities: ["pickup", "drop", "equip", "unequip", "use"],
      defaultSocketId: "right-hand",
      actionSockets: { equip: "back", unequip: "right-hand" },
      anchors: itemAnchors(2)
    },
    {
      id: "station",
      kind: "station",
      capabilities: ["use"],
      anchors: [
        { id: "station-approach", kind: "approach", transform: { translation: [3, 0, 0] }, radius: 0.4 },
        { id: "station-align", kind: "align", transform: { translation: [3, 0, 0.2] }, facingYaw: 0 },
        { id: "station-contact", kind: "contact", transform: { translation: [3, 1, 0.4] } },
        { id: "station-use", kind: "use", transform: { translation: [3, 1, 0.4] } },
        { id: "station-exit", kind: "exit", transform: { translation: [3, 0, -0.4] }, radius: 0.4 }
      ]
    },
    {
      id: "chair",
      kind: "seat",
      capabilities: ["sit", "stand"],
      anchors: [
        { id: "chair-approach", kind: "approach", transform: { translation: [0, 0, 3] }, radius: 0.5 },
        { id: "chair-align", kind: "align", transform: { translation: [0, 0, 3.2] }, facingYaw: Math.PI },
        { id: "chair-seat", kind: "seat", transform: { translation: [0, 0.45, 3.4] }, facingYaw: Math.PI },
        { id: "chair-exit", kind: "exit", transform: { translation: [0, 0, 2.4] }, radius: 0.5 }
      ]
    },
    ...extra
  ];
}

function itemAnchors(x: number): NonNullable<InteractableResourceDefinition["anchors"]> {
  return [
    { id: `item-${x}-approach`, kind: "approach", transform: { translation: [x, 0, 0.3] }, radius: 0.35 },
    { id: `item-${x}-align`, kind: "align", transform: { translation: [x, 0, 0.15] }, facingYaw: 0 },
    { id: `item-${x}-contact`, kind: "contact", transform: { translation: [x, 0.8, 0] } },
    { id: `item-${x}-use`, kind: "use", transform: { translation: [x, 0.8, 0] } },
    { id: `item-${x}-exit`, kind: "exit", transform: { translation: [x, 0, -0.3] }, radius: 0.35 }
  ];
}

function fastTimings(): InteractionTimingConfig {
  return uniformTimings(0.01);
}

function uniformTimings(value: number): InteractionTimingConfig {
  return {
    approach: value,
    align: value,
    reach: value,
    contact: value,
    transfer: value,
    carry: value,
    equipped: value,
    use: value,
    seated: value,
    release: value,
    exit: value
  };
}

function runCommand(
  coordinator: CharacterInteractionCoordinator,
  request: InteractionActorRequest,
  options: Parameters<CharacterInteractionCoordinator["update"]>[2] = {}
): { results: InteractionUpdateResult[]; terminal: InteractionActorResult } {
  const first = coordinator.update(0, [request], options);
  return drain(coordinator, [first], options);
}

function drain(
  coordinator: CharacterInteractionCoordinator,
  previous: InteractionUpdateResult[] = [],
  options: Parameters<CharacterInteractionCoordinator["update"]>[2] = {}
): { results: InteractionUpdateResult[]; terminal: InteractionActorResult } {
  const results = [...previous];
  for (let step = 0; step < 10; step += 1) {
    const latest = results[results.length - 1];
    const lastActor = latest ? latest.actors[0] : undefined;
    if (lastActor?.terminal === true) return { results, terminal: lastActor };
    const next = coordinator.update(0.5, [], options);
    results.push(next);
    const nextActor = next.actors[0];
    if (nextActor?.terminal === true) return { results, terminal: nextActor };
  }
  throw new Error("interaction did not reach a terminal phase");
}

function actor(result: InteractionUpdateResult, actorId: string): InteractionActorResult {
  const found = result.actors.find((entry) => entry.actorId === actorId);
  if (!found) throw new Error(`missing actor result ${actorId}`);
  return found;
}

function allEvents(run: {
  results: readonly InteractionUpdateResult[];
  terminal?: InteractionActorResult;
}): InteractionActorResult["events"] {
  const events = [
    ...run.results.flatMap((result) => result.actors.flatMap((entry) => entry.events)),
    ...(run.terminal?.events ?? [])
  ];
  return [...new Map(events.map((event) => [event.key, event])).values()];
}

function allAttachments(run: {
  results: readonly InteractionUpdateResult[];
  terminal?: InteractionActorResult;
}): InteractionActorResult["attachments"] {
  const attachments = [
    ...run.results.flatMap((result) => result.actors.flatMap((entry) => entry.attachments)),
    ...(run.terminal?.attachments ?? [])
  ];
  return [...new Map(attachments.map((change) => [change.key, change])).values()];
}

function summarize(result: InteractionUpdateResult): unknown {
  return {
    tick: result.tick,
    order: result.actorOrder,
    actors: result.actors.map((entry) => ({
      actorId: entry.actorId,
      phase: entry.phase,
      action: entry.action,
      commandId: entry.commandId,
      resourceId: entry.resourceId,
      socketId: entry.socketId,
      terminal: entry.terminal,
      events: entry.events.map((event) => [event.type, event.key]),
      attachments: entry.attachments.map((change) => [change.type, change.key, change.socketId]),
      issues: entry.issues.map((issue) => [issue.type, issue.code])
    })),
    resources: result.resources.map((state) => [
      state.id,
      state.mutationSequence,
      state.owner ? [state.owner.actorId, state.owner.mode, state.owner.socketId] : null,
      state.reservation ? [state.reservation.actorId, state.reservation.commandId] : null,
      state.use ? [state.use.actorId, state.use.commandId] : null
    ])
  };
}
