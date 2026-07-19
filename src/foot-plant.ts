import { type AimIkResult, type TwoBoneIkCorrectionResult, solveAimIk, solveTwoBoneIkCorrections } from "./ik-core.js";
import {
  type Mat4,
  type Vec3,
  addVec3,
  clamp01,
  dotVec3,
  finiteNonNegative,
  lengthVec3,
  lerpVec3,
  normalizeVec3,
  scaleVec3,
  subVec3
} from "./math.js";
import { finiteMat4Value, mat4Translation as matrixTranslation } from "./numeric-helpers.js";
import {
  type HumanoidBoneName,
  type Skeleton,
  isHumanoidBoneName,
  resolveHumanoidIndex,
  resolveJointIndex
} from "./skeleton.js";

const MIN_IK_REACH = 1e-5;

export type GroundContact = {
  point: Vec3;
  normal?: Vec3;
  rayStart?: Vec3;
};

export type StationarySupportContactSide = "left" | "right";

export type StationarySupportContactSample = {
  time: number;
  position: Vec3;
  height?: number;
};

export type StationarySupportContactClassifierOptions = {
  floorY?: number;
  enterHeight?: number;
  exitHeight?: number;
  maxHorizontalVelocity?: number;
  maxVerticalVelocity?: number;
  minContactSeconds?: number;
};

export type StationarySupportContactInterval = {
  side: StationarySupportContactSide;
  startTime: number;
  endTime: number;
  duration: number;
  anchor: Vec3;
  maxSlide: number;
  sampleCount: number;
};

export type StationarySupportContactClassification = {
  intervals: StationarySupportContactInterval[];
  plantedSampleRatio: number;
  maxPlantedSlide: number;
};

export type StationarySupportCompensationInput = {
  left?: StationarySupportContactClassification;
  right?: StationarySupportContactClassification;
  pelvisOffset: Vec3;
  leftError?: Vec3;
  rightError?: Vec3;
  maxCompensation?: number;
  influence?: number;
};

export type StationarySupportCompensation = {
  rootOffset: Vec3;
  pelvisOffset: Vec3;
  supportCount: number;
  influence: number;
};

export type StationarySupportSideSample = {
  time: number;
  sole: Vec3;
};

export type StationarySupportSideBaseline = {
  /**
   * Vertical distance from ankle joint to sole/contact point in world/model metres.
   * For Lilin-style VRM feet this is typically around 0.12-0.16m. It is never a
   * sole clearance and must not be subtracted from the measured sole/floor clearance.
   */
  ankleToSoleHeight: number;
  /** Back-compat alias for soleClearance; never an ankle-center height. */
  height: number;
  /** Offset from ankle joint center to the sole/contact point, in the same coordinates as ankle/sole. */
  soleOffset: Vec3;
  /** Locked planted-sole clearance over floor in metres; normally near 0 for stationary support. */
  soleClearance: number;
  source: "rest" | "initial-window" | "expected" | "fallback";
  sampleCount: number;
};

export type StationarySupportStateSide = {
  active: boolean;
  anchor?: Vec3;
  previousSole?: Vec3;
  previousHeight?: number;
  maxPreReleaseAnchorError: number;
  unsupportedExpectedSeconds: number;
  unsupportedExpectedSamples: number;
  maxUnsupportedExpectedDuration: number;
  currentUnsupportedExpectedDuration: number;
  initialized: boolean;
  influence: number;
  maxSlide: number;
  totalSlide: number;
  reanchorCount: number;
  blockedUntilLift: boolean;
  transition?: string;
};

export type StationarySupportSolverState = {
  left: StationarySupportStateSide;
  right: StationarySupportStateSide;
};

export type StationarySupportSideInput = {
  side: StationarySupportContactSide;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  /** Sole/contact point in world space. If omitted, ankle plus baseline soleOffset is used. */
  sole?: Vec3;
  baseline: StationarySupportSideBaseline;
  expected?: boolean;
  influence?: number;
};

export type StationarySupportSolveOptions = {
  deltaSeconds?: number;
  floorY?: number;
  enterHeight?: number;
  exitHeight?: number;
  releaseHeight?: number;
  maxHorizontalVelocity?: number;
  maxVerticalVelocity?: number;
  maxPlantedDrift?: number;
  maxRootCompensation?: number;
  maxAnkleCorrection?: number;
  maxPelvisOffset?: number;
  pelvisCompensation?: number;
  maxStretch?: number;
  blendInSeconds?: number;
  blendOutSeconds?: number;
  pole?: Vec3;
  /**
   * Treat a planted foot that exceeds drift as a source-authored contact transfer when it either
   * fails the low/slow classifier or drifts materially farther than the contralateral planted side.
   * This is intentionally opt-in for runtimes that can distinguish global stationary support from
   * per-side double-support expectations.
   */
  releaseOnContactTransfer?: boolean;
  /** Horizontal anchor drift required before releaseOnContactTransfer may release a planted side. */
  maxTransferDrift?: number;
  /** Optional stricter low-contact horizontal velocity that identifies a contact transfer before the planted classifier releases. */
  maxTransferVelocity?: number;
  /** Expect at least one side to provide stationary support; side.expected remains per-side. */
  expectedSupport?: boolean;
};

export type StationarySupportSideSolveTelemetry = {
  side: StationarySupportContactSide;
  sole: Vec3;
  baselineHeight: number;
  ankleToSoleHeight: number;
  soleClearanceBaseline: number;
  height: number;
  soleClearance: number;
  horizontalVelocity: number | null;
  verticalVelocity: number | null;
  /** Low/near-floor vertical support, independent of horizontal anchoring. */
  verticalSupport: boolean;
  contact: boolean;
  anchor: Vec3 | null;
  anchorError: number | null;
  maxSlide: number;
  totalSlide: number;
  transition: string | null;
  blockedUntilLift: boolean;
  influence: number;
  reanchorCount: number;
  releaseReason: string | null;
  acquireReason: string | null;
  unsupportedExpectedDuration: number;
  unsupportedExpectedSamples: number;
  maxUnsupportedExpectedDuration: number;
  maxPreReleaseAnchorError: number;
};

export type StationarySupportSolveResult = {
  state: StationarySupportSolverState;
  footPlant: FootPlantResult;
  activeSides: StationarySupportContactSide[];
  rootCompensation: Vec3;
  requestedRootCompensation: Vec3;
  maxRootCompensation: number;
  supportState: "released" | "left-support" | "right-support" | "double-support";
  left: StationarySupportSideSolveTelemetry;
  right: StationarySupportSideSolveTelemetry;
  issues: string[];
};

export type FootPlantLegInput = {
  id: string;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  ground?: GroundContact;
  pole?: Vec3;
  footHeight?: number;
  influence?: number;
  maxStretch?: number;
  maxAnkleCorrection?: number;
};

export type FootPlantOptions = {
  down?: Vec3;
  footHeight?: number;
  influence?: number;
  pelvisCompensation?: number;
  maxPelvisOffset?: number;
  maxAnkleCorrection?: number;
  maxStretch?: number;
  maxGroundSlopeAngle?: number;
  rejectUnreachable?: boolean;
};

export type FootPlantLegResult = {
  id: string;
  planted: boolean;
  clamped: boolean;
  initialAnkle: Vec3;
  targetAnkle: Vec3;
  ankleOffset: Vec3;
  correctionDistance: number;
  groundNormal: Vec3;
  targetReach: number;
  skippedReason?: string;
  groundPoint?: Vec3;
  ik?: TwoBoneIkCorrectionResult;
};

export type FootPlantResult = {
  pelvisOffset: Vec3;
  plantedCount: number;
  lowestCorrection: number;
  legs: FootPlantLegResult[];
  issues: string[];
};

export type FootPlantStabilizerLegState = {
  id: string;
  influence: number;
  contactConfidence: number;
  graceSecondsRemaining: number;
  planted: boolean;
  groundContact?: GroundContact;
};

export type FootPlantStabilizerState = {
  legs: FootPlantStabilizerLegState[];
};

export type FootPlantStabilizerObservation = {
  id: string;
  planted?: boolean;
  active?: boolean;
  contactConfidence?: number;
  influence?: number;
  skippedReason?: string;
  groundContact?: GroundContact;
};

export type FootPlantStabilizerOptions = {
  deltaSeconds?: number;
  blendInSeconds?: number;
  blendOutSeconds?: number;
  contactGraceSeconds?: number;
  minInfluence?: number;
  maxInfluence?: number;
};

export type FootPlantStabilizedLeg = {
  id: string;
  influence: number;
  active: boolean;
  planted: boolean;
  contactConfidence: number;
  graceSecondsRemaining: number;
  groundContact?: GroundContact;
};

export type FootPlantStabilizerUpdate = {
  state: FootPlantStabilizerState;
  legs: FootPlantStabilizedLeg[];
};

export type OzzFootIkSide = "left" | "right";

export type OzzFootIkRay = {
  id: string;
  side?: OzzFootIkSide;
  ankle: Vec3;
  start: Vec3;
  direction: Vec3;
  length: number;
};

export type OzzFootIkRaycast = (ray: OzzFootIkRay) => GroundContact | null | undefined;

export type OzzFootIkLegPreset = {
  id?: string;
  side?: OzzFootIkSide;
  hip?: number | string;
  knee?: number | string;
  ankle?: number | string;
  pole?: Vec3;
  ankleUp?: Vec3;
  footForward?: Vec3;
  footHeight?: number;
  influence?: number;
  maxStretch?: number;
  maxAnkleCorrection?: number;
};

export type OzzFootIkOptions = FootPlantOptions & {
  skeleton: Skeleton;
  modelPose: readonly Mat4[];
  legs?: readonly OzzFootIkLegPreset[];
  contacts?: Readonly<Record<string, GroundContact | null | undefined>>;
  raycast?: OzzFootIkRaycast;
  rayHeight?: number;
  rayLength?: number;
  aimAnkles?: boolean;
};

export type OzzFootIkLegResult = FootPlantLegResult & {
  side?: OzzFootIkSide;
  hipJoint: number;
  kneeJoint: number;
  ankleJoint: number;
  ray?: OzzFootIkRay;
  ankleAim?: AimIkResult;
};

export type OzzFootIkResult = Omit<FootPlantResult, "legs"> & {
  legs: OzzFootIkLegResult[];
};

export function classifyStationarySupportContacts(
  side: StationarySupportContactSide,
  samples: readonly StationarySupportContactSample[],
  options: StationarySupportContactClassifierOptions = {}
): StationarySupportContactClassification {
  const floorY = finiteNumber(options.floorY, 0);
  const enterHeight = finiteNonNegative(options.enterHeight, 0.035);
  const exitHeight = Math.max(enterHeight, finiteNonNegative(options.exitHeight, 0.065));
  const maxHorizontalVelocity = finiteNonNegative(options.maxHorizontalVelocity, 0.08);
  const maxVerticalVelocity = finiteNonNegative(options.maxVerticalVelocity, 0.12);
  const minContactSeconds = finiteNonNegative(options.minContactSeconds, 0.05);
  const sorted = samples
    .map((sample) => ({
      time: finiteNonNegative(sample.time, 0),
      position: finiteVec3(sample.position, [0, 0, 0]),
      height: finiteNumber(sample.height, sample.position[1] - floorY)
    }))
    .sort((a, b) => a.time - b.time);
  const intervals: StationarySupportContactInterval[] = [];
  let current: { startTime: number; endTime: number; anchor: Vec3; maxSlide: number; sampleCount: number } | null =
    null;
  let previous: (typeof sorted)[number] | null = null;

  for (const sample of sorted) {
    const dt = previous ? Math.max(sample.time - previous.time, 1e-5) : 1 / 60;
    const horizontalVelocity = previous
      ? Math.hypot(sample.position[0] - previous.position[0], sample.position[2] - previous.position[2]) / dt
      : 0;
    const verticalVelocity = previous ? Math.abs(sample.position[1] - previous.position[1]) / dt : 0;
    const lowEnough = current ? sample.height <= exitHeight : sample.height <= enterHeight;
    const slowEnough = horizontalVelocity <= maxHorizontalVelocity && verticalVelocity <= maxVerticalVelocity;
    const planted = lowEnough && slowEnough;
    if (planted) {
      if (!current) {
        current = {
          startTime: sample.time,
          endTime: sample.time,
          anchor: sample.position,
          maxSlide: 0,
          sampleCount: 1
        };
      } else {
        current.endTime = sample.time;
        current.sampleCount += 1;
        current.maxSlide = Math.max(
          current.maxSlide,
          Math.hypot(sample.position[0] - current.anchor[0], sample.position[2] - current.anchor[2])
        );
      }
    } else if (current) {
      pushStationarySupportInterval(side, current, intervals, minContactSeconds);
      current = null;
    }
    previous = sample;
  }
  if (current) pushStationarySupportInterval(side, current, intervals, minContactSeconds);

  const plantedSamples = intervals.reduce((sum, interval) => sum + interval.sampleCount, 0);
  return {
    intervals,
    plantedSampleRatio: sorted.length > 0 ? plantedSamples / sorted.length : 0,
    maxPlantedSlide: intervals.reduce((max, interval) => Math.max(max, interval.maxSlide), 0)
  };
}

export function computeStationarySupportCompensation(
  input: StationarySupportCompensationInput
): StationarySupportCompensation {
  const influence = clamp01(input.influence ?? 1);
  const maxCompensation = finiteNonNegative(input.maxCompensation, 0.12);
  const supportCount = (input.left?.intervals.length ? 1 : 0) + (input.right?.intervals.length ? 1 : 0);
  if (supportCount === 0 || influence <= 0) {
    return {
      rootOffset: [0, 0, 0],
      pelvisOffset: finiteVec3(input.pelvisOffset, [0, 0, 0]),
      supportCount: 0,
      influence
    };
  }
  const pelvis = finiteVec3(input.pelvisOffset, [0, 0, 0]);
  const errors = [input.leftError, input.rightError]
    .filter((value): value is Vec3 => Array.isArray(value))
    .map((value) => finiteVec3(value, [0, 0, 0]));
  const desired: Vec3 =
    errors.length > 0
      ? [
          errors.reduce((sum, value) => sum + value[0], 0) / errors.length,
          0,
          errors.reduce((sum, value) => sum + value[2], 0) / errors.length
        ]
      : [-pelvis[0], 0, -pelvis[2]];
  const horizontal = Math.hypot(desired[0], desired[2]);
  const scale = horizontal > maxCompensation && horizontal > 1e-6 ? maxCompensation / horizontal : 1;
  const rootOffset: Vec3 = [desired[0] * scale * influence, 0, desired[2] * scale * influence];
  return {
    rootOffset,
    pelvisOffset: [pelvis[0] + rootOffset[0], pelvis[1], pelvis[2] + rootOffset[2]],
    supportCount,
    influence
  };
}

export function createStationarySupportSolverState(): StationarySupportSolverState {
  return {
    left: createStationarySupportStateSide(),
    right: createStationarySupportStateSide()
  };
}

export function estimateStationarySupportBaseline(
  samples: readonly StationarySupportSideSample[],
  options: { expectedHeight?: number; restSoleOffset?: Vec3; floorY?: number; initialWindowSeconds?: number } = {}
): StationarySupportSideBaseline {
  const soleOffset = finiteVec3(options.restSoleOffset, [0, 0, 0]);
  const ankleToSoleHeight = Math.max(0, -soleOffset[1]);
  const createBaseline = (
    soleClearance: number,
    source: StationarySupportSideBaseline["source"],
    sampleCount: number
  ): StationarySupportSideBaseline => ({
    ankleToSoleHeight,
    height: Math.max(0, finiteNumber(soleClearance, 0)),
    soleOffset,
    soleClearance: Math.max(0, finiteNumber(soleClearance, 0)),
    source,
    sampleCount
  });
  if (Number.isFinite(options.expectedHeight)) {
    return createBaseline(Number(options.expectedHeight), "expected", 0);
  }
  const floorY = finiteNumber(options.floorY, 0);
  const sorted = samples
    .map((sample) => ({ time: finiteNonNegative(sample.time, 0), sole: finiteVec3(sample.sole, [0, 0, 0]) }))
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return createBaseline(0, "fallback", 0);
  const firstTime = sorted[0]!.time;
  const windowSeconds = finiteNonNegative(options.initialWindowSeconds, 0.35);
  const window = sorted.filter((sample) => sample.time <= firstTime + windowSeconds);
  const candidates = (window.length > 0 ? window : sorted)
    .map((sample) => sample.sole[1] - floorY)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (candidates.length === 0) return createBaseline(0, "fallback", 0);
  const lowCount = Math.max(1, Math.ceil(candidates.length * 0.35));
  const soleClearance = candidates.slice(0, lowCount).reduce((sum, value) => sum + value, 0) / lowCount;
  return createBaseline(soleClearance, "initial-window", candidates.length);
}

export function solveStationarySupport(
  input: { state?: StationarySupportSolverState; left: StationarySupportSideInput; right: StationarySupportSideInput },
  options: StationarySupportSolveOptions = {}
): StationarySupportSolveResult {
  const state = cloneStationarySupportSolverState(input.state);
  const deltaSeconds = Math.max(finiteNonNegative(options.deltaSeconds, 1 / 60), 1 / 240);
  const floorY = finiteNumber(options.floorY, 0);
  const enterHeight = finiteNonNegative(options.enterHeight, 0.028);
  const exitHeight = Math.max(enterHeight, finiteNonNegative(options.exitHeight, 0.052));
  const releaseHeight = Math.max(exitHeight, finiteNonNegative(options.releaseHeight, 0.085));
  const maxHorizontalVelocity = finiteNonNegative(options.maxHorizontalVelocity, 0.16);
  const maxVerticalVelocity = finiteNonNegative(options.maxVerticalVelocity, 0.22);
  const maxPlantedDrift = finiteNonNegative(options.maxPlantedDrift, 0.045);
  const maxRootCompensation = finiteNonNegative(options.maxRootCompensation, 0.025);
  const releaseOnContactTransfer = options.releaseOnContactTransfer === true;
  const maxTransferDrift = finiteNonNegative(options.maxTransferDrift, maxPlantedDrift);
  const maxTransferVelocity = finiteNonNegative(options.maxTransferVelocity, maxHorizontalVelocity);
  const blendInSeconds = finiteNonNegative(options.blendInSeconds, 0.08);
  const blendOutSeconds = finiteNonNegative(options.blendOutSeconds, 0.1);
  const issues: string[] = [];
  const sides = [input.left, input.right] as const;
  const sideTelemetry = new Map<StationarySupportContactSide, StationarySupportSideSolveTelemetry>();
  const footInput: FootPlantLegInput[] = [];
  const floorGuardCandidates: Array<{ id: StationarySupportContactSide; height: number; input: FootPlantLegInput }> = [];
  const requestedRoot = [0, 0, 0] as Vec3;
  let activeCount = 0;
  let verticalSupportCount = 0;

  // Snapshot both planted sides before mutating either state. A deliberately slow authored
  // foot transfer can remain below the velocity classifier, so compare its anchor drift with
  // the contralateral planted side. This keeps one stable support anchor while allowing the
  // materially farther side to release instead of visibly dragging both feet.
  const transferEvidence = new Map<
    StationarySupportContactSide,
    { activeVerticalSupport: boolean; anchorError: number | null }
  >();
  for (const sideInput of sides) {
    const sideState = state[sideInput.side];
    const ankle = finiteVec3(sideInput.ankle, [0, 0, 0]);
    const soleOffset = finiteVec3(sideInput.baseline.soleOffset, [0, 0, 0]);
    const soleClearanceBaseline = finiteNonNegative(sideInput.baseline.soleClearance, 0);
    const sole = finiteVec3(sideInput.sole, addVec3(ankle, soleOffset));
    const height = sole[1] - floorY - soleClearanceBaseline;
    const verticalVelocity =
      sideState.previousHeight === undefined ? null : Math.abs(height - sideState.previousHeight) / deltaSeconds;
    const lift = height > releaseHeight || (verticalVelocity ?? 0) > maxVerticalVelocity * 2.5;
    transferEvidence.set(sideInput.side, {
      activeVerticalSupport: sideState.active && sideState.anchor !== undefined && !lift,
      anchorError:
        sideState.active && sideState.anchor
          ? Math.hypot(sole[0] - sideState.anchor[0], sole[2] - sideState.anchor[2])
          : null
    });
  }

  for (const sideInput of sides) {
    const sideState = state[sideInput.side];
    delete sideState.transition;
    const ankle = finiteVec3(sideInput.ankle, [0, 0, 0]);
    const soleOffset = finiteVec3(sideInput.baseline.soleOffset, [0, 0, 0]);
    const ankleToSoleHeight = finiteNonNegative(sideInput.baseline.ankleToSoleHeight, Math.max(0, -soleOffset[1]));
    const soleClearanceBaseline = finiteNonNegative(sideInput.baseline.soleClearance, 0);
    const sole = finiteVec3(sideInput.sole, addVec3(ankle, soleOffset));
    // Dimensional invariant: `height`/`soleClearance` is sole.y-floorY minus a sole-clearance baseline.
    // It is not an ankle-center measurement, so ankleToSoleHeight is only used for IK target height.
    const soleClearance = sole[1] - floorY;
    const height = soleClearance - soleClearanceBaseline;
    const horizontalVelocity =
      sideState.initialized && sideState.previousSole
        ? Math.hypot(sole[0] - sideState.previousSole[0], sole[2] - sideState.previousSole[2]) / deltaSeconds
        : null;
    const verticalVelocity =
      sideState.previousHeight === undefined ? null : Math.abs(height - sideState.previousHeight) / deltaSeconds;
    const lowEnough = sideState.active ? height <= exitHeight : height <= enterHeight;
    const slowEnough =
      (horizontalVelocity ?? 0) <= maxHorizontalVelocity && (verticalVelocity ?? 0) <= maxVerticalVelocity;
    const contactCandidate = lowEnough && slowEnough;
    const lift = height > releaseHeight || (verticalVelocity ?? 0) > maxVerticalVelocity * 2.5;
    const anchorError =
      sideState.active && sideState.anchor
        ? Math.hypot(sole[0] - sideState.anchor[0], sole[2] - sideState.anchor[2])
        : null;
    const driftLimitExceeded = anchorError !== null && anchorError > maxPlantedDrift;
    const transferVelocityExceeded = (horizontalVelocity ?? 0) > maxTransferVelocity;
    const transferClassifierMiss =
      !contactCandidate && ((horizontalVelocity ?? 0) > maxHorizontalVelocity || height > exitHeight);
    const verticalSupport = !lift && height <= releaseHeight;
    const otherSide: StationarySupportContactSide = sideInput.side === "left" ? "right" : "left";
    const otherTransferEvidence = transferEvidence.get(otherSide);
    const asymmetricDriftTransfer =
      anchorError !== null &&
      otherTransferEvidence?.activeVerticalSupport === true &&
      otherTransferEvidence.anchorError !== null &&
      anchorError - otherTransferEvidence.anchorError > Math.max(1e-4, maxTransferDrift * 0.25);
    const contactTransfer =
      releaseOnContactTransfer &&
      anchorError !== null &&
      anchorError > maxTransferDrift &&
      !lift &&
      (transferClassifierMiss || transferVelocityExceeded || asymmetricDriftTransfer);
    let acquireReason: string | null = null;
    let releaseReason: string | null = null;

    if (sideState.blockedUntilLift && (!contactCandidate || lift)) sideState.blockedUntilLift = false;
    if (sideState.active) {
      if (sideState.anchor) {
        sideState.maxSlide = Math.max(sideState.maxSlide, anchorError ?? 0);
        if (sideState.previousSole)
          sideState.totalSlide += Math.hypot(sole[0] - sideState.previousSole[0], sole[2] - sideState.previousSole[2]);
      }
      if (lift) {
        sideState.active = false;
        sideState.influence = stepInfluence(sideState.influence, 0, deltaSeconds, blendOutSeconds);
        releaseReason = "lift";
        sideState.transition = `release-${releaseReason}`;
        sideState.blockedUntilLift = false;
      } else if (contactTransfer) {
        sideState.active = false;
        sideState.influence = stepInfluence(sideState.influence, 0, deltaSeconds, blendOutSeconds);
        releaseReason = "contact-transfer";
        sideState.transition = `release-${releaseReason}`;
        sideState.blockedUntilLift = false;
      } else {
        if (anchorError !== null)
          sideState.maxPreReleaseAnchorError = Math.max(sideState.maxPreReleaseAnchorError, anchorError);
        if (!contactCandidate)
          issues.push(`${sideInput.side}: planted contact held through non-lift contact classifier miss`);
        if (driftLimitExceeded) {
          issues.push(
            `${sideInput.side}: planted anchor drift ${anchorError!.toFixed(4)}m exceeds ${maxPlantedDrift.toFixed(4)}m without source-backed lift`
          );
          sideState.transition = "hold-drift-limit";
        }
        sideState.influence = stepInfluence(
          sideState.influence,
          clamp01(sideInput.influence ?? 1),
          deltaSeconds,
          blendInSeconds
        );
      }
    } else if (contactCandidate && !sideState.blockedUntilLift) {
      sideState.active = true;
      sideState.anchor = [...sole] as Vec3;
      sideState.influence = stepInfluence(
        sideState.influence,
        clamp01(sideInput.influence ?? 1),
        deltaSeconds,
        blendInSeconds
      );
      sideState.maxSlide = 0;
      sideState.totalSlide = 0;
      sideState.reanchorCount += sideState.initialized ? 1 : 0;
      acquireReason = "contact";
      sideState.transition = "acquire-contact";
      sideState.currentUnsupportedExpectedDuration = 0;
    } else {
      sideState.influence = stepInfluence(sideState.influence, 0, deltaSeconds, blendOutSeconds);
    }

    const active = sideState.active && sideState.anchor !== undefined && sideState.influence > 1e-5;
    if (active || verticalSupport) verticalSupportCount += 1;
    const verticalFloorGuardInput: FootPlantLegInput = {
      id: sideInput.side,
      hip: finiteVec3(sideInput.hip, [0, 0, 0]),
      knee: finiteVec3(sideInput.knee, [0, 0, 0]),
      ankle,
      ground: {
        point: [sole[0], floorY + soleClearanceBaseline, sole[2]],
        normal: [0, 1, 0],
        rayStart: [sole[0], floorY + soleClearanceBaseline + ankleToSoleHeight + 0.5, sole[2]]
      },
      footHeight: ankleToSoleHeight,
      influence: clamp01(sideInput.influence ?? 1),
      ...(options.pole ? { pole: options.pole } : {}),
      ...(options.maxAnkleCorrection === undefined ? {} : { maxAnkleCorrection: options.maxAnkleCorrection }),
      ...(options.maxStretch === undefined ? {} : { maxStretch: options.maxStretch })
    };
    floorGuardCandidates.push({ id: sideInput.side, height, input: verticalFloorGuardInput });
    if (active) {
      sideState.currentUnsupportedExpectedDuration = 0;
      activeCount += 1;
      requestedRoot[0] += (sideState.anchor![0] - sole[0]) * sideState.influence;
      requestedRoot[2] += (sideState.anchor![2] - sole[2]) * sideState.influence;
      footInput.push({
        id: sideInput.side,
        hip: finiteVec3(sideInput.hip, [0, 0, 0]),
        knee: finiteVec3(sideInput.knee, [0, 0, 0]),
        ankle,
        ground: {
          point: [sideState.anchor![0], floorY + soleClearanceBaseline, sideState.anchor![2]],
          normal: [0, 1, 0],
          rayStart: [
            sideState.anchor![0],
            floorY + soleClearanceBaseline + ankleToSoleHeight + 0.5,
            sideState.anchor![2]
          ]
        },
        footHeight: ankleToSoleHeight,
        influence: sideState.influence,
        ...(options.pole ? { pole: options.pole } : {}),
        ...(options.maxAnkleCorrection === undefined ? {} : { maxAnkleCorrection: options.maxAnkleCorrection }),
        ...(options.maxStretch === undefined ? {} : { maxStretch: options.maxStretch })
      });
    } else if (height < -1e-4) {
      // Released transfer feet are not horizontal anchors, but they still need a vertical floor guard
      // so intentional low shuffles do not visibly punch through the floor plane.
      footInput.push(verticalFloorGuardInput);
    } else if (sideInput.expected) {
      sideState.unsupportedExpectedSamples += 1;
      sideState.unsupportedExpectedSeconds += deltaSeconds;
      sideState.currentUnsupportedExpectedDuration += deltaSeconds;
      sideState.maxUnsupportedExpectedDuration = Math.max(
        sideState.maxUnsupportedExpectedDuration,
        sideState.currentUnsupportedExpectedDuration
      );
      issues.push(
        `${sideInput.side}: expected stationary support did not acquire (${sideState.transition ?? (sideState.blockedUntilLift ? "blocked-until-lift" : "no-contact")})`
      );
    } else {
      sideState.currentUnsupportedExpectedDuration = 0;
    }

    sideState.previousSole = sole;
    sideState.previousHeight = height;
    sideState.initialized = true;
    sideTelemetry.set(sideInput.side, {
      side: sideInput.side,
      sole,
      baselineHeight: ankleToSoleHeight,
      ankleToSoleHeight,
      soleClearanceBaseline,
      height,
      soleClearance,
      horizontalVelocity,
      verticalVelocity,
      verticalSupport,
      contact: active,
      anchor: active ? ([...sideState.anchor!] as Vec3) : null,
      anchorError:
        active && sideState.anchor ? Math.hypot(sole[0] - sideState.anchor[0], sole[2] - sideState.anchor[2]) : null,
      maxSlide: sideState.maxSlide,
      totalSlide: sideState.totalSlide,
      transition: sideState.transition ?? null,
      blockedUntilLift: sideState.blockedUntilLift,
      influence: sideState.influence,
      reanchorCount: sideState.reanchorCount,
      releaseReason,
      acquireReason,
      unsupportedExpectedDuration: sideState.unsupportedExpectedSeconds,
      unsupportedExpectedSamples: sideState.unsupportedExpectedSamples,
      maxUnsupportedExpectedDuration: sideState.maxUnsupportedExpectedDuration,
      maxPreReleaseAnchorError: sideState.maxPreReleaseAnchorError
    });
  }

  if (activeCount > 0) {
    requestedRoot[0] /= activeCount;
    requestedRoot[2] /= activeCount;
  }

  if (options.expectedSupport && verticalSupportCount === 0) {
    for (const sideInput of sides) {
      const sideState = state[sideInput.side];
      if (!sideInput.expected) {
        sideState.unsupportedExpectedSamples += 1;
        sideState.unsupportedExpectedSeconds += deltaSeconds;
        sideState.currentUnsupportedExpectedDuration += deltaSeconds;
        sideState.maxUnsupportedExpectedDuration = Math.max(
          sideState.maxUnsupportedExpectedDuration,
          sideState.currentUnsupportedExpectedDuration
        );
      }
      const telemetry = sideTelemetry.get(sideInput.side);
      if (telemetry) {
        telemetry.unsupportedExpectedDuration = sideState.unsupportedExpectedSeconds;
        telemetry.unsupportedExpectedSamples = sideState.unsupportedExpectedSamples;
        telemetry.maxUnsupportedExpectedDuration = sideState.maxUnsupportedExpectedDuration;
      }
    }
    issues.push("expected stationary support did not acquire on either side");
  }

  const requestedLength = Math.hypot(requestedRoot[0], requestedRoot[2]);
  const scale =
    requestedLength > maxRootCompensation && requestedLength > 1e-6 ? maxRootCompensation / requestedLength : 1;
  const rootCompensation: Vec3 = [requestedRoot[0] * scale, 0, requestedRoot[2] * scale];
  if (requestedLength > maxRootCompensation + 1e-6)
    issues.push(
      `requested root compensation ${requestedLength.toFixed(4)}m exceeds ${maxRootCompensation.toFixed(4)}m`
    );

  const footPlantOptions: FootPlantOptions = {
    footHeight: 0,
    maxAnkleCorrection: finiteNonNegative(options.maxAnkleCorrection, 0.12),
    maxPelvisOffset: finiteNonNegative(options.maxPelvisOffset, 0.08),
    pelvisCompensation: clamp01(options.pelvisCompensation ?? 0.55),
    ...(options.maxStretch === undefined ? {} : { maxStretch: options.maxStretch })
  };
  let footPlant = solveFootPlant(footInput, footPlantOptions);
  const guardedIds = new Set(footInput.map((leg) => leg.id));
  const pelvisLowering = Math.min(0, footPlant.pelvisOffset[1] ?? 0);
  const pelvisFloorGuards =
    pelvisLowering < -1e-6
      ? floorGuardCandidates.filter(
          (candidate) => !guardedIds.has(candidate.id) && candidate.height + pelvisLowering < -1e-4
        )
      : [];
  if (pelvisFloorGuards.length > 0) {
    for (const candidate of pelvisFloorGuards) footInput.push(candidate.input);
    footPlant = solveFootPlant(footInput, footPlantOptions);
  }
  issues.push(...footPlant.issues);
  const activeSides = sides
    .filter((side) => state[side.side].active && state[side.side].influence > 1e-5)
    .map((side) => side.side);
  return {
    state,
    footPlant,
    activeSides,
    rootCompensation,
    requestedRootCompensation: requestedRoot,
    maxRootCompensation,
    supportState:
      activeSides.length === 2
        ? "double-support"
        : activeSides.length === 1
          ? (`${activeSides[0]}-support` as "left-support" | "right-support")
          : "released",
    left: sideTelemetry.get("left")!,
    right: sideTelemetry.get("right")!,
    issues
  };
}

function pushStationarySupportInterval(
  side: StationarySupportContactSide,
  current: { startTime: number; endTime: number; anchor: Vec3; maxSlide: number; sampleCount: number },
  intervals: StationarySupportContactInterval[],
  minContactSeconds: number
): void {
  const duration = Math.max(0, current.endTime - current.startTime);
  if (duration + 1e-6 < minContactSeconds && current.sampleCount < 2) return;
  intervals.push({
    side,
    startTime: current.startTime,
    endTime: current.endTime,
    duration,
    anchor: current.anchor,
    maxSlide: current.maxSlide,
    sampleCount: current.sampleCount
  });
}

function createStationarySupportStateSide(): StationarySupportStateSide {
  return {
    active: false,
    initialized: false,
    influence: 0,
    maxSlide: 0,
    totalSlide: 0,
    reanchorCount: 0,
    blockedUntilLift: false,
    maxPreReleaseAnchorError: 0,
    unsupportedExpectedSeconds: 0,
    unsupportedExpectedSamples: 0,
    maxUnsupportedExpectedDuration: 0,
    currentUnsupportedExpectedDuration: 0
  };
}

function cloneStationarySupportSolverState(
  state: StationarySupportSolverState | undefined
): StationarySupportSolverState {
  const cloneSide = (side: StationarySupportStateSide | undefined): StationarySupportStateSide => ({
    active: Boolean(side?.active),
    ...(side?.anchor ? { anchor: finiteVec3(side.anchor, [0, 0, 0]) } : {}),
    ...(side?.previousSole ? { previousSole: finiteVec3(side.previousSole, [0, 0, 0]) } : {}),
    ...(side?.previousHeight === undefined ? {} : { previousHeight: finiteNumber(side.previousHeight, 0) }),
    initialized: Boolean(side?.initialized),
    influence: clamp01(side?.influence ?? 0),
    maxSlide: finiteNonNegative(side?.maxSlide, 0),
    totalSlide: finiteNonNegative(side?.totalSlide, 0),
    reanchorCount: Math.max(0, Math.floor(finiteNonNegative(side?.reanchorCount, 0))),
    blockedUntilLift: Boolean(side?.blockedUntilLift),
    maxPreReleaseAnchorError: finiteNonNegative(side?.maxPreReleaseAnchorError, 0),
    unsupportedExpectedSeconds: finiteNonNegative(side?.unsupportedExpectedSeconds, 0),
    unsupportedExpectedSamples: Math.max(0, Math.floor(finiteNonNegative(side?.unsupportedExpectedSamples, 0))),
    maxUnsupportedExpectedDuration: finiteNonNegative(side?.maxUnsupportedExpectedDuration, 0),
    currentUnsupportedExpectedDuration: finiteNonNegative(side?.currentUnsupportedExpectedDuration, 0),
    ...(side?.transition ? { transition: side.transition } : {})
  });
  return { left: cloneSide(state?.left), right: cloneSide(state?.right) };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function updateFootPlantStabilizer(
  previousState: FootPlantStabilizerState | undefined,
  observations: readonly FootPlantStabilizerObservation[],
  options: FootPlantStabilizerOptions = {}
): FootPlantStabilizerUpdate {
  const deltaSeconds = finiteNonNegative(options.deltaSeconds, 0);
  const blendInSeconds = finiteNonNegative(options.blendInSeconds, 0.08);
  const blendOutSeconds = finiteNonNegative(options.blendOutSeconds, 0.12);
  const contactGraceSeconds = finiteNonNegative(options.contactGraceSeconds, 0.04);
  const minInfluence = clamp01(options.minInfluence ?? 0);
  const maxInfluence = Math.max(minInfluence, clamp01(options.maxInfluence ?? 1));
  const previousById = new Map((previousState?.legs ?? []).map((leg) => [leg.id, sanitizeStabilizerLegState(leg)]));
  const nextState: FootPlantStabilizerLegState[] = [];
  const stabilized: FootPlantStabilizedLeg[] = [];

  for (const observation of observations) {
    const id = String(observation.id);
    const previous = previousById.get(id) ?? {
      id,
      influence: 0,
      contactConfidence: 0,
      graceSecondsRemaining: 0,
      planted: false
    };
    const rawContactConfidence =
      observation.contactConfidence === undefined ? (observation.planted ? 1 : 0) : observation.contactConfidence;
    const contactConfidence = clamp01(Number.isFinite(rawContactConfidence) ? rawContactConfidence : 0);
    const requestedInfluence = clamp01(observation.influence ?? 1);
    const hasUsableContact = observation.active !== false && (observation.planted === true || contactConfidence > 0);
    const blockedContact =
      observation.active === false ||
      (observation.skippedReason !== undefined && observation.skippedReason !== "missing-ground-contact");
    const observedGroundContact =
      hasUsableContact && !blockedContact && observation.groundContact
        ? sanitizeGroundContact(observation.groundContact, [0, 0, 0])
        : undefined;
    const targetInfluence = hasUsableContact && !blockedContact ? contactConfidence * requestedInfluence : 0;
    const graceSecondsRemaining =
      hasUsableContact && !blockedContact
        ? contactGraceSeconds
        : blockedContact
          ? 0
          : Math.max(0, previous.graceSecondsRemaining - deltaSeconds);
    const inGrace = !hasUsableContact && !blockedContact && graceSecondsRemaining > 0;
    const nextInfluence = blockedContact
      ? 0
      : inGrace
        ? previous.influence
        : stepInfluence(
            previous.influence,
            targetInfluence,
            deltaSeconds,
            targetInfluence >= previous.influence ? blendInSeconds : blendOutSeconds
          );
    const influence = clampRange(nextInfluence, minInfluence, maxInfluence);
    const planted = (hasUsableContact || inGrace) && influence > 1e-5;
    const groundContact = blockedContact
      ? undefined
      : (observedGroundContact ?? (inGrace ? previous.groundContact : undefined));
    const stateEntry: FootPlantStabilizerLegState = {
      id,
      influence,
      contactConfidence: hasUsableContact ? contactConfidence : inGrace ? previous.contactConfidence : 0,
      graceSecondsRemaining,
      planted,
      ...(groundContact === undefined ? {} : { groundContact })
    };
    nextState.push(stateEntry);
    stabilized.push({
      id,
      influence,
      active: influence > 1e-5,
      planted,
      contactConfidence: stateEntry.contactConfidence,
      graceSecondsRemaining,
      ...(groundContact === undefined ? {} : { groundContact })
    });
  }

  return { state: { legs: nextState }, legs: stabilized };
}

export function createFootPlantStabilizerObservations(result: FootPlantResult): FootPlantStabilizerObservation[] {
  return result.legs.map((leg) => ({
    id: leg.id,
    planted: leg.planted,
    ...(leg.planted || leg.skippedReason !== "missing-ground-contact" ? { active: leg.planted } : {}),
    contactConfidence: leg.planted ? 1 : 0,
    ...(leg.planted && leg.groundPoint ? { groundContact: { point: leg.groundPoint, normal: leg.groundNormal } } : {}),
    ...(leg.skippedReason === undefined ? {} : { skippedReason: leg.skippedReason })
  }));
}

export function applyFootPlantStabilizedInfluence(
  input: readonly FootPlantLegInput[],
  stabilized: readonly FootPlantStabilizedLeg[]
): FootPlantLegInput[] {
  const stabilizedById = new Map(stabilized.map((leg) => [leg.id, leg]));
  return input.map((leg) => {
    const result = stabilizedById.get(leg.id);
    if (!result) return { ...leg };
    const influence = clamp01((Number.isFinite(leg.influence) ? (leg.influence as number) : 1) * result.influence);
    const next: FootPlantLegInput = { ...leg, influence };
    if (!result.active) delete next.ground;
    else if (result.planted && !next.ground && result.groundContact) next.ground = result.groundContact;
    return next;
  });
}

export function computeAnkleTargetFromGround(contact: GroundContact, footHeight: number): Vec3 {
  const point = finiteVec3(contact.point, [0, 0, 0]);
  const normal = normalizeVec3(finiteVec3(contact.normal, [0, 1, 0]), [0, 1, 0]);
  const safeFootHeight = finiteNonNegative(footHeight, 0);
  const rayStart = finiteVec3(contact.rayStart, addVec3(point, [0, Math.max(0.001, safeFootHeight + 0.5), 0]));
  const ai = subVec3(rayStart, point);
  const abLength = dotVec3(ai, normal);
  if (!Number.isFinite(abLength) || Math.abs(abLength) <= 1e-5)
    return addVec3(point, scaleVec3(normal, safeFootHeight));

  const projected = subVec3(rayStart, scaleVec3(normal, abLength));
  const ib = subVec3(projected, point);
  const ibLength = finiteLength(ib, 0);
  if (ibLength <= 1e-5) return addVec3(point, scaleVec3(normal, safeFootHeight));

  const ih = scaleVec3(ib, (ibLength * safeFootHeight) / abLength / ibLength);
  return addVec3(addVec3(point, ih), scaleVec3(normal, safeFootHeight));
}

export function solveFootPlant(input: readonly FootPlantLegInput[], options: FootPlantOptions = {}): FootPlantResult {
  const down = normalizeVec3(options.down ?? [0, -1, 0], [0, -1, 0]);
  const defaultFootHeight = finiteNonNegative(options.footHeight, 0.08);
  const defaultInfluence = clamp01(options.influence ?? 1);
  const pelvisCompensation = clamp01(options.pelvisCompensation ?? 1);
  const maxPelvisOffset = finiteNonNegative(options.maxPelvisOffset, 0.35);
  const maxAnkleCorrection = finiteNonNegative(options.maxAnkleCorrection, 0.5);
  const minGroundNormalDot = resolveMinGroundNormalDot(options.maxGroundSlopeAngle);
  const rejectUnreachable = options.rejectUnreachable === true;
  const up = scaleVec3(down, -1);
  const legs: FootPlantLegResult[] = [];
  const issues: string[] = [];
  const sanitizedInput = input.map(sanitizeFootPlantLegInput);
  let reachPelvisCorrection = 0;

  for (const leg of sanitizedInput) {
    const groundNormal = normalizeVec3(leg.ground?.normal ?? [0, 1, 0], [0, 1, 0]);
    if (!leg.ground) {
      legs.push(createSkippedFootPlantLegResult(leg, groundNormal, "missing-ground-contact"));
      issues.push(`${leg.id}: missing ground contact`);
      continue;
    }
    if (minGroundNormalDot !== undefined && dotVec3(groundNormal, up) < minGroundNormalDot) {
      legs.push(createSkippedFootPlantLegResult(leg, groundNormal, "ground-slope-too-steep", leg.ground.point));
      issues.push(`${leg.id}: ground slope too steep`);
      continue;
    }

    const rawTarget = computeAnkleTargetFromGround(leg.ground, finiteNonNegative(leg.footHeight, defaultFootHeight));
    const rawOffset = subVec3(rawTarget, leg.ankle);
    const rawDistance = finiteLength(rawOffset, 0);
    const allowedCorrection = Math.min(
      finiteNonNegative(leg.maxAnkleCorrection, maxAnkleCorrection),
      maxAnkleCorrection
    );
    const clamped = rawDistance > allowedCorrection + 1e-6;
    if (rejectUnreachable && clamped) {
      legs.push(
        createSkippedFootPlantLegResult(leg, groundNormal, "ankle-correction-unreachable", leg.ground.point, {
          targetAnkle: rawTarget,
          ankleOffset: rawOffset,
          correctionDistance: rawDistance
        })
      );
      issues.push(`${leg.id}: ankle correction unreachable`);
      continue;
    }
    const targetAnkle = clamped
      ? addVec3(leg.ankle, scaleVec3(normalizeVec3(rawOffset, [0, 0, 0]), allowedCorrection))
      : rawTarget;
    const ankleOffset = subVec3(targetAnkle, leg.ankle);
    const correctionDistance = finiteLength(ankleOffset, 0);
    legs.push({
      id: leg.id,
      planted: true,
      clamped,
      initialAnkle: leg.ankle,
      targetAnkle,
      ankleOffset,
      correctionDistance,
      groundNormal,
      targetReach: 1,
      groundPoint: leg.ground.point
    });
    if (clamped) issues.push(`${leg.id}: ankle correction clamped`);
  }

  for (let i = 0; i < legs.length; i += 1) {
    const result = legs[i]!;
    if (!result.planted) continue;
    const leg = sanitizedInput[i]!;
    const influence = clamp01(leg.influence ?? defaultInfluence);
    if (influence <= 1e-5) continue;
    const configuredMaxStretch = leg.maxStretch ?? options.maxStretch ?? (rejectUnreachable ? 1 : undefined);
    if (configuredMaxStretch === undefined) continue;
    const upperLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(leg.knee, leg.hip), MIN_IK_REACH));
    const lowerLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(leg.ankle, leg.knee), MIN_IK_REACH));
    const maxStretch = Math.min(1, finiteNonNegative(configuredMaxStretch, 0.998));
    const maxReach = (upperLength + lowerLength) * maxStretch;
    const target = lerpVec3(leg.ankle, result.targetAnkle, influence);
    const rootToTarget = subVec3(target, leg.hip);
    const downDistance = dotVec3(rootToTarget, down);
    if (downDistance <= 0) continue;
    const distance = lengthVec3(rootToTarget);
    const horizontalDistanceSquared = Math.max(0, distance * distance - downDistance * downDistance);
    const maxDownDistanceSquared = maxReach * maxReach - horizontalDistanceSquared;
    if (maxDownDistanceSquared < -1e-8) {
      if (rejectUnreachable) {
        result.skippedReason = "ik-target-unreachable";
        result.planted = false;
        issues.push(`${leg.id}: ik target unreachable`);
      }
      continue;
    }
    const maxDownDistance = Math.sqrt(Math.max(0, maxDownDistanceSquared));
    const requiredPelvisCorrection = (downDistance - maxDownDistance) / influence;
    if (rejectUnreachable && requiredPelvisCorrection > maxPelvisOffset + 1e-6) {
      result.skippedReason = "ik-target-unreachable";
      result.planted = false;
      issues.push(`${leg.id}: ik target unreachable`);
      continue;
    }
    reachPelvisCorrection = Math.max(reachPelvisCorrection, requiredPelvisCorrection);
  }

  let lowestCorrection = 0;
  for (const result of legs) {
    if (!result.planted) continue;
    lowestCorrection = Math.max(lowestCorrection, Math.max(0, dotVec3(result.ankleOffset, down)));
  }

  const pelvisCorrection = Math.max(lowestCorrection * pelvisCompensation, reachPelvisCorrection);
  const pelvisOffset =
    pelvisCorrection <= 1e-12 ? ([0, 0, 0] as Vec3) : scaleVec3(down, Math.min(maxPelvisOffset, pelvisCorrection));
  let plantedCount = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const result = legs[i]!;
    if (!result.planted) continue;
    const leg = sanitizedInput[i]!;
    const influence = clamp01(leg.influence ?? defaultInfluence);
    const root = addVec3(leg.hip, pelvisOffset);
    const joint = addVec3(leg.knee, pelvisOffset);
    const end = addVec3(leg.ankle, pelvisOffset);
    const target = lerpVec3(end, result.targetAnkle, influence);
    const maxStretch = leg.maxStretch ?? options.maxStretch;
    const ik = solveTwoBoneIkCorrections({
      root,
      joint,
      end,
      target,
      ...(leg.pole ? { pole: leg.pole } : {}),
      ...(maxStretch === undefined ? {} : { maxStretch })
    });
    result.ik = ik;
    result.targetReach = ik.targetReach;
    result.clamped = result.clamped || ik.clamped;
    const targetBeyondMaxStretch =
      maxStretch !== undefined && targetDistanceExceedsMaxStretch(root, joint, end, target, maxStretch);
    if (rejectUnreachable && (ik.clamped || targetBeyondMaxStretch)) {
      result.planted = false;
      result.skippedReason = "ik-target-unreachable";
      issues.push(`${leg.id}: ik target unreachable`);
      continue;
    }
    plantedCount += 1;
    if (ik.clamped) issues.push(`${leg.id}: ik target reach clamped`);
  }

  return {
    pelvisOffset,
    plantedCount,
    lowestCorrection,
    legs,
    issues
  };
}

export function solveOzzFootIk(input: OzzFootIkOptions): OzzFootIkResult {
  const issues: string[] = [];
  const resolvedLegs = resolveOzzFootIkLegs(input, issues);
  const footPlantInput: FootPlantLegInput[] = [];

  for (const leg of resolvedLegs) {
    const hip = matrixTranslation(input.modelPose[leg.hipJoint]!);
    const knee = matrixTranslation(input.modelPose[leg.kneeJoint]!);
    const ankle = matrixTranslation(input.modelPose[leg.ankleJoint]!);
    const contact = resolveOzzFootIkContact(input, leg, ankle);
    if (!contact.ground) issues.push(`${leg.id}: missing floor contact`);
    footPlantInput.push({
      id: leg.id,
      hip,
      knee,
      ankle,
      ...(contact.ground ? { ground: contact.ground } : {}),
      ...(leg.pole ? { pole: leg.pole } : {}),
      ...(leg.footHeight === undefined ? {} : { footHeight: leg.footHeight }),
      ...(leg.influence === undefined ? {} : { influence: leg.influence }),
      ...(leg.maxStretch === undefined ? {} : { maxStretch: leg.maxStretch }),
      ...(leg.maxAnkleCorrection === undefined ? {} : { maxAnkleCorrection: leg.maxAnkleCorrection })
    });
  }

  const plan = solveFootPlant(footPlantInput, input);
  const legs = plan.legs.map((leg, index): OzzFootIkLegResult => {
    const resolved = resolvedLegs[index]!;
    const result: OzzFootIkLegResult = {
      ...leg,
      hipJoint: resolved.hipJoint,
      kneeJoint: resolved.kneeJoint,
      ankleJoint: resolved.ankleJoint
    };
    if (resolved.side !== undefined) result.side = resolved.side;
    if (resolved.ray !== undefined) result.ray = resolved.ray;
    if (input.aimAnkles !== false && leg.planted) {
      const ankleModel = input.modelPose[resolved.ankleJoint];
      if (ankleModel) {
        const footForward = resolved.footForward ?? ([0, 0, 1] as Vec3);
        const ankleAimInfluence = clamp01(resolved.influence ?? input.influence ?? 1);
        result.ankleAim = solveAimIk({
          joint: ankleModel,
          target: addVec3(leg.targetAnkle, leg.groundNormal),
          forward: resolved.ankleUp ?? [0, 1, 0],
          up: footForward,
          pole: transformLinearVector(ankleModel, footForward),
          weight: ankleAimInfluence
        });
      }
    }
    return result;
  });

  return {
    pelvisOffset: plan.pelvisOffset,
    plantedCount: plan.plantedCount,
    lowestCorrection: plan.lowestCorrection,
    legs,
    issues: [...issues, ...plan.issues]
  };
}

type ResolvedOzzFootIkLeg = Required<Pick<OzzFootIkLegResult, "id" | "hipJoint" | "kneeJoint" | "ankleJoint">> &
  Pick<
    OzzFootIkLegPreset,
    "side" | "pole" | "ankleUp" | "footForward" | "footHeight" | "influence" | "maxStretch" | "maxAnkleCorrection"
  > & {
    ray?: OzzFootIkRay;
  };

const DEFAULT_OZZ_FOOT_IK_LEGS: readonly OzzFootIkLegPreset[] = [
  { id: "left", side: "left", hip: "leftUpperLeg", knee: "leftLowerLeg", ankle: "leftFoot" },
  { id: "right", side: "right", hip: "rightUpperLeg", knee: "rightLowerLeg", ankle: "rightFoot" }
];

function resolveOzzFootIkLegs(input: OzzFootIkOptions, issues: string[]): ResolvedOzzFootIkLeg[] {
  const presets = input.legs ?? DEFAULT_OZZ_FOOT_IK_LEGS;
  const legs: ResolvedOzzFootIkLeg[] = [];
  for (const preset of presets) {
    const side = preset.side;
    const id = preset.id ?? side ?? String(legs.length);
    const hipJoint = resolveOzzFootIkJoint(input.skeleton, preset.hip ?? sideHumanoid(side, "UpperLeg"));
    const kneeJoint = resolveOzzFootIkJoint(input.skeleton, preset.knee ?? sideHumanoid(side, "LowerLeg"));
    const ankleJoint = resolveOzzFootIkJoint(input.skeleton, preset.ankle ?? sideHumanoid(side, "Foot"));
    if (hipJoint < 0 || kneeJoint < 0 || ankleJoint < 0) {
      issues.push(`${id}: missing leg joints`);
      continue;
    }
    if (!input.modelPose[hipJoint] || !input.modelPose[kneeJoint] || !input.modelPose[ankleJoint]) {
      issues.push(`${id}: missing model pose joints`);
      continue;
    }
    const leg: ResolvedOzzFootIkLeg = { id, hipJoint, kneeJoint, ankleJoint };
    if (side !== undefined) leg.side = side;
    if (preset.pole !== undefined) leg.pole = preset.pole;
    if (preset.ankleUp !== undefined) leg.ankleUp = preset.ankleUp;
    if (preset.footForward !== undefined) leg.footForward = preset.footForward;
    if (preset.footHeight !== undefined) leg.footHeight = preset.footHeight;
    if (preset.influence !== undefined) leg.influence = preset.influence;
    if (preset.maxStretch !== undefined) leg.maxStretch = preset.maxStretch;
    if (preset.maxAnkleCorrection !== undefined) leg.maxAnkleCorrection = preset.maxAnkleCorrection;
    legs.push(leg);
  }
  return legs;
}

function resolveOzzFootIkContact(
  input: OzzFootIkOptions,
  leg: ResolvedOzzFootIkLeg,
  ankle: Vec3
): { ground?: GroundContact } {
  if (input.contacts && Object.prototype.hasOwnProperty.call(input.contacts, leg.id)) {
    const configured = input.contacts[leg.id];
    return configured ? { ground: configured } : {};
  }
  const rayHeight = finiteNonNegative(input.rayHeight, 0.5);
  const direction = normalizeVec3(input.down ?? [0, -1, 0], [0, -1, 0]);
  const ray: OzzFootIkRay = {
    id: leg.id,
    ankle,
    start: addVec3(ankle, scaleVec3(direction, -rayHeight)),
    direction,
    length: finiteNonNegative(
      input.rayLength,
      rayHeight + finiteNonNegative(input.maxAnkleCorrection, 0.5) + finiteNonNegative(input.footHeight, 0.08) + 0.25
    )
  };
  if (leg.side !== undefined) ray.side = leg.side;
  leg.ray = ray;
  const hit = input.raycast?.(ray) ?? null;
  if (!hit) return {};
  return { ground: { ...hit, rayStart: hit.rayStart ?? ray.start } };
}

function resolveOzzFootIkJoint(skeleton: Skeleton, reference: number | string | undefined): number {
  if (reference === undefined) return -1;
  if (typeof reference === "number")
    return Number.isInteger(reference) && reference >= 0 && reference < skeleton.joints.length ? reference : -1;
  if (isHumanoidBoneName(reference)) {
    const humanoid = resolveHumanoidIndex(skeleton, reference);
    if (humanoid >= 0) return humanoid;
  }
  return resolveJointIndex(skeleton, reference);
}

function sideHumanoid(
  side: OzzFootIkSide | undefined,
  suffix: "UpperLeg" | "LowerLeg" | "Foot"
): HumanoidBoneName | undefined {
  if (!side) return undefined;
  return `${side}${suffix}` as HumanoidBoneName;
}

function sanitizeFootPlantLegInput(input: FootPlantLegInput): FootPlantLegInput {
  const hip = finiteVec3(input.hip, [0, 0, 0]);
  const knee = finiteVec3(input.knee, addVec3(hip, [0, -1, 0]));
  const ankle = finiteVec3(input.ankle, addVec3(knee, [0, -1, 0]));
  return {
    ...input,
    hip,
    knee,
    ankle,
    ...(input.ground ? { ground: sanitizeGroundContact(input.ground, ankle) } : {})
  };
}

function sanitizeGroundContact(input: GroundContact, pointFallback: Vec3): GroundContact {
  const point = finiteVec3(input.point, pointFallback);
  return {
    point,
    ...(input.normal === undefined ? {} : { normal: finiteVec3(input.normal, [0, 1, 0]) }),
    ...(input.rayStart === undefined ? {} : { rayStart: finiteVec3(input.rayStart, addVec3(point, [0, 0.5, 0])) })
  };
}

function createSkippedFootPlantLegResult(
  leg: FootPlantLegInput,
  groundNormal: Vec3,
  skippedReason: string,
  groundPoint?: Vec3,
  override?: Partial<Pick<FootPlantLegResult, "targetAnkle" | "ankleOffset" | "correctionDistance">>
): FootPlantLegResult {
  return {
    id: leg.id,
    planted: false,
    clamped: false,
    initialAnkle: leg.ankle,
    targetAnkle: override?.targetAnkle ?? leg.ankle,
    ankleOffset: override?.ankleOffset ?? [0, 0, 0],
    correctionDistance: override?.correctionDistance ?? 0,
    groundNormal,
    targetReach: 1,
    skippedReason,
    ...(groundPoint === undefined ? {} : { groundPoint })
  };
}

function targetDistanceExceedsMaxStretch(
  root: Vec3,
  joint: Vec3,
  end: Vec3,
  target: Vec3,
  configuredMaxStretch: number
): boolean {
  const upperLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(joint, root), MIN_IK_REACH));
  const lowerLength = Math.max(MIN_IK_REACH, finiteLength(subVec3(end, joint), MIN_IK_REACH));
  const maxStretch = Math.min(1, finiteNonNegative(configuredMaxStretch, 0.998));
  const maxReach = (upperLength + lowerLength) * maxStretch;
  return finiteLength(subVec3(target, root), 0) > maxReach + 1e-4;
}

function resolveMinGroundNormalDot(maxGroundSlopeAngle: number | undefined): number | undefined {
  if (maxGroundSlopeAngle === undefined || !Number.isFinite(maxGroundSlopeAngle)) return undefined;
  return Math.cos(Math.min(Math.PI, Math.max(0, maxGroundSlopeAngle)));
}

function sanitizeStabilizerLegState(input: FootPlantStabilizerLegState): FootPlantStabilizerLegState {
  return {
    id: String(input.id),
    influence: clamp01(input.influence),
    contactConfidence: clamp01(input.contactConfidence),
    graceSecondsRemaining: finiteNonNegative(input.graceSecondsRemaining, 0),
    planted: input.planted === true,
    ...(input.groundContact === undefined
      ? {}
      : { groundContact: sanitizeGroundContact(input.groundContact, [0, 0, 0]) })
  };
}

function stepInfluence(current: number, target: number, deltaSeconds: number, blendSeconds: number): number {
  const safeCurrent = clamp01(current);
  const safeTarget = clamp01(target);
  if (blendSeconds <= 1e-8) return safeTarget;
  const step = deltaSeconds / blendSeconds;
  if (!Number.isFinite(step) || step <= 0) return safeCurrent;
  if (safeCurrent < safeTarget) return Math.min(safeTarget, safeCurrent + step);
  return Math.max(safeTarget, safeCurrent - step);
}

function clampRange(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, finite));
}

function transformLinearVector(matrix: Mat4, vector: Vec3): Vec3 {
  const x = vector[0],
    y = vector[1],
    z = vector[2];
  return [
    finiteMat4Value(matrix, 0, 1) * x + finiteMat4Value(matrix, 4, 0) * y + finiteMat4Value(matrix, 8, 0) * z,
    finiteMat4Value(matrix, 1, 0) * x + finiteMat4Value(matrix, 5, 1) * y + finiteMat4Value(matrix, 9, 0) * z,
    finiteMat4Value(matrix, 2, 0) * x + finiteMat4Value(matrix, 6, 0) * y + finiteMat4Value(matrix, 10, 1) * z
  ];
}

function finiteVec3(value: Vec3 | undefined, fallback: Vec3): Vec3 {
  if (!value) return fallback;
  if (value.every(Number.isFinite)) return value;
  return [
    Number.isFinite(value[0]) ? value[0] : fallback[0],
    Number.isFinite(value[1]) ? value[1] : fallback[1],
    Number.isFinite(value[2]) ? value[2] : fallback[2]
  ];
}

function finiteLength(value: Vec3, fallback: number): number {
  const length = lengthVec3(value);
  return Number.isFinite(length) ? length : fallback;
}
