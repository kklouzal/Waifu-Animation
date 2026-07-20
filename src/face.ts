import {
  type RandomSource,
  clamp01,
  createSeededRandom,
  dampAlpha,
  dampValue,
  finiteNonNegative,
  randomRange
} from "./math.js";

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

const DEFAULT_ATTACK_SPEED = 30;
const DEFAULT_RELEASE_SPEED = 20;
const DEFAULT_MAX_TOTAL = 0.36;
const EMPTY_VISEME_OPTIONS: VisemeMixerOptions = {};

function visemeOptionsOrEmpty(value: VisemeMixerOptions | null | undefined): VisemeMixerOptions {
  return value && typeof value === "object" ? value : EMPTY_VISEME_OPTIONS;
}

function addFiniteNonNegativeTime(a: number, b: number): number {
  const left = finiteNonNegative(a, 0);
  const right = finiteNonNegative(b, 0);
  const sum = left + right;
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
}

function readableVisemeSource(values: Partial<VisemeWeights> | null | undefined): Partial<VisemeWeights> {
  return values && typeof values === "object" ? values : {};
}

export function zeroVisemes(): VisemeWeights {
  return visemeWeights(() => 0);
}

export function limitVisemeStack(values: VisemeWeights, maxTotal: number): VisemeWeights {
  const safeMaxTotal = finiteNonNegative(maxTotal, 0);
  const source = readableVisemeSource(values);
  const sanitized = visemeWeights((name) => clamp01(source[name] ?? 0));
  const total = VISEME_NAMES.reduce((sum, name) => sum + sanitized[name], 0);
  if (total <= safeMaxTotal || total <= 0) return sanitized;
  const scale = safeMaxTotal / total;
  return visemeWeights((name) => sanitized[name] * scale);
}

export class VisemeMixer {
  readonly current: VisemeWeights = zeroVisemes();
  readonly target: VisemeWeights = zeroVisemes();
  attack: VisemeSpeed;
  release: VisemeSpeed;
  maxTotal: number;
  intensity: number;

  constructor(options: VisemeMixerOptions = {}) {
    const safeOptions = visemeOptionsOrEmpty(options);
    this.attack = safeOptions.attack ?? DEFAULT_ATTACK_SPEED;
    this.release = safeOptions.release ?? DEFAULT_RELEASE_SPEED;
    this.maxTotal = finiteNonNegative(safeOptions.maxTotal, DEFAULT_MAX_TOTAL);
    this.intensity = finiteNonNegative(safeOptions.intensity, 1);
  }

  setTarget(next: Partial<VisemeWeights>): void {
    const source = readableVisemeSource(next);
    this.intensity = finiteNonNegative(this.intensity, 1);
    this.maxTotal = finiteNonNegative(this.maxTotal, DEFAULT_MAX_TOTAL);
    for (const name of VISEME_NAMES) this.target[name] = clamp01(source[name] ?? 0) * this.intensity;
    Object.assign(this.target, limitVisemeStack(this.target, this.maxTotal));
  }

  reset(): void {
    Object.assign(this.current, zeroVisemes());
    Object.assign(this.target, zeroVisemes());
  }

  update(deltaSeconds: number, talking = true): VisemeWeights {
    const dt = finiteNonNegative(deltaSeconds, 0);
    const isTalking = Boolean(talking);
    this.maxTotal = finiteNonNegative(this.maxTotal, DEFAULT_MAX_TOTAL);
    for (const name of VISEME_NAMES) {
      this.current[name] = clamp01(this.current[name]);
      this.target[name] = clamp01(this.target[name]);
      const target = isTalking ? this.target[name] : 0;
      const speed =
        target > this.current[name]
          ? visemeSpeedFor(this.attack, name, DEFAULT_ATTACK_SPEED)
          : visemeSpeedFor(this.release, name, DEFAULT_RELEASE_SPEED);
      const alpha = dampAlpha(speed, dt);
      this.current[name] += (target - this.current[name]) * alpha;
    }
    Object.assign(this.current, limitVisemeStack(this.current, this.maxTotal));
    return { ...this.current };
  }
}

function visemeSpeedFor(speed: VisemeSpeed, name: VisemeName, defaultSpeed: number): number {
  const value = typeof speed === "number" ? speed : speed && typeof speed === "object" ? speed[name] : undefined;
  return finiteNonNegative(value, defaultSpeed);
}

function visemeWeights(read: (name: VisemeName) => number): VisemeWeights {
  return {
    aa: read("aa"),
    ih: read("ih"),
    ou: read("ou"),
    ee: read("ee"),
    oh: read("oh")
  };
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
    const now = finiteNonNegative(nowMs, 0);
    this.state = {
      value: 0,
      nextAtMs: addFiniteNonNegativeTime(now, randomRange(this.random, 1200, 4200)),
      holdUntilMs: 0
    };
  }

  trigger(nowMs: number, holdMs = 115): void {
    this.sanitizeState();
    const now = finiteNonNegative(nowMs, 0);
    const hold = finiteNonNegative(holdMs, 115);
    if (now <= this.state.holdUntilMs) {
      this.state.value = 1;
      return;
    }
    const holdUntil = addFiniteNonNegativeTime(now, hold);
    this.state.value = 1;
    this.state.holdUntilMs = Math.max(this.state.holdUntilMs, holdUntil);
    this.state.nextAtMs = Math.max(
      this.state.nextAtMs,
      addFiniteNonNegativeTime(this.state.holdUntilMs, randomRange(this.random, 900, 2100))
    );
  }

  maybeTrigger(nowMs: number, probability: number, holdMs = 115): boolean {
    this.sanitizeState();
    const now = finiteNonNegative(nowMs, 0);
    if (now <= this.state.holdUntilMs) return false;
    if (this.random() >= clamp01(probability)) return false;
    this.trigger(now, holdMs);
    return true;
  }

  update(nowMs: number, deltaSeconds: number, attentiveness = 0.5): number {
    this.sanitizeState();
    const now = finiteNonNegative(nowMs, 0);
    const dt = finiteNonNegative(deltaSeconds, 0);
    if (now <= this.state.holdUntilMs) {
      this.state.value = 1;
      return this.state.value;
    }
    if (now >= this.state.nextAtMs) {
      this.state.value = 1;
      this.state.holdUntilMs = addFiniteNonNegativeTime(now, randomRange(this.random, 90, 145));
      this.state.nextAtMs = addFiniteNonNegativeTime(
        now,
        randomRange(this.random, 1500, 4300 - clamp01(attentiveness) * 900)
      );
      return this.state.value;
    }
    const alpha = dampAlpha(20, dt);
    this.state.value = clamp01(this.state.value + (0 - this.state.value) * alpha);
    return this.state.value;
  }

  private sanitizeState(): void {
    this.state.value = clamp01(this.state.value);
    this.state.nextAtMs = finiteNonNegative(this.state.nextAtMs, 0);
    this.state.holdUntilMs = finiteNonNegative(this.state.holdUntilMs, 0);
  }
}

export type FacialExpressionMixerOptions = {
  mouthAttack?: number;
  mouthRelease?: number;
  visemes?: VisemeMixerOptions;
};

const EMPTY_FACIAL_OPTIONS: FacialExpressionMixerOptions = {};

function facialOptionsOrEmpty(value: FacialExpressionMixerOptions | null | undefined): FacialExpressionMixerOptions {
  return value && typeof value === "object" ? value : EMPTY_FACIAL_OPTIONS;
}

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

const EMPTY_FACIAL_INPUT: FacialExpressionInput & { visemes?: VisemeWeights } = {};

function facialInputOrEmpty(
  input: (FacialExpressionInput & { visemes?: VisemeWeights }) | null | undefined
): FacialExpressionInput & { visemes?: VisemeWeights } {
  return input && typeof input === "object" ? input : EMPTY_FACIAL_INPUT;
}

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
    const safeOptions = facialOptionsOrEmpty(options);
    this.visemes = new VisemeMixer(safeOptions.visemes);
    this.mouthAttack = finiteNonNegative(safeOptions.mouthAttack, 28);
    this.mouthRelease = finiteNonNegative(safeOptions.mouthRelease, 18);
  }

  setTarget(target: Pick<FacialExpressionInput, "targetMouth" | "targetVisemes">): void {
    if (target?.targetMouth !== undefined) this.targetMouth = clamp01(target.targetMouth);
    if (target?.targetVisemes) this.visemes.setTarget(target.targetVisemes);
  }

  reset(): void {
    this.mouthLevel = 0;
    this.targetMouth = 0;
    this.visemes.reset();
  }

  update(deltaSeconds: number, input: FacialExpressionInput = {}): FacialExpressionState {
    const safeInput = facialInputOrEmpty(input);
    this.setTarget(safeInput);
    const talking = safeInput.talking ?? true;
    const dt = finiteNonNegative(deltaSeconds, 0);
    this.mouthLevel = clamp01(this.mouthLevel);
    this.targetMouth = clamp01(this.targetMouth);
    this.mouthAttack = finiteNonNegative(this.mouthAttack, 28);
    this.mouthRelease = finiteNonNegative(this.mouthRelease, 18);
    const target = talking ? this.targetMouth : 0;
    this.mouthLevel = clamp01(
      dampValue(this.mouthLevel, target, target > this.mouthLevel ? this.mouthAttack : this.mouthRelease, dt)
    );
    const visemes = this.visemes.update(dt, talking);
    return {
      mouthLevel: this.mouthLevel,
      visemes,
      expressions: composeFacialExpressions({ ...safeInput, visemes })
    };
  }
}

export function composeFacialExpressions(
  input: FacialExpressionInput & { visemes?: VisemeWeights }
): Record<string, number> {
  const safeInput = facialInputOrEmpty(input);
  const talking = safeInput.talking ?? true;
  const energy = clamp01(safeInput.energy ?? 0);
  const rapport = clamp01(safeInput.rapport ?? 0);
  const cueSmile = clamp01(safeInput.cueSmile ?? 0);
  const cueThinking = clamp01(safeInput.cueThinking ?? 0);
  const mood = safeInput.mood ?? "neutral";
  const emotion = safeInput.emotion ?? "neutral";
  const state = safeInput.state ?? "idle";
  const warmSmile = mood === "warm" || mood === "playful" ? 0.05 + rapport * 0.07 : 0;
  const speechSmile = talking ? 1 : 0.26;
  const smile = clamp01(
    warmSmile +
      cueSmile * 0.42 +
      (emotion === "happy" || emotion === "amused" ? (0.12 + energy * 0.16) * speechSmile : 0)
  );
  const thoughtful = emotion === "thinking" || state === "thinking" ? 0.18 + cueThinking * 0.16 : 0;
  const visemes = safeInput.visemes ? visemeWeights((name) => clamp01(safeInput.visemes?.[name] ?? 0)) : zeroVisemes();
  return {
    ...visemes,
    blink: clamp01(safeInput.blink ?? 0),
    happy: smile,
    surprised: emotion === "surprised" ? 0.35 + energy * 0.35 : 0,
    relaxed: state === "listening" ? warmSmile * 0.8 : 0,
    angry: emotion === "concerned" ? 0.08 : 0,
    sad: emotion === "concerned" ? 0.1 : thoughtful * 0.35
  };
}

export function mixExpressions(
  layers: Array<{ values: Record<string, number>; weight: number }>
): Record<string, number> {
  const valuesByName = new Map<string, number>();
  const layerList = Array.isArray(layers) ? layers : [];
  for (const layer of layerList) {
    if (!layer || typeof layer !== "object" || !layer.values || typeof layer.values !== "object") continue;
    const weight = clamp01(layer.weight);
    if (weight <= 0) continue;
    for (const [name, value] of Object.entries(layer.values)) {
      valuesByName.set(name, clamp01((valuesByName.get(name) ?? 0) + clamp01(value) * weight));
    }
  }
  return Object.fromEntries(valuesByName);
}
