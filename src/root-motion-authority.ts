import {
  CHARACTER_CONTROLLER_COORDINATE_SYSTEM,
  type CharacterActorId,
  type CharacterControllerSnapshot
} from "./character-controller.js";
import {
  type Transform,
  type Vec3,
  EPSILON,
  addVec3,
  cloneTransform,
  cloneVec3,
  identityTransform,
  lengthVec3,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3
} from "./math.js";
import type { RuntimeRootMotionLayerDelta, RuntimeUpdateResult } from "./runtime.js";

export const ROOT_MOTION_AUTHORITY_SCHEMA_VERSION = 1;
export const ROOT_MOTION_RECONCILER_SCHEMA_VERSION = 1;

/** Shared root-motion convention: world-space Y-up, +Z-forward, yaw 0 faces +Z. */
export const ROOT_MOTION_COORDINATE_SYSTEM = CHARACTER_CONTROLLER_COORDINATE_SYSTEM;

export type RootMotionAuthorityMode = "physics-driven" | "animation-driven" | "hybrid";
export type RootMotionDeltaSpace = "local" | "world";
export type RootMotionCarrierSelectionKind = "none" | "runtime-blend" | "layer" | "clip" | "bone" | "metadata";
export type RootMotionOwner = "none" | "controller" | "model-root" | "external";
export type RootMotionDoubleApplyPolicy = "reject" | "report-only" | "allow";
export type RootMotionIssueType =
  | "input-rejected"
  | "carrier"
  | "adapter-failed"
  | "bounded"
  | "duplicate"
  | "ownership";

export type RootMotionIssue = {
  type: RootMotionIssueType;
  field: string;
  code: string;
  message: string;
  actorId?: CharacterActorId;
  token?: string;
  bindingId?: string;
  layerId?: string;
  clipId?: string;
};

export type RootMotionCarrierBinding = Readonly<{
  /** Optional caller-owned id for diagnostics/snapshots. */
  id?: string;
  /** `none` is an explicit in-place/no-root-motion selection. `runtime-blend` uses AnimationRuntime's blended delta. */
  select: RootMotionCarrierSelectionKind;
  /** Higher binding priority wins before runtime layer priority/weight and stable ids. */
  priority?: number;
  layerId?: string;
  clipId?: string;
  joint?: string;
  jointIndex?: number;
}>;

export type RootMotionAuthorityPolicyConfig = Readonly<{
  mode?: RootMotionAuthorityMode;
  /** Root-motion carrier/layer selector. Omitted means `runtime-blend`; `none` means explicit in-place/no carrier. */
  carrierBindings?: readonly RootMotionCarrierBinding[];
  /** Space of animation-delta translations before conversion to world displacement. Defaults to local actor space. */
  animationDeltaSpace?: RootMotionDeltaSpace;
  /** Space of supplied physics displacement before conversion to world displacement. Defaults to world. */
  physicsDeltaSpace?: RootMotionDeltaSpace;
  /** Hybrid-only animation contribution for translation. 0 = physics, 1 = animation. */
  animationTranslationWeight?: number;
  /** Hybrid-only animation contribution for yaw. 0 = physics, 1 = animation. */
  animationYawWeight?: number;
  /** Per-step displacement clamp in meters. Defaults to the reconciler config. */
  maxRequestedTranslation?: number;
  /** Per-step absolute yaw clamp in radians. Defaults to the reconciler config. */
  maxRequestedYawRadians?: number;
  /** Default handling when skeleton/root-bone motion and world/root application would both occur. */
  doubleApplyPolicy?: RootMotionDoubleApplyPolicy;
}>;

export type RootMotionActorState = Readonly<{
  actorId?: CharacterActorId;
  position: Vec3;
  yaw: number;
  velocity?: Vec3;
  grounded?: boolean;
  controllerTick?: number;
  radius?: number;
  height?: number;
}>;

export type RootMotionOwnershipDeclaration = Readonly<{
  /** Stable per-source/per-frame token. Reusing it is rejected to avoid double application. */
  token?: string;
  translationOwner?: RootMotionOwner;
  yawOwner?: RootMotionOwner;
  /** True when the evaluated skeleton/model pose still contains the same carrier translation/yaw. */
  skeletonPoseContainsRootMotion?: boolean;
  doubleApplyPolicy?: RootMotionDoubleApplyPolicy;
}>;

export type RootMotionWorldQuery = Readonly<{
  coordinateSystem: typeof ROOT_MOTION_COORDINATE_SYSTEM;
  actorId?: CharacterActorId;
  tick: number;
  deltaSeconds: number;
  fromPosition: Vec3;
  fromYaw: number;
  requestedDisplacement: Vec3;
  requestedYawDelta: number;
  requestedPosition: Vec3;
  requestedYaw: number;
  radius?: number;
  height?: number;
}>;

export type RootMotionWorldResolution = Readonly<{
  /** Accepted world-space displacement. Ignored when position is supplied. */
  displacement?: Vec3;
  /** Accepted world-space final position. Takes precedence over displacement. */
  position?: Vec3;
  /** Accepted yaw delta in radians. Ignored when yaw is supplied. */
  yawDelta?: number;
  /** Accepted final yaw in radians. Takes precedence over yawDelta. */
  yaw?: number;
  blocked?: boolean;
  reason?: string;
}>;

export type RootMotionWorldAdapter = Readonly<{
  /** Engine-agnostic collision/world reconciliation boundary. Returning null/undefined accepts the request unchanged. */
  resolveRootMotion?: (query: RootMotionWorldQuery) => RootMotionWorldResolution | null | undefined;
}>;

export type RootMotionReconcilerConfig = Readonly<{
  maxTokenHistory?: number;
  maxRequestedTranslation?: number;
  maxRequestedYawRadians?: number;
  defaultPolicy?: RootMotionAuthorityPolicyConfig;
}>;

export type RootMotionReconcilerResolvedConfig = Readonly<{
  maxTokenHistory: number;
  maxRequestedTranslation: number;
  maxRequestedYawRadians: number;
  defaultPolicy: Required<Pick<RootMotionAuthorityPolicyConfig, "mode" | "animationDeltaSpace" | "physicsDeltaSpace">> &
    RootMotionAuthorityPolicyConfig;
}>;

export type RootMotionLayerMetadata = Readonly<{
  id: string;
  clipId: string;
  priority: number;
  weight: number;
  normalizedWeight: number;
  fromTime: number;
  toTime: number;
  carrier: { jointIndex: number; joint: string };
}>;

export type RootMotionCarrierResolution = Readonly<{
  selected: boolean;
  select: RootMotionCarrierSelectionKind;
  bindingId?: string;
  bindingPriority: number;
  candidateCount: number;
  delta: Transform;
  layer?: RootMotionLayerMetadata;
}>;

export type RootMotionSourceBreakdown = Readonly<{
  delta: Transform;
  worldDisplacement: Vec3;
  yawDelta: number;
}>;

export type RootMotionMotionBreakdown = Readonly<{
  displacement: Vec3;
  yawDelta: number;
}>;

export type RootMotionAppliedBreakdown = RootMotionMotionBreakdown &
  Readonly<{
    position: Vec3;
    yaw: number;
  }>;

export type RootMotionOwnershipReport = Readonly<{
  token?: string;
  duplicateToken: boolean;
  translationOwner: RootMotionOwner;
  yawOwner: RootMotionOwner;
  skeletonPoseContainsRootMotion: boolean;
  doubleApplyPolicy: RootMotionDoubleApplyPolicy;
}>;

export type RootMotionReconcileInput = Readonly<{
  actor: RootMotionActorState;
  deltaSeconds?: number;
  runtime?: RuntimeUpdateResult;
  /** Direct animation delta used when no runtime result is supplied, or as a fallback for runtime-blend selection. */
  animationDelta?: Transform;
  /** Controller/physics-authored world or local displacement for physics-driven/hybrid authority. */
  physicsDisplacement?: Vec3;
  physicsYawDelta?: number;
  policy?: RootMotionAuthorityPolicyConfig;
  ownership?: RootMotionOwnershipDeclaration;
  world?: RootMotionWorldAdapter;
}>;

export type RootMotionReconcileResult = Readonly<{
  schemaVersion: typeof ROOT_MOTION_RECONCILER_SCHEMA_VERSION;
  sequence: number;
  coordinateSystem: typeof ROOT_MOTION_COORDINATE_SYSTEM;
  actor: RootMotionActorState;
  deltaSeconds: number;
  policy: Required<Pick<RootMotionAuthorityPolicyConfig, "mode" | "animationDeltaSpace" | "physicsDeltaSpace">> &
    RootMotionAuthorityPolicyConfig;
  carrier: RootMotionCarrierResolution;
  animation: RootMotionSourceBreakdown;
  physics: RootMotionMotionBreakdown;
  requested: RootMotionMotionBreakdown;
  consumed: RootMotionMotionBreakdown;
  applied: RootMotionAppliedBreakdown;
  rejected: RootMotionMotionBreakdown;
  residual: RootMotionMotionBreakdown;
  ownership: RootMotionOwnershipReport;
  issues: RootMotionIssue[];
}>;

export type RootMotionReconcilerSnapshot = Readonly<{
  schemaVersion: typeof ROOT_MOTION_RECONCILER_SCHEMA_VERSION;
  sequence: number;
  consumedTokens: readonly string[];
}>;

const DEFAULT_ROOT_MOTION_CONFIG = {
  maxTokenHistory: 128,
  maxRequestedTranslation: 100,
  maxRequestedYawRadians: Math.PI * 2,
  defaultPolicy: {
    mode: "animation-driven",
    animationDeltaSpace: "local",
    physicsDeltaSpace: "world",
    doubleApplyPolicy: "reject"
  }
} as const;

const MAX_TOKEN_HISTORY = 4096;
const MAX_REQUESTED_TRANSLATION = 1_000_000;
const MAX_REQUESTED_YAW = Math.PI * 128;

export class RootMotionReconciler {
  readonly schemaVersion = ROOT_MOTION_RECONCILER_SCHEMA_VERSION;
  readonly config: RootMotionReconcilerResolvedConfig;
  #sequence = 0;
  #consumedTokens: string[] = [];
  #consumedTokenSet = new Set<string>();

  constructor(config: RootMotionReconcilerConfig = {}) {
    this.config = resolveRootMotionReconcilerConfig(config);
  }

  reconcile(input: RootMotionReconcileInput): RootMotionReconcileResult {
    this.#sequence += 1;
    const issues: RootMotionIssue[] = [];
    const actor = sanitizeActorState(input?.actor, issues);
    const deltaSeconds = sanitizeDeltaSeconds(input?.deltaSeconds, issues, actor.actorId);
    const policy = resolveRootMotionAuthorityPolicy(input?.policy, this.config, issues, actor.actorId);
    const carrier = resolveRootMotionCarrier(input?.runtime, input?.animationDelta, policy, issues, actor.actorId);
    const animation = sourceBreakdown(carrier.delta, policy.animationDeltaSpace, actor, issues, "animation");
    const physics = physicsBreakdown(input, policy.physicsDeltaSpace, actor, issues);
    const ownership = this.#resolveOwnership(input?.ownership, policy, issues, actor.actorId);
    const requested = applyAuthorityPolicy(animation, physics, policy);
    const boundedRequested = boundRequestedMotion(requested, policy, this.config, issues, actor.actorId);
    const gatedRequested = shouldRejectForOwnership(boundedRequested, ownership, issues, actor.actorId)
      ? { displacement: [0, 0, 0] as Vec3, yawDelta: 0 }
      : boundedRequested;
    const consumed = ownership.duplicateToken
      ? ({ displacement: [0, 0, 0] as Vec3, yawDelta: 0 } satisfies RootMotionMotionBreakdown)
      : resolveWorldMotion(input?.world, actor, deltaSeconds, gatedRequested, this.#sequence, issues);
    if (ownership.token !== undefined && !ownership.duplicateToken) this.#rememberToken(ownership.token);

    const applied = {
      displacement: cloneVec3(consumed.displacement),
      yawDelta: consumed.yawDelta,
      position: addVec3(actor.position, consumed.displacement),
      yaw: wrapYaw(actor.yaw + consumed.yawDelta)
    } satisfies RootMotionAppliedBreakdown;
    const residual = {
      displacement: subVec3(gatedRequested.displacement, consumed.displacement),
      yawDelta: wrapYaw(gatedRequested.yawDelta - consumed.yawDelta)
    } satisfies RootMotionMotionBreakdown;

    return {
      schemaVersion: ROOT_MOTION_RECONCILER_SCHEMA_VERSION,
      sequence: this.#sequence,
      coordinateSystem: ROOT_MOTION_COORDINATE_SYSTEM,
      actor,
      deltaSeconds,
      policy,
      carrier,
      animation,
      physics,
      requested: cloneMotion(gatedRequested),
      consumed: cloneMotion(consumed),
      applied,
      rejected: cloneMotion(residual),
      residual,
      ownership,
      issues
    };
  }

  snapshot(): RootMotionReconcilerSnapshot {
    return Object.freeze({
      schemaVersion: ROOT_MOTION_RECONCILER_SCHEMA_VERSION,
      sequence: this.#sequence,
      consumedTokens: Object.freeze([...this.#consumedTokens])
    });
  }

  restore(snapshot: RootMotionReconcilerSnapshot): void {
    if (!isRecord(snapshot)) throw new Error("root motion reconciler snapshot must be an object");
    if (snapshot.schemaVersion !== ROOT_MOTION_RECONCILER_SCHEMA_VERSION)
      throw new Error("unsupported root motion reconciler snapshot schemaVersion");
    if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0)
      throw new Error("root motion reconciler snapshot sequence must be a non-negative integer");
    if (!isReadonlyArray(snapshot.consumedTokens))
      throw new Error("root motion reconciler snapshot consumedTokens must be an array");
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const token of snapshot.consumedTokens) {
      if (!isNonEmptyString(token)) throw new Error("root motion reconciler snapshot tokens must be non-empty strings");
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
    this.#sequence = snapshot.sequence;
    this.#consumedTokens = tokens.slice(-this.config.maxTokenHistory);
    this.#consumedTokenSet = new Set(this.#consumedTokens);
  }

  #resolveOwnership(
    declaration: RootMotionOwnershipDeclaration | undefined,
    policy: RootMotionReconcileResult["policy"],
    issues: RootMotionIssue[],
    actorId: CharacterActorId | undefined
  ): RootMotionOwnershipReport {
    let token: string | undefined;
    if (declaration?.token !== undefined) {
      if (isNonEmptyString(declaration.token)) token = declaration.token;
      else
        pushIssue(
          issues,
          "input-rejected",
          "ownership.token",
          "id",
          "root motion ownership token must be a non-empty string",
          actorId
        );
    }
    const duplicateToken = token !== undefined && this.#consumedTokenSet.has(token);
    if (duplicateToken) {
      pushIssue(
        issues,
        "duplicate",
        "ownership.token",
        "duplicate-token",
        "root motion ownership token was already consumed; requested motion is rejected",
        actorId,
        token !== undefined ? { token } : {}
      );
    }
    return {
      ...(token !== undefined ? { token } : {}),
      duplicateToken,
      translationOwner: sanitizeOwner(declaration?.translationOwner, "external"),
      yawOwner: sanitizeOwner(declaration?.yawOwner, "external"),
      skeletonPoseContainsRootMotion: declaration?.skeletonPoseContainsRootMotion === true,
      doubleApplyPolicy: sanitizeDoubleApplyPolicy(declaration?.doubleApplyPolicy ?? policy.doubleApplyPolicy)
    };
  }

  #rememberToken(token: string): void {
    if (this.#consumedTokenSet.has(token)) return;
    this.#consumedTokens.push(token);
    this.#consumedTokenSet.add(token);
    while (this.#consumedTokens.length > this.config.maxTokenHistory) {
      const removed = this.#consumedTokens.shift();
      if (removed !== undefined) this.#consumedTokenSet.delete(removed);
    }
  }
}

export function resolveRootMotionReconcilerConfig(
  config: RootMotionReconcilerConfig = {}
): RootMotionReconcilerResolvedConfig {
  if (!isRecord(config)) throw new Error("root motion reconciler config must be an object");
  const maxTokenHistory = integerInRange(
    config.maxTokenHistory,
    DEFAULT_ROOT_MOTION_CONFIG.maxTokenHistory,
    0,
    MAX_TOKEN_HISTORY
  );
  const maxRequestedTranslation = finitePositiveInRange(
    config.maxRequestedTranslation,
    DEFAULT_ROOT_MOTION_CONFIG.maxRequestedTranslation,
    MAX_REQUESTED_TRANSLATION
  );
  const maxRequestedYawRadians = finitePositiveInRange(
    config.maxRequestedYawRadians,
    DEFAULT_ROOT_MOTION_CONFIG.maxRequestedYawRadians,
    MAX_REQUESTED_YAW
  );
  const issues: RootMotionIssue[] = [];
  const defaultPolicy = resolveRootMotionAuthorityPolicy(
    config.defaultPolicy,
    {
      maxTokenHistory,
      maxRequestedTranslation,
      maxRequestedYawRadians,
      defaultPolicy: DEFAULT_ROOT_MOTION_CONFIG.defaultPolicy
    },
    issues,
    undefined
  );
  return Object.freeze({ maxTokenHistory, maxRequestedTranslation, maxRequestedYawRadians, defaultPolicy });
}

export function createRootMotionActorStateFromControllerSnapshot(
  snapshot: CharacterControllerSnapshot,
  options: Readonly<{ actorId?: CharacterActorId; radius?: number; height?: number }> = {}
): RootMotionActorState {
  if (!isRecord(snapshot)) throw new Error("character controller snapshot must be an object");
  const position = readFiniteVec3(snapshot.position);
  const velocity = readFiniteVec3(snapshot.velocity);
  if (!position) throw new Error("character controller snapshot position must be finite");
  if (!velocity) throw new Error("character controller snapshot velocity must be finite");
  if (!Number.isFinite(snapshot.yaw)) throw new Error("character controller snapshot yaw must be finite");
  const actor: RootMotionActorState = {
    ...(options.actorId !== undefined ? { actorId: options.actorId } : {}),
    position,
    yaw: wrapYaw(snapshot.yaw),
    velocity,
    grounded: snapshot.grounded?.grounded === true,
    controllerTick: Number.isInteger(snapshot.tick) && snapshot.tick >= 0 ? snapshot.tick : 0,
    ...(options.radius !== undefined && Number.isFinite(options.radius) && options.radius > 0
      ? { radius: options.radius }
      : {}),
    ...(options.height !== undefined && Number.isFinite(options.height) && options.height > 0
      ? { height: options.height }
      : {})
  };
  return actor;
}

export function resolveRootMotionCarrier(
  runtime: RuntimeUpdateResult | undefined,
  fallbackAnimationDelta: Transform | undefined,
  policy: RootMotionAuthorityPolicyConfig = {},
  issues: RootMotionIssue[] = [],
  actorId?: CharacterActorId
): RootMotionCarrierResolution {
  const bindings = normalizeCarrierBindings(policy.carrierBindings, issues, actorId);
  const layers = normalizeRuntimeLayers(runtime?.rootMotionLayers, issues, actorId);
  const runtimeDelta = sanitizeTransformInput(
    runtime?.rootMotionDelta ?? fallbackAnimationDelta,
    issues,
    "rootMotionDelta",
    actorId
  );
  const effectiveBindings = bindings.length > 0 ? bindings : [{ select: "runtime-blend" as const, priority: 0 }];
  const candidates: CarrierCandidate[] = [];

  for (let bindingIndex = 0; bindingIndex < effectiveBindings.length; bindingIndex += 1) {
    const binding = effectiveBindings[bindingIndex]!;
    const bindingPriority = finitePriority(binding.priority);
    if (binding.select === "none") {
      candidates.push({ binding, bindingIndex, bindingPriority, delta: identityTransform(), select: "none" });
      continue;
    }
    if (binding.select === "runtime-blend") {
      candidates.push({ binding, bindingIndex, bindingPriority, delta: runtimeDelta, select: "runtime-blend" });
      continue;
    }
    const matches = layers.filter((layer) => layerMatchesBinding(layer, binding, issues, actorId));
    for (const layer of matches) {
      candidates.push({
        binding,
        bindingIndex,
        bindingPriority,
        delta: cloneTransform(layer.delta),
        layer,
        select: binding.select
      });
    }
  }

  if (candidates.length === 0) {
    pushIssue(
      issues,
      "carrier",
      "carrierBindings",
      "no-match",
      "root motion carrier bindings did not match a runtime contribution; using identity motion",
      actorId
    );
    return {
      selected: false,
      select: "metadata",
      bindingPriority: 0,
      candidateCount: 0,
      delta: identityTransform()
    };
  }

  const selected = [...candidates].sort(compareCarrierCandidates)[0]!;
  return {
    selected: true,
    select: selected.select,
    ...(selected.binding.id !== undefined ? { bindingId: selected.binding.id } : {}),
    bindingPriority: selected.bindingPriority,
    candidateCount: candidates.length,
    delta: cloneTransform(selected.delta),
    ...(selected.layer !== undefined ? { layer: layerMetadata(selected.layer) } : {})
  };
}

function resolveRootMotionAuthorityPolicy(
  policy: RootMotionAuthorityPolicyConfig | undefined,
  config: RootMotionReconcilerResolvedConfig,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): RootMotionReconcileResult["policy"] {
  const fallback = config.defaultPolicy;
  if (policy !== undefined && !isRecord(policy)) {
    pushIssue(issues, "input-rejected", "policy", "type", "root motion authority policy must be an object", actorId);
    policy = undefined;
  }
  const mode = sanitizeMode(policy?.mode, fallback.mode, issues, actorId);
  const animationDeltaSpace = sanitizeDeltaSpace(
    policy?.animationDeltaSpace,
    fallback.animationDeltaSpace,
    issues,
    "policy.animationDeltaSpace",
    actorId
  );
  const physicsDeltaSpace = sanitizeDeltaSpace(
    policy?.physicsDeltaSpace,
    fallback.physicsDeltaSpace,
    issues,
    "policy.physicsDeltaSpace",
    actorId
  );
  return {
    ...fallback,
    ...policy,
    mode,
    animationDeltaSpace,
    physicsDeltaSpace,
    doubleApplyPolicy: sanitizeDoubleApplyPolicy(policy?.doubleApplyPolicy ?? fallback.doubleApplyPolicy)
  };
}

function sourceBreakdown(
  delta: Transform,
  space: RootMotionDeltaSpace,
  actor: RootMotionActorState,
  issues: RootMotionIssue[],
  field: string
): RootMotionSourceBreakdown {
  const safeDelta = sanitizeTransformInput(delta, issues, `${field}.delta`, actor.actorId);
  const localTranslation = cloneVec3(safeDelta.translation);
  const worldDisplacement =
    space === "local" ? rotateVec3ByQuat(quatFromAxisAngle([0, 1, 0], actor.yaw), localTranslation) : localTranslation;
  return {
    delta: safeDelta,
    worldDisplacement: sanitizeVec3(worldDisplacement, [0, 0, 0], issues, `${field}.worldDisplacement`, actor.actorId),
    yawDelta: wrapYaw(yawFromRotation(safeDelta))
  };
}

function physicsBreakdown(
  input: RootMotionReconcileInput,
  space: RootMotionDeltaSpace,
  actor: RootMotionActorState,
  issues: RootMotionIssue[]
): RootMotionMotionBreakdown {
  const displacement = sanitizeVec3(
    input?.physicsDisplacement,
    [0, 0, 0],
    issues,
    "physicsDisplacement",
    actor.actorId
  );
  const worldDisplacement =
    space === "local" ? rotateVec3ByQuat(quatFromAxisAngle([0, 1, 0], actor.yaw), displacement) : displacement;
  const rawYaw = input?.physicsYawDelta;
  if (rawYaw !== undefined && !Number.isFinite(rawYaw)) {
    pushIssue(issues, "input-rejected", "physicsYawDelta", "finite", "physicsYawDelta must be finite", actor.actorId);
  }
  return {
    displacement: sanitizeVec3(worldDisplacement, [0, 0, 0], issues, "physics.worldDisplacement", actor.actorId),
    yawDelta: wrapYaw(Number.isFinite(rawYaw) ? rawYaw! : 0)
  };
}

function applyAuthorityPolicy(
  animation: RootMotionSourceBreakdown,
  physics: RootMotionMotionBreakdown,
  policy: RootMotionReconcileResult["policy"]
): RootMotionMotionBreakdown {
  if (policy.mode === "physics-driven") return cloneMotion(physics);
  if (policy.mode === "animation-driven") {
    return { displacement: cloneVec3(animation.worldDisplacement), yawDelta: animation.yawDelta };
  }
  const translationWeight = clamp01Finite(policy.animationTranslationWeight, 0.5);
  const yawWeight = clamp01Finite(policy.animationYawWeight, 0.5);
  return {
    displacement: [
      physics.displacement[0] * (1 - translationWeight) + animation.worldDisplacement[0] * translationWeight,
      physics.displacement[1] * (1 - translationWeight) + animation.worldDisplacement[1] * translationWeight,
      physics.displacement[2] * (1 - translationWeight) + animation.worldDisplacement[2] * translationWeight
    ],
    yawDelta: wrapYaw(physics.yawDelta * (1 - yawWeight) + animation.yawDelta * yawWeight)
  };
}

function boundRequestedMotion(
  requested: RootMotionMotionBreakdown,
  policy: RootMotionReconcileResult["policy"],
  config: RootMotionReconcilerResolvedConfig,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): RootMotionMotionBreakdown {
  const maxTranslation = finitePositiveInRange(
    policy.maxRequestedTranslation,
    config.maxRequestedTranslation,
    MAX_REQUESTED_TRANSLATION
  );
  const maxYaw = finitePositiveInRange(policy.maxRequestedYawRadians, config.maxRequestedYawRadians, MAX_REQUESTED_YAW);
  let displacement = cloneVec3(requested.displacement);
  const distance = lengthVec3(displacement);
  if (Number.isFinite(distance) && distance > maxTranslation) {
    displacement = scaleVec3(displacement, maxTranslation / distance);
    pushIssue(
      issues,
      "bounded",
      "requested.displacement",
      "maxRequestedTranslation",
      "root motion requested displacement was clamped to maxRequestedTranslation",
      actorId
    );
  }
  let yawDelta = wrapYaw(requested.yawDelta);
  if (Math.abs(yawDelta) > maxYaw) {
    yawDelta = Math.sign(yawDelta) * maxYaw;
    pushIssue(
      issues,
      "bounded",
      "requested.yawDelta",
      "maxRequestedYawRadians",
      "root motion requested yaw was clamped to maxRequestedYawRadians",
      actorId
    );
  }
  return { displacement, yawDelta };
}

function shouldRejectForOwnership(
  requested: RootMotionMotionBreakdown,
  ownership: RootMotionOwnershipReport,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): boolean {
  if (ownership.duplicateToken) return true;
  const hasWorldOwner = ownership.translationOwner !== "none" || ownership.yawOwner !== "none";
  const hasMotion = lengthVec3(requested.displacement) > EPSILON || Math.abs(requested.yawDelta) > EPSILON;
  if (
    !ownership.skeletonPoseContainsRootMotion ||
    !hasWorldOwner ||
    !hasMotion ||
    ownership.doubleApplyPolicy === "allow"
  ) {
    return false;
  }
  pushIssue(
    issues,
    "ownership",
    "ownership.skeletonPoseContainsRootMotion",
    "double-apply-risk",
    "root motion would be applied to a world owner while the skeleton pose still contains carrier motion",
    actorId
  );
  return ownership.doubleApplyPolicy === "reject";
}

function resolveWorldMotion(
  world: RootMotionWorldAdapter | undefined,
  actor: RootMotionActorState,
  deltaSeconds: number,
  requested: RootMotionMotionBreakdown,
  sequence: number,
  issues: RootMotionIssue[]
): RootMotionMotionBreakdown {
  const query: RootMotionWorldQuery = {
    coordinateSystem: ROOT_MOTION_COORDINATE_SYSTEM,
    ...(actor.actorId !== undefined ? { actorId: actor.actorId } : {}),
    tick: actor.controllerTick ?? sequence,
    deltaSeconds,
    fromPosition: cloneVec3(actor.position),
    fromYaw: actor.yaw,
    requestedDisplacement: cloneVec3(requested.displacement),
    requestedYawDelta: requested.yawDelta,
    requestedPosition: addVec3(actor.position, requested.displacement),
    requestedYaw: wrapYaw(actor.yaw + requested.yawDelta),
    ...(actor.radius !== undefined ? { radius: actor.radius } : {}),
    ...(actor.height !== undefined ? { height: actor.height } : {})
  };
  const resolver = world?.resolveRootMotion;
  if (!resolver) return cloneMotion(requested);

  let resolution: RootMotionWorldResolution | null | undefined;
  try {
    resolution = resolver(query);
  } catch (error) {
    pushIssue(
      issues,
      "adapter-failed",
      "world.resolveRootMotion",
      "throw",
      `root motion world adapter threw: ${error instanceof Error ? error.message : String(error)}`,
      actor.actorId
    );
    return { displacement: [0, 0, 0], yawDelta: 0 };
  }
  if (resolution === null || resolution === undefined) return cloneMotion(requested);
  if (!isRecord(resolution)) {
    pushIssue(
      issues,
      "adapter-failed",
      "world.resolveRootMotion",
      "type",
      "root motion world adapter result must be an object",
      actor.actorId
    );
    return { displacement: [0, 0, 0], yawDelta: 0 };
  }
  if (resolution.reason !== undefined && !isNonEmptyString(resolution.reason)) {
    pushIssue(
      issues,
      "adapter-failed",
      "world.resolveRootMotion.reason",
      "type",
      "root motion world adapter reason must be a string",
      actor.actorId
    );
    return { displacement: [0, 0, 0], yawDelta: 0 };
  }

  const blocked = resolution.blocked === true;
  let displacement = blocked ? ([0, 0, 0] as Vec3) : cloneVec3(requested.displacement);
  if (resolution.position !== undefined) {
    const position = readFiniteVec3(resolution.position);
    if (!position) {
      pushIssue(
        issues,
        "adapter-failed",
        "world.resolveRootMotion.position",
        "finite",
        "root motion world adapter position must be finite",
        actor.actorId
      );
      return { displacement: [0, 0, 0], yawDelta: 0 };
    }
    displacement = subVec3(position, actor.position);
  } else if (resolution.displacement !== undefined) {
    const resolvedDisplacement = readFiniteVec3(resolution.displacement);
    if (!resolvedDisplacement) {
      pushIssue(
        issues,
        "adapter-failed",
        "world.resolveRootMotion.displacement",
        "finite",
        "root motion world adapter displacement must be finite",
        actor.actorId
      );
      return { displacement: [0, 0, 0], yawDelta: 0 };
    }
    displacement = resolvedDisplacement;
  }
  displacement = limitNoGain(
    displacement,
    requested.displacement,
    issues,
    "world.resolveRootMotion.displacement",
    actor.actorId
  );

  let yawDelta = blocked ? 0 : requested.yawDelta;
  if (resolution.yaw !== undefined) {
    if (!Number.isFinite(resolution.yaw)) {
      pushIssue(
        issues,
        "adapter-failed",
        "world.resolveRootMotion.yaw",
        "finite",
        "root motion world adapter yaw must be finite",
        actor.actorId
      );
      return { displacement: [0, 0, 0], yawDelta: 0 };
    }
    yawDelta = wrapYaw(resolution.yaw - actor.yaw);
  } else if (resolution.yawDelta !== undefined) {
    if (!Number.isFinite(resolution.yawDelta)) {
      pushIssue(
        issues,
        "adapter-failed",
        "world.resolveRootMotion.yawDelta",
        "finite",
        "root motion world adapter yawDelta must be finite",
        actor.actorId
      );
      return { displacement: [0, 0, 0], yawDelta: 0 };
    }
    yawDelta = wrapYaw(resolution.yawDelta);
  }
  yawDelta = limitYawNoGain(yawDelta, requested.yawDelta, issues, actor.actorId);
  return { displacement, yawDelta };
}

type NormalizedRuntimeLayer = RuntimeRootMotionLayerDelta & { delta: Transform };

type CarrierCandidate = {
  binding: RootMotionCarrierBinding;
  bindingIndex: number;
  bindingPriority: number;
  delta: Transform;
  select: RootMotionCarrierSelectionKind;
  layer?: NormalizedRuntimeLayer;
};

function normalizeCarrierBindings(
  bindings: readonly RootMotionCarrierBinding[] | undefined,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): RootMotionCarrierBinding[] {
  if (bindings === undefined) return [];
  if (!isReadonlyArray(bindings)) {
    pushIssue(
      issues,
      "input-rejected",
      "carrierBindings",
      "type",
      "root motion carrierBindings must be an array",
      actorId
    );
    return [];
  }
  const output: RootMotionCarrierBinding[] = [];
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index] ?? null;
    if (!isRecord(binding) || !isCarrierSelectionKind(binding.select)) {
      pushIssue(
        issues,
        "input-rejected",
        `carrierBindings[${index}].select`,
        "enum",
        "root motion carrier binding select must be a supported value",
        actorId
      );
      continue;
    }
    const priority = binding.priority;
    const jointIndex = binding.jointIndex;
    const normalized: RootMotionCarrierBinding = {
      select: binding.select,
      ...(isNonEmptyString(binding.id) ? { id: binding.id } : {}),
      ...(typeof priority === "number" && Number.isFinite(priority) ? { priority } : {}),
      ...(isNonEmptyString(binding.layerId) ? { layerId: binding.layerId } : {}),
      ...(isNonEmptyString(binding.clipId) ? { clipId: binding.clipId } : {}),
      ...(isNonEmptyString(binding.joint) ? { joint: binding.joint } : {}),
      ...(typeof jointIndex === "number" && Number.isInteger(jointIndex) && jointIndex >= 0 ? { jointIndex } : {})
    };
    output.push(normalized);
  }
  return output;
}

function normalizeRuntimeLayers(
  layers: RuntimeUpdateResult["rootMotionLayers"] | undefined,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): NormalizedRuntimeLayer[] {
  if (layers === undefined) return [];
  if (!isReadonlyArray(layers)) {
    pushIssue(
      issues,
      "input-rejected",
      "rootMotionLayers",
      "type",
      "runtime rootMotionLayers must be an array",
      actorId
    );
    return [];
  }
  const output: NormalizedRuntimeLayer[] = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (!isRecord(layer) || !isNonEmptyString(layer.id) || !isNonEmptyString(layer.clipId)) {
      pushIssue(
        issues,
        "input-rejected",
        `rootMotionLayers[${index}]`,
        "type",
        "runtime root motion layer metadata is invalid",
        actorId
      );
      continue;
    }
    if (
      !isRecord(layer.carrier) ||
      !Number.isInteger(layer.carrier.jointIndex) ||
      !isNonEmptyString(layer.carrier.joint)
    ) {
      pushIssue(
        issues,
        "input-rejected",
        `rootMotionLayers[${index}].carrier`,
        "type",
        "runtime root motion layer carrier metadata is invalid",
        actorId
      );
      continue;
    }
    output.push({
      id: layer.id,
      clipId: layer.clipId,
      priority: finiteNumber(layer.priority, 0),
      weight: finiteNumber(layer.weight, 0),
      normalizedWeight: finiteNumber(layer.normalizedWeight, 0),
      fromTime: finiteNumber(layer.fromTime, 0),
      toTime: finiteNumber(layer.toTime, 0),
      carrier: { jointIndex: layer.carrier.jointIndex, joint: layer.carrier.joint },
      delta: sanitizeTransformInput(layer.delta, issues, `rootMotionLayers[${index}].delta`, actorId)
    });
  }
  return output;
}

function layerMatchesBinding(
  layer: NormalizedRuntimeLayer,
  binding: RootMotionCarrierBinding,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): boolean {
  if (binding.select === "layer" && binding.layerId === undefined) {
    pushIssue(
      issues,
      "carrier",
      "carrierBindings.layerId",
      "required",
      "layer carrier binding requires layerId",
      actorId
    );
    return false;
  }
  if (binding.select === "clip" && binding.clipId === undefined) {
    pushIssue(issues, "carrier", "carrierBindings.clipId", "required", "clip carrier binding requires clipId", actorId);
    return false;
  }
  if (binding.select === "bone" && binding.joint === undefined && binding.jointIndex === undefined) {
    pushIssue(
      issues,
      "carrier",
      "carrierBindings.bone",
      "required",
      "bone carrier binding requires joint or jointIndex",
      actorId
    );
    return false;
  }
  if (binding.layerId !== undefined && layer.id !== binding.layerId) return false;
  if (binding.clipId !== undefined && layer.clipId !== binding.clipId) return false;
  if (binding.joint !== undefined && layer.carrier.joint !== binding.joint) return false;
  if (binding.jointIndex !== undefined && layer.carrier.jointIndex !== binding.jointIndex) return false;
  return true;
}

function compareCarrierCandidates(a: CarrierCandidate, b: CarrierCandidate): number {
  const bindingPriority = b.bindingPriority - a.bindingPriority;
  if (bindingPriority !== 0) return bindingPriority;
  const layerPriority = finiteNumber(b.layer?.priority, 0) - finiteNumber(a.layer?.priority, 0);
  if (layerPriority !== 0) return layerPriority;
  const normalizedWeight = finiteNumber(b.layer?.normalizedWeight, 0) - finiteNumber(a.layer?.normalizedWeight, 0);
  if (normalizedWeight !== 0) return normalizedWeight;
  const weight = finiteNumber(b.layer?.weight, 0) - finiteNumber(a.layer?.weight, 0);
  if (weight !== 0) return weight;
  const layerId = compareText(a.layer?.id ?? "", b.layer?.id ?? "");
  if (layerId !== 0) return layerId;
  const clipId = compareText(a.layer?.clipId ?? "", b.layer?.clipId ?? "");
  if (clipId !== 0) return clipId;
  const jointIndex = finiteNumber(a.layer?.carrier.jointIndex, 0) - finiteNumber(b.layer?.carrier.jointIndex, 0);
  if (jointIndex !== 0) return jointIndex;
  return a.bindingIndex - b.bindingIndex;
}

function layerMetadata(layer: NormalizedRuntimeLayer): RootMotionLayerMetadata {
  return {
    id: layer.id,
    clipId: layer.clipId,
    priority: layer.priority,
    weight: layer.weight,
    normalizedWeight: layer.normalizedWeight,
    fromTime: layer.fromTime,
    toTime: layer.toTime,
    carrier: { jointIndex: layer.carrier.jointIndex, joint: layer.carrier.joint }
  };
}

function sanitizeActorState(value: RootMotionActorState | undefined, issues: RootMotionIssue[]): RootMotionActorState {
  if (!isRecord(value)) {
    pushIssue(issues, "input-rejected", "actor", "type", "root motion actor state must be an object", undefined);
    return { position: [0, 0, 0], yaw: 0 };
  }
  const actorId = isNonEmptyString(value.actorId) ? value.actorId : undefined;
  const position = sanitizeVec3(value.position, [0, 0, 0], issues, "actor.position", actorId);
  const velocity =
    value.velocity !== undefined
      ? sanitizeVec3(value.velocity, [0, 0, 0], issues, "actor.velocity", actorId)
      : undefined;
  if (!Number.isFinite(value.yaw))
    pushIssue(issues, "input-rejected", "actor.yaw", "finite", "actor yaw must be finite", actorId);
  return {
    ...(actorId !== undefined ? { actorId } : {}),
    position,
    yaw: wrapYaw(value.yaw),
    ...(velocity !== undefined ? { velocity } : {}),
    ...(typeof value.grounded === "boolean" ? { grounded: value.grounded } : {}),
    ...(typeof value.controllerTick === "number" && Number.isInteger(value.controllerTick) && value.controllerTick >= 0
      ? { controllerTick: value.controllerTick }
      : {}),
    ...(typeof value.radius === "number" && Number.isFinite(value.radius) && value.radius > 0
      ? { radius: value.radius }
      : {}),
    ...(typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0
      ? { height: value.height }
      : {})
  };
}

function sanitizeDeltaSeconds(
  value: number | undefined,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): number {
  if (value === undefined) return 0;
  if (Number.isFinite(value) && value >= 0) return value;
  pushIssue(
    issues,
    "input-rejected",
    "deltaSeconds",
    "finite",
    "root motion deltaSeconds must be finite and non-negative",
    actorId
  );
  return 0;
}

function sanitizeTransformInput(
  value: Transform | undefined,
  issues: RootMotionIssue[],
  field: string,
  actorId: CharacterActorId | undefined
): Transform {
  if (!isRecord(value)) {
    if (value !== undefined)
      pushIssue(issues, "input-rejected", field, "type", "root motion transform must be an object", actorId);
    return identityTransform();
  }
  const translation = sanitizeVec3(value.translation, [0, 0, 0], issues, `${field}.translation`, actorId);
  const rotation = readFiniteQuat(value.rotation);
  if (!rotation)
    pushIssue(issues, "input-rejected", `${field}.rotation`, "finite", "root motion rotation must be finite", actorId);
  const scale = sanitizeVec3(value.scale, [1, 1, 1], issues, `${field}.scale`, actorId);
  return cloneTransform({ translation, rotation: rotation ?? [0, 0, 0, 1], scale });
}

function sanitizeVec3(
  value: unknown,
  fallback: Vec3,
  issues: RootMotionIssue[],
  field: string,
  actorId: CharacterActorId | undefined
): Vec3 {
  const vector = readFiniteVec3(value);
  if (vector) return vector;
  if (value !== undefined)
    pushIssue(issues, "input-rejected", field, "finite", `${field} must be a finite Vec3`, actorId);
  return cloneVec3(fallback);
}

function readFiniteVec3(value: unknown): Vec3 | null {
  if (!isArrayLike(value, 3)) return null;
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function readFiniteQuat(value: unknown): [number, number, number, number] | null {
  if (!isArrayLike(value, 4)) return null;
  const x = value[0];
  const y = value[1];
  const z = value[2];
  const w = value[3];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || typeof w !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) return null;
  return [x, y, z, w];
}

function isArrayLike(value: unknown, length: number): value is ArrayLike<unknown> {
  return (
    typeof value === "object" && value !== null && "length" in value && (value as ArrayLike<unknown>).length === length
  );
}

function sanitizeMode(
  value: unknown,
  fallback: RootMotionAuthorityMode,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): RootMotionAuthorityMode {
  if (value === undefined) return fallback;
  if (value === "physics-driven" || value === "animation-driven" || value === "hybrid") return value;
  pushIssue(issues, "input-rejected", "policy.mode", "enum", "unsupported root motion authority mode", actorId);
  return fallback;
}

function sanitizeDeltaSpace(
  value: unknown,
  fallback: RootMotionDeltaSpace,
  issues: RootMotionIssue[],
  field: string,
  actorId: CharacterActorId | undefined
): RootMotionDeltaSpace {
  if (value === undefined) return fallback;
  if (value === "local" || value === "world") return value;
  pushIssue(issues, "input-rejected", field, "enum", "root motion delta space must be local or world", actorId);
  return fallback;
}

function sanitizeOwner(value: unknown, fallback: RootMotionOwner): RootMotionOwner {
  return value === "none" || value === "controller" || value === "model-root" || value === "external"
    ? value
    : fallback;
}

function sanitizeDoubleApplyPolicy(value: unknown): RootMotionDoubleApplyPolicy {
  return value === "report-only" || value === "allow" || value === "reject" ? value : "reject";
}

function isCarrierSelectionKind(value: unknown): value is RootMotionCarrierSelectionKind {
  return (
    value === "none" ||
    value === "runtime-blend" ||
    value === "layer" ||
    value === "clip" ||
    value === "bone" ||
    value === "metadata"
  );
}

function yawFromRotation(transform: Transform): number {
  const forward = rotateVec3ByQuat(transform.rotation, [0, 0, 1]);
  const planarLength = Math.hypot(forward[0], forward[2]);
  if (!Number.isFinite(planarLength) || planarLength <= EPSILON) return 0;
  return wrapYaw(Math.atan2(forward[0], forward[2]));
}

function limitNoGain(
  value: Vec3,
  requested: Vec3,
  issues: RootMotionIssue[],
  field: string,
  actorId: CharacterActorId | undefined
): Vec3 {
  const requestedLength = lengthVec3(requested);
  const valueLength = lengthVec3(value);
  if (!Number.isFinite(valueLength)) return [0, 0, 0];
  if (!Number.isFinite(requestedLength) || requestedLength <= EPSILON) {
    if (valueLength > EPSILON)
      pushIssue(issues, "bounded", field, "no-gain", "root motion world adapter cannot add displacement", actorId);
    return [0, 0, 0];
  }
  if (valueLength <= requestedLength + EPSILON) return cloneVec3(value);
  pushIssue(
    issues,
    "bounded",
    field,
    "no-gain",
    "root motion world adapter displacement was clamped to requested length",
    actorId
  );
  return scaleVec3(value, requestedLength / valueLength);
}

function limitYawNoGain(
  value: number,
  requested: number,
  issues: RootMotionIssue[],
  actorId: CharacterActorId | undefined
): number {
  const requestedAbs = Math.abs(requested);
  const valueAbs = Math.abs(value);
  if (!Number.isFinite(valueAbs)) return 0;
  if (requestedAbs <= EPSILON) {
    if (valueAbs > EPSILON)
      pushIssue(
        issues,
        "bounded",
        "world.resolveRootMotion.yawDelta",
        "no-gain",
        "root motion world adapter cannot add yaw",
        actorId
      );
    return 0;
  }
  if (valueAbs <= requestedAbs + EPSILON) return wrapYaw(value);
  pushIssue(
    issues,
    "bounded",
    "world.resolveRootMotion.yawDelta",
    "no-gain",
    "root motion world adapter yaw was clamped to requested magnitude",
    actorId
  );
  return Math.sign(value) * requestedAbs;
}

function finitePositiveInRange(value: number | undefined, fallback: number, max: number): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) return Math.min(value, max);
  return fallback;
}

function integerInRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value !== undefined && Number.isInteger(value)) return Math.max(min, Math.min(max, value));
  return fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function finitePriority(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, value));
}

function clamp01Finite(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function cloneMotion(value: RootMotionMotionBreakdown): RootMotionMotionBreakdown {
  return { displacement: cloneVec3(value.displacement), yawDelta: value.yawDelta };
}

function wrapYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let yaw = ((((value + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  if (Object.is(yaw, -0)) yaw = 0;
  return yaw;
}

function pushIssue(
  issues: RootMotionIssue[],
  type: RootMotionIssueType,
  field: string,
  code: string,
  message: string,
  actorId: CharacterActorId | undefined,
  context: Partial<Pick<RootMotionIssue, "token" | "bindingId" | "layerId" | "clipId">> = {}
): void {
  issues.push({
    type,
    field,
    code,
    message,
    ...(actorId !== undefined ? { actorId } : {}),
    ...(context.token !== undefined ? { token: context.token } : {}),
    ...(context.bindingId !== undefined ? { bindingId: context.bindingId } : {}),
    ...(context.layerId !== undefined ? { layerId: context.layerId } : {}),
    ...(context.clipId !== undefined ? { clipId: context.clipId } : {})
  });
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
