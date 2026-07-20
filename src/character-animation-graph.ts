import {
  type CharacterActionIntent,
  type CharacterActionKind,
  type CharacterAnimationState,
  type CharacterAnimationTransition,
  type CharacterControllerEvent,
  type CharacterGaitId,
  type CharacterLocomotionPhase,
  type CharacterPosturePhase
} from "./character-controller.js";
import { EPSILON, clamp, clamp01, euclideanModulo } from "./math.js";

export const CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION = 1;

export type CharacterAnimationGraphLayerId = "locomotion" | "posture" | "airborne" | "action";
export type CharacterAnimationGraphRequestId = string;
export type CharacterAnimationGraphIssueType = "input-rejected" | "bounded";
export type CharacterAnimationGraphTransitionReason =
  | "locomotion-hysteresis"
  | "gait-change"
  | "posture-phase"
  | "airborne-phase";
export type CharacterAnimationGraphPlaybackReason = "idle" | "gait" | "posture" | "airborne";

export type CharacterAnimationGraphLocomotionConfig = {
  /** Semantic idle request id. Consumers map this to clips/assets outside this package. */
  idleRequestId?: CharacterAnimationGraphRequestId;
  /** Prefix for semantic gait requests; the current controller gait id is appended after validation. */
  gaitRequestIdPrefix?: string;
  /** Start moving once the controller locomotion metric reaches this value. */
  startSpeedRatio?: number;
  /** Stop moving once the active locomotion metric falls to this value or below. Must be <= startSpeedRatio. */
  stopSpeedRatio?: number;
  /** Crossfade hint for idle <-> gait transitions. */
  fadeSeconds?: number;
  /** Crossfade hint for gait id changes while moving. */
  gaitFadeSeconds?: number;
  /** Scale applied to CharacterAnimationState.animationSpeed for gait playback requests. */
  playbackSpeedScale?: number;
  minPlaybackSpeed?: number;
  maxPlaybackSpeed?: number;
  /** Normalized cycle phase advance per second at playbackSpeed 1. */
  cycleRate?: number;
  priority?: number;
};

export type CharacterAnimationGraphPostureConfig = {
  standingRequestId?: CharacterAnimationGraphRequestId;
  crouchingRequestId?: CharacterAnimationGraphRequestId;
  fadeSeconds?: number;
  priority?: number;
};

export type CharacterAnimationGraphAirborneConfig = {
  riseRequestId?: CharacterAnimationGraphRequestId;
  fallRequestId?: CharacterAnimationGraphRequestId;
  landingRequestId?: CharacterAnimationGraphRequestId;
  fadeSeconds?: number;
  landingFadeSeconds?: number;
  /** Keep the landing request alive briefly after the controller returns to grounded. */
  landingHoldSeconds?: number;
  /** Debounce the rise -> fall switch for short hops or tiny vertical-speed sign changes. */
  minRiseSeconds?: number;
  minPlaybackSpeed?: number;
  maxPlaybackSpeed?: number;
  priority?: number;
};

export type CharacterAnimationGraphActionConfig = {
  /** Prefix for semantic action requests; the controller action kind is appended. */
  requestIdPrefix?: string;
  fadeSeconds?: number;
  priority?: number;
  maxActionRequestsPerUpdate?: number;
};

export type CharacterAnimationGraphConfig = {
  locomotion?: CharacterAnimationGraphLocomotionConfig;
  posture?: CharacterAnimationGraphPostureConfig;
  airborne?: CharacterAnimationGraphAirborneConfig;
  action?: CharacterAnimationGraphActionConfig;
  /** Maximum time that graph-local phase/debounce timers may advance in one update. */
  maxDeltaSeconds?: number;
  /** Maximum controller events/transitions inspected per graph update. */
  maxControllerEventsPerUpdate?: number;
};

export type CharacterAnimationGraphResolvedLocomotionConfig = Readonly<
  Required<CharacterAnimationGraphLocomotionConfig>
>;
export type CharacterAnimationGraphResolvedPostureConfig = Readonly<Required<CharacterAnimationGraphPostureConfig>>;
export type CharacterAnimationGraphResolvedAirborneConfig = Readonly<Required<CharacterAnimationGraphAirborneConfig>>;
export type CharacterAnimationGraphResolvedActionConfig = Readonly<Required<CharacterAnimationGraphActionConfig>>;

export type CharacterAnimationGraphResolvedConfig = Readonly<{
  locomotion: CharacterAnimationGraphResolvedLocomotionConfig;
  posture: CharacterAnimationGraphResolvedPostureConfig;
  airborne: CharacterAnimationGraphResolvedAirborneConfig;
  action: CharacterAnimationGraphResolvedActionConfig;
  maxDeltaSeconds: number;
  maxControllerEventsPerUpdate: number;
}>;

export type CharacterAnimationGraphSnapshot = {
  schemaVersion: typeof CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION;
  tick: number;
  locomotionActive: boolean;
  locomotionRequestId: CharacterAnimationGraphRequestId;
  gaitId: CharacterGaitId;
  postureRequestId: CharacterAnimationGraphRequestId;
  airborneRequestId: CharacterAnimationGraphRequestId | null;
  airbornePhaseSeconds: number;
  landingHoldSeconds: number;
  playbackPhase: number;
  lastActionCommandId?: string;
};

export type CharacterAnimationPlaybackRequest = {
  type: "playback";
  layer: CharacterAnimationGraphLayerId;
  requestId: CharacterAnimationGraphRequestId;
  weight: number;
  playbackSpeed: number;
  priority: number;
  loop: boolean;
  phase: number;
  transitionSeconds: number;
  reason: CharacterAnimationGraphPlaybackReason;
};

export type CharacterAnimationBlendRequest = {
  type: "blend";
  layer: CharacterAnimationGraphLayerId;
  from: CharacterAnimationGraphRequestId;
  to: CharacterAnimationGraphRequestId;
  fromWeight: number;
  toWeight: number;
  priority: number;
  transitionSeconds: number;
  reason: CharacterAnimationGraphPlaybackReason;
};

export type CharacterAnimationTransitionRequest = {
  type: "transition";
  layer: CharacterAnimationGraphLayerId;
  from: CharacterAnimationGraphRequestId | null;
  to: CharacterAnimationGraphRequestId | null;
  fadeSeconds: number;
  priority: number;
  reason: CharacterAnimationGraphTransitionReason;
  controllerTick?: number;
};

export type CharacterAnimationActionRequest = {
  type: "action";
  layer: "action";
  requestId: CharacterAnimationGraphRequestId;
  command: CharacterActionIntent;
  priority: number;
  fadeSeconds: number;
  controllerTick?: number;
};

export type CharacterAnimationGraphIssue = {
  type: CharacterAnimationGraphIssueType;
  field: string;
  code: string;
  message: string;
  controllerTick?: number;
};

export type CharacterAnimationGraphOutput = {
  schemaVersion: typeof CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION;
  sequence: number;
  deltaSeconds: number;
  locomotionActive: boolean;
  locomotionWeight: number;
  postureWeight: number;
  primaryRequestId: CharacterAnimationGraphRequestId | null;
  playback: CharacterAnimationPlaybackRequest[];
  blends: CharacterAnimationBlendRequest[];
  transitions: CharacterAnimationTransitionRequest[];
  actions: CharacterAnimationActionRequest[];
  issues: CharacterAnimationGraphIssue[];
};

export type CharacterAnimationGraphUpdateOptions = {
  deltaSeconds?: number;
  /** Optional reusable output buffer. Arrays are cleared and reused. */
  output?: CharacterAnimationGraphOutput;
};

type SanitizedAnimationState = {
  gaitId: CharacterGaitId;
  planarSpeed: number;
  verticalSpeed: number;
  speedRatio: number;
  animationSpeed: number;
  moveMagnitude: number;
  desiredSpeed: number;
  locomotionPhase: CharacterLocomotionPhase;
  posturePhase: CharacterPosturePhase;
  crouchAlpha: number;
  events: readonly CharacterControllerEvent[];
  transitions: readonly CharacterAnimationTransition[];
};

const DEFAULT_GRAPH_CONFIG = {
  maxDeltaSeconds: 0.25,
  maxControllerEventsPerUpdate: 64,
  locomotion: {
    idleRequestId: "locomotion:idle",
    gaitRequestIdPrefix: "locomotion:gait:",
    startSpeedRatio: 0.08,
    stopSpeedRatio: 0.035,
    fadeSeconds: 0.15,
    gaitFadeSeconds: 0.12,
    playbackSpeedScale: 1,
    minPlaybackSpeed: 0.2,
    maxPlaybackSpeed: 2.5,
    cycleRate: 1,
    priority: 0
  },
  posture: {
    standingRequestId: "posture:standing",
    crouchingRequestId: "posture:crouching",
    fadeSeconds: 0.16,
    priority: 100
  },
  airborne: {
    riseRequestId: "airborne:rise",
    fallRequestId: "airborne:fall",
    landingRequestId: "airborne:landing",
    fadeSeconds: 0.08,
    landingFadeSeconds: 0.1,
    landingHoldSeconds: 0.12,
    minRiseSeconds: 0.06,
    minPlaybackSpeed: 0.5,
    maxPlaybackSpeed: 1.5,
    priority: 200
  },
  action: {
    requestIdPrefix: "action:",
    fadeSeconds: 0.08,
    priority: 300,
    maxActionRequestsPerUpdate: 16
  }
} as const;

const MAX_REQUEST_ID_LENGTH = 160;
const MAX_DELTA_SECONDS = 5;
const MAX_EVENT_SCAN = 512;
const MAX_ACTIONS_PER_UPDATE = 128;

const VALID_LOCOMOTION_PHASES = new Set<CharacterLocomotionPhase>(["grounded", "rising", "falling", "landing"]);
const VALID_POSTURE_PHASES = new Set<CharacterPosturePhase>([
  "standing",
  "entering-crouch",
  "crouching",
  "exiting-crouch"
]);
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

export class CharacterAnimationGraph {
  readonly config: CharacterAnimationGraphResolvedConfig;
  private readonly state: CharacterAnimationGraphSnapshot;

  constructor(config: CharacterAnimationGraphConfig = {}) {
    this.config = resolveCharacterAnimationGraphConfig(config);
    this.state = {
      schemaVersion: CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION,
      tick: 0,
      locomotionActive: false,
      locomotionRequestId: this.config.locomotion.idleRequestId,
      gaitId: "walk",
      postureRequestId: this.config.posture.standingRequestId,
      airborneRequestId: null,
      airbornePhaseSeconds: 0,
      landingHoldSeconds: 0,
      playbackPhase: 0
    };
  }

  update(
    animation: CharacterAnimationState,
    options: CharacterAnimationGraphUpdateOptions = {}
  ): CharacterAnimationGraphOutput {
    const output = options.output ?? createCharacterAnimationGraphOutputBuffer();
    resetCharacterAnimationGraphOutput(output);
    const deltaSeconds = sanitizeDeltaSeconds(options.deltaSeconds, this.config.maxDeltaSeconds, output.issues);
    this.state.tick += 1;
    output.sequence = this.state.tick;
    output.deltaSeconds = deltaSeconds;

    const sanitized = sanitizeAnimationState(animation, this.state.gaitId, this.config, output.issues);
    const limitedEvents = Math.min(sanitized.events.length, this.config.maxControllerEventsPerUpdate);
    const limitedTransitions = Math.min(sanitized.transitions.length, this.config.maxControllerEventsPerUpdate);
    reportTruncation("events", sanitized.events.length, limitedEvents, output.issues);
    reportTruncation("transitions", sanitized.transitions.length, limitedTransitions, output.issues);

    this.forwardActionEvents(sanitized.events, limitedEvents, output);

    const locomotion = this.resolveLocomotion(sanitized);
    const posture = this.resolvePosture(sanitized);
    const airborne = this.resolveAirborne(sanitized, deltaSeconds);

    this.emitAirborneTransition(airborne.requestId, sanitized.transitions, limitedTransitions, output.transitions);
    this.emitPostureTransition(posture.requestId, sanitized.transitions, limitedTransitions, output.transitions);
    this.emitLocomotionTransition(
      locomotion.requestId,
      locomotion.transitionReason,
      sanitized.transitions,
      limitedTransitions,
      output.transitions
    );

    const previousAirborneRequestId = this.state.airborneRequestId;
    this.state.locomotionActive = locomotion.active;
    this.state.locomotionRequestId = locomotion.requestId;
    this.state.gaitId = sanitized.gaitId;
    this.state.postureRequestId = posture.requestId;
    this.state.airborneRequestId = airborne.requestId;
    this.advanceAirborneTimers(airborne.requestId, previousAirborneRequestId, deltaSeconds);
    this.advancePlaybackPhase(deltaSeconds, locomotion.playbackSpeed);

    output.locomotionActive = locomotion.active;
    output.locomotionWeight = locomotion.weight;
    output.postureWeight = posture.weight;
    output.primaryRequestId = airborne.requestId ?? locomotion.requestId;

    emitLocomotionPlayback(this.config, sanitized.gaitId, locomotion, this.state.playbackPhase, output);
    emitPosturePlayback(this.config, posture, output);
    emitAirbornePlayback(this.config, airborne, this.state.airbornePhaseSeconds, output);
    return output;
  }

  snapshot(): CharacterAnimationGraphSnapshot {
    return cloneGraphSnapshot(this.state);
  }

  restore(snapshot: CharacterAnimationGraphSnapshot): void {
    const restored = validateGraphSnapshot(snapshot, this.config);
    this.state.tick = restored.tick;
    this.state.locomotionActive = restored.locomotionActive;
    this.state.locomotionRequestId = restored.locomotionRequestId;
    this.state.gaitId = restored.gaitId;
    this.state.postureRequestId = restored.postureRequestId;
    this.state.airborneRequestId = restored.airborneRequestId;
    this.state.airbornePhaseSeconds = restored.airbornePhaseSeconds;
    this.state.landingHoldSeconds = restored.landingHoldSeconds;
    this.state.playbackPhase = restored.playbackPhase;
    if (restored.lastActionCommandId !== undefined) this.state.lastActionCommandId = restored.lastActionCommandId;
    else delete this.state.lastActionCommandId;
  }

  private forwardActionEvents(
    events: readonly CharacterControllerEvent[],
    limit: number,
    output: CharacterAnimationGraphOutput
  ): void {
    let emitted = 0;
    for (let index = 0; index < limit; index += 1) {
      const event = events[index];
      if (!event || event.type !== "action-command") continue;
      const controllerTick = sanitizeControllerTick(event.tick, "events.action-command.tick", output.issues);
      const command = sanitizeActionCommand(event.command, controllerTick, output.issues);
      if (!command || command.commandId === this.state.lastActionCommandId) continue;
      this.state.lastActionCommandId = command.commandId;
      if (emitted >= this.config.action.maxActionRequestsPerUpdate) {
        output.issues.push({
          type: "bounded",
          field: "events.action-command",
          code: "max-actions",
          message: "character animation graph discarded action events beyond maxActionRequestsPerUpdate",
          ...controllerTickProperty(controllerTick)
        });
        continue;
      }
      emitted += 1;
      output.actions.push({
        type: "action",
        layer: "action",
        requestId: `${this.config.action.requestIdPrefix}${command.kind}`,
        command,
        priority: this.config.action.priority,
        fadeSeconds: this.config.action.fadeSeconds,
        ...controllerTickProperty(controllerTick)
      });
    }
  }

  private resolveLocomotion(animation: SanitizedAnimationState): {
    active: boolean;
    requestId: string;
    gaitRequestId: string;
    weight: number;
    playbackSpeed: number;
    transitionReason: CharacterAnimationGraphTransitionReason;
  } {
    const metric = readLocomotionMetric(animation);
    const active = this.state.locomotionActive
      ? metric > this.config.locomotion.stopSpeedRatio
      : metric >= this.config.locomotion.startSpeedRatio;
    const gaitRequestId = gaitRequestIdFor(this.config, animation.gaitId);
    const requestId = active ? gaitRequestId : this.config.locomotion.idleRequestId;
    const weight = active ? clamp01(metric) : 0;
    const playbackSpeed = clamp(
      animation.animationSpeed * this.config.locomotion.playbackSpeedScale,
      this.config.locomotion.minPlaybackSpeed,
      this.config.locomotion.maxPlaybackSpeed
    );
    const transitionReason =
      active && this.state.locomotionActive && gaitRequestId !== this.state.locomotionRequestId
        ? "gait-change"
        : "locomotion-hysteresis";
    return { active, requestId, gaitRequestId, weight, playbackSpeed, transitionReason };
  }

  private resolvePosture(animation: SanitizedAnimationState): { requestId: string; weight: number } {
    const requestId =
      animation.posturePhase === "entering-crouch" || animation.posturePhase === "crouching"
        ? this.config.posture.crouchingRequestId
        : this.config.posture.standingRequestId;
    return { requestId, weight: clamp01(animation.crouchAlpha) };
  }

  private resolveAirborne(
    animation: SanitizedAnimationState,
    deltaSeconds: number
  ): { requestId: string | null; playbackSpeed: number; phase: CharacterLocomotionPhase | "grounded" } {
    let phase: CharacterLocomotionPhase | "grounded" = animation.locomotionPhase;
    let requestId: string | null = null;
    if (phase === "rising") requestId = this.config.airborne.riseRequestId;
    else if (phase === "falling") {
      const debouncedRise =
        this.state.airborneRequestId === this.config.airborne.riseRequestId &&
        this.state.airbornePhaseSeconds + deltaSeconds < this.config.airborne.minRiseSeconds;
      requestId = debouncedRise ? this.config.airborne.riseRequestId : this.config.airborne.fallRequestId;
      if (debouncedRise) phase = "rising";
    } else if (phase === "landing") {
      requestId = this.config.airborne.landingRequestId;
      this.state.landingHoldSeconds = this.config.airborne.landingHoldSeconds;
    } else if (this.state.landingHoldSeconds > EPSILON) {
      phase = "landing";
      requestId = this.config.airborne.landingRequestId;
    } else {
      phase = "grounded";
    }
    const verticalScale = Math.max(1, Math.abs(animation.verticalSpeed));
    const playbackSpeed = clamp(
      verticalScale,
      this.config.airborne.minPlaybackSpeed,
      this.config.airborne.maxPlaybackSpeed
    );
    return { requestId, playbackSpeed, phase };
  }

  private emitLocomotionTransition(
    requestId: string,
    reason: CharacterAnimationGraphTransitionReason,
    transitions: readonly CharacterAnimationTransition[],
    transitionLimit: number,
    output: CharacterAnimationTransitionRequest[]
  ): void {
    if (requestId === this.state.locomotionRequestId) return;
    output.push({
      type: "transition",
      layer: "locomotion",
      from: this.state.locomotionRequestId,
      to: requestId,
      fadeSeconds:
        reason === "gait-change" ? this.config.locomotion.gaitFadeSeconds : this.config.locomotion.fadeSeconds,
      priority: this.config.locomotion.priority,
      reason,
      ...controllerTickProperty(findTransitionTick(transitions, transitionLimit, "locomotion"))
    });
  }

  private emitPostureTransition(
    requestId: string,
    transitions: readonly CharacterAnimationTransition[],
    transitionLimit: number,
    output: CharacterAnimationTransitionRequest[]
  ): void {
    if (requestId === this.state.postureRequestId) return;
    output.push({
      type: "transition",
      layer: "posture",
      from: this.state.postureRequestId,
      to: requestId,
      fadeSeconds: this.config.posture.fadeSeconds,
      priority: this.config.posture.priority,
      reason: "posture-phase",
      ...controllerTickProperty(findTransitionTick(transitions, transitionLimit, "posture"))
    });
  }

  private emitAirborneTransition(
    requestId: string | null,
    transitions: readonly CharacterAnimationTransition[],
    transitionLimit: number,
    output: CharacterAnimationTransitionRequest[]
  ): void {
    if (requestId === this.state.airborneRequestId) return;
    output.push({
      type: "transition",
      layer: "airborne",
      from: this.state.airborneRequestId,
      to: requestId,
      fadeSeconds:
        requestId === this.config.airborne.landingRequestId
          ? this.config.airborne.landingFadeSeconds
          : this.config.airborne.fadeSeconds,
      priority: this.config.airborne.priority,
      reason: "airborne-phase",
      ...controllerTickProperty(findTransitionTick(transitions, transitionLimit, "locomotion"))
    });
  }

  private advanceAirborneTimers(
    requestId: string | null,
    previousRequestId: string | null,
    deltaSeconds: number
  ): void {
    if (requestId === null) this.state.airbornePhaseSeconds = 0;
    else if (requestId === previousRequestId) this.state.airbornePhaseSeconds += deltaSeconds;
    else this.state.airbornePhaseSeconds = 0;
    if (requestId !== this.config.airborne.landingRequestId) {
      this.state.landingHoldSeconds = 0;
    } else if (this.state.landingHoldSeconds > 0) {
      this.state.landingHoldSeconds = Math.max(0, this.state.landingHoldSeconds - deltaSeconds);
    }
  }

  private advancePlaybackPhase(deltaSeconds: number, playbackSpeed: number): void {
    const deltaPhase = deltaSeconds * playbackSpeed * this.config.locomotion.cycleRate;
    this.state.playbackPhase = euclideanModulo(this.state.playbackPhase + deltaPhase, 1);
  }
}

export function createCharacterAnimationGraphOutputBuffer(): CharacterAnimationGraphOutput {
  return {
    schemaVersion: CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION,
    sequence: 0,
    deltaSeconds: 0,
    locomotionActive: false,
    locomotionWeight: 0,
    postureWeight: 0,
    primaryRequestId: null,
    playback: [],
    blends: [],
    transitions: [],
    actions: [],
    issues: []
  };
}

export function resolveCharacterAnimationGraphConfig(
  config: CharacterAnimationGraphConfig = {}
): CharacterAnimationGraphResolvedConfig {
  if (!isRecord(config)) throw new Error("character animation graph config must be an object");
  const locomotion = resolveLocomotionConfig(config.locomotion);
  const posture = resolvePostureConfig(config.posture);
  const airborne = resolveAirborneConfig(config.airborne);
  const action = resolveActionConfig(config.action);
  return Object.freeze({
    locomotion,
    posture,
    airborne,
    action,
    maxDeltaSeconds: readConfigFiniteInRange(
      config.maxDeltaSeconds,
      DEFAULT_GRAPH_CONFIG.maxDeltaSeconds,
      0,
      MAX_DELTA_SECONDS,
      "maxDeltaSeconds"
    ),
    maxControllerEventsPerUpdate: readConfigIntegerInRange(
      config.maxControllerEventsPerUpdate,
      DEFAULT_GRAPH_CONFIG.maxControllerEventsPerUpdate,
      0,
      MAX_EVENT_SCAN,
      "maxControllerEventsPerUpdate"
    )
  });
}

function resolveLocomotionConfig(
  config: CharacterAnimationGraphLocomotionConfig | undefined
): CharacterAnimationGraphResolvedLocomotionConfig {
  if (config !== undefined && !isRecord(config))
    throw new Error("character animation graph locomotion config must be an object");
  const startSpeedRatio = readConfigFiniteInRange(
    config?.startSpeedRatio,
    DEFAULT_GRAPH_CONFIG.locomotion.startSpeedRatio,
    0,
    1.5,
    "locomotion.startSpeedRatio"
  );
  const stopSpeedRatio = readConfigFiniteInRange(
    config?.stopSpeedRatio,
    DEFAULT_GRAPH_CONFIG.locomotion.stopSpeedRatio,
    0,
    startSpeedRatio,
    "locomotion.stopSpeedRatio"
  );
  const minPlaybackSpeed = readConfigFiniteInRange(
    config?.minPlaybackSpeed,
    DEFAULT_GRAPH_CONFIG.locomotion.minPlaybackSpeed,
    0,
    16,
    "locomotion.minPlaybackSpeed"
  );
  const maxPlaybackSpeed = readConfigFiniteInRange(
    config?.maxPlaybackSpeed,
    DEFAULT_GRAPH_CONFIG.locomotion.maxPlaybackSpeed,
    minPlaybackSpeed,
    16,
    "locomotion.maxPlaybackSpeed"
  );
  return Object.freeze({
    idleRequestId: readRequestId(
      config?.idleRequestId,
      DEFAULT_GRAPH_CONFIG.locomotion.idleRequestId,
      "locomotion.idleRequestId"
    ),
    gaitRequestIdPrefix: readRequestIdPrefix(
      config?.gaitRequestIdPrefix,
      DEFAULT_GRAPH_CONFIG.locomotion.gaitRequestIdPrefix,
      "locomotion.gaitRequestIdPrefix"
    ),
    startSpeedRatio,
    stopSpeedRatio,
    fadeSeconds: readConfigFiniteInRange(
      config?.fadeSeconds,
      DEFAULT_GRAPH_CONFIG.locomotion.fadeSeconds,
      0,
      10,
      "locomotion.fadeSeconds"
    ),
    gaitFadeSeconds: readConfigFiniteInRange(
      config?.gaitFadeSeconds,
      DEFAULT_GRAPH_CONFIG.locomotion.gaitFadeSeconds,
      0,
      10,
      "locomotion.gaitFadeSeconds"
    ),
    playbackSpeedScale: readConfigFiniteInRange(
      config?.playbackSpeedScale,
      DEFAULT_GRAPH_CONFIG.locomotion.playbackSpeedScale,
      0,
      16,
      "locomotion.playbackSpeedScale"
    ),
    minPlaybackSpeed,
    maxPlaybackSpeed,
    cycleRate: readConfigFiniteInRange(
      config?.cycleRate,
      DEFAULT_GRAPH_CONFIG.locomotion.cycleRate,
      0,
      16,
      "locomotion.cycleRate"
    ),
    priority: readConfigFiniteInRange(
      config?.priority,
      DEFAULT_GRAPH_CONFIG.locomotion.priority,
      0,
      1_000_000,
      "locomotion.priority"
    )
  });
}

function resolvePostureConfig(
  config: CharacterAnimationGraphPostureConfig | undefined
): CharacterAnimationGraphResolvedPostureConfig {
  if (config !== undefined && !isRecord(config))
    throw new Error("character animation graph posture config must be an object");
  return Object.freeze({
    standingRequestId: readRequestId(
      config?.standingRequestId,
      DEFAULT_GRAPH_CONFIG.posture.standingRequestId,
      "posture.standingRequestId"
    ),
    crouchingRequestId: readRequestId(
      config?.crouchingRequestId,
      DEFAULT_GRAPH_CONFIG.posture.crouchingRequestId,
      "posture.crouchingRequestId"
    ),
    fadeSeconds: readConfigFiniteInRange(
      config?.fadeSeconds,
      DEFAULT_GRAPH_CONFIG.posture.fadeSeconds,
      0,
      10,
      "posture.fadeSeconds"
    ),
    priority: readConfigFiniteInRange(
      config?.priority,
      DEFAULT_GRAPH_CONFIG.posture.priority,
      0,
      1_000_000,
      "posture.priority"
    )
  });
}

function resolveAirborneConfig(
  config: CharacterAnimationGraphAirborneConfig | undefined
): CharacterAnimationGraphResolvedAirborneConfig {
  if (config !== undefined && !isRecord(config))
    throw new Error("character animation graph airborne config must be an object");
  const minPlaybackSpeed = readConfigFiniteInRange(
    config?.minPlaybackSpeed,
    DEFAULT_GRAPH_CONFIG.airborne.minPlaybackSpeed,
    0,
    16,
    "airborne.minPlaybackSpeed"
  );
  const maxPlaybackSpeed = readConfigFiniteInRange(
    config?.maxPlaybackSpeed,
    DEFAULT_GRAPH_CONFIG.airborne.maxPlaybackSpeed,
    minPlaybackSpeed,
    16,
    "airborne.maxPlaybackSpeed"
  );
  return Object.freeze({
    riseRequestId: readRequestId(
      config?.riseRequestId,
      DEFAULT_GRAPH_CONFIG.airborne.riseRequestId,
      "airborne.riseRequestId"
    ),
    fallRequestId: readRequestId(
      config?.fallRequestId,
      DEFAULT_GRAPH_CONFIG.airborne.fallRequestId,
      "airborne.fallRequestId"
    ),
    landingRequestId: readRequestId(
      config?.landingRequestId,
      DEFAULT_GRAPH_CONFIG.airborne.landingRequestId,
      "airborne.landingRequestId"
    ),
    fadeSeconds: readConfigFiniteInRange(
      config?.fadeSeconds,
      DEFAULT_GRAPH_CONFIG.airborne.fadeSeconds,
      0,
      10,
      "airborne.fadeSeconds"
    ),
    landingFadeSeconds: readConfigFiniteInRange(
      config?.landingFadeSeconds,
      DEFAULT_GRAPH_CONFIG.airborne.landingFadeSeconds,
      0,
      10,
      "airborne.landingFadeSeconds"
    ),
    landingHoldSeconds: readConfigFiniteInRange(
      config?.landingHoldSeconds,
      DEFAULT_GRAPH_CONFIG.airborne.landingHoldSeconds,
      0,
      10,
      "airborne.landingHoldSeconds"
    ),
    minRiseSeconds: readConfigFiniteInRange(
      config?.minRiseSeconds,
      DEFAULT_GRAPH_CONFIG.airborne.minRiseSeconds,
      0,
      10,
      "airborne.minRiseSeconds"
    ),
    minPlaybackSpeed,
    maxPlaybackSpeed,
    priority: readConfigFiniteInRange(
      config?.priority,
      DEFAULT_GRAPH_CONFIG.airborne.priority,
      0,
      1_000_000,
      "airborne.priority"
    )
  });
}

function resolveActionConfig(
  config: CharacterAnimationGraphActionConfig | undefined
): CharacterAnimationGraphResolvedActionConfig {
  if (config !== undefined && !isRecord(config))
    throw new Error("character animation graph action config must be an object");
  return Object.freeze({
    requestIdPrefix: readRequestIdPrefix(
      config?.requestIdPrefix,
      DEFAULT_GRAPH_CONFIG.action.requestIdPrefix,
      "action.requestIdPrefix"
    ),
    fadeSeconds: readConfigFiniteInRange(
      config?.fadeSeconds,
      DEFAULT_GRAPH_CONFIG.action.fadeSeconds,
      0,
      10,
      "action.fadeSeconds"
    ),
    priority: readConfigFiniteInRange(
      config?.priority,
      DEFAULT_GRAPH_CONFIG.action.priority,
      0,
      1_000_000,
      "action.priority"
    ),
    maxActionRequestsPerUpdate: readConfigIntegerInRange(
      config?.maxActionRequestsPerUpdate,
      DEFAULT_GRAPH_CONFIG.action.maxActionRequestsPerUpdate,
      0,
      MAX_ACTIONS_PER_UPDATE,
      "action.maxActionRequestsPerUpdate"
    )
  });
}

function resetCharacterAnimationGraphOutput(output: CharacterAnimationGraphOutput): void {
  output.schemaVersion = CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION;
  output.sequence = 0;
  output.deltaSeconds = 0;
  output.locomotionActive = false;
  output.locomotionWeight = 0;
  output.postureWeight = 0;
  output.primaryRequestId = null;
  output.playback.length = 0;
  output.blends.length = 0;
  output.transitions.length = 0;
  output.actions.length = 0;
  output.issues.length = 0;
}

function sanitizeDeltaSeconds(
  deltaSeconds: number | undefined,
  maxDeltaSeconds: number,
  issues: CharacterAnimationGraphIssue[]
): number {
  if (deltaSeconds === undefined) return 0;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    issues.push({
      type: "input-rejected",
      field: "deltaSeconds",
      code: "finite-nonnegative",
      message: "character animation graph deltaSeconds must be finite and non-negative"
    });
    return 0;
  }
  if (deltaSeconds > maxDeltaSeconds) {
    issues.push({
      type: "bounded",
      field: "deltaSeconds",
      code: "max-delta",
      message: "character animation graph capped deltaSeconds to maxDeltaSeconds"
    });
    return maxDeltaSeconds;
  }
  return deltaSeconds;
}

function sanitizeAnimationState(
  animation: CharacterAnimationState,
  fallbackGaitId: CharacterGaitId,
  config: CharacterAnimationGraphResolvedConfig,
  issues: CharacterAnimationGraphIssue[]
): SanitizedAnimationState {
  if (!isRecord(animation)) {
    issues.push({
      type: "input-rejected",
      field: "animation",
      code: "type",
      message: "character animation graph input must be a CharacterAnimationState object"
    });
    return defaultSanitizedAnimationState(fallbackGaitId);
  }
  const gaitId = sanitizeGaitId(animation.gaitId, fallbackGaitId, config, issues);
  const locomotionPhase = sanitizeLocomotionPhase(animation.locomotionPhase, issues);
  const posturePhase = sanitizePosturePhase(animation.posturePhase, issues);
  return {
    gaitId,
    planarSpeed: readRuntimeFiniteNonNegative(animation.planarSpeed, 0, "animation.planarSpeed", issues),
    verticalSpeed: readRuntimeFinite(animation.verticalSpeed, 0, "animation.verticalSpeed", issues),
    speedRatio: readRuntimeFiniteNonNegative(animation.speedRatio, 0, "animation.speedRatio", issues),
    animationSpeed: readRuntimeFiniteNonNegative(animation.animationSpeed, 1, "animation.animationSpeed", issues),
    moveMagnitude: readRuntimeFiniteInRange(animation.moveMagnitude, 0, 0, 1, "animation.moveMagnitude", issues),
    desiredSpeed: readRuntimeFiniteNonNegative(animation.desiredSpeed, 0, "animation.desiredSpeed", issues),
    locomotionPhase,
    posturePhase,
    crouchAlpha: readRuntimeFiniteInRange(animation.crouchAlpha, 0, 0, 1, "animation.crouchAlpha", issues),
    events: sanitizeControllerEvents(animation.events, issues),
    transitions: sanitizeControllerTransitions(animation.transitions, issues)
  };
}

function defaultSanitizedAnimationState(fallbackGaitId: CharacterGaitId): SanitizedAnimationState {
  return {
    gaitId: fallbackGaitId,
    planarSpeed: 0,
    verticalSpeed: 0,
    speedRatio: 0,
    animationSpeed: 1,
    moveMagnitude: 0,
    desiredSpeed: 0,
    locomotionPhase: "grounded",
    posturePhase: "standing",
    crouchAlpha: 0,
    events: [],
    transitions: []
  };
}

function emitLocomotionPlayback(
  config: CharacterAnimationGraphResolvedConfig,
  gaitId: CharacterGaitId,
  locomotion: { gaitRequestId: string; weight: number; playbackSpeed: number },
  phase: number,
  output: CharacterAnimationGraphOutput
): void {
  const idleWeight = clamp01(1 - locomotion.weight);
  if (idleWeight > EPSILON) {
    output.playback.push({
      type: "playback",
      layer: "locomotion",
      requestId: config.locomotion.idleRequestId,
      weight: idleWeight,
      playbackSpeed: 1,
      priority: config.locomotion.priority,
      loop: true,
      phase,
      transitionSeconds: config.locomotion.fadeSeconds,
      reason: "idle"
    });
  }
  if (locomotion.weight > EPSILON) {
    output.playback.push({
      type: "playback",
      layer: "locomotion",
      requestId: gaitRequestIdFor(config, gaitId),
      weight: locomotion.weight,
      playbackSpeed: locomotion.playbackSpeed,
      priority: config.locomotion.priority,
      loop: true,
      phase,
      transitionSeconds: config.locomotion.fadeSeconds,
      reason: "gait"
    });
  }
  output.blends.push({
    type: "blend",
    layer: "locomotion",
    from: config.locomotion.idleRequestId,
    to: locomotion.gaitRequestId,
    fromWeight: idleWeight,
    toWeight: locomotion.weight,
    priority: config.locomotion.priority,
    transitionSeconds: config.locomotion.fadeSeconds,
    reason: "gait"
  });
}

function emitPosturePlayback(
  config: CharacterAnimationGraphResolvedConfig,
  posture: { requestId: string; weight: number },
  output: CharacterAnimationGraphOutput
): void {
  const standingWeight = clamp01(1 - posture.weight);
  if (standingWeight > EPSILON) {
    output.playback.push({
      type: "playback",
      layer: "posture",
      requestId: config.posture.standingRequestId,
      weight: standingWeight,
      playbackSpeed: 1,
      priority: config.posture.priority,
      loop: true,
      phase: 0,
      transitionSeconds: config.posture.fadeSeconds,
      reason: "posture"
    });
  }
  if (posture.weight > EPSILON) {
    output.playback.push({
      type: "playback",
      layer: "posture",
      requestId: config.posture.crouchingRequestId,
      weight: posture.weight,
      playbackSpeed: 1,
      priority: config.posture.priority,
      loop: true,
      phase: posture.weight,
      transitionSeconds: config.posture.fadeSeconds,
      reason: "posture"
    });
  }
  output.blends.push({
    type: "blend",
    layer: "posture",
    from: config.posture.standingRequestId,
    to: config.posture.crouchingRequestId,
    fromWeight: standingWeight,
    toWeight: posture.weight,
    priority: config.posture.priority,
    transitionSeconds: config.posture.fadeSeconds,
    reason: "posture"
  });
}

function emitAirbornePlayback(
  config: CharacterAnimationGraphResolvedConfig,
  airborne: { requestId: string | null; playbackSpeed: number; phase: CharacterLocomotionPhase | "grounded" },
  phaseSeconds: number,
  output: CharacterAnimationGraphOutput
): void {
  if (!airborne.requestId) return;
  output.playback.push({
    type: "playback",
    layer: "airborne",
    requestId: airborne.requestId,
    weight: 1,
    playbackSpeed: airborne.playbackSpeed,
    priority: config.airborne.priority,
    loop: airborne.phase === "falling",
    phase: clamp01(phaseSeconds * airborne.playbackSpeed),
    transitionSeconds:
      airborne.requestId === config.airborne.landingRequestId
        ? config.airborne.landingFadeSeconds
        : config.airborne.fadeSeconds,
    reason: "airborne"
  });
}

function readLocomotionMetric(animation: SanitizedAnimationState): number {
  const desiredRatio = animation.desiredSpeed > EPSILON ? animation.planarSpeed / animation.desiredSpeed : 0;
  return clamp(Math.max(animation.speedRatio, animation.moveMagnitude, desiredRatio), 0, 1.5);
}

function gaitRequestIdFor(config: CharacterAnimationGraphResolvedConfig, gaitId: CharacterGaitId): string {
  return `${config.locomotion.gaitRequestIdPrefix}${gaitId}`;
}

function findTransitionTick(
  transitions: readonly CharacterAnimationTransition[],
  limit: number,
  type: CharacterAnimationTransition["type"]
): number | undefined {
  for (let index = 0; index < limit; index += 1) {
    const transition = transitions[index];
    if (transition?.type === type && Number.isSafeInteger(transition.tick) && transition.tick >= 0)
      return transition.tick;
  }
  return undefined;
}

function controllerTickProperty(tick: number | undefined): { controllerTick?: number } {
  return tick === undefined ? {} : { controllerTick: tick };
}

function sanitizeActionCommand(
  command: CharacterActionIntent | undefined,
  controllerTick: number | undefined,
  issues: CharacterAnimationGraphIssue[]
): CharacterActionIntent | null {
  if (!isRecord(command)) {
    issues.push({
      type: "input-rejected",
      field: "events.action-command.command",
      code: "type",
      message: "action-command events must include a valid command object",
      ...controllerTickProperty(controllerTick)
    });
    return null;
  }
  if (!isBoundedNonEmptyString(command.commandId)) {
    issues.push({
      type: "input-rejected",
      field: "events.action-command.commandId",
      code: "id",
      message: "action command id must be a non-empty string",
      ...controllerTickProperty(controllerTick)
    });
    return null;
  }
  if (!VALID_ACTION_KINDS.has(command.kind)) {
    issues.push({
      type: "input-rejected",
      field: "events.action-command.kind",
      code: "enum",
      message: "action command kind is not supported",
      ...controllerTickProperty(controllerTick)
    });
    return null;
  }
  if (!isOptionalBoundedString(command.itemId)) {
    rejectActionField("events.action-command.itemId", controllerTick, issues);
    return null;
  }
  if (!isOptionalBoundedString(command.socketId)) {
    rejectActionField("events.action-command.socketId", controllerTick, issues);
    return null;
  }
  if (!isOptionalBoundedString(command.interactionId)) {
    rejectActionField("events.action-command.interactionId", controllerTick, issues);
    return null;
  }
  if (!isOptionalBoundedString(command.targetActorId)) {
    rejectActionField("events.action-command.targetActorId", controllerTick, issues);
    return null;
  }
  return cloneActionCommand(command);
}

function cloneActionCommand(command: CharacterActionIntent): CharacterActionIntent {
  return {
    commandId: command.commandId,
    kind: command.kind,
    ...(command.itemId !== undefined ? { itemId: command.itemId } : {}),
    ...(command.socketId !== undefined ? { socketId: command.socketId } : {}),
    ...(command.interactionId !== undefined ? { interactionId: command.interactionId } : {}),
    ...(command.targetActorId !== undefined ? { targetActorId: command.targetActorId } : {})
  };
}

function sanitizeGaitId(
  value: unknown,
  fallback: CharacterGaitId,
  config: CharacterAnimationGraphResolvedConfig,
  issues: CharacterAnimationGraphIssue[]
): CharacterGaitId {
  if (
    isBoundedNonEmptyString(value) &&
    config.locomotion.gaitRequestIdPrefix.length + value.length <= MAX_REQUEST_ID_LENGTH
  ) {
    return value;
  }
  issues.push({
    type: "input-rejected",
    field: "animation.gaitId",
    code: "id",
    message: "animation gaitId must be a bounded non-empty string compatible with gaitRequestIdPrefix"
  });
  return fallback;
}

function sanitizeLocomotionPhase(
  value: CharacterLocomotionPhase,
  issues: CharacterAnimationGraphIssue[]
): CharacterLocomotionPhase {
  if (VALID_LOCOMOTION_PHASES.has(value)) return value;
  issues.push({
    type: "input-rejected",
    field: "animation.locomotionPhase",
    code: "enum",
    message: "animation locomotionPhase is not supported"
  });
  return "grounded";
}

function sanitizePosturePhase(
  value: CharacterPosturePhase,
  issues: CharacterAnimationGraphIssue[]
): CharacterPosturePhase {
  if (VALID_POSTURE_PHASES.has(value)) return value;
  issues.push({
    type: "input-rejected",
    field: "animation.posturePhase",
    code: "enum",
    message: "animation posturePhase is not supported"
  });
  return "standing";
}

function sanitizeControllerEvents(
  value: readonly CharacterControllerEvent[],
  issues: CharacterAnimationGraphIssue[]
): readonly CharacterControllerEvent[] {
  if (isArrayValue(value)) return value;
  issues.push({
    type: "input-rejected",
    field: "animation.events",
    code: "array",
    message: "animation.events must be an array"
  });
  return [];
}

function sanitizeControllerTransitions(
  value: readonly CharacterAnimationTransition[],
  issues: CharacterAnimationGraphIssue[]
): readonly CharacterAnimationTransition[] {
  if (isArrayValue(value)) return value;
  issues.push({
    type: "input-rejected",
    field: "animation.transitions",
    code: "array",
    message: "animation.transitions must be an array"
  });
  return [];
}

function sanitizeControllerTick(
  value: number,
  field: string,
  issues: CharacterAnimationGraphIssue[]
): number | undefined {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  issues.push({
    type: "input-rejected",
    field,
    code: "tick",
    message: "controller event tick must be a non-negative safe integer"
  });
  return undefined;
}

function rejectActionField(
  field: string,
  controllerTick: number | undefined,
  issues: CharacterAnimationGraphIssue[]
): void {
  issues.push({
    type: "input-rejected",
    field,
    code: "id",
    message: "action command optional ids must be bounded strings when present",
    ...controllerTickProperty(controllerTick)
  });
}

function reportTruncation(field: string, actual: number, limit: number, issues: CharacterAnimationGraphIssue[]): void {
  if (actual <= limit) return;
  issues.push({
    type: "bounded",
    field: `animation.${field}`,
    code: "max-scan",
    message: "character animation graph ignored controller records beyond maxControllerEventsPerUpdate"
  });
}

function cloneGraphSnapshot(snapshot: CharacterAnimationGraphSnapshot): CharacterAnimationGraphSnapshot {
  return {
    schemaVersion: CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION,
    tick: snapshot.tick,
    locomotionActive: snapshot.locomotionActive,
    locomotionRequestId: snapshot.locomotionRequestId,
    gaitId: snapshot.gaitId,
    postureRequestId: snapshot.postureRequestId,
    airborneRequestId: snapshot.airborneRequestId,
    airbornePhaseSeconds: snapshot.airbornePhaseSeconds,
    landingHoldSeconds: snapshot.landingHoldSeconds,
    playbackPhase: snapshot.playbackPhase,
    ...(snapshot.lastActionCommandId !== undefined ? { lastActionCommandId: snapshot.lastActionCommandId } : {})
  };
}

function validateGraphSnapshot(
  snapshot: CharacterAnimationGraphSnapshot,
  config: CharacterAnimationGraphResolvedConfig
): CharacterAnimationGraphSnapshot {
  if (!isRecord(snapshot)) throw new Error("character animation graph snapshot must be an object");
  if (snapshot.schemaVersion !== CHARACTER_ANIMATION_GRAPH_SCHEMA_VERSION) {
    throw new Error("character animation graph snapshot schemaVersion is unsupported");
  }
  if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0)
    throw new Error("character animation graph snapshot tick is invalid");
  if (typeof snapshot.locomotionActive !== "boolean")
    throw new Error("character animation graph snapshot locomotionActive is invalid");
  if (!isNonEmptyString(snapshot.locomotionRequestId))
    throw new Error("character animation graph snapshot locomotionRequestId is invalid");
  if (!isNonEmptyString(snapshot.gaitId)) throw new Error("character animation graph snapshot gaitId is invalid");
  if (!isNonEmptyString(snapshot.postureRequestId))
    throw new Error("character animation graph snapshot postureRequestId is invalid");
  if (snapshot.airborneRequestId !== null && !isNonEmptyString(snapshot.airborneRequestId)) {
    throw new Error("character animation graph snapshot airborneRequestId is invalid");
  }
  if (!isKnownGraphRequest(snapshot, config))
    throw new Error("character animation graph snapshot request ids do not match config");
  requiredFiniteInRange(snapshot.airbornePhaseSeconds, 0, 10, "snapshot.airbornePhaseSeconds");
  requiredFiniteInRange(
    snapshot.landingHoldSeconds,
    0,
    config.airborne.landingHoldSeconds + EPSILON,
    "snapshot.landingHoldSeconds"
  );
  requiredFiniteInRange(snapshot.playbackPhase, 0, 1, "snapshot.playbackPhase");
  if (snapshot.lastActionCommandId !== undefined && !isNonEmptyString(snapshot.lastActionCommandId)) {
    throw new Error("character animation graph snapshot lastActionCommandId is invalid");
  }
  return cloneGraphSnapshot(snapshot);
}

function isKnownGraphRequest(
  snapshot: CharacterAnimationGraphSnapshot,
  config: CharacterAnimationGraphResolvedConfig
): boolean {
  const locomotionKnown =
    snapshot.locomotionRequestId === config.locomotion.idleRequestId ||
    snapshot.locomotionRequestId.startsWith(config.locomotion.gaitRequestIdPrefix);
  const postureKnown =
    snapshot.postureRequestId === config.posture.standingRequestId ||
    snapshot.postureRequestId === config.posture.crouchingRequestId;
  const airborneKnown =
    snapshot.airborneRequestId === null ||
    snapshot.airborneRequestId === config.airborne.riseRequestId ||
    snapshot.airborneRequestId === config.airborne.fallRequestId ||
    snapshot.airborneRequestId === config.airborne.landingRequestId;
  return locomotionKnown && postureKnown && airborneKnown;
}

function readConfigFiniteInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`character animation graph ${label} must be finite in [${min}, ${max}]`);
  }
  return value;
}

function readConfigIntegerInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`character animation graph ${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function readRequestId(value: string | undefined, fallback: string, label: string): string {
  const requestId = value ?? fallback;
  if (!isNonEmptyString(requestId) || requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw new Error(`character animation graph ${label} must be a non-empty bounded string`);
  }
  return requestId;
}

function readRequestIdPrefix(value: string | undefined, fallback: string, label: string): string {
  const prefix = value ?? fallback;
  if (typeof prefix !== "string" || prefix.length > MAX_REQUEST_ID_LENGTH) {
    throw new Error(`character animation graph ${label} must be a bounded string`);
  }
  return prefix;
}

function readRuntimeFinite(
  value: number,
  fallback: number,
  field: string,
  issues: CharacterAnimationGraphIssue[]
): number {
  if (Number.isFinite(value)) return value;
  issues.push({
    type: "input-rejected",
    field,
    code: "finite",
    message: `${field} must be finite`
  });
  return fallback;
}

function readRuntimeFiniteNonNegative(
  value: number,
  fallback: number,
  field: string,
  issues: CharacterAnimationGraphIssue[]
): number {
  const finite = readRuntimeFinite(value, fallback, field, issues);
  if (finite >= 0) return finite;
  issues.push({
    type: "input-rejected",
    field,
    code: "nonnegative",
    message: `${field} must be non-negative`
  });
  return fallback;
}

function readRuntimeFiniteInRange(
  value: number,
  fallback: number,
  min: number,
  max: number,
  field: string,
  issues: CharacterAnimationGraphIssue[]
): number {
  const finite = readRuntimeFinite(value, fallback, field, issues);
  if (finite >= min && finite <= max) return finite;
  issues.push({
    type: "input-rejected",
    field,
    code: "range",
    message: `${field} must be in [${min}, ${max}]`
  });
  return fallback;
}

function requiredFiniteInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`character animation graph ${label} must be finite in [${min}, ${max}]`);
  }
}

function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_REQUEST_ID_LENGTH;
}

function isOptionalBoundedString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= MAX_REQUEST_ID_LENGTH);
}
