import {
  type CharacterActionIntent,
  type CharacterActionKind,
  type CharacterActorId,
  type CharacterItemId,
  type CharacterSocketId
} from "./character-controller.js";
import { type Transform, clamp, cloneQuat, cloneTransform, cloneVec3 } from "./math.js";
import type { WorldCoordinatorReservationGrant, WorldCoordinatorReservationRequest } from "./world-coordinator.js";

export const CHARACTER_INTERACTIONS_SCHEMA_VERSION = 1;
export const INTERACTION_COORDINATOR_SCHEMA_VERSION = 1;

export type InteractionResourceId = string;
export type InteractionAnchorId = string;
export type InteractionCapability = string;
export type InteractionMetadataValue = string | number | boolean;
export type InteractionMetadata = Readonly<Record<string, InteractionMetadataValue>>;

export type InteractionActionKind = "pickup" | "carry" | "drop" | "equip" | "unequip" | "use" | "sit" | "stand";
export type InteractionResourceKind = "item" | "seat" | "station" | "container" | "custom";
export type InteractionAnchorKind = "approach" | "align" | "contact" | "exit" | "seat" | "use" | "drop" | "custom";
export type InteractionPhase =
  | "idle"
  | "approach"
  | "align"
  | "reach"
  | "contact"
  | "transfer"
  | "carry"
  | "equipped"
  | "use"
  | "seated"
  | "release"
  | "exit"
  | "completed"
  | "cancelled"
  | "failed";
export type InteractionOwnerMode = "held" | "carried" | "equipped" | "seated";
export type InteractionIssueType =
  | "input-rejected"
  | "invalid-resource"
  | "invalid-socket"
  | "invalid-anchor"
  | "capability"
  | "conflict"
  | "reservation-denied"
  | "interrupted"
  | "cancelled"
  | "blocked"
  | "bounded"
  | "duplicate";
export type InteractionEventType =
  | "started"
  | "phase-started"
  | "reach-window-open"
  | "reach-window-close"
  | "contact"
  | "attach"
  | "detach"
  | "ownership"
  | "use-started"
  | "use-ended"
  | "seated"
  | "standing"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

export type InteractionTimingConfig = Partial<Record<InteractionPhase, number>>;
export type InteractionReservationOwner = Readonly<{
  actorId: CharacterActorId;
  commandId: string;
  action: InteractionActionKind;
}>;
export type InteractionResourceOwner = Readonly<{
  actorId: CharacterActorId;
  mode: InteractionOwnerMode;
  commandId: string;
  socketId?: CharacterSocketId;
}>;

export type CharacterSocketDefinition = Readonly<{
  /** Opaque caller-owned socket id. The library does not bind it to a humanoid bone or Object3D. */
  id: CharacterSocketId;
  label?: string;
  tags?: readonly string[];
  localOffset?: Partial<Transform>;
  metadata?: InteractionMetadata;
}>;

export type InteractionAnchorDefinition = Readonly<{
  id: InteractionAnchorId;
  kind: InteractionAnchorKind;
  /** World/resource-space target transform supplied by the caller's world adapter. */
  transform: Partial<Transform>;
  radius?: number;
  facingYaw?: number;
  socketId?: CharacterSocketId;
  tags?: readonly string[];
  metadata?: InteractionMetadata;
}>;

export type InteractableResourceDefinition = Readonly<{
  id: InteractionResourceId;
  kind: InteractionResourceKind;
  /** Supported semantic verbs. Content-specific logic stays in the app. */
  capabilities: readonly InteractionCapability[];
  anchors?: readonly InteractionAnchorDefinition[];
  /** Fallback socket for item transfer/carry verbs when the request does not supply one. */
  defaultSocketId?: CharacterSocketId;
  /** Per-action socket preferences, still opaque to this library. */
  actionSockets?: Partial<Record<InteractionActionKind, CharacterSocketId>>;
  timings?: InteractionTimingConfig;
  metadata?: InteractionMetadata;
}>;

export type CharacterInteractionCoordinatorConfig = Readonly<{
  maxDeltaSeconds?: number;
  defaultTimings?: InteractionTimingConfig;
}>;

export type CharacterInteractionCoordinatorInput = Readonly<{
  sockets?: readonly CharacterSocketDefinition[];
  resources?: readonly InteractableResourceDefinition[];
  config?: CharacterInteractionCoordinatorConfig;
}>;

export type CharacterInteractionResolvedConfig = Readonly<{
  maxDeltaSeconds: number;
  defaultTimings: Readonly<Record<ActiveInteractionPhase, number>>;
}>;

export type InteractionActorRequest = Readonly<{
  actorId: CharacterActorId;
  /** Optional pass-through from CharacterControllerInput.action; commandId remains the de-duplication key. */
  controllerAction?: CharacterActionIntent;
  action?: InteractionActionKind;
  commandId?: string;
  resourceId?: InteractionResourceId;
  itemId?: CharacterItemId;
  socketId?: CharacterSocketId;
  priority?: number;
  cancel?: boolean;
  interrupt?: boolean | Readonly<{ reason?: string }>;
  reservationGrants?: readonly WorldCoordinatorReservationGrant[];
  timings?: InteractionTimingConfig;
}>;

export type InteractionClearanceQuery = Readonly<{
  actorId: CharacterActorId;
  resourceId: InteractionResourceId;
  commandId: string;
  action: "stand";
  tick: number;
  anchor?: InteractionAnchorOutput;
}>;

export type InteractionClearanceResult = Readonly<{
  clear: boolean;
  reason?: string;
}>;

export type InteractionClearanceAdapter = (
  query: InteractionClearanceQuery
) => InteractionClearanceResult | null | undefined;

export type InteractionUpdateOptions = Readonly<{
  clearance?: InteractionClearanceAdapter;
}>;

export type InteractionIssue = Readonly<{
  type: InteractionIssueType;
  field: string;
  code: string;
  message: string;
  tick: number;
  actorId?: CharacterActorId;
  resourceId?: InteractionResourceId;
  commandId?: string;
}>;

export type InteractionEvent = Readonly<{
  type: InteractionEventType;
  key: string;
  tick: number;
  actorId: CharacterActorId;
  action: InteractionActionKind;
  phase: InteractionPhase;
  commandId: string;
  resourceId?: InteractionResourceId;
  socketId?: CharacterSocketId;
  anchorId?: InteractionAnchorId;
  message?: string;
}>;

export type InteractionAnchorOutput = Readonly<{
  kind: InteractionAnchorKind;
  anchorId: InteractionAnchorId;
  target: Transform;
  radius: number;
  facingYaw?: number;
  socketId?: CharacterSocketId;
  metadata?: InteractionMetadata;
}>;

export type InteractionAnimationRequest = Readonly<{
  semanticId: string;
  action: InteractionActionKind;
  phase: InteractionPhase;
  commandId: string;
  resourceId: InteractionResourceId;
  socketId?: CharacterSocketId;
  durationSeconds: number;
  normalizedTime: number;
  loop: boolean;
}>;

export type InteractionReachOutput = Readonly<{
  actorId: CharacterActorId;
  resourceId: InteractionResourceId;
  action: InteractionActionKind;
  phase: InteractionPhase;
  commandId: string;
  socketId?: CharacterSocketId;
  anchorId?: InteractionAnchorId;
  target?: Transform;
  window: Readonly<{
    active: boolean;
    openedByPhase: InteractionPhase;
    closedByPhase: InteractionPhase;
    normalizedTime: number;
  }>;
}>;

export type InteractionAttachmentChange = Readonly<{
  type: "attach" | "detach";
  key: string;
  tick: number;
  actorId: CharacterActorId;
  resourceId: InteractionResourceId;
  action: InteractionActionKind;
  phase: InteractionPhase;
  commandId: string;
  socketId: CharacterSocketId;
  anchorId?: InteractionAnchorId;
}>;

export type InteractionResourceStateSnapshot = Readonly<{
  id: InteractionResourceId;
  mutationSequence: number;
  owner?: InteractionResourceOwner;
  reservation?: InteractionReservationOwner;
  use?: InteractionReservationOwner;
}>;

export type InteractionActorMachineSnapshot = Readonly<{
  actorId: CharacterActorId;
  commandId: string;
  action: InteractionActionKind;
  resourceId: InteractionResourceId;
  socketId?: CharacterSocketId;
  priority: number;
  phaseIndex: number;
  phaseElapsedSeconds: number;
  totalElapsedSeconds: number;
  phases: readonly ActiveInteractionPhase[];
  timings?: InteractionTimingConfig;
  emittedKeys: readonly string[];
  appliedKeys: readonly string[];
}>;

export type InteractionActorSnapshot = Readonly<{
  actorId: CharacterActorId;
  lastCommandId?: string;
  active?: InteractionActorMachineSnapshot;
}>;

export type InteractionCoordinatorSnapshot = Readonly<{
  schemaVersion: typeof INTERACTION_COORDINATOR_SCHEMA_VERSION;
  tick: number;
  resources: readonly InteractionResourceStateSnapshot[];
  actors: readonly InteractionActorSnapshot[];
}>;

export type InteractionActorResult = Readonly<{
  actorId: CharacterActorId;
  order: number;
  phase: InteractionPhase;
  terminal: boolean;
  action?: InteractionActionKind;
  commandId?: string;
  resourceId?: InteractionResourceId;
  socketId?: CharacterSocketId;
  progress: number;
  reservations: readonly WorldCoordinatorReservationRequest[];
  anchors: readonly InteractionAnchorOutput[];
  reach: readonly InteractionReachOutput[];
  attachments: readonly InteractionAttachmentChange[];
  animation?: InteractionAnimationRequest;
  events: readonly InteractionEvent[];
  issues: readonly InteractionIssue[];
}>;

export type InteractionUpdateResult = Readonly<{
  schemaVersion: typeof INTERACTION_COORDINATOR_SCHEMA_VERSION;
  tick: number;
  deltaSeconds: number;
  actorOrder: readonly CharacterActorId[];
  actors: readonly InteractionActorResult[];
  resources: readonly InteractionResourceStateSnapshot[];
  issues: readonly InteractionIssue[];
}>;

export type InteractionActivePhase = Exclude<InteractionPhase, "idle" | "completed" | "cancelled" | "failed">;
type ActiveInteractionPhase = InteractionActivePhase;

export type InteractionReservationRequestInput = Readonly<{
  actorId: CharacterActorId;
  action: InteractionActionKind;
  resourceId: InteractionResourceId;
  socketId?: CharacterSocketId;
  priority: number;
}>;

type ResolvedInteractionRequest = Readonly<{
  actorId: CharacterActorId;
  action: InteractionActionKind;
  commandId: string;
  resourceId: InteractionResourceId;
  socketId?: CharacterSocketId;
  priority: number;
  reservationGrants: readonly WorldCoordinatorReservationGrant[];
  timings?: InteractionTimingConfig;
}>;

type MutableResourceState = {
  id: InteractionResourceId;
  mutationSequence: number;
  owner?: InteractionResourceOwner;
  reservation?: InteractionReservationOwner;
  use?: InteractionReservationOwner;
};

type ActorRuntime = {
  actorId: CharacterActorId;
  lastCommandId?: string;
  active?: InteractionMachineRuntime;
};

type InteractionMachineRuntime = {
  actorId: CharacterActorId;
  commandId: string;
  action: InteractionActionKind;
  resourceId: InteractionResourceId;
  socketId?: CharacterSocketId;
  priority: number;
  phaseIndex: number;
  phaseElapsedSeconds: number;
  totalElapsedSeconds: number;
  phases: ActiveInteractionPhase[];
  timings?: InteractionTimingConfig;
  emittedKeys: Set<string>;
  appliedKeys: Set<string>;
};

type MutationOutput = {
  events: InteractionEvent[];
  attachments: InteractionAttachmentChange[];
  issues: InteractionIssue[];
};

const MAX_DELTA_SECONDS = 1;
const MAX_PHASE_SECONDS = 60;
const DEFAULT_TIMINGS = {
  approach: 0.1,
  align: 0.08,
  reach: 0.12,
  contact: 0.04,
  transfer: 0.06,
  carry: 0.08,
  equipped: 0.08,
  use: 0.16,
  seated: 0.12,
  release: 0.08,
  exit: 0.1
} as const satisfies Readonly<Record<ActiveInteractionPhase, number>>;

const ACTION_PHASES = {
  pickup: ["approach", "align", "reach", "contact", "transfer", "carry"],
  carry: ["approach", "align", "reach", "contact", "transfer", "carry"],
  drop: ["release", "exit"],
  equip: ["approach", "align", "reach", "contact", "transfer", "equipped"],
  unequip: ["reach", "contact", "transfer", "carry"],
  use: ["approach", "align", "reach", "contact", "use", "release", "exit"],
  sit: ["approach", "align", "reach", "seated"],
  stand: ["release", "exit"]
} as const satisfies Readonly<Record<InteractionActionKind, readonly ActiveInteractionPhase[]>>;

const ACTIVE_PHASE_SET = new Set<InteractionPhase>(Object.keys(DEFAULT_TIMINGS) as ActiveInteractionPhase[]);

export class CharacterSocketRegistry {
  private readonly sockets = new Map<CharacterSocketId, CharacterSocketDefinition>();

  constructor(sockets: readonly CharacterSocketDefinition[] = []) {
    for (const socket of sockets) this.add(socket);
  }

  add(socket: CharacterSocketDefinition): void {
    const cloned = cloneSocketDefinition(socket);
    if (this.sockets.has(cloned.id)) throw new Error(`character socket ${cloned.id} already exists`);
    this.sockets.set(cloned.id, cloned);
  }

  has(id: CharacterSocketId): boolean {
    return this.sockets.has(id);
  }

  get(id: CharacterSocketId): CharacterSocketDefinition | undefined {
    const socket = this.sockets.get(id);
    return socket ? cloneSocketDefinition(socket) : undefined;
  }

  list(): CharacterSocketDefinition[] {
    return [...this.sockets.values()]
      .sort((a, b) => compareId(a.id, b.id))
      .map((socket) => cloneSocketDefinition(socket));
  }
}

export class InteractionResourceRegistry {
  private readonly resources = new Map<InteractionResourceId, InteractableResourceDefinition>();

  constructor(resources: readonly InteractableResourceDefinition[] = []) {
    for (const resource of resources) this.add(resource);
  }

  add(resource: InteractableResourceDefinition): void {
    const cloned = cloneResourceDefinition(resource);
    if (this.resources.has(cloned.id)) throw new Error(`interaction resource ${cloned.id} already exists`);
    this.resources.set(cloned.id, cloned);
  }

  has(id: InteractionResourceId): boolean {
    return this.resources.has(id);
  }

  get(id: InteractionResourceId): InteractableResourceDefinition | undefined {
    const resource = this.resources.get(id);
    return resource ? cloneResourceDefinition(resource) : undefined;
  }

  list(): InteractableResourceDefinition[] {
    return [...this.resources.values()]
      .sort((a, b) => compareId(a.id, b.id))
      .map((resource) => cloneResourceDefinition(resource));
  }
}

export class CharacterInteractionCoordinator {
  readonly config: CharacterInteractionResolvedConfig;
  readonly sockets: CharacterSocketRegistry;
  readonly resources: InteractionResourceRegistry;
  private tick = 0;
  private readonly resourceStates = new Map<InteractionResourceId, MutableResourceState>();
  private readonly actors = new Map<CharacterActorId, ActorRuntime>();

  constructor(input: CharacterInteractionCoordinatorInput = {}) {
    if (!isRecord(input)) throw new Error("interaction coordinator input must be an object");
    this.config = resolveInteractionCoordinatorConfig(input.config ?? {});
    this.sockets = new CharacterSocketRegistry(input.sockets ?? []);
    this.resources = new InteractionResourceRegistry(input.resources ?? []);
    for (const resource of this.resources.list()) this.ensureResourceState(resource.id);
  }

  addSocket(socket: CharacterSocketDefinition): void {
    this.sockets.add(socket);
  }

  addResource(resource: InteractableResourceDefinition): void {
    this.resources.add(resource);
    this.ensureResourceState(resource.id);
  }

  resourceState(id: InteractionResourceId): InteractionResourceStateSnapshot | undefined {
    const state = this.resourceStates.get(id);
    return state ? cloneResourceState(state) : undefined;
  }

  snapshot(): InteractionCoordinatorSnapshot {
    return {
      schemaVersion: INTERACTION_COORDINATOR_SCHEMA_VERSION,
      tick: this.tick,
      resources: this.sortedResourceStates().map((state) => cloneResourceState(state)),
      actors: this.sortedActors().map((actor) => cloneActorSnapshot(actor))
    };
  }

  restore(snapshot: InteractionCoordinatorSnapshot): void {
    if (!isRecord(snapshot)) throw new Error("interaction coordinator snapshot must be an object");
    if (snapshot.schemaVersion !== INTERACTION_COORDINATOR_SCHEMA_VERSION)
      throw new Error("unsupported interaction coordinator snapshot schemaVersion");
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0)
      throw new Error("interaction coordinator snapshot tick must be a non-negative integer");
    if (!isReadonlyArray(snapshot.resources))
      throw new Error("interaction coordinator snapshot resources must be an array");
    if (!isReadonlyArray(snapshot.actors)) throw new Error("interaction coordinator snapshot actors must be an array");

    const nextResources = new Map<InteractionResourceId, MutableResourceState>();
    for (const resource of this.resources.list())
      nextResources.set(resource.id, { id: resource.id, mutationSequence: 0 });
    for (const state of snapshot.resources) {
      const cloned = mutableResourceStateFromSnapshot(state);
      if (!this.resources.has(cloned.id))
        throw new Error(`interaction snapshot resource ${cloned.id} is not registered`);
      nextResources.set(cloned.id, cloned);
    }

    const nextActors = new Map<CharacterActorId, ActorRuntime>();
    for (const actor of snapshot.actors) {
      const cloned = actorRuntimeFromSnapshot(actor);
      if (nextActors.has(cloned.actorId)) throw new Error(`interaction snapshot actor ${cloned.actorId} is duplicated`);
      nextActors.set(cloned.actorId, cloned);
    }

    validateSnapshotLocks(nextResources, nextActors);
    this.resourceStates.clear();
    for (const [id, state] of nextResources) this.resourceStates.set(id, state);
    this.actors.clear();
    for (const [id, actor] of nextActors) this.actors.set(id, actor);
    this.tick = snapshot.tick;
  }

  update(
    deltaSeconds: number,
    requests: readonly InteractionActorRequest[] = [],
    options: InteractionUpdateOptions = {}
  ): InteractionUpdateResult {
    this.tick += 1;
    const tick = this.tick;
    const issues: InteractionIssue[] = [];
    const delta = sanitizeDeltaSeconds(deltaSeconds, this.config.maxDeltaSeconds, issues, tick);
    const requestByActor = sanitizeActorRequests(requests, issues, tick);
    const resultByActor = new Map<CharacterActorId, InteractionActorResult>();

    for (const actorId of sortedUnion([...this.actors.keys()], [...requestByActor.keys()])) {
      const actor = this.ensureActor(actorId);
      const request = requestByActor.get(actorId);
      if (request?.cancel === true || request?.interrupt !== undefined) {
        const interrupted = request.interrupt !== undefined;
        const result = this.cancelActive(
          actor,
          interrupted,
          interrupted ? interruptReason(request.interrupt) : undefined,
          tick
        );
        if (result !== undefined) resultByActor.set(actorId, result);
      }
    }

    const starters: ResolvedInteractionRequest[] = [];
    for (const request of requestByActor.values()) {
      if (request.cancel === true || request.interrupt !== undefined) continue;
      const actor = this.ensureActor(request.actorId);
      if (actor.active !== undefined) {
        if (
          request.reservationGrants !== undefined &&
          hasExternalReservationDenial(actor.active, request.reservationGrants)
        ) {
          resultByActor.set(
            actor.actorId,
            this.failActive(
              actor,
              "reservation-denied",
              "reservations",
              "denied",
              "external reservation was denied",
              tick
            )
          );
        }
        continue;
      }
      const resolved = resolveInteractionRequest(request, actor, issues, tick);
      if (resolved !== undefined) starters.push(resolved);
      else if (!resultByActor.has(request.actorId)) {
        resultByActor.set(
          request.actorId,
          idleResult(request.actorId, resultByActor.size, tick, issuesForActor(issues, request.actorId))
        );
      }
    }

    starters.sort(compareResolvedRequest);
    for (const request of starters) {
      const actor = this.ensureActor(request.actorId);
      if (actor.active !== undefined) continue;
      const started = this.startInteraction(actor, request, options, tick);
      resultByActor.set(actor.actorId, started);
    }

    for (const actor of this.sortedActors()) {
      if (actor.active === undefined) continue;
      if (resultByActor.has(actor.actorId)) continue;
      resultByActor.set(actor.actorId, this.advanceActive(actor, delta, tick));
    }

    const actorIds = sortedUnion([...requestByActor.keys()], [...resultByActor.keys()]);
    const actorResults = actorIds.map((actorId, order) =>
      withOrder(resultByActor.get(actorId) ?? idleResult(actorId, order, tick, []), order)
    );
    return {
      schemaVersion: INTERACTION_COORDINATOR_SCHEMA_VERSION,
      tick,
      deltaSeconds: delta,
      actorOrder: actorIds,
      actors: actorResults,
      resources: this.sortedResourceStates().map((state) => cloneResourceState(state)),
      issues: mergeResultIssues(issues, actorResults)
    };
  }

  private ensureActor(actorId: CharacterActorId): ActorRuntime {
    const existing = this.actors.get(actorId);
    if (existing) return existing;
    const actor = { actorId } satisfies ActorRuntime;
    this.actors.set(actorId, actor);
    return actor;
  }

  private ensureResourceState(resourceId: InteractionResourceId): MutableResourceState {
    const existing = this.resourceStates.get(resourceId);
    if (existing) return existing;
    const state = { id: resourceId, mutationSequence: 0 } satisfies MutableResourceState;
    this.resourceStates.set(resourceId, state);
    return state;
  }

  private sortedActors(): ActorRuntime[] {
    return [...this.actors.values()].sort((a, b) => compareId(a.actorId, b.actorId));
  }

  private sortedResourceStates(): MutableResourceState[] {
    return [...this.resourceStates.values()].sort((a, b) => compareId(a.id, b.id));
  }

  private startInteraction(
    actor: ActorRuntime,
    request: ResolvedInteractionRequest,
    options: InteractionUpdateOptions,
    tick: number
  ): InteractionActorResult {
    const localIssues: InteractionIssue[] = [];
    const resource = this.resources.get(request.resourceId);
    if (resource === undefined) {
      localIssues.push(
        createIssue(
          "invalid-resource",
          request.actorId,
          request.resourceId,
          request.commandId,
          "resourceId",
          "missing",
          "interaction resource is not registered",
          tick
        )
      );
      return terminalStartResult(request, "failed", tick, localIssues);
    }
    const socketId = resolveSocketId(request, resource);
    const validationIssue = this.validateStart(request, resource, socketId, options, tick);
    if (validationIssue !== undefined)
      return terminalStartResult({ ...request, ...(socketId !== undefined ? { socketId } : {}) }, "failed", tick, [
        validationIssue
      ]);

    const phases = [...ACTION_PHASES[request.action]];
    const machine: InteractionMachineRuntime = {
      actorId: request.actorId,
      commandId: request.commandId,
      action: request.action,
      resourceId: request.resourceId,
      ...(socketId !== undefined ? { socketId } : {}),
      priority: request.priority,
      phaseIndex: 0,
      phaseElapsedSeconds: 0,
      totalElapsedSeconds: 0,
      phases,
      ...(request.timings !== undefined
        ? { timings: cloneTimingConfig(request.timings, `interaction request ${request.commandId}`) }
        : {}),
      emittedKeys: new Set<string>(),
      appliedKeys: new Set<string>()
    };
    actor.active = machine;
    const resourceState = this.ensureResourceState(machine.resourceId);
    resourceState.reservation = {
      actorId: machine.actorId,
      commandId: machine.commandId,
      action: machine.action
    };
    bumpResourceState(resourceState);

    const output: MutationOutput = { events: [], attachments: [], issues: [] };
    emitOnce(machine, "started", currentPhase(machine), tick, output.events);
    this.enterPhase(machine, currentPhase(machine), tick, output);
    return this.buildActiveResult(actor, tick, output);
  }

  private validateStart(
    request: ResolvedInteractionRequest,
    resource: InteractableResourceDefinition,
    socketId: CharacterSocketId | undefined,
    options: InteractionUpdateOptions,
    tick: number
  ): InteractionIssue | undefined {
    if (!resource.capabilities.includes(request.action)) {
      return createIssue(
        "capability",
        request.actorId,
        resource.id,
        request.commandId,
        "action",
        "unsupported",
        "resource does not support interaction action",
        tick
      );
    }
    if (hasExternalReservationDenialFor(request, resource.id, socketId)) {
      return createIssue(
        "reservation-denied",
        request.actorId,
        resource.id,
        request.commandId,
        "reservations",
        "denied",
        "external reservation was denied",
        tick
      );
    }
    if (socketId !== undefined && !this.sockets.has(socketId)) {
      return createIssue(
        "invalid-socket",
        request.actorId,
        resource.id,
        request.commandId,
        "socketId",
        "missing",
        "interaction socket is not registered",
        tick
      );
    }
    const anchorIssue = validateRequiredAnchors(request, resource, tick);
    if (anchorIssue !== undefined) return anchorIssue;
    const state = this.ensureResourceState(resource.id);
    if (state.reservation !== undefined && state.reservation.actorId !== request.actorId) {
      return createIssue(
        "conflict",
        request.actorId,
        resource.id,
        request.commandId,
        "resourceId",
        "reserved",
        `resource is reserved by actor ${state.reservation.actorId}`,
        tick
      );
    }
    if (state.use !== undefined && state.use.actorId !== request.actorId) {
      return createIssue(
        "conflict",
        request.actorId,
        resource.id,
        request.commandId,
        "resourceId",
        "in-use",
        `resource is used by actor ${state.use.actorId}`,
        tick
      );
    }
    if (request.action === "sit") {
      const seatedResourceId = this.findActorSeatedResource(request.actorId, resource.id);
      if (seatedResourceId !== undefined) {
        return createIssue(
          "conflict",
          request.actorId,
          resource.id,
          request.commandId,
          "resourceId",
          "already-seated",
          `actor is already seated on resource ${seatedResourceId}`,
          tick
        );
      }
    }
    if (socketId !== undefined && actionAttachesToSocket(request.action)) {
      const socketOwner = this.findSocketOwner(request.actorId, socketId, resource.id);
      if (socketOwner !== undefined) {
        return createIssue(
          "conflict",
          request.actorId,
          resource.id,
          request.commandId,
          "socketId",
          "socket-owned",
          `socket ${socketId} already owns resource ${socketOwner}`,
          tick
        );
      }
    }

    if (request.action === "drop" || request.action === "unequip") {
      if (state.owner?.actorId !== request.actorId) {
        return createIssue(
          "conflict",
          request.actorId,
          resource.id,
          request.commandId,
          "resourceId",
          "not-owner",
          "actor does not own the requested item",
          tick
        );
      }
      if (state.owner.socketId === undefined) {
        return createIssue(
          "invalid-socket",
          request.actorId,
          resource.id,
          request.commandId,
          "socketId",
          "missing-owner-socket",
          "owned item has no socket to detach",
          tick
        );
      }
    } else if (request.action === "stand") {
      if (state.owner?.actorId !== request.actorId || state.owner.mode !== "seated") {
        return createIssue(
          "conflict",
          request.actorId,
          resource.id,
          request.commandId,
          "resourceId",
          "not-seated",
          "actor is not seated on the requested resource",
          tick
        );
      }
      const clearance = options.clearance?.({
        actorId: request.actorId,
        resourceId: resource.id,
        commandId: request.commandId,
        action: "stand",
        tick,
        ...anchorForOutput(resource, "exit")
      });
      if (clearance?.clear === false) {
        return createIssue(
          "blocked",
          request.actorId,
          resource.id,
          request.commandId,
          "clearance",
          "blocked",
          clearance.reason ?? "stand clearance adapter blocked exit",
          tick
        );
      }
    } else if (state.owner !== undefined && state.owner.actorId !== request.actorId) {
      return createIssue(
        "conflict",
        request.actorId,
        resource.id,
        request.commandId,
        "resourceId",
        "owned",
        `resource is owned by actor ${state.owner.actorId}`,
        tick
      );
    }

    if (
      (request.action === "pickup" ||
        request.action === "carry" ||
        request.action === "equip" ||
        request.action === "unequip") &&
      socketId === undefined
    ) {
      return createIssue(
        "invalid-socket",
        request.actorId,
        resource.id,
        request.commandId,
        "socketId",
        "missing",
        "interaction action requires a socket id",
        tick
      );
    }
    return undefined;
  }

  private findSocketOwner(
    actorId: CharacterActorId,
    socketId: CharacterSocketId,
    excludingResourceId: InteractionResourceId
  ): InteractionResourceId | undefined {
    for (const state of this.sortedResourceStates()) {
      if (state.id === excludingResourceId) continue;
      if (state.owner?.actorId === actorId && state.owner.socketId === socketId) return state.id;
    }
    return undefined;
  }

  private findActorSeatedResource(
    actorId: CharacterActorId,
    excludingResourceId: InteractionResourceId
  ): InteractionResourceId | undefined {
    for (const state of this.sortedResourceStates()) {
      if (state.id === excludingResourceId) continue;
      if (state.owner?.actorId === actorId && state.owner.mode === "seated") return state.id;
    }
    return undefined;
  }

  private advanceActive(actor: ActorRuntime, deltaSeconds: number, tick: number): InteractionActorResult {
    const machine = actor.active;
    if (machine === undefined) return idleResult(actor.actorId, 0, tick, []);
    const output: MutationOutput = { events: [], attachments: [], issues: [] };
    let remaining = deltaSeconds;
    let guard = 0;
    while (remaining >= 0 && actor.active !== undefined && guard < machine.phases.length + 2) {
      guard += 1;
      const phase = currentPhase(machine);
      const duration = this.phaseDuration(machine, phase);
      if (duration <= 0) {
        if (machine.phaseIndex + 1 >= machine.phases.length) {
          return this.completeActive(actor, tick, output);
        }
        machine.phaseIndex += 1;
        machine.phaseElapsedSeconds = 0;
        this.enterPhase(machine, currentPhase(machine), tick, output);
        continue;
      }
      const available = Math.max(0, duration - machine.phaseElapsedSeconds);
      if (remaining + 1e-12 < available) {
        machine.phaseElapsedSeconds += remaining;
        machine.totalElapsedSeconds += remaining;
        remaining = -1;
      } else {
        machine.phaseElapsedSeconds = duration;
        machine.totalElapsedSeconds += available;
        remaining -= available;
        if (machine.phaseIndex + 1 >= machine.phases.length) {
          return this.completeActive(actor, tick, output);
        }
        machine.phaseIndex += 1;
        machine.phaseElapsedSeconds = 0;
        this.enterPhase(machine, currentPhase(machine), tick, output);
      }
    }
    if (guard >= machine.phases.length + 2) {
      output.issues.push(
        createIssue(
          "bounded",
          machine.actorId,
          machine.resourceId,
          machine.commandId,
          "phases",
          "guard",
          "interaction phase advancement was bounded",
          tick
        )
      );
    }
    return this.buildActiveResult(actor, tick, output);
  }

  private enterPhase(
    machine: InteractionMachineRuntime,
    phase: ActiveInteractionPhase,
    tick: number,
    output: MutationOutput
  ): void {
    emitOnce(machine, "phase-started", phase, tick, output.events);
    if (phase === "reach") emitOnce(machine, "reach-window-open", phase, tick, output.events);
    if (phase === "contact") {
      emitOnce(machine, "contact", phase, tick, output.events);
      emitOnce(machine, "reach-window-close", phase, tick, output.events);
    }
    this.applyPhaseMutation(machine, phase, tick, output);
  }

  private applyPhaseMutation(
    machine: InteractionMachineRuntime,
    phase: ActiveInteractionPhase,
    tick: number,
    output: MutationOutput
  ): void {
    const key = `${machine.commandId}:mutation:${phase}`;
    if (machine.appliedKeys.has(key)) return;
    machine.appliedKeys.add(key);
    const state = this.ensureResourceState(machine.resourceId);
    const currentOwner = state.owner;
    const contactAnchorId = this.resources
      .get(machine.resourceId)
      ?.anchors?.find((anchor) => anchor.kind === "contact")?.id;

    if (
      (machine.action === "pickup" || machine.action === "carry") &&
      phase === "contact" &&
      currentOwner === undefined
    ) {
      if (machine.socketId !== undefined) {
        state.owner = {
          actorId: machine.actorId,
          mode: "held",
          commandId: machine.commandId,
          socketId: machine.socketId
        };
        bumpResourceState(state);
        pushAttach(machine, phase, tick, machine.socketId, contactAnchorId, output);
        emitOnce(machine, "ownership", phase, tick, output.events, "held");
      }
    }
    if (
      (machine.action === "pickup" || machine.action === "carry") &&
      phase === "transfer" &&
      state.owner?.actorId === machine.actorId
    ) {
      state.owner = {
        actorId: machine.actorId,
        mode: "carried",
        commandId: machine.commandId,
        ...(state.owner.socketId !== undefined ? { socketId: state.owner.socketId } : {})
      };
      bumpResourceState(state);
      emitOnce(machine, "ownership", phase, tick, output.events, "carried");
    }

    if (
      machine.action === "equip" &&
      phase === "contact" &&
      currentOwner?.actorId === machine.actorId &&
      currentOwner.socketId !== undefined &&
      currentOwner.socketId !== machine.socketId
    ) {
      pushDetach(machine, phase, tick, currentOwner.socketId, contactAnchorId, output);
      state.owner = { actorId: machine.actorId, mode: "held", commandId: machine.commandId };
      bumpResourceState(state);
    }
    if (machine.action === "equip" && phase === "transfer" && machine.socketId !== undefined) {
      const alreadyAttached = state.owner?.actorId === machine.actorId && state.owner.socketId === machine.socketId;
      state.owner = {
        actorId: machine.actorId,
        mode: "equipped",
        commandId: machine.commandId,
        socketId: machine.socketId
      };
      bumpResourceState(state);
      if (!alreadyAttached) pushAttach(machine, phase, tick, machine.socketId, contactAnchorId, output);
      emitOnce(machine, "ownership", phase, tick, output.events, "equipped");
    }

    if (
      machine.action === "unequip" &&
      phase === "contact" &&
      currentOwner?.actorId === machine.actorId &&
      currentOwner.socketId !== undefined
    ) {
      pushDetach(machine, phase, tick, currentOwner.socketId, contactAnchorId, output);
      state.owner = { actorId: machine.actorId, mode: "held", commandId: machine.commandId };
      bumpResourceState(state);
    }
    if (machine.action === "unequip" && phase === "transfer" && machine.socketId !== undefined) {
      state.owner = {
        actorId: machine.actorId,
        mode: "carried",
        commandId: machine.commandId,
        socketId: machine.socketId
      };
      bumpResourceState(state);
      pushAttach(machine, phase, tick, machine.socketId, contactAnchorId, output);
      emitOnce(machine, "ownership", phase, tick, output.events, "carried");
    }

    if (
      machine.action === "drop" &&
      phase === "release" &&
      currentOwner?.actorId === machine.actorId &&
      currentOwner.socketId !== undefined
    ) {
      pushDetach(machine, phase, tick, currentOwner.socketId, contactAnchorId, output);
      delete state.owner;
      bumpResourceState(state);
      emitOnce(machine, "ownership", phase, tick, output.events, "released");
    }

    if (machine.action === "use" && phase === "contact") {
      state.use = { actorId: machine.actorId, commandId: machine.commandId, action: machine.action };
      bumpResourceState(state);
      emitOnce(machine, "use-started", phase, tick, output.events);
    }
    if (machine.action === "use" && phase === "release" && state.use?.actorId === machine.actorId) {
      delete state.use;
      bumpResourceState(state);
      emitOnce(machine, "use-ended", phase, tick, output.events);
    }

    if (machine.action === "sit" && phase === "seated") {
      state.owner = { actorId: machine.actorId, mode: "seated", commandId: machine.commandId };
      bumpResourceState(state);
      emitOnce(machine, "seated", phase, tick, output.events);
      emitOnce(machine, "ownership", phase, tick, output.events, "seated");
    }

    if (
      machine.action === "stand" &&
      phase === "release" &&
      currentOwner?.actorId === machine.actorId &&
      currentOwner.mode === "seated"
    ) {
      delete state.owner;
      bumpResourceState(state);
      emitOnce(machine, "standing", phase, tick, output.events);
      emitOnce(machine, "ownership", phase, tick, output.events, "standing");
    }
  }

  private completeActive(actor: ActorRuntime, tick: number, output: MutationOutput): InteractionActorResult {
    const machine = actor.active;
    if (machine === undefined) return idleResult(actor.actorId, 0, tick, []);
    emitOnce(machine, "completed", "completed", tick, output.events);
    this.releaseReservation(machine);
    actor.lastCommandId = machine.commandId;
    const result = this.buildTerminalResult(machine, "completed", tick, output);
    delete actor.active;
    return result;
  }

  private cancelActive(
    actor: ActorRuntime,
    interrupted: boolean,
    reason: string | undefined,
    tick: number
  ): InteractionActorResult | undefined {
    const machine = actor.active;
    if (machine === undefined) return undefined;
    const output: MutationOutput = { events: [], attachments: [], issues: [] };
    const eventType: InteractionEventType = interrupted ? "interrupted" : "cancelled";
    emitOnce(machine, eventType, "cancelled", tick, output.events, reason);
    output.issues.push(
      createIssue(
        interrupted ? "interrupted" : "cancelled",
        machine.actorId,
        machine.resourceId,
        machine.commandId,
        "commandId",
        eventType,
        reason ?? `interaction ${eventType}`,
        tick
      )
    );
    this.clearTransientUse(machine);
    this.releaseReservation(machine);
    actor.lastCommandId = machine.commandId;
    const result = this.buildTerminalResult(machine, "cancelled", tick, output);
    delete actor.active;
    return result;
  }

  private failActive(
    actor: ActorRuntime,
    type: InteractionIssueType,
    field: string,
    code: string,
    message: string,
    tick: number
  ): InteractionActorResult {
    const machine = actor.active;
    if (machine === undefined) return idleResult(actor.actorId, 0, tick, []);
    const output: MutationOutput = { events: [], attachments: [], issues: [] };
    output.issues.push(
      createIssue(type, machine.actorId, machine.resourceId, machine.commandId, field, code, message, tick)
    );
    emitOnce(machine, "failed", "failed", tick, output.events, message);
    this.clearTransientUse(machine);
    this.releaseReservation(machine);
    actor.lastCommandId = machine.commandId;
    const result = this.buildTerminalResult(machine, "failed", tick, output);
    delete actor.active;
    return result;
  }

  private clearTransientUse(machine: InteractionMachineRuntime): void {
    const state = this.ensureResourceState(machine.resourceId);
    if (state.use?.actorId === machine.actorId && state.use.commandId === machine.commandId) {
      delete state.use;
      bumpResourceState(state);
    }
  }

  private releaseReservation(machine: InteractionMachineRuntime): void {
    const state = this.ensureResourceState(machine.resourceId);
    if (state.reservation?.actorId === machine.actorId && state.reservation.commandId === machine.commandId) {
      delete state.reservation;
      bumpResourceState(state);
    }
  }

  private buildActiveResult(actor: ActorRuntime, tick: number, output: MutationOutput): InteractionActorResult {
    const machine = actor.active;
    if (machine === undefined) return idleResult(actor.actorId, 0, tick, output.issues);
    const phase = currentPhase(machine);
    const resource = this.resources.get(machine.resourceId);
    const duration = this.phaseDuration(machine, phase);
    const normalizedTime = duration > 0 ? clamp(machine.phaseElapsedSeconds / duration, 0, 1) : 1;
    return {
      actorId: machine.actorId,
      order: 0,
      phase,
      terminal: false,
      action: machine.action,
      commandId: machine.commandId,
      resourceId: machine.resourceId,
      ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
      progress: normalizedTime,
      reservations: createInteractionReservationRequests(machine),
      anchors: resource ? anchorsForPhase(resource, phase) : [],
      reach: resource ? reachForPhase(machine, resource, phase, normalizedTime) : [],
      attachments: output.attachments,
      animation: {
        semanticId: `interaction.${machine.action}.${phase}`,
        action: machine.action,
        phase,
        commandId: machine.commandId,
        resourceId: machine.resourceId,
        ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
        durationSeconds: duration,
        normalizedTime,
        loop: isLoopHintPhase(phase)
      },
      events: output.events,
      issues: output.issues
    };
  }

  private buildTerminalResult(
    machine: InteractionMachineRuntime,
    phase: "completed" | "cancelled" | "failed",
    tick: number,
    output: MutationOutput
  ): InteractionActorResult {
    void tick;
    return {
      actorId: machine.actorId,
      order: 0,
      phase,
      terminal: true,
      action: machine.action,
      commandId: machine.commandId,
      resourceId: machine.resourceId,
      ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
      progress: 1,
      reservations: [],
      anchors: [],
      reach: [],
      attachments: output.attachments,
      events: output.events,
      issues: output.issues
    };
  }

  private phaseDuration(machine: InteractionMachineRuntime, phase: ActiveInteractionPhase): number {
    const resource = this.resources.get(machine.resourceId);
    const requestTiming = machine.timings?.[phase];
    const resourceTiming = resource?.timings?.[phase];
    return sanitizePhaseDuration(
      requestTiming ?? resourceTiming ?? this.config.defaultTimings[phase],
      this.config.defaultTimings[phase]
    );
  }
}

export function resolveInteractionCoordinatorConfig(
  config: CharacterInteractionCoordinatorConfig = {}
): CharacterInteractionResolvedConfig {
  if (!isRecord(config)) throw new Error("interaction coordinator config must be an object");
  const defaultTimings: Record<ActiveInteractionPhase, number> = { ...DEFAULT_TIMINGS };
  if (config.defaultTimings !== undefined) {
    for (const phase of Object.keys(config.defaultTimings)) {
      if (!isActivePhase(phase)) throw new Error(`interaction timing phase ${phase} is not active`);
      defaultTimings[phase] = sanitizeStrictDuration(config.defaultTimings[phase], `interaction timing ${phase}`);
    }
  }
  return Object.freeze({
    maxDeltaSeconds: sanitizePositive(config.maxDeltaSeconds, 0.25, MAX_DELTA_SECONDS),
    defaultTimings: Object.freeze(defaultTimings)
  });
}

export function interactionResourceReservationKey(resourceId: InteractionResourceId): string {
  if (!isNonEmptyString(resourceId)) throw new Error("interaction resource reservation id must be a non-empty string");
  return `interaction:resource:${resourceId}`;
}

export function interactionSocketReservationKey(actorId: CharacterActorId, socketId: CharacterSocketId): string {
  if (!isNonEmptyString(actorId)) throw new Error("interaction socket reservation actor id must be a non-empty string");
  if (!isNonEmptyString(socketId))
    throw new Error("interaction socket reservation socket id must be a non-empty string");
  return `interaction:socket:${actorId}:${socketId}`;
}

export function createInteractionReservationRequests(
  input: InteractionReservationRequestInput
): WorldCoordinatorReservationRequest[] {
  const reservations: WorldCoordinatorReservationRequest[] = [
    {
      key: interactionResourceReservationKey(input.resourceId),
      kind: "resource",
      exclusive: true,
      priority: input.priority,
      reason: `interaction:${input.action}`
    }
  ];
  if (input.socketId !== undefined) {
    reservations.push({
      key: interactionSocketReservationKey(input.actorId, input.socketId),
      kind: "custom",
      exclusive: true,
      priority: input.priority,
      reason: `interaction:${input.action}:socket`
    });
  }
  return reservations;
}

export function interactionRequestFromControllerAction(
  actorId: CharacterActorId,
  action: CharacterActionIntent,
  options: Omit<
    InteractionActorRequest,
    "actorId" | "controllerAction" | "action" | "commandId" | "resourceId" | "itemId" | "socketId"
  > = {}
): InteractionActorRequest {
  if (!isSupportedControllerAction(action.kind)) {
    throw new Error(`controller action kind ${action.kind} is not supported by interaction coordinator`);
  }
  const resourceId = action.itemId ?? action.interactionId;
  return {
    ...options,
    actorId,
    controllerAction: action,
    action: action.kind,
    commandId: action.commandId,
    ...(resourceId !== undefined ? { resourceId } : {}),
    ...(action.itemId !== undefined ? { itemId: action.itemId } : {}),
    ...(action.socketId !== undefined ? { socketId: action.socketId } : {})
  };
}

function sanitizeActorRequests(
  requests: readonly InteractionActorRequest[],
  issues: InteractionIssue[],
  tick: number
): Map<CharacterActorId, InteractionActorRequest> {
  const byActor = new Map<CharacterActorId, InteractionActorRequest>();
  if (!isReadonlyArray(requests)) {
    issues.push(
      createIssue(
        "input-rejected",
        undefined,
        undefined,
        undefined,
        "requests",
        "type",
        "interaction requests must be an array",
        tick
      )
    );
    return byActor;
  }
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (!isRecord(request) || !isNonEmptyString(request.actorId)) {
      issues.push(
        createIssue(
          "input-rejected",
          undefined,
          undefined,
          undefined,
          `requests[${index}].actorId`,
          "id",
          "interaction request actorId must be a string",
          tick
        )
      );
      continue;
    }
    const actorId = request.actorId;
    const commandId = typeof request.commandId === "string" ? request.commandId : undefined;
    if (byActor.has(actorId)) {
      issues.push(
        createIssue(
          "duplicate",
          actorId,
          undefined,
          commandId,
          `requests[${index}].actorId`,
          "duplicate",
          "duplicate interaction request ignored",
          tick
        )
      );
      continue;
    }
    byActor.set(actorId, request);
  }
  return byActor;
}

function resolveInteractionRequest(
  request: InteractionActorRequest,
  actor: ActorRuntime,
  issues: InteractionIssue[],
  tick: number
): ResolvedInteractionRequest | undefined {
  const action = request.action ?? controllerActionToInteraction(request.controllerAction?.kind);
  const commandId = request.commandId ?? request.controllerAction?.commandId;
  const resourceId =
    request.resourceId ??
    request.itemId ??
    request.controllerAction?.itemId ??
    request.controllerAction?.interactionId ??
    inferActorResource(actor, action);
  if (!isSupportedInteractionAction(action)) {
    issues.push(
      createIssue(
        "input-rejected",
        request.actorId,
        undefined,
        commandId,
        "action",
        "enum",
        "interaction action is required and must be supported",
        tick
      )
    );
    return undefined;
  }
  if (!isNonEmptyString(commandId)) {
    issues.push(
      createIssue(
        "input-rejected",
        request.actorId,
        resourceId,
        undefined,
        "commandId",
        "id",
        "interaction commandId must be a non-empty string",
        tick
      )
    );
    return undefined;
  }
  if (actor.lastCommandId === commandId) {
    issues.push(
      createIssue(
        "duplicate",
        request.actorId,
        resourceId,
        commandId,
        "commandId",
        "duplicate",
        "interaction command was already completed",
        tick
      )
    );
    return undefined;
  }
  if (!isNonEmptyString(resourceId)) {
    issues.push(
      createIssue(
        "input-rejected",
        request.actorId,
        undefined,
        commandId,
        "resourceId",
        "id",
        "interaction resourceId must be a non-empty string",
        tick
      )
    );
    return undefined;
  }
  const socketId = request.socketId ?? request.controllerAction?.socketId;
  if (socketId !== undefined && !isNonEmptyString(socketId)) {
    issues.push(
      createIssue(
        "invalid-socket",
        request.actorId,
        resourceId,
        commandId,
        "socketId",
        "id",
        "interaction socketId must be a non-empty string",
        tick
      )
    );
    return undefined;
  }
  return {
    actorId: request.actorId,
    action,
    commandId,
    resourceId,
    ...(socketId !== undefined ? { socketId } : {}),
    priority: optionalFinite(request.priority, 0),
    reservationGrants: request.reservationGrants ?? [],
    ...(request.timings !== undefined ? { timings: request.timings } : {})
  };
}

function inferActorResource(
  actor: ActorRuntime,
  action: InteractionActionKind | undefined
): InteractionResourceId | undefined {
  if (action === undefined) return undefined;
  if (action === "stand") return actor.active?.resourceId;
  return undefined;
}

function resolveSocketId(
  request: ResolvedInteractionRequest,
  resource: InteractableResourceDefinition
): CharacterSocketId | undefined {
  return request.socketId ?? resource.actionSockets?.[request.action] ?? resource.defaultSocketId;
}

function validateRequiredAnchors(
  request: ResolvedInteractionRequest,
  resource: InteractableResourceDefinition,
  tick: number
): InteractionIssue | undefined {
  const requireContact = request.action !== "drop" && request.action !== "stand";
  if (requireContact && anchorFor(resource, request.action === "sit" ? "seat" : "contact") === undefined) {
    return createIssue(
      "invalid-anchor",
      request.actorId,
      resource.id,
      request.commandId,
      "anchors",
      "missing",
      "interaction resource is missing required contact/seat anchor",
      tick
    );
  }
  if ((request.action === "drop" || request.action === "stand") && anchorFor(resource, "exit") === undefined) {
    return createIssue(
      "invalid-anchor",
      request.actorId,
      resource.id,
      request.commandId,
      "anchors",
      "missing-exit",
      "interaction resource is missing required exit anchor",
      tick
    );
  }
  return undefined;
}

function hasExternalReservationDenialFor(
  request: ResolvedInteractionRequest,
  resourceId: InteractionResourceId,
  socketId: CharacterSocketId | undefined
): boolean {
  const keys = new Set([resourceId, interactionResourceReservationKey(resourceId)]);
  if (socketId !== undefined) keys.add(interactionSocketReservationKey(request.actorId, socketId));
  return request.reservationGrants.some((grant) => grant.granted === false && keys.has(grant.key));
}

function hasExternalReservationDenial(
  machine: InteractionMachineRuntime,
  grants: readonly WorldCoordinatorReservationGrant[]
): boolean {
  const keys = new Set([machine.resourceId, interactionResourceReservationKey(machine.resourceId)]);
  if (machine.socketId !== undefined) keys.add(interactionSocketReservationKey(machine.actorId, machine.socketId));
  return grants.some((grant) => grant.granted === false && keys.has(grant.key));
}

function terminalStartResult(
  request: ResolvedInteractionRequest,
  phase: "failed" | "cancelled",
  tick: number,
  issues: readonly InteractionIssue[]
): InteractionActorResult {
  const eventType: InteractionEventType = phase === "failed" ? "failed" : "cancelled";
  return {
    actorId: request.actorId,
    order: 0,
    phase,
    terminal: true,
    action: request.action,
    commandId: request.commandId,
    resourceId: request.resourceId,
    ...(request.socketId !== undefined ? { socketId: request.socketId } : {}),
    progress: 1,
    reservations: createInteractionReservationRequests(request),
    anchors: [],
    reach: [],
    attachments: [],
    events: [eventFor(request, eventType, phase, tick, issues[0]?.message)],
    issues
  };
}

function idleResult(
  actorId: CharacterActorId,
  order: number,
  tick: number,
  issues: readonly InteractionIssue[]
): InteractionActorResult {
  void tick;
  return {
    actorId,
    order,
    phase: "idle",
    terminal: false,
    progress: 0,
    reservations: [],
    anchors: [],
    reach: [],
    attachments: [],
    events: [],
    issues
  };
}

function withOrder(result: InteractionActorResult, order: number): InteractionActorResult {
  return { ...result, order };
}

function mergeResultIssues(
  issues: readonly InteractionIssue[],
  actorResults: readonly InteractionActorResult[]
): InteractionIssue[] {
  const merged = [...issues];
  const seen = new Set(issues.map(issueIdentity));
  for (const result of actorResults) {
    for (const issue of result.issues) {
      const key = issueIdentity(issue);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(issue);
      }
    }
  }
  return merged;
}

function issueIdentity(issue: InteractionIssue): string {
  return `${issue.tick}:${issue.type}:${issue.actorId ?? ""}:${issue.resourceId ?? ""}:${issue.commandId ?? ""}:${issue.field}:${issue.code}:${issue.message}`;
}

function currentPhase(machine: InteractionMachineRuntime): ActiveInteractionPhase {
  return machine.phases[machine.phaseIndex] ?? machine.phases[machine.phases.length - 1] ?? "exit";
}

function emitOnce(
  machine: InteractionMachineRuntime,
  type: InteractionEventType,
  phase: InteractionPhase,
  tick: number,
  events: InteractionEvent[],
  message?: string
): void {
  const key = eventKey(machine, type, phase, message);
  if (machine.emittedKeys.has(key)) return;
  machine.emittedKeys.add(key);
  events.push({
    type,
    key,
    tick,
    actorId: machine.actorId,
    action: machine.action,
    phase,
    commandId: machine.commandId,
    resourceId: machine.resourceId,
    ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
    ...(message !== undefined ? { message } : {})
  });
}

function eventFor(
  request: ResolvedInteractionRequest,
  type: InteractionEventType,
  phase: InteractionPhase,
  tick: number,
  message?: string
): InteractionEvent {
  const key = `${request.commandId}:${type}:${phase}:${request.resourceId}:${request.socketId ?? ""}:${message ?? ""}`;
  return {
    type,
    key,
    tick,
    actorId: request.actorId,
    action: request.action,
    phase,
    commandId: request.commandId,
    resourceId: request.resourceId,
    ...(request.socketId !== undefined ? { socketId: request.socketId } : {}),
    ...(message !== undefined ? { message } : {})
  };
}

function eventKey(
  machine: InteractionMachineRuntime,
  type: InteractionEventType,
  phase: InteractionPhase,
  message?: string
): string {
  return `${machine.commandId}:${type}:${phase}:${machine.resourceId}:${machine.socketId ?? ""}:${message ?? ""}`;
}

function pushAttach(
  machine: InteractionMachineRuntime,
  phase: ActiveInteractionPhase,
  tick: number,
  socketId: CharacterSocketId,
  anchorId: InteractionAnchorId | undefined,
  output: MutationOutput
): void {
  const key = `${machine.commandId}:attach:${machine.resourceId}:${socketId}:${phase}`;
  output.attachments.push({
    type: "attach",
    key,
    tick,
    actorId: machine.actorId,
    resourceId: machine.resourceId,
    action: machine.action,
    phase,
    commandId: machine.commandId,
    socketId,
    ...(anchorId !== undefined ? { anchorId } : {})
  });
  emitOnce(machine, "attach", phase, tick, output.events, socketId);
}

function pushDetach(
  machine: InteractionMachineRuntime,
  phase: ActiveInteractionPhase,
  tick: number,
  socketId: CharacterSocketId,
  anchorId: InteractionAnchorId | undefined,
  output: MutationOutput
): void {
  const key = `${machine.commandId}:detach:${machine.resourceId}:${socketId}:${phase}`;
  output.attachments.push({
    type: "detach",
    key,
    tick,
    actorId: machine.actorId,
    resourceId: machine.resourceId,
    action: machine.action,
    phase,
    commandId: machine.commandId,
    socketId,
    ...(anchorId !== undefined ? { anchorId } : {})
  });
  emitOnce(machine, "detach", phase, tick, output.events, socketId);
}

function anchorsForPhase(
  resource: InteractableResourceDefinition,
  phase: ActiveInteractionPhase
): InteractionAnchorOutput[] {
  const kind = phaseToAnchorKind(phase);
  const output = anchorForOutput(resource, kind).anchor;
  return output ? [output] : [];
}

function anchorForOutput(
  resource: InteractableResourceDefinition,
  kind: InteractionAnchorKind
): { anchor?: InteractionAnchorOutput } {
  const anchor = anchorFor(resource, kind);
  return anchor ? { anchor: cloneAnchorOutput(anchor) } : {};
}

function anchorFor(
  resource: InteractableResourceDefinition,
  kind: InteractionAnchorKind
): InteractionAnchorDefinition | undefined {
  const anchors = resource.anchors ?? [];
  return (
    anchors.find((anchor) => anchor.kind === kind) ??
    (kind === "seat" ? anchors.find((anchor) => anchor.kind === "contact") : undefined)
  );
}

function cloneAnchorOutput(anchor: InteractionAnchorDefinition): InteractionAnchorOutput {
  return {
    kind: anchor.kind,
    anchorId: anchor.id,
    target: strictCloneTransform(anchor.transform, `interaction anchor ${anchor.id} transform`),
    radius: sanitizeNonNegative(anchor.radius, 0),
    ...(anchor.facingYaw !== undefined
      ? { facingYaw: finiteRequired(anchor.facingYaw, `interaction anchor ${anchor.id} facingYaw`) }
      : {}),
    ...(anchor.socketId !== undefined ? { socketId: anchor.socketId } : {}),
    ...(anchor.metadata !== undefined ? { metadata: cloneMetadata(anchor.metadata) } : {})
  };
}

function phaseToAnchorKind(phase: ActiveInteractionPhase): InteractionAnchorKind {
  if (phase === "approach") return "approach";
  if (phase === "align") return "align";
  if (phase === "seated") return "seat";
  if (phase === "release" || phase === "exit") return "exit";
  if (phase === "use") return "use";
  return "contact";
}

function reachForPhase(
  machine: InteractionMachineRuntime,
  resource: InteractableResourceDefinition,
  phase: ActiveInteractionPhase,
  normalizedTime: number
): InteractionReachOutput[] {
  if (phase !== "reach" && phase !== "contact" && phase !== "transfer" && phase !== "use" && phase !== "seated")
    return [];
  const anchor = anchorFor(resource, machine.action === "sit" ? "seat" : "contact");
  return [
    {
      actorId: machine.actorId,
      resourceId: machine.resourceId,
      action: machine.action,
      phase,
      commandId: machine.commandId,
      ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
      ...(anchor !== undefined
        ? {
            anchorId: anchor.id,
            target: strictCloneTransform(anchor.transform, `interaction anchor ${anchor.id} transform`)
          }
        : {}),
      window: {
        active: phase === "reach" || phase === "contact",
        openedByPhase: "reach",
        closedByPhase: "contact",
        normalizedTime
      }
    }
  ];
}

function isLoopHintPhase(phase: ActiveInteractionPhase): boolean {
  return phase === "carry" || phase === "equipped" || phase === "seated" || phase === "use";
}

function cloneSocketDefinition(socket: CharacterSocketDefinition): CharacterSocketDefinition {
  if (!isRecord(socket)) throw new Error("character socket definition must be an object");
  if (!isNonEmptyString(socket.id)) throw new Error("character socket id must be a non-empty string");
  return {
    id: socket.id,
    ...(socket.label !== undefined
      ? { label: requiredString(socket.label, `character socket ${socket.id} label`) }
      : {}),
    ...(socket.tags !== undefined ? { tags: cloneStringList(socket.tags, `character socket ${socket.id} tags`) } : {}),
    ...(socket.localOffset !== undefined
      ? { localOffset: strictCloneTransform(socket.localOffset, `character socket ${socket.id} offset`) }
      : {}),
    ...(socket.metadata !== undefined ? { metadata: cloneMetadata(socket.metadata) } : {})
  };
}

function cloneResourceDefinition(resource: InteractableResourceDefinition): InteractableResourceDefinition {
  if (!isRecord(resource)) throw new Error("interaction resource definition must be an object");
  if (!isNonEmptyString(resource.id)) throw new Error("interaction resource id must be a non-empty string");
  if (!isResourceKind(resource.kind)) throw new Error(`interaction resource ${resource.id} kind is invalid`);
  if (!isReadonlyArray(resource.capabilities) || resource.capabilities.length === 0)
    throw new Error(`interaction resource ${resource.id} capabilities must be a non-empty array`);
  const capabilities = cloneStringList(resource.capabilities, `interaction resource ${resource.id} capabilities`);
  const anchors = resource.anchors?.map((anchor) => cloneAnchorDefinition(anchor, resource.id));
  assertNoDuplicateAnchors(anchors ?? [], resource.id);
  return {
    id: resource.id,
    kind: resource.kind,
    capabilities,
    ...(anchors !== undefined ? { anchors } : {}),
    ...(resource.defaultSocketId !== undefined
      ? {
          defaultSocketId: requiredNonEmptyString(
            resource.defaultSocketId,
            `interaction resource ${resource.id} defaultSocketId`
          )
        }
      : {}),
    ...(resource.actionSockets !== undefined
      ? { actionSockets: cloneActionSockets(resource.actionSockets, resource.id) }
      : {}),
    ...(resource.timings !== undefined
      ? { timings: cloneTimingConfig(resource.timings, `interaction resource ${resource.id}`) }
      : {}),
    ...(resource.metadata !== undefined ? { metadata: cloneMetadata(resource.metadata) } : {})
  };
}

function cloneAnchorDefinition(anchor: InteractionAnchorDefinition, resourceId: string): InteractionAnchorDefinition {
  if (!isRecord(anchor)) throw new Error(`interaction resource ${resourceId} anchor must be an object`);
  if (!isNonEmptyString(anchor.id))
    throw new Error(`interaction resource ${resourceId} anchor id must be a non-empty string`);
  if (!isAnchorKind(anchor.kind))
    throw new Error(`interaction resource ${resourceId} anchor ${anchor.id} kind is invalid`);
  return {
    id: anchor.id,
    kind: anchor.kind,
    transform: strictCloneTransform(
      anchor.transform,
      `interaction resource ${resourceId} anchor ${anchor.id} transform`
    ),
    ...(anchor.radius !== undefined
      ? {
          radius: sanitizeNonNegativeStrict(
            anchor.radius,
            `interaction resource ${resourceId} anchor ${anchor.id} radius`
          )
        }
      : {}),
    ...(anchor.facingYaw !== undefined
      ? {
          facingYaw: finiteRequired(
            anchor.facingYaw,
            `interaction resource ${resourceId} anchor ${anchor.id} facingYaw`
          )
        }
      : {}),
    ...(anchor.socketId !== undefined
      ? {
          socketId: requiredNonEmptyString(
            anchor.socketId,
            `interaction resource ${resourceId} anchor ${anchor.id} socketId`
          )
        }
      : {}),
    ...(anchor.tags !== undefined
      ? { tags: cloneStringList(anchor.tags, `interaction resource ${resourceId} anchor ${anchor.id} tags`) }
      : {}),
    ...(anchor.metadata !== undefined ? { metadata: cloneMetadata(anchor.metadata) } : {})
  };
}

function assertNoDuplicateAnchors(anchors: readonly InteractionAnchorDefinition[], resourceId: string): void {
  const ids = new Set<string>();
  for (const anchor of anchors) {
    if (ids.has(anchor.id)) throw new Error(`interaction resource ${resourceId} anchor ${anchor.id} is duplicated`);
    ids.add(anchor.id);
  }
}

function cloneActionSockets(
  actionSockets: Partial<Record<InteractionActionKind, CharacterSocketId>>,
  resourceId: string
): Partial<Record<InteractionActionKind, CharacterSocketId>> {
  if (!isRecord(actionSockets)) throw new Error(`interaction resource ${resourceId} actionSockets must be an object`);
  const cloned: Partial<Record<InteractionActionKind, CharacterSocketId>> = {};
  for (const [key, value] of Object.entries(actionSockets)) {
    if (!isSupportedInteractionAction(key))
      throw new Error(`interaction resource ${resourceId} action socket ${key} is invalid`);
    cloned[key] = requiredNonEmptyString(value, `interaction resource ${resourceId} action socket ${key}`);
  }
  return cloned;
}

function cloneTimingConfig(timings: InteractionTimingConfig, label: string): InteractionTimingConfig {
  if (!isRecord(timings)) throw new Error(`${label} timings must be an object`);
  const cloned: InteractionTimingConfig = {};
  for (const [key, value] of Object.entries(timings)) {
    if (!isActivePhase(key)) throw new Error(`${label} timing phase ${key} is not active`);
    cloned[key] = sanitizeStrictDuration(value, `${label} timing ${key}`);
  }
  return cloned;
}

function strictCloneTransform(value: Partial<Transform> | undefined, label: string): Transform {
  if (value !== undefined && !isRecord(value)) throw new Error(`${label} must be an object`);
  if (value?.translation !== undefined) assertFiniteTuple(value.translation, 3, `${label}.translation`);
  if (value?.rotation !== undefined) assertFiniteTuple(value.rotation, 4, `${label}.rotation`);
  if (value?.scale !== undefined) assertFiniteTuple(value.scale, 3, `${label}.scale`);
  const transform = cloneTransform(value);
  return {
    translation: cloneVec3(transform.translation),
    rotation: cloneQuat(transform.rotation),
    scale: cloneVec3(transform.scale)
  };
}

function assertFiniteTuple(value: readonly number[], length: number, label: string): void {
  if (!isReadonlyArray(value) || value.length !== length) throw new Error(`${label} must contain ${length} values`);
  for (const component of value) {
    if (!Number.isFinite(component)) throw new Error(`${label} values must be finite`);
  }
}

function cloneStringList(values: readonly string[], label: string): string[] {
  if (!isReadonlyArray(values)) throw new Error(`${label} must be an array`);
  return values.map((value, index) => requiredNonEmptyString(value, `${label}[${index}]`));
}

function cloneMetadata(metadata: InteractionMetadata): InteractionMetadata {
  if (!isRecord(metadata)) throw new Error("interaction metadata must be an object");
  const cloned: Record<string, InteractionMetadataValue> = {};
  for (const key of Object.keys(metadata).sort(compareId)) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "boolean") cloned[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) cloned[key] = value;
    else throw new Error(`interaction metadata ${key} must be a finite scalar`);
  }
  return cloned;
}

function cloneResourceState(state: MutableResourceState): InteractionResourceStateSnapshot {
  return {
    id: state.id,
    mutationSequence: state.mutationSequence,
    ...(state.owner !== undefined ? { owner: { ...state.owner } } : {}),
    ...(state.reservation !== undefined ? { reservation: { ...state.reservation } } : {}),
    ...(state.use !== undefined ? { use: { ...state.use } } : {})
  };
}

function mutableResourceStateFromSnapshot(snapshot: InteractionResourceStateSnapshot): MutableResourceState {
  if (!isRecord(snapshot)) throw new Error("interaction resource snapshot must be an object");
  if (!isNonEmptyString(snapshot.id)) throw new Error("interaction resource snapshot id must be a non-empty string");
  if (!Number.isInteger(snapshot.mutationSequence) || snapshot.mutationSequence < 0)
    throw new Error("interaction resource snapshot mutationSequence must be a non-negative integer");
  return {
    id: snapshot.id,
    mutationSequence: snapshot.mutationSequence,
    ...(snapshot.owner !== undefined ? { owner: cloneOwner(snapshot.owner) } : {}),
    ...(snapshot.reservation !== undefined ? { reservation: cloneReservationOwner(snapshot.reservation) } : {}),
    ...(snapshot.use !== undefined ? { use: cloneReservationOwner(snapshot.use) } : {})
  };
}

function cloneOwner(owner: InteractionResourceOwner): InteractionResourceOwner {
  if (!isRecord(owner)) throw new Error("interaction owner snapshot must be an object");
  if (!isNonEmptyString(owner.actorId)) throw new Error("interaction owner actorId must be a non-empty string");
  if (!isOwnerMode(owner.mode)) throw new Error("interaction owner mode is invalid");
  if (!isNonEmptyString(owner.commandId)) throw new Error("interaction owner commandId must be a non-empty string");
  return {
    actorId: owner.actorId,
    mode: owner.mode,
    commandId: owner.commandId,
    ...(owner.socketId !== undefined
      ? { socketId: requiredNonEmptyString(owner.socketId, "interaction owner socketId") }
      : {})
  };
}

function cloneReservationOwner(owner: InteractionReservationOwner): InteractionReservationOwner {
  if (!isRecord(owner)) throw new Error("interaction reservation snapshot must be an object");
  if (!isNonEmptyString(owner.actorId)) throw new Error("interaction reservation actorId must be a non-empty string");
  if (!isNonEmptyString(owner.commandId))
    throw new Error("interaction reservation commandId must be a non-empty string");
  if (!isSupportedInteractionAction(owner.action)) throw new Error("interaction reservation action is invalid");
  return { actorId: owner.actorId, commandId: owner.commandId, action: owner.action };
}

function cloneActorSnapshot(actor: ActorRuntime): InteractionActorSnapshot {
  return {
    actorId: actor.actorId,
    ...(actor.lastCommandId !== undefined ? { lastCommandId: actor.lastCommandId } : {}),
    ...(actor.active !== undefined ? { active: cloneMachineSnapshot(actor.active) } : {})
  };
}

function cloneMachineSnapshot(machine: InteractionMachineRuntime): InteractionActorMachineSnapshot {
  return {
    actorId: machine.actorId,
    commandId: machine.commandId,
    action: machine.action,
    resourceId: machine.resourceId,
    ...(machine.socketId !== undefined ? { socketId: machine.socketId } : {}),
    priority: machine.priority,
    phaseIndex: machine.phaseIndex,
    phaseElapsedSeconds: machine.phaseElapsedSeconds,
    totalElapsedSeconds: machine.totalElapsedSeconds,
    phases: [...machine.phases],
    ...(machine.timings !== undefined
      ? { timings: cloneTimingConfig(machine.timings, `interaction machine ${machine.commandId}`) }
      : {}),
    emittedKeys: [...machine.emittedKeys].sort(compareId),
    appliedKeys: [...machine.appliedKeys].sort(compareId)
  };
}

function actorRuntimeFromSnapshot(snapshot: InteractionActorSnapshot): ActorRuntime {
  if (!isRecord(snapshot)) throw new Error("interaction actor snapshot must be an object");
  if (!isNonEmptyString(snapshot.actorId))
    throw new Error("interaction actor snapshot actorId must be a non-empty string");
  return {
    actorId: snapshot.actorId,
    ...(snapshot.lastCommandId !== undefined
      ? { lastCommandId: requiredNonEmptyString(snapshot.lastCommandId, "interaction actor snapshot lastCommandId") }
      : {}),
    ...(snapshot.active !== undefined ? { active: machineFromSnapshot(snapshot.active, snapshot.actorId) } : {})
  };
}

function machineFromSnapshot(
  snapshot: InteractionActorMachineSnapshot,
  actorId: CharacterActorId
): InteractionMachineRuntime {
  if (!isRecord(snapshot)) throw new Error("interaction machine snapshot must be an object");
  if (snapshot.actorId !== actorId) throw new Error("interaction machine snapshot actorId must match actor snapshot");
  if (!isNonEmptyString(snapshot.commandId))
    throw new Error("interaction machine snapshot commandId must be a non-empty string");
  if (!isSupportedInteractionAction(snapshot.action)) throw new Error("interaction machine snapshot action is invalid");
  if (!isNonEmptyString(snapshot.resourceId))
    throw new Error("interaction machine snapshot resourceId must be a non-empty string");
  if (!isReadonlyArray(snapshot.phases) || snapshot.phases.length === 0)
    throw new Error("interaction machine snapshot phases must be a non-empty array");
  const phases = snapshot.phases.map((phase) => {
    if (!isActivePhase(phase)) throw new Error("interaction machine snapshot phase is invalid");
    return phase;
  });
  if (!Number.isInteger(snapshot.phaseIndex) || snapshot.phaseIndex < 0 || snapshot.phaseIndex >= phases.length)
    throw new Error("interaction machine snapshot phaseIndex is out of range");
  if (!Number.isFinite(snapshot.phaseElapsedSeconds) || snapshot.phaseElapsedSeconds < 0)
    throw new Error("interaction machine snapshot phaseElapsedSeconds must be finite and non-negative");
  if (!Number.isFinite(snapshot.totalElapsedSeconds) || snapshot.totalElapsedSeconds < 0)
    throw new Error("interaction machine snapshot totalElapsedSeconds must be finite and non-negative");
  if (!isReadonlyArray(snapshot.emittedKeys) || !isReadonlyArray(snapshot.appliedKeys))
    throw new Error("interaction machine snapshot keys must be arrays");
  return {
    actorId,
    commandId: snapshot.commandId,
    action: snapshot.action,
    resourceId: snapshot.resourceId,
    ...(snapshot.socketId !== undefined
      ? { socketId: requiredNonEmptyString(snapshot.socketId, "interaction machine socketId") }
      : {}),
    priority: optionalFinite(snapshot.priority, 0),
    phaseIndex: snapshot.phaseIndex,
    phaseElapsedSeconds: snapshot.phaseElapsedSeconds,
    totalElapsedSeconds: snapshot.totalElapsedSeconds,
    phases,
    ...(snapshot.timings !== undefined
      ? { timings: cloneTimingConfig(snapshot.timings, "interaction machine snapshot") }
      : {}),
    emittedKeys: new Set(cloneStringList(snapshot.emittedKeys, "interaction machine emittedKeys")),
    appliedKeys: new Set(cloneStringList(snapshot.appliedKeys, "interaction machine appliedKeys"))
  };
}

function validateSnapshotLocks(
  resources: ReadonlyMap<InteractionResourceId, MutableResourceState>,
  actors: ReadonlyMap<CharacterActorId, ActorRuntime>
): void {
  const owners = new Map<string, string>();
  for (const state of resources.values()) {
    if (state.reservation !== undefined) {
      const actor = actors.get(state.reservation.actorId);
      if (actor?.active?.resourceId !== state.id || actor.active.commandId !== state.reservation.commandId)
        throw new Error("interaction snapshot reservation has no matching active actor");
    }
    if (state.owner !== undefined) {
      const previous = owners.get(state.id);
      if (previous !== undefined && previous !== state.owner.actorId)
        throw new Error("interaction snapshot resource has multiple owners");
      owners.set(state.id, state.owner.actorId);
    }
  }
}

function sanitizeDeltaSeconds(
  value: number,
  maxDeltaSeconds: number,
  issues: InteractionIssue[],
  tick: number
): number {
  if (!Number.isFinite(value) || value < 0) {
    issues.push(
      createIssue(
        "input-rejected",
        undefined,
        undefined,
        undefined,
        "deltaSeconds",
        "finite",
        "interaction deltaSeconds must be finite and non-negative",
        tick
      )
    );
    return 0;
  }
  if (value > maxDeltaSeconds) {
    issues.push(
      createIssue(
        "bounded",
        undefined,
        undefined,
        undefined,
        "deltaSeconds",
        "max",
        "interaction deltaSeconds was clamped to maxDeltaSeconds",
        tick
      )
    );
    return maxDeltaSeconds;
  }
  return value;
}

function sanitizePhaseDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PHASE_SECONDS ? value : fallback;
}

function sanitizeStrictDuration(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PHASE_SECONDS)
    throw new Error(`${label} must be finite and between 0 and ${MAX_PHASE_SECONDS}`);
  return value;
}

function sanitizePositive(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

function sanitizeNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeNonNegativeStrict(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
}

function finiteRequired(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function requiredString(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requiredNonEmptyString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function compareResolvedRequest(a: ResolvedInteractionRequest, b: ResolvedInteractionRequest): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return compareId(a.actorId, b.actorId);
}

function sortedUnion(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort(compareId);
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function issuesForActor(issues: readonly InteractionIssue[], actorId: CharacterActorId): InteractionIssue[] {
  return issues.filter((issue) => issue.actorId === actorId);
}

function interruptReason(interrupt: boolean | Readonly<{ reason?: string }>): string | undefined {
  return typeof interrupt === "object" ? interrupt.reason : undefined;
}

function bumpResourceState(state: MutableResourceState): void {
  state.mutationSequence += 1;
}

function createIssue(
  type: InteractionIssueType,
  actorId: CharacterActorId | undefined,
  resourceId: InteractionResourceId | undefined,
  commandId: string | undefined,
  field: string,
  code: string,
  message: string,
  tick: number
): InteractionIssue {
  return {
    type,
    field,
    code,
    message,
    tick,
    ...(actorId !== undefined ? { actorId } : {}),
    ...(resourceId !== undefined ? { resourceId } : {}),
    ...(commandId !== undefined ? { commandId } : {})
  };
}

function controllerActionToInteraction(kind: CharacterActionKind | undefined): InteractionActionKind | undefined {
  return isSupportedControllerAction(kind) ? kind : undefined;
}

function isSupportedControllerAction(
  kind: CharacterActionKind | undefined
): kind is Exclude<CharacterActionKind, "custom"> {
  return (
    kind === "pickup" ||
    kind === "drop" ||
    kind === "equip" ||
    kind === "unequip" ||
    kind === "use" ||
    kind === "sit" ||
    kind === "stand"
  );
}

function isSupportedInteractionAction(value: unknown): value is InteractionActionKind {
  return (
    value === "pickup" ||
    value === "carry" ||
    value === "drop" ||
    value === "equip" ||
    value === "unequip" ||
    value === "use" ||
    value === "sit" ||
    value === "stand"
  );
}

function actionAttachesToSocket(action: InteractionActionKind): boolean {
  return action === "pickup" || action === "carry" || action === "equip" || action === "unequip";
}

function isActivePhase(value: unknown): value is ActiveInteractionPhase {
  return typeof value === "string" && ACTIVE_PHASE_SET.has(value as InteractionPhase);
}

function isResourceKind(value: unknown): value is InteractionResourceKind {
  return value === "item" || value === "seat" || value === "station" || value === "container" || value === "custom";
}

function isAnchorKind(value: unknown): value is InteractionAnchorKind {
  return (
    value === "approach" ||
    value === "align" ||
    value === "contact" ||
    value === "exit" ||
    value === "seat" ||
    value === "use" ||
    value === "drop" ||
    value === "custom"
  );
}

function isOwnerMode(value: unknown): value is InteractionOwnerMode {
  return value === "held" || value === "carried" || value === "equipped" || value === "seated";
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
