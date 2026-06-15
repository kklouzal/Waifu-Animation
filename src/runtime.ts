import { type Mat4, dampAlpha, finiteNonNegative, finiteSigned } from "./math.js";
import { type AnimationClip, type ClipValidationIssue, type SampleRepairDiagnostic, resolveTrackJointIndex, sampleClipToPose, validateClip } from "./clip.js";
import {
  type JointMask,
  type Pose,
  type PoseValidationIssue,
  additiveDeltaPose,
  applyAdditivePose,
  blendPoses,
  clonePose,
  normalizePose,
  sanitizeBlendThreshold,
  validatePose
} from "./pose.js";
import { type Skeleton, createRestPose, localToModelPose } from "./skeleton.js";

export type LayerBlendMode = "override" | "additive";

export type AnimationLayer = {
  id: string;
  clip: AnimationClip;
  time: number;
  weight: number;
  targetWeight: number;
  fadeSpeed: number;
  speed: number;
  priority: number;
  loop: boolean;
  blendMode: LayerBlendMode;
  mask?: JointMask;
};

export type AnimationLayerOptions = Partial<Omit<AnimationLayer, "id" | "clip" | "time">> & {
  time?: number;
};

export type CrossfadeOptions = AnimationLayerOptions & {
  /** Reset the target layer's time and current weight before fading in. Defaults to true for new layers and false when replacing the same id. */
  resetTime?: boolean;
  /** Optional source override layer ids to fade out. Defaults to all same-priority override layers except the target. */
  fromIds?: readonly string[];
  /** Override layer ids to keep active even when they match the crossfade scope. */
  excludeIds?: readonly string[];
  /** Disable automatic fade-out of matching source override layers. */
  fadeOutExisting?: boolean;
};

export type AnimationRuntimeOptions = {
  /** Ozz-style rest-pose fallback threshold for override blending. */
  blendThreshold?: number;
};

export type RuntimeEvaluateOptions = {
  /** Collect pose validation diagnostics for sampled layers and the composed local pose. */
  diagnostics?: boolean;
};

export type RuntimeEvaluationDiagnostic = PoseValidationIssue & {
  stage: "sample" | "final";
  layerId?: string;
  clipId?: string;
  track?: number;
  sample?: number;
  property?: string;
};

export type RuntimeEvaluation = {
  localPose: Pose;
  modelPose: Mat4[];
  activeLayers: Array<Pick<AnimationLayer, "id" | "time" | "weight" | "targetWeight" | "priority" | "blendMode">>;
  diagnostics?: RuntimeEvaluationDiagnostic[];
};

export class AnimationRuntime {
  readonly skeleton: Skeleton;
  readonly restPose: Pose;
  blendThreshold: number;
  private readonly layers = new Map<string, AnimationLayer>();

  constructor(skeleton: Skeleton, options: AnimationRuntimeOptions = {}) {
    this.skeleton = skeleton;
    this.restPose = createRestPose(skeleton);
    this.blendThreshold = sanitizeBlendThreshold(options.blendThreshold);
  }

  setLayer(id: string, clip: AnimationClip, options: AnimationLayerOptions = {}): AnimationLayer {
    const blendMode = options.blendMode ?? "override";
    const layer: AnimationLayer = {
      id,
      clip,
      time: finiteNonNegative(options.time, 0),
      weight: sanitizeLayerWeight(blendMode, options.weight, 0),
      targetWeight: sanitizeLayerWeight(blendMode, options.targetWeight ?? options.weight, 1),
      fadeSpeed: finiteNonNegative(options.fadeSpeed, 8),
      speed: finiteNonNegative(options.speed, 1),
      priority: finiteNonNegative(options.priority, 0),
      loop: options.loop ?? clip.loop ?? false,
      blendMode,
      ...(options.mask ? { mask: options.mask } : {})
    };
    this.layers.set(id, layer);
    return layer;
  }

  crossfade(id: string, clip: AnimationClip, options: CrossfadeOptions = {}): AnimationLayer {
    const existing = this.layers.get(id);
    const resetTime = options.resetTime ?? !existing;
    const blendMode = options.blendMode ?? "override";
    const targetWeight = sanitizeLayerWeight(blendMode, options.targetWeight ?? options.weight ?? 1, 1);
    const fadeSpeed = finiteNonNegative(options.fadeSpeed, 8);
    const priority = finiteNonNegative(options.priority ?? existing?.priority, 0);
    const layer: AnimationLayer = {
      id,
      clip,
      time: finiteNonNegative(resetTime ? options.time : (options.time ?? existing?.time), 0),
      weight: resetTime ? sanitizeLayerWeight(blendMode, options.weight, 0) : sanitizeLayerWeight(blendMode, existing?.weight ?? options.weight, 0),
      targetWeight,
      fadeSpeed,
      speed: finiteNonNegative(options.speed ?? existing?.speed, 1),
      priority,
      loop: options.loop ?? clip.loop ?? existing?.loop ?? false,
      blendMode,
      ...(options.mask ? { mask: options.mask } : existing?.mask ? { mask: existing.mask } : {})
    };
    this.layers.set(id, layer);

    if (blendMode === "override" && options.fadeOutExisting !== false) {
      const fromIds = options.fromIds ? new Set(options.fromIds) : undefined;
      const excludeIds = new Set([id, ...(options.excludeIds ?? [])]);
      for (const source of this.layers.values()) {
        if (excludeIds.has(source.id)) continue;
        if (source.blendMode !== "override") continue;
        if (source.priority !== priority) continue;
        if (fromIds && !fromIds.has(source.id)) continue;
        source.targetWeight = 0;
        source.fadeSpeed = fadeSpeed;
      }
    }

    return layer;
  }

  fadeOut(id: string, fadeSpeed = 8): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.targetWeight = 0;
    layer.fadeSpeed = finiteNonNegative(fadeSpeed, 8);
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  clear(): void {
    this.layers.clear();
  }

  update(deltaSeconds: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    for (const layer of this.layers.values()) {
      sanitizeLayerState(layer);
      layer.time += delta * layer.speed;
      const alpha = dampAlpha(layer.fadeSpeed, delta);
      layer.weight += (layer.targetWeight - layer.weight) * alpha;
      if (layer.targetWeight === 0 && Math.abs(layer.weight) < 0.0005) this.layers.delete(layer.id);
    }
  }

  evaluate(options: RuntimeEvaluateOptions = {}): RuntimeEvaluation {
    const diagnostics = options.diagnostics ? [] as RuntimeEvaluationDiagnostic[] : undefined;
    const active = Array.from(this.layers.values())
      .map((layer) => sanitizeLayerState(layer))
      .filter((layer) => isLayerActive(layer))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    const overrideLayers: Array<{ priority: number; pose: Pose; weight: number; mask?: JointMask }> = [];
    const additiveLayers: Array<{ pose: Pose; weight: number; mask?: JointMask }> = [];
    for (const layer of active) {
      const sampleDiagnostics = diagnostics ? [] as SampleRepairDiagnostic[] : undefined;
      if (diagnostics) pushClipDiagnostics(diagnostics, validateClip(layer.clip, this.skeleton), layer, this.skeleton);
      const sampleOptions = sampleDiagnostics
        ? { loop: layer.loop, restPose: this.restPose, diagnostics: sampleDiagnostics, skipUnsupportedTracks: true }
        : { loop: layer.loop, restPose: this.restPose, skipUnsupportedTracks: true };
      const sampled = sampleClipToPose(this.skeleton, layer.clip, layer.time, sampleOptions);
      if (diagnostics) {
        pushSampleRepairDiagnostics(diagnostics, sampleDiagnostics ?? [], layer);
        pushPoseDiagnostics(diagnostics, validatePose(this.skeleton, sampled), {
          stage: "sample",
          layerId: layer.id,
          clipId: layer.clip.id
        });
      }
      if (layer.blendMode === "additive") additiveLayers.push({ pose: sampled, weight: layer.weight, ...(layer.mask ? { mask: layer.mask } : {}) });
      else overrideLayers.push({ priority: layer.priority, pose: sampled, weight: layer.weight, ...(layer.mask ? { mask: layer.mask } : {}) });
    }

    let localPose = clonePose(this.restPose);
    for (let index = 0; index < overrideLayers.length; ) {
      const priority = overrideLayers[index]!.priority;
      const group: Array<{ pose: Pose; weight: number; mask?: JointMask }> = [];
      while (index < overrideLayers.length && overrideLayers[index]!.priority === priority) {
        const layer = overrideLayers[index]!;
        group.push({ pose: layer.pose, weight: layer.weight, ...(layer.mask ? { mask: layer.mask } : {}) });
        index += 1;
      }
      localPose = blendPoses(this.skeleton, group, { threshold: this.blendThreshold, fallbackPose: localPose });
    }
    for (const additive of additiveLayers) {
      const deltaPose = additiveDeltaPose(this.restPose, additive.pose);
      localPose = applyAdditivePose(localPose, deltaPose, additive.weight, additive.mask);
    }
    if (diagnostics) pushPoseDiagnostics(diagnostics, validatePose(this.skeleton, localPose), { stage: "final" });
    localPose = normalizePose(localPose);
    const evaluation: RuntimeEvaluation = {
      localPose,
      modelPose: localToModelPose(this.skeleton, localPose),
      activeLayers: active.map((layer) => ({
        id: layer.id,
        time: layer.time,
        weight: layer.weight,
        targetWeight: layer.targetWeight,
        priority: layer.priority,
        blendMode: layer.blendMode
      }))
    };
    if (diagnostics) evaluation.diagnostics = diagnostics;
    return evaluation;
  }
}

function sanitizeLayerWeight(blendMode: LayerBlendMode, value: number | undefined, fallback: number): number {
  return blendMode === "additive" ? finiteSigned(value, fallback) : finiteNonNegative(value, fallback);
}

function sanitizeLayerState(layer: AnimationLayer): AnimationLayer {
  layer.time = finiteNonNegative(layer.time, 0);
  layer.weight = sanitizeLayerWeight(layer.blendMode, layer.weight, 0);
  layer.targetWeight = sanitizeLayerWeight(layer.blendMode, layer.targetWeight, 0);
  layer.fadeSpeed = finiteNonNegative(layer.fadeSpeed, 0);
  layer.speed = finiteNonNegative(layer.speed, 0);
  layer.priority = finiteNonNegative(layer.priority, 0);
  return layer;
}

function isLayerActive(layer: AnimationLayer): boolean {
  return layer.blendMode === "additive" ? Math.abs(layer.weight) > 0.0001 : layer.weight > 0.0001;
}

function pushPoseDiagnostics(
  diagnostics: RuntimeEvaluationDiagnostic[],
  issues: PoseValidationIssue[],
  context: Pick<RuntimeEvaluationDiagnostic, "stage" | "layerId" | "clipId">
): void {
  for (const issue of issues) {
    diagnostics.push({ ...issue, ...context });
  }
}

function pushClipDiagnostics(diagnostics: RuntimeEvaluationDiagnostic[], issues: ClipValidationIssue[], layer: AnimationLayer, skeleton: Skeleton): void {
  for (const issue of issues) {
    const track = issue.track !== undefined ? layer.clip.tracks[issue.track] : undefined;
    const index = track ? resolveTrackJointIndex(skeleton, track) : -1;
    diagnostics.push({
      stage: "sample",
      layerId: layer.id,
      clipId: layer.clip.id,
      ...(issue.track !== undefined ? { track: issue.track } : {}),
      ...(issue.property !== undefined ? { property: issue.property } : {}),
      joint: issue.joint ?? track?.joint ?? track?.humanBone ?? "<clip>",
      index,
      message: issue.message
    });
  }
}

function pushSampleRepairDiagnostics(diagnostics: RuntimeEvaluationDiagnostic[], issues: SampleRepairDiagnostic[], layer: AnimationLayer): void {
  for (const issue of issues) {
    diagnostics.push({
      stage: "sample",
      layerId: layer.id,
      clipId: layer.clip.id,
      ...(issue.track !== undefined ? { track: issue.track } : {}),
      ...(issue.sample !== undefined ? { sample: issue.sample } : {}),
      joint: issue.joint ?? "<clip>",
      index: issue.index ?? -1,
      message: issue.message
    });
  }
}
