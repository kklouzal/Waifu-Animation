import { type AnimationClip, type SampleOptions, type SampleRepairDiagnostic, sampleClipToPose, sampleTime } from "./clip.js";
import { type Transform, EPSILON, cloneTransform, euclideanModulo, identityTransform, invertQuat, multiplyQuat, subVec3 } from "./math.js";
import { readPoseTransformOrRest } from "./pose.js";
import { type HumanoidBoneName, type Skeleton, isHumanoidBoneName, resolveHumanoidIndex, resolveJointIndex } from "./skeleton.js";

export type MotionCarrier =
  | { jointIndex: number; joint?: never; humanBone?: never }
  | { joint: string; jointIndex?: never; humanBone?: never }
  | { humanBone: HumanoidBoneName | string; joint?: never; jointIndex?: never };

export type MotionSampleOptions = Omit<SampleOptions, "restPose"> & {
  carrier?: MotionCarrier;
  restPose?: readonly Transform[];
};

export type MotionSample = {
  jointIndex: number;
  joint: string;
  time: number;
  transform: Transform;
};

export type MotionIntervalDelta = {
  from: MotionSample;
  to: MotionSample;
  delta: Transform;
};

export function sampleMotionCarrier(skeleton: Skeleton, clip: AnimationClip, timeSeconds: number, options: MotionSampleOptions = {}): MotionSample {
  const diagnostics = options.diagnostics;
  const jointIndex = resolveMotionCarrierIndex(skeleton, options.carrier, diagnostics);
  const loop = options.loop ?? clip.loop ?? false;
  const time = sampleTime(clip, timeSeconds, loop);
  const pose = sampleClipToPose(skeleton, clip, time, options);
  return {
    jointIndex,
    joint: skeleton.joints[jointIndex]?.name ?? "",
    time,
    transform: cloneTransform(readPoseTransformOrRest(skeleton, pose, jointIndex))
  };
}

export function sampleMotionIntervalDelta(
  skeleton: Skeleton,
  clip: AnimationClip,
  fromSeconds: number,
  toSeconds: number,
  options: MotionSampleOptions = {}
): MotionIntervalDelta {
  const fromTime = Number.isFinite(fromSeconds) ? fromSeconds : 0;
  const toTime = Number.isFinite(toSeconds) ? toSeconds : 0;
  const loop = options.loop ?? clip.loop ?? false;
  const from = sampleMotionCarrier(skeleton, clip, fromTime, options);
  const to = sampleMotionCarrier(skeleton, clip, toTime, options);

  if (toTime <= fromTime || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    return { from, to, delta: identityTransform() };
  }

  if (!loop) {
    return { from, to, delta: carrierTransformDelta(from.transform, to.transform) };
  }

  return {
    from,
    to,
    delta: sampleLoopingIntervalDelta(skeleton, clip, fromTime, toTime, options)
  };
}

export function resolveMotionCarrierIndex(
  skeleton: Skeleton,
  carrier: MotionCarrier | undefined,
  diagnostics?: SampleRepairDiagnostic[]
): number {
  const rootIndex = skeleton.joints.length > 0 ? 0 : -1;
  if (!carrier) return rootIndex;

  if ("jointIndex" in carrier) {
    const index = carrier.jointIndex;
    if (Number.isInteger(index) && index >= 0 && index < skeleton.joints.length) return index;
    diagnostics?.push({ index, message: `motion carrier joint index ${String(index)} does not map to skeleton; using root` });
    return rootIndex;
  }

  if ("humanBone" in carrier) {
    const bone = carrier.humanBone;
    if (isHumanoidBoneName(bone)) {
      const index = resolveHumanoidIndex(skeleton, bone);
      if (index >= 0) return index;
    }
    diagnostics?.push({ joint: String(bone), message: `motion carrier humanoid bone ${String(bone)} does not map to skeleton; using root` });
    return rootIndex;
  }

  const index = resolveJointIndex(skeleton, carrier.joint);
  if (index >= 0) return index;
  diagnostics?.push({ joint: carrier.joint, message: `motion carrier joint ${carrier.joint} does not map to skeleton; using root` });
  return rootIndex;
}

export function carrierTransformDelta(from: Transform, to: Transform): Transform {
  return {
    translation: subVec3(to.translation, from.translation),
    rotation: multiplyQuat(invertQuat(from.rotation), to.rotation),
    scale: [
      to.scale[0] / Math.max(EPSILON, from.scale[0]),
      to.scale[1] / Math.max(EPSILON, from.scale[1]),
      to.scale[2] / Math.max(EPSILON, from.scale[2])
    ]
  };
}

function sampleLoopingIntervalDelta(
  skeleton: Skeleton,
  clip: AnimationClip,
  fromSeconds: number,
  toSeconds: number,
  options: MotionSampleOptions
): Transform {
  const duration = clip.duration;
  let cursor = fromSeconds;
  let current = sampleMotionCarrier(skeleton, clip, euclideanModulo(cursor, duration), { ...options, loop: false }).transform;
  let accumulated = identityTransform();

  while (cursor < toSeconds) {
    const nextBoundary = Math.floor(cursor / duration + 1) * duration;
    const next = Math.min(nextBoundary, toSeconds);
    const endsAtBoundary = Math.abs(next - nextBoundary) <= EPSILON;
    const endLocalTime = endsAtBoundary ? duration : euclideanModulo(next, duration);
    const end = sampleMotionCarrier(skeleton, clip, endLocalTime, { ...options, loop: false }).transform;
    accumulated = composeCarrierDelta(accumulated, carrierTransformDelta(current, end));
    cursor = next;

    if (cursor < toSeconds && endsAtBoundary) {
      current = sampleMotionCarrier(skeleton, clip, 0, { ...options, loop: false }).transform;
    } else {
      current = end;
    }
  }

  return accumulated;
}

function composeCarrierDelta(a: Transform, b: Transform): Transform {
  return {
    translation: [
      a.translation[0] + b.translation[0],
      a.translation[1] + b.translation[1],
      a.translation[2] + b.translation[2]
    ],
    rotation: multiplyQuat(a.rotation, b.rotation),
    scale: [a.scale[0] * b.scale[0], a.scale[1] * b.scale[1], a.scale[2] * b.scale[2]]
  };
}
