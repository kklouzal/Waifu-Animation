import { type RandomSource, type Vec3, clamp, clamp01, createSeededRandom, dampValue, finiteNonNegative, normalizeVec3, randomRange, smoothPulse } from "./math.js";

export type LookAtDistribution = {
  eyes: { yaw: number; pitch: number; weight: number };
  head: { yaw: number; pitch: number; weight: number };
  neck: { yaw: number; pitch: number; weight: number };
  spine: { yaw: number; pitch: number; weight: number };
  torso: { yaw: number; pitch: number; weight: number };
};

export type LookAtOptions = {
  maxYaw?: number;
  maxPitch?: number;
  eyeLead?: number;
  headWeight?: number;
  neckWeight?: number;
  spineWeight?: number;
  torsoWeight?: number;
};

function finiteOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function finiteOption01(value: number | undefined, fallback: number): number {
  return clamp01(finiteOption(value, fallback));
}

function finiteAttentionWeight(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isEligibleAttentionTarget(target: AttentionTarget): boolean {
  return finiteAttentionWeight(target.weight) > 0 && target.position.every(Number.isFinite);
}

export function distributeLookAt(localTarget: Vec3, options: LookAtOptions = {}): LookAtDistribution {
  const direction = normalizeVec3(localTarget, [0, 0, 1]);
  const maxYaw = finiteNonNegative(options.maxYaw, 0.85);
  const maxPitch = finiteNonNegative(options.maxPitch, 0.52);
  const yaw = clamp(Math.atan2(direction[0], direction[2]), -maxYaw, maxYaw);
  const pitch = clamp(Math.atan2(direction[1], Math.hypot(direction[0], direction[2])), -maxPitch, maxPitch);
  const eyeLead = finiteOption01(options.eyeLead, 0.42);
  const headWeight = finiteOption01(options.headWeight, 0.42);
  const neckWeight = finiteOption01(options.neckWeight, 0.22);
  const spineWeight = finiteOption01(options.spineWeight, 0.11);
  const torsoWeight = finiteOption01(options.torsoWeight, 0.05);
  return {
    eyes: { yaw: yaw * eyeLead, pitch: pitch * eyeLead, weight: 1 },
    head: { yaw: yaw * headWeight, pitch: pitch * finiteOption01(options.headWeight, 0.46), weight: 1 },
    neck: { yaw: yaw * neckWeight, pitch: pitch * finiteOption01(options.neckWeight, 0.2), weight: 1 },
    spine: { yaw: yaw * spineWeight, pitch: pitch * finiteOption01(options.spineWeight, 0.07), weight: 1 },
    torso: { yaw: yaw * torsoWeight, pitch: pitch * finiteOption01(options.torsoWeight, 0.03), weight: 1 }
  };
}

export type AttentionTarget = {
  id: string;
  position: Vec3;
  weight: number;
};

export class AttentionScheduler {
  private readonly random: RandomSource;
  private nextSwitchAt = 0;
  private currentId: string | null = null;

  constructor(seed: string | number) {
    this.random = createSeededRandom(seed);
  }

  choose(nowMs: number, targets: readonly AttentionTarget[], minDwellMs = 900, maxDwellMs = 3200): AttentionTarget | null {
    if (targets.length === 0) {
      this.currentId = null;
      this.nextSwitchAt = 0;
      return null;
    }
    const now = finiteNonNegative(nowMs, 0);
    const currentTarget = this.currentId
      ? (targets.find((target) => target.id === this.currentId && isEligibleAttentionTarget(target)) ?? null)
      : null;
    if (now >= this.nextSwitchAt || !currentTarget || !isEligibleAttentionTarget(currentTarget)) {
      let maxWeight = 0;
      let lastEligible = -1;
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i]!;
        if (!isEligibleAttentionTarget(target)) continue;
        maxWeight = Math.max(maxWeight, finiteAttentionWeight(target.weight));
        lastEligible = i;
      }
      if (maxWeight <= 0 || lastEligible < 0) {
        this.currentId = null;
        this.nextSwitchAt = 0;
        return null;
      }
      let total = 0;
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i]!;
        if (!isEligibleAttentionTarget(target)) continue;
        total += finiteAttentionWeight(target.weight) / maxWeight;
      }
      let pick = this.random() * total;
      this.currentId = targets[lastEligible]!.id;
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i]!;
        if (!isEligibleAttentionTarget(target)) continue;
        pick -= finiteAttentionWeight(target.weight) / maxWeight;
        if (pick <= 0) {
          this.currentId = target.id;
          break;
        }
      }
      const minDwell = finiteNonNegative(minDwellMs, 900);
      const maxDwell = Math.max(minDwell, finiteNonNegative(maxDwellMs, 3200));
      this.nextSwitchAt = now + randomRange(this.random, minDwell, maxDwell);
      return targets.find((target) => target.id === this.currentId && isEligibleAttentionTarget(target)) ?? null;
    }
    return currentTarget;
  }
}

export function breathingWeight(elapsedSeconds: number, energy: number): number {
  const elapsed = finiteNonNegative(elapsedSeconds, 0);
  return Math.sin(elapsed * (1.15 + clamp01(energy) * 0.55)) * (0.5 + clamp01(energy) * 0.5);
}

export type PresenceState = "idle" | "listening" | "speaking" | "thinking";
export type PresenceGesture = "idle" | "explain" | "emphasize" | "nod" | "thinking" | "wave" | "shrug";
export type PresenceGaze = "camera" | "audience" | "down" | "left" | "right";

export type PresenceBehavior = {
  state?: PresenceState;
  energy?: number;
  gesture?: PresenceGesture;
  gaze?: PresenceGaze;
};

export type PresenceAffect = {
  mood?: "neutral" | "warm" | "playful" | "focused" | "concerned" | "sleepy";
  arousal?: number;
  rapport?: number;
  curiosity?: number;
  attentiveness?: number;
};

export type PresenceCueKind =
  | "beat"
  | "blink"
  | "glance"
  | "lookCamera"
  | "nod"
  | "settle"
  | "smile"
  | "shrug"
  | "thinkingPulse";

export type PresenceCue = {
  kind: PresenceCueKind;
  startMs: number;
  durationMs: number;
  intensity: number;
  gaze?: PresenceGaze;
};

export type PresenceCueAmounts = Record<PresenceCueKind, number>;

export type PresenceBoneName =
  | "hips"
  | "spine"
  | "chest"
  | "upperChest"
  | "neck"
  | "head"
  | "leftShoulder"
  | "rightShoulder"
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand";

export type PresenceBoneTarget = {
  bone: PresenceBoneName;
  rotation: Vec3;
  influence: number;
  speed: number;
};

type PresenceArmSideInput = {
  lead: number;
  gesture: number;
  beat: number;
  shrug: number;
  shoulderLift: number;
  armTarget: number;
};

export type PresenceUpdateInput = {
  nowMs: number;
  elapsedSeconds: number;
  deltaSeconds: number;
  behavior?: PresenceBehavior;
  affect?: PresenceAffect;
  targetMouth?: number;
  speakingUntilMs?: number;
  clipBaseInfluence?: number;
  clipOverlayInfluence?: number;
};

export type PresenceFrame = {
  cueAmounts: PresenceCueAmounts;
  lookAtTarget: Vec3;
  activeGaze: PresenceGaze;
  boneTargets: PresenceBoneTarget[];
  motion: {
    breath: number;
    headYaw: number;
    headPitch: number;
    speechPulse: number;
    idleShiftX: number;
    idleShiftZ: number;
    attentionOffsetX: number;
    attentionOffsetY: number;
    weightShift: number;
    alivePhase: number;
  };
};

const CUE_KINDS: PresenceCueKind[] = ["beat", "blink", "glance", "lookCamera", "nod", "settle", "smile", "shrug", "thinkingPulse"];

const DEFAULT_BEHAVIOR: Required<PresenceBehavior> = {
  state: "idle",
  energy: 0.35,
  gesture: "idle",
  gaze: "camera"
};

const DEFAULT_AFFECT: Required<PresenceAffect> = {
  mood: "neutral",
  arousal: 0.36,
  rapport: 0.24,
  curiosity: 0.48,
  attentiveness: 0.78
};

function emptyCueAmounts(): PresenceCueAmounts {
  return {
    beat: 0,
    blink: 0,
    glance: 0,
    lookCamera: 0,
    nod: 0,
    settle: 0,
    smile: 0,
    shrug: 0,
    thinkingPulse: 0
  };
}

function normalizeBehavior(value: PresenceBehavior | undefined): Required<PresenceBehavior> {
  return {
    state: value?.state ?? DEFAULT_BEHAVIOR.state,
    energy: clamp01(value?.energy ?? DEFAULT_BEHAVIOR.energy),
    gesture: value?.gesture ?? DEFAULT_BEHAVIOR.gesture,
    gaze: value?.gaze ?? DEFAULT_BEHAVIOR.gaze
  };
}

function normalizeAffect(value: PresenceAffect | undefined): Required<PresenceAffect> {
  return {
    mood: value?.mood ?? DEFAULT_AFFECT.mood,
    arousal: clamp01(value?.arousal ?? DEFAULT_AFFECT.arousal),
    rapport: clamp01(value?.rapport ?? DEFAULT_AFFECT.rapport),
    curiosity: clamp01(value?.curiosity ?? DEFAULT_AFFECT.curiosity),
    attentiveness: clamp01(value?.attentiveness ?? DEFAULT_AFFECT.attentiveness)
  };
}

function mixTarget(rest: number, gesture: number, amount: number): number {
  return rest + (gesture - rest) * clamp01(amount);
}

function gestureAmount(behavior: Required<PresenceBehavior>, name: PresenceGesture): number {
  return behavior.gesture === name ? 1 : 0;
}

function pushTarget(targets: PresenceBoneTarget[], bone: PresenceBoneName, x: number, y: number, z: number, influence: number, speed: number): void {
  targets.push({ bone, rotation: [x, y, z], influence: clamp01(influence), speed });
}

function pushArmTargets(targets: PresenceBoneTarget[], side: "left" | "right", input: PresenceArmSideInput): void {
  const { lead, gesture, beat, shrug, shoulderLift, armTarget } = input;
  if (side === "left") {
    pushTarget(targets, "leftShoulder", 0.02 + shoulderLift, -shrug * 0.04, mixTarget(-0.05, -0.18, lead) + shrug * 0.08, armTarget, 5.5);
    pushTarget(targets, "leftUpperArm", mixTarget(0.04, 0.34 + beat + shrug * 0.16, gesture), 0.04 + shrug * 0.08, mixTarget(1.15, 0.58, gesture), armTarget, 5.8);
    pushTarget(targets, "leftLowerArm", mixTarget(0.18, 0.72 + beat + shrug * 0.12, gesture), 0.04 + shrug * 0.12, mixTarget(-0.18, -0.52, gesture), armTarget, 5.8);
    pushTarget(targets, "leftHand", mixTarget(0.06, -0.02 - shrug * 0.1, gesture), shrug * 0.12, mixTarget(-0.08, -0.24, gesture), armTarget, 6.2);
    return;
  }

  pushTarget(targets, "rightShoulder", 0.02 + shoulderLift, shrug * 0.04, mixTarget(0.05, 0.2, lead) - shrug * 0.08, armTarget, 5.5);
  pushTarget(targets, "rightUpperArm", mixTarget(0.08, 0.48 + beat + shrug * 0.18, gesture), mixTarget(-0.06, -0.18 - shrug * 0.08, gesture), mixTarget(-1.15, -0.5, gesture), armTarget, 5.8);
  pushTarget(targets, "rightLowerArm", mixTarget(0.18, 0.92 + beat + shrug * 0.14, gesture), -0.04 - shrug * 0.12, mixTarget(0.18, 0.46, gesture), armTarget, 5.8);
  pushTarget(targets, "rightHand", mixTarget(0.06, -0.04 - shrug * 0.1, gesture), -shrug * 0.12, mixTarget(0.08, 0.28, gesture), armTarget, 6.2);
}

export class PresencePlanner {
  private readonly random: RandomSource;
  private readonly aliveSeed: number;
  private nextIdleShiftAt: number;
  private nextBackchannelAt: number;
  private nextSaccadeAt: number;
  private idleShiftX = 0;
  private idleShiftZ = 0;
  private attentionOffsetX = 0;
  private attentionOffsetY = 0;
  private attentionGaze: PresenceGaze | null = null;
  private attentionGazeUntil = 0;
  private cueAmounts = emptyCueAmounts();
  private cues: PresenceCue[] = [];

  constructor(seed: string | number, nowMs = 0) {
    this.random = createSeededRandom(seed);
    this.aliveSeed = randomRange(this.random, 0, 1000);
    const now = finiteNonNegative(nowMs, 0);
    this.nextIdleShiftAt = now + 1200;
    this.nextBackchannelAt = now + 3200;
    this.nextSaccadeAt = now + 700;
  }

  scheduleCue(kind: PresenceCueKind, nowMs: number, delayMs: number, durationMs: number, intensity = 1, gaze?: PresenceGaze): void {
    const now = finiteNonNegative(nowMs, 0);
    const delay = finiteNonNegative(delayMs, 0);
    const duration = Math.max(1, finiteNonNegative(durationMs, 1));
    const cue: PresenceCue = {
      kind,
      startMs: now + delay,
      durationMs: duration,
      intensity: clamp01(intensity)
    };
    if (gaze) cue.gaze = gaze;
    this.cues.push(cue);
  }

  scheduleSpeechPerformance(text: string, durationMs: number, nowMs: number, affectInput?: PresenceAffect): void {
    const affect = normalizeAffect(affectInput);
    const now = finiteNonNegative(nowMs, 0);
    const duration = finiteNonNegative(durationMs, 0);
    const words = text.trim().split(/\s+/).filter(Boolean);
    const beatCount = Math.min(12, Math.max(3, Math.ceil(words.length / 4)));
    this.scheduleCue("lookCamera", now, 80, Math.min(900, duration * 0.22), 0.8, "camera");
    this.scheduleCue("blink", now, Math.min(420, duration * 0.18), 140, 0.8);
    this.scheduleCue("smile", now, Math.max(180, duration * 0.08), Math.min(1800, duration * 0.46), 0.2 + affect.rapport * 0.32);
    this.scheduleCue("nod", now, 140, 420, 0.35 + affect.attentiveness * 0.24);

    for (let i = 0; i < beatCount; i += 1) {
      const t = ((i + 0.55) / (beatCount + 0.45)) * duration;
      const strong = i % 3 === 1 ? 1 : 0.64;
      this.scheduleCue(i % 3 === 2 ? "nod" : "beat", now, t, 260 + strong * 120, strong);
      if (i > 0 && i % 4 === 0) {
        this.scheduleCue("glance", now, Math.max(0, t - 140), 520, 0.48, i % 2 === 0 ? "left" : "right");
        this.scheduleCue("lookCamera", now, t + 340, 620, 0.64, "camera");
      }
    }

    this.scheduleCue("settle", now, duration + 80, 900, 0.75);
  }

  onBehaviorChange(behaviorInput: PresenceBehavior, affectInput: PresenceAffect | undefined, nowMs: number): void {
    const behavior = normalizeBehavior(behaviorInput);
    const affect = normalizeAffect(affectInput);
    const now = finiteNonNegative(nowMs, 0);
    if (behavior.state === "thinking") {
      this.scheduleCue("thinkingPulse", now, 0, 1400, 0.65);
      this.scheduleCue("glance", now, 120, 900, 0.7, "down");
    }
    if (behavior.gesture === "shrug") {
      this.scheduleCue("shrug", now, 0, 980, 0.86);
      this.scheduleCue("glance", now, 120, 620, 0.34, this.random() < 0.5 ? "left" : "right");
      this.scheduleCue("lookCamera", now, 760, 620, 0.48, "camera");
    }
    if (behavior.state === "listening") {
      this.nextBackchannelAt = now + randomRange(this.random, 900, 2300) - affect.attentiveness * 120;
    }
  }

  update(input: PresenceUpdateInput): PresenceFrame {
    const nowMs = finiteNonNegative(input.nowMs, 0);
    const elapsedSeconds = finiteNonNegative(input.elapsedSeconds, 0);
    const deltaSeconds = finiteNonNegative(input.deltaSeconds, 0);
    const behavior = normalizeBehavior(input.behavior);
    const affect = normalizeAffect(input.affect);
    const energy = behavior.energy;
    const targetMouth = clamp01(input.targetMouth ?? 0);
    const speaking = behavior.state === "speaking" || nowMs < (input.speakingUntilMs ?? 0);

    this.cues = this.cues.filter((cue) => nowMs < cue.startMs + cue.durationMs + 120);
    const targets = emptyCueAmounts();
    for (const cue of this.cues) {
      const target = smoothPulse((nowMs - cue.startMs) / cue.durationMs) * cue.intensity;
      targets[cue.kind] = Math.max(targets[cue.kind], target);
    }
    for (const kind of CUE_KINDS) {
      const speed = kind === "beat" ? 14 : kind === "nod" ? 12 : kind === "smile" ? 8 : kind === "shrug" ? 7 : 5;
      this.cueAmounts[kind] = clamp01(dampValue(this.cueAmounts[kind], targets[kind], speed, deltaSeconds));
    }

    const gazeCue = this.cues.find(
      (cue) => (cue.kind === "glance" || cue.kind === "lookCamera") && cue.gaze && nowMs >= cue.startMs && nowMs <= cue.startMs + cue.durationMs
    );
    if (gazeCue?.gaze) {
      this.attentionGaze = gazeCue.gaze;
      this.attentionGazeUntil = gazeCue.startMs + gazeCue.durationMs;
    } else if (nowMs > this.attentionGazeUntil) {
      this.attentionGaze = null;
    }

    if (nowMs >= this.nextIdleShiftAt) {
      const liveliness = 0.42 + affect.arousal * 0.48 + affect.curiosity * 0.24;
      this.idleShiftX = (this.random() - 0.5) * 0.085 * liveliness;
      this.idleShiftZ = (this.random() - 0.5) * 0.072 * liveliness;
      this.nextIdleShiftAt = nowMs + randomRange(this.random, 760, 2360);
    }

    if (nowMs >= this.nextSaccadeAt) {
      const scope = behavior.state === "speaking" ? 0.045 : 0.075 + affect.curiosity * 0.055;
      this.attentionOffsetX = (this.random() - 0.5) * scope;
      this.attentionOffsetY = (this.random() - 0.5) * scope * 0.58;
      this.nextSaccadeAt = nowMs + 520 + this.random() * (behavior.state === "thinking" ? 1050 : 2100);
    }

    this.idleShiftX = dampValue(this.idleShiftX, 0, 0.7, deltaSeconds);
    this.idleShiftZ = dampValue(this.idleShiftZ, 0, 0.7, deltaSeconds);
    this.attentionOffsetX = dampValue(this.attentionOffsetX, 0, 1.6, deltaSeconds);
    this.attentionOffsetY = dampValue(this.attentionOffsetY, 0, 1.6, deltaSeconds);

    if ((behavior.state === "listening" || behavior.state === "idle") && nowMs >= this.nextBackchannelAt) {
      this.scheduleBackchannel(nowMs, affect);
      this.nextBackchannelAt = nowMs + 2100 + this.random() * 3600 - affect.attentiveness * 700;
    }

    const cueAmounts = { ...this.cueAmounts };
    const motion = this.computeMotion(elapsedSeconds, behavior, affect, cueAmounts, speaking, targetMouth);
    return {
      cueAmounts,
      lookAtTarget: this.gazeTarget(elapsedSeconds, energy, affect, behavior),
      activeGaze: this.attentionGaze ?? behavior.gaze,
      boneTargets: this.computeBoneTargets(elapsedSeconds, behavior, affect, cueAmounts, motion, input),
      motion
    };
  }

  private scheduleBackchannel(nowMs: number, affect: Required<PresenceAffect>): void {
    const warm = affect.mood === "warm" || affect.mood === "playful" ? 0.22 : 0;
    this.scheduleCue("nod", nowMs, 0, 380, 0.45 + affect.attentiveness * 0.28);
    this.scheduleCue("smile", nowMs, 80, 820, warm + affect.rapport * 0.24);
    if (this.random() < 0.62 + affect.curiosity * 0.22) {
      this.scheduleCue("glance", nowMs, 180, 600, 0.42, this.random() < 0.5 ? "left" : "right");
      this.scheduleCue("lookCamera", nowMs, 720, 620, 0.58, "camera");
    }
  }

  private computeMotion(
    elapsedSeconds: number,
    behavior: Required<PresenceBehavior>,
    affect: Required<PresenceAffect>,
    cueAmounts: PresenceCueAmounts,
    speaking: boolean,
    targetMouth: number
  ): PresenceFrame["motion"] {
    const energy = behavior.energy;
    const speechPulse = speaking ? clamp01(Math.max(cueAmounts.beat, targetMouth * 0.9, cueAmounts.nod * 0.35)) : 0;
    const weightShift = Math.sin(elapsedSeconds * 0.55 + this.aliveSeed) * (0.024 + energy * 0.02) + this.idleShiftZ;
    return {
      breath: Math.sin(elapsedSeconds * (1.4 + energy * 0.6)) * (0.012 + energy * 0.01),
      headYaw: Math.sin(elapsedSeconds * 0.42) * (0.025 + energy * 0.035),
      headPitch: Math.sin(elapsedSeconds * 0.63 + 1.4) * (0.018 + energy * 0.025),
      speechPulse,
      idleShiftX: this.idleShiftX,
      idleShiftZ: this.idleShiftZ,
      attentionOffsetX: this.attentionOffsetX,
      attentionOffsetY: this.attentionOffsetY,
      weightShift,
      alivePhase: this.aliveSeed
    };
  }

  private gazeTarget(elapsedSeconds: number, energy: number, affect: Required<PresenceAffect>, behavior: Required<PresenceBehavior>): Vec3 {
    const live = 0.45 + affect.attentiveness * 0.35 + affect.curiosity * 0.2;
    const driftX =
      Math.sin(elapsedSeconds * 0.37 + this.aliveSeed) * (0.1 + energy * 0.08) +
      Math.sin(elapsedSeconds * 1.7 + this.aliveSeed * 0.3) * 0.018 * live +
      this.attentionOffsetX;
    const driftY =
      Math.sin(elapsedSeconds * 0.51 + 0.9 + this.aliveSeed) * 0.052 +
      Math.sin(elapsedSeconds * 1.3 + this.aliveSeed * 0.7) * 0.014 * live +
      this.attentionOffsetY;
    switch (this.attentionGaze ?? behavior.gaze) {
      case "left":
        return [-0.45 + driftX * 0.35, 1.47 + driftY, 2.55];
      case "right":
        return [0.45 + driftX * 0.35, 1.47 + driftY, 2.55];
      case "down":
        return [driftX * 0.35, 1.24 + driftY * 0.5, 2.45];
      case "audience":
        return [driftX * 1.35, 1.48 + driftY, 2.65];
      case "camera":
      default:
        return [driftX, 1.48 + driftY, 2.6];
    }
  }

  private computeBoneTargets(
    elapsedSeconds: number,
    behavior: Required<PresenceBehavior>,
    affect: Required<PresenceAffect>,
    cueAmounts: PresenceCueAmounts,
    motion: PresenceFrame["motion"],
    input: PresenceUpdateInput
  ): PresenceBoneTarget[] {
    const targets: PresenceBoneTarget[] = [];
    const listen = behavior.state === "listening" || behavior.state === "idle" ? 1 : 0;
    const tinyAsymmetry = Math.sin(elapsedSeconds * 1.17 + this.aliveSeed) * (0.006 + affect.arousal * 0.006);
    const nod = Math.max(gestureAmount(behavior, "nod") * 0.65, cueAmounts.nod, motion.speechPulse > 0 ? 0.1 + motion.speechPulse * 0.12 : 0);
    const nodMotion = Math.sin(elapsedSeconds * 7.2) * (0.055 + cueAmounts.nod * 0.075) * nod;
    const attentionLean = listen * (0.014 + affect.attentiveness * 0.018) + (motion.speechPulse > 0 ? 0.01 + motion.speechPulse * 0.018 : 0);
    const baseInfluence = clamp01(input.clipBaseInfluence ?? 0);
    const overlayInfluence = clamp01(input.clipOverlayInfluence ?? 0);
    const baseDucking = (1 - baseInfluence) * (1 - baseInfluence);
    const bodyDucking = Math.min(1 - overlayInfluence * 0.55, baseDucking);
    const headDucking = 1 - overlayInfluence * 0.25;
    const bodyTarget = (0.08 + listen * 0.05 + motion.speechPulse * 0.04) * bodyDucking;
    const headTarget = (0.18 + affect.attentiveness * 0.08 + motion.speechPulse * 0.08) * headDucking;
    const affectLift = (affect.arousal - 0.35) * 0.16;
    const explain = clamp01(Math.max(gestureAmount(behavior, "explain"), behavior.state === "speaking" ? 0.35 + motion.speechPulse * 0.65 : 0));
    const emphasize = clamp01(Math.max(gestureAmount(behavior, "emphasize"), cueAmounts.beat * 0.74));
    const conversationalGesture = clamp01(Math.max(explain, emphasize * 0.82));
    const shrug = clamp01(Math.max(cueAmounts.shrug, gestureAmount(behavior, "shrug") * 0.24));
    const shoulderLift = shrug * (0.14 + Math.sin(elapsedSeconds * 5.6 + this.aliveSeed) * 0.012);
    const armOverlayDucking = 1 - overlayInfluence * 0.98;
    const armTarget = 0.55 * baseDucking * armOverlayDucking;
    const rightLead = clamp01(conversationalGesture * (0.72 + Math.sin(elapsedSeconds * 3.8 + this.aliveSeed) * 0.08));
    const leftLead = clamp01(conversationalGesture * (0.44 + Math.sin(elapsedSeconds * 3.2 + this.aliveSeed + 1.2) * 0.06));
    const rightGesture = clamp01(Math.max(rightLead, shrug * 0.52));
    const leftGesture = clamp01(Math.max(leftLead, shrug * 0.52));
    const rightBeat = cueAmounts.beat * conversationalGesture * 0.18;
    const leftBeat = cueAmounts.beat * conversationalGesture * 0.12;

    pushTarget(targets, "hips", 0, motion.idleShiftX * 0.08, motion.weightShift * 0.3, bodyTarget * 0.45, 2.8);
    pushTarget(targets, "spine", motion.breath * 0.34 + attentionLean * 0.18, motion.idleShiftX * 0.13, -motion.weightShift * 0.16 + tinyAsymmetry, bodyTarget, 3.1);
    pushTarget(
      targets,
      "chest",
      motion.breath * 0.42 + affectLift * 0.42 + attentionLean * 0.32 + shoulderLift * 0.22,
      motion.idleShiftX * 0.08,
      motion.weightShift * 0.2 - tinyAsymmetry,
      bodyTarget,
      3.2
    );
    pushTarget(targets, "upperChest", motion.breath * 0.28 + affectLift * 0.24 + shoulderLift * 0.28, motion.idleShiftX * 0.04, motion.weightShift * 0.12, bodyTarget * 0.75, 3.3);
    pushTarget(targets, "neck", motion.headPitch * 0.16 + nodMotion * 0.24, motion.headYaw * 0.16, -motion.weightShift * 0.12, headTarget * 0.72, 3.8);
    pushTarget(targets, "head", motion.headPitch * 0.46 + nodMotion * 0.58, motion.headYaw * 0.42 + motion.idleShiftX * 0.08, motion.weightShift * 0.1, headTarget, 4.2);
    pushArmTargets(targets, "left", { lead: leftLead, gesture: leftGesture, beat: leftBeat, shrug, shoulderLift, armTarget });
    pushArmTargets(targets, "right", { lead: rightLead, gesture: rightGesture, beat: rightBeat, shrug, shoulderLift, armTarget });

    return targets;
  }
}
