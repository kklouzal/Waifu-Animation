import { type RandomSource, type Vec3, clamp, clamp01, createSeededRandom, normalizeVec3, randomRange } from "./math.js";

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

export function distributeLookAt(localTarget: Vec3, options: LookAtOptions = {}): LookAtDistribution {
  const direction = normalizeVec3(localTarget, [0, 0, 1]);
  const yaw = clamp(Math.atan2(direction[0], Math.max(1e-5, direction[2])), -(options.maxYaw ?? 0.85), options.maxYaw ?? 0.85);
  const pitch = clamp(Math.atan2(direction[1], Math.hypot(direction[0], direction[2])), -(options.maxPitch ?? 0.52), options.maxPitch ?? 0.52);
  const eyeLead = options.eyeLead ?? 0.42;
  return {
    eyes: { yaw: yaw * eyeLead, pitch: pitch * eyeLead, weight: 1 },
    head: { yaw: yaw * (options.headWeight ?? 0.42), pitch: pitch * (options.headWeight ?? 0.46), weight: 1 },
    neck: { yaw: yaw * (options.neckWeight ?? 0.22), pitch: pitch * (options.neckWeight ?? 0.2), weight: 1 },
    spine: { yaw: yaw * (options.spineWeight ?? 0.11), pitch: pitch * (options.spineWeight ?? 0.07), weight: 1 },
    torso: { yaw: yaw * (options.torsoWeight ?? 0.05), pitch: pitch * (options.torsoWeight ?? 0.03), weight: 1 }
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
  private current = 0;

  constructor(seed: string | number) {
    this.random = createSeededRandom(seed);
  }

  choose(nowMs: number, targets: readonly AttentionTarget[], minDwellMs = 900, maxDwellMs = 3200): AttentionTarget | null {
    if (targets.length === 0) return null;
    if (nowMs >= this.nextSwitchAt || this.current >= targets.length) {
      const total = targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0);
      let pick = this.random() * Math.max(1e-5, total);
      this.current = 0;
      for (let i = 0; i < targets.length; i += 1) {
        pick -= Math.max(0, targets[i]!.weight);
        if (pick <= 0) {
          this.current = i;
          break;
        }
      }
      this.nextSwitchAt = nowMs + randomRange(this.random, minDwellMs, maxDwellMs);
    }
    return targets[this.current] ?? targets[0] ?? null;
  }
}

export function breathingWeight(elapsedSeconds: number, energy: number): number {
  return Math.sin(elapsedSeconds * (1.15 + clamp01(energy) * 0.55)) * (0.5 + clamp01(energy) * 0.5);
}

