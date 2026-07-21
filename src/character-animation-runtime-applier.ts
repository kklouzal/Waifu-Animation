import type {
  CharacterAnimationBindingOutput,
  CharacterAnimationResolvedAction,
  CharacterAnimationResolvedBlend,
  CharacterAnimationResolvedBlendEndpoint,
  CharacterAnimationResolvedClipBinding,
  CharacterAnimationResolvedPlayback,
  CharacterAnimationResolvedTransition
} from "./character-animation-binding.js";
import type { CharacterAnimationGraphLayerId } from "./character-animation-graph.js";
import type { AnimationClip } from "./clip.js";
import { clamp01, EPSILON } from "./math.js";
import { type JointMask, validateJointMask } from "./pose.js";
import { AnimationRuntime, type LayerBlendMode } from "./runtime.js";

export const CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION = 1;

export type CharacterAnimationRuntimeApplySource = "playback" | "blend" | "transition" | "action";

export type CharacterAnimationRuntimeApplierIssueType =
  | "input-rejected"
  | "missing-clip"
  | "missing-mask"
  | "invalid-record"
  | "invalid-resource"
  | "layer-conflict"
  | "duplicate-action"
  | "bounded";

export type CharacterAnimationRuntimeApplierIssue = {
  type: CharacterAnimationRuntimeApplierIssueType;
  field: string;
  code: string;
  message: string;
  source?: CharacterAnimationRuntimeApplySource;
  sourceIndex?: number;
  requestId?: string;
  clipId?: string;
  maskId?: string;
  runtimeLayerId?: string;
};

export type CharacterAnimationRuntimeLookupContext = Readonly<{
  source: CharacterAnimationRuntimeApplySource;
  sourceIndex: number;
  requestId: string;
  clipId: string;
  graphLayer: CharacterAnimationGraphLayerId;
  laneId: string;
  layerId: string;
  runtimeLayerId: string;
  maskId?: string;
}>;

export type CharacterAnimationRuntimeClipResolver = (
  clipId: string,
  context: CharacterAnimationRuntimeLookupContext
) => AnimationClip | null | undefined;

export type CharacterAnimationRuntimeMaskResolver = (
  maskId: string,
  context: CharacterAnimationRuntimeLookupContext
) => JointMask | null | undefined;

export type CharacterAnimationRuntimeClipLookup =
  | ReadonlyMap<string, AnimationClip>
  | Readonly<Record<string, AnimationClip | null | undefined>>
  | CharacterAnimationRuntimeClipResolver;

export type CharacterAnimationRuntimeMaskLookup =
  | ReadonlyMap<string, JointMask>
  | Readonly<Record<string, JointMask | null | undefined>>
  | CharacterAnimationRuntimeMaskResolver;

export type CharacterAnimationRuntimeApplyResources = Readonly<{
  clips: CharacterAnimationRuntimeClipLookup;
  masks?: CharacterAnimationRuntimeMaskLookup;
}>;

export type CharacterAnimationRuntimeApplierConfig = {
  /** Prefix for all runtime layer ids owned by this applier. Defaults to character-animation. */
  namespace?: string;
  /** Maximum records inspected per binding-output array during one apply call. */
  maxRecordsPerApply?: number;
  /** Maximum runtime layers tracked as owned by this applier. */
  maxOwnedLayers?: number;
  /** Maximum action command identities retained to prevent accidental per-frame retriggers. */
  maxActionIdentities?: number;
  /** Maximum issues kept in each apply output. */
  maxIssues?: number;
  /** Fallback fade used when stale owned layers have no transition-specific fade hint. */
  staleFadeSeconds?: number;
};

export type CharacterAnimationRuntimeApplierResolvedConfig = Readonly<{
  namespace: string;
  maxRecordsPerApply: number;
  maxOwnedLayers: number;
  maxActionIdentities: number;
  maxIssues: number;
  staleFadeSeconds: number;
}>;

export type CharacterAnimationRuntimeApplyOptions = {
  /** Optional reusable output buffer. Arrays are cleared and reused. */
  output?: CharacterAnimationRuntimeApplyResult;
  /** Optional wall-clock step for applier-owned one-shot action retirement timers. */
  deltaSeconds?: number;
};

export type CharacterAnimationRuntimeAppliedLayer = Readonly<{
  source: CharacterAnimationRuntimeApplySource;
  runtimeLayerId: string;
  laneId: string;
  layerId: string;
  graphLayer: CharacterAnimationGraphLayerId;
  requestId: string;
  clipId: string;
  targetWeight: number;
  fadeSeconds: number;
  fadeSpeed: number;
  speed: number;
  priority: number;
  blendMode: LayerBlendMode;
  loop: boolean;
  resetTime: boolean;
  sourceIndex: number;
  maskId?: string;
  phase?: number;
  time?: number;
  actionIdentity?: string;
}>;

export type CharacterAnimationRuntimeRetiredLayer = Readonly<{
  runtimeLayerId: string;
  fadeSeconds: number;
  fadeSpeed: number;
  reason: "stale" | "transition" | "action-complete" | "bounded";
}>;

export type CharacterAnimationRuntimeApplyResult = {
  schemaVersion: typeof CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION;
  sequence: number;
  applied: CharacterAnimationRuntimeAppliedLayer[];
  faded: CharacterAnimationRuntimeRetiredLayer[];
  removed: CharacterAnimationRuntimeRetiredLayer[];
  issues: CharacterAnimationRuntimeApplierIssue[];
};

export type CharacterAnimationRuntimeApplierLayerSnapshot = Readonly<{
  runtimeLayerId: string;
  laneId: string;
  layerId: string;
  graphLayer: CharacterAnimationGraphLayerId;
  requestId: string;
  clipId: string;
  source: CharacterAnimationRuntimeApplySource;
  fadeSeconds: number;
  actionIdentity?: string;
}>;

export type CharacterAnimationRuntimeApplierActionSnapshot = Readonly<{
  identity: string;
  runtimeLayerId: string;
  clipId: string;
  elapsedSeconds: number;
  durationSeconds: number;
  speed: number;
  fadeSeconds: number;
}>;

export type CharacterAnimationRuntimeApplierSnapshot = Readonly<{
  schemaVersion: typeof CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION;
  namespace: string;
  applyCount: number;
  ownedLayers: readonly CharacterAnimationRuntimeApplierLayerSnapshot[];
  retiringLayers?: readonly CharacterAnimationRuntimeApplierLayerSnapshot[];
  activeActions: readonly CharacterAnimationRuntimeApplierActionSnapshot[];
  seenActionIdentities: readonly string[];
}>;

type PlaybackMetadata = Readonly<{
  phase: number;
  playbackSpeed: number;
  weight: number;
  sourceIndex: number;
}>;

type LayerCommand = {
  source: CharacterAnimationRuntimeApplySource;
  sourceIndex: number;
  graphLayer: CharacterAnimationGraphLayerId;
  requestId: string;
  clipId: string;
  laneId: string;
  layerId: string;
  runtimeLayerId: string;
  clip: AnimationClip;
  targetWeight: number;
  fadeSeconds: number;
  speed: number;
  priority: number;
  blendMode: LayerBlendMode;
  loop: boolean;
  mask?: JointMask;
  maskId?: string;
  phase?: number;
  time?: number;
  actionIdentity?: string;
};

type OwnedLayerState = {
  runtimeLayerId: string;
  laneId: string;
  layerId: string;
  graphLayer: CharacterAnimationGraphLayerId;
  requestId: string;
  clipId: string;
  source: CharacterAnimationRuntimeApplySource;
  fadeSeconds: number;
  actionIdentity?: string;
};

type ActiveActionState = {
  identity: string;
  runtimeLayerId: string;
  clipId: string;
  elapsedSeconds: number;
  durationSeconds: number;
  speed: number;
  fadeSeconds: number;
};

type RetireReason = CharacterAnimationRuntimeRetiredLayer["reason"];

const DEFAULT_NAMESPACE = "character-animation";
const MAX_NAMESPACE_LENGTH = 80;
const MAX_ID_LENGTH = 160;
const MAX_RUNTIME_LAYER_ID_LENGTH = 512;
const DEFAULT_MAX_RECORDS_PER_APPLY = 512;
const MAX_RECORDS_PER_APPLY = 4096;
const DEFAULT_MAX_OWNED_LAYERS = 256;
const MAX_OWNED_LAYERS = 1024;
const DEFAULT_MAX_ACTION_IDENTITIES = 256;
const MAX_ACTION_IDENTITIES = 1024;
const DEFAULT_MAX_ISSUES = 128;
const MAX_ISSUES = 512;
const DEFAULT_STALE_FADE_SECONDS = 0.12;
const MAX_FADE_SECONDS = 10;
const MAX_PLAYBACK_SPEED = 16;
const MAX_PRIORITY = 1_000_000;
const IMMEDIATE_FADE_SPEED = 1_000_000;
const VALID_GRAPH_LAYERS = new Set<CharacterAnimationGraphLayerId>(["locomotion", "posture", "airborne", "action"]);
const VALID_BLEND_MODES = new Set<LayerBlendMode>(["override", "additive"]);
const VALID_ACTION_KINDS = new Set(["pickup", "drop", "equip", "unequip", "sit", "stand", "use", "custom"]);
const SOURCE_ORDER: Record<CharacterAnimationRuntimeApplySource, number> = {
  blend: 0,
  playback: 1,
  transition: 2,
  action: 3
};

export class CharacterAnimationRuntimeApplier {
  readonly schemaVersion = CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION;
  readonly config: CharacterAnimationRuntimeApplierResolvedConfig;
  #applyCount = 0;
  #ownedLayers = new Map<string, OwnedLayerState>();
  #retiringLayers = new Map<string, OwnedLayerState>();
  #activeActions = new Map<string, ActiveActionState>();
  #seenActionIdentityOrder: string[] = [];
  #seenActionIdentities = new Set<string>();

  constructor(config: CharacterAnimationRuntimeApplierConfig = {}) {
    this.config = resolveCharacterAnimationRuntimeApplierConfig(config);
  }

  apply(
    runtime: AnimationRuntime,
    bindingOutput: CharacterAnimationBindingOutput,
    resources: CharacterAnimationRuntimeApplyResources,
    options: CharacterAnimationRuntimeApplyOptions = {}
  ): CharacterAnimationRuntimeApplyResult {
    const output = options.output ?? createCharacterAnimationRuntimeApplyResultBuffer();
    resetApplyResult(output);
    output.sequence = readSafeSequence(isRecord(bindingOutput) ? bindingOutput.sequence : undefined);
    this.#applyCount += 1;

    if (!(runtime instanceof AnimationRuntime)) {
      pushIssue(
        output.issues,
        {
          type: "input-rejected",
          field: "runtime",
          code: "type",
          message: "character animation runtime applier requires an AnimationRuntime instance"
        },
        this.config.maxIssues
      );
      return output;
    }
    if (!isRecord(bindingOutput)) {
      pushIssue(
        output.issues,
        {
          type: "input-rejected",
          field: "bindingOutput",
          code: "type",
          message: "character animation runtime applier input must be a binding output object"
        },
        this.config.maxIssues
      );
      return output;
    }
    if (!isRecord(resources)) {
      pushIssue(
        output.issues,
        {
          type: "input-rejected",
          field: "resources",
          code: "type",
          message: "character animation runtime applier resources must be an object"
        },
        this.config.maxIssues
      );
      return output;
    }

    this.#pruneRetiringLayers(runtime);
    this.#advanceActionTimers(
      runtime,
      readOptionalDeltaSeconds(options.deltaSeconds, output.issues, this.config),
      output
    );

    const playback = readPlaybackRecords(bindingOutput.playback, output.issues, this.config);
    const playbackMetadata = new Map<string, PlaybackMetadata>();
    for (const record of playback) {
      playbackMetadata.set(record.requestId, {
        phase: record.phase,
        playbackSpeed: record.playbackSpeed,
        weight: record.weight,
        sourceIndex: record.sourceIndex
      });
    }

    const blends = readBlendRecords(bindingOutput.blends, output.issues, this.config);
    const transitions = readTransitionRecords(bindingOutput.transitions, output.issues, this.config);
    const actions = readActionRecords(bindingOutput.actions, output.issues, this.config);

    const desired = new Map<string, LayerCommand>();
    const blendCoveredRequests = new Set<string>();
    const transitionFadeSecondsByLayer = new Map<string, number>();

    for (const transition of transitions) {
      rememberTransitionFade(transition, transitionFadeSecondsByLayer, this.config.namespace);
    }

    for (const blend of blends) {
      if (blend.from) {
        blendCoveredRequests.add(blend.from.requestId);
        this.#addEndpointCommand({
          runtime,
          resources,
          desired,
          endpoint: blend.from,
          source: "blend",
          sourceIndex: blend.sourceIndex,
          targetWeight: blend.from.weight,
          fallbackFadeSeconds: blend.fadeSeconds,
          playbackMetadata: playbackMetadata.get(blend.from.requestId),
          output
        });
      }
      if (blend.to) {
        blendCoveredRequests.add(blend.to.requestId);
        this.#addEndpointCommand({
          runtime,
          resources,
          desired,
          endpoint: blend.to,
          source: "blend",
          sourceIndex: blend.sourceIndex,
          targetWeight: blend.to.weight,
          fallbackFadeSeconds: blend.fadeSeconds,
          playbackMetadata: playbackMetadata.get(blend.to.requestId),
          output
        });
      }
    }

    for (const record of playback) {
      if (blendCoveredRequests.has(record.requestId)) continue;
      this.#addEndpointCommand({
        runtime,
        resources,
        desired,
        endpoint: record,
        source: "playback",
        sourceIndex: record.sourceIndex,
        targetWeight: record.weight,
        fallbackFadeSeconds: record.fadeSeconds,
        playbackMetadata: playbackMetadata.get(record.requestId),
        output
      });
    }

    for (const transition of transitions) {
      if (!transition.to) continue;
      const runtimeLayerId = composeRuntimeLayerId(this.config.namespace, transition.to.laneId, transition.to.layerId);
      if (desired.has(runtimeLayerId)) continue;
      this.#addEndpointCommand({
        runtime,
        resources,
        desired,
        endpoint: transition.to,
        source: "transition",
        sourceIndex: transition.sourceIndex,
        targetWeight: 1,
        fallbackFadeSeconds: transition.fadeSeconds,
        playbackMetadata: playbackMetadata.get(transition.to.requestId),
        output
      });
    }

    for (const action of actions) {
      this.#addActionCommand(runtime, resources, desired, action, output);
    }

    const activeActionLayerIds = new Set(Array.from(this.#activeActions.values(), (action) => action.runtimeLayerId));
    const desiredLayerIds = new Set(desired.keys());
    const desiredCommands = Array.from(desired.values()).sort(compareLayerCommandOrder);

    for (const command of desiredCommands) {
      this.#applyCommand(runtime, command, output);
      desiredLayerIds.add(command.runtimeLayerId);
    }

    const staleLayerIds = Array.from(this.#ownedLayers.keys()).sort(compareString);
    for (const runtimeLayerId of staleLayerIds) {
      if (desiredLayerIds.has(runtimeLayerId) || activeActionLayerIds.has(runtimeLayerId)) continue;
      const state = this.#ownedLayers.get(runtimeLayerId);
      if (!state) continue;
      const transitionFadeSeconds = transitionFadeSecondsByLayer.get(runtimeLayerId);
      this.#retireOwnedLayer(
        runtime,
        runtimeLayerId,
        transitionFadeSeconds ?? state.fadeSeconds ?? this.config.staleFadeSeconds,
        transitionFadeSeconds === undefined ? "stale" : "transition",
        output
      );
    }

    this.#enforceOwnedLayerLimit(runtime, output);
    return output;
  }

  snapshot(): CharacterAnimationRuntimeApplierSnapshot {
    const ownedLayers = Array.from(this.#ownedLayers.values())
      .sort((a, b) => compareString(a.runtimeLayerId, b.runtimeLayerId))
      .map((layer): CharacterAnimationRuntimeApplierLayerSnapshot => freezeOptionalActionIdentity({ ...layer }));
    const retiringLayers = Array.from(this.#retiringLayers.values())
      .sort((a, b) => compareString(a.runtimeLayerId, b.runtimeLayerId))
      .map((layer): CharacterAnimationRuntimeApplierLayerSnapshot => freezeOptionalActionIdentity({ ...layer }));
    const activeActions = Array.from(this.#activeActions.values())
      .sort((a, b) => compareString(a.identity, b.identity))
      .map((action): CharacterAnimationRuntimeApplierActionSnapshot => Object.freeze({ ...action }));
    return Object.freeze({
      schemaVersion: CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION,
      namespace: this.config.namespace,
      applyCount: this.#applyCount,
      ownedLayers: Object.freeze(ownedLayers),
      ...(retiringLayers.length > 0 ? { retiringLayers: Object.freeze(retiringLayers) } : {}),
      activeActions: Object.freeze(activeActions),
      seenActionIdentities: Object.freeze([...this.#seenActionIdentityOrder])
    });
  }

  restore(snapshot: CharacterAnimationRuntimeApplierSnapshot): void {
    const restored = validateRuntimeApplierSnapshot(snapshot, this.config);
    this.#applyCount = restored.applyCount;
    this.#ownedLayers = new Map(restored.ownedLayers.map((layer) => [layer.runtimeLayerId, { ...layer }]));
    this.#retiringLayers = new Map(
      (restored.retiringLayers ?? []).map((layer) => [layer.runtimeLayerId, { ...layer }])
    );
    this.#activeActions = new Map(restored.activeActions.map((action) => [action.identity, { ...action }]));
    this.#seenActionIdentityOrder = [...restored.seenActionIdentities];
    this.#seenActionIdentities = new Set(restored.seenActionIdentities);
  }

  reset(): void {
    this.#applyCount = 0;
    this.#ownedLayers.clear();
    this.#retiringLayers.clear();
    this.#activeActions.clear();
    this.#seenActionIdentities.clear();
    this.#seenActionIdentityOrder.length = 0;
  }

  #addEndpointCommand(context: {
    runtime: AnimationRuntime;
    resources: CharacterAnimationRuntimeApplyResources;
    desired: Map<string, LayerCommand>;
    endpoint: CharacterAnimationResolvedClipBinding & { weight?: number; phase?: number };
    source: CharacterAnimationRuntimeApplySource;
    sourceIndex: number;
    targetWeight: number;
    fallbackFadeSeconds: number;
    playbackMetadata?: PlaybackMetadata | undefined;
    output: CharacterAnimationRuntimeApplyResult;
  }): void {
    const runtimeLayerId = composeRuntimeLayerId(
      this.config.namespace,
      context.endpoint.laneId,
      context.endpoint.layerId
    );
    const targetWeight = clamp01Finite(context.targetWeight);
    const fadeSeconds = sanitizeFadeSeconds(context.endpoint.fadeSeconds ?? context.fallbackFadeSeconds);
    if (targetWeight <= EPSILON) {
      if (this.#ownedLayers.has(runtimeLayerId)) {
        this.#retireOwnedLayer(context.runtime, runtimeLayerId, fadeSeconds, "transition", context.output);
      }
      return;
    }

    const command = this.#resolveLayerCommand({
      runtime: context.runtime,
      resources: context.resources,
      endpoint: context.endpoint,
      source: context.source,
      sourceIndex: context.sourceIndex,
      runtimeLayerId,
      targetWeight,
      fadeSeconds,
      playbackMetadata: context.playbackMetadata,
      output: context.output
    });
    if (!command) return;
    addDesiredCommand(context.desired, command, context.output.issues, this.config.maxIssues);
  }

  #addActionCommand(
    runtime: AnimationRuntime,
    resources: CharacterAnimationRuntimeApplyResources,
    desired: Map<string, LayerCommand>,
    action: CharacterAnimationResolvedAction,
    output: CharacterAnimationRuntimeApplyResult
  ): void {
    const identity = actionIdentityFor(action);
    if (!identity) {
      pushIssue(
        output.issues,
        {
          type: "invalid-record",
          field: "actions.command.commandId",
          code: "id",
          message: "character animation action command must carry a bounded command identity",
          source: "action",
          sourceIndex: action.sourceIndex,
          requestId: action.requestId,
          clipId: action.clipId
        },
        this.config.maxIssues
      );
      return;
    }
    if (this.#seenActionIdentities.has(identity)) {
      pushIssue(
        output.issues,
        {
          type: "duplicate-action",
          field: "actions.command.commandId",
          code: "duplicate-command",
          message: "character animation action command identity was already applied and was not retriggered",
          source: "action",
          sourceIndex: action.sourceIndex,
          requestId: action.requestId,
          clipId: action.clipId
        },
        this.config.maxIssues
      );
      return;
    }

    const runtimeLayerId = composeRuntimeLayerId(
      this.config.namespace,
      action.laneId,
      action.layerId,
      stableIdentitySuffix(identity)
    );
    const command = this.#resolveLayerCommand({
      runtime,
      resources,
      endpoint: action,
      source: "action",
      sourceIndex: action.sourceIndex,
      runtimeLayerId,
      targetWeight: clamp01Finite(action.weight),
      fadeSeconds: sanitizeFadeSeconds(action.fadeSeconds),
      playbackMetadata: {
        phase: action.phase,
        playbackSpeed: action.playbackSpeed,
        weight: action.weight,
        sourceIndex: action.sourceIndex
      },
      actionIdentity: identity,
      output
    });
    if (!command) return;
    addDesiredCommand(desired, command, output.issues, this.config.maxIssues);
  }

  #resolveLayerCommand(context: {
    runtime: AnimationRuntime;
    resources: CharacterAnimationRuntimeApplyResources;
    endpoint: CharacterAnimationResolvedClipBinding & { phase?: number };
    source: CharacterAnimationRuntimeApplySource;
    sourceIndex: number;
    runtimeLayerId: string;
    targetWeight: number;
    fadeSeconds: number;
    playbackMetadata?: PlaybackMetadata | undefined;
    actionIdentity?: string;
    output: CharacterAnimationRuntimeApplyResult;
  }): LayerCommand | null {
    if (
      !validateResolvedEndpoint(
        context.endpoint,
        context.source,
        context.sourceIndex,
        context.output.issues,
        this.config
      )
    ) {
      return null;
    }
    if (!isBoundedRuntimeLayerId(context.runtimeLayerId)) {
      pushIssue(
        context.output.issues,
        {
          type: "invalid-record",
          field: "runtimeLayerId",
          code: "id",
          message: "character animation runtime layer id exceeded the bounded applier limit",
          source: context.source,
          sourceIndex: context.sourceIndex,
          requestId: context.endpoint.requestId,
          clipId: context.endpoint.clipId,
          runtimeLayerId: context.runtimeLayerId
        },
        this.config.maxIssues
      );
      return null;
    }

    const lookupContext = createLookupContext(
      context.endpoint,
      context.source,
      context.sourceIndex,
      context.runtimeLayerId
    );
    let clip: AnimationClip | null | undefined;
    try {
      clip = resolveClip(context.resources.clips, context.endpoint.clipId, lookupContext);
    } catch {
      pushIssue(
        context.output.issues,
        {
          type: "invalid-resource",
          field: "clips",
          code: "resolver-threw",
          message: "character animation runtime applier clip resolver threw while resolving a requested clip id",
          source: context.source,
          sourceIndex: context.sourceIndex,
          requestId: context.endpoint.requestId,
          clipId: context.endpoint.clipId,
          runtimeLayerId: context.runtimeLayerId
        },
        this.config.maxIssues
      );
      return null;
    }
    if (!clip) {
      pushIssue(
        context.output.issues,
        {
          type: "missing-clip",
          field: "clips",
          code: "missing-clip",
          message: "character animation runtime applier could not resolve a requested clip id",
          source: context.source,
          sourceIndex: context.sourceIndex,
          requestId: context.endpoint.requestId,
          clipId: context.endpoint.clipId,
          runtimeLayerId: context.runtimeLayerId
        },
        this.config.maxIssues
      );
      return null;
    }
    if (!isAnimationClipLike(clip)) {
      pushIssue(
        context.output.issues,
        {
          type: "invalid-resource",
          field: "clips",
          code: "invalid-clip",
          message: "character animation runtime applier resolved clip is not a bounded AnimationClip",
          source: context.source,
          sourceIndex: context.sourceIndex,
          requestId: context.endpoint.requestId,
          clipId: context.endpoint.clipId,
          runtimeLayerId: context.runtimeLayerId
        },
        this.config.maxIssues
      );
      return null;
    }

    const mask = resolveOptionalMask(
      context.runtime,
      context.resources,
      lookupContext,
      context.output.issues,
      this.config
    );
    if (mask === null) return null;

    const phase = readCommandPhase(context.endpoint.phase, context.playbackMetadata?.phase);
    return {
      source: context.source,
      sourceIndex: context.sourceIndex,
      graphLayer: context.endpoint.graphLayer,
      requestId: context.endpoint.requestId,
      clipId: context.endpoint.clipId,
      laneId: context.endpoint.laneId,
      layerId: context.endpoint.layerId,
      runtimeLayerId: context.runtimeLayerId,
      clip,
      targetWeight: context.targetWeight,
      fadeSeconds: context.fadeSeconds,
      speed: sanitizePlaybackSpeed(context.playbackMetadata?.playbackSpeed ?? context.endpoint.playbackSpeed),
      priority: sanitizePriority(context.endpoint.priority),
      blendMode: context.endpoint.blendMode,
      loop: context.endpoint.loop,
      ...(mask !== undefined ? { mask } : {}),
      ...(context.endpoint.maskId !== undefined ? { maskId: context.endpoint.maskId } : {}),
      ...(phase !== undefined ? { phase, time: phaseToClipTime(phase, clip.duration) } : {}),
      ...(context.actionIdentity !== undefined ? { actionIdentity: context.actionIdentity } : {})
    };
  }

  #applyCommand(runtime: AnimationRuntime, command: LayerCommand, output: CharacterAnimationRuntimeApplyResult): void {
    const previous = this.#ownedLayers.get(command.runtimeLayerId) ?? this.#retiringLayers.get(command.runtimeLayerId);
    const resetTime = previous === undefined || command.source === "action" || previous.clipId !== command.clipId;
    const seedTime = resetTime && command.time !== undefined;
    const initialWeight = previous === undefined && command.fadeSeconds > 0 ? 0 : command.targetWeight;
    const options = {
      blendMode: command.blendMode,
      priority: command.priority,
      loop: command.loop,
      speed: command.speed,
      targetWeight: command.targetWeight,
      weight: initialWeight,
      fadeSpeed: fadeSecondsToFadeSpeed(command.fadeSeconds),
      resetTime,
      fadeOutExisting: false,
      clearMask: command.mask === undefined,
      ...(seedTime ? { time: command.time } : {}),
      ...(command.mask ? { mask: command.mask } : {})
    };
    runtime.crossfade(command.runtimeLayerId, command.clip, options);
    this.#retiringLayers.delete(command.runtimeLayerId);
    this.#ownedLayers.set(command.runtimeLayerId, {
      runtimeLayerId: command.runtimeLayerId,
      laneId: command.laneId,
      layerId: command.layerId,
      graphLayer: command.graphLayer,
      requestId: command.requestId,
      clipId: command.clipId,
      source: command.source,
      fadeSeconds: command.fadeSeconds,
      ...(command.actionIdentity !== undefined ? { actionIdentity: command.actionIdentity } : {})
    });
    if (command.actionIdentity !== undefined) {
      this.#rememberActionIdentity(command.actionIdentity);
      this.#activeActions.set(command.actionIdentity, {
        identity: command.actionIdentity,
        runtimeLayerId: command.runtimeLayerId,
        clipId: command.clipId,
        elapsedSeconds: 0,
        durationSeconds: sanitizeClipDuration(command.clip.duration),
        speed: command.speed,
        fadeSeconds: command.fadeSeconds
      });
    }
    output.applied.push({
      source: command.source,
      runtimeLayerId: command.runtimeLayerId,
      laneId: command.laneId,
      layerId: command.layerId,
      graphLayer: command.graphLayer,
      requestId: command.requestId,
      clipId: command.clipId,
      targetWeight: command.targetWeight,
      fadeSeconds: command.fadeSeconds,
      fadeSpeed: fadeSecondsToFadeSpeed(command.fadeSeconds),
      speed: command.speed,
      priority: command.priority,
      blendMode: command.blendMode,
      loop: command.loop,
      resetTime,
      sourceIndex: command.sourceIndex,
      ...(command.maskId !== undefined ? { maskId: command.maskId } : {}),
      ...(command.phase !== undefined ? { phase: command.phase } : {}),
      ...(seedTime ? { time: command.time } : {}),
      ...(command.actionIdentity !== undefined ? { actionIdentity: command.actionIdentity } : {})
    });
  }

  #advanceActionTimers(
    runtime: AnimationRuntime,
    deltaSeconds: number | undefined,
    output: CharacterAnimationRuntimeApplyResult
  ): void {
    if (deltaSeconds === undefined || this.#activeActions.size === 0) return;
    const completed: string[] = [];
    for (const action of this.#activeActions.values()) {
      const speed = sanitizePlaybackSpeed(action.speed);
      action.elapsedSeconds += deltaSeconds * speed;
      if (action.elapsedSeconds + EPSILON >= action.durationSeconds) completed.push(action.identity);
    }
    completed.sort(compareString);
    for (const identity of completed) {
      const action = this.#activeActions.get(identity);
      if (!action) continue;
      this.#retireOwnedLayer(runtime, action.runtimeLayerId, action.fadeSeconds, "action-complete", output);
      this.#activeActions.delete(identity);
    }
  }

  #retireOwnedLayer(
    runtime: AnimationRuntime,
    runtimeLayerId: string,
    fadeSeconds: number,
    reason: RetireReason,
    output: CharacterAnimationRuntimeApplyResult
  ): void {
    const state = this.#ownedLayers.get(runtimeLayerId) ?? this.#retiringLayers.get(runtimeLayerId);
    const safeFadeSeconds = sanitizeFadeSeconds(fadeSeconds);
    const fadeSpeed = fadeSecondsToFadeSpeed(safeFadeSeconds);
    if (safeFadeSeconds <= EPSILON) {
      runtime.removeLayer(runtimeLayerId);
      output.removed.push({ runtimeLayerId, fadeSeconds: safeFadeSeconds, fadeSpeed, reason });
      this.#retiringLayers.delete(runtimeLayerId);
    } else {
      runtime.fadeOut(runtimeLayerId, fadeSpeed);
      output.faded.push({ runtimeLayerId, fadeSeconds: safeFadeSeconds, fadeSpeed, reason });
      if (state) this.#retiringLayers.set(runtimeLayerId, state);
    }
    this.#ownedLayers.delete(runtimeLayerId);
    for (const [identity, action] of this.#activeActions) {
      if (action.runtimeLayerId === runtimeLayerId) this.#activeActions.delete(identity);
    }
  }

  #pruneRetiringLayers(runtime: AnimationRuntime): void {
    for (const runtimeLayerId of Array.from(this.#retiringLayers.keys())) {
      if (!runtime.hasLayer(runtimeLayerId)) this.#retiringLayers.delete(runtimeLayerId);
    }
  }

  #enforceOwnedLayerLimit(runtime: AnimationRuntime, output: CharacterAnimationRuntimeApplyResult): void {
    const trackedLayerCount = this.#ownedLayers.size + this.#retiringLayers.size;
    if (trackedLayerCount <= this.config.maxOwnedLayers) return;
    let overflow = trackedLayerCount - this.config.maxOwnedLayers;
    pushIssue(
      output.issues,
      {
        type: "bounded",
        field: "ownedLayers",
        code: "max-owned-layers",
        message: "character animation runtime applier removed oldest owned layers beyond maxOwnedLayers"
      },
      this.config.maxIssues
    );
    const retiringVictims = Array.from(this.#retiringLayers.keys()).slice(0, overflow).sort(compareString);
    for (const runtimeLayerId of retiringVictims) this.#retireOwnedLayer(runtime, runtimeLayerId, 0, "bounded", output);
    overflow -= retiringVictims.length;
    if (overflow <= 0) return;
    const ownedVictims = Array.from(this.#ownedLayers.keys()).slice(0, overflow).sort(compareString);
    for (const runtimeLayerId of ownedVictims) this.#retireOwnedLayer(runtime, runtimeLayerId, 0, "bounded", output);
  }

  #rememberActionIdentity(identity: string): void {
    if (this.#seenActionIdentities.has(identity)) return;
    this.#seenActionIdentities.add(identity);
    this.#seenActionIdentityOrder.push(identity);
    while (this.#seenActionIdentityOrder.length > this.config.maxActionIdentities) {
      const removed = this.#seenActionIdentityOrder.shift();
      if (removed !== undefined) this.#seenActionIdentities.delete(removed);
    }
  }
}

export function createCharacterAnimationRuntimeApplier(
  config: CharacterAnimationRuntimeApplierConfig = {}
): CharacterAnimationRuntimeApplier {
  return new CharacterAnimationRuntimeApplier(config);
}

export function createCharacterAnimationRuntimeApplyResultBuffer(): CharacterAnimationRuntimeApplyResult {
  return {
    schemaVersion: CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION,
    sequence: 0,
    applied: [],
    faded: [],
    removed: [],
    issues: []
  };
}

export function resolveCharacterAnimationRuntimeApplierConfig(
  config: CharacterAnimationRuntimeApplierConfig = {}
): CharacterAnimationRuntimeApplierResolvedConfig {
  if (!isRecord(config)) throw new Error("character animation runtime applier config must be an object");
  return Object.freeze({
    namespace: readConfigId(config.namespace, DEFAULT_NAMESPACE, MAX_NAMESPACE_LENGTH, "namespace"),
    maxRecordsPerApply: readConfigIntegerInRange(
      config.maxRecordsPerApply,
      DEFAULT_MAX_RECORDS_PER_APPLY,
      0,
      MAX_RECORDS_PER_APPLY,
      "maxRecordsPerApply"
    ),
    maxOwnedLayers: readConfigIntegerInRange(
      config.maxOwnedLayers,
      DEFAULT_MAX_OWNED_LAYERS,
      1,
      MAX_OWNED_LAYERS,
      "maxOwnedLayers"
    ),
    maxActionIdentities: readConfigIntegerInRange(
      config.maxActionIdentities,
      DEFAULT_MAX_ACTION_IDENTITIES,
      1,
      MAX_ACTION_IDENTITIES,
      "maxActionIdentities"
    ),
    maxIssues: readConfigIntegerInRange(config.maxIssues, DEFAULT_MAX_ISSUES, 1, MAX_ISSUES, "maxIssues"),
    staleFadeSeconds: readConfigFiniteInRange(
      config.staleFadeSeconds,
      DEFAULT_STALE_FADE_SECONDS,
      0,
      MAX_FADE_SECONDS,
      "staleFadeSeconds"
    )
  });
}

function readPlaybackRecords(
  rawValue: unknown,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): CharacterAnimationResolvedPlayback[] {
  return readBoundedRecordArray(rawValue, "playback", "playback", issues, config).flatMap((record, index) => {
    const playback = sanitizePlaybackRecord(record, index, issues, config.maxIssues);
    return playback ? [playback] : [];
  });
}

function readBlendRecords(
  rawValue: unknown,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): CharacterAnimationResolvedBlend[] {
  return readBoundedRecordArray(rawValue, "blends", "blend", issues, config).flatMap((record, index) => {
    const blend = sanitizeBlendRecord(record, index, issues, config.maxIssues);
    return blend ? [blend] : [];
  });
}

function readTransitionRecords(
  rawValue: unknown,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): CharacterAnimationResolvedTransition[] {
  return readBoundedRecordArray(rawValue, "transitions", "transition", issues, config).flatMap((record, index) => {
    const transition = sanitizeTransitionRecord(record, index, issues, config.maxIssues);
    return transition ? [transition] : [];
  });
}

function readActionRecords(
  rawValue: unknown,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): CharacterAnimationResolvedAction[] {
  return readBoundedRecordArray(rawValue, "actions", "action", issues, config).flatMap((record, index) => {
    const action = sanitizeActionRecord(record, index, issues, config.maxIssues);
    return action ? [action] : [];
  });
}

function readBoundedRecordArray(
  rawValue: unknown,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): readonly unknown[] {
  if (!Array.isArray(rawValue)) {
    pushIssue(
      issues,
      {
        type: "input-rejected",
        field,
        code: "array",
        message: `character animation runtime applier expected ${field} to be an array`,
        source
      },
      config.maxIssues
    );
    return [];
  }
  const limit = Math.min(rawValue.length, config.maxRecordsPerApply);
  if (rawValue.length > limit) {
    pushIssue(
      issues,
      {
        type: "bounded",
        field,
        code: "max-records",
        message: `character animation runtime applier ignored ${field} records beyond maxRecordsPerApply`,
        source
      },
      config.maxIssues
    );
  }
  return rawValue.slice(0, limit);
}

function sanitizePlaybackRecord(
  rawRecord: unknown,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedPlayback | null {
  if (!isRecord(rawRecord) || rawRecord.type !== "playback") {
    rejectRecord("playback", "type", "playback", sourceIndex, issues, maxIssues);
    return null;
  }
  const endpoint = sanitizeClipBinding(rawRecord, "playback", sourceIndex, issues, maxIssues);
  const weight = readFiniteRange(rawRecord.weight, 0, 1, "playback.weight", "playback", sourceIndex, issues, maxIssues);
  const phase = readFiniteRange(rawRecord.phase, 0, 1, "playback.phase", "playback", sourceIndex, issues, maxIssues);
  if (!endpoint || weight === null || phase === null) return null;
  return {
    ...endpoint,
    type: "playback",
    weight,
    phase,
    reason: String(rawRecord.reason) as CharacterAnimationResolvedPlayback["reason"],
    sourceIndex
  };
}

function sanitizeBlendRecord(
  rawRecord: unknown,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedBlend | null {
  if (!isRecord(rawRecord) || rawRecord.type !== "blend") {
    rejectRecord("blends", "type", "blend", sourceIndex, issues, maxIssues);
    return null;
  }
  const layer = readGraphLayer(rawRecord.layer, "blends.layer", "blend", sourceIndex, issues, maxIssues);
  const from = sanitizeNullableBlendEndpoint(rawRecord.from, "blends.from", sourceIndex, issues, maxIssues);
  const to = sanitizeNullableBlendEndpoint(rawRecord.to, "blends.to", sourceIndex, issues, maxIssues);
  const fromWeight = readFiniteRange(
    rawRecord.fromWeight,
    0,
    1,
    "blends.fromWeight",
    "blend",
    sourceIndex,
    issues,
    maxIssues
  );
  const toWeight = readFiniteRange(
    rawRecord.toWeight,
    0,
    1,
    "blends.toWeight",
    "blend",
    sourceIndex,
    issues,
    maxIssues
  );
  const priority = readFiniteRange(
    rawRecord.priority,
    0,
    MAX_PRIORITY,
    "blends.priority",
    "blend",
    sourceIndex,
    issues,
    maxIssues
  );
  const fadeSeconds = readFiniteRange(
    rawRecord.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    "blends.fadeSeconds",
    "blend",
    sourceIndex,
    issues,
    maxIssues
  );
  if (
    !layer ||
    from === undefined ||
    to === undefined ||
    fromWeight === null ||
    toWeight === null ||
    priority === null ||
    fadeSeconds === null
  ) {
    return null;
  }
  return {
    type: "blend",
    layer,
    from,
    to,
    fromWeight,
    toWeight,
    priority,
    fadeSeconds,
    reason: String(rawRecord.reason) as CharacterAnimationResolvedBlend["reason"],
    sourceIndex
  };
}

function sanitizeTransitionRecord(
  rawRecord: unknown,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedTransition | null {
  if (!isRecord(rawRecord) || rawRecord.type !== "transition") {
    rejectRecord("transitions", "type", "transition", sourceIndex, issues, maxIssues);
    return null;
  }
  const layer = readGraphLayer(rawRecord.layer, "transitions.layer", "transition", sourceIndex, issues, maxIssues);
  const from = sanitizeNullableClipBinding(
    rawRecord.from,
    "transitions.from",
    "transition",
    sourceIndex,
    issues,
    maxIssues
  );
  const to = sanitizeNullableClipBinding(rawRecord.to, "transitions.to", "transition", sourceIndex, issues, maxIssues);
  const priority = readFiniteRange(
    rawRecord.priority,
    0,
    MAX_PRIORITY,
    "transitions.priority",
    "transition",
    sourceIndex,
    issues,
    maxIssues
  );
  const fadeSeconds = readFiniteRange(
    rawRecord.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    "transitions.fadeSeconds",
    "transition",
    sourceIndex,
    issues,
    maxIssues
  );
  if (!layer || from === undefined || to === undefined || priority === null || fadeSeconds === null) return null;
  return {
    type: "transition",
    layer,
    from,
    to,
    priority,
    fadeSeconds,
    reason: String(rawRecord.reason) as CharacterAnimationResolvedTransition["reason"],
    sourceIndex
  };
}

function sanitizeActionRecord(
  rawRecord: unknown,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedAction | null {
  if (!isRecord(rawRecord) || rawRecord.type !== "action") {
    rejectRecord("actions", "type", "action", sourceIndex, issues, maxIssues);
    return null;
  }
  const endpoint = sanitizeClipBinding(rawRecord, "action", sourceIndex, issues, maxIssues);
  const weight = readFiniteRange(rawRecord.weight, 0, 1, "actions.weight", "action", sourceIndex, issues, maxIssues);
  const phase = readFiniteRange(rawRecord.phase, 0, 1, "actions.phase", "action", sourceIndex, issues, maxIssues);
  if (!endpoint || weight === null || phase === null || !isRecord(rawRecord.command)) {
    if (!isRecord(rawRecord.command)) rejectRecord("actions.command", "type", "action", sourceIndex, issues, maxIssues);
    return null;
  }
  const commandId = readBoundedId(rawRecord.command.commandId);
  const kind = readBoundedId(rawRecord.command.kind);
  if (!commandId) {
    rejectRecord("actions.command.commandId", "id", "action", sourceIndex, issues, maxIssues);
    return null;
  }
  if (!kind) {
    rejectRecord("actions.command.kind", "id", "action", sourceIndex, issues, maxIssues);
    return null;
  }
  if (!VALID_ACTION_KINDS.has(kind)) {
    rejectRecord("actions.command.kind", "enum", "action", sourceIndex, issues, maxIssues);
    return null;
  }
  return {
    ...endpoint,
    type: "action",
    weight,
    phase,
    command: {
      commandId,
      kind: kind as CharacterAnimationResolvedAction["command"]["kind"],
      ...optionalCommandId("itemId", rawRecord.command),
      ...optionalCommandId("socketId", rawRecord.command),
      ...optionalCommandId("interactionId", rawRecord.command),
      ...optionalCommandId("targetActorId", rawRecord.command)
    },
    sourceIndex
  };
}

function sanitizeNullableBlendEndpoint(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedBlendEndpoint | null | undefined {
  if (value === null) return null;
  const endpoint = sanitizeClipBinding(value, "blend", sourceIndex, issues, maxIssues);
  if (!endpoint) return undefined;
  const weight = isRecord(value)
    ? readFiniteRange(value.weight, 0, 1, `${field}.weight`, "blend", sourceIndex, issues, maxIssues)
    : null;
  if (weight === null) return undefined;
  return { ...endpoint, weight };
}

function sanitizeNullableClipBinding(
  value: unknown,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedClipBinding | null | undefined {
  if (value === null) return null;
  const endpoint = sanitizeClipBinding(value, source, sourceIndex, issues, maxIssues);
  if (!endpoint) {
    rejectRecord(field, "endpoint", source, sourceIndex, issues, maxIssues);
    return undefined;
  }
  return endpoint;
}

function sanitizeClipBinding(
  value: unknown,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationResolvedClipBinding | null {
  if (!isRecord(value)) {
    rejectRecord(source, "type", source, sourceIndex, issues, maxIssues);
    return null;
  }
  const requestId = readRecordId(value.requestId, `${source}.requestId`, source, sourceIndex, issues, maxIssues);
  const clipId = readRecordId(value.clipId, `${source}.clipId`, source, sourceIndex, issues, maxIssues);
  const graphLayer = readGraphLayer(value.graphLayer, `${source}.graphLayer`, source, sourceIndex, issues, maxIssues);
  const laneId = readRecordId(value.laneId, `${source}.laneId`, source, sourceIndex, issues, maxIssues);
  const layerId = readRecordId(value.layerId, `${source}.layerId`, source, sourceIndex, issues, maxIssues);
  const blendMode = readBlendMode(value.blendMode, source, sourceIndex, issues, maxIssues);
  const loop = readBoolean(value.loop, `${source}.loop`, source, sourceIndex, issues, maxIssues);
  const priority = readFiniteRange(
    value.priority,
    0,
    MAX_PRIORITY,
    `${source}.priority`,
    source,
    sourceIndex,
    issues,
    maxIssues
  );
  const fadeSeconds = readFiniteRange(
    value.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    `${source}.fadeSeconds`,
    source,
    sourceIndex,
    issues,
    maxIssues
  );
  const playbackSpeed = readFiniteRange(
    value.playbackSpeed,
    0,
    MAX_PLAYBACK_SPEED,
    `${source}.playbackSpeed`,
    source,
    sourceIndex,
    issues,
    maxIssues
  );
  const maskId =
    value.maskId === undefined
      ? undefined
      : readRecordId(value.maskId, `${source}.maskId`, source, sourceIndex, issues, maxIssues);
  if (
    !requestId ||
    !clipId ||
    !graphLayer ||
    !laneId ||
    !layerId ||
    !blendMode ||
    loop === null ||
    priority === null ||
    fadeSeconds === null ||
    playbackSpeed === null ||
    maskId === null
  ) {
    return null;
  }
  return {
    requestId,
    clipId,
    graphLayer,
    laneId,
    layerId,
    blendMode,
    loop,
    priority,
    fadeSeconds,
    playbackSpeed,
    ...(maskId !== undefined ? { maskId } : {})
  };
}

function validateResolvedEndpoint(
  endpoint: CharacterAnimationResolvedClipBinding,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): boolean {
  let valid = true;
  if (!readBoundedId(endpoint.requestId)) valid = false;
  if (!readBoundedId(endpoint.clipId)) valid = false;
  if (!VALID_GRAPH_LAYERS.has(endpoint.graphLayer)) valid = false;
  if (!readBoundedId(endpoint.laneId)) valid = false;
  if (!readBoundedId(endpoint.layerId)) valid = false;
  if (!VALID_BLEND_MODES.has(endpoint.blendMode)) valid = false;
  if (typeof endpoint.loop !== "boolean") valid = false;
  if (!isFiniteInRange(endpoint.priority, 0, MAX_PRIORITY)) valid = false;
  if (!isFiniteInRange(endpoint.fadeSeconds, 0, MAX_FADE_SECONDS)) valid = false;
  if (!isFiniteInRange(endpoint.playbackSpeed, 0, MAX_PLAYBACK_SPEED)) valid = false;
  if (endpoint.maskId !== undefined && !readBoundedId(endpoint.maskId)) valid = false;
  if (!valid) {
    pushIssue(
      issues,
      {
        type: "invalid-record",
        field: source,
        code: "endpoint",
        message: "character animation runtime applier rejected an invalid resolved binding endpoint",
        source,
        sourceIndex,
        ...(typeof endpoint.requestId === "string" ? { requestId: endpoint.requestId } : {}),
        ...(typeof endpoint.clipId === "string" ? { clipId: endpoint.clipId } : {})
      },
      config.maxIssues
    );
  }
  return valid;
}

function addDesiredCommand(
  desired: Map<string, LayerCommand>,
  command: LayerCommand,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): void {
  const existing = desired.get(command.runtimeLayerId);
  if (!existing) {
    desired.set(command.runtimeLayerId, command);
    return;
  }
  if (canMergeLayerCommands(existing, command)) {
    if (command.targetWeight > existing.targetWeight) existing.targetWeight = command.targetWeight;
    if (command.fadeSeconds < existing.fadeSeconds) existing.fadeSeconds = command.fadeSeconds;
    return;
  }
  pushIssue(
    issues,
    {
      type: "layer-conflict",
      field: "runtimeLayerId",
      code: "conflict",
      message: "character animation runtime applier received conflicting records for one owned runtime layer",
      source: command.source,
      sourceIndex: command.sourceIndex,
      requestId: command.requestId,
      clipId: command.clipId,
      runtimeLayerId: command.runtimeLayerId
    },
    maxIssues
  );
  if (compareLayerCommandPrecedence(command, existing) < 0) desired.set(command.runtimeLayerId, command);
}

function canMergeLayerCommands(a: LayerCommand, b: LayerCommand): boolean {
  return (
    a.requestId === b.requestId &&
    a.clipId === b.clipId &&
    a.blendMode === b.blendMode &&
    a.priority === b.priority &&
    a.loop === b.loop &&
    a.maskId === b.maskId &&
    a.actionIdentity === b.actionIdentity
  );
}

function rememberTransitionFade(
  transition: CharacterAnimationResolvedTransition,
  fadeSecondsByLayer: Map<string, number>,
  namespace: string
): void {
  if (!transition.from) return;
  const fromId = composeRuntimeLayerId(namespace, transition.from.laneId, transition.from.layerId);
  const toId = transition.to ? composeRuntimeLayerId(namespace, transition.to.laneId, transition.to.layerId) : null;
  if (fromId === toId) return;
  const current = fadeSecondsByLayer.get(fromId);
  if (current === undefined || transition.fadeSeconds < current) fadeSecondsByLayer.set(fromId, transition.fadeSeconds);
}

function resolveClip(
  lookup: CharacterAnimationRuntimeClipLookup | undefined,
  clipId: string,
  context: CharacterAnimationRuntimeLookupContext
): AnimationClip | null | undefined {
  if (!lookup) return undefined;
  if (typeof lookup === "function") return lookup(clipId, context);
  if (isReadonlyMap<AnimationClip>(lookup)) return lookup.get(clipId);
  return lookup[clipId];
}

function resolveOptionalMask(
  runtime: AnimationRuntime,
  resources: CharacterAnimationRuntimeApplyResources,
  context: CharacterAnimationRuntimeLookupContext,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): JointMask | undefined | null {
  if (context.maskId === undefined) return undefined;
  if (!resources.masks) {
    pushMissingMaskIssue(context, issues, config.maxIssues);
    return null;
  }
  let mask: JointMask | null | undefined;
  try {
    mask = resolveMask(resources.masks, context.maskId, context);
  } catch {
    pushIssue(
      issues,
      {
        type: "invalid-resource",
        field: "masks",
        code: "resolver-threw",
        message: "character animation runtime applier mask resolver threw while resolving a requested mask id",
        source: context.source,
        sourceIndex: context.sourceIndex,
        requestId: context.requestId,
        clipId: context.clipId,
        maskId: context.maskId,
        runtimeLayerId: context.runtimeLayerId
      },
      config.maxIssues
    );
    return null;
  }
  if (!mask) {
    pushMissingMaskIssue(context, issues, config.maxIssues);
    return null;
  }
  if (!(mask instanceof Float32Array)) {
    pushIssue(
      issues,
      {
        type: "invalid-resource",
        field: "masks",
        code: "invalid-mask",
        message: "character animation runtime applier resolved mask is not a JointMask Float32Array",
        source: context.source,
        sourceIndex: context.sourceIndex,
        requestId: context.requestId,
        clipId: context.clipId,
        maskId: context.maskId,
        runtimeLayerId: context.runtimeLayerId
      },
      config.maxIssues
    );
    return null;
  }
  const maskIssues = validateJointMask(runtime.skeleton, mask);
  if (maskIssues.length > 0) {
    pushIssue(
      issues,
      {
        type: "invalid-resource",
        field: "masks",
        code: "mask-validation",
        message:
          "character animation runtime applier resolved mask has validation diagnostics and will use runtime mask semantics",
        source: context.source,
        sourceIndex: context.sourceIndex,
        requestId: context.requestId,
        clipId: context.clipId,
        maskId: context.maskId,
        runtimeLayerId: context.runtimeLayerId
      },
      config.maxIssues
    );
  }
  return mask;
}

function resolveMask(
  lookup: CharacterAnimationRuntimeMaskLookup,
  maskId: string,
  context: CharacterAnimationRuntimeLookupContext
): JointMask | null | undefined {
  if (typeof lookup === "function") return lookup(maskId, context);
  if (isReadonlyMap<JointMask>(lookup)) return lookup.get(maskId);
  return lookup[maskId];
}

function pushMissingMaskIssue(
  context: CharacterAnimationRuntimeLookupContext,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): void {
  pushIssue(
    issues,
    {
      type: "missing-mask",
      field: "masks",
      code: "missing-mask",
      message: "character animation runtime applier could not resolve a requested mask id",
      source: context.source,
      sourceIndex: context.sourceIndex,
      requestId: context.requestId,
      clipId: context.clipId,
      ...(context.maskId !== undefined ? { maskId: context.maskId } : {}),
      runtimeLayerId: context.runtimeLayerId
    },
    maxIssues
  );
}

function createLookupContext(
  endpoint: CharacterAnimationResolvedClipBinding,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  runtimeLayerId: string
): CharacterAnimationRuntimeLookupContext {
  return {
    source,
    sourceIndex,
    requestId: endpoint.requestId,
    clipId: endpoint.clipId,
    graphLayer: endpoint.graphLayer,
    laneId: endpoint.laneId,
    layerId: endpoint.layerId,
    runtimeLayerId,
    ...(endpoint.maskId !== undefined ? { maskId: endpoint.maskId } : {})
  };
}

function composeRuntimeLayerId(namespace: string, laneId: string, layerId: string, suffix?: string): string {
  return suffix === undefined ? `${namespace}:${laneId}:${layerId}` : `${namespace}:${laneId}:${layerId}:${suffix}`;
}

function actionIdentityFor(action: CharacterAnimationResolvedAction): string | null {
  const commandId = readBoundedId(action.command.commandId);
  if (!commandId) return null;
  return commandId;
}

function stableIdentitySuffix(identity: string): string {
  return `action:${hashString(identity).toString(36)}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fadeSecondsToFadeSpeed(fadeSeconds: number): number {
  const fade = sanitizeFadeSeconds(fadeSeconds);
  return fade <= EPSILON ? IMMEDIATE_FADE_SPEED : 1 / fade;
}

function phaseToClipTime(phase: number, duration: number): number {
  const safeDuration = sanitizeClipDuration(duration);
  if (safeDuration <= EPSILON) return 0;
  return clamp01Finite(phase) * safeDuration;
}

function readCommandPhase(endpointPhase: number | undefined, metadataPhase: number | undefined): number | undefined {
  if (endpointPhase !== undefined && Number.isFinite(endpointPhase)) return clamp01(endpointPhase);
  if (metadataPhase !== undefined && Number.isFinite(metadataPhase)) return clamp01(metadataPhase);
  return undefined;
}

function sanitizeClipDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizePlaybackSpeed(value: number): number {
  return isFiniteInRange(value, 0, MAX_PLAYBACK_SPEED) ? value : 1;
}

function sanitizePriority(value: number): number {
  return isFiniteInRange(value, 0, MAX_PRIORITY) ? value : 0;
}

function sanitizeFadeSeconds(value: number): number {
  return isFiniteInRange(value, 0, MAX_FADE_SECONDS) ? value : DEFAULT_STALE_FADE_SECONDS;
}

function clamp01Finite(value: number): number {
  return clamp01(Number.isFinite(value) ? value : 0);
}

function isAnimationClipLike(clip: AnimationClip): boolean {
  return (
    isRecord(clip) &&
    typeof clip.id === "string" &&
    isFiniteInRange(clip.duration, 0, Number.MAX_VALUE) &&
    Array.isArray(clip.tracks)
  );
}

function readOptionalDeltaSeconds(
  value: unknown,
  issues: CharacterAnimationRuntimeApplierIssue[],
  config: CharacterAnimationRuntimeApplierResolvedConfig
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_FADE_SECONDS) return value;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field: "deltaSeconds",
      code: "finite-range",
      message: "character animation runtime applier deltaSeconds must be finite and bounded when present"
    },
    config.maxIssues
  );
  return undefined;
}

function readConfigId(value: unknown, fallback: string, maxLength: number, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value === "string" && value.length > 0 && value.length <= maxLength) return value;
  throw new Error(`character animation runtime applier ${label} must be a non-empty bounded string`);
}

function readConfigIntegerInRange(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && (value as number) >= min && (value as number) <= max) return value as number;
  throw new Error(`character animation runtime applier ${label} must be an integer in [${min}, ${max}]`);
}

function readConfigFiniteInRange(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return value;
  throw new Error(`character animation runtime applier ${label} must be finite in [${min}, ${max}]`);
}

function readRecordId(
  value: unknown,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): string | null {
  const id = readBoundedId(value);
  if (id) return id;
  rejectRecord(field, "id", source, sourceIndex, issues, maxIssues);
  return null;
}

function readGraphLayer(
  value: unknown,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): CharacterAnimationGraphLayerId | null {
  if (VALID_GRAPH_LAYERS.has(value as CharacterAnimationGraphLayerId)) return value as CharacterAnimationGraphLayerId;
  rejectRecord(field, "layer", source, sourceIndex, issues, maxIssues);
  return null;
}

function readBlendMode(
  value: unknown,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): LayerBlendMode | null {
  if (VALID_BLEND_MODES.has(value as LayerBlendMode)) return value as LayerBlendMode;
  rejectRecord(`${source}.blendMode`, "blend-mode", source, sourceIndex, issues, maxIssues);
  return null;
}

function readBoolean(
  value: unknown,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): boolean | null {
  if (typeof value === "boolean") return value;
  rejectRecord(field, "boolean", source, sourceIndex, issues, maxIssues);
  return null;
}

function readFiniteRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return value;
  rejectRecord(field, "finite-range", source, sourceIndex, issues, maxIssues);
  return null;
}

function optionalCommandId(
  key: "itemId" | "socketId" | "interactionId" | "targetActorId",
  command: Record<string, unknown>
): Record<string, string> {
  const value = command[key];
  const id = value === undefined ? undefined : readBoundedId(value);
  return id === undefined || id === null ? {} : { [key]: id };
}

function rejectRecord(
  field: string,
  code: string,
  source: CharacterAnimationRuntimeApplySource,
  sourceIndex: number,
  issues: CharacterAnimationRuntimeApplierIssue[],
  maxIssues: number
): void {
  pushIssue(
    issues,
    {
      type: "invalid-record",
      field,
      code,
      message: "character animation runtime applier rejected an invalid resolved binding record",
      source,
      sourceIndex
    },
    maxIssues
  );
}

function validateRuntimeApplierSnapshot(
  snapshot: CharacterAnimationRuntimeApplierSnapshot,
  config: CharacterAnimationRuntimeApplierResolvedConfig
): CharacterAnimationRuntimeApplierSnapshot {
  if (!isRecord(snapshot)) throw new Error("character animation runtime applier snapshot must be an object");
  if (snapshot.schemaVersion !== CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION)
    throw new Error("character animation runtime applier snapshot schemaVersion is unsupported");
  if (snapshot.namespace !== config.namespace)
    throw new Error("character animation runtime applier snapshot namespace does not match this applier");
  if (!Number.isSafeInteger(snapshot.applyCount) || snapshot.applyCount < 0)
    throw new Error("character animation runtime applier snapshot applyCount must be a non-negative safe integer");
  const ownedLayers: readonly unknown[] = Array.isArray(snapshot.ownedLayers) ? snapshot.ownedLayers : [];
  const retiringLayers: readonly unknown[] = Array.isArray(snapshot.retiringLayers) ? snapshot.retiringLayers : [];
  const activeActions: readonly unknown[] = Array.isArray(snapshot.activeActions) ? snapshot.activeActions : [];
  const seenActionIdentities: readonly unknown[] = Array.isArray(snapshot.seenActionIdentities)
    ? snapshot.seenActionIdentities
    : [];
  if (!Array.isArray(snapshot.ownedLayers) || ownedLayers.length > config.maxOwnedLayers)
    throw new Error("character animation runtime applier snapshot ownedLayers are invalid or exceed maxOwnedLayers");
  if (
    (snapshot.retiringLayers !== undefined && !Array.isArray(snapshot.retiringLayers)) ||
    retiringLayers.length > config.maxOwnedLayers ||
    ownedLayers.length + retiringLayers.length > config.maxOwnedLayers
  )
    throw new Error("character animation runtime applier snapshot retiringLayers are invalid or exceed maxOwnedLayers");
  if (!Array.isArray(snapshot.activeActions) || activeActions.length > config.maxOwnedLayers)
    throw new Error("character animation runtime applier snapshot activeActions are invalid or exceed maxOwnedLayers");
  if (!Array.isArray(snapshot.seenActionIdentities) || seenActionIdentities.length > config.maxActionIdentities)
    throw new Error(
      "character animation runtime applier snapshot seenActionIdentities are invalid or exceed maxActionIdentities"
    );
  for (const layer of ownedLayers) validateLayerSnapshot(layer);
  for (const layer of retiringLayers) validateLayerSnapshot(layer);
  for (const action of activeActions) validateActionSnapshot(action);
  for (const identity of seenActionIdentities) {
    if (!readBoundedId(identity))
      throw new Error("character animation runtime applier snapshot action identity is invalid");
  }
  return snapshot;
}

function validateLayerSnapshot(layer: unknown): void {
  if (!isRecord(layer)) throw new Error("character animation runtime applier snapshot owned layer must be an object");
  if (!isBoundedRuntimeLayerId(layer.runtimeLayerId))
    throw new Error("character animation runtime applier snapshot runtimeLayerId is invalid");
  if (
    !readBoundedId(layer.laneId) ||
    !readBoundedId(layer.layerId) ||
    !readBoundedId(layer.requestId) ||
    !readBoundedId(layer.clipId)
  )
    throw new Error("character animation runtime applier snapshot owned layer ids are invalid");
  if (!VALID_GRAPH_LAYERS.has(layer.graphLayer as CharacterAnimationGraphLayerId))
    throw new Error("character animation runtime applier snapshot graphLayer is invalid");
  if (typeof layer.source !== "string" || !(layer.source in SOURCE_ORDER))
    throw new Error("character animation runtime applier snapshot source is invalid");
  if (!isFiniteInRange(layer.fadeSeconds, 0, MAX_FADE_SECONDS))
    throw new Error("character animation runtime applier snapshot fadeSeconds is invalid");
  if (layer.actionIdentity !== undefined && !readBoundedId(layer.actionIdentity))
    throw new Error("character animation runtime applier snapshot actionIdentity is invalid");
}

function validateActionSnapshot(action: unknown): void {
  if (!isRecord(action))
    throw new Error("character animation runtime applier snapshot active action must be an object");
  if (
    !readBoundedId(action.identity) ||
    !isBoundedRuntimeLayerId(action.runtimeLayerId) ||
    !readBoundedId(action.clipId)
  )
    throw new Error("character animation runtime applier snapshot active action ids are invalid");
  if (!isFiniteInRange(action.elapsedSeconds, 0, Number.MAX_VALUE))
    throw new Error("character animation runtime applier snapshot elapsedSeconds is invalid");
  if (!isFiniteInRange(action.durationSeconds, 0, Number.MAX_VALUE))
    throw new Error("character animation runtime applier snapshot durationSeconds is invalid");
  if (!isFiniteInRange(action.speed, 0, MAX_PLAYBACK_SPEED))
    throw new Error("character animation runtime applier snapshot speed is invalid");
  if (!isFiniteInRange(action.fadeSeconds, 0, MAX_FADE_SECONDS))
    throw new Error("character animation runtime applier snapshot fadeSeconds is invalid");
}

function freezeOptionalActionIdentity(
  layer: CharacterAnimationRuntimeApplierLayerSnapshot
): CharacterAnimationRuntimeApplierLayerSnapshot {
  return Object.freeze(layer);
}

function readSafeSequence(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function readBoundedId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function isBoundedRuntimeLayerId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_RUNTIME_LAYER_ID_LENGTH;
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function resetApplyResult(output: CharacterAnimationRuntimeApplyResult): void {
  output.schemaVersion = CHARACTER_ANIMATION_RUNTIME_APPLIER_SCHEMA_VERSION;
  output.sequence = 0;
  output.applied.length = 0;
  output.faded.length = 0;
  output.removed.length = 0;
  output.issues.length = 0;
}

function pushIssue(
  issues: CharacterAnimationRuntimeApplierIssue[],
  issue: CharacterAnimationRuntimeApplierIssue,
  maxIssues: number
): void {
  if (maxIssues <= 0) return;
  if (issues.length < maxIssues) {
    issues.push(issue);
    return;
  }
  issues[maxIssues - 1] = {
    type: "bounded",
    field: "issues",
    code: "max-issues",
    message: "character animation runtime applier issue reporting reached maxIssues"
  };
}

function compareLayerCommandOrder(a: LayerCommand, b: LayerCommand): number {
  const sourceDelta = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
  if (sourceDelta !== 0) return sourceDelta;
  const indexDelta = a.sourceIndex - b.sourceIndex;
  if (indexDelta !== 0) return indexDelta;
  return compareString(a.runtimeLayerId, b.runtimeLayerId);
}

function compareLayerCommandPrecedence(a: LayerCommand, b: LayerCommand): number {
  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return compareLayerCommandOrder(a, b);
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReadonlyMap<T>(value: unknown): value is ReadonlyMap<string, T> {
  return isRecord(value) && typeof (value as { get?: unknown }).get === "function";
}
