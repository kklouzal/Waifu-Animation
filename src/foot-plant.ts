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
    const nextInfluence = inGrace
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
  const up = scaleVec3(down, -1);
  const legs: FootPlantLegResult[] = [];
  const issues: string[] = [];
  const sanitizedInput = input.map(sanitizeFootPlantLegInput);
  let lowestCorrection = 0;
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
    const targetAnkle = clamped
      ? addVec3(leg.ankle, scaleVec3(normalizeVec3(rawOffset, [0, 0, 0]), allowedCorrection))
      : rawTarget;
    const ankleOffset = subVec3(targetAnkle, leg.ankle);
    const correctionDistance = finiteLength(ankleOffset, 0);
    const downwardCorrection = Math.max(0, dotVec3(ankleOffset, down));
    lowestCorrection = Math.max(lowestCorrection, downwardCorrection);
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
    const configuredMaxStretch = leg.maxStretch ?? options.maxStretch;
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
    if (maxDownDistanceSquared < -1e-8) continue;
    const maxDownDistance = Math.sqrt(Math.max(0, maxDownDistanceSquared));
    reachPelvisCorrection = Math.max(reachPelvisCorrection, (downDistance - maxDownDistance) / influence);
  }

  const pelvisCorrection = Math.max(lowestCorrection * pelvisCompensation, reachPelvisCorrection);
  const pelvisOffset =
    pelvisCorrection <= 1e-12 ? ([0, 0, 0] as Vec3) : scaleVec3(down, Math.min(maxPelvisOffset, pelvisCorrection));
  let plantedCount = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const result = legs[i]!;
    if (!result.planted) continue;
    plantedCount += 1;
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
        result.ankleAim = solveAimIk({
          joint: ankleModel,
          target: addVec3(leg.targetAnkle, leg.groundNormal),
          forward: resolved.ankleUp ?? [0, 1, 0],
          up: footForward,
          pole: transformLinearVector(ankleModel, footForward),
          ...(resolved.influence === undefined ? {} : { weight: resolved.influence })
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
  groundPoint?: Vec3
): FootPlantLegResult {
  return {
    id: leg.id,
    planted: false,
    clamped: false,
    initialAnkle: leg.ankle,
    targetAnkle: leg.ankle,
    ankleOffset: [0, 0, 0],
    correctionDistance: 0,
    groundNormal,
    targetReach: 1,
    skippedReason,
    ...(groundPoint === undefined ? {} : { groundPoint })
  };
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
