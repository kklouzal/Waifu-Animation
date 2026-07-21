import {
  type CharacterController,
  type CharacterControllerInput,
  type CharacterControllerSnapshot,
  type CharacterControllerStepResult
} from "./character-controller.js";
import { cloneVec3, hashSeed, subVec3, type Transform } from "./math.js";
import {
  CharacterPathFollower,
  type NavigationActorId,
  type NavigationDestination,
  type NavigationLocalAvoidanceAdapter,
  type NavigationLocalAvoidanceAgent,
  type NavigationLocalAvoidanceObstacle,
  type NavigationPath,
  type NavigationReservationKey,
  type PathFollowerOutput,
  type PathFollowerSnapshot
} from "./navigation.js";
import {
  RootMotionReconciler,
  createRootMotionActorStateFromControllerSnapshot,
  type RootMotionActorState,
  type RootMotionAuthorityPolicyConfig,
  type RootMotionOwnershipDeclaration,
  type RootMotionReconcileInput,
  type RootMotionReconcileResult,
  type RootMotionReconcilerSnapshot,
  type RootMotionWorldAdapter
} from "./root-motion-authority.js";

export const WORLD_COORDINATOR_SCHEMA_VERSION = 1;

export type WorldCoordinatorReservationKind = "destination" | "resource" | "path-blocker" | "custom";
export type WorldCoordinatorIssueType =
  | "input-rejected"
  | "unknown-actor"
  | "duplicate"
  | "reservation-denied"
  | "bounded";

export type WorldCoordinatorConfig = {
  /** Seed namespace for deterministic per-actor PRNG state. */
  seed?: string | number;
  maxDeltaSeconds?: number;
};

export type WorldCoordinatorResolvedConfig = Readonly<Required<WorldCoordinatorConfig>>;

export type WorldCoordinatorActorConfig = {
  id: NavigationActorId;
  controller: CharacterController;
  /** Optional follower owned by the reusable library; callers may also supply direct controller input. */
  pathFollower?: CharacterPathFollower;
  /** Optional reconciler owned by the reusable library. It reports root motion but never mutates controller/model state. */
  rootMotionReconciler?: RootMotionReconciler;
  seed?: string | number;
  radius?: number;
  /** Conflict tiebreak after per-reservation priority. Higher wins; actor id remains the final stable tiebreak. */
  priority?: number;
};

export type WorldCoordinatorRootMotionRequest = Readonly<{
  actor?: RootMotionActorState;
  runtime?: RootMotionReconcileInput["runtime"];
  animationDelta?: Transform;
  /** Defaults to the controller delta produced by this coordinator update when omitted. */
  physicsDisplacement?: RootMotionReconcileInput["physicsDisplacement"];
  /** Defaults to the controller yaw delta produced by this coordinator update when omitted. */
  physicsYawDelta?: number;
  /** Set false to avoid defaulting physics displacement/yaw from the controller step. */
  useControllerDelta?: boolean;
  policy?: RootMotionAuthorityPolicyConfig;
  ownership?: RootMotionOwnershipDeclaration;
  world?: RootMotionWorldAdapter;
}>;

export type WorldCoordinatorReservationRequest = {
  key: NavigationReservationKey;
  kind: WorldCoordinatorReservationKind;
  /** Exclusive reservations grant at most one actor per batch. Defaults true. */
  exclusive?: boolean;
  /** Higher wins for the same key before actor priority and actor id. */
  priority?: number;
  reason?: string;
};

export type WorldCoordinatorReservationGrant = {
  key: NavigationReservationKey;
  kind: WorldCoordinatorReservationKind;
  granted: boolean;
  holderId: NavigationActorId;
  requesterId: NavigationActorId;
  reason?: string;
};

export type WorldCoordinatorActorRequest = {
  id: NavigationActorId;
  /** Optional path-following request. Requires the actor to have a CharacterPathFollower. */
  path?: NavigationPath | null;
  /** Direct controller input used when no path is supplied or no follower is registered. */
  input?: CharacterControllerInput;
  /** Optional root-motion reconciliation request. Requires actor rootMotionReconciler; output is report-only. */
  rootMotion?: WorldCoordinatorRootMotionRequest | null;
  /** Explicit reservations; destination/resource reservations can also be inferred from path.destination keys. */
  reservations?: readonly WorldCoordinatorReservationRequest[];
  /** Explicit path blockers that should be arbitrated before movement, e.g. a doorway segment id. */
  pathBlockers?: readonly NavigationReservationKey[];
};

export type WorldCoordinatorUpdateOptions = {
  localAvoidance?: NavigationLocalAvoidanceAdapter;
  obstacles?: readonly NavigationLocalAvoidanceObstacle[];
};

export type WorldCoordinatorIssue = {
  type: WorldCoordinatorIssueType;
  actorId?: NavigationActorId;
  field: string;
  code: string;
  message: string;
  tick: number;
};

export type WorldCoordinatorActorSnapshot = {
  id: NavigationActorId;
  priority: number;
  radius: number;
  randomState: number;
  controller: CharacterControllerSnapshot;
  pathFollower?: PathFollowerSnapshot;
  rootMotion?: RootMotionReconcilerSnapshot;
};

export type WorldCoordinatorSnapshot = {
  schemaVersion: typeof WORLD_COORDINATOR_SCHEMA_VERSION;
  tick: number;
  actors: readonly WorldCoordinatorActorSnapshot[];
};

export type WorldCoordinatorActorResult = {
  id: NavigationActorId;
  order: number;
  randomState: number;
  grantedReservations: WorldCoordinatorReservationGrant[];
  deniedReservations: WorldCoordinatorReservationGrant[];
  pathOutput?: PathFollowerOutput;
  rootMotion?: RootMotionReconcileResult;
  controllerResult: CharacterControllerStepResult;
  issues: WorldCoordinatorIssue[];
};

export type WorldCoordinatorUpdateResult = {
  schemaVersion: typeof WORLD_COORDINATOR_SCHEMA_VERSION;
  tick: number;
  deltaSeconds: number;
  actorOrder: NavigationActorId[];
  actors: WorldCoordinatorActorResult[];
  issues: WorldCoordinatorIssue[];
};

type ActorRuntime = {
  id: NavigationActorId;
  controller: CharacterController;
  pathFollower?: CharacterPathFollower;
  rootMotionReconciler?: RootMotionReconciler;
  priority: number;
  radius: number;
  randomState: number;
};

type SanitizedReservation = WorldCoordinatorReservationRequest & {
  actorId: NavigationActorId;
  exclusive: boolean;
  priority: number;
  order: number;
};

type ReservationResolution = {
  grantsByActor: Map<NavigationActorId, WorldCoordinatorReservationGrant[]>;
  denialsByActor: Map<NavigationActorId, WorldCoordinatorReservationGrant[]>;
};

const DEFAULT_WORLD_COORDINATOR_CONFIG = {
  seed: "waifu-animation-world",
  maxDeltaSeconds: 0.25
} as const;

export class CharacterWorldCoordinator {
  readonly config: WorldCoordinatorResolvedConfig;
  private tick = 0;
  private readonly actors = new Map<NavigationActorId, ActorRuntime>();

  constructor(actors: readonly WorldCoordinatorActorConfig[] = [], config: WorldCoordinatorConfig = {}) {
    this.config = resolveWorldCoordinatorConfig(config);
    for (const actor of actors) this.addActor(actor);
  }

  addActor(config: WorldCoordinatorActorConfig): void {
    if (!isRecord(config)) throw new Error("world coordinator actor config must be an object");
    if (!isNonEmptyString(config.id)) throw new Error("world coordinator actor id must be a non-empty string");
    if (this.actors.has(config.id)) throw new Error(`world coordinator actor ${config.id} already exists`);
    if (
      !config.controller ||
      typeof config.controller.update !== "function" ||
      typeof config.controller.snapshot !== "function"
    )
      throw new Error("world coordinator actor controller must be a CharacterController-like instance");
    if (config.pathFollower !== undefined && !(config.pathFollower instanceof CharacterPathFollower))
      throw new Error("world coordinator actor pathFollower must be a CharacterPathFollower");
    if (config.rootMotionReconciler !== undefined && !(config.rootMotionReconciler instanceof RootMotionReconciler))
      throw new Error("world coordinator actor rootMotionReconciler must be a RootMotionReconciler");
    this.actors.set(config.id, {
      id: config.id,
      controller: config.controller,
      ...(config.pathFollower !== undefined ? { pathFollower: config.pathFollower } : {}),
      ...(config.rootMotionReconciler !== undefined ? { rootMotionReconciler: config.rootMotionReconciler } : {}),
      priority: optionalFinite(config.priority, 0),
      radius: optionalFinitePositive(config.radius, 0.35),
      randomState: initialActorRandomState(this.config.seed, config.id, config.seed)
    });
  }

  removeActor(id: NavigationActorId): boolean {
    return this.actors.delete(id);
  }

  actorIds(): NavigationActorId[] {
    return this.sortedActors().map((actor) => actor.id);
  }

  nextActorRandom(actorId: NavigationActorId): number {
    const actor = this.actors.get(actorId);
    if (!actor) throw new Error(`world coordinator actor ${actorId} is not registered`);
    actor.randomState = nextRandomState(actor.randomState);
    return actor.randomState / 4294967296;
  }

  snapshot(): WorldCoordinatorSnapshot {
    return {
      schemaVersion: WORLD_COORDINATOR_SCHEMA_VERSION,
      tick: this.tick,
      actors: this.sortedActors().map((actor) => {
        const snapshot: WorldCoordinatorActorSnapshot = {
          id: actor.id,
          priority: actor.priority,
          radius: actor.radius,
          randomState: actor.randomState,
          controller: actor.controller.snapshot()
        };
        if (actor.pathFollower !== undefined) snapshot.pathFollower = actor.pathFollower.snapshot();
        if (actor.rootMotionReconciler !== undefined) snapshot.rootMotion = actor.rootMotionReconciler.snapshot();
        return snapshot;
      })
    };
  }

  restore(snapshot: WorldCoordinatorSnapshot): void {
    if (!isRecord(snapshot)) throw new Error("world coordinator snapshot must be an object");
    if (snapshot.schemaVersion !== WORLD_COORDINATOR_SCHEMA_VERSION)
      throw new Error("unsupported world coordinator snapshot schemaVersion");
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0)
      throw new Error("world coordinator snapshot tick must be a non-negative integer");
    if (!isReadonlyArray(snapshot.actors)) throw new Error("world coordinator snapshot actors must be an array");
    const expectedIds = this.actorIds();
    const actorSnapshots = snapshot.actors;
    const snapshotIds = actorSnapshots.map((actorSnapshot) => actorSnapshot.id).sort(compareActorId);
    if (expectedIds.length !== snapshotIds.length || expectedIds.some((id, index) => id !== snapshotIds[index]))
      throw new Error("world coordinator snapshot actors must match registered actors");
    for (const actorSnapshot of actorSnapshots) {
      const actor = this.actors.get(actorSnapshot.id);
      if (!actor) throw new Error(`world coordinator snapshot actor ${actorSnapshot.id} is not registered`);
      if (
        !Number.isFinite(actorSnapshot.priority) ||
        !Number.isFinite(actorSnapshot.radius) ||
        actorSnapshot.radius <= 0
      )
        throw new Error("world coordinator snapshot actor priority/radius must be finite");
      if (
        !Number.isInteger(actorSnapshot.randomState) ||
        actorSnapshot.randomState < 0 ||
        actorSnapshot.randomState > 0xffffffff
      )
        throw new Error("world coordinator snapshot actor randomState must be uint32");
      if (actor.pathFollower === undefined && actorSnapshot.pathFollower !== undefined)
        throw new Error(`world coordinator actor ${actor.id} has no path follower to restore`);
      if (actor.rootMotionReconciler === undefined && actorSnapshot.rootMotion !== undefined)
        throw new Error(`world coordinator actor ${actor.id} has no root motion reconciler to restore`);
      actor.priority = actorSnapshot.priority;
      actor.radius = actorSnapshot.radius;
      actor.randomState = actorSnapshot.randomState >>> 0;
      actor.controller.restore(actorSnapshot.controller);
      if (actorSnapshot.pathFollower !== undefined) actor.pathFollower?.restore(actorSnapshot.pathFollower);
      if (actorSnapshot.rootMotion !== undefined) actor.rootMotionReconciler?.restore(actorSnapshot.rootMotion);
    }
    this.tick = snapshot.tick;
  }

  update(
    deltaSeconds: number,
    requests: readonly WorldCoordinatorActorRequest[] = [],
    options: WorldCoordinatorUpdateOptions = {}
  ): WorldCoordinatorUpdateResult {
    this.tick += 1;
    const tick = this.tick;
    const issues: WorldCoordinatorIssue[] = [];
    const finiteDelta = sanitizeDeltaSeconds(deltaSeconds, this.config, issues, tick);
    const requestByActor = sanitizeRequests(requests, this.actors, issues, tick);
    const orderedActors = this.sortedActors();
    const reservations = collectReservations(orderedActors, requestByActor, issues, tick);
    const resolution = resolveReservations(reservations, this.actors);
    const neighbors = createNeighborMap(orderedActors);
    const actorResults: WorldCoordinatorActorResult[] = [];

    for (let order = 0; order < orderedActors.length; order += 1) {
      const actor = orderedActors[order]!;
      const request = requestByActor.get(actor.id);
      const grantedReservations = resolution.grantsByActor.get(actor.id) ?? [];
      const deniedReservations = resolution.denialsByActor.get(actor.id) ?? [];
      const actorIssues: WorldCoordinatorIssue[] = deniedReservations.map((denial) =>
        createIssue(
          "reservation-denied",
          actor.id,
          "reservations",
          denial.kind,
          `reservation ${denial.key} is held by actor ${denial.holderId}`,
          tick
        )
      );
      issues.push(...actorIssues);

      const controllerBefore = actor.controller.snapshot();
      let pathOutput: PathFollowerOutput | undefined;
      let input = request?.input ? cloneControllerInput(request.input) : ({} satisfies CharacterControllerInput);
      if (request?.path !== undefined && actor.pathFollower !== undefined && deniedReservations.length === 0) {
        pathOutput = actor.pathFollower.update(request.path, actor.controller.snapshot(), {
          deltaSeconds: finiteDelta,
          actorId: actor.id,
          actorRadius: actor.radius,
          priority: actor.priority,
          ...(options.localAvoidance !== undefined ? { localAvoidance: options.localAvoidance } : {}),
          neighbors: neighbors.get(actor.id) ?? [],
          ...(options.obstacles !== undefined ? { obstacles: options.obstacles } : {})
        });
        input = pathOutput.input;
      } else if (request?.path !== undefined && actor.pathFollower === undefined) {
        const issue = createIssue(
          "input-rejected",
          actor.id,
          "path",
          "missing-follower",
          "actor path request requires a registered CharacterPathFollower",
          tick
        );
        actorIssues.push(issue);
        issues.push(issue);
      }
      if (deniedReservations.length > 0) input = {};
      const controllerResult = actor.controller.update(finiteDelta, input);
      const rootMotion = reconcileActorRootMotion(
        actor,
        request?.rootMotion,
        controllerBefore,
        controllerResult.state,
        finiteDelta,
        actorIssues,
        issues,
        tick
      );
      actorResults.push({
        id: actor.id,
        order,
        randomState: actor.randomState,
        grantedReservations: grantedReservations.map((grant) => ({ ...grant })),
        deniedReservations: deniedReservations.map((denial) => ({ ...denial })),
        ...(pathOutput !== undefined ? { pathOutput } : {}),
        ...(rootMotion !== undefined ? { rootMotion } : {}),
        controllerResult,
        issues: actorIssues
      });
    }

    return {
      schemaVersion: WORLD_COORDINATOR_SCHEMA_VERSION,
      tick,
      deltaSeconds: finiteDelta,
      actorOrder: orderedActors.map((actor) => actor.id),
      actors: actorResults,
      issues
    };
  }

  private sortedActors(): ActorRuntime[] {
    return [...this.actors.values()].sort((a, b) => compareActorId(a.id, b.id));
  }
}

function reconcileActorRootMotion(
  actor: ActorRuntime,
  request: WorldCoordinatorRootMotionRequest | null | undefined,
  controllerBefore: CharacterControllerSnapshot,
  controllerAfter: CharacterControllerSnapshot,
  deltaSeconds: number,
  actorIssues: WorldCoordinatorIssue[],
  issues: WorldCoordinatorIssue[],
  tick: number
): RootMotionReconcileResult | undefined {
  if (request === null || request === undefined) return undefined;
  if (!isRecord(request)) {
    const issue = createIssue(
      "input-rejected",
      actor.id,
      "rootMotion",
      "type",
      "world coordinator rootMotion request must be an object",
      tick
    );
    actorIssues.push(issue);
    issues.push(issue);
    return undefined;
  }
  if (actor.rootMotionReconciler === undefined) {
    const issue = createIssue(
      "input-rejected",
      actor.id,
      "rootMotion",
      "missing-reconciler",
      "actor rootMotion request requires a registered RootMotionReconciler",
      tick
    );
    actorIssues.push(issue);
    issues.push(issue);
    return undefined;
  }

  const useControllerDelta = request.useControllerDelta !== false;
  const actorState =
    request.actor ??
    createRootMotionActorStateFromControllerSnapshot(controllerBefore, {
      actorId: actor.id,
      radius: actor.radius,
      height: actor.controller.config.height
    });
  const physicsDisplacement =
    request.physicsDisplacement ??
    (useControllerDelta ? subVec3(controllerAfter.position, controllerBefore.position) : undefined);
  const physicsYawDelta =
    request.physicsYawDelta ?? (useControllerDelta ? wrapYaw(controllerAfter.yaw - controllerBefore.yaw) : undefined);
  return actor.rootMotionReconciler.reconcile({
    actor: actorState,
    deltaSeconds,
    ...(request.runtime !== undefined ? { runtime: request.runtime } : {}),
    ...(request.animationDelta !== undefined ? { animationDelta: request.animationDelta } : {}),
    ...(physicsDisplacement !== undefined ? { physicsDisplacement } : {}),
    ...(physicsYawDelta !== undefined ? { physicsYawDelta } : {}),
    ...(request.policy !== undefined ? { policy: request.policy } : {}),
    ...(request.ownership !== undefined ? { ownership: request.ownership } : {}),
    ...(request.world !== undefined ? { world: request.world } : {})
  });
}

export function resolveWorldCoordinatorConfig(config: WorldCoordinatorConfig = {}): WorldCoordinatorResolvedConfig {
  if (!isRecord(config)) throw new Error("world coordinator config must be an object");
  return Object.freeze({
    seed: config.seed ?? DEFAULT_WORLD_COORDINATOR_CONFIG.seed,
    maxDeltaSeconds: optionalFinitePositive(config.maxDeltaSeconds, DEFAULT_WORLD_COORDINATOR_CONFIG.maxDeltaSeconds)
  });
}

export function navigationDestinationReservations(
  destination: NavigationDestination
): WorldCoordinatorReservationRequest[] {
  const reservations: WorldCoordinatorReservationRequest[] = [];
  if (destination.reservationKey !== undefined) {
    reservations.push({ key: destination.reservationKey, kind: "destination", exclusive: true });
  }
  if (destination.resourceId !== undefined) {
    reservations.push({ key: destination.resourceId, kind: "resource", exclusive: true });
  }
  return reservations;
}

function sanitizeRequests(
  requests: readonly WorldCoordinatorActorRequest[],
  actors: ReadonlyMap<NavigationActorId, ActorRuntime>,
  issues: WorldCoordinatorIssue[],
  tick: number
): Map<NavigationActorId, WorldCoordinatorActorRequest> {
  const byActor = new Map<NavigationActorId, WorldCoordinatorActorRequest>();
  if (!isReadonlyArray(requests)) {
    issues.push(
      createIssue("input-rejected", undefined, "requests", "type", "world coordinator requests must be an array", tick)
    );
    return byActor;
  }
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (!isRecord(request) || !isNonEmptyString(request.id)) {
      issues.push(
        createIssue(
          "input-rejected",
          undefined,
          `requests[${index}].id`,
          "id",
          "world coordinator request actor id must be a string",
          tick
        )
      );
      continue;
    }
    if (!actors.has(request.id)) {
      issues.push(
        createIssue(
          "unknown-actor",
          request.id,
          `requests[${index}].id`,
          "unknown",
          "world coordinator request actor is not registered",
          tick
        )
      );
      continue;
    }
    if (byActor.has(request.id)) {
      issues.push(
        createIssue(
          "duplicate",
          request.id,
          `requests[${index}].id`,
          "duplicate",
          "duplicate actor request ignored",
          tick
        )
      );
      continue;
    }
    byActor.set(request.id, request);
  }
  return byActor;
}

function collectReservations(
  actors: readonly ActorRuntime[],
  requestByActor: ReadonlyMap<NavigationActorId, WorldCoordinatorActorRequest>,
  issues: WorldCoordinatorIssue[],
  tick: number
): SanitizedReservation[] {
  const reservations: SanitizedReservation[] = [];
  for (const actor of actors) {
    const request = requestByActor.get(actor.id);
    if (!request) continue;
    const candidates: WorldCoordinatorReservationRequest[] = [];
    if (request.path?.destination !== undefined)
      candidates.push(...navigationDestinationReservations(request.path.destination));
    if (request.reservations !== undefined) candidates.push(...request.reservations);
    if (request.pathBlockers !== undefined) {
      for (const blocker of request.pathBlockers)
        candidates.push({ key: blocker, kind: "path-blocker", exclusive: true });
    }
    for (let order = 0; order < candidates.length; order += 1) {
      const candidate = candidates[order];
      if (!isRecord(candidate) || !isNonEmptyString(candidate.key)) {
        issues.push(
          createIssue("input-rejected", actor.id, "reservations.key", "id", "reservation key must be a string", tick)
        );
        continue;
      }
      if (!isReservationKind(candidate.kind)) {
        issues.push(
          createIssue("input-rejected", actor.id, "reservations.kind", "enum", "reservation kind is invalid", tick)
        );
        continue;
      }
      reservations.push({
        actorId: actor.id,
        key: candidate.key,
        kind: candidate.kind,
        exclusive: candidate.exclusive ?? true,
        priority: optionalFinite(candidate.priority, 0),
        order,
        ...(candidate.reason !== undefined ? { reason: candidate.reason } : {})
      });
    }
  }
  return reservations;
}

function resolveReservations(
  reservations: readonly SanitizedReservation[],
  actors: ReadonlyMap<NavigationActorId, ActorRuntime>
): ReservationResolution {
  const grantsByActor = new Map<NavigationActorId, WorldCoordinatorReservationGrant[]>();
  const denialsByActor = new Map<NavigationActorId, WorldCoordinatorReservationGrant[]>();
  const byKey = new Map<string, SanitizedReservation[]>();
  for (const reservation of reservations) {
    if (!reservation.exclusive) {
      pushGrant(grantsByActor, reservation, reservation.actorId);
      continue;
    }
    const key = reservationKey(reservation.kind, reservation.key);
    const list = byKey.get(key);
    if (list) list.push(reservation);
    else byKey.set(key, [reservation]);
  }
  for (const reservationsForKey of byKey.values()) {
    reservationsForKey.sort((a, b) => compareReservation(a, b, actors));
    const winner = reservationsForKey[0]!;
    pushGrant(grantsByActor, winner, winner.actorId);
    for (let index = 1; index < reservationsForKey.length; index += 1) {
      pushDenial(denialsByActor, reservationsForKey[index]!, winner.actorId);
    }
  }
  return { grantsByActor, denialsByActor };
}

function createNeighborMap(actors: readonly ActorRuntime[]): Map<NavigationActorId, NavigationLocalAvoidanceAgent[]> {
  const snapshots = actors.map((actor) => ({ actor, snapshot: actor.controller.snapshot() }));
  const result = new Map<NavigationActorId, NavigationLocalAvoidanceAgent[]>();
  for (const entry of snapshots) {
    const neighbors: NavigationLocalAvoidanceAgent[] = [];
    for (const other of snapshots) {
      if (entry.actor.id === other.actor.id) continue;
      neighbors.push({
        actorId: other.actor.id,
        position: cloneVec3(other.snapshot.position),
        velocity: cloneVec3(other.snapshot.velocity),
        radius: other.actor.radius,
        desiredVelocity: [0, 0, 0],
        priority: other.actor.priority
      });
    }
    result.set(entry.actor.id, neighbors);
  }
  return result;
}

function pushGrant(
  target: Map<NavigationActorId, WorldCoordinatorReservationGrant[]>,
  request: SanitizedReservation,
  holderId: NavigationActorId
): void {
  pushReservation(target, request.actorId, {
    key: request.key,
    kind: request.kind,
    granted: true,
    holderId,
    requesterId: request.actorId,
    ...(request.reason !== undefined ? { reason: request.reason } : {})
  });
}

function pushDenial(
  target: Map<NavigationActorId, WorldCoordinatorReservationGrant[]>,
  request: SanitizedReservation,
  holderId: NavigationActorId
): void {
  pushReservation(target, request.actorId, {
    key: request.key,
    kind: request.kind,
    granted: false,
    holderId,
    requesterId: request.actorId,
    ...(request.reason !== undefined ? { reason: request.reason } : {})
  });
}

function pushReservation(
  target: Map<NavigationActorId, WorldCoordinatorReservationGrant[]>,
  actorId: NavigationActorId,
  grant: WorldCoordinatorReservationGrant
): void {
  const list = target.get(actorId);
  if (list) list.push(grant);
  else target.set(actorId, [grant]);
}

function compareReservation(
  a: SanitizedReservation,
  b: SanitizedReservation,
  actors: ReadonlyMap<NavigationActorId, ActorRuntime>
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const actorA = actors.get(a.actorId)?.priority ?? 0;
  const actorB = actors.get(b.actorId)?.priority ?? 0;
  if (actorA !== actorB) return actorB - actorA;
  const actorOrder = compareActorId(a.actorId, b.actorId);
  if (actorOrder !== 0) return actorOrder;
  return a.order - b.order;
}

function reservationKey(kind: WorldCoordinatorReservationKind, key: NavigationReservationKey): string {
  return `${kind}:${key}`;
}

function cloneControllerInput(input: CharacterControllerInput): CharacterControllerInput {
  const cloned: CharacterControllerInput = {};
  if (input.movement !== undefined) {
    const movement = input.movement;
    cloned.movement = {};
    if (movement.planarDirection !== undefined) cloned.movement.planarDirection = cloneVec3(movement.planarDirection);
    if (movement.magnitude !== undefined) cloned.movement.magnitude = movement.magnitude;
    if (movement.gait !== undefined) cloned.movement.gait = movement.gait;
    if (movement.facing !== undefined) {
      cloned.movement.facing = { ...movement.facing };
      if (movement.facing.direction !== undefined)
        cloned.movement.facing.direction = cloneVec3(movement.facing.direction);
    }
  }
  if (input.posture !== undefined) cloned.posture = { ...input.posture };
  if (input.jump !== undefined) cloned.jump = { ...input.jump };
  if (input.action !== undefined) cloned.action = { ...input.action };
  return cloned;
}

function sanitizeDeltaSeconds(
  value: number,
  config: WorldCoordinatorResolvedConfig,
  issues: WorldCoordinatorIssue[],
  tick: number
): number {
  if (!Number.isFinite(value) || value < 0) {
    issues.push(
      createIssue(
        "input-rejected",
        undefined,
        "deltaSeconds",
        "finite",
        "world coordinator deltaSeconds must be finite and non-negative",
        tick
      )
    );
    return 0;
  }
  if (value > config.maxDeltaSeconds) {
    issues.push(
      createIssue(
        "bounded",
        undefined,
        "deltaSeconds",
        "max",
        "world coordinator deltaSeconds was clamped to maxDeltaSeconds",
        tick
      )
    );
    return config.maxDeltaSeconds;
  }
  return value;
}

function initialActorRandomState(
  seed: string | number,
  actorId: NavigationActorId,
  actorSeed: string | number | undefined
): number {
  return hashSeed(`${String(seed)}:${actorId}:${actorSeed === undefined ? "" : String(actorSeed)}`) || 0x6d2b79f5;
}

function nextRandomState(state: number): number {
  return (Math.imul(1664525, state >>> 0) + 1013904223) >>> 0;
}

function wrapYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let yaw = ((((value + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  if (Object.is(yaw, -0)) yaw = 0;
  return yaw;
}

function createIssue(
  type: WorldCoordinatorIssueType,
  actorId: NavigationActorId | undefined,
  field: string,
  code: string,
  message: string,
  tick: number
): WorldCoordinatorIssue {
  return { type, ...(actorId !== undefined ? { actorId } : {}), field, code, message, tick };
}

function compareActorId(a: NavigationActorId, b: NavigationActorId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function optionalFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function optionalFinitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isReservationKind(value: unknown): value is WorldCoordinatorReservationKind {
  return value === "destination" || value === "resource" || value === "path-blocker" || value === "custom";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
