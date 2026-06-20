import {
  EPSILON,
  type Quat,
  type Vec3,
  cloneNormalizedQuat,
  crossVec3,
  ensureShortestQuat,
  invertQuat,
  lengthVec3,
  multiplyQuat,
  normalizeQuat,
  normalizeVec3,
  quatFromUnitVectors,
  rotateVec3ByQuat,
  subVec3
} from "./math.js";
import { type AnimationClip } from "./clip.js";
import { type HumanoidBoneName, type Skeleton, localToModelPose, resolveHumanoidIndex } from "./skeleton.js";

export { isHumanoidBoneName } from "./skeleton.js";

export type RetargetedQuaternionTrack = {
  values: number[];
  invalidSamples: number;
};

export type RetargetingHingePlane = "sagittal" | "lateral" | "vertical" | "ambiguous" | "unsupported";

export type RetargetingRestAxisDiagnostic = {
  humanBone: HumanoidBoneName;
  joint: string;
  child?: string;
  targetRestQuaternion: Quat;
  targetChildDirection?: Vec3;
  sourceRestQuaternion?: Quat;
  sourceChildDirection?: Vec3;
  retargetedChildDirection?: Vec3;
  hingePlane: RetargetingHingePlane;
  issue?: string;
};

const DIAGNOSTIC_CHILD_BONES: Partial<Record<HumanoidBoneName, HumanoidBoneName>> = {
  hips: "spine",
  spine: "chest",
  chest: "upperChest",
  upperChest: "neck",
  neck: "head",
  leftShoulder: "leftUpperArm",
  rightShoulder: "rightUpperArm",
  leftUpperArm: "leftLowerArm",
  rightUpperArm: "rightLowerArm",
  leftLowerArm: "leftHand",
  rightLowerArm: "rightHand",
  leftHand: "leftIndexProximal",
  rightHand: "rightIndexProximal",
  leftUpperLeg: "leftLowerLeg",
  rightUpperLeg: "rightLowerLeg",
  leftLowerLeg: "leftFoot",
  rightLowerLeg: "rightFoot",
  leftFoot: "leftToes",
  rightFoot: "rightToes"
};

const DIAGNOSTIC_BONES = Object.keys(DIAGNOSTIC_CHILD_BONES) as HumanoidBoneName[];

export function retargetQuaternionSample(
  sourceRest: Quat,
  targetRest: Quat,
  sourceSample: Quat,
  humanBone?: string,
  sourceBasis?: ArrayLike<number>,
  sourceRestChildDirection?: ArrayLike<number>,
  targetRestChildDirection?: ArrayLike<number>
): Quat {
  const srcRest = normalizeQuat(sourceRest);
  const dstRest = normalizeQuat(targetRest);
  const srcSample = normalizeQuat(sourceSample, srcRest);
  void humanBone;
  let sourceDelta = multiplyQuat(invertQuat(srcRest), srcSample);
  const hingeBasis = hingeAxisBasis(humanBone, sourceDelta, targetRestChildDirection);
  const restBasis = hingeBasis ?? restChildDirectionBasis(sourceRestChildDirection, targetRestChildDirection);
  if (sourceBasis || restBasis) {
    const basis = restBasis ?? cloneNormalizedQuat(sourceBasis);
    sourceDelta = multiplyQuat(multiplyQuat(basis, sourceDelta), invertQuat(basis));
  }
  return normalizeQuat(multiplyQuat(dstRest, sourceDelta));
}

function hingeAxisBasis(humanBone: string | undefined, sourceDelta: Quat, targetRestChildDirection: ArrayLike<number> | null | undefined): Quat | null {
  if (!humanBone || !targetRestChildDirection || !isHingeBoneName(humanBone)) return null;
  const sourceAxis = normalizeVec3([sourceDelta[0], sourceDelta[1], sourceDelta[2]]);
  if (lengthVec3(sourceAxis) <= EPSILON) return null;
  const targetChild = normalizeVec3([targetRestChildDirection[0] ?? 0, targetRestChildDirection[1] ?? 0, targetRestChildDirection[2] ?? 0]);
  const sagittalDelta: Vec3 = [0, 0, targetSagittalSign(humanBone)];
  const targetAxis = normalizeVec3(crossVec3(targetChild, sagittalDelta), [1, 0, 0]);
  return quatFromUnitVectors(sourceAxis, targetAxis);
}

function targetSagittalSign(humanBone: string): number {
  return humanBone.startsWith("right") ? 1 : -1;
}

function isHingeBoneName(humanBone: string): boolean {
  return humanBone === "leftLowerLeg" || humanBone === "rightLowerLeg" || humanBone === "leftLowerArm" || humanBone === "rightLowerArm";
}

export function retargetQuaternionTrackValues(
  values: readonly number[],
  sourceRest: ArrayLike<number> | undefined,
  targetRest: ArrayLike<number>,
  humanBone?: string,
  sourceBasis?: ArrayLike<number> | null | undefined,
  sourceRestChildDirection?: ArrayLike<number> | null | undefined,
  targetRestChildDirection?: ArrayLike<number> | null | undefined
): RetargetedQuaternionTrack {
  if (values.length % 4 !== 0) throw new Error("quaternion values must be a multiple of 4");
  const output: number[] = [];
  const srcRest = sourceRest ? cloneNormalizedQuat(sourceRest) : null;
  const dstRest = cloneNormalizedQuat(targetRest);
  let invalidSamples = 0;
  let previous: Quat = [0, 0, 0, 1];
  for (let i = 0; i < values.length; i += 4) {
    const rawSample: Quat = [values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, values[i + 3] ?? 1];
    if (isMalformedQuaternionSample(rawSample)) invalidSamples += 1;
    const sample = normalizeQuat(rawSample, srcRest ?? undefined);
    let retargeted = srcRest ? retargetQuaternionSample(srcRest, dstRest, sample, humanBone, sourceBasis ?? undefined, sourceRestChildDirection ?? undefined, targetRestChildDirection ?? undefined) : sample;
    if (!retargeted.every(Number.isFinite)) {
      invalidSamples += 1;
      retargeted = previous;
    }
    if (i > 0) retargeted = ensureShortestQuat(previous, retargeted);
    output.push(...retargeted);
    previous = retargeted;
  }
  return { values: output, invalidSamples };
}

function restChildDirectionBasis(
  sourceRestChildDirection: ArrayLike<number> | null | undefined,
  targetRestChildDirection: ArrayLike<number> | null | undefined
): Quat | null {
  if (!sourceRestChildDirection || !targetRestChildDirection) return null;
  const source = normalizeVec3([sourceRestChildDirection[0] ?? 0, sourceRestChildDirection[1] ?? 0, sourceRestChildDirection[2] ?? 0]);
  const target = normalizeVec3([targetRestChildDirection[0] ?? 0, targetRestChildDirection[1] ?? 0, targetRestChildDirection[2] ?? 0]);
  return quatFromUnitVectors(source, target);
}

export function diagnoseRetargetingRestAxes(
  skeleton: Skeleton,
  clip?: AnimationClip,
  options: {
    sourceBasisQuaternion?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
    bones?: readonly HumanoidBoneName[];
  } = {}
): RetargetingRestAxisDiagnostic[] {
  const restModel = localToModelPose(skeleton, skeleton.restPose);
  const bones = options.bones ?? DIAGNOSTIC_BONES;
  return bones.flatMap((humanBone) => {
    const jointIndex = resolveHumanoidIndex(skeleton, humanBone);
    if (jointIndex < 0) return [];
    const joint = skeleton.joints[jointIndex]!;
    const childBone = DIAGNOSTIC_CHILD_BONES[humanBone];
    const childIndex = childBone ? resolveHumanoidIndex(skeleton, childBone) : -1;
    const targetRestQuaternion = cloneNormalizedQuat(joint.rest.rotation);
    const targetChildDirection = childIndex >= 0 ? modelDirection(restModel, jointIndex, childIndex) : undefined;
    const rotationTrack = clip?.tracks.find(
      (track) => (track.humanBone ?? track.joint) === humanBone && retargetDiagnosticTrackProperty(track.property) === "rotation"
    );
    const sourceRestQuaternion = rotationTrack?.sourceRestQuaternion?.length === 4 ? cloneNormalizedQuat(rotationTrack.sourceRestQuaternion) : undefined;
    const sourceRestChildDirection =
      rotationTrack?.sourceRestChildDirection?.length === 3
        ? normalizeVec3([rotationTrack.sourceRestChildDirection[0]!, rotationTrack.sourceRestChildDirection[1]!, rotationTrack.sourceRestChildDirection[2]!])
        : undefined;
    const strongestSample = rotationTrack ? strongestQuaternionSample(rotationTrack.values, sourceRestQuaternion ?? targetRestQuaternion) : undefined;
    const sourceChildDirection = sourceRestChildDirection ?? (sourceRestQuaternion && targetChildDirection ? rotateVec3ByQuat(sourceRestQuaternion, targetChildDirection) : undefined);
    const retargeted =
      sourceRestQuaternion && strongestSample
        ? retargetQuaternionSample(
            sourceRestQuaternion,
            targetRestQuaternion,
            strongestSample,
            humanBone,
            options.sourceBasisQuaternion?.(humanBone, jointIndex) ?? undefined,
            sourceRestChildDirection,
            targetChildDirection
          )
        : undefined;
    const retargetedChildDirection = retargeted && targetChildDirection ? rotateVec3ByQuat(retargeted, targetChildDirection) : undefined;
    const hingePlane = classifyHingePlane(humanBone, targetChildDirection, retargetedChildDirection);
    const issue = diagnosticIssue(humanBone, childBone, targetChildDirection, sourceRestQuaternion, retargetedChildDirection, hingePlane);
    return [
      {
        humanBone,
        joint: joint.name,
        ...(childIndex >= 0 ? { child: skeleton.joints[childIndex]!.name } : {}),
        targetRestQuaternion,
        ...(targetChildDirection ? { targetChildDirection } : {}),
        ...(sourceRestQuaternion ? { sourceRestQuaternion } : {}),
        ...(sourceChildDirection ? { sourceChildDirection } : {}),
        ...(retargetedChildDirection ? { retargetedChildDirection } : {}),
        hingePlane,
        ...(issue ? { issue } : {})
      }
    ];
  });
}

function isMalformedQuaternionSample(value: Quat): boolean {
  if (!value.every(Number.isFinite)) return true;
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  return !Number.isFinite(length) || length <= EPSILON;
}

function modelDirection(modelPose: ReturnType<typeof localToModelPose>, parent: number, child: number): Vec3 | undefined {
  const parentMatrix = modelPose[parent];
  const childMatrix = modelPose[child];
  if (!parentMatrix || !childMatrix) return undefined;
  const direction = subVec3([childMatrix[12] ?? 0, childMatrix[13] ?? 0, childMatrix[14] ?? 0], [parentMatrix[12] ?? 0, parentMatrix[13] ?? 0, parentMatrix[14] ?? 0]);
  return lengthVec3(direction) > EPSILON ? normalizeVec3(direction) : undefined;
}

function strongestQuaternionSample(values: ArrayLike<number>, fallback: Quat): Quat | undefined {
  if (values.length < 4) return undefined;
  let strongest = cloneNormalizedQuat(values, fallback);
  let strongestAngle = -1;
  for (let offset = 0; offset + 3 < values.length; offset += 4) {
    const sample = normalizeQuat([values[offset] ?? 0, values[offset + 1] ?? 0, values[offset + 2] ?? 0, values[offset + 3] ?? 1], fallback);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(sample[3])));
    if (angle > strongestAngle) {
      strongest = sample;
      strongestAngle = angle;
    }
  }
  return strongest;
}

function classifyHingePlane(humanBone: HumanoidBoneName, restDirection: Vec3 | undefined, movedDirection: Vec3 | undefined): RetargetingHingePlane {
  if (!restDirection) return "unsupported";
  if (!movedDirection) return isHingeBone(humanBone) ? "unsupported" : "ambiguous";
  const delta = subVec3(movedDirection, restDirection);
  const length = lengthVec3(delta);
  if (length <= 1e-4) return "ambiguous";
  const normalized = normalizeVec3(delta);
  const lateral = Math.abs(normalized[0]);
  const vertical = Math.abs(normalized[1]);
  const sagittal = Math.abs(normalized[2]);
  if (sagittal >= lateral * 1.35 && sagittal >= vertical * 1.35) return "sagittal";
  if (lateral >= sagittal * 1.35 && lateral >= vertical * 1.35) return "lateral";
  if (vertical >= sagittal * 1.35 && vertical >= lateral * 1.35) return "vertical";
  return "ambiguous";
}

function diagnosticIssue(
  humanBone: HumanoidBoneName,
  childBone: HumanoidBoneName | undefined,
  targetChildDirection: Vec3 | undefined,
  sourceRest: Quat | undefined,
  movedDirection: Vec3 | undefined,
  hingePlane: RetargetingHingePlane
): string | undefined {
  if (!childBone || !targetChildDirection) return "missing child direction; hinge plane is unsupported";
  if (!sourceRest) return "missing source rest quaternion; cannot prove source-to-target retargeting";
  if (isHingeBone(humanBone) && !movedDirection) return "missing representative rotation samples; hinge plane is unsupported";
  if (isHingeBone(humanBone) && hingePlane !== "sagittal") return `expected sagittal hinge motion but found ${hingePlane}`;
  if (hingePlane === "ambiguous") return "representative motion is too small or mixed to identify a hinge plane";
  return undefined;
}

function isHingeBone(humanBone: HumanoidBoneName): boolean {
  return humanBone === "leftLowerLeg" || humanBone === "rightLowerLeg" || humanBone === "leftLowerArm" || humanBone === "rightLowerArm";
}

function retargetDiagnosticTrackProperty(property: string): "rotation" | "translation" | "scale" | null {
  if (property === "quaternion" || property === "rotation") return "rotation";
  if (property === "position" || property === "translation") return "translation";
  if (property === "scale") return "scale";
  return null;
}
