import { type RandomSource, clamp01, createSeededRandom, dampAlpha, randomRange } from "./math.js";

export const VISEME_NAMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type VisemeName = (typeof VISEME_NAMES)[number];
export type VisemeWeights = Record<VisemeName, number>;

export type VisemeMixerOptions = {
  attack?: VisemeSpeed;
  release?: VisemeSpeed;
  maxTotal?: number;
  intensity?: number;
};

export type VisemeSpeed = number | Partial<Record<VisemeName, number>>;

export function zeroVisemes(): VisemeWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

export function limitVisemeStack(values: VisemeWeights, maxTotal: number): VisemeWeights {
  const safeMaxTotal = finiteNonNegative(maxTotal, 0);
  const total = VISEME_NAMES.reduce((sum, name) => sum + values[name], 0);
  if (total <= safeMaxTotal || total <= 0) return { ...values };
  const scale = safeMaxTotal / total;
  return {
    aa: values.aa * scale,
    ih: values.ih * scale,
    ou: values.ou * scale,
    ee: values.ee * scale,
    oh: values.oh * scale
  };
}

export class VisemeMixer {
  readonly current: VisemeWeights = zeroVisemes();
  readonly target: VisemeWeights = zeroVisemes();
  attack: VisemeSpeed;
  release: VisemeSpeed;
  maxTotal: number;
  intensity: number;

  constructor(options: VisemeMixerOptions = {}) {
    this.attack = options.attack ?? 30;
    this.release = options.release ?? 20;
    this.maxTotal = finiteNonNegative(options.maxTotal, 0.36);
    this.intensity = finiteNonNegative(options.intensity, 1);
  }

  setTarget(next: Partial<VisemeWeights>): void {
    for (const name of VISEME_NAMES) this.target[name] = clamp01(next[name] ?? 0) * this.intensity;
    Object.assign(this.target, limitVisemeStack(this.target, this.maxTotal));
  }

  reset(): void {
    Object.assign(this.current, zeroVisemes());
    Object.assign(this.target, zeroVisemes());
  }

  update(deltaSeconds: number, talking = true): VisemeWeights {
    const dt = finiteNonNegative(deltaSeconds, 0);
    for (const name of VISEME_NAMES) {
      const target = talking ? this.target[name] : 0;
      const speed = target > this.current[name] ? visemeSpeedFor(this.attack, name) : visemeSpeedFor(this.release, name);
      const alpha = dampAlpha(speed, dt);
      this.current[name] += (target - this.current[name]) * alpha;
    }
    Object.assign(this.current, limitVisemeStack(this.current, this.maxTotal));
    return { ...this.current };
  }
}

function visemeSpeedFor(speed: VisemeSpeed, name: VisemeName): number {
  return typeof speed === "number" ? speed : speed[name] ?? 0;
}

export type BlinkState = {
  value: number;
  nextAtMs: number;
  holdUntilMs: number;
};

export class BlinkScheduler {
  private readonly random: RandomSource;
  readonly state: BlinkState;

  constructor(seed: string | number, nowMs = 0) {
    this.random = createSeededRandom(seed);
    this.state = { value: 0, nextAtMs: nowMs + randomRange(this.random, 1200, 4200), holdUntilMs: 0 };
  }

  trigger(nowMs: number, holdMs = 115): void {
    if (nowMs <= this.state.holdUntilMs) {
      this.state.value = 1;
      return;
    }
    const holdUntil = nowMs + Math.max(0, holdMs);
    this.state.value = 1;
    this.state.holdUntilMs = Math.max(this.state.holdUntilMs, holdUntil);
    this.state.nextAtMs = Math.max(this.state.nextAtMs, this.state.holdUntilMs + randomRange(this.random, 900, 2100));
  }

  maybeTrigger(nowMs: number, probability: number, holdMs = 115): boolean {
    if (nowMs <= this.state.holdUntilMs) return false;
    if (this.random() >= clamp01(probability)) return false;
    this.trigger(nowMs, holdMs);
    return true;
  }

  update(nowMs: number, deltaSeconds: number, attentiveness = 0.5): number {
    if (nowMs <= this.state.holdUntilMs) {
      this.state.value = 1;
      return this.state.value;
    }
    if (nowMs >= this.state.nextAtMs) {
      this.state.value = 1;
      this.state.holdUntilMs = nowMs + randomRange(this.random, 90, 145);
      this.state.nextAtMs = nowMs + randomRange(this.random, 1500, 4300 - clamp01(attentiveness) * 900);
      return this.state.value;
    }
    const alpha = 1 - Math.exp(-20 * finiteNonNegative(deltaSeconds, 0));
    this.state.value += (0 - this.state.value) * alpha;
    return this.state.value;
  }
}

export type FacialExpressionMixerOptions = {
  mouthAttack?: number;
  mouthRelease?: number;
  visemes?: VisemeMixerOptions;
};

export type FacialExpressionInput = {
  talking?: boolean;
  targetMouth?: number;
  targetVisemes?: Partial<VisemeWeights>;
  blink?: number;
  mood?: string;
  emotion?: string;
  state?: string;
  energy?: number;
  rapport?: number;
  cueSmile?: number;
  cueThinking?: number;
};

export type FacialExpressionState = {
  mouthLevel: number;
  visemes: VisemeWeights;
  expressions: Record<string, number>;
};

export class FacialExpressionMixer {
  readonly visemes: VisemeMixer;
  mouthLevel = 0;
  targetMouth = 0;
  mouthAttack: number;
  mouthRelease: number;

  constructor(options: FacialExpressionMixerOptions = {}) {
    this.visemes = new VisemeMixer(options.visemes);
    this.mouthAttack = options.mouthAttack ?? 28;
    this.mouthRelease = options.mouthRelease ?? 18;
  }

  setTarget(target: Pick<FacialExpressionInput, "targetMouth" | "targetVisemes">): void {
    if (target.targetMouth !== undefined) this.targetMouth = clamp01(target.targetMouth);
    if (target.targetVisemes) this.visemes.setTarget(target.targetVisemes);
  }

  reset(): void {
    this.mouthLevel = 0;
    this.targetMouth = 0;
    this.visemes.reset();
  }

  update(deltaSeconds: number, input: FacialExpressionInput = {}): FacialExpressionState {
    this.setTarget(input);
    const talking = input.talking ?? true;
    const target = talking ? this.targetMouth : 0;
    this.mouthLevel += (target - this.mouthLevel) * dampAlpha(target > this.mouthLevel ? this.mouthAttack : this.mouthRelease, deltaSeconds);
    const visemes = this.visemes.update(deltaSeconds, talking);
    return {
      mouthLevel: this.mouthLevel,
      visemes,
      expressions: composeFacialExpressions({ ...input, visemes })
    };
  }
}

export function composeFacialExpressions(input: FacialExpressionInput & { visemes?: VisemeWeights }): Record<string, number> {
  const talking = input.talking ?? true;
  const energy = clamp01(input.energy ?? 0);
  const rapport = clamp01(input.rapport ?? 0);
  const cueSmile = clamp01(input.cueSmile ?? 0);
  const cueThinking = clamp01(input.cueThinking ?? 0);
  const mood = input.mood ?? "neutral";
  const emotion = input.emotion ?? "neutral";
  const state = input.state ?? "idle";
  const warmSmile = mood === "warm" || mood === "playful" ? 0.05 + rapport * 0.07 : 0;
  const speechSmile = talking ? 1 : 0.26;
  const smile = clamp01(warmSmile + cueSmile * 0.42 + (emotion === "happy" || emotion === "amused" ? (0.12 + energy * 0.16) * speechSmile : 0));
  const thoughtful = emotion === "thinking" || state === "thinking" ? 0.18 + cueThinking * 0.16 : 0;
  return {
    ...zeroVisemes(),
    ...(input.visemes ?? {}),
    blink: clamp01(input.blink ?? 0),
    happy: smile,
    surprised: emotion === "surprised" ? 0.35 + energy * 0.35 : 0,
    relaxed: state === "listening" ? warmSmile * 0.8 : 0,
    angry: emotion === "concerned" ? 0.08 : 0,
    sad: emotion === "concerned" ? 0.1 : thoughtful * 0.35
  };
}

export function mixExpressions(layers: Array<{ values: Record<string, number>; weight: number }>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const layer of layers) {
    const weight = clamp01(layer.weight);
    for (const [name, value] of Object.entries(layer.values)) {
      output[name] = clamp01((output[name] ?? 0) + clamp01(value) * weight);
    }
  }
  return output;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
