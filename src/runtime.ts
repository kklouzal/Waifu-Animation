import { type Mat4 } from "./math.js";
import { type AnimationClip, sampleClipToPose } from "./clip.js";
import { DEFAULT_BLEND_THRESHOLD, type JointMask, type Pose, additiveDeltaPose, applyAdditivePose, blendPoses, clonePose, normalizePose } from "./pose.js";
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

export type RuntimeEvaluation = {
  localPose: Pose;
  modelPose: Mat4[];
  activeLayers: Array<Pick<AnimationLayer, "id" | "time" | "weight" | "targetWeight" | "priority" | "blendMode">>;
};

export class AnimationRuntime {
  readonly skeleton: Skeleton;
  readonly restPose: Pose;
  blendThreshold: number;
  private readonly layers = new Map<string, AnimationLayer>();

  constructor(skeleton: Skeleton, options: AnimationRuntimeOptions = {}) {
    this.skeleton = skeleton;
    this.restPose = createRestPose(skeleton);
    this.blendThreshold = options.blendThreshold ?? DEFAULT_BLEND_THRESHOLD;
  }

  setLayer(id: string, clip: AnimationClip, options: AnimationLayerOptions = {}): AnimationLayer {
    const layer: AnimationLayer = {
      id,
      clip,
      time: options.time ?? 0,
      weight: options.weight ?? 0,
      targetWeight: options.targetWeight ?? options.weight ?? 1,
      fadeSpeed: options.fadeSpeed ?? 8,
      speed: options.speed ?? 1,
      priority: options.priority ?? 0,
      loop: options.loop ?? clip.loop ?? false,
      blendMode: options.blendMode ?? "override",
      ...(options.mask ? { mask: options.mask } : {})
    };
    this.layers.set(id, layer);
    return layer;
  }

  crossfade(id: string, clip: AnimationClip, options: CrossfadeOptions = {}): AnimationLayer {
    const existing = this.layers.get(id);
    const resetTime = options.resetTime ?? !existing;
    const targetWeight = finiteNonNegative(options.targetWeight ?? options.weight ?? 1, 1);
    const fadeSpeed = finiteNonNegative(options.fadeSpeed, 8);
    const priority = options.priority ?? existing?.priority ?? 0;
    const layer: AnimationLayer = {
      id,
      clip,
      time: resetTime ? (options.time ?? 0) : (options.time ?? existing?.time ?? 0),
      weight: resetTime ? finiteNonNegative(options.weight, 0) : finiteNonNegative(existing?.weight ?? options.weight, 0),
      targetWeight,
      fadeSpeed,
      speed: options.speed ?? existing?.speed ?? 1,
      priority,
      loop: options.loop ?? clip.loop ?? existing?.loop ?? false,
      blendMode: options.blendMode ?? "override",
      ...(options.mask ? { mask: options.mask } : existing?.mask ? { mask: existing.mask } : {})
    };
    this.layers.set(id, layer);

    if (options.fadeOutExisting !== false) {
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
    layer.fadeSpeed = fadeSpeed;
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
      layer.time += delta * layer.speed;
      const alpha = 1 - Math.exp(-Math.max(0, layer.fadeSpeed) * delta);
      layer.weight += (layer.targetWeight - layer.weight) * alpha;
      if (layer.targetWeight <= 0 && layer.weight < 0.0005) this.layers.delete(layer.id);
    }
  }

  evaluate(): RuntimeEvaluation {
    const active = Array.from(this.layers.values())
      .filter((layer) => layer.weight > 0.0001)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    const overrideLayers: Array<{ priority: number; pose: Pose; weight: number; mask?: JointMask }> = [];
    const additiveLayers: Array<{ pose: Pose; weight: number; mask?: JointMask }> = [];
    for (const layer of active) {
      const sampled = sampleClipToPose(this.skeleton, layer.clip, layer.time, { loop: layer.loop, restPose: this.restPose });
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
    localPose = normalizePose(localPose);
    return {
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
  }
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
