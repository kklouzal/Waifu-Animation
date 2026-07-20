import { type Vec3, EPSILON, addVec3, clamp, clamp01, cloneVec3, normalizeVec3, scaleVec3 } from "./math.js";

export const CHARACTER_CONTROLLER_SCHEMA_VERSION = 1;

const CHARACTER_CONTROLLER_UP = Object.freeze([0, 1, 0] as const);
const CHARACTER_CONTROLLER_FORWARD = Object.freeze([0, 0, 1] as const);
const CHARACTER_CONTROLLER_RIGHT = Object.freeze([1, 0, 0] as const);

export const CHARACTER_CONTROLLER_COORDINATE_SYSTEM = Object.freeze({
  up: CHARACTER_CONTROLLER_UP,
  forward: CHARACTER_CONTROLLER_FORWARD,
  right: CHARACTER_CONTROLLER_RIGHT,
  yawRadians: "0 faces +Z; positive yaw turns toward +X around +Y"
} as const);

export type CharacterActorId = string;
export type CharacterItemId = string;
export type CharacterSocketId = string;
export type CharacterInteractionId = string;
export type CharacterSurfaceId = string;
export type CharacterGaitId = string;

export type CharacterFacingPolicy = "hold" | "movement" | "target-yaw" | "target-direction";
export type CharacterLocomotionPhase = "grounded" | "rising" | "falling" | "landing";
export type CharacterPosture = "standing" | "crouching";
export type CharacterPosturePhase = "standing" | "entering-crouch" | "crouching" | "exiting-crouch";
export type CharacterActionKind = "pickup" | "drop" | "equip" | "unequip" | "sit" | "stand" | "use" | "custom";

export type CharacterGaitDefinition = {
  id: CharacterGaitId;
  speed: number;
  acceleration?: number;
  deceleration?: number;
  /** Clip-agnostic playback-rate hint passed through to CharacterAnimationState for the active gait. */
  animationSpeed?: number;
};

export type CharacterResolvedGaitDefinition = Readonly<Required<CharacterGaitDefinition>>;

export type CharacterControllerConfig = {
  fixedStepSeconds?: number;
  maxSubSteps?: number;
  radius?: number;
  height?: number;
  stepHeight?: number;
  groundProbeDistance?: number;
  maxSlopeAngleRadians?: number;
  acceleration?: number;
  deceleration?: number;
  airAcceleration?: number;
  turnSpeedRadians?: number;
  gravity?: number;
  jumpSpeed?: number;
  jumpBufferSeconds?: number;
  coyoteTimeSeconds?: number;
  landingDurationSeconds?: number;
  crouchDurationSeconds?: number;
  crouchSpeedMultiplier?: number;
  initialPosition?: Vec3;
  initialYaw?: number;
  initialGrounded?: boolean;
  defaultGaitId?: CharacterGaitId;
  gaits?: readonly CharacterGaitDefinition[];
};

export type CharacterControllerResolvedConfig = Readonly<{
  fixedStepSeconds: number;
  maxSubSteps: number;
  radius: number;
  height: number;
  stepHeight: number;
  groundProbeDistance: number;
  maxSlopeAngleRadians: number;
  acceleration: number;
  deceleration: number;
  airAcceleration: number;
  turnSpeedRadians: number;
  gravity: number;
  jumpSpeed: number;
  jumpBufferSeconds: number;
  coyoteTimeSeconds: number;
  landingDurationSeconds: number;
  crouchDurationSeconds: number;
  crouchSpeedMultiplier: number;
  defaultGaitId: CharacterGaitId;
  gaits: readonly CharacterResolvedGaitDefinition[];
}>;

export type CharacterMovementIntent = {
  /** World-space XZ planar direction. Y is ignored but still required to be finite. Length supplies magnitude when magnitude is omitted. */
  planarDirection?: Vec3;
  /** Optional normalized request strength. Omitted means clamp(length(planarDirection.xz), 0, 1). */
  magnitude?: number;
  /** Gait id from controller config, e.g. walk/run/sprint. Unknown ids are rejected and fall back to the default gait. */
  gait?: CharacterGaitId;
  /** Facing policy is independent from movement; default is movement when there is planar input, otherwise hold. */
  facing?: CharacterFacingIntent;
};

export type CharacterFacingIntent = {
  policy?: CharacterFacingPolicy;
  yaw?: number;
  direction?: Vec3;
  turnSpeedRadians?: number;
};

export type CharacterPostureIntent = {
  crouch?: boolean;
};

export type CharacterJumpIntent = {
  commandId: string;
};

export type CharacterActionIntent = {
  commandId: string;
  kind: CharacterActionKind;
  itemId?: CharacterItemId;
  socketId?: CharacterSocketId;
  interactionId?: CharacterInteractionId;
  targetActorId?: CharacterActorId;
};

export type CharacterControllerInput = {
  movement?: CharacterMovementIntent;
  posture?: CharacterPostureIntent;
  jump?: CharacterJumpIntent;
  action?: CharacterActionIntent;
};

export type CharacterGroundState = {
  grounded: boolean;
  point: Vec3;
  normal: Vec3;
  slopeAngleRadians: number;
  platformVelocity: Vec3;
  surfaceId?: CharacterSurfaceId;
};

export type CharacterControllerSnapshot = {
  schemaVersion: typeof CHARACTER_CONTROLLER_SCHEMA_VERSION;
  tick: number;
  accumulatorSeconds: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  locomotionPhase: CharacterLocomotionPhase;
  posture: CharacterPosture;
  posturePhase: CharacterPosturePhase;
  crouchAlpha: number;
  crouchTarget: CharacterPosture;
  grounded: CharacterGroundState;
  jumpBufferSeconds: number;
  /** Input-edge latch for a valid jump command that arrived before the next fixed substep. */
  pendingJumpEdge: boolean;
  coyoteSeconds: number;
  landingSeconds: number;
  gaitId: CharacterGaitId;
  moveMagnitude: number;
  desiredSpeed: number;
  lastJumpCommandId?: string;
  lastActionCommandId?: string;
};

export type CharacterCapsuleQuery = {
  /** World-space capsule bottom/feet-center position. This is not the geometric capsule center. */
  position: Vec3;
  velocity: Vec3;
  radius: number;
  height: number;
  up: Vec3;
  tick: number;
  deltaSeconds: number;
};

export type CharacterGroundQuery = CharacterCapsuleQuery & {
  probeDistance: number;
  maxSlopeAngleRadians: number;
  stepHeight: number;
};

export type CharacterGroundHit = {
  grounded: boolean;
  /** World-space support point below the capsule bottom/feet center. Only its Y value is used for vertical snap. */
  point?: Vec3;
  normal?: Vec3;
  /** Vertical gap from capsule bottom/feet center to point. Positive means above support. */
  distance?: number;
  slopeAngleRadians?: number;
  platformVelocity?: Vec3;
  surfaceId?: CharacterSurfaceId;
};

export type CharacterSweepQuery = CharacterCapsuleQuery & {
  from: Vec3;
  displacement: Vec3;
  maxSlopeAngleRadians: number;
  stepHeight: number;
};

export type CharacterSweepHit = {
  position?: Vec3;
  normal?: Vec3;
  travelFraction?: number;
  /** Optional support result from sweep-only adapters; used when queryGround is absent or unusable. */
  ground?: CharacterGroundHit;
  surfaceId?: CharacterSurfaceId;
  platformVelocity?: Vec3;
};

export type CharacterMovementQuery = CharacterSweepQuery & {
  desiredPosition: Vec3;
  grounded: CharacterGroundState;
};

export type CharacterMovementResolution = {
  position: Vec3;
  velocity?: Vec3;
  ground?: CharacterGroundHit;
  hit?: CharacterSweepHit;
};

export type CharacterWorldAdapter = {
  /** Probe current support below the capsule. The core interprets finite Y-up results only; physics ownership stays in the adapter. */
  queryGround?: (query: CharacterGroundQuery) => CharacterGroundHit | null | undefined;
  /** Optional low-level capsule sweep for consumers that do not provide resolveMovement. */
  sweepCapsule?: (query: CharacterSweepQuery) => CharacterSweepHit | null | undefined;
  /** Optional high-level motion resolver. Returning null/undefined means use the core fallback integrator. */
  resolveMovement?: (query: CharacterMovementQuery) => CharacterMovementResolution | null | undefined;
};

export type FlatGroundCharacterWorldOptions = {
  y?: number;
  normal?: Vec3;
  platformVelocity?: Vec3;
  surfaceId?: CharacterSurfaceId;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
};

export type CharacterControllerEventType =
  | "input-rejected"
  | "catch-up-capped"
  | "action-command"
  | "jump-buffered"
  | "jump-started"
  | "left-ground"
  | "landed"
  | "posture-transition-start"
  | "posture-transition-complete"
  | "world-adapter-failed";

export type CharacterControllerEvent = {
  type: CharacterControllerEventType;
  tick: number;
  field?: string;
  code?: string;
  message?: string;
  from?: string;
  to?: string;
  command?: CharacterActionIntent;
  surfaceId?: CharacterSurfaceId;
};

export type CharacterAnimationTransition = {
  type: "locomotion" | "posture";
  tick: number;
  from: string;
  to: string;
};

export type CharacterAnimationState = {
  coordinateSystem: typeof CHARACTER_CONTROLLER_COORDINATE_SYSTEM;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  facingForward: Vec3;
  planarSpeed: number;
  verticalSpeed: number;
  speedRatio: number;
  animationSpeed: number;
  moveMagnitude: number;
  desiredSpeed: number;
  gaitId: CharacterGaitId;
  grounded: boolean;
  groundNormal: Vec3;
  locomotionPhase: CharacterLocomotionPhase;
  posture: CharacterPosture;
  posturePhase: CharacterPosturePhase;
  crouchAlpha: number;
  events: CharacterControllerEvent[];
  transitions: CharacterAnimationTransition[];
};

export type CharacterControllerStepResult = {
  substeps: number;
  fixedStepSeconds: number;
  remainderSeconds: number;
  cappedDeltaSeconds: number;
  state: CharacterControllerSnapshot;
  animation: CharacterAnimationState;
  events: CharacterControllerEvent[];
  transitions: CharacterAnimationTransition[];
};

type MutableCharacterState = Omit<CharacterControllerSnapshot, "schemaVersion" | "grounded"> & {
  grounded: CharacterGroundState;
};

type SanitizedMovementIntent = {
  direction: Vec3;
  magnitude: number;
  gait: CharacterResolvedGaitDefinition;
  facingPolicy: CharacterFacingPolicy;
  facingYaw?: number;
  turnSpeedRadians: number;
};

type GroundingCandidate = {
  ground: CharacterGroundState;
  snapToGround: boolean;
};

type GroundingCandidateResult = {
  candidate: GroundingCandidate | null;
  invalid: boolean;
};

type SanitizedInput = {
  movement: SanitizedMovementIntent;
  crouchTarget: CharacterPosture;
  jumpCommandId?: string;
  action?: CharacterActionIntent;
};

const DEFAULT_GAITS = [
  { id: "walk", speed: 1.4, acceleration: 8, deceleration: 10, animationSpeed: 1 },
  { id: "run", speed: 3.8, acceleration: 10, deceleration: 12, animationSpeed: 1 },
  { id: "sprint", speed: 5.6, acceleration: 12, deceleration: 14, animationSpeed: 1 }
] as const satisfies readonly Required<CharacterGaitDefinition>[];

const DEFAULT_CONFIG = {
  fixedStepSeconds: 1 / 60,
  maxSubSteps: 8,
  radius: 0.35,
  height: 1.65,
  stepHeight: 0.35,
  groundProbeDistance: 0.08,
  maxSlopeAngleRadians: Math.PI / 3,
  acceleration: 8,
  deceleration: 10,
  airAcceleration: 3,
  turnSpeedRadians: Math.PI * 8,
  gravity: 9.81,
  jumpSpeed: 4.5,
  jumpBufferSeconds: 0.12,
  coyoteTimeSeconds: 0.1,
  landingDurationSeconds: 0.12,
  crouchDurationSeconds: 0.2,
  crouchSpeedMultiplier: 0.5,
  defaultGaitId: "walk"
} as const;

const MAX_CONFIGURED_SUBSTEPS = 240;

const VALID_FACING_POLICIES = new Set<CharacterFacingPolicy>(["hold", "movement", "target-yaw", "target-direction"]);
const VALID_ACTION_KINDS = new Set<CharacterActionKind>([
  "pickup",
  "drop",
  "equip",
  "unequip",
  "sit",
  "stand",
  "use",
  "custom"
]);

export class CharacterController {
  readonly config: CharacterControllerResolvedConfig;
  private readonly gaitById = new Map<CharacterGaitId, CharacterResolvedGaitDefinition>();
  private readonly state: MutableCharacterState;
  private world: CharacterWorldAdapter | undefined;

  constructor(config: CharacterControllerConfig = {}, world?: CharacterWorldAdapter) {
    this.config = resolveCharacterControllerConfig(config);
    for (const gait of this.config.gaits) this.gaitById.set(gait.id, gait);
    this.world = world;
    const initialPosition = readConfigVec3(config.initialPosition, [0, 0, 0], "initialPosition");
    const initialYaw = optionalFinite(config.initialYaw, 0, "initialYaw");
    const initialGrounded = config.initialGrounded ?? true;
    if (typeof initialGrounded !== "boolean") throw new Error("character controller initialGrounded must be boolean");
    const defaultGait = this.readGait(this.config.defaultGaitId);
    this.state = {
      tick: 0,
      accumulatorSeconds: 0,
      position: initialPosition,
      velocity: [0, 0, 0],
      yaw: wrapYaw(initialYaw),
      locomotionPhase: initialGrounded ? "grounded" : "falling",
      posture: "standing",
      posturePhase: "standing",
      crouchAlpha: 0,
      crouchTarget: "standing",
      grounded: initialGrounded ? createGroundState(initialPosition, [0, 1, 0]) : createAirGroundState(initialPosition),
      jumpBufferSeconds: 0,
      pendingJumpEdge: false,
      coyoteSeconds: initialGrounded ? this.config.coyoteTimeSeconds : 0,
      landingSeconds: 0,
      gaitId: defaultGait.id,
      moveMagnitude: 0,
      desiredSpeed: 0
    };
  }

  setWorldAdapter(world: CharacterWorldAdapter | undefined): void {
    this.world = world;
  }

  update(
    deltaSeconds: number,
    input: CharacterControllerInput = {},
    world: CharacterWorldAdapter | undefined = this.world
  ): CharacterControllerStepResult {
    const events: CharacterControllerEvent[] = [];
    const transitions: CharacterAnimationTransition[] = [];
    const sanitizedInput = this.sanitizeInput(input, events);
    const finiteDelta = sanitizeDeltaSeconds(deltaSeconds, events, this.state.tick);
    const maxCatchUpSeconds = this.config.fixedStepSeconds * this.config.maxSubSteps;
    const requestedCatchUp = this.state.accumulatorSeconds + finiteDelta;
    const cappedDeltaSeconds = Math.min(requestedCatchUp, maxCatchUpSeconds);
    if (requestedCatchUp - cappedDeltaSeconds > EPSILON) {
      events.push({
        type: "catch-up-capped",
        tick: this.state.tick,
        field: "deltaSeconds",
        code: "max-substeps",
        message: "character controller discarded catch-up time beyond maxSubSteps"
      });
    }
    this.state.accumulatorSeconds = cappedDeltaSeconds;

    if (this.applyInputEdges(sanitizedInput, events)) this.state.pendingJumpEdge = true;

    let substeps = 0;
    while (
      this.state.accumulatorSeconds + EPSILON >= this.config.fixedStepSeconds &&
      substeps < this.config.maxSubSteps
    ) {
      this.state.accumulatorSeconds = Math.max(0, this.state.accumulatorSeconds - this.config.fixedStepSeconds);
      substeps += 1;
      const jumpEdgePending = this.state.pendingJumpEdge;
      this.advanceFixedStep(
        this.config.fixedStepSeconds,
        sanitizedInput.movement,
        jumpEdgePending,
        world,
        events,
        transitions
      );
      this.state.pendingJumpEdge = false;
    }

    const snapshot = this.snapshot();
    const animation = this.animationState(events, transitions);
    return {
      substeps,
      fixedStepSeconds: this.config.fixedStepSeconds,
      remainderSeconds: this.state.accumulatorSeconds,
      cappedDeltaSeconds,
      state: snapshot,
      animation,
      events,
      transitions
    };
  }

  snapshot(): CharacterControllerSnapshot {
    return cloneSnapshot(this.state);
  }

  restore(snapshot: CharacterControllerSnapshot): void {
    const restored = validateSnapshot(snapshot, this.config);
    copyVec3Into(this.state.position, restored.position);
    copyVec3Into(this.state.velocity, restored.velocity);
    this.state.tick = restored.tick;
    this.state.accumulatorSeconds = restored.accumulatorSeconds;
    this.state.yaw = restored.yaw;
    this.state.locomotionPhase = restored.locomotionPhase;
    this.state.posture = restored.posture;
    this.state.posturePhase = restored.posturePhase;
    this.state.crouchAlpha = restored.crouchAlpha;
    this.state.crouchTarget = restored.crouchTarget;
    this.state.grounded = cloneGroundState(restored.grounded);
    this.state.jumpBufferSeconds = restored.jumpBufferSeconds;
    this.state.pendingJumpEdge = restored.pendingJumpEdge;
    this.state.coyoteSeconds = restored.coyoteSeconds;
    this.state.landingSeconds = restored.landingSeconds;
    this.state.gaitId = restored.gaitId;
    this.state.moveMagnitude = restored.moveMagnitude;
    this.state.desiredSpeed = restored.desiredSpeed;
    if (restored.lastJumpCommandId !== undefined) this.state.lastJumpCommandId = restored.lastJumpCommandId;
    else delete this.state.lastJumpCommandId;
    if (restored.lastActionCommandId !== undefined) this.state.lastActionCommandId = restored.lastActionCommandId;
    else delete this.state.lastActionCommandId;
  }

  private sanitizeInput(input: CharacterControllerInput, events: CharacterControllerEvent[]): SanitizedInput {
    if (!isRecord(input)) {
      events.push(
        createInputRejectedEvent(this.state.tick, "input", "type", "character controller input must be an object")
      );
      return { movement: this.defaultMovementIntent(), crouchTarget: this.state.crouchTarget };
    }
    const movement = this.sanitizeMovementIntent(input.movement, events);
    const crouchTarget = sanitizePostureTarget(input.posture, this.state.crouchTarget, events, this.state.tick);
    const jumpCommandId = sanitizeCommandId(input.jump, "jump.commandId", events, this.state.tick);
    const action = sanitizeActionIntent(input.action, events, this.state.tick);
    return {
      movement,
      crouchTarget,
      ...(jumpCommandId !== undefined ? { jumpCommandId } : {}),
      ...(action ? { action } : {})
    };
  }

  private sanitizeMovementIntent(
    movement: CharacterMovementIntent | undefined,
    events: CharacterControllerEvent[]
  ): SanitizedMovementIntent {
    if (movement !== undefined && !isRecord(movement)) {
      events.push(
        createInputRejectedEvent(this.state.tick, "movement", "type", "character movement intent must be an object")
      );
      return this.defaultMovementIntent();
    }
    const rawDirection = movement?.planarDirection;
    let direction: Vec3 = [0, 0, 0];
    let directionLength = 0;
    if (rawDirection !== undefined) {
      const finiteDirection = readFiniteVec3(rawDirection);
      if (finiteDirection) {
        directionLength = Math.hypot(finiteDirection[0], finiteDirection[2]);
        if (directionLength > EPSILON)
          direction = [finiteDirection[0] / directionLength, 0, finiteDirection[2] / directionLength];
      } else {
        events.push(
          createInputRejectedEvent(
            this.state.tick,
            "movement.planarDirection",
            "finite",
            "movement planarDirection must contain three finite numbers"
          )
        );
      }
    }
    let magnitude = clamp(directionLength, 0, 1);
    if (movement?.magnitude !== undefined) {
      if (Number.isFinite(movement.magnitude)) magnitude = clamp01(movement.magnitude);
      else {
        events.push(
          createInputRejectedEvent(this.state.tick, "movement.magnitude", "finite", "movement magnitude must be finite")
        );
      }
    }
    if (directionLength <= EPSILON) magnitude = 0;

    const gait = this.sanitizeGaitRequest(movement?.gait, events);
    const facing = this.sanitizeFacingIntent(movement?.facing, direction, magnitude, events);
    return { direction, magnitude, gait, ...facing };
  }

  private defaultMovementIntent(): SanitizedMovementIntent {
    const gait = this.readGait(this.config.defaultGaitId);
    return {
      direction: [0, 0, 0],
      magnitude: 0,
      gait,
      facingPolicy: "hold",
      turnSpeedRadians: this.config.turnSpeedRadians
    };
  }

  private sanitizeGaitRequest(
    gaitId: CharacterGaitId | undefined,
    events: CharacterControllerEvent[]
  ): Required<CharacterGaitDefinition> {
    if (gaitId === undefined) return this.readGait(this.config.defaultGaitId);
    if (!isNonEmptyString(gaitId)) {
      events.push(
        createInputRejectedEvent(this.state.tick, "movement.gait", "id", "movement gait id must be a string")
      );
      return this.readGait(this.config.defaultGaitId);
    }
    const gait = this.gaitById.get(gaitId);
    if (!gait) {
      events.push(
        createInputRejectedEvent(
          this.state.tick,
          "movement.gait",
          "unknown",
          `movement gait ${gaitId} is not configured`
        )
      );
      return this.readGait(this.config.defaultGaitId);
    }
    return gait;
  }

  private sanitizeFacingIntent(
    facing: CharacterFacingIntent | undefined,
    direction: Vec3,
    magnitude: number,
    events: CharacterControllerEvent[]
  ): Pick<SanitizedMovementIntent, "facingPolicy" | "facingYaw" | "turnSpeedRadians"> {
    if (facing !== undefined && !isRecord(facing)) {
      events.push(
        createInputRejectedEvent(this.state.tick, "movement.facing", "type", "facing intent must be an object")
      );
      return {
        facingPolicy: magnitude > EPSILON ? "movement" : "hold",
        turnSpeedRadians: this.config.turnSpeedRadians
      };
    }
    const rawPolicy = facing?.policy;
    const policy = rawPolicy === undefined ? (magnitude > EPSILON ? "movement" : "hold") : rawPolicy;
    if (!VALID_FACING_POLICIES.has(policy)) {
      events.push(createInputRejectedEvent(this.state.tick, "movement.facing.policy", "enum", "unknown facing policy"));
      return {
        facingPolicy: magnitude > EPSILON ? "movement" : "hold",
        turnSpeedRadians: this.config.turnSpeedRadians
      };
    }
    const turnSpeedRadians = sanitizeOptionalFiniteNonNegative(
      facing?.turnSpeedRadians,
      this.config.turnSpeedRadians,
      "movement.facing.turnSpeedRadians",
      events,
      this.state.tick
    );
    if (policy === "target-yaw") {
      const yaw = facing?.yaw;
      if (yaw !== undefined && Number.isFinite(yaw))
        return { facingPolicy: policy, facingYaw: wrapYaw(yaw), turnSpeedRadians };
      events.push(
        createInputRejectedEvent(this.state.tick, "movement.facing.yaw", "finite", "target yaw must be finite")
      );
      return { facingPolicy: "hold", turnSpeedRadians };
    }
    if (policy === "target-direction") {
      const finiteDirection = readFiniteVec3(facing?.direction);
      if (finiteDirection) {
        const planarLength = Math.hypot(finiteDirection[0], finiteDirection[2]);
        if (planarLength > EPSILON) {
          return {
            facingPolicy: policy,
            facingYaw: yawFromPlanarDirection([
              finiteDirection[0] / planarLength,
              0,
              finiteDirection[2] / planarLength
            ]),
            turnSpeedRadians
          };
        }
      }
      events.push(
        createInputRejectedEvent(
          this.state.tick,
          "movement.facing.direction",
          "finite",
          "target direction must contain a non-zero finite planar vector"
        )
      );
      return { facingPolicy: "hold", turnSpeedRadians };
    }
    return {
      facingPolicy: policy,
      ...(policy === "movement" && magnitude > EPSILON ? { facingYaw: yawFromPlanarDirection(direction) } : {}),
      turnSpeedRadians
    };
  }

  private applyInputEdges(input: SanitizedInput, events: CharacterControllerEvent[]): boolean {
    let jumpEdgePending = false;
    if (input.action && input.action.commandId !== this.state.lastActionCommandId) {
      this.state.lastActionCommandId = input.action.commandId;
      events.push({ type: "action-command", tick: this.state.tick, command: input.action });
    }
    if (input.jumpCommandId !== undefined && input.jumpCommandId !== this.state.lastJumpCommandId) {
      this.state.lastJumpCommandId = input.jumpCommandId;
      this.state.jumpBufferSeconds = this.config.jumpBufferSeconds;
      jumpEdgePending = true;
      events.push({ type: "jump-buffered", tick: this.state.tick });
    }
    if (input.crouchTarget !== this.state.crouchTarget) {
      const from = this.state.posturePhase;
      this.state.crouchTarget = input.crouchTarget;
      this.state.posturePhase = input.crouchTarget === "crouching" ? "entering-crouch" : "exiting-crouch";
      events.push({
        type: "posture-transition-start",
        tick: this.state.tick,
        from,
        to: this.state.posturePhase
      });
    }
    return jumpEdgePending;
  }

  private advanceFixedStep(
    deltaSeconds: number,
    movement: SanitizedMovementIntent,
    jumpEdgePending: boolean,
    world: CharacterWorldAdapter | undefined,
    events: CharacterControllerEvent[],
    transitions: CharacterAnimationTransition[]
  ): void {
    this.state.tick += 1;
    const startedGrounded = this.state.grounded.grounded;
    if (this.state.grounded.grounded) this.state.coyoteSeconds = this.config.coyoteTimeSeconds;
    else this.state.coyoteSeconds = Math.max(0, this.state.coyoteSeconds - deltaSeconds);

    this.advancePosture(deltaSeconds, events, transitions);
    const leftGroundEmitted = this.consumeJumpBufferIfPossible(events, transitions, jumpEdgePending);
    this.advanceFacing(deltaSeconds, movement);
    this.advancePlanarVelocity(deltaSeconds, movement);
    this.advanceVerticalVelocity(deltaSeconds, transitions);
    const movementGround = this.integratePosition(deltaSeconds, world, events);
    const landedThisStep = this.refreshGroundingAfterMove(
      deltaSeconds,
      world,
      events,
      transitions,
      startedGrounded,
      leftGroundEmitted,
      movementGround
    );
    this.finishTimers(deltaSeconds, transitions, landedThisStep);
  }

  private advancePosture(
    deltaSeconds: number,
    events: CharacterControllerEvent[],
    transitions: CharacterAnimationTransition[]
  ): void {
    const previousPhase = this.state.posturePhase;
    const targetAlpha = this.state.crouchTarget === "crouching" ? 1 : 0;
    if (Math.abs(this.state.crouchAlpha - targetAlpha) <= EPSILON) {
      this.state.crouchAlpha = targetAlpha;
      this.state.posture = targetAlpha >= 1 ? "crouching" : "standing";
      this.state.posturePhase = this.state.posture;
      return;
    }
    const duration = this.config.crouchDurationSeconds;
    const step = duration <= EPSILON ? 1 : deltaSeconds / duration;
    this.state.crouchAlpha = moveTowards(this.state.crouchAlpha, targetAlpha, step);
    this.state.posturePhase = this.state.crouchTarget === "crouching" ? "entering-crouch" : "exiting-crouch";
    if (Math.abs(this.state.crouchAlpha - targetAlpha) <= EPSILON) {
      this.state.crouchAlpha = targetAlpha;
      this.state.posture = targetAlpha >= 1 ? "crouching" : "standing";
      this.state.posturePhase = this.state.posture;
      events.push({
        type: "posture-transition-complete",
        tick: this.state.tick,
        from: previousPhase,
        to: this.state.posturePhase
      });
    }
    if (previousPhase !== this.state.posturePhase) {
      transitions.push({ type: "posture", tick: this.state.tick, from: previousPhase, to: this.state.posturePhase });
    }
  }

  private consumeJumpBufferIfPossible(
    events: CharacterControllerEvent[],
    transitions: CharacterAnimationTransition[],
    jumpEdgePending: boolean
  ): boolean {
    if (!jumpEdgePending && this.state.jumpBufferSeconds <= EPSILON) return false;
    if (!this.state.grounded.grounded && this.state.coyoteSeconds <= EPSILON) return false;
    const wasGrounded = this.state.grounded.grounded;
    this.state.velocity[1] = this.config.jumpSpeed;
    this.state.grounded = createAirGroundState(this.state.position);
    this.state.jumpBufferSeconds = 0;
    this.state.coyoteSeconds = 0;
    this.state.landingSeconds = 0;
    events.push({ type: "jump-started", tick: this.state.tick });
    if (wasGrounded) events.push({ type: "left-ground", tick: this.state.tick, code: "jump" });
    this.setLocomotionPhase("rising", transitions);
    return wasGrounded;
  }

  private advanceFacing(deltaSeconds: number, movement: SanitizedMovementIntent): void {
    if (movement.facingPolicy === "hold" || movement.facingYaw === undefined) return;
    const maxTurn = movement.turnSpeedRadians * deltaSeconds;
    this.state.yaw = rotateYawTowards(this.state.yaw, movement.facingYaw, maxTurn);
  }

  private advancePlanarVelocity(deltaSeconds: number, movement: SanitizedMovementIntent): void {
    const crouchScale = 1 - (1 - this.config.crouchSpeedMultiplier) * this.state.crouchAlpha;
    const desiredSpeed = movement.gait.speed * movement.magnitude * crouchScale;
    const targetX = movement.direction[0] * desiredSpeed;
    const targetZ = movement.direction[2] * desiredSpeed;
    const deltaX = targetX - this.state.velocity[0];
    const deltaZ = targetZ - this.state.velocity[2];
    const deltaLength = Math.hypot(deltaX, deltaZ);
    const currentSpeed = Math.hypot(this.state.velocity[0], this.state.velocity[2]);
    const acceleration = this.state.grounded.grounded
      ? desiredSpeed > currentSpeed
        ? movement.gait.acceleration
        : movement.gait.deceleration
      : this.config.airAcceleration;
    const maxChange = acceleration * deltaSeconds;
    if (deltaLength <= maxChange || deltaLength <= EPSILON) {
      this.state.velocity[0] = targetX;
      this.state.velocity[2] = targetZ;
    } else {
      const scale = maxChange / deltaLength;
      this.state.velocity[0] += deltaX * scale;
      this.state.velocity[2] += deltaZ * scale;
    }
    this.state.gaitId = movement.gait.id;
    this.state.moveMagnitude = movement.magnitude;
    this.state.desiredSpeed = desiredSpeed;
  }

  private advanceVerticalVelocity(deltaSeconds: number, transitions: CharacterAnimationTransition[]): void {
    if (this.state.grounded.grounded) {
      if (this.state.velocity[1] < 0) this.state.velocity[1] = 0;
      return;
    }
    this.state.velocity[1] -= this.config.gravity * deltaSeconds;
    if (this.state.velocity[1] > EPSILON) this.setLocomotionPhase("rising", transitions);
    else this.setLocomotionPhase("falling", transitions);
  }

  private integratePosition(
    deltaSeconds: number,
    world: CharacterWorldAdapter | undefined,
    events: CharacterControllerEvent[]
  ): GroundingCandidate | null {
    const platformVelocity = this.state.grounded.grounded ? this.state.grounded.platformVelocity : ([0, 0, 0] as Vec3);
    const from = cloneVec3(this.state.position);
    const displacement: Vec3 = [
      (this.state.velocity[0] + platformVelocity[0]) * deltaSeconds,
      (this.state.velocity[1] + platformVelocity[1]) * deltaSeconds,
      (this.state.velocity[2] + platformVelocity[2]) * deltaSeconds
    ];
    const desiredPosition = addVec3(from, displacement);
    const query: CharacterMovementQuery = {
      position: cloneVec3(this.state.position),
      velocity: cloneVec3(this.state.velocity),
      radius: this.config.radius,
      height: this.config.height,
      up: cloneVec3(CHARACTER_CONTROLLER_COORDINATE_SYSTEM.up),
      tick: this.state.tick,
      deltaSeconds,
      from,
      displacement,
      maxSlopeAngleRadians: this.config.maxSlopeAngleRadians,
      stepHeight: this.config.stepHeight,
      desiredPosition: cloneVec3(desiredPosition),
      grounded: cloneGroundState(this.state.grounded)
    };
    const resolution = resolveWorldMovement(world, query, events, this.state.tick);
    const nextPosition = resolution?.position ?? desiredPosition;
    copyVec3Into(this.state.position, nextPosition);
    if (resolution?.velocity) copyVec3Into(this.state.velocity, resolution.velocity);
    const explicitGround =
      resolution?.ground !== undefined
        ? groundCandidateFromHit(
            resolution.ground,
            this.state.position,
            this.config,
            events,
            this.state.tick,
            "resolveMovement.ground"
          ).candidate
        : null;
    if (explicitGround !== null) return explicitGround;
    if (resolution?.hit) {
      const sweepGround = sweepGroundCandidate(
        resolution.hit,
        this.state.position,
        this.config,
        events,
        this.state.tick
      );
      if (sweepGround !== null) return sweepGround;
    }
    return null;
  }

  private refreshGroundingAfterMove(
    deltaSeconds: number,
    world: CharacterWorldAdapter | undefined,
    events: CharacterControllerEvent[],
    transitions: CharacterAnimationTransition[],
    startedGrounded: boolean,
    leftGroundAlreadyEmitted: boolean,
    movementGround: GroundingCandidate | null
  ): boolean {
    const previousGrounded = this.state.grounded.grounded;
    const hit = queryWorldGround(world, this.groundQuery(deltaSeconds), events, this.state.tick);
    const queryGround = hit
      ? groundCandidateFromHit(hit, this.state.position, this.config, events, this.state.tick, "queryGround")
      : null;
    const ground = queryGround?.candidate ?? (hit === null || queryGround?.invalid === true ? movementGround : null);
    if (ground && this.state.velocity[1] <= EPSILON) {
      const wasAirborne = !previousGrounded;
      this.state.grounded = ground.ground;
      if (ground.snapToGround) this.state.position[1] = ground.ground.point[1];
      if (this.state.velocity[1] < 0) this.state.velocity[1] = 0;
      if (wasAirborne) {
        events.push({
          type: "landed",
          tick: this.state.tick,
          ...(ground.ground.surfaceId !== undefined ? { surfaceId: ground.ground.surfaceId } : {})
        });
        this.state.landingSeconds = this.config.landingDurationSeconds;
        this.setLocomotionPhase(this.state.landingSeconds > EPSILON ? "landing" : "grounded", transitions);
        return true;
      } else if (this.state.landingSeconds <= EPSILON) {
        this.setLocomotionPhase("grounded", transitions);
      }
      return false;
    }
    this.state.grounded = createAirGroundState(this.state.position);
    if (!leftGroundAlreadyEmitted && (previousGrounded || startedGrounded)) {
      events.push({ type: "left-ground", tick: this.state.tick });
    }
    this.setLocomotionPhase(this.state.velocity[1] > EPSILON ? "rising" : "falling", transitions);
    return false;
  }

  private finishTimers(
    deltaSeconds: number,
    transitions: CharacterAnimationTransition[],
    landedThisStep: boolean
  ): void {
    if (this.state.jumpBufferSeconds > 0)
      this.state.jumpBufferSeconds = Math.max(0, this.state.jumpBufferSeconds - deltaSeconds);
    if (!landedThisStep && this.state.grounded.grounded && this.state.landingSeconds > 0) {
      this.state.landingSeconds = Math.max(0, this.state.landingSeconds - deltaSeconds);
      if (this.state.landingSeconds <= EPSILON) this.setLocomotionPhase("grounded", transitions);
    }
  }

  private groundQuery(deltaSeconds: number): CharacterGroundQuery {
    return {
      position: cloneVec3(this.state.position),
      velocity: cloneVec3(this.state.velocity),
      radius: this.config.radius,
      height: this.config.height,
      up: cloneVec3(CHARACTER_CONTROLLER_COORDINATE_SYSTEM.up),
      tick: this.state.tick,
      deltaSeconds,
      probeDistance: this.config.groundProbeDistance,
      maxSlopeAngleRadians: this.config.maxSlopeAngleRadians,
      stepHeight: this.config.stepHeight
    };
  }

  private setLocomotionPhase(next: CharacterLocomotionPhase, transitions: CharacterAnimationTransition[]): void {
    if (this.state.locomotionPhase === next) return;
    const previous = this.state.locomotionPhase;
    this.state.locomotionPhase = next;
    transitions.push({ type: "locomotion", tick: this.state.tick, from: previous, to: next });
  }

  private animationState(
    events: CharacterControllerEvent[],
    transitions: CharacterAnimationTransition[]
  ): CharacterAnimationState {
    const gait = this.readGait(this.state.gaitId);
    const planarSpeed = Math.hypot(this.state.velocity[0], this.state.velocity[2]);
    return {
      coordinateSystem: CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
      position: cloneVec3(this.state.position),
      velocity: cloneVec3(this.state.velocity),
      yaw: this.state.yaw,
      facingForward: yawToForward(this.state.yaw),
      planarSpeed,
      verticalSpeed: this.state.velocity[1],
      speedRatio: gait.speed > EPSILON ? clamp(planarSpeed / gait.speed, 0, 1.5) : 0,
      animationSpeed: gait.animationSpeed,
      moveMagnitude: this.state.moveMagnitude,
      desiredSpeed: this.state.desiredSpeed,
      gaitId: this.state.gaitId,
      grounded: this.state.grounded.grounded,
      groundNormal: cloneVec3(this.state.grounded.normal),
      locomotionPhase: this.state.locomotionPhase,
      posture: this.state.posture,
      posturePhase: this.state.posturePhase,
      crouchAlpha: this.state.crouchAlpha,
      events: events.map(cloneEvent),
      transitions: transitions.map((transition) => ({ ...transition }))
    };
  }

  private readGait(id: CharacterGaitId): CharacterResolvedGaitDefinition {
    return this.gaitById.get(id) ?? this.config.gaits[0]!;
  }
}

export function createFlatGroundCharacterWorld(options: FlatGroundCharacterWorldOptions = {}): CharacterWorldAdapter {
  const groundY = optionalFinite(options.y, 0, "flat ground y");
  const normal = normalizeVec3(readConfigVec3(options.normal, [0, 1, 0], "flat ground normal"), [0, 1, 0]);
  const platformVelocity = readConfigVec3(options.platformVelocity, [0, 0, 0], "flat ground platformVelocity");
  const minX = optionalFinite(options.minX, Number.NEGATIVE_INFINITY, "flat ground minX");
  const maxX = optionalFinite(options.maxX, Number.POSITIVE_INFINITY, "flat ground maxX");
  const minZ = optionalFinite(options.minZ, Number.NEGATIVE_INFINITY, "flat ground minZ");
  const maxZ = optionalFinite(options.maxZ, Number.POSITIVE_INFINITY, "flat ground maxZ");
  const surfaceId = options.surfaceId;
  if (surfaceId !== undefined && !isNonEmptyString(surfaceId))
    throw new Error("flat ground surfaceId must be a string");

  const contains = (position: Vec3): boolean =>
    position[0] >= minX && position[0] <= maxX && position[2] >= minZ && position[2] <= maxZ;

  return {
    queryGround(query) {
      if (!contains(query.position)) return { grounded: false };
      const distance = query.position[1] - groundY;
      const grounded = distance <= query.probeDistance && distance >= -query.stepHeight;
      return {
        grounded,
        point: [query.position[0], groundY, query.position[2]],
        normal: cloneVec3(normal),
        distance,
        slopeAngleRadians: slopeAngleFromNormal(normal),
        platformVelocity: cloneVec3(platformVelocity),
        ...(surfaceId !== undefined ? { surfaceId } : {})
      };
    },
    resolveMovement(query) {
      const position = cloneVec3(query.desiredPosition);
      const velocity = cloneVec3(query.velocity);
      if (contains(position) && position[1] < groundY) {
        position[1] = groundY;
        if (velocity[1] < 0) velocity[1] = 0;
      }
      return { position, velocity };
    }
  };
}

export function resolveCharacterControllerConfig(
  config: CharacterControllerConfig = {}
): CharacterControllerResolvedConfig {
  if (!isRecord(config)) throw new Error("character controller config must be an object");
  const acceleration = optionalFiniteNonNegative(config.acceleration, DEFAULT_CONFIG.acceleration, "acceleration");
  const deceleration = optionalFiniteNonNegative(config.deceleration, DEFAULT_CONFIG.deceleration, "deceleration");
  const resolved: Omit<CharacterControllerResolvedConfig, "gaits" | "defaultGaitId"> = {
    fixedStepSeconds: optionalFinitePositive(
      config.fixedStepSeconds,
      DEFAULT_CONFIG.fixedStepSeconds,
      "fixedStepSeconds"
    ),
    maxSubSteps: optionalPositiveInteger(
      config.maxSubSteps,
      DEFAULT_CONFIG.maxSubSteps,
      "maxSubSteps",
      MAX_CONFIGURED_SUBSTEPS
    ),
    radius: optionalFinitePositive(config.radius, DEFAULT_CONFIG.radius, "radius"),
    height: optionalFinitePositive(config.height, DEFAULT_CONFIG.height, "height"),
    stepHeight: optionalFiniteNonNegative(config.stepHeight, DEFAULT_CONFIG.stepHeight, "stepHeight"),
    groundProbeDistance: optionalFiniteNonNegative(
      config.groundProbeDistance,
      DEFAULT_CONFIG.groundProbeDistance,
      "groundProbeDistance"
    ),
    maxSlopeAngleRadians: optionalFiniteInRange(
      config.maxSlopeAngleRadians,
      DEFAULT_CONFIG.maxSlopeAngleRadians,
      0,
      Math.PI * 0.5,
      "maxSlopeAngleRadians"
    ),
    acceleration,
    deceleration,
    airAcceleration: optionalFiniteNonNegative(
      config.airAcceleration,
      DEFAULT_CONFIG.airAcceleration,
      "airAcceleration"
    ),
    turnSpeedRadians: optionalFiniteNonNegative(
      config.turnSpeedRadians,
      DEFAULT_CONFIG.turnSpeedRadians,
      "turnSpeedRadians"
    ),
    gravity: optionalFiniteNonNegative(config.gravity, DEFAULT_CONFIG.gravity, "gravity"),
    jumpSpeed: optionalFiniteNonNegative(config.jumpSpeed, DEFAULT_CONFIG.jumpSpeed, "jumpSpeed"),
    jumpBufferSeconds: optionalFiniteNonNegative(
      config.jumpBufferSeconds,
      DEFAULT_CONFIG.jumpBufferSeconds,
      "jumpBufferSeconds"
    ),
    coyoteTimeSeconds: optionalFiniteNonNegative(
      config.coyoteTimeSeconds,
      DEFAULT_CONFIG.coyoteTimeSeconds,
      "coyoteTimeSeconds"
    ),
    landingDurationSeconds: optionalFiniteNonNegative(
      config.landingDurationSeconds,
      DEFAULT_CONFIG.landingDurationSeconds,
      "landingDurationSeconds"
    ),
    crouchDurationSeconds: optionalFiniteNonNegative(
      config.crouchDurationSeconds,
      DEFAULT_CONFIG.crouchDurationSeconds,
      "crouchDurationSeconds"
    ),
    crouchSpeedMultiplier: optionalFiniteInRange(
      config.crouchSpeedMultiplier,
      DEFAULT_CONFIG.crouchSpeedMultiplier,
      0,
      1,
      "crouchSpeedMultiplier"
    )
  };
  validateCapsuleGeometry(resolved);
  const gaits = resolveGaits(config.gaits, acceleration, deceleration);
  const defaultGaitId = config.defaultGaitId ?? DEFAULT_CONFIG.defaultGaitId;
  if (!isNonEmptyString(defaultGaitId))
    throw new Error("character controller defaultGaitId must be a non-empty string");
  if (!gaits.some((gait) => gait.id === defaultGaitId)) {
    throw new Error(`character controller defaultGaitId ${defaultGaitId} is not configured`);
  }
  return freezeResolvedConfig({ ...resolved, defaultGaitId, gaits });
}

function validateCapsuleGeometry(config: Omit<CharacterControllerResolvedConfig, "gaits" | "defaultGaitId">): void {
  if (config.height + EPSILON < config.radius * 2) {
    throw new Error("character controller height must be at least twice radius");
  }
  if (config.stepHeight > config.height + EPSILON) {
    throw new Error("character controller stepHeight must not exceed height");
  }
  if (config.groundProbeDistance > config.height + EPSILON) {
    throw new Error("character controller groundProbeDistance must not exceed height");
  }
  if (config.stepHeight + config.groundProbeDistance > config.height + EPSILON) {
    throw new Error("character controller stepHeight plus groundProbeDistance must not exceed height");
  }
}

function freezeResolvedConfig(config: CharacterControllerResolvedConfig): CharacterControllerResolvedConfig {
  return Object.freeze({
    ...config,
    gaits: Object.freeze(config.gaits.map((gait) => Object.freeze({ ...gait })))
  });
}

function resolveGaits(
  overrides: readonly CharacterGaitDefinition[] | undefined,
  fallbackAcceleration: number,
  fallbackDeceleration: number
): readonly CharacterResolvedGaitDefinition[] {
  const overridesValue: unknown = overrides;
  if (overridesValue !== undefined && !Array.isArray(overridesValue)) {
    throw new Error("character controller gaits must be an array");
  }
  const byId = new Map<string, CharacterResolvedGaitDefinition>();
  const order: string[] = [];
  const addGait = (gait: CharacterGaitDefinition, index: number): void => {
    if (!isRecord(gait)) throw new Error(`character controller gait ${index} must be an object`);
    if (!isNonEmptyString(gait.id)) throw new Error(`character controller gait ${index} id must be a non-empty string`);
    const resolved = Object.freeze({
      id: gait.id,
      speed: optionalFiniteNonNegative(gait.speed, -1, `gaits[${index}].speed`),
      acceleration: optionalFiniteNonNegative(gait.acceleration, fallbackAcceleration, `gaits[${index}].acceleration`),
      deceleration: optionalFiniteNonNegative(gait.deceleration, fallbackDeceleration, `gaits[${index}].deceleration`),
      animationSpeed: optionalFiniteNonNegative(gait.animationSpeed, 1, `gaits[${index}].animationSpeed`)
    }) satisfies CharacterResolvedGaitDefinition;
    if (!byId.has(gait.id)) order.push(gait.id);
    byId.set(gait.id, resolved);
  };
  DEFAULT_GAITS.forEach(addGait);
  overrides?.forEach((gait, index) => addGait(gait, index));
  return Object.freeze(order.map((id) => byId.get(id)!));
}

function sanitizePostureTarget(
  posture: CharacterPostureIntent | undefined,
  fallback: CharacterPosture,
  events: CharacterControllerEvent[],
  tick: number
): CharacterPosture {
  if (posture === undefined) return fallback;
  if (!isRecord(posture)) {
    events.push(createInputRejectedEvent(tick, "posture", "type", "posture intent must be an object"));
    return fallback;
  }
  if (posture.crouch === undefined) return fallback;
  if (typeof posture.crouch !== "boolean") {
    events.push(createInputRejectedEvent(tick, "posture.crouch", "type", "posture crouch must be boolean"));
    return fallback;
  }
  return posture.crouch ? "crouching" : "standing";
}

function sanitizeCommandId(
  intent: CharacterJumpIntent | undefined,
  field: string,
  events: CharacterControllerEvent[],
  tick: number
): string | undefined {
  if (intent === undefined) return undefined;
  if (!isRecord(intent) || !isNonEmptyString(intent.commandId)) {
    events.push(createInputRejectedEvent(tick, field, "id", `${field} must be a non-empty string`));
    return undefined;
  }
  return intent.commandId;
}

function sanitizeActionIntent(
  action: CharacterActionIntent | undefined,
  events: CharacterControllerEvent[],
  tick: number
): CharacterActionIntent | undefined {
  if (action === undefined) return undefined;
  if (!isRecord(action)) {
    events.push(createInputRejectedEvent(tick, "action", "type", "action intent must be an object"));
    return undefined;
  }
  if (!isNonEmptyString(action.commandId)) {
    events.push(
      createInputRejectedEvent(tick, "action.commandId", "id", "action commandId must be a non-empty string")
    );
    return undefined;
  }
  if (!VALID_ACTION_KINDS.has(action.kind)) {
    events.push(createInputRejectedEvent(tick, "action.kind", "enum", "action kind is not supported"));
    return undefined;
  }
  const sanitized: CharacterActionIntent = { commandId: action.commandId, kind: action.kind };
  copyOptionalId(action, sanitized, "itemId", events, tick);
  copyOptionalId(action, sanitized, "socketId", events, tick);
  copyOptionalId(action, sanitized, "interactionId", events, tick);
  copyOptionalId(action, sanitized, "targetActorId", events, tick);
  return sanitized;
}

function copyOptionalId(
  source: CharacterActionIntent,
  target: CharacterActionIntent,
  key: "itemId" | "socketId" | "interactionId" | "targetActorId",
  events: CharacterControllerEvent[],
  tick: number
): void {
  const value = source[key];
  if (value === undefined) return;
  if (!isNonEmptyString(value)) {
    events.push(createInputRejectedEvent(tick, `action.${key}`, "id", `action ${key} must be a non-empty string`));
    return;
  }
  target[key] = value;
}

function sanitizeDeltaSeconds(deltaSeconds: number, events: CharacterControllerEvent[], tick: number): number {
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) return deltaSeconds;
  if (deltaSeconds !== 0) {
    events.push(
      createInputRejectedEvent(tick, "deltaSeconds", "finite-positive", "deltaSeconds must be finite and non-negative")
    );
  }
  return 0;
}

function resolveWorldMovement(
  world: CharacterWorldAdapter | undefined,
  query: CharacterMovementQuery,
  events: CharacterControllerEvent[],
  tick: number
): CharacterMovementResolution | null {
  if (!world) return null;
  try {
    if (world.resolveMovement) {
      const resolved = world.resolveMovement(query);
      if (resolved === null || resolved === undefined) return null;
      if (!isRecord(resolved)) {
        events.push(createWorldFailureEvent(tick, "resolveMovement", "adapter resolveMovement must return an object"));
        return null;
      }
      const position = readFiniteVec3(resolved.position);
      const velocity = resolved.velocity === undefined ? undefined : readFiniteVec3(resolved.velocity);
      if (!position || (resolved.velocity !== undefined && !velocity)) {
        events.push(
          createWorldFailureEvent(tick, "resolveMovement", "adapter resolveMovement returned non-finite data")
        );
        return null;
      }
      const hit =
        resolved.hit === undefined ? undefined : sanitizeSweepHit(resolved.hit, events, tick, "resolveMovement.hit");
      return {
        position,
        ...(velocity ? { velocity } : {}),
        ...(resolved.ground !== undefined ? { ground: resolved.ground } : {}),
        ...(hit ? { hit } : {})
      };
    }
    if (world.sweepCapsule) {
      const hit = sanitizeSweepHit(world.sweepCapsule(query), events, tick, "sweepCapsule");
      if (!hit) return null;
      if (hit.position) return { position: cloneVec3(hit.position), hit };
      if (hit.travelFraction !== undefined) {
        return { position: addVec3(query.from, scaleVec3(query.displacement, hit.travelFraction)), hit };
      }
      events.push(createWorldFailureEvent(tick, "sweepCapsule", "adapter sweepCapsule returned no finite position"));
      return null;
    }
  } catch (error) {
    events.push(createWorldFailureEvent(tick, "world", error instanceof Error ? error.message : "adapter threw"));
  }
  return null;
}

function sanitizeSweepHit(
  hit: unknown,
  events: CharacterControllerEvent[],
  tick: number,
  field: string
): CharacterSweepHit | null {
  if (hit === null || hit === undefined) return null;
  if (!isRecord(hit)) {
    events.push(createWorldFailureEvent(tick, field, `adapter ${field} must return an object`));
    return null;
  }
  const sanitized: CharacterSweepHit = {};
  if (hit.position !== undefined) {
    const position = readFiniteVec3(hit.position);
    if (!position) {
      events.push(createWorldFailureEvent(tick, `${field}.position`, `adapter ${field} returned non-finite position`));
      return null;
    }
    sanitized.position = position;
  }
  const travelFraction = hit.travelFraction;
  if (travelFraction !== undefined) {
    if (
      typeof travelFraction !== "number" ||
      !Number.isFinite(travelFraction) ||
      travelFraction < 0 ||
      travelFraction > 1
    ) {
      events.push(
        createWorldFailureEvent(tick, `${field}.travelFraction`, `adapter ${field} travelFraction must be in [0, 1]`)
      );
      return null;
    }
    sanitized.travelFraction = travelFraction;
  }
  if (hit.normal !== undefined) {
    const normal = readFiniteVec3(hit.normal);
    if (!normal || !isNonZeroVec3(normal)) {
      events.push(createWorldFailureEvent(tick, `${field}.normal`, `adapter ${field} returned invalid normal`));
      return null;
    }
    sanitized.normal = normal;
  }
  if (hit.platformVelocity !== undefined) {
    const platformVelocity = readFiniteVec3(hit.platformVelocity);
    if (!platformVelocity) {
      events.push(
        createWorldFailureEvent(tick, `${field}.platformVelocity`, `adapter ${field} returned invalid platformVelocity`)
      );
      return null;
    }
    sanitized.platformVelocity = platformVelocity;
  }
  if (hit.surfaceId !== undefined) {
    if (!isNonEmptyString(hit.surfaceId)) {
      events.push(createWorldFailureEvent(tick, `${field}.surfaceId`, `adapter ${field} returned invalid surfaceId`));
      return null;
    }
    sanitized.surfaceId = hit.surfaceId;
  }
  if (hit.ground !== undefined) sanitized.ground = hit.ground as CharacterGroundHit;
  return sanitized;
}

function queryWorldGround(
  world: CharacterWorldAdapter | undefined,
  query: CharacterGroundQuery,
  events: CharacterControllerEvent[],
  tick: number
): CharacterGroundHit | null {
  if (!world?.queryGround) return null;
  try {
    const hit = world.queryGround(query);
    if (hit === null || hit === undefined) return null;
    if (!isRecord(hit) || typeof hit.grounded !== "boolean") {
      events.push(createWorldFailureEvent(tick, "queryGround", "adapter queryGround grounded flag must be boolean"));
      return null;
    }
    if (!hit.grounded) return { grounded: false };
    return hit;
  } catch (error) {
    events.push(createWorldFailureEvent(tick, "queryGround", error instanceof Error ? error.message : "adapter threw"));
    return null;
  }
}

function groundCandidateFromHit(
  hit: unknown,
  position: Vec3,
  config: CharacterControllerResolvedConfig,
  events: CharacterControllerEvent[],
  tick: number,
  field: string
): GroundingCandidateResult {
  if (!isRecord(hit)) {
    events.push(createWorldFailureEvent(tick, field, `adapter ${field} must be an object`));
    return { candidate: null, invalid: true };
  }
  if (typeof hit.grounded !== "boolean") {
    events.push(createWorldFailureEvent(tick, `${field}.grounded`, `adapter ${field} grounded flag must be boolean`));
    return { candidate: null, invalid: true };
  }
  if (!hit.grounded) return { candidate: null, invalid: false };

  const point = readOptionalAdapterVec3(hit.point, `${field}.point`, events, tick);
  if (point === null) return { candidate: null, invalid: true };
  const supportPoint = point ?? [position[0], position[1], position[2]];

  const rawNormal = readOptionalAdapterVec3(hit.normal, `${field}.normal`, events, tick);
  if (rawNormal === null) return { candidate: null, invalid: true };
  const normalSource = rawNormal ?? [0, 1, 0];
  if (!isNonZeroVec3(normalSource)) {
    events.push(createWorldFailureEvent(tick, `${field}.normal`, `adapter ${field} normal must be non-zero`));
    return { candidate: null, invalid: true };
  }
  const normal = normalizeVec3(normalSource, [0, 1, 0]);
  const normalSlopeAngle = slopeAngleFromNormal(normal);

  const explicitSlopeAngle = readOptionalAdapterNumber(
    hit.slopeAngleRadians,
    `${field}.slopeAngleRadians`,
    events,
    tick
  );
  if (explicitSlopeAngle === null) return { candidate: null, invalid: true };
  if (explicitSlopeAngle !== undefined && (explicitSlopeAngle < 0 || explicitSlopeAngle > Math.PI * 0.5 + EPSILON)) {
    events.push(
      createWorldFailureEvent(tick, `${field}.slopeAngleRadians`, `adapter ${field} slopeAngleRadians is out of range`)
    );
    return { candidate: null, invalid: true };
  }
  if (normalSlopeAngle > config.maxSlopeAngleRadians + EPSILON) return { candidate: null, invalid: false };
  const slopeAngle = explicitSlopeAngle ?? normalSlopeAngle;
  if (slopeAngle > config.maxSlopeAngleRadians + EPSILON) return { candidate: null, invalid: false };

  const explicitDistance = readOptionalAdapterNumber(hit.distance, `${field}.distance`, events, tick);
  if (explicitDistance === null) return { candidate: null, invalid: true };
  const geometricDistance = position[1] - supportPoint[1];
  const distance = explicitDistance ?? geometricDistance;
  if (distance > config.groundProbeDistance + EPSILON || distance < -config.stepHeight - EPSILON) {
    return { candidate: null, invalid: false };
  }
  if (geometricDistance > config.groundProbeDistance + EPSILON || geometricDistance < -config.stepHeight - EPSILON) {
    return { candidate: null, invalid: false };
  }

  const platformVelocity = readOptionalAdapterVec3(hit.platformVelocity, `${field}.platformVelocity`, events, tick);
  if (platformVelocity === null) return { candidate: null, invalid: true };
  const surfaceId = readOptionalSurfaceId(hit.surfaceId, `${field}.surfaceId`, events, tick);
  if (surfaceId === null) return { candidate: null, invalid: true };

  return {
    candidate: {
      ground: {
        grounded: true,
        point: cloneVec3(supportPoint),
        normal,
        slopeAngleRadians: slopeAngle,
        platformVelocity: platformVelocity ?? [0, 0, 0],
        ...(surfaceId !== undefined ? { surfaceId } : {})
      },
      snapToGround: true
    },
    invalid: false
  };
}

function sweepGroundCandidate(
  hit: CharacterSweepHit,
  position: Vec3,
  config: CharacterControllerResolvedConfig,
  events: CharacterControllerEvent[],
  tick: number
): GroundingCandidate | null {
  if (hit.ground !== undefined) {
    return groundCandidateFromHit(hit.ground, position, config, events, tick, "sweepCapsule.ground").candidate;
  }
  if (hit.normal === undefined) return null;
  const derivedHit: CharacterGroundHit = {
    grounded: true,
    point: cloneVec3(position),
    normal: cloneVec3(hit.normal),
    distance: 0,
    ...(hit.platformVelocity !== undefined ? { platformVelocity: cloneVec3(hit.platformVelocity) } : {}),
    ...(hit.surfaceId !== undefined ? { surfaceId: hit.surfaceId } : {})
  };
  return groundCandidateFromHit(derivedHit, position, config, events, tick, "sweepCapsule").candidate;
}

function validateSnapshot(
  snapshot: CharacterControllerSnapshot,
  config: CharacterControllerResolvedConfig
): CharacterControllerSnapshot {
  if (!isRecord(snapshot)) throw new Error("character controller snapshot must be an object");
  if (snapshot.schemaVersion !== CHARACTER_CONTROLLER_SCHEMA_VERSION) {
    throw new Error("character controller snapshot schemaVersion is unsupported");
  }
  if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0)
    throw new Error("character controller snapshot tick is invalid");
  requiredFiniteNonNegative(snapshot.accumulatorSeconds, "snapshot.accumulatorSeconds");
  if (snapshot.accumulatorSeconds >= config.fixedStepSeconds + EPSILON) {
    throw new Error("character controller snapshot.accumulatorSeconds violates fixed-step invariant");
  }
  if (!isFiniteVec3(snapshot.position)) throw new Error("character controller snapshot position must be finite");
  if (!isFiniteVec3(snapshot.velocity)) throw new Error("character controller snapshot velocity must be finite");
  requiredFinite(snapshot.yaw, "snapshot.yaw");
  if (snapshot.yaw < -Math.PI - EPSILON || snapshot.yaw >= Math.PI + EPSILON) {
    throw new Error("character controller snapshot.yaw must be wrapped to [-pi, pi)");
  }
  if (!isLocomotionPhase(snapshot.locomotionPhase))
    throw new Error("character controller snapshot locomotionPhase is invalid");
  if (!isPosture(snapshot.posture)) throw new Error("character controller snapshot posture is invalid");
  if (!isPosturePhase(snapshot.posturePhase)) throw new Error("character controller snapshot posturePhase is invalid");
  requiredFiniteInRange(snapshot.crouchAlpha, 0, 1, "snapshot.crouchAlpha");
  if (!isPosture(snapshot.crouchTarget)) throw new Error("character controller snapshot crouchTarget is invalid");
  if (!isGroundState(snapshot.grounded)) throw new Error("character controller snapshot grounded state is invalid");
  requiredFiniteNonNegative(snapshot.jumpBufferSeconds, "snapshot.jumpBufferSeconds");
  if (snapshot.jumpBufferSeconds > config.jumpBufferSeconds + EPSILON) {
    throw new Error("character controller snapshot.jumpBufferSeconds exceeds config");
  }
  if (typeof snapshot.pendingJumpEdge !== "boolean") {
    throw new Error("character controller snapshot pendingJumpEdge is invalid");
  }
  requiredFiniteNonNegative(snapshot.coyoteSeconds, "snapshot.coyoteSeconds");
  if (snapshot.coyoteSeconds > config.coyoteTimeSeconds + EPSILON) {
    throw new Error("character controller snapshot.coyoteSeconds exceeds config");
  }
  requiredFiniteNonNegative(snapshot.landingSeconds, "snapshot.landingSeconds");
  if (snapshot.landingSeconds > config.landingDurationSeconds + EPSILON) {
    throw new Error("character controller snapshot.landingSeconds exceeds config");
  }
  const gait = config.gaits.find((candidate) => candidate.id === snapshot.gaitId);
  if (!gait) {
    throw new Error("character controller snapshot gaitId is not configured");
  }
  requiredFiniteInRange(snapshot.moveMagnitude, 0, 1, "snapshot.moveMagnitude");
  requiredFiniteNonNegative(snapshot.desiredSpeed, "snapshot.desiredSpeed");
  if (snapshot.desiredSpeed > gait.speed + EPSILON) {
    throw new Error("character controller snapshot.desiredSpeed exceeds gait speed");
  }
  validateSnapshotPosture(snapshot);
  validateSnapshotGrounding(snapshot, config);
  if (snapshot.lastJumpCommandId !== undefined && !isNonEmptyString(snapshot.lastJumpCommandId)) {
    throw new Error("character controller snapshot lastJumpCommandId is invalid");
  }
  if (snapshot.pendingJumpEdge && snapshot.lastJumpCommandId === undefined) {
    throw new Error("character controller snapshot pendingJumpEdge requires lastJumpCommandId");
  }
  if (snapshot.lastActionCommandId !== undefined && !isNonEmptyString(snapshot.lastActionCommandId)) {
    throw new Error("character controller snapshot lastActionCommandId is invalid");
  }
  return cloneSnapshot(snapshot);
}

function validateSnapshotPosture(snapshot: CharacterControllerSnapshot): void {
  if (snapshot.posturePhase === "standing") {
    if (snapshot.posture !== "standing" || snapshot.crouchTarget !== "standing" || snapshot.crouchAlpha > EPSILON) {
      throw new Error("character controller snapshot posture state is incoherent");
    }
    return;
  }
  if (snapshot.posturePhase === "crouching") {
    if (
      snapshot.posture !== "crouching" ||
      snapshot.crouchTarget !== "crouching" ||
      Math.abs(snapshot.crouchAlpha - 1) > EPSILON
    ) {
      throw new Error("character controller snapshot posture state is incoherent");
    }
    return;
  }
  if (snapshot.posturePhase === "entering-crouch" && snapshot.crouchTarget !== "crouching") {
    throw new Error("character controller snapshot posture transition target is incoherent");
  }
  if (snapshot.posturePhase === "exiting-crouch" && snapshot.crouchTarget !== "standing") {
    throw new Error("character controller snapshot posture transition target is incoherent");
  }
}

function validateSnapshotGrounding(
  snapshot: CharacterControllerSnapshot,
  config: CharacterControllerResolvedConfig
): void {
  if (snapshot.grounded.grounded) {
    if (snapshot.locomotionPhase !== "grounded" && snapshot.locomotionPhase !== "landing") {
      throw new Error("character controller snapshot locomotionPhase is incoherent with grounded state");
    }
    if (snapshot.velocity[1] > EPSILON) {
      throw new Error("character controller snapshot grounded velocity must not be rising");
    }
    if (!isNonZeroVec3(snapshot.grounded.normal)) {
      throw new Error("character controller snapshot grounded normal is invalid");
    }
    if (slopeAngleFromNormal(snapshot.grounded.normal) > config.maxSlopeAngleRadians + EPSILON) {
      throw new Error("character controller snapshot grounded normal exceeds slope config");
    }
    if (
      snapshot.grounded.slopeAngleRadians < 0 ||
      snapshot.grounded.slopeAngleRadians > config.maxSlopeAngleRadians + EPSILON
    ) {
      throw new Error("character controller snapshot grounded slope exceeds config");
    }
    if (snapshot.locomotionPhase === "grounded" && snapshot.landingSeconds > EPSILON) {
      throw new Error("character controller snapshot landingSeconds is incoherent");
    }
    return;
  }
  if (snapshot.locomotionPhase !== "rising" && snapshot.locomotionPhase !== "falling") {
    throw new Error("character controller snapshot locomotionPhase is incoherent with airborne state");
  }
  if (snapshot.landingSeconds > EPSILON) {
    throw new Error("character controller snapshot airborne state cannot carry landingSeconds");
  }
  if (!vec3NearlyEqual(snapshot.grounded.point, snapshot.position, EPSILON)) {
    throw new Error("character controller snapshot airborne ground point is incoherent");
  }
  if (!vec3NearlyEqual(snapshot.grounded.normal, [0, 1, 0], EPSILON) || snapshot.grounded.slopeAngleRadians > EPSILON) {
    throw new Error("character controller snapshot airborne ground normal is incoherent");
  }
  if (
    !vec3NearlyEqual(snapshot.grounded.platformVelocity, [0, 0, 0], EPSILON) ||
    snapshot.grounded.surfaceId !== undefined
  ) {
    throw new Error("character controller snapshot airborne platform state is incoherent");
  }
}

function cloneSnapshot(state: MutableCharacterState | CharacterControllerSnapshot): CharacterControllerSnapshot {
  return {
    schemaVersion: CHARACTER_CONTROLLER_SCHEMA_VERSION,
    tick: state.tick,
    accumulatorSeconds: state.accumulatorSeconds,
    position: cloneVec3(state.position),
    velocity: cloneVec3(state.velocity),
    yaw: state.yaw,
    locomotionPhase: state.locomotionPhase,
    posture: state.posture,
    posturePhase: state.posturePhase,
    crouchAlpha: state.crouchAlpha,
    crouchTarget: state.crouchTarget,
    grounded: cloneGroundState(state.grounded),
    jumpBufferSeconds: state.jumpBufferSeconds,
    pendingJumpEdge: state.pendingJumpEdge,
    coyoteSeconds: state.coyoteSeconds,
    landingSeconds: state.landingSeconds,
    gaitId: state.gaitId,
    moveMagnitude: state.moveMagnitude,
    desiredSpeed: state.desiredSpeed,
    ...(state.lastJumpCommandId !== undefined ? { lastJumpCommandId: state.lastJumpCommandId } : {}),
    ...(state.lastActionCommandId !== undefined ? { lastActionCommandId: state.lastActionCommandId } : {})
  };
}

function cloneGroundState(ground: CharacterGroundState): CharacterGroundState {
  return {
    grounded: ground.grounded,
    point: cloneVec3(ground.point),
    normal: cloneVec3(ground.normal),
    slopeAngleRadians: ground.slopeAngleRadians,
    platformVelocity: cloneVec3(ground.platformVelocity),
    ...(ground.surfaceId !== undefined ? { surfaceId: ground.surfaceId } : {})
  };
}

function createGroundState(position: Vec3, normal: Vec3, surfaceId?: string): CharacterGroundState {
  return {
    grounded: true,
    point: cloneVec3(position),
    normal: normalizeVec3(normal, [0, 1, 0]),
    slopeAngleRadians: slopeAngleFromNormal(normal),
    platformVelocity: [0, 0, 0],
    ...(surfaceId !== undefined ? { surfaceId } : {})
  };
}

function createAirGroundState(position: Vec3): CharacterGroundState {
  return {
    grounded: false,
    point: cloneVec3(position),
    normal: [0, 1, 0],
    slopeAngleRadians: 0,
    platformVelocity: [0, 0, 0]
  };
}

function createInputRejectedEvent(
  tick: number,
  field: string,
  code: string,
  message: string
): CharacterControllerEvent {
  return { type: "input-rejected", tick, field, code, message };
}

function createWorldFailureEvent(tick: number, field: string, message: string): CharacterControllerEvent {
  return { type: "world-adapter-failed", tick, field, code: "adapter", message };
}

function cloneEvent(event: CharacterControllerEvent): CharacterControllerEvent {
  return {
    ...event,
    ...(event.command ? { command: { ...event.command } } : {})
  };
}

function optionalFinite(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error(`character controller ${field} must be finite`);
  return value;
}

function optionalFinitePositive(value: number | undefined, fallback: number, field: string): number {
  const resolved = optionalFinite(value, fallback, field);
  if (!(resolved > 0)) throw new Error(`character controller ${field} must be greater than zero`);
  return resolved;
}

function optionalFiniteNonNegative(value: number | undefined, fallback: number, field: string): number {
  const resolved = optionalFinite(value, fallback, field);
  if (resolved < 0) throw new Error(`character controller ${field} must be non-negative`);
  return resolved;
}

function optionalPositiveInteger(value: number | undefined, fallback: number, field: string, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`character controller ${field} must be a positive integer no greater than ${max}`);
  }
  return value;
}

function optionalFiniteInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string
): number {
  const resolved = optionalFinite(value, fallback, field);
  if (resolved < min || resolved > max) throw new Error(`character controller ${field} must be in [${min}, ${max}]`);
  return resolved;
}

function sanitizeOptionalFiniteNonNegative(
  value: number | undefined,
  fallback: number,
  field: string,
  events: CharacterControllerEvent[],
  tick: number
): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return value;
  events.push(createInputRejectedEvent(tick, field, "finite-non-negative", `${field} must be finite and non-negative`));
  return fallback;
}

function requiredFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`character controller ${field} must be finite`);
}

function requiredFiniteNonNegative(value: number, field: string): void {
  requiredFinite(value, field);
  if (value < 0) throw new Error(`character controller ${field} must be non-negative`);
}

function requiredFiniteInRange(value: number, min: number, max: number, field: string): void {
  requiredFinite(value, field);
  if (value < min || value > max) throw new Error(`character controller ${field} must be in [${min}, ${max}]`);
}

function readConfigVec3(value: Vec3 | undefined, fallback: Vec3, field: string): Vec3 {
  if (value === undefined) return cloneVec3(fallback);
  const finite = readFiniteVec3(value);
  if (!finite) throw new Error(`character controller ${field} must contain three finite numbers`);
  return finite;
}

function readFiniteVec3(value: unknown): Vec3 | null {
  if (!isArrayLikeNumber(value, 3)) return null;
  const x = value[0] ?? Number.NaN;
  const y = value[1] ?? Number.NaN;
  const z = value[2] ?? Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function readOptionalAdapterVec3(
  value: unknown,
  field: string,
  events: CharacterControllerEvent[],
  tick: number
): Vec3 | undefined | null {
  if (value === undefined) return undefined;
  const finite = readFiniteVec3(value);
  if (!finite) {
    events.push(createWorldFailureEvent(tick, field, `adapter ${field} must contain three finite numbers`));
    return null;
  }
  return finite;
}

function readOptionalAdapterNumber(
  value: unknown,
  field: string,
  events: CharacterControllerEvent[],
  tick: number
): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    events.push(createWorldFailureEvent(tick, field, `adapter ${field} must be finite`));
    return null;
  }
  return value;
}

function readOptionalSurfaceId(
  value: unknown,
  field: string,
  events: CharacterControllerEvent[],
  tick: number
): CharacterSurfaceId | undefined | null {
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    events.push(createWorldFailureEvent(tick, field, `adapter ${field} must be a non-empty string`));
    return null;
  }
  return value;
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return readFiniteVec3(value) !== null;
}

function isNonZeroVec3(value: Vec3): boolean {
  return Math.hypot(value[0], value[1], value[2]) > EPSILON;
}

function isArrayLikeNumber(value: unknown, minLength: number): value is ArrayLike<number> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const length = (value as { length?: unknown }).length;
  return typeof length === "number" && length >= minLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isLocomotionPhase(value: unknown): value is CharacterLocomotionPhase {
  return value === "grounded" || value === "rising" || value === "falling" || value === "landing";
}

function isPosture(value: unknown): value is CharacterPosture {
  return value === "standing" || value === "crouching";
}

function isPosturePhase(value: unknown): value is CharacterPosturePhase {
  return value === "standing" || value === "entering-crouch" || value === "crouching" || value === "exiting-crouch";
}

function isGroundState(value: unknown): value is CharacterGroundState {
  if (!isRecord(value)) return false;
  return (
    typeof value.grounded === "boolean" &&
    isFiniteVec3(value.point) &&
    isFiniteVec3(value.normal) &&
    isNonZeroVec3(readFiniteVec3(value.normal) ?? [0, 0, 0]) &&
    typeof value.slopeAngleRadians === "number" &&
    Number.isFinite(value.slopeAngleRadians) &&
    value.slopeAngleRadians >= 0 &&
    isFiniteVec3(value.platformVelocity) &&
    (value.surfaceId === undefined || isNonEmptyString(value.surfaceId))
  );
}

function copyVec3Into(target: Vec3, value: Vec3): void {
  target[0] = value[0];
  target[1] = value[1];
  target[2] = value[2];
}

function vec3NearlyEqual(a: Vec3, b: Vec3, epsilon: number): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[2] - b[2]) <= epsilon;
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function yawFromPlanarDirection(direction: Vec3): number {
  return wrapYaw(Math.atan2(direction[0], direction[2]));
}

function yawToForward(yaw: number): Vec3 {
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

function rotateYawTowards(current: number, target: number, maxDelta: number): number {
  const delta = shortestYawDelta(current, target);
  if (maxDelta <= 0) return wrapYaw(current);
  if (Math.abs(delta) <= maxDelta) return wrapYaw(target);
  return wrapYaw(current + Math.sign(delta) * maxDelta);
}

function shortestYawDelta(from: number, to: number): number {
  return wrapYaw(to - from);
}

function wrapYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let yaw = ((((value + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  if (Object.is(yaw, -0)) yaw = 0;
  return yaw;
}

function slopeAngleFromNormal(normal: Vec3): number {
  const normalized = normalizeVec3(normal, [0, 1, 0]);
  return Math.acos(clamp(normalized[1], -1, 1));
}
