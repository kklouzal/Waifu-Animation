import {
  CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
  type CharacterControllerInput,
  type CharacterControllerSnapshot,
  type CharacterGaitId
} from "./character-controller.js";
import { EPSILON, clamp, clamp01, cloneVec3, type Vec3 } from "./math.js";

export const NAVIGATION_SCHEMA_VERSION = 1;
export const PATH_FOLLOWER_SCHEMA_VERSION = 1;

/** Shared navigation/controller convention: world-space Y-up, +Z-forward, yaw 0 faces +Z. */
export const NAVIGATION_COORDINATE_SYSTEM = CHARACTER_CONTROLLER_COORDINATE_SYSTEM;

export type NavigationActorId = string;
export type NavigationTopologyId = string;
export type NavigationAreaId = string;
export type NavigationPathId = string;
export type NavigationDestinationId = string;
export type NavigationResourceId = string;
export type NavigationReservationKey = string;
export type NavigationTraversalLinkId = string;
export type NavigationCorridorId = string;

export type NavigationPathStatus = "ready" | "partial" | "stale";
export type NavigationTraversalLinkKind = "off-mesh" | "jump" | "drop" | "climb" | "scripted" | "custom";

export type NavigationDestination = {
  /** Opaque caller-owned destination id. The library does not resolve this to app/world content. */
  id?: NavigationDestinationId;
  position: Vec3;
  /** Final planar arrival radius in meters. Defaults to the follower arrival policy. */
  radius?: number;
  /** Optional final yaw in radians; yaw 0 faces +Z and positive yaw turns toward +X around +Y. */
  facingYaw?: number;
  /** Optional final planar facing direction. Ignored when facingYaw is present. */
  facingDirection?: Vec3;
  /** Opaque key used by a coordinator to arbitrate exclusive destinations. */
  reservationKey?: NavigationReservationKey;
  /** Optional caller-owned resource associated with this destination (seat, station, marker, etc.). */
  resourceId?: NavigationResourceId;
};

export type NavigationWaypoint = {
  position: Vec3;
  /** Per-waypoint planar acceptance radius. Defaults to the follower waypoint policy. */
  radius?: number;
  areaId?: NavigationAreaId;
  corridorId?: NavigationCorridorId;
  traversalLinkId?: NavigationTraversalLinkId;
};

export type NavigationCorridorPortal = {
  left: Vec3;
  right: Vec3;
  fromAreaId?: NavigationAreaId;
  toAreaId?: NavigationAreaId;
  traversalLinkId?: NavigationTraversalLinkId;
};

export type NavigationPathCorridor = {
  id?: NavigationCorridorId;
  topologyId?: NavigationTopologyId;
  areaIds?: readonly NavigationAreaId[];
  portals?: readonly NavigationCorridorPortal[];
  /** Optional conservative half-width hint for adapters/coordinators. Not a concrete navmesh. */
  halfWidth?: number;
};

export type NavigationPath = {
  id?: NavigationPathId;
  /** Caller-owned revision used to detect path replacement without inspecting world assets. */
  revision?: string | number;
  topologyId?: NavigationTopologyId;
  status?: NavigationPathStatus;
  waypoints: readonly NavigationWaypoint[];
  destination: NavigationDestination;
  corridor?: NavigationPathCorridor;
  /** Optional planning cost/progress hint from a caller-owned topology adapter. */
  cost?: number;
};

export type NavigationSamplingQuery = {
  position: Vec3;
  topologyId?: NavigationTopologyId;
  actorRadius?: number;
  includeAreaIds?: readonly NavigationAreaId[];
  excludeAreaIds?: readonly NavigationAreaId[];
  tick?: number;
};

export type NavigationSamplingResult = {
  accepted: boolean;
  position?: Vec3;
  normal?: Vec3;
  areaId?: NavigationAreaId;
  distance?: number;
  reason?: string;
};

export type NavigationPathQuery = {
  from: Vec3;
  destination: NavigationDestination;
  topologyId?: NavigationTopologyId;
  actorRadius?: number;
  preferredCorridorId?: NavigationCorridorId;
  tick?: number;
};

export type NavigationPathPlanningResult = {
  status: "success" | "partial" | "failed";
  path?: NavigationPath;
  nearestReachable?: Vec3;
  reason?: string;
};

export type NavigationTopologyAdapter = {
  /** Renderer/physics-agnostic sampling boundary; concrete navmesh/topology ownership stays with the caller. */
  sampleNearest?: (query: NavigationSamplingQuery) => NavigationSamplingResult | null | undefined;
  /** Optional path-planning boundary. This package never constructs or claims a concrete navmesh. */
  planPath?: (query: NavigationPathQuery) => NavigationPathPlanningResult | null | undefined;
};

export type NavigationTraversalLinkDescriptor = {
  id: NavigationTraversalLinkId;
  kind: NavigationTraversalLinkKind;
  from: Vec3;
  to: Vec3;
  bidirectional?: boolean;
  radius?: number;
  cost?: number;
  areaId?: NavigationAreaId;
  metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type NavigationLocalAvoidanceAgent = {
  actorId?: NavigationActorId;
  position: Vec3;
  velocity: Vec3;
  radius: number;
  /** Follower-requested planar unit direction scaled by requested magnitude. */
  desiredVelocity: Vec3;
  priority: number;
};

export type NavigationLocalAvoidanceObstacle = {
  id?: string;
  position: Vec3;
  radius: number;
  velocity?: Vec3;
};

export type NavigationLocalAvoidanceQuery = {
  coordinateSystem: typeof NAVIGATION_COORDINATE_SYSTEM;
  tick: number;
  deltaSeconds: number;
  actor: NavigationLocalAvoidanceAgent;
  neighbors?: readonly NavigationLocalAvoidanceAgent[];
  obstacles?: readonly NavigationLocalAvoidanceObstacle[];
};

export type NavigationLocalAvoidanceResult = {
  /** Optional replacement planar direction. Must be finite and non-zero to be accepted. */
  planarDirection?: Vec3;
  /** Optional multiplier for the follower movement magnitude. Clamped to [0, 1]. */
  speedScale?: number;
  blocked?: boolean;
  requestRepath?: boolean;
  reason?: string;
};

export type NavigationLocalAvoidanceAdapter = (
  query: NavigationLocalAvoidanceQuery
) => NavigationLocalAvoidanceResult | null | undefined;

export type PathFollowerStatus = "idle" | "following" | "turning" | "arrived" | "blocked" | "needs-repath" | "invalid";
export type PathFollowerIssueType = "input-rejected" | "adapter-failed" | "bounded" | "blocked" | "repath";

export type PathFollowerIssue = {
  type: PathFollowerIssueType;
  field: string;
  code: string;
  message: string;
  tick: number;
};

export type PathFollowerConfig = {
  arrivalRadius?: number;
  /** Extra radius that keeps an already-arrived path stable against tiny controller drift. */
  arrivalHysteresisRadius?: number;
  waypointRadius?: number;
  slowDownRadius?: number;
  minMoveMagnitude?: number;
  /** Large yaw errors inside slow-down range are solved by turning in place before advancing. */
  turnInPlaceAngleRadians?: number;
  facingToleranceRadians?: number;
  turnSpeedRadians?: number;
  blockedProgressEpsilon?: number;
  blockedTimeoutSeconds?: number;
  /** 0 disables age-based repath requests; positive values request repath once elapsed. */
  repathIntervalSeconds?: number;
  maxDeltaSeconds?: number;
  defaultGaitId?: CharacterGaitId;
};

export type PathFollowerResolvedConfig = Readonly<Required<PathFollowerConfig>>;

export type PathFollowerSnapshot = {
  schemaVersion: typeof PATH_FOLLOWER_SCHEMA_VERSION;
  tick: number;
  pathKey: string | null;
  waypointIndex: number;
  status: PathFollowerStatus;
  arrived: boolean;
  blockedSeconds: number;
  pathAgeSeconds: number;
  lastDistanceToGoal: number | null;
  lastDistanceToWaypoint: number | null;
  lastPosition: Vec3;
};

export type PathFollowerUpdateOptions = {
  deltaSeconds?: number;
  actorId?: NavigationActorId;
  actorRadius?: number;
  priority?: number;
  localAvoidance?: NavigationLocalAvoidanceAdapter;
  neighbors?: readonly NavigationLocalAvoidanceAgent[];
  obstacles?: readonly NavigationLocalAvoidanceObstacle[];
};

export type PathFollowerOutput = {
  schemaVersion: typeof PATH_FOLLOWER_SCHEMA_VERSION;
  tick: number;
  pathKey: string | null;
  status: PathFollowerStatus;
  waypointIndex: number;
  targetPosition: Vec3 | null;
  distanceToWaypoint: number;
  distanceToGoal: number;
  arrived: boolean;
  blocked: boolean;
  needsRepath: boolean;
  input: CharacterControllerInput;
  issues: PathFollowerIssue[];
};

type SanitizedWaypointTarget = {
  position: Vec3;
  radius: number;
  final: boolean;
  facingYaw: number | null;
};

type SanitizedPath = {
  key: string;
  status: NavigationPathStatus;
  targets: readonly SanitizedWaypointTarget[];
};

type MutablePathFollowerState = Omit<PathFollowerSnapshot, "schemaVersion">;

const DEFAULT_PATH_FOLLOWER_CONFIG = {
  arrivalRadius: 0.18,
  arrivalHysteresisRadius: 0.05,
  waypointRadius: 0.22,
  slowDownRadius: 0.75,
  minMoveMagnitude: 0.08,
  turnInPlaceAngleRadians: Math.PI / 3,
  facingToleranceRadians: Math.PI / 90,
  turnSpeedRadians: Math.PI * 4,
  blockedProgressEpsilon: 0.015,
  blockedTimeoutSeconds: 1.5,
  repathIntervalSeconds: 0,
  maxDeltaSeconds: 0.25,
  defaultGaitId: "walk"
} as const;

export class CharacterPathFollower {
  readonly config: PathFollowerResolvedConfig;
  private readonly state: MutablePathFollowerState;

  constructor(config: PathFollowerConfig = {}) {
    this.config = resolvePathFollowerConfig(config);
    this.state = createInitialPathFollowerState();
  }

  reset(): void {
    copyPathFollowerState(this.state, createInitialPathFollowerState());
  }

  snapshot(): PathFollowerSnapshot {
    return clonePathFollowerSnapshot(this.state);
  }

  restore(snapshot: PathFollowerSnapshot): void {
    copyPathFollowerState(this.state, validatePathFollowerSnapshot(snapshot));
  }

  update(
    path: NavigationPath | null | undefined,
    controller: CharacterControllerSnapshot,
    options: PathFollowerUpdateOptions = {}
  ): PathFollowerOutput {
    this.state.tick += 1;
    const tick = this.state.tick;
    const issues: PathFollowerIssue[] = [];
    const deltaSeconds = sanitizeDeltaSeconds(options.deltaSeconds, this.config, issues, tick);
    const controllerPosition = readFiniteVec3(controller.position);
    const controllerVelocity = readFiniteVec3(controller.velocity);
    const controllerYaw = Number.isFinite(controller.yaw) ? controller.yaw : null;
    if (!controllerPosition || !controllerVelocity || controllerYaw === null) {
      issues.push(
        createPathIssue(
          "input-rejected",
          "controller",
          "finite",
          "controller snapshot contains non-finite navigation state",
          tick
        )
      );
      this.state.status = "invalid";
      return this.output("invalid", null, 0, 0, false, true, holdInput(), issues);
    }

    if (path === null || path === undefined) {
      this.state.pathKey = null;
      this.state.waypointIndex = 0;
      this.state.arrived = false;
      this.state.blockedSeconds = 0;
      this.state.pathAgeSeconds = 0;
      this.state.lastDistanceToGoal = null;
      this.state.lastDistanceToWaypoint = null;
      copyVec3Into(this.state.lastPosition, controllerPosition);
      this.state.status = "idle";
      return this.output("idle", null, 0, 0, false, false, holdInput(), issues);
    }

    const sanitizedPath = sanitizeNavigationPath(path, this.config, issues, tick);
    if (!sanitizedPath) {
      this.state.status = "invalid";
      return this.output("invalid", null, 0, 0, false, true, holdInput(), issues);
    }

    if (this.state.pathKey !== sanitizedPath.key) {
      this.state.pathKey = sanitizedPath.key;
      this.state.waypointIndex = 0;
      this.state.arrived = false;
      this.state.blockedSeconds = 0;
      this.state.pathAgeSeconds = 0;
      this.state.lastDistanceToGoal = null;
      this.state.lastDistanceToWaypoint = null;
    }
    this.state.pathAgeSeconds += deltaSeconds;

    const finalTarget = sanitizedPath.targets[sanitizedPath.targets.length - 1]!;
    let waypointIndex = Math.min(this.state.waypointIndex, sanitizedPath.targets.length - 1);
    while (waypointIndex < sanitizedPath.targets.length - 1) {
      const candidate = sanitizedPath.targets[waypointIndex]!;
      if (planarDistance(controllerPosition, candidate.position) > candidate.radius) break;
      waypointIndex += 1;
    }
    this.state.waypointIndex = waypointIndex;

    const target = sanitizedPath.targets[waypointIndex]!;
    const distanceToWaypoint = planarDistance(controllerPosition, target.position);
    const distanceToGoal = planarDistance(controllerPosition, finalTarget.position);
    const arrivalRadius = finalTarget.radius;
    const insideArrival = distanceToGoal <= arrivalRadius;
    const insideStableArrival = distanceToGoal <= arrivalRadius + this.config.arrivalHysteresisRadius;
    const finalFacingYaw = finalTarget.facingYaw;
    const turnInputValue = finalFacingYaw === null ? null : turnInput(finalFacingYaw, this.config);
    const facingSatisfied =
      finalFacingYaw === null ||
      Math.abs(angleDelta(controllerYaw, finalFacingYaw)) <= this.config.facingToleranceRadians;

    this.updateProgressTimers(
      controllerPosition,
      distanceToWaypoint,
      distanceToGoal,
      insideStableArrival,
      deltaSeconds
    );

    const stalePath = sanitizedPath.status === "stale";
    const ageRepath =
      this.config.repathIntervalSeconds > 0 && this.state.pathAgeSeconds >= this.config.repathIntervalSeconds;
    if (stalePath || ageRepath) {
      issues.push(
        createPathIssue(
          "repath",
          stalePath ? "path.status" : "pathAgeSeconds",
          stalePath ? "stale" : "interval",
          stalePath ? "navigation path is marked stale" : "navigation path exceeded configured repath interval",
          tick
        )
      );
      this.state.status = "needs-repath";
      return this.output(
        "needs-repath",
        target.position,
        distanceToWaypoint,
        distanceToGoal,
        false,
        true,
        holdInput(),
        issues
      );
    }

    if (this.state.arrived && insideStableArrival && facingSatisfied) {
      this.state.status = "arrived";
      return this.output(
        "arrived",
        finalTarget.position,
        distanceToWaypoint,
        distanceToGoal,
        true,
        false,
        holdInput(),
        issues
      );
    }
    if (insideArrival) {
      if (facingSatisfied) {
        this.state.arrived = true;
        this.state.status = "arrived";
        return this.output(
          "arrived",
          finalTarget.position,
          distanceToWaypoint,
          distanceToGoal,
          true,
          false,
          holdInput(),
          issues
        );
      }
      this.state.arrived = false;
      this.state.status = "turning";
      return this.output(
        "turning",
        finalTarget.position,
        distanceToWaypoint,
        distanceToGoal,
        false,
        false,
        turnInputValue ?? holdInput(),
        issues
      );
    }
    this.state.arrived = false;

    const baseDirection = planarDirection(controllerPosition, target.position);
    if (baseDirection === null) {
      this.state.status = "blocked";
      return this.output(
        "blocked",
        target.position,
        distanceToWaypoint,
        distanceToGoal,
        false,
        true,
        holdInput(),
        issues
      );
    }

    const yawToTarget = yawFromPlanarDirection(baseDirection);
    const yawError = Math.abs(angleDelta(controllerYaw, yawToTarget));
    const shouldTurnInPlace =
      yawError > this.config.turnInPlaceAngleRadians && distanceToWaypoint <= this.config.slowDownRadius;
    if (shouldTurnInPlace) {
      const input = turnInput(yawToTarget, this.config);
      this.state.status = "turning";
      return this.output("turning", target.position, distanceToWaypoint, distanceToGoal, false, false, input, issues);
    }

    let direction = baseDirection;
    let magnitude = target.final ? arrivalMagnitude(distanceToGoal, this.config) : 1;
    let avoidanceRequestsRepath = false;
    let avoidanceBlocked = false;
    if (options.localAvoidance) {
      const avoided = applyLocalAvoidance(
        options.localAvoidance,
        {
          coordinateSystem: NAVIGATION_COORDINATE_SYSTEM,
          tick,
          deltaSeconds,
          actor: {
            ...(options.actorId !== undefined ? { actorId: options.actorId } : {}),
            position: cloneVec3(controllerPosition),
            velocity: cloneVec3(controllerVelocity),
            radius: sanitizeActorRadius(options.actorRadius),
            desiredVelocity: [direction[0] * magnitude, 0, direction[2] * magnitude],
            priority: sanitizePriority(options.priority)
          },
          ...(options.neighbors !== undefined ? { neighbors: options.neighbors } : {}),
          ...(options.obstacles !== undefined ? { obstacles: options.obstacles } : {})
        },
        issues,
        tick
      );
      direction = avoided.direction;
      magnitude *= avoided.speedScale;
      avoidanceBlocked = avoided.blocked;
      avoidanceRequestsRepath = avoided.requestRepath;
    }

    if (avoidanceRequestsRepath) {
      issues.push(
        createPathIssue("repath", "localAvoidance", "requested", "local avoidance requested a path refresh", tick)
      );
      this.state.status = "needs-repath";
      return this.output(
        "needs-repath",
        target.position,
        distanceToWaypoint,
        distanceToGoal,
        false,
        true,
        holdInput(),
        issues
      );
    }

    const timedOutBlocked = this.state.blockedSeconds >= this.config.blockedTimeoutSeconds;
    if (avoidanceBlocked || timedOutBlocked) {
      issues.push(
        createPathIssue(
          "blocked",
          avoidanceBlocked ? "localAvoidance.blocked" : "blockedSeconds",
          avoidanceBlocked ? "adapter" : "timeout",
          avoidanceBlocked
            ? "local avoidance reported the actor blocked"
            : "path follower made no configured progress before blocked timeout",
          tick
        )
      );
      this.state.status = "blocked";
      return this.output(
        "blocked",
        target.position,
        distanceToWaypoint,
        distanceToGoal,
        false,
        true,
        holdInput(),
        issues
      );
    }

    const input: CharacterControllerInput = {
      movement: {
        planarDirection: direction,
        magnitude,
        gait: this.config.defaultGaitId,
        facing: { policy: "movement", turnSpeedRadians: this.config.turnSpeedRadians }
      }
    };
    this.state.status = "following";
    return this.output("following", target.position, distanceToWaypoint, distanceToGoal, false, false, input, issues);
  }

  private updateProgressTimers(
    position: Vec3,
    distanceToWaypoint: number,
    distanceToGoal: number,
    insideStableArrival: boolean,
    deltaSeconds: number
  ): void {
    const improved =
      this.state.lastDistanceToGoal === null ||
      this.state.lastDistanceToWaypoint === null ||
      distanceToGoal < this.state.lastDistanceToGoal - this.config.blockedProgressEpsilon ||
      distanceToWaypoint < this.state.lastDistanceToWaypoint - this.config.blockedProgressEpsilon;
    if (improved || insideStableArrival) this.state.blockedSeconds = 0;
    else this.state.blockedSeconds += deltaSeconds;
    this.state.lastDistanceToGoal = distanceToGoal;
    this.state.lastDistanceToWaypoint = distanceToWaypoint;
    copyVec3Into(this.state.lastPosition, position);
  }

  private output(
    status: PathFollowerStatus,
    targetPosition: Vec3 | null,
    distanceToWaypoint: number,
    distanceToGoal: number,
    arrived: boolean,
    needsRepath: boolean,
    input: CharacterControllerInput,
    issues: PathFollowerIssue[]
  ): PathFollowerOutput {
    const blocked = status === "blocked";
    return {
      schemaVersion: PATH_FOLLOWER_SCHEMA_VERSION,
      tick: this.state.tick,
      pathKey: this.state.pathKey,
      status,
      waypointIndex: this.state.waypointIndex,
      targetPosition: targetPosition === null ? null : cloneVec3(targetPosition),
      distanceToWaypoint,
      distanceToGoal,
      arrived,
      blocked,
      needsRepath: needsRepath || status === "needs-repath" || status === "invalid",
      input: cloneControllerInput(input),
      issues: issues.map((issue) => ({ ...issue }))
    };
  }
}

export function resolvePathFollowerConfig(config: PathFollowerConfig = {}): PathFollowerResolvedConfig {
  if (!isRecord(config)) throw new Error("path follower config must be an object");
  const resolved: PathFollowerResolvedConfig = Object.freeze({
    arrivalRadius: optionalFiniteNonNegative(
      config.arrivalRadius,
      DEFAULT_PATH_FOLLOWER_CONFIG.arrivalRadius,
      "arrivalRadius"
    ),
    arrivalHysteresisRadius: optionalFiniteNonNegative(
      config.arrivalHysteresisRadius,
      DEFAULT_PATH_FOLLOWER_CONFIG.arrivalHysteresisRadius,
      "arrivalHysteresisRadius"
    ),
    waypointRadius: optionalFiniteNonNegative(
      config.waypointRadius,
      DEFAULT_PATH_FOLLOWER_CONFIG.waypointRadius,
      "waypointRadius"
    ),
    slowDownRadius: optionalFinitePositive(
      config.slowDownRadius,
      DEFAULT_PATH_FOLLOWER_CONFIG.slowDownRadius,
      "slowDownRadius"
    ),
    minMoveMagnitude: optionalFiniteInRange(
      config.minMoveMagnitude,
      DEFAULT_PATH_FOLLOWER_CONFIG.minMoveMagnitude,
      0,
      1,
      "minMoveMagnitude"
    ),
    turnInPlaceAngleRadians: optionalFiniteInRange(
      config.turnInPlaceAngleRadians,
      DEFAULT_PATH_FOLLOWER_CONFIG.turnInPlaceAngleRadians,
      0,
      Math.PI,
      "turnInPlaceAngleRadians"
    ),
    facingToleranceRadians: optionalFiniteInRange(
      config.facingToleranceRadians,
      DEFAULT_PATH_FOLLOWER_CONFIG.facingToleranceRadians,
      0,
      Math.PI,
      "facingToleranceRadians"
    ),
    turnSpeedRadians: optionalFiniteNonNegative(
      config.turnSpeedRadians,
      DEFAULT_PATH_FOLLOWER_CONFIG.turnSpeedRadians,
      "turnSpeedRadians"
    ),
    blockedProgressEpsilon: optionalFiniteNonNegative(
      config.blockedProgressEpsilon,
      DEFAULT_PATH_FOLLOWER_CONFIG.blockedProgressEpsilon,
      "blockedProgressEpsilon"
    ),
    blockedTimeoutSeconds: optionalFiniteNonNegative(
      config.blockedTimeoutSeconds,
      DEFAULT_PATH_FOLLOWER_CONFIG.blockedTimeoutSeconds,
      "blockedTimeoutSeconds"
    ),
    repathIntervalSeconds: optionalFiniteNonNegative(
      config.repathIntervalSeconds,
      DEFAULT_PATH_FOLLOWER_CONFIG.repathIntervalSeconds,
      "repathIntervalSeconds"
    ),
    maxDeltaSeconds: optionalFinitePositive(
      config.maxDeltaSeconds,
      DEFAULT_PATH_FOLLOWER_CONFIG.maxDeltaSeconds,
      "maxDeltaSeconds"
    ),
    defaultGaitId: isNonEmptyString(config.defaultGaitId)
      ? config.defaultGaitId
      : DEFAULT_PATH_FOLLOWER_CONFIG.defaultGaitId
  });
  return resolved;
}

export function cloneNavigationPath(path: NavigationPath): NavigationPath {
  const destination: NavigationDestination = { position: cloneVec3(path.destination.position) };
  if (path.destination.id !== undefined) destination.id = path.destination.id;
  if (path.destination.radius !== undefined) destination.radius = path.destination.radius;
  if (path.destination.facingYaw !== undefined) destination.facingYaw = path.destination.facingYaw;
  if (path.destination.facingDirection !== undefined)
    destination.facingDirection = cloneVec3(path.destination.facingDirection);
  if (path.destination.reservationKey !== undefined) destination.reservationKey = path.destination.reservationKey;
  if (path.destination.resourceId !== undefined) destination.resourceId = path.destination.resourceId;

  const cloned: NavigationPath = {
    waypoints: path.waypoints.map((waypoint) => {
      const clone: NavigationWaypoint = { position: cloneVec3(waypoint.position) };
      if (waypoint.radius !== undefined) clone.radius = waypoint.radius;
      if (waypoint.areaId !== undefined) clone.areaId = waypoint.areaId;
      if (waypoint.corridorId !== undefined) clone.corridorId = waypoint.corridorId;
      if (waypoint.traversalLinkId !== undefined) clone.traversalLinkId = waypoint.traversalLinkId;
      return clone;
    }),
    destination
  };
  if (path.id !== undefined) cloned.id = path.id;
  if (path.revision !== undefined) cloned.revision = path.revision;
  if (path.topologyId !== undefined) cloned.topologyId = path.topologyId;
  if (path.status !== undefined) cloned.status = path.status;
  if (path.cost !== undefined) cloned.cost = path.cost;
  if (path.corridor !== undefined) cloned.corridor = cloneNavigationCorridor(path.corridor);
  return cloned;
}

function cloneNavigationCorridor(corridor: NavigationPathCorridor): NavigationPathCorridor {
  const cloned: NavigationPathCorridor = {};
  if (corridor.id !== undefined) cloned.id = corridor.id;
  if (corridor.topologyId !== undefined) cloned.topologyId = corridor.topologyId;
  if (corridor.areaIds !== undefined) cloned.areaIds = [...corridor.areaIds];
  if (corridor.halfWidth !== undefined) cloned.halfWidth = corridor.halfWidth;
  if (corridor.portals !== undefined) {
    cloned.portals = corridor.portals.map((portal) => {
      const clonedPortal: NavigationCorridorPortal = { left: cloneVec3(portal.left), right: cloneVec3(portal.right) };
      if (portal.fromAreaId !== undefined) clonedPortal.fromAreaId = portal.fromAreaId;
      if (portal.toAreaId !== undefined) clonedPortal.toAreaId = portal.toAreaId;
      if (portal.traversalLinkId !== undefined) clonedPortal.traversalLinkId = portal.traversalLinkId;
      return clonedPortal;
    });
  }
  return cloned;
}

function createInitialPathFollowerState(): MutablePathFollowerState {
  return {
    tick: 0,
    pathKey: null,
    waypointIndex: 0,
    status: "idle",
    arrived: false,
    blockedSeconds: 0,
    pathAgeSeconds: 0,
    lastDistanceToGoal: null,
    lastDistanceToWaypoint: null,
    lastPosition: [0, 0, 0]
  };
}

function clonePathFollowerSnapshot(state: MutablePathFollowerState): PathFollowerSnapshot {
  return {
    schemaVersion: PATH_FOLLOWER_SCHEMA_VERSION,
    tick: state.tick,
    pathKey: state.pathKey,
    waypointIndex: state.waypointIndex,
    status: state.status,
    arrived: state.arrived,
    blockedSeconds: state.blockedSeconds,
    pathAgeSeconds: state.pathAgeSeconds,
    lastDistanceToGoal: state.lastDistanceToGoal,
    lastDistanceToWaypoint: state.lastDistanceToWaypoint,
    lastPosition: cloneVec3(state.lastPosition)
  };
}

function validatePathFollowerSnapshot(snapshot: PathFollowerSnapshot): MutablePathFollowerState {
  if (!isRecord(snapshot)) throw new Error("path follower snapshot must be an object");
  if (snapshot.schemaVersion !== PATH_FOLLOWER_SCHEMA_VERSION)
    throw new Error("unsupported path follower snapshot schemaVersion");
  if (!isNonNegativeInteger(snapshot.tick))
    throw new Error("path follower snapshot tick must be a non-negative integer");
  if (snapshot.pathKey !== null && !isNonEmptyString(snapshot.pathKey))
    throw new Error("path follower snapshot pathKey must be string or null");
  if (!isNonNegativeInteger(snapshot.waypointIndex))
    throw new Error("path follower snapshot waypointIndex must be a non-negative integer");
  if (!isPathFollowerStatus(snapshot.status)) throw new Error("path follower snapshot status is invalid");
  if (typeof snapshot.arrived !== "boolean") throw new Error("path follower snapshot arrived must be boolean");
  if (!Number.isFinite(snapshot.blockedSeconds) || snapshot.blockedSeconds < 0)
    throw new Error("path follower snapshot blockedSeconds must be finite and non-negative");
  if (!Number.isFinite(snapshot.pathAgeSeconds) || snapshot.pathAgeSeconds < 0)
    throw new Error("path follower snapshot pathAgeSeconds must be finite and non-negative");
  if (
    snapshot.lastDistanceToGoal !== null &&
    (!Number.isFinite(snapshot.lastDistanceToGoal) || snapshot.lastDistanceToGoal < 0)
  )
    throw new Error("path follower snapshot lastDistanceToGoal must be finite, non-negative, or null");
  if (
    snapshot.lastDistanceToWaypoint !== null &&
    (!Number.isFinite(snapshot.lastDistanceToWaypoint) || snapshot.lastDistanceToWaypoint < 0)
  )
    throw new Error("path follower snapshot lastDistanceToWaypoint must be finite, non-negative, or null");
  const lastPosition = readFiniteVec3(snapshot.lastPosition);
  if (!lastPosition) throw new Error("path follower snapshot lastPosition must contain three finite numbers");
  return {
    tick: snapshot.tick,
    pathKey: snapshot.pathKey,
    waypointIndex: snapshot.waypointIndex,
    status: snapshot.status,
    arrived: snapshot.arrived,
    blockedSeconds: snapshot.blockedSeconds,
    pathAgeSeconds: snapshot.pathAgeSeconds,
    lastDistanceToGoal: snapshot.lastDistanceToGoal,
    lastDistanceToWaypoint: snapshot.lastDistanceToWaypoint,
    lastPosition
  };
}

function copyPathFollowerState(target: MutablePathFollowerState, source: MutablePathFollowerState): void {
  target.tick = source.tick;
  target.pathKey = source.pathKey;
  target.waypointIndex = source.waypointIndex;
  target.status = source.status;
  target.arrived = source.arrived;
  target.blockedSeconds = source.blockedSeconds;
  target.pathAgeSeconds = source.pathAgeSeconds;
  target.lastDistanceToGoal = source.lastDistanceToGoal;
  target.lastDistanceToWaypoint = source.lastDistanceToWaypoint;
  copyVec3Into(target.lastPosition, source.lastPosition);
}

function sanitizeNavigationPath(
  path: NavigationPath,
  config: PathFollowerResolvedConfig,
  issues: PathFollowerIssue[],
  tick: number
): SanitizedPath | null {
  if (!isRecord(path)) {
    issues.push(createPathIssue("input-rejected", "path", "type", "navigation path must be an object", tick));
    return null;
  }
  if (!isRecord(path.destination)) {
    issues.push(
      createPathIssue("input-rejected", "path.destination", "type", "navigation destination must be an object", tick)
    );
    return null;
  }
  const destinationPosition = readFiniteVec3(path.destination.position);
  if (!destinationPosition) {
    issues.push(
      createPathIssue(
        "input-rejected",
        "path.destination.position",
        "finite",
        "navigation destination must contain a finite position",
        tick
      )
    );
    return null;
  }
  if (!isReadonlyArray(path.waypoints)) {
    issues.push(
      createPathIssue("input-rejected", "path.waypoints", "type", "navigation waypoints must be an array", tick)
    );
    return null;
  }
  const status = path.status ?? "ready";
  if (status !== "ready" && status !== "partial" && status !== "stale") {
    issues.push(createPathIssue("input-rejected", "path.status", "enum", "navigation path status is invalid", tick));
    return null;
  }
  const targets: SanitizedWaypointTarget[] = [];
  for (let index = 0; index < path.waypoints.length; index += 1) {
    const waypoint = path.waypoints[index] ?? null;
    if (!isRecord(waypoint)) {
      issues.push(
        createPathIssue(
          "input-rejected",
          `path.waypoints[${index}]`,
          "type",
          "navigation waypoint must be an object",
          tick
        )
      );
      return null;
    }
    const position = readFiniteVec3(waypoint.position);
    if (!position) {
      issues.push(
        createPathIssue(
          "input-rejected",
          `path.waypoints[${index}].position`,
          "finite",
          "navigation waypoint position must be finite",
          tick
        )
      );
      return null;
    }
    targets.push({
      position,
      radius: readRadius(
        typeof waypoint.radius === "number" ? waypoint.radius : undefined,
        config.waypointRadius,
        `path.waypoints[${index}].radius`,
        issues,
        tick
      ),
      final: false,
      facingYaw: null
    });
  }
  targets.push({
    position: destinationPosition,
    radius: readRadius(path.destination.radius, config.arrivalRadius, "path.destination.radius", issues, tick),
    final: true,
    facingYaw: readDestinationFacingYaw(path.destination, issues, tick)
  });
  return { key: pathKey(path, destinationPosition, targets), status, targets };
}

function readDestinationFacingYaw(
  destination: NavigationDestination,
  issues: PathFollowerIssue[],
  tick: number
): number | null {
  if (destination.facingYaw !== undefined) {
    if (Number.isFinite(destination.facingYaw)) return wrapYaw(destination.facingYaw);
    issues.push(
      createPathIssue(
        "input-rejected",
        "path.destination.facingYaw",
        "finite",
        "destination facingYaw must be finite",
        tick
      )
    );
    return null;
  }
  if (destination.facingDirection !== undefined) {
    const direction = readFiniteVec3(destination.facingDirection);
    if (direction) {
      const planar = normalizePlanarDirection(direction);
      if (planar) return yawFromPlanarDirection(planar);
    }
    issues.push(
      createPathIssue(
        "input-rejected",
        "path.destination.facingDirection",
        "finite",
        "destination facingDirection must contain a finite non-zero planar vector",
        tick
      )
    );
  }
  return null;
}

function pathKey(path: NavigationPath, destinationPosition: Vec3, targets: readonly SanitizedWaypointTarget[]): string {
  if (path.id !== undefined && isNonEmptyString(path.id)) {
    const revision = path.revision === undefined ? "" : `@${String(path.revision)}`;
    return `${path.id}${revision}`;
  }
  const rounded = targets
    .map((target) => `${roundKey(target.position[0])},${roundKey(target.position[1])},${roundKey(target.position[2])}`)
    .join("|");
  return `anon:${roundKey(destinationPosition[0])},${roundKey(destinationPosition[1])},${roundKey(destinationPosition[2])}:${rounded}`;
}

function applyLocalAvoidance(
  adapter: NavigationLocalAvoidanceAdapter,
  query: NavigationLocalAvoidanceQuery,
  issues: PathFollowerIssue[],
  tick: number
): { direction: Vec3; speedScale: number; blocked: boolean; requestRepath: boolean } {
  const fallbackDirection = normalizePlanarDirection(query.actor.desiredVelocity) ?? [0, 0, 1];
  try {
    const result = adapter(query);
    if (result === null || result === undefined) {
      return { direction: fallbackDirection, speedScale: 1, blocked: false, requestRepath: false };
    }
    if (!isRecord(result)) {
      issues.push(
        createPathIssue("adapter-failed", "localAvoidance", "type", "local avoidance result must be an object", tick)
      );
      return { direction: fallbackDirection, speedScale: 1, blocked: false, requestRepath: false };
    }
    let direction = fallbackDirection;
    if (result.planarDirection !== undefined) {
      const candidate = readFiniteVec3(result.planarDirection);
      const normalized = candidate ? normalizePlanarDirection(candidate) : null;
      if (normalized) direction = normalized;
      else
        issues.push(
          createPathIssue(
            "adapter-failed",
            "localAvoidance.planarDirection",
            "finite",
            "local avoidance planarDirection must be finite and non-zero",
            tick
          )
        );
    }
    let speedScale = 1;
    if (result.speedScale !== undefined) {
      if (Number.isFinite(result.speedScale)) speedScale = clamp01(result.speedScale);
      else
        issues.push(
          createPathIssue(
            "adapter-failed",
            "localAvoidance.speedScale",
            "finite",
            "local avoidance speedScale must be finite",
            tick
          )
        );
    }
    return {
      direction,
      speedScale,
      blocked: result.blocked === true,
      requestRepath: result.requestRepath === true
    };
  } catch (error) {
    issues.push(
      createPathIssue(
        "adapter-failed",
        "localAvoidance",
        "threw",
        error instanceof Error ? error.message : "local avoidance adapter threw",
        tick
      )
    );
    return { direction: fallbackDirection, speedScale: 1, blocked: false, requestRepath: false };
  }
}

function sanitizeDeltaSeconds(
  value: number | undefined,
  config: PathFollowerResolvedConfig,
  issues: PathFollowerIssue[],
  tick: number
): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    issues.push(
      createPathIssue(
        "input-rejected",
        "deltaSeconds",
        "finite",
        "path follower deltaSeconds must be finite and non-negative",
        tick
      )
    );
    return 0;
  }
  if (value > config.maxDeltaSeconds) {
    issues.push(
      createPathIssue(
        "bounded",
        "deltaSeconds",
        "max",
        "path follower deltaSeconds was clamped to maxDeltaSeconds",
        tick
      )
    );
    return config.maxDeltaSeconds;
  }
  return value;
}

function arrivalMagnitude(distanceToGoal: number, config: PathFollowerResolvedConfig): number {
  if (distanceToGoal <= config.arrivalRadius) return 0;
  const scaled = clamp(distanceToGoal / config.slowDownRadius, config.minMoveMagnitude, 1);
  return Number.isFinite(scaled) ? scaled : 0;
}

function turnInput(yaw: number, config: PathFollowerResolvedConfig): CharacterControllerInput {
  return {
    movement: {
      planarDirection: [0, 0, 0],
      magnitude: 0,
      gait: config.defaultGaitId,
      facing: { policy: "target-yaw", yaw, turnSpeedRadians: config.turnSpeedRadians }
    }
  };
}

function holdInput(): CharacterControllerInput {
  return {};
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

function readRadius(
  value: number | undefined,
  fallback: number,
  field: string,
  issues: PathFollowerIssue[],
  tick: number
): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return value;
  issues.push(createPathIssue("input-rejected", field, "finite", `${field} must be finite and non-negative`, tick));
  return fallback;
}

function createPathIssue(
  type: PathFollowerIssueType,
  field: string,
  code: string,
  message: string,
  tick: number
): PathFollowerIssue {
  return { type, field, code, message, tick };
}

function planarDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function planarDirection(from: Vec3, to: Vec3): Vec3 | null {
  return normalizePlanarDirection([to[0] - from[0], 0, to[2] - from[2]]);
}

function normalizePlanarDirection(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[2]);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  return [value[0] / length, 0, value[2] / length];
}

function yawFromPlanarDirection(direction: Vec3): number {
  return wrapYaw(Math.atan2(direction[0], direction[2]));
}

function angleDelta(from: number, to: number): number {
  return wrapYaw(to - from);
}

function wrapYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let wrapped = ((value + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function readFiniteVec3(value: unknown): Vec3 | null {
  if (!isTuple(value, 3)) return null;
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function copyVec3Into(target: Vec3, source: Vec3): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

function sanitizeActorRadius(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0.35;
}

function sanitizePriority(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function optionalFiniteNonNegative(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`path follower ${field} must be finite and non-negative`);
  return value;
}

function optionalFinitePositive(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`path follower ${field} must be finite and positive`);
  return value;
}

function optionalFiniteInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`path follower ${field} must be finite in range [${min}, ${max}]`);
  return value;
}

function isPathFollowerStatus(value: unknown): value is PathFollowerStatus {
  return (
    value === "idle" ||
    value === "following" ||
    value === "turning" ||
    value === "arrived" ||
    value === "blocked" ||
    value === "needs-repath" ||
    value === "invalid"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTuple(value: unknown, length: number): value is readonly unknown[] {
  return isReadonlyArray(value) && value.length === length;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function roundKey(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "nan";
}
