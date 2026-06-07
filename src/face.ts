import { type RandomSource, clamp01, createSeededRandom, randomRange } from "./math.js";

export const VISEME_NAMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type VisemeName = (typeof VISEME_NAMES)[number];
export type VisemeWeights = Record<VisemeName, number>;

export type VisemeMixerOptions = {
  attack?: number;
  release?: number;
  maxTotal?: number;
  intensity?: number;
};

export function zeroVisemes(): VisemeWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

export function limitVisemeStack(values: VisemeWeights, maxTotal: number): VisemeWeights {
  const total = VISEME_NAMES.reduce((sum, name) => sum + values[name], 0);
  if (total <= maxTotal || total <= 0) return { ...values };
  const scale = maxTotal / total;
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
  attack: number;
  release: number;
  maxTotal: number;
  intensity: number;

  constructor(options: VisemeMixerOptions = {}) {
    this.attack = options.attack ?? 30;
    this.release = options.release ?? 20;
    this.maxTotal = options.maxTotal ?? 0.36;
    this.intensity = options.intensity ?? 1;
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
    const dt = Math.max(0, deltaSeconds);
    for (const name of VISEME_NAMES) {
      const target = talking ? this.target[name] : 0;
      const speed = target > this.current[name] ? this.attack : this.release;
      const alpha = 1 - Math.exp(-speed * dt);
      this.current[name] += (target - this.current[name]) * alpha;
    }
    Object.assign(this.current, limitVisemeStack(this.current, this.maxTotal));
    return { ...this.current };
  }
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
    const alpha = 1 - Math.exp(-20 * Math.max(0, deltaSeconds));
    this.state.value += (0 - this.state.value) * alpha;
    return this.state.value;
  }
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

