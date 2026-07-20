import type {
  CharacterAnimationActionRequest,
  CharacterAnimationBlendRequest,
  CharacterAnimationGraphLayerId,
  CharacterAnimationGraphOutput,
  CharacterAnimationGraphPlaybackReason,
  CharacterAnimationPlaybackRequest,
  CharacterAnimationTransitionRequest
} from "./character-animation-graph.js";
import type { CharacterActionIntent } from "./character-controller.js";
import type { LayerBlendMode } from "./runtime.js";

export const CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION = 1;

export type CharacterAnimationClipAssetId = string;
export type CharacterAnimationRuntimeLaneId = string;
export type CharacterAnimationRuntimeLayerId = string;
export type CharacterAnimationMaskPolicyId = string;

export type CharacterAnimationBindingIssueType =
  | "invalid-config"
  | "duplicate"
  | "missing-binding"
  | "incompatible"
  | "input-rejected"
  | "bounded";

export type CharacterAnimationBindingIssue = {
  type: CharacterAnimationBindingIssueType;
  field: string;
  code: string;
  message: string;
  requestId?: string;
  clipId?: string;
  sourceIndex?: number;
};

export type CharacterAnimationClipAssetConfig = {
  /** Opaque consumer-owned clip/asset id. This package never interprets the value as a file name or app asset. */
  id: CharacterAnimationClipAssetId;
  /** Optional clip metadata used when a graph request does not carry an explicit loop decision. */
  loop?: boolean;
};

export type CharacterAnimationClipAsset = Readonly<CharacterAnimationClipAssetConfig>;

export type CharacterAnimationBindingRuntimePolicyConfig = {
  /** Consumer-owned runtime lane, e.g. base/overlay/debug. Defaults to the semantic graph layer. */
  laneId?: CharacterAnimationRuntimeLaneId;
  /** Consumer-owned runtime layer id. Defaults to the semantic request id. */
  layerId?: CharacterAnimationRuntimeLayerId;
  /** Opaque mask/policy id. Consumers map this to JointMask, track policy, or renderer-specific mask data. */
  maskId?: CharacterAnimationMaskPolicyId;
  blendMode?: LayerBlendMode;
  priority?: number;
  fadeSeconds?: number;
  loop?: boolean;
  playbackSpeedScale?: number;
  minPlaybackSpeed?: number;
  maxPlaybackSpeed?: number;
  weightScale?: number;
};

export type CharacterAnimationBindingRuntimePolicy = Readonly<{
  laneId: CharacterAnimationRuntimeLaneId;
  layerId: CharacterAnimationRuntimeLayerId;
  blendMode: LayerBlendMode;
  playbackSpeedScale: number;
  minPlaybackSpeed: number;
  maxPlaybackSpeed: number;
  weightScale: number;
  maskId?: CharacterAnimationMaskPolicyId;
  priority?: number;
  fadeSeconds?: number;
  loop?: boolean;
}>;

export type CharacterAnimationSemanticBindingConfig = {
  requestId: string;
  clipId: CharacterAnimationClipAssetId;
  /** Expected semantic graph layer for this request id. Layer mismatches are reported at resolution time. */
  layer: CharacterAnimationGraphLayerId;
  runtime?: CharacterAnimationBindingRuntimePolicyConfig;
};

export type CharacterAnimationSemanticBinding = Readonly<{
  requestId: string;
  clipId: CharacterAnimationClipAssetId;
  layer: CharacterAnimationGraphLayerId;
  runtime: CharacterAnimationBindingRuntimePolicy;
}>;

export type CharacterAnimationBindingRegistryConfig = {
  clips: readonly CharacterAnimationClipAssetConfig[];
  bindings: readonly CharacterAnimationSemanticBindingConfig[];
  /** Maximum graph records inspected per output array during one resolve call. */
  maxRequestsPerResolve?: number;
  /** Maximum issues kept in registry construction and each resolve output. */
  maxIssues?: number;
};

export type CharacterAnimationBindingRegistrySnapshot = Readonly<{
  schemaVersion: typeof CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION;
  clips: readonly CharacterAnimationClipAsset[];
  bindings: readonly CharacterAnimationSemanticBinding[];
  issues: readonly CharacterAnimationBindingIssue[];
  maxRequestsPerResolve: number;
  maxIssues: number;
}>;

export type CharacterAnimationResolvedClipBinding = Readonly<{
  requestId: string;
  clipId: CharacterAnimationClipAssetId;
  graphLayer: CharacterAnimationGraphLayerId;
  laneId: CharacterAnimationRuntimeLaneId;
  layerId: CharacterAnimationRuntimeLayerId;
  blendMode: LayerBlendMode;
  loop: boolean;
  priority: number;
  fadeSeconds: number;
  playbackSpeed: number;
  maskId?: CharacterAnimationMaskPolicyId;
}>;

export type CharacterAnimationResolvedPlayback = CharacterAnimationResolvedClipBinding &
  Readonly<{
    type: "playback";
    weight: number;
    phase: number;
    reason: CharacterAnimationGraphPlaybackReason;
    sourceIndex: number;
  }>;

export type CharacterAnimationResolvedBlendEndpoint = CharacterAnimationResolvedClipBinding &
  Readonly<{
    weight: number;
  }>;

export type CharacterAnimationResolvedBlend = Readonly<{
  type: "blend";
  layer: CharacterAnimationGraphLayerId;
  from: CharacterAnimationResolvedBlendEndpoint | null;
  to: CharacterAnimationResolvedBlendEndpoint | null;
  fromWeight: number;
  toWeight: number;
  priority: number;
  fadeSeconds: number;
  reason: CharacterAnimationBlendRequest["reason"];
  sourceIndex: number;
}>;

export type CharacterAnimationResolvedTransition = Readonly<{
  type: "transition";
  layer: CharacterAnimationGraphLayerId;
  from: CharacterAnimationResolvedClipBinding | null;
  to: CharacterAnimationResolvedClipBinding | null;
  priority: number;
  fadeSeconds: number;
  reason: CharacterAnimationTransitionRequest["reason"];
  sourceIndex: number;
  controllerTick?: number;
}>;

export type CharacterAnimationResolvedAction = CharacterAnimationResolvedClipBinding &
  Readonly<{
    type: "action";
    weight: number;
    phase: number;
    command: CharacterActionIntent;
    sourceIndex: number;
    controllerTick?: number;
  }>;

export type CharacterAnimationBindingOutput = {
  schemaVersion: typeof CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION;
  sequence: number;
  playback: CharacterAnimationResolvedPlayback[];
  blends: CharacterAnimationResolvedBlend[];
  transitions: CharacterAnimationResolvedTransition[];
  actions: CharacterAnimationResolvedAction[];
  issues: CharacterAnimationBindingIssue[];
};

export type CharacterAnimationBindingResolveOptions = {
  /** Optional reusable output buffer. Arrays are cleared and reused. */
  output?: CharacterAnimationBindingOutput;
};

const MAX_ID_LENGTH = 160;
const MAX_CLIP_ASSETS = 1024;
const MAX_BINDINGS = 1024;
const DEFAULT_MAX_REQUESTS_PER_RESOLVE = 512;
const MAX_REQUESTS_PER_RESOLVE = 4096;
const DEFAULT_MAX_ISSUES = 128;
const MAX_ISSUES = 512;
const MAX_PRIORITY = 1_000_000;
const MAX_FADE_SECONDS = 10;
const MAX_PLAYBACK_SPEED = 16;
const MAX_WEIGHT_SCALE = 16;
const VALID_GRAPH_LAYERS = new Set<CharacterAnimationGraphLayerId>(["locomotion", "posture", "airborne", "action"]);
const VALID_BLEND_MODES = new Set<LayerBlendMode>(["override", "additive"]);
const VALID_PLAYBACK_REASONS = new Set<CharacterAnimationGraphPlaybackReason>(["idle", "gait", "posture", "airborne"]);
const VALID_BLEND_REASONS = new Set<CharacterAnimationBlendRequest["reason"]>(["idle", "gait", "posture", "airborne"]);
const VALID_TRANSITION_REASONS = new Set<CharacterAnimationTransitionRequest["reason"]>([
  "locomotion-hysteresis",
  "gait-change",
  "posture-phase",
  "airborne-phase"
]);

export class CharacterAnimationBindingRegistry {
  readonly schemaVersion = CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION;
  readonly clips: readonly CharacterAnimationClipAsset[];
  readonly bindings: readonly CharacterAnimationSemanticBinding[];
  readonly issues: readonly CharacterAnimationBindingIssue[];
  readonly maxRequestsPerResolve: number;
  readonly maxIssues: number;
  #clipById = new Map<string, CharacterAnimationClipAsset>();
  #bindingByRequestId = new Map<string, CharacterAnimationSemanticBinding>();

  constructor(config: CharacterAnimationBindingRegistryConfig) {
    const issues: CharacterAnimationBindingIssue[] = [];
    const maxIssues = readConfigIntegerInRange(config?.maxIssues, DEFAULT_MAX_ISSUES, 1, MAX_ISSUES, "maxIssues");
    this.maxRequestsPerResolve = readConfigIntegerInRange(
      config?.maxRequestsPerResolve,
      DEFAULT_MAX_REQUESTS_PER_RESOLVE,
      0,
      MAX_REQUESTS_PER_RESOLVE,
      "maxRequestsPerResolve"
    );
    this.maxIssues = maxIssues;

    const clips = normalizeClipAssets(config, issues, maxIssues);
    const clipIds = new Set<string>();
    const uniqueClips: CharacterAnimationClipAsset[] = [];
    for (const clip of clips) {
      if (clipIds.has(clip.id)) {
        pushIssue(
          issues,
          {
            type: "duplicate",
            field: "clips.id",
            code: "duplicate-clip-id",
            message: "duplicate character animation clip asset id was ignored",
            clipId: clip.id
          },
          maxIssues
        );
        continue;
      }
      clipIds.add(clip.id);
      uniqueClips.push(clip);
      this.#clipById.set(clip.id, clip);
    }

    const bindings = normalizeSemanticBindings(config, this.#clipById, issues, maxIssues);
    const bindingIds = new Set<string>();
    const uniqueBindings: CharacterAnimationSemanticBinding[] = [];
    for (const binding of bindings) {
      if (bindingIds.has(binding.requestId)) {
        pushIssue(
          issues,
          {
            type: "duplicate",
            field: "bindings.requestId",
            code: "duplicate-binding",
            message: "duplicate character animation semantic binding was ignored",
            requestId: binding.requestId,
            clipId: binding.clipId
          },
          maxIssues
        );
        continue;
      }
      bindingIds.add(binding.requestId);
      uniqueBindings.push(binding);
      this.#bindingByRequestId.set(binding.requestId, binding);
    }

    this.clips = Object.freeze(uniqueClips);
    this.bindings = Object.freeze(uniqueBindings);
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }

  resolve(
    graphOutput: CharacterAnimationGraphOutput,
    options: CharacterAnimationBindingResolveOptions = {}
  ): CharacterAnimationBindingOutput {
    return resolveCharacterAnimationBindings(this, graphOutput, options);
  }

  bindingForRequest(requestId: string): CharacterAnimationSemanticBinding | undefined {
    return this.#bindingByRequestId.get(requestId);
  }

  clipForId(clipId: string): CharacterAnimationClipAsset | undefined {
    return this.#clipById.get(clipId);
  }

  snapshot(): CharacterAnimationBindingRegistrySnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      clips: this.clips,
      bindings: this.bindings,
      issues: this.issues,
      maxRequestsPerResolve: this.maxRequestsPerResolve,
      maxIssues: this.maxIssues
    });
  }
}

export function createCharacterAnimationBindingRegistry(
  config: CharacterAnimationBindingRegistryConfig
): CharacterAnimationBindingRegistry {
  return new CharacterAnimationBindingRegistry(config);
}

export function createCharacterAnimationBindingOutputBuffer(): CharacterAnimationBindingOutput {
  return {
    schemaVersion: CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION,
    sequence: 0,
    playback: [],
    blends: [],
    transitions: [],
    actions: [],
    issues: []
  };
}

export function resolveCharacterAnimationBindings(
  registry: CharacterAnimationBindingRegistry,
  graphOutput: CharacterAnimationGraphOutput,
  options: CharacterAnimationBindingResolveOptions = {}
): CharacterAnimationBindingOutput {
  const output = options.output ?? createCharacterAnimationBindingOutputBuffer();
  resetBindingOutput(output);
  output.sequence = readSafeSequence(isRecord(graphOutput) ? graphOutput.sequence : undefined);
  if (!(registry instanceof CharacterAnimationBindingRegistry)) {
    pushIssue(
      output.issues,
      {
        type: "input-rejected",
        field: "registry",
        code: "type",
        message: "character animation binding registry must be a CharacterAnimationBindingRegistry"
      },
      DEFAULT_MAX_ISSUES
    );
    return output;
  }
  const maxIssues = registry.maxIssues;
  if (!isRecord(graphOutput)) {
    pushIssue(
      output.issues,
      {
        type: "input-rejected",
        field: "graphOutput",
        code: "type",
        message: "character animation binding resolver input must be a graph output object"
      },
      maxIssues
    );
    return output;
  }

  resolvePlaybackRequests(registry, graphOutput, output, maxIssues);
  resolveBlendRequests(registry, graphOutput, output, maxIssues);
  resolveTransitionRequests(registry, graphOutput, output, maxIssues);
  resolveActionRequests(registry, graphOutput, output, maxIssues);
  return output;
}

function normalizeClipAssets(
  config: CharacterAnimationBindingRegistryConfig,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationClipAsset[] {
  const rawClips: unknown = config?.clips;
  if (!isReadonlyArray(rawClips)) {
    pushIssue(
      issues,
      {
        type: "invalid-config",
        field: "clips",
        code: "array",
        message: "character animation binding registry clips must be an array"
      },
      maxIssues
    );
    return [];
  }
  const limit = Math.min(rawClips.length, MAX_CLIP_ASSETS);
  if (rawClips.length > limit) {
    pushIssue(
      issues,
      {
        type: "bounded",
        field: "clips",
        code: "max-clips",
        message: "character animation binding registry ignored clip assets beyond the configured hard limit"
      },
      maxIssues
    );
  }
  const clips: CharacterAnimationClipAsset[] = [];
  for (let index = 0; index < limit; index += 1) {
    const rawClip = rawClips[index];
    if (!isRecord(rawClip)) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "clips",
          code: "type",
          message: "character animation clip asset entry must be an object",
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    const id = readBoundedId(rawClip.id);
    if (!id) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "clips.id",
          code: "id",
          message: "character animation clip asset id must be a non-empty bounded string",
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    const loop = readOptionalBoolean(rawClip.loop, "clips.loop", issues, maxIssues, index);
    clips.push(Object.freeze({ id, ...(loop !== undefined ? { loop } : {}) }));
  }
  return clips;
}

function normalizeSemanticBindings(
  config: CharacterAnimationBindingRegistryConfig,
  clipsById: ReadonlyMap<string, CharacterAnimationClipAsset>,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationSemanticBinding[] {
  const rawBindings: unknown = config?.bindings;
  if (!isReadonlyArray(rawBindings)) {
    pushIssue(
      issues,
      {
        type: "invalid-config",
        field: "bindings",
        code: "array",
        message: "character animation semantic bindings must be an array"
      },
      maxIssues
    );
    return [];
  }
  const limit = Math.min(rawBindings.length, MAX_BINDINGS);
  if (rawBindings.length > limit) {
    pushIssue(
      issues,
      {
        type: "bounded",
        field: "bindings",
        code: "max-bindings",
        message: "character animation binding registry ignored bindings beyond the configured hard limit"
      },
      maxIssues
    );
  }
  const bindings: CharacterAnimationSemanticBinding[] = [];
  for (let index = 0; index < limit; index += 1) {
    const rawBinding = rawBindings[index];
    if (!isRecord(rawBinding)) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "bindings",
          code: "type",
          message: "character animation semantic binding must be an object",
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    const requestId = readBoundedId(rawBinding.requestId);
    const clipId = readBoundedId(rawBinding.clipId);
    const layer = readGraphLayer(rawBinding.layer);
    if (!requestId) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "bindings.requestId",
          code: "id",
          message: "character animation binding requestId must be a non-empty bounded string",
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    if (!clipId) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "bindings.clipId",
          code: "id",
          message: "character animation binding clipId must be a non-empty bounded string",
          requestId,
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    if (!layer) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "bindings.layer",
          code: "layer",
          message: "character animation binding layer must be a supported graph layer",
          requestId,
          clipId,
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    if (!clipsById.has(clipId)) {
      pushIssue(
        issues,
        {
          type: "invalid-config",
          field: "bindings.clipId",
          code: "missing-clip",
          message: "character animation binding references an unknown clip asset id",
          requestId,
          clipId,
          sourceIndex: index
        },
        maxIssues
      );
      continue;
    }
    const runtime = normalizeRuntimePolicy(rawBinding.runtime, requestId, layer, clipId, index, issues, maxIssues);
    bindings.push(Object.freeze({ requestId, clipId, layer, runtime }));
  }
  return bindings;
}

function normalizeRuntimePolicy(
  rawRuntime: unknown,
  requestId: string,
  layer: CharacterAnimationGraphLayerId,
  clipId: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationBindingRuntimePolicy {
  if (rawRuntime !== undefined && !isRecord(rawRuntime)) {
    pushIssue(
      issues,
      {
        type: "invalid-config",
        field: "bindings.runtime",
        code: "type",
        message: "character animation binding runtime policy must be an object when present",
        requestId,
        clipId,
        sourceIndex
      },
      maxIssues
    );
  }
  const runtime = isRecord(rawRuntime) ? rawRuntime : {};
  const laneId =
    readOptionalId(runtime.laneId, "bindings.runtime.laneId", issues, maxIssues, sourceIndex, requestId, clipId) ??
    layer;
  const layerId =
    readOptionalId(runtime.layerId, "bindings.runtime.layerId", issues, maxIssues, sourceIndex, requestId, clipId) ??
    requestId;
  const maskId = readOptionalId(
    runtime.maskId,
    "bindings.runtime.maskId",
    issues,
    maxIssues,
    sourceIndex,
    requestId,
    clipId
  );
  const blendMode = readBlendMode(runtime.blendMode, requestId, clipId, sourceIndex, issues, maxIssues);
  const priority = readOptionalFiniteInRange(
    runtime.priority,
    0,
    MAX_PRIORITY,
    "bindings.runtime.priority",
    issues,
    maxIssues,
    sourceIndex,
    requestId,
    clipId
  );
  const fadeSeconds = readOptionalFiniteInRange(
    runtime.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    "bindings.runtime.fadeSeconds",
    issues,
    maxIssues,
    sourceIndex,
    requestId,
    clipId
  );
  const loop = readOptionalBoolean(
    runtime.loop,
    "bindings.runtime.loop",
    issues,
    maxIssues,
    sourceIndex,
    requestId,
    clipId
  );
  const playbackSpeedScale =
    readOptionalFiniteInRange(
      runtime.playbackSpeedScale,
      0,
      MAX_PLAYBACK_SPEED,
      "bindings.runtime.playbackSpeedScale",
      issues,
      maxIssues,
      sourceIndex,
      requestId,
      clipId
    ) ?? 1;
  const minPlaybackSpeed =
    readOptionalFiniteInRange(
      runtime.minPlaybackSpeed,
      0,
      MAX_PLAYBACK_SPEED,
      "bindings.runtime.minPlaybackSpeed",
      issues,
      maxIssues,
      sourceIndex,
      requestId,
      clipId
    ) ?? 0;
  let maxPlaybackSpeed =
    readOptionalFiniteInRange(
      runtime.maxPlaybackSpeed,
      0,
      MAX_PLAYBACK_SPEED,
      "bindings.runtime.maxPlaybackSpeed",
      issues,
      maxIssues,
      sourceIndex,
      requestId,
      clipId
    ) ?? MAX_PLAYBACK_SPEED;
  if (maxPlaybackSpeed < minPlaybackSpeed) {
    pushIssue(
      issues,
      {
        type: "invalid-config",
        field: "bindings.runtime.maxPlaybackSpeed",
        code: "range",
        message: "character animation binding maxPlaybackSpeed must be greater than or equal to minPlaybackSpeed",
        requestId,
        clipId,
        sourceIndex
      },
      maxIssues
    );
    maxPlaybackSpeed = minPlaybackSpeed;
  }
  const weightScale =
    readOptionalFiniteInRange(
      runtime.weightScale,
      0,
      MAX_WEIGHT_SCALE,
      "bindings.runtime.weightScale",
      issues,
      maxIssues,
      sourceIndex,
      requestId,
      clipId
    ) ?? 1;

  return Object.freeze({
    laneId,
    layerId,
    blendMode,
    playbackSpeedScale,
    minPlaybackSpeed,
    maxPlaybackSpeed,
    weightScale,
    ...(maskId !== undefined ? { maskId } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(fadeSeconds !== undefined ? { fadeSeconds } : {}),
    ...(loop !== undefined ? { loop } : {})
  });
}

function resolvePlaybackRequests(
  registry: CharacterAnimationBindingRegistry,
  graphOutput: Record<string, unknown>,
  output: CharacterAnimationBindingOutput,
  maxIssues: number
): void {
  const requests = readRequestArray(graphOutput.playback, "playback", output.issues, maxIssues);
  const limit = Math.min(requests.length, registry.maxRequestsPerResolve);
  reportRequestTruncation("playback", requests.length, limit, output.issues, maxIssues);
  for (let index = 0; index < limit; index += 1) {
    const request = sanitizePlaybackRequest(requests[index], index, output.issues, maxIssues);
    if (!request) continue;
    const resolved = resolveClipBinding(registry, request.layer, request.requestId, {
      priority: request.priority,
      fadeSeconds: request.transitionSeconds,
      playbackSpeed: request.playbackSpeed,
      loop: request.loop,
      weight: request.weight,
      sourceIndex: index,
      issues: output.issues,
      maxIssues
    });
    if (!resolved) continue;
    output.playback.push({
      ...resolved,
      type: "playback",
      weight: scaleWeight(request.weight, registry.bindingForRequest(request.requestId)!.runtime),
      phase: clamp01(request.phase),
      reason: request.reason,
      sourceIndex: index
    });
  }
}

function resolveBlendRequests(
  registry: CharacterAnimationBindingRegistry,
  graphOutput: Record<string, unknown>,
  output: CharacterAnimationBindingOutput,
  maxIssues: number
): void {
  const requests = readRequestArray(graphOutput.blends, "blends", output.issues, maxIssues);
  const limit = Math.min(requests.length, registry.maxRequestsPerResolve);
  reportRequestTruncation("blends", requests.length, limit, output.issues, maxIssues);
  for (let index = 0; index < limit; index += 1) {
    const request = sanitizeBlendRequest(requests[index], index, output.issues, maxIssues);
    if (!request) continue;
    const from = resolveBlendEndpoint(
      registry,
      request.layer,
      request.from,
      request.fromWeight,
      request,
      index,
      output.issues,
      maxIssues
    );
    const to = resolveBlendEndpoint(
      registry,
      request.layer,
      request.to,
      request.toWeight,
      request,
      index,
      output.issues,
      maxIssues
    );
    output.blends.push({
      type: "blend",
      layer: request.layer,
      from,
      to,
      fromWeight: request.fromWeight,
      toWeight: request.toWeight,
      priority: request.priority,
      fadeSeconds: request.transitionSeconds,
      reason: request.reason,
      sourceIndex: index
    });
  }
}

function resolveTransitionRequests(
  registry: CharacterAnimationBindingRegistry,
  graphOutput: Record<string, unknown>,
  output: CharacterAnimationBindingOutput,
  maxIssues: number
): void {
  const requests = readRequestArray(graphOutput.transitions, "transitions", output.issues, maxIssues);
  const limit = Math.min(requests.length, registry.maxRequestsPerResolve);
  reportRequestTruncation("transitions", requests.length, limit, output.issues, maxIssues);
  for (let index = 0; index < limit; index += 1) {
    const request = sanitizeTransitionRequest(requests[index], index, output.issues, maxIssues);
    if (!request) continue;
    const from = resolveOptionalTransitionEndpoint(
      registry,
      request.layer,
      request.from,
      request,
      index,
      output.issues,
      maxIssues
    );
    const to = resolveOptionalTransitionEndpoint(
      registry,
      request.layer,
      request.to,
      request,
      index,
      output.issues,
      maxIssues
    );
    output.transitions.push({
      type: "transition",
      layer: request.layer,
      from,
      to,
      priority: request.priority,
      fadeSeconds: request.fadeSeconds,
      reason: request.reason,
      sourceIndex: index,
      ...(request.controllerTick !== undefined ? { controllerTick: request.controllerTick } : {})
    });
  }
}

function resolveActionRequests(
  registry: CharacterAnimationBindingRegistry,
  graphOutput: Record<string, unknown>,
  output: CharacterAnimationBindingOutput,
  maxIssues: number
): void {
  const requests = readRequestArray(graphOutput.actions, "actions", output.issues, maxIssues);
  const limit = Math.min(requests.length, registry.maxRequestsPerResolve);
  reportRequestTruncation("actions", requests.length, limit, output.issues, maxIssues);
  for (let index = 0; index < limit; index += 1) {
    const request = sanitizeActionRequest(requests[index], index, output.issues, maxIssues);
    if (!request) continue;
    const resolved = resolveClipBinding(registry, "action", request.requestId, {
      priority: request.priority,
      fadeSeconds: request.fadeSeconds,
      playbackSpeed: 1,
      weight: 1,
      sourceIndex: index,
      issues: output.issues,
      maxIssues
    });
    if (!resolved) continue;
    output.actions.push({
      ...resolved,
      type: "action",
      weight: scaleWeight(1, registry.bindingForRequest(request.requestId)!.runtime),
      phase: 0,
      command: request.command,
      sourceIndex: index,
      ...(request.controllerTick !== undefined ? { controllerTick: request.controllerTick } : {})
    });
  }
}

function resolveBlendEndpoint(
  registry: CharacterAnimationBindingRegistry,
  layer: CharacterAnimationGraphLayerId,
  requestId: string,
  weight: number,
  request: CharacterAnimationBlendRequest,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationResolvedBlendEndpoint | null {
  const resolved = resolveClipBinding(registry, layer, requestId, {
    priority: request.priority,
    fadeSeconds: request.transitionSeconds,
    playbackSpeed: 1,
    weight,
    sourceIndex,
    issues,
    maxIssues
  });
  return resolved ? { ...resolved, weight: scaleWeight(weight, registry.bindingForRequest(requestId)!.runtime) } : null;
}

function resolveOptionalTransitionEndpoint(
  registry: CharacterAnimationBindingRegistry,
  layer: CharacterAnimationGraphLayerId,
  requestId: string | null,
  request: CharacterAnimationTransitionRequest,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationResolvedClipBinding | null {
  if (requestId === null) return null;
  return resolveClipBinding(registry, layer, requestId, {
    priority: request.priority,
    fadeSeconds: request.fadeSeconds,
    playbackSpeed: 1,
    weight: 1,
    sourceIndex,
    issues,
    maxIssues
  });
}

function resolveClipBinding(
  registry: CharacterAnimationBindingRegistry,
  graphLayer: CharacterAnimationGraphLayerId,
  requestId: string,
  context: {
    priority: number;
    fadeSeconds: number;
    playbackSpeed: number;
    weight: number;
    sourceIndex: number;
    issues: CharacterAnimationBindingIssue[];
    maxIssues: number;
    loop?: boolean;
  }
): CharacterAnimationResolvedClipBinding | null {
  const binding = registry.bindingForRequest(requestId);
  if (!binding) {
    pushIssue(
      context.issues,
      {
        type: "missing-binding",
        field: "requestId",
        code: "unbound-request",
        message: "character animation semantic request has no configured clip binding",
        requestId,
        sourceIndex: context.sourceIndex
      },
      context.maxIssues
    );
    return null;
  }
  if (binding.layer !== graphLayer) {
    pushIssue(
      context.issues,
      {
        type: "incompatible",
        field: "layer",
        code: "layer-mismatch",
        message: "character animation semantic binding layer does not match the graph request layer",
        requestId,
        clipId: binding.clipId,
        sourceIndex: context.sourceIndex
      },
      context.maxIssues
    );
    return null;
  }
  const clip = registry.clipForId(binding.clipId);
  if (!clip) {
    pushIssue(
      context.issues,
      {
        type: "missing-binding",
        field: "clipId",
        code: "missing-clip",
        message: "character animation semantic binding references a clip asset that is not in the registry",
        requestId,
        clipId: binding.clipId,
        sourceIndex: context.sourceIndex
      },
      context.maxIssues
    );
    return null;
  }
  const runtime = binding.runtime;
  const priority = runtime.priority ?? context.priority;
  const fadeSeconds = runtime.fadeSeconds ?? context.fadeSeconds;
  const loop = runtime.loop ?? context.loop ?? clip.loop ?? false;
  return {
    requestId,
    clipId: binding.clipId,
    graphLayer,
    laneId: runtime.laneId,
    layerId: runtime.layerId,
    blendMode: runtime.blendMode,
    loop,
    priority,
    fadeSeconds,
    playbackSpeed: resolvePlaybackSpeed(context.playbackSpeed, runtime),
    ...(runtime.maskId !== undefined ? { maskId: runtime.maskId } : {})
  };
}

function sanitizePlaybackRequest(
  rawRequest: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationPlaybackRequest | null {
  if (!isRecord(rawRequest) || rawRequest.type !== "playback") {
    rejectRequest("playback", "type", sourceIndex, issues, maxIssues);
    return null;
  }
  const layer = readRequestGraphLayer(rawRequest.layer, "playback.layer", sourceIndex, issues, maxIssues);
  const requestId = readRequestId(rawRequest.requestId, "playback.requestId", sourceIndex, issues, maxIssues);
  const weight = readRequestFiniteInRange(rawRequest.weight, 0, 1, "playback.weight", sourceIndex, issues, maxIssues);
  const playbackSpeed = readRequestFiniteInRange(
    rawRequest.playbackSpeed,
    0,
    MAX_PLAYBACK_SPEED,
    "playback.playbackSpeed",
    sourceIndex,
    issues,
    maxIssues
  );
  const priority = readRequestFiniteInRange(
    rawRequest.priority,
    0,
    MAX_PRIORITY,
    "playback.priority",
    sourceIndex,
    issues,
    maxIssues
  );
  const loop = readRequestBoolean(rawRequest.loop, "playback.loop", sourceIndex, issues, maxIssues);
  const phase = readRequestFiniteInRange(rawRequest.phase, 0, 1, "playback.phase", sourceIndex, issues, maxIssues);
  const transitionSeconds = readRequestFiniteInRange(
    rawRequest.transitionSeconds,
    0,
    MAX_FADE_SECONDS,
    "playback.transitionSeconds",
    sourceIndex,
    issues,
    maxIssues
  );
  const reason = readPlaybackReason(rawRequest.reason, sourceIndex, issues, maxIssues);
  if (
    !layer ||
    !requestId ||
    weight === null ||
    playbackSpeed === null ||
    priority === null ||
    loop === null ||
    phase === null ||
    transitionSeconds === null ||
    !reason
  ) {
    return null;
  }
  return {
    type: "playback",
    layer,
    requestId,
    weight,
    playbackSpeed,
    priority,
    loop,
    phase,
    transitionSeconds,
    reason
  };
}

function sanitizeBlendRequest(
  rawRequest: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationBlendRequest | null {
  if (!isRecord(rawRequest) || rawRequest.type !== "blend") {
    rejectRequest("blends", "type", sourceIndex, issues, maxIssues);
    return null;
  }
  const layer = readRequestGraphLayer(rawRequest.layer, "blends.layer", sourceIndex, issues, maxIssues);
  const from = readRequestId(rawRequest.from, "blends.from", sourceIndex, issues, maxIssues);
  const to = readRequestId(rawRequest.to, "blends.to", sourceIndex, issues, maxIssues);
  const fromWeight = readRequestFiniteInRange(
    rawRequest.fromWeight,
    0,
    1,
    "blends.fromWeight",
    sourceIndex,
    issues,
    maxIssues
  );
  const toWeight = readRequestFiniteInRange(
    rawRequest.toWeight,
    0,
    1,
    "blends.toWeight",
    sourceIndex,
    issues,
    maxIssues
  );
  const priority = readRequestFiniteInRange(
    rawRequest.priority,
    0,
    MAX_PRIORITY,
    "blends.priority",
    sourceIndex,
    issues,
    maxIssues
  );
  const transitionSeconds = readRequestFiniteInRange(
    rawRequest.transitionSeconds,
    0,
    MAX_FADE_SECONDS,
    "blends.transitionSeconds",
    sourceIndex,
    issues,
    maxIssues
  );
  const reason = readBlendReason(rawRequest.reason, sourceIndex, issues, maxIssues);
  if (
    !layer ||
    !from ||
    !to ||
    fromWeight === null ||
    toWeight === null ||
    priority === null ||
    transitionSeconds === null ||
    !reason
  )
    return null;
  return {
    type: "blend",
    layer,
    from,
    to,
    fromWeight,
    toWeight,
    priority,
    transitionSeconds,
    reason
  };
}

function sanitizeTransitionRequest(
  rawRequest: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationTransitionRequest | null {
  if (!isRecord(rawRequest) || rawRequest.type !== "transition") {
    rejectRequest("transitions", "type", sourceIndex, issues, maxIssues);
    return null;
  }
  const layer = readRequestGraphLayer(rawRequest.layer, "transitions.layer", sourceIndex, issues, maxIssues);
  const from = readNullableRequestId(rawRequest.from, "transitions.from", sourceIndex, issues, maxIssues);
  const to = readNullableRequestId(rawRequest.to, "transitions.to", sourceIndex, issues, maxIssues);
  const fadeSeconds = readRequestFiniteInRange(
    rawRequest.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    "transitions.fadeSeconds",
    sourceIndex,
    issues,
    maxIssues
  );
  const priority = readRequestFiniteInRange(
    rawRequest.priority,
    0,
    MAX_PRIORITY,
    "transitions.priority",
    sourceIndex,
    issues,
    maxIssues
  );
  const reason = readTransitionReason(rawRequest.reason, sourceIndex, issues, maxIssues);
  const controllerTick = readOptionalSafeInteger(
    rawRequest.controllerTick,
    "transitions.controllerTick",
    sourceIndex,
    issues,
    maxIssues
  );
  if (!layer || from === undefined || to === undefined || fadeSeconds === null || priority === null || !reason)
    return null;
  return {
    type: "transition",
    layer,
    from,
    to,
    fadeSeconds,
    priority,
    reason,
    ...(controllerTick !== undefined ? { controllerTick } : {})
  };
}

function sanitizeActionRequest(
  rawRequest: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationActionRequest | null {
  if (!isRecord(rawRequest) || rawRequest.type !== "action") {
    rejectRequest("actions", "type", sourceIndex, issues, maxIssues);
    return null;
  }
  if (rawRequest.layer !== "action") {
    rejectRequest("actions.layer", "layer", sourceIndex, issues, maxIssues);
    return null;
  }
  const requestId = readRequestId(rawRequest.requestId, "actions.requestId", sourceIndex, issues, maxIssues);
  const command = sanitizeActionCommand(rawRequest.command, sourceIndex, issues, maxIssues);
  const priority = readRequestFiniteInRange(
    rawRequest.priority,
    0,
    MAX_PRIORITY,
    "actions.priority",
    sourceIndex,
    issues,
    maxIssues
  );
  const fadeSeconds = readRequestFiniteInRange(
    rawRequest.fadeSeconds,
    0,
    MAX_FADE_SECONDS,
    "actions.fadeSeconds",
    sourceIndex,
    issues,
    maxIssues
  );
  const controllerTick = readOptionalSafeInteger(
    rawRequest.controllerTick,
    "actions.controllerTick",
    sourceIndex,
    issues,
    maxIssues
  );
  if (!requestId || !command || priority === null || fadeSeconds === null) return null;
  return {
    type: "action",
    layer: "action",
    requestId,
    command,
    priority,
    fadeSeconds,
    ...(controllerTick !== undefined ? { controllerTick } : {})
  };
}

function sanitizeActionCommand(
  rawCommand: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterActionIntent | null {
  if (!isRecord(rawCommand)) {
    rejectRequest("actions.command", "type", sourceIndex, issues, maxIssues);
    return null;
  }
  const commandId = readRequestId(rawCommand.commandId, "actions.command.commandId", sourceIndex, issues, maxIssues);
  const kind = readRequestId(rawCommand.kind, "actions.command.kind", sourceIndex, issues, maxIssues);
  if (!commandId || !kind) return null;
  const itemId = readOptionalActionId(rawCommand.itemId, "actions.command.itemId", sourceIndex, issues, maxIssues);
  const socketId = readOptionalActionId(
    rawCommand.socketId,
    "actions.command.socketId",
    sourceIndex,
    issues,
    maxIssues
  );
  const interactionId = readOptionalActionId(
    rawCommand.interactionId,
    "actions.command.interactionId",
    sourceIndex,
    issues,
    maxIssues
  );
  const targetActorId = readOptionalActionId(
    rawCommand.targetActorId,
    "actions.command.targetActorId",
    sourceIndex,
    issues,
    maxIssues
  );
  if (itemId === null || socketId === null || interactionId === null || targetActorId === null) return null;
  return {
    commandId,
    kind: kind as CharacterActionIntent["kind"],
    ...(itemId !== undefined ? { itemId } : {}),
    ...(socketId !== undefined ? { socketId } : {}),
    ...(interactionId !== undefined ? { interactionId } : {}),
    ...(targetActorId !== undefined ? { targetActorId } : {})
  };
}

function readRequestArray(
  rawValue: unknown,
  field: string,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): readonly unknown[] {
  if (Array.isArray(rawValue)) return rawValue;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "array",
      message: `character animation binding resolver expected graph ${field} to be an array`
    },
    maxIssues
  );
  return [];
}

function reportRequestTruncation(
  field: string,
  actual: number,
  limit: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): void {
  if (actual <= limit) return;
  pushIssue(
    issues,
    {
      type: "bounded",
      field,
      code: "max-requests",
      message: `character animation binding resolver ignored ${field} entries beyond maxRequestsPerResolve`
    },
    maxIssues
  );
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
    throw new Error(`character animation binding ${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function readBlendMode(
  value: unknown,
  requestId: string,
  clipId: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): LayerBlendMode {
  if (value === undefined) return "override";
  if (VALID_BLEND_MODES.has(value as LayerBlendMode)) return value as LayerBlendMode;
  pushIssue(
    issues,
    {
      type: "invalid-config",
      field: "bindings.runtime.blendMode",
      code: "enum",
      message: "character animation binding runtime blendMode must be override or additive",
      requestId,
      clipId,
      sourceIndex
    },
    maxIssues
  );
  return "override";
}

function readOptionalFiniteInRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number,
  sourceIndex: number,
  requestId?: string,
  clipId?: string
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return value;
  pushIssue(
    issues,
    {
      type: "invalid-config",
      field,
      code: "finite-range",
      message: `character animation binding ${field} must be finite in [${min}, ${max}]`,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(clipId !== undefined ? { clipId } : {}),
      sourceIndex
    },
    maxIssues
  );
  return undefined;
}

function readOptionalBoolean(
  value: unknown,
  field: string,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number,
  sourceIndex: number,
  requestId?: string,
  clipId?: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  pushIssue(
    issues,
    {
      type: "invalid-config",
      field,
      code: "boolean",
      message: `character animation binding ${field} must be a boolean when present`,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(clipId !== undefined ? { clipId } : {}),
      sourceIndex
    },
    maxIssues
  );
  return undefined;
}

function readOptionalId(
  value: unknown,
  field: string,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number,
  sourceIndex: number,
  requestId: string,
  clipId: string
): string | undefined {
  if (value === undefined) return undefined;
  const id = readBoundedId(value);
  if (id) return id;
  pushIssue(
    issues,
    {
      type: "invalid-config",
      field,
      code: "id",
      message: `character animation binding ${field} must be a non-empty bounded string when present`,
      requestId,
      clipId,
      sourceIndex
    },
    maxIssues
  );
  return undefined;
}

function readRequestGraphLayer(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationGraphLayerId | null {
  const layer = readGraphLayer(value);
  if (layer) return layer;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "layer",
      message: "character animation graph request layer is unsupported",
      sourceIndex
    },
    maxIssues
  );
  return null;
}

function readGraphLayer(value: unknown): CharacterAnimationGraphLayerId | null {
  return VALID_GRAPH_LAYERS.has(value as CharacterAnimationGraphLayerId)
    ? (value as CharacterAnimationGraphLayerId)
    : null;
}

function readRequestId(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): string | null {
  const id = readBoundedId(value);
  if (id) return id;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "id",
      message: "character animation graph request id must be a non-empty bounded string",
      sourceIndex
    },
    maxIssues
  );
  return null;
}

function readNullableRequestId(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): string | null | undefined {
  if (value === null) return null;
  const id = readBoundedId(value);
  if (id) return id;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "id",
      message: "character animation graph transition endpoint must be null or a non-empty bounded string",
      sourceIndex
    },
    maxIssues
  );
  return undefined;
}

function readOptionalActionId(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): string | undefined | null {
  if (value === undefined) return undefined;
  const id = readBoundedId(value);
  if (id) return id;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "id",
      message: "character animation graph action command optional ids must be bounded strings when present",
      sourceIndex
    },
    maxIssues
  );
  return null;
}

function readRequestBoolean(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): boolean | null {
  if (typeof value === "boolean") return value;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "boolean",
      message: "character animation graph request boolean field is invalid",
      sourceIndex
    },
    maxIssues
  );
  return null;
}

function readRequestFiniteInRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return value;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "finite-range",
      message: `character animation graph request ${field} must be finite in [${min}, ${max}]`,
      sourceIndex
    },
    maxIssues
  );
  return null;
}

function readOptionalSafeInteger(
  value: unknown,
  field: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): number | undefined {
  if (value === undefined) return undefined;
  if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code: "tick",
      message: "character animation graph request controllerTick must be a non-negative safe integer when present",
      sourceIndex
    },
    maxIssues
  );
  return undefined;
}

function readPlaybackReason(
  value: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationGraphPlaybackReason | null {
  if (VALID_PLAYBACK_REASONS.has(value as CharacterAnimationGraphPlaybackReason))
    return value as CharacterAnimationGraphPlaybackReason;
  rejectRequest("playback.reason", "enum", sourceIndex, issues, maxIssues);
  return null;
}

function readBlendReason(
  value: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationBlendRequest["reason"] | null {
  if (VALID_BLEND_REASONS.has(value as CharacterAnimationBlendRequest["reason"]))
    return value as CharacterAnimationBlendRequest["reason"];
  rejectRequest("blends.reason", "enum", sourceIndex, issues, maxIssues);
  return null;
}

function readTransitionReason(
  value: unknown,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): CharacterAnimationTransitionRequest["reason"] | null {
  if (VALID_TRANSITION_REASONS.has(value as CharacterAnimationTransitionRequest["reason"]))
    return value as CharacterAnimationTransitionRequest["reason"];
  rejectRequest("transitions.reason", "enum", sourceIndex, issues, maxIssues);
  return null;
}

function rejectRequest(
  field: string,
  code: string,
  sourceIndex: number,
  issues: CharacterAnimationBindingIssue[],
  maxIssues: number
): void {
  pushIssue(
    issues,
    {
      type: "input-rejected",
      field,
      code,
      message: "character animation graph request was rejected by the binding resolver",
      sourceIndex
    },
    maxIssues
  );
}

function resolvePlaybackSpeed(speed: number, runtime: CharacterAnimationBindingRuntimePolicy): number {
  const scaled = Number.isFinite(speed) ? speed * runtime.playbackSpeedScale : 0;
  return clamp(scaled, runtime.minPlaybackSpeed, runtime.maxPlaybackSpeed);
}

function scaleWeight(weight: number, runtime: CharacterAnimationBindingRuntimePolicy): number {
  const scaled = Number.isFinite(weight) ? weight * runtime.weightScale : 0;
  return clamp01(scaled);
}

function readSafeSequence(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function readBoundedId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function resetBindingOutput(output: CharacterAnimationBindingOutput): void {
  output.schemaVersion = CHARACTER_ANIMATION_BINDING_SCHEMA_VERSION;
  output.sequence = 0;
  output.playback.length = 0;
  output.blends.length = 0;
  output.transitions.length = 0;
  output.actions.length = 0;
  output.issues.length = 0;
}

function pushIssue(
  issues: CharacterAnimationBindingIssue[],
  issue: CharacterAnimationBindingIssue,
  maxIssues: number
): void {
  if (maxIssues <= 0) return;
  if (issues.length < maxIssues) {
    issues.push(issue);
    return;
  }
  const overflow: CharacterAnimationBindingIssue = {
    type: "bounded",
    field: "issues",
    code: "max-issues",
    message: "character animation binding issue reporting reached maxIssues"
  };
  issues[maxIssues - 1] = overflow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
