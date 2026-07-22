import {
  type AnimationClip,
  type AnimationTrack,
  type RawAnimation,
  type RawAnimationJointTrack,
  type SampleOptions,
  type SampleRepairDiagnostic,
  cloneRawAnimation,
  normalizedTrackProperty,
  resolveTrackJointIndex,
  validateRawAnimation
} from "./clip.js";
import { sampleClipToPose, sampleTime } from "./clip-sampling.js";
import {
  type Quat,
  type Transform,
  type Vec3,
  EPSILON,
  addVec3,
  clamp,
  cloneQuat,
  cloneTransform,
  dotQuat,
  euclideanModulo,
  finiteNonNegative,
  finiteSigned,
  identityTransform,
  invertQuat,
  multiplyQuat,
  normalizeQuat,
  quatFromAxisAngle,
  rotateVec3ByQuat,
  scaleRatio,
  subVec3
} from "./math.js";
import { readPoseTransformOrRest } from "./pose.js";
import {
  type HumanoidBoneNameLike,
  type Skeleton,
  isHumanoidBoneName,
  resolveHumanoidIndex,
  resolveJointIndex
} from "./skeleton.js";
import {
  type RawFloat3Track,
  type RawQuaternionTrack,
  type UserTrack,
  buildUserTrack,
  sampleUserTrack
} from "./tracks.js";

export type MotionCarrier =
  | { jointIndex: number; joint?: never; humanBone?: never }
  | { joint: string; jointIndex?: never; humanBone?: never }
  | { humanBone: HumanoidBoneNameLike; joint?: never; jointIndex?: never };

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

export type MotionExtractionReference = "absolute" | "skeleton" | "animation";

export type MotionExtractionAxisMask = {
  x?: boolean;
  y?: boolean;
  z?: boolean;
};

export type MotionTranslationBakeMode = "reference" | "remove-linear-trajectory";

export type MotionRotationExtractionMode = "yaw" | "full";

export type MotionTranslationExtractionOptions = {
  axes?: MotionExtractionAxisMask;
  reference?: MotionExtractionReference;
  bake?: boolean;
  bakeMode?: MotionTranslationBakeMode;
  loop?: boolean;
};

export type MotionRotationExtractionOptions = {
  mode?: MotionRotationExtractionMode;
  reference?: MotionExtractionReference;
  bake?: boolean;
  loop?: boolean;
};

export type ExtractRootMotionOptions = MotionSampleOptions & {
  translation?: boolean | MotionTranslationExtractionOptions;
  rotation?: false | MotionRotationExtractionMode | MotionRotationExtractionOptions;
  reference?: MotionExtractionReference;
  bake?: boolean;
  loop?: boolean;
  sampleTimes?: readonly number[];
  bakedClipId?: string;
};

export type MotionTracks = {
  duration: number;
  loop?: boolean;
  position?: UserTrack<"float3">;
  rotation?: UserTrack<"quaternion">;
};

export type ExtractedRootMotion = MotionTracks & {
  carrier: { jointIndex: number; joint: string };
};

export type RootMotionExtractionResult = {
  motion: ExtractedRootMotion;
  bakedClip?: AnimationClip;
};

export type RawRootMotionExtractionResult = {
  motion: ExtractedRootMotion;
  rawAnimation: RawAnimation;
};

export type MotionTrackSampleOptions = {
  loop?: boolean;
};

export type MotionTrackSample = {
  time: number;
  ratio: number;
  transform: Transform;
};

export type MotionTrackIntervalDelta = {
  from: MotionTrackSample;
  to: MotionTrackSample;
  delta: Transform;
};

export type MotionAccumulatorUpdateOptions = {
  pathRotation?: Quat;
};

export type MotionBlendLayer = {
  weight: number;
  delta: Transform;
};

export type ExtractRawRootMotionOptions = Omit<ExtractRootMotionOptions, "sampleTimes" | "bakedClipId"> & {
  rawAnimationId?: string;
};

type ResolvedTranslationExtraction = {
  axes: Required<MotionExtractionAxisMask>;
  reference: MotionExtractionReference;
  bake: boolean;
  bakeMode: MotionTranslationBakeMode;
  loop: boolean;
};

type ResolvedRotationExtraction = {
  mode: MotionRotationExtractionMode;
  reference: MotionExtractionReference;
  bake: boolean;
  loop: boolean;
};

export function sampleMotionCarrier(
  skeleton: Skeleton,
  clip: AnimationClip,
  timeSeconds: number,
  options: MotionSampleOptions = {}
): MotionSample {
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

export function extractRootMotion(
  skeleton: Skeleton,
  clip: AnimationClip,
  options: ExtractRootMotionOptions = {}
): RootMotionExtractionResult {
  const diagnostics = options.diagnostics;
  const jointIndex = resolveMotionCarrierIndex(skeleton, options.carrier, diagnostics);
  const joint = skeleton.joints[jointIndex]?.name ?? "";
  const duration = finiteMotionDuration(clip.duration);
  const sampleTimes = resolveMotionExtractionSampleTimes(skeleton, clip, jointIndex, options.sampleTimes);
  const sampleOptions = motionSampleOptionsForExtraction(options);
  const translationSettings = resolveTranslationExtraction(options);
  const rotationSettings = resolveRotationExtraction(options);
  const translationReference = resolveMotionReferenceTransform(
    skeleton,
    clip,
    jointIndex,
    translationSettings?.reference ?? options.reference ?? "skeleton",
    sampleOptions
  );
  const rotationReference = resolveMotionReferenceTransform(
    skeleton,
    clip,
    jointIndex,
    rotationSettings?.reference ?? options.reference ?? "skeleton",
    sampleOptions
  );

  const motion: ExtractedRootMotion = {
    duration,
    loop: options.loop ?? clip.loop ?? false,
    carrier: { jointIndex, joint }
  };

  if (translationSettings) {
    motion.position = buildUserTrack({
      type: "float3",
      name: `${clip.id}.${joint || "root"}.motion.position`,
      keyframes: sampleTimes.map((time) => ({
        ratio: motionSampleRatio(time, duration),
        value: extractMotionTranslation(
          sampleMotionCarrier(skeleton, clip, time, sampleOptions).transform,
          translationReference,
          translationSettings.axes
        ),
        interpolation: "linear"
      }))
    } satisfies RawFloat3Track);
  }

  if (rotationSettings) {
    motion.rotation = buildUserTrack({
      type: "quaternion",
      name: `${clip.id}.${joint || "root"}.motion.rotation`,
      keyframes: sampleTimes.map((time) => ({
        ratio: motionSampleRatio(time, duration),
        value: extractMotionRotation(
          sampleMotionCarrier(skeleton, clip, time, sampleOptions).transform,
          rotationReference,
          rotationSettings.mode
        ),
        interpolation: "linear"
      }))
    } satisfies RawQuaternionTrack);
  }

  const shouldBake = Boolean(translationSettings?.bake || rotationSettings?.bake);
  const bakedClip = shouldBake
    ? bakeExtractedRootMotionClip(
        skeleton,
        clip,
        jointIndex,
        translationSettings,
        rotationSettings,
        translationReference,
        rotationReference,
        motion.rotation,
        options.bakedClipId
      )
    : undefined;

  if (translationSettings?.loop && motion.position) loopMotionTrack(motion.position);
  if (rotationSettings?.loop && motion.rotation) loopMotionTrack(motion.rotation);

  return bakedClip ? { motion, bakedClip } : { motion };
}

export function extractRawRootMotion(
  skeleton: Skeleton,
  rawAnimation: RawAnimation,
  options: ExtractRawRootMotionOptions = {}
): RawRootMotionExtractionResult {
  const issues = validateRawAnimation(rawAnimation, skeleton);
  if (issues.length > 0) throw new Error(`raw animation is invalid: ${issues.map(formatRawMotionIssue).join("; ")}`);

  const diagnostics = options.diagnostics;
  const jointIndex = resolveMotionCarrierIndex(skeleton, options.carrier, diagnostics);
  const trackIndex = resolveRawMotionCarrierTrackIndex(skeleton, rawAnimation, jointIndex);
  if (trackIndex < 0) {
    throw new Error(`raw motion carrier joint ${jointIndex} does not map to a raw animation track`);
  }

  const sourceTrack = rawAnimation.tracks[trackIndex]!;
  const output = cloneRawAnimation(rawAnimation);
  if (options.rawAnimationId !== undefined) output.id = options.rawAnimationId;
  const outputTrack = output.tracks[trackIndex]!;
  const duration = finiteMotionDuration(rawAnimation.duration);
  const translationSettings = resolveTranslationExtraction(options);
  const rotationSettings = resolveRotationExtraction(options);
  const translationReference = resolveRawTranslationReference(
    skeleton,
    sourceTrack,
    jointIndex,
    translationSettings?.reference ?? options.reference ?? "skeleton"
  );
  const rotationReference = resolveRawRotationReference(
    skeleton,
    sourceTrack,
    jointIndex,
    rotationSettings?.reference ?? options.reference ?? "skeleton"
  );
  const joint = skeleton.joints[jointIndex]?.name ?? sourceTrack.joint ?? String(sourceTrack.humanBone ?? "");

  const motion: ExtractedRootMotion = {
    duration,
    loop: options.loop ?? rawAnimation.loop ?? false,
    carrier: { jointIndex, joint }
  };

  const rawPositionKeys = translationSettings
    ? sourceTrack.translations.map((key) => ({
        ratio: motionSampleRatio(key.time, duration),
        value: extractRawMotionTranslation(key.value, translationReference, translationSettings.axes),
        interpolation: "linear" as const
      }))
    : [];
  const rawRotationKeys = rotationSettings
    ? sourceTrack.rotations.map((key) => ({
        ratio: motionSampleRatio(key.time, duration),
        value: extractMotionRotation(
          { translation: [0, 0, 0], rotation: key.value, scale: [1, 1, 1] },
          { translation: [0, 0, 0], rotation: rotationReference, scale: [1, 1, 1] },
          rotationSettings.mode
        ),
        interpolation: "linear" as const
      }))
    : [];
  const rawRotationBakeTrack = rotationSettings?.bake
    ? buildUserTrack({
        type: "quaternion",
        name: `${rawAnimation.id}.${joint || "root"}.raw-motion.rotation:bake`,
        keyframes: rawRotationKeys
      } satisfies RawQuaternionTrack)
    : undefined;

  if (translationSettings?.bake) {
    bakeRawMotionCarrierTranslation(outputTrack, translationSettings, translationReference, duration);
  }

  if (rotationSettings?.bake) {
    for (let index = 0; index < outputTrack.rotations.length; index += 1) {
      const key = outputTrack.rotations[index]!;
      const motionValue = rawRotationKeys[index]?.value ?? [0, 0, 0, 1];
      key.value = multiplyQuat(invertQuat(motionValue), key.value);
    }
  }

  if (rotationSettings?.loop) distributeLoopingRawMotionKeyframes(rawRotationKeys, "quaternion");
  if (translationSettings?.loop) distributeLoopingRawMotionKeyframes(rawPositionKeys, "float3");

  if (translationSettings) {
    motion.position = buildUserTrack({
      type: "float3",
      name: `${rawAnimation.id}.${joint || "root"}.raw-motion.position`,
      keyframes: rawPositionKeys
    } satisfies RawFloat3Track);
  }

  if (rotationSettings) {
    motion.rotation = buildUserTrack({
      type: "quaternion",
      name: `${rawAnimation.id}.${joint || "root"}.raw-motion.rotation`,
      keyframes: rawRotationKeys
    } satisfies RawQuaternionTrack);
  }

  if (rotationSettings?.bake && (rawRotationBakeTrack || motion.rotation)) {
    for (const key of outputTrack.translations) {
      const ratio = motionSampleRatio(key.time, duration);
      const motionRotation = sampleUserTrack(rawRotationBakeTrack ?? motion.rotation!, ratio);
      key.value = rotateVec3ByQuat(invertQuat(motionRotation), key.value);
    }
  }

  const bakedMetadata = rootMotionBakeMetadata(output.metadata, translationSettings, rotationSettings);
  if (bakedMetadata) output.metadata = bakedMetadata;

  return { motion, rawAnimation: output };
}

export class MotionExtractor {
  extract(skeleton: Skeleton, clip: AnimationClip, options: ExtractRootMotionOptions = {}): RootMotionExtractionResult {
    return extractRootMotion(skeleton, clip, options);
  }

  extractRaw(
    skeleton: Skeleton,
    rawAnimation: RawAnimation,
    options: ExtractRawRootMotionOptions = {}
  ): RawRootMotionExtractionResult {
    return extractRawRootMotion(skeleton, rawAnimation, options);
  }
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
  const duration = finiteMotionDuration(clip.duration);

  if (Math.abs(toTime - fromTime) <= EPSILON || duration <= 0) {
    return { from, to, delta: identityTransform() };
  }

  if (!loop) {
    return { from, to, delta: carrierTransformDelta(from.transform, to.transform) };
  }

  const delta =
    toTime > fromTime
      ? sampleLoopingIntervalDelta(skeleton, clip, fromTime, toTime, options)
      : invertCarrierDelta(sampleLoopingIntervalDelta(skeleton, clip, toTime, fromTime, options));
  return { from, to, delta };
}

export function sampleMotionTracks(
  motion: MotionTracks,
  timeSeconds: number,
  options: MotionTrackSampleOptions = {}
): MotionTrackSample {
  const duration = finiteMotionDuration(motion.duration);
  const loop = options.loop ?? motion.loop ?? false;
  const time = sampleMotionTrackTime(duration, timeSeconds, loop);
  return {
    time,
    ratio: motionSampleRatio(time, duration),
    transform: sampleMotionTracksAtLocalTime(motion, time)
  };
}

export function sampleMotionTracksIntervalDelta(
  motion: MotionTracks,
  fromSeconds: number,
  toSeconds: number,
  options: MotionTrackSampleOptions = {}
): MotionTrackIntervalDelta {
  const fromTime = Number.isFinite(fromSeconds) ? fromSeconds : 0;
  const toTime = Number.isFinite(toSeconds) ? toSeconds : 0;
  const duration = finiteMotionDuration(motion.duration);
  const loop = options.loop ?? motion.loop ?? false;
  const from = sampleMotionTracks(motion, fromTime, { loop });
  const to = sampleMotionTracks(motion, toTime, { loop });

  if (Math.abs(toTime - fromTime) <= EPSILON || duration <= 0) {
    return { from, to, delta: identityTransform() };
  }

  if (!loop) {
    return { from, to, delta: sanitizeMotionTransform(carrierTransformDelta(from.transform, to.transform)) };
  }

  const delta =
    toTime > fromTime
      ? sampleLoopingMotionTracksIntervalDelta(motion, fromTime, toTime)
      : invertCarrierDelta(sampleLoopingMotionTracksIntervalDelta(motion, toTime, fromTime));
  return { from, to, delta: sanitizeMotionTransform(delta) };
}

export class MotionAccumulator {
  current: Transform;
  delta: Transform;
  rotationAccum: Quat;
  last: Transform;

  constructor(origin: Partial<Transform> = {}) {
    const transform = cloneTransform(origin);
    this.current = cloneTransform(transform);
    this.delta = identityTransform();
    this.rotationAccum = cloneQuat(undefined);
    this.last = cloneTransform(transform);
  }

  accumulateDelta(delta: Transform, options: MotionAccumulatorUpdateOptions = {}): Transform {
    const safeDelta = sanitizeMotionTransform(delta);
    const pathRotation = normalizeQuat(cloneQuat(options.pathRotation));
    const previous = cloneTransform(this.current);
    this.rotationAccum = normalizeQuat(multiplyQuat(this.rotationAccum, pathRotation));
    this.current = {
      translation: addVec3(this.current.translation, rotateVec3ByQuat(this.rotationAccum, safeDelta.translation)),
      rotation: multiplyQuat(multiplyQuat(this.current.rotation, safeDelta.rotation), pathRotation),
      scale: [
        this.current.scale[0] * safeDelta.scale[0],
        this.current.scale[1] * safeDelta.scale[1],
        this.current.scale[2] * safeDelta.scale[2]
      ]
    };
    this.current = sanitizeMotionTransform(this.current);
    this.delta = sanitizeMotionTransform(carrierTransformDelta(previous, this.current));
    return cloneTransform(this.delta);
  }

  updateSample(sample: Transform, options: MotionAccumulatorUpdateOptions = {}): Transform {
    const next = sanitizeMotionTransform(sample);
    const delta = carrierTransformDelta(this.last, next);
    const accumulated = this.accumulateDelta(delta, options);
    this.last = next;
    return accumulated;
  }

  resetOrigin(origin: Partial<Transform> = {}): void {
    this.last = cloneTransform(origin);
  }

  teleport(origin: Partial<Transform> = {}): void {
    const transform = cloneTransform(origin);
    this.current = cloneTransform(transform);
    this.last = cloneTransform(transform);
    this.delta = identityTransform();
    this.rotationAccum = cloneQuat(undefined);
  }
}

export class MotionSampler {
  readonly accumulator: MotionAccumulator;

  constructor(origin: Partial<Transform> = {}) {
    this.accumulator = new MotionAccumulator(origin);
  }

  get current(): Transform {
    return this.accumulator.current;
  }

  get delta(): Transform {
    return this.accumulator.delta;
  }

  update(
    motion: MotionTracks,
    fromSeconds: number,
    toSeconds: number,
    options: MotionTrackSampleOptions & MotionAccumulatorUpdateOptions = {}
  ): MotionTrackIntervalDelta {
    const interval = sampleMotionTracksIntervalDelta(motion, fromSeconds, toSeconds, options);
    this.accumulator.accumulateDelta(interval.delta, options);
    this.accumulator.resetOrigin(interval.to.transform);
    return interval;
  }

  teleport(origin: Partial<Transform> = {}): void {
    this.accumulator.teleport(origin);
  }
}

export function blendMotionDeltas(layers: readonly MotionBlendLayer[]): Transform {
  let totalWeight = 0;
  for (const layer of layers) totalWeight += finiteNonNegative(layer.weight, 0);
  if (totalWeight <= EPSILON) return identityTransform();

  const translation: Vec3 = [0, 0, 0];
  let translationLength = 0;
  const scale: Vec3 = [0, 0, 0];
  const rotationSum: Quat = [0, 0, 0, 0];
  let firstRotation: Quat | undefined;

  for (const layer of layers) {
    const weight = finiteNonNegative(layer.weight, 0);
    if (weight <= 0) continue;
    const normalizedWeight = weight / totalWeight;
    const delta = sanitizeMotionTransform(layer.delta);
    const deltaTranslation: Vec3 = [
      finiteSigned(delta.translation[0], 0),
      finiteSigned(delta.translation[1], 0),
      finiteSigned(delta.translation[2], 0)
    ];
    const deltaTranslationLength = Math.hypot(deltaTranslation[0], deltaTranslation[1], deltaTranslation[2]);
    if (Number.isFinite(deltaTranslationLength) && deltaTranslationLength > EPSILON) {
      translation[0] += (deltaTranslation[0] / deltaTranslationLength) * normalizedWeight;
      translation[1] += (deltaTranslation[1] / deltaTranslationLength) * normalizedWeight;
      translation[2] += (deltaTranslation[2] / deltaTranslationLength) * normalizedWeight;
      translationLength += deltaTranslationLength * normalizedWeight;
    }
    scale[0] += finiteSigned(delta.scale[0], 1) * normalizedWeight;
    scale[1] += finiteSigned(delta.scale[1], 1) * normalizedWeight;
    scale[2] += finiteSigned(delta.scale[2], 1) * normalizedWeight;

    let rotation = normalizeQuat(delta.rotation);
    const reference = dotQuat(rotationSum, rotationSum) > EPSILON ? rotationSum : firstRotation;
    if (reference) {
      if (dotQuat(reference, rotation) < 0) rotation = [-rotation[0], -rotation[1], -rotation[2], -rotation[3]];
    } else if (dotQuat([0, 0, 0, 1], rotation) < 0) {
      rotation = [-rotation[0], -rotation[1], -rotation[2], -rotation[3]];
    }
    firstRotation ??= rotation;
    rotationSum[0] += rotation[0] * normalizedWeight;
    rotationSum[1] += rotation[1] * normalizedWeight;
    rotationSum[2] += rotation[2] * normalizedWeight;
    rotationSum[3] += rotation[3] * normalizedWeight;
  }

  const blendedTranslationLength = Math.hypot(translation[0], translation[1], translation[2]);
  const translationScale =
    Number.isFinite(blendedTranslationLength) && blendedTranslationLength > EPSILON
      ? translationLength / blendedTranslationLength
      : 0;

  return sanitizeMotionTransform({
    translation: [
      translation[0] * translationScale,
      translation[1] * translationScale,
      translation[2] * translationScale
    ],
    rotation: normalizeQuat(rotationSum),
    scale
  });
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
    diagnostics?.push({
      index,
      message: `motion carrier joint index ${String(index)} does not map to skeleton; using root`
    });
    return rootIndex;
  }

  if ("humanBone" in carrier) {
    const bone = carrier.humanBone;
    if (isHumanoidBoneName(bone)) {
      const index = resolveHumanoidIndex(skeleton, bone);
      if (index >= 0) return index;
    }
    diagnostics?.push({
      joint: String(bone),
      message: `motion carrier humanoid bone ${String(bone)} does not map to skeleton; using root`
    });
    return rootIndex;
  }

  const index = resolveJointIndex(skeleton, carrier.joint);
  if (index >= 0) return index;
  diagnostics?.push({
    joint: carrier.joint,
    message: `motion carrier joint ${carrier.joint} does not map to skeleton; using root`
  });
  return rootIndex;
}

export function carrierTransformDelta(from: Transform, to: Transform): Transform {
  return {
    translation: subVec3(to.translation, from.translation),
    rotation: multiplyQuat(invertQuat(from.rotation), to.rotation),
    scale: [
      scaleRatio(to.scale[0], from.scale[0]),
      scaleRatio(to.scale[1], from.scale[1]),
      scaleRatio(to.scale[2], from.scale[2])
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
  const duration = finiteMotionDuration(clip.duration);
  let remaining = toSeconds - fromSeconds;
  if (duration <= 0 || !Number.isFinite(remaining) || remaining <= EPSILON) return identityTransform();

  let accumulated = identityTransform();
  let startLocal = euclideanModulo(fromSeconds, duration);
  if (duration - startLocal <= EPSILON) startLocal = 0;

  const firstSpan = Math.min(remaining, duration - startLocal);
  const remainingAfterFirstSpan = remaining - firstSpan;
  if (firstSpan > EPSILON && remainingAfterFirstSpan < remaining) {
    const endLocal = startLocal + firstSpan;
    accumulated = composeCarrierDelta(
      accumulated,
      carrierTransformDelta(
        sampleClipCarrierAtLocalTime(skeleton, clip, startLocal, options),
        sampleClipCarrierAtLocalTime(
          skeleton,
          clip,
          Math.abs(endLocal - duration) <= EPSILON ? duration : endLocal,
          options
        )
      )
    );
    remaining = remainingAfterFirstSpan;
  }

  if (remaining > EPSILON) {
    const loopQuotient = remaining / duration;
    const fullLoops =
      loopQuotient === Number.POSITIVE_INFINITY ? Number.MAX_VALUE : Math.floor((remaining + EPSILON) / duration);
    if (fullLoops > 0) {
      accumulated = composeCarrierDelta(
        accumulated,
        repeatCarrierDelta(
          carrierTransformDelta(
            sampleClipCarrierAtLocalTime(skeleton, clip, 0, options),
            sampleClipCarrierAtLocalTime(skeleton, clip, duration, options)
          ),
          fullLoops
        )
      );
      remaining = remainingAfterRepeatedLoops(remaining, duration, fullLoops);
    }
  }

  if (remaining > EPSILON) {
    accumulated = composeCarrierDelta(
      accumulated,
      carrierTransformDelta(
        sampleClipCarrierAtLocalTime(skeleton, clip, 0, options),
        sampleClipCarrierAtLocalTime(skeleton, clip, remaining, options)
      )
    );
  }

  return accumulated;
}

function sampleClipCarrierAtLocalTime(
  skeleton: Skeleton,
  clip: AnimationClip,
  localTime: number,
  options: MotionSampleOptions
): Transform {
  return sampleMotionCarrier(skeleton, clip, localTime, { ...options, loop: false }).transform;
}

function composeCarrierDelta(a: Transform, b: Transform): Transform {
  const scaleX = a.scale[0] * b.scale[0];
  const scaleY = a.scale[1] * b.scale[1];
  const scaleZ = a.scale[2] * b.scale[2];
  return {
    translation: [
      finiteCarrierComponent(a.translation[0] + b.translation[0]),
      finiteCarrierComponent(a.translation[1] + b.translation[1]),
      finiteCarrierComponent(a.translation[2] + b.translation[2])
    ],
    rotation: multiplyQuat(a.rotation, b.rotation),
    scale: [finiteCarrierComponent(scaleX), finiteCarrierComponent(scaleY), finiteCarrierComponent(scaleZ)]
  };
}

function finiteCarrierComponent(value: number): number {
  if (Number.isFinite(value)) return value === 0 ? 0 : value;
  if (value === Number.NEGATIVE_INFINITY) return -Number.MAX_VALUE;
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
  return 0;
}

function resolveTranslationExtraction(options: ExtractRootMotionOptions): ResolvedTranslationExtraction | null {
  if (options.translation === false) return null;
  const channel = typeof options.translation === "object" ? options.translation : {};
  return {
    axes: {
      x: channel.axes?.x ?? true,
      y: channel.axes?.y ?? true,
      z: channel.axes?.z ?? true
    },
    reference: channel.reference ?? options.reference ?? "skeleton",
    bake: channel.bake ?? options.bake ?? false,
    bakeMode: channel.bakeMode ?? "reference",
    loop: channel.loop ?? false
  };
}

function resolveRotationExtraction(options: ExtractRootMotionOptions): ResolvedRotationExtraction | null {
  if (options.rotation === false) return null;
  const channel = typeof options.rotation === "object" ? options.rotation : {};
  const mode = options.rotation === "yaw" || options.rotation === "full" ? options.rotation : (channel.mode ?? "yaw");
  return {
    mode,
    reference: channel.reference ?? options.reference ?? "skeleton",
    bake: channel.bake ?? options.bake ?? false,
    loop: channel.loop ?? false
  };
}

function motionSampleOptionsForExtraction(options: ExtractRootMotionOptions): MotionSampleOptions {
  return {
    ...(options.carrier ? { carrier: options.carrier } : {}),
    ...(options.restPose ? { restPose: options.restPose } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
    ...(options.sourceBasisQuaternion ? { sourceBasisQuaternion: options.sourceBasisQuaternion } : {}),
    ...(options.targetRestChildDirection ? { targetRestChildDirection: options.targetRestChildDirection } : {}),
    skipUnsupportedTracks: options.skipUnsupportedTracks ?? true,
    loop: false
  };
}

function resolveMotionExtractionSampleTimes(
  skeleton: Skeleton,
  clip: AnimationClip,
  jointIndex: number,
  requested: readonly number[] | undefined
): number[] {
  const duration = finiteMotionDuration(clip.duration);
  const times = requested ? Array.from(requested) : collectCarrierTrackTimes(skeleton, clip, jointIndex);
  times.push(0);
  if (duration > 0) times.push(duration);
  const clamped = times
    .filter(Number.isFinite)
    .map((time) => clamp(time, 0, duration))
    .sort((a, b) => a - b);
  const unique: number[] = [];
  for (const time of clamped) {
    const previous = unique[unique.length - 1];
    if (previous === undefined || Math.abs(time - previous) > EPSILON) unique.push(time);
  }
  return unique.length > 0 ? unique : [0];
}

function collectCarrierTrackTimes(skeleton: Skeleton, clip: AnimationClip, jointIndex: number): number[] {
  const times: number[] = [];
  for (const track of clip.tracks) {
    if (!isCarrierMotionTrack(skeleton, track, jointIndex)) continue;
    times.push(...Array.from(track.times));
  }
  return times;
}

function isCarrierMotionTrack(skeleton: Skeleton, track: AnimationTrack, jointIndex: number): boolean {
  if (resolveTrackJointIndex(skeleton, track) !== jointIndex) return false;
  const property = normalizedTrackProperty(track.property);
  return property === "translation" || property === "rotation";
}

function resolveMotionReferenceTransform(
  skeleton: Skeleton,
  clip: AnimationClip,
  jointIndex: number,
  reference: MotionExtractionReference,
  options: MotionSampleOptions
): Transform {
  if (jointIndex < 0) return identityTransform();
  if (reference === "absolute") return identityTransform();
  if (reference === "animation") return sampleMotionCarrier(skeleton, clip, 0, options).transform;
  return cloneTransform(readPoseTransformOrRest(skeleton, options.restPose ?? skeleton.restPose, jointIndex));
}

function extractMotionTranslation(
  sample: Transform,
  reference: Transform,
  axes: Required<MotionExtractionAxisMask>
): Vec3 {
  const delta = subVec3(sample.translation, reference.translation);
  return [
    axes.x ? finiteSigned(delta[0], 0) : 0,
    axes.y ? finiteSigned(delta[1], 0) : 0,
    axes.z ? finiteSigned(delta[2], 0) : 0
  ];
}

function extractMotionRotation(sample: Transform, reference: Transform, mode: MotionRotationExtractionMode): Quat {
  const delta = multiplyQuat(invertQuat(reference.rotation), sample.rotation);
  return extractRotationDelta(delta, mode);
}

function extractRotationDelta(delta: Quat, mode: MotionRotationExtractionMode): Quat {
  if (mode === "full") return normalizeQuat(delta);
  const forward = rotateVec3ByQuat(delta, [0, 0, 1]);
  const yaw = Math.atan2(finiteSigned(forward[0], 0), finiteSigned(forward[2], 1));
  return quatFromAxisAngle([0, 1, 0], Number.isFinite(yaw) ? yaw : 0);
}

function loopMotionTrack<T extends "float3" | "quaternion">(track: UserTrack<T>): void {
  if (track.ratios.length < 2) return;
  const stride = track.type === "quaternion" ? 4 : 3;
  const firstOffset = 0;
  const lastOffset = (track.ratios.length - 1) * stride;
  if (track.type === "quaternion") {
    const first: Quat = [
      track.values[firstOffset]!,
      track.values[firstOffset + 1]!,
      track.values[firstOffset + 2]!,
      track.values[firstOffset + 3]!
    ];
    const last: Quat = [
      track.values[lastOffset]!,
      track.values[lastOffset + 1]!,
      track.values[lastOffset + 2]!,
      track.values[lastOffset + 3]!
    ];
    const delta = multiplyQuat(first, invertQuat(last));
    const firstRatio = track.ratios[0] ?? 0;
    const lastRatio = track.ratios[track.ratios.length - 1] ?? 1;
    for (let key = 0; key < track.ratios.length; key += 1) {
      const offset = key * stride;
      const alpha = loopDistributionAlpha(track.ratios[key]!, firstRatio, lastRatio, key, track.ratios.length - 1);
      const value: Quat = [
        track.values[offset]!,
        track.values[offset + 1]!,
        track.values[offset + 2]!,
        track.values[offset + 3]!
      ];
      track.values.set(multiplyQuat(nlerpIdentityToQuat(delta, alpha), value), offset);
    }
    return;
  }

  const delta: Vec3 = [
    track.values[firstOffset]! - track.values[lastOffset]!,
    track.values[firstOffset + 1]! - track.values[lastOffset + 1]!,
    track.values[firstOffset + 2]! - track.values[lastOffset + 2]!
  ];
  const firstRatio = track.ratios[0] ?? 0;
  const lastRatio = track.ratios[track.ratios.length - 1] ?? 1;
  for (let key = 0; key < track.ratios.length; key += 1) {
    const offset = key * stride;
    const alpha = loopDistributionAlpha(track.ratios[key]!, firstRatio, lastRatio, key, track.ratios.length - 1);
    track.values[offset] = track.values[offset]! + delta[0] * alpha;
    track.values[offset + 1] = track.values[offset + 1]! + delta[1] * alpha;
    track.values[offset + 2] = track.values[offset + 2]! + delta[2] * alpha;
  }
}

function resolveRawMotionCarrierTrackIndex(skeleton: Skeleton, rawAnimation: RawAnimation, jointIndex: number): number {
  for (let index = 0; index < rawAnimation.tracks.length; index += 1) {
    if (resolveRawAnimationTrackJointIndex(skeleton, rawAnimation.tracks[index]!) === jointIndex) return index;
  }
  if (
    rawAnimation.tracks.length === skeleton.joints.length &&
    jointIndex >= 0 &&
    jointIndex < rawAnimation.tracks.length
  )
    return jointIndex;
  return -1;
}

function resolveRawAnimationTrackJointIndex(skeleton: Skeleton, track: RawAnimationJointTrack): number {
  if (track.joint !== undefined) return resolveJointIndex(skeleton, track.joint);
  if (track.humanBone !== undefined && isHumanoidBoneName(track.humanBone))
    return resolveHumanoidIndex(skeleton, track.humanBone);
  return -1;
}

function resolveRawTranslationReference(
  skeleton: Skeleton,
  track: RawAnimationJointTrack,
  jointIndex: number,
  reference: MotionExtractionReference
): Vec3 {
  if (reference === "absolute" || jointIndex < 0) return [0, 0, 0];
  if (reference === "animation" && track.translations.length > 0)
    return cloneTransform({ translation: track.translations[0]!.value }).translation;
  return cloneTransform(skeleton.restPose[jointIndex]).translation;
}

function resolveRawRotationReference(
  skeleton: Skeleton,
  track: RawAnimationJointTrack,
  jointIndex: number,
  reference: MotionExtractionReference
): Quat {
  if (reference === "absolute" || jointIndex < 0) return [0, 0, 0, 1];
  if (reference === "animation" && track.rotations.length > 0) return cloneQuat(track.rotations[0]!.value);
  return cloneQuat(skeleton.restPose[jointIndex]?.rotation);
}

function extractRawMotionTranslation(sample: Vec3, reference: Vec3, axes: Required<MotionExtractionAxisMask>): Vec3 {
  const delta = subVec3(sample, reference);
  return [
    axes.x ? finiteSigned(delta[0], 0) : 0,
    axes.y ? finiteSigned(delta[1], 0) : 0,
    axes.z ? finiteSigned(delta[2], 0) : 0
  ];
}

function distributeLoopingRawMotionKeyframes(
  keyframes:
    | Array<{ value: Vec3; ratio: number; interpolation: "linear" }>
    | Array<{ value: Quat; ratio: number; interpolation: "linear" }>,
  type: "float3" | "quaternion"
): void {
  if (keyframes.length < 2) return;
  if (type === "quaternion") {
    const keys = keyframes as Array<{ value: Quat; ratio: number; interpolation: "linear" }>;
    const delta = multiplyQuat(keys[0]!.value, invertQuat(keys[keys.length - 1]!.value));
    const firstRatio = keys[0]!.ratio;
    const lastRatio = keys[keys.length - 1]!.ratio;
    for (let index = 0; index < keys.length; index += 1) {
      const alpha = loopDistributionAlpha(keys[index]!.ratio, firstRatio, lastRatio, index, keys.length - 1);
      keys[index]!.value = multiplyQuat(nlerpIdentityToQuat(delta, alpha), keys[index]!.value);
    }
    return;
  }

  const keys = keyframes as Array<{ value: Vec3; ratio: number; interpolation: "linear" }>;
  const delta = subVec3(keys[0]!.value, keys[keys.length - 1]!.value);
  const firstRatio = keys[0]!.ratio;
  const lastRatio = keys[keys.length - 1]!.ratio;
  for (let index = 0; index < keys.length; index += 1) {
    const alpha = loopDistributionAlpha(keys[index]!.ratio, firstRatio, lastRatio, index, keys.length - 1);
    keys[index]!.value = addVec3(keys[index]!.value, [delta[0] * alpha, delta[1] * alpha, delta[2] * alpha]);
  }
}

function loopDistributionAlpha(
  ratio: number,
  firstRatio: number,
  lastRatio: number,
  keyIndex: number,
  lastKeyIndex: number
): number {
  const span = lastRatio - firstRatio;
  if (Number.isFinite(ratio) && Number.isFinite(span) && span > EPSILON)
    return clamp((ratio - firstRatio) / span, 0, 1);
  return lastKeyIndex > 0 ? keyIndex / lastKeyIndex : 0;
}

function nlerpIdentityToQuat(delta: Quat, alpha: number): Quat {
  const amount = clamp(alpha, 0, 1);
  const normalized = normalizeQuat(delta);
  const end =
    dotQuat([0, 0, 0, 1], normalized) < 0
      ? ([-normalized[0], -normalized[1], -normalized[2], -normalized[3]] as Quat)
      : normalized;
  return normalizeQuat([end[0] * amount, end[1] * amount, end[2] * amount, 1 + (end[3] - 1) * amount]);
}

function formatRawMotionIssue(issue: {
  track?: number;
  key?: number;
  joint?: string;
  property?: string;
  message: string;
}): string {
  const parts = [];
  if (issue.track !== undefined) parts.push(`track ${issue.track}`);
  if (issue.key !== undefined) parts.push(`key ${issue.key}`);
  if (issue.joint !== undefined) parts.push(issue.joint);
  if (issue.property !== undefined) parts.push(issue.property);
  parts.push(issue.message);
  return parts.join(" ");
}

function bakeExtractedRootMotionClip(
  skeleton: Skeleton,
  clip: AnimationClip,
  jointIndex: number,
  translation: ResolvedTranslationExtraction | null,
  rotation: ResolvedRotationExtraction | null,
  translationReference: Transform,
  rotationReference: Transform,
  motionRotation: UserTrack<"quaternion"> | undefined,
  bakedClipId: string | undefined
): AnimationClip {
  const metadata = rootMotionBakeMetadata(clip.metadata, translation, rotation);
  return {
    ...clip,
    id: bakedClipId ?? `${clip.id}:baked-root-motion`,
    tracks: clip.tracks.map((track) =>
      bakeCarrierTrack(
        skeleton,
        track,
        jointIndex,
        translation,
        rotation,
        translationReference,
        rotationReference,
        motionRotation,
        clip.duration
      )
    ),
    ...(metadata ? { metadata } : {})
  };
}

function rootMotionBakeMetadata(
  metadata: Record<string, unknown> | undefined,
  translation: ResolvedTranslationExtraction | null,
  rotation: ResolvedRotationExtraction | null
): Record<string, unknown> | undefined {
  const translationBaked = translation?.bake === true;
  const rotationBaked = rotation?.bake === true;
  if (!translationBaked && !rotationBaked) return metadata ? { ...metadata } : undefined;
  return {
    ...(metadata ?? {}),
    rootMotionPolicy: "stripped-to-in-place",
    rootMotionProvenance: "stripped-during-conversion",
    rootMotionTranslationPolicy: translationBaked ? "stripped-to-in-place" : "preserved",
    rootMotionYawPolicy: rotationBaked ? "stripped-to-in-place" : "preserved"
  };
}

function bakeCarrierTrack(
  skeleton: Skeleton,
  track: AnimationTrack,
  jointIndex: number,
  translation: ResolvedTranslationExtraction | null,
  rotation: ResolvedRotationExtraction | null,
  translationReference: Transform,
  rotationReference: Transform,
  motionRotation: UserTrack<"quaternion"> | undefined,
  duration: number
): AnimationTrack {
  const property = normalizedTrackProperty(track.property);
  const copy: AnimationTrack = {
    ...track,
    times: new Float32Array(track.times),
    values: new Float32Array(track.values),
    ...(track.sourceRestQuaternion ? { sourceRestQuaternion: new Float32Array(track.sourceRestQuaternion) } : {}),
    ...(track.sourceRestChildDirection
      ? { sourceRestChildDirection: new Float32Array(track.sourceRestChildDirection) }
      : {})
  };
  if (jointIndex < 0 || resolveTrackJointIndex(skeleton, track) !== jointIndex) return copy;

  if (property === "translation" && translation?.bake) {
    bakeClipMotionCarrierTranslation(copy, translation, translationReference.translation, duration);
  }

  if (property === "translation" && rotation?.bake && motionRotation) {
    for (let key = 0; key < copy.times.length; key += 1) {
      const offset = key * 3;
      const motionRatio = motionSampleRatio(copy.times[key]!, duration);
      const rotationValue = sampleUserTrack(motionRotation, motionRatio);
      copy.values.set(
        rotateVec3ByQuat(invertQuat(rotationValue), [
          copy.values[offset]!,
          copy.values[offset + 1]!,
          copy.values[offset + 2]!
        ]),
        offset
      );
    }
  }

  if (property === "rotation" && rotation?.bake) {
    for (let offset = 0; offset + 3 < copy.values.length; offset += 4) {
      const original = normalizeQuat([
        copy.values[offset]!,
        copy.values[offset + 1]!,
        copy.values[offset + 2]!,
        copy.values[offset + 3]!
      ]);
      const delta = multiplyQuat(invertQuat(rotationReference.rotation), original);
      const extracted = extractRotationDelta(delta, rotation.mode);
      const bakedDelta = multiplyQuat(invertQuat(extracted), delta);
      const baked = multiplyQuat(rotationReference.rotation, bakedDelta);
      copy.values.set(baked, offset);
    }
  }

  return copy;
}

function bakeRawMotionCarrierTranslation(
  track: RawAnimationJointTrack,
  translation: ResolvedTranslationExtraction,
  reference: Vec3,
  duration: number
): void {
  if (translation.bakeMode === "remove-linear-trajectory") {
    const endpoints = rawTranslationEndpointDelta(track.translations, translation.axes);
    for (const key of track.translations) {
      key.value = bakeLinearTrajectoryValue(key.value, reference, endpoints, translation.axes, key.time, duration);
    }
    return;
  }

  for (const key of track.translations) {
    key.value = bakeReferenceTranslationValue(key.value, reference, translation.axes);
  }
}

function bakeClipMotionCarrierTranslation(
  track: AnimationTrack,
  translation: ResolvedTranslationExtraction,
  reference: Vec3,
  duration: number
): void {
  if (translation.bakeMode === "remove-linear-trajectory") {
    const endpoints = clipTranslationEndpointDelta(track, translation.axes);
    for (let key = 0; key < track.times.length; key += 1) {
      const offset = key * 3;
      const value: Vec3 = [track.values[offset]!, track.values[offset + 1]!, track.values[offset + 2]!];
      track.values.set(
        bakeLinearTrajectoryValue(value, reference, endpoints, translation.axes, track.times[key]!, duration),
        offset
      );
    }
    return;
  }

  for (let offset = 0; offset + 2 < track.values.length; offset += 3) {
    track.values.set(
      bakeReferenceTranslationValue(
        [track.values[offset]!, track.values[offset + 1]!, track.values[offset + 2]!],
        reference,
        translation.axes
      ),
      offset
    );
  }
}

function bakeReferenceTranslationValue(value: Vec3, reference: Vec3, axes: Required<MotionExtractionAxisMask>): Vec3 {
  return [axes.x ? reference[0] : value[0], axes.y ? reference[1] : value[1], axes.z ? reference[2] : value[2]];
}

function bakeLinearTrajectoryValue(
  value: Vec3,
  reference: Vec3,
  endpointDelta: Vec3,
  axes: Required<MotionExtractionAxisMask>,
  time: number,
  duration: number
): Vec3 {
  const ratio = motionSampleRatio(time, finiteMotionDuration(duration));
  return [
    axes.x ? finiteSigned(value[0] - endpointDelta[0] * ratio, reference[0]) : value[0],
    axes.y ? finiteSigned(value[1] - endpointDelta[1] * ratio, reference[1]) : value[1],
    axes.z ? finiteSigned(value[2] - endpointDelta[2] * ratio, reference[2]) : value[2]
  ];
}

function rawTranslationEndpointDelta(
  keys: readonly RawAnimationVec3KeyLike[],
  axes: Required<MotionExtractionAxisMask>
): Vec3 {
  if (keys.length < 2) return [0, 0, 0];
  return maskedEndpointDelta(keys[0]!.value, keys[keys.length - 1]!.value, axes);
}

function clipTranslationEndpointDelta(track: AnimationTrack, axes: Required<MotionExtractionAxisMask>): Vec3 {
  if (track.values.length < 6) return [0, 0, 0];
  const last = track.values.length - 3;
  return maskedEndpointDelta(
    [track.values[0]!, track.values[1]!, track.values[2]!],
    [track.values[last]!, track.values[last + 1]!, track.values[last + 2]!],
    axes
  );
}

type RawAnimationVec3KeyLike = { value: Vec3 };

function maskedEndpointDelta(
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  axes: Required<MotionExtractionAxisMask>
): Vec3 {
  return [
    axes.x ? finiteSigned((to[0] ?? 0) - (from[0] ?? 0), 0) : 0,
    axes.y ? finiteSigned((to[1] ?? 0) - (from[1] ?? 0), 0) : 0,
    axes.z ? finiteSigned((to[2] ?? 0) - (from[2] ?? 0), 0) : 0
  ];
}

function sampleMotionTrackTime(duration: number, timeSeconds: number, loop: boolean): number {
  const time = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  if (duration <= 0) return 0;
  return loop ? euclideanModulo(time, duration) : clamp(time, 0, duration);
}

function sampleMotionTracksAtLocalTime(motion: MotionTracks, localTime: number): Transform {
  const duration = finiteMotionDuration(motion.duration);
  const ratio = motionSampleRatio(sampleMotionTrackTime(duration, localTime, false), duration);
  return sanitizeMotionTransform({
    translation: motion.position ? sampleUserTrack(motion.position, ratio) : [0, 0, 0],
    rotation: motion.rotation ? sampleUserTrack(motion.rotation, ratio) : [0, 0, 0, 1],
    scale: [1, 1, 1]
  });
}

function sampleLoopingMotionTracksIntervalDelta(
  motion: MotionTracks,
  fromSeconds: number,
  toSeconds: number
): Transform {
  const duration = finiteMotionDuration(motion.duration);
  let remaining = toSeconds - fromSeconds;
  if (duration <= 0 || !Number.isFinite(remaining) || remaining <= EPSILON) return identityTransform();

  let accumulated = identityTransform();
  let startLocal = euclideanModulo(fromSeconds, duration);
  if (duration - startLocal <= EPSILON) startLocal = 0;

  const firstSpan = Math.min(remaining, duration - startLocal);
  const remainingAfterFirstSpan = remaining - firstSpan;
  if (firstSpan > EPSILON && remainingAfterFirstSpan < remaining) {
    const endLocal = startLocal + firstSpan;
    accumulated = composeCarrierDelta(
      accumulated,
      carrierTransformDelta(
        sampleMotionTracksAtLocalTime(motion, startLocal),
        sampleMotionTracksAtLocalTime(motion, Math.abs(endLocal - duration) <= EPSILON ? duration : endLocal)
      )
    );
    remaining = remainingAfterFirstSpan;
  }

  if (remaining > EPSILON) {
    const loopQuotient = remaining / duration;
    const fullLoops =
      loopQuotient === Number.POSITIVE_INFINITY ? Number.MAX_VALUE : Math.floor((remaining + EPSILON) / duration);
    if (fullLoops > 0) {
      accumulated = composeCarrierDelta(
        accumulated,
        repeatCarrierDelta(
          carrierTransformDelta(
            sampleMotionTracksAtLocalTime(motion, 0),
            sampleMotionTracksAtLocalTime(motion, duration)
          ),
          fullLoops
        )
      );
      remaining = remainingAfterRepeatedLoops(remaining, duration, fullLoops);
    }
  }

  if (remaining > EPSILON) {
    accumulated = composeCarrierDelta(
      accumulated,
      carrierTransformDelta(sampleMotionTracksAtLocalTime(motion, 0), sampleMotionTracksAtLocalTime(motion, remaining))
    );
  }

  return sanitizeMotionTransform(accumulated);
}

function repeatCarrierDelta(delta: Transform, count: number): Transform {
  let remaining =
    count === Number.POSITIVE_INFINITY
      ? Number.MAX_VALUE
      : Number.isFinite(count) && Number.isInteger(count) && count > 0
        ? count
        : 0;
  let result = identityTransform();
  let power = sanitizeMotionTransform(delta);
  while (remaining > 0) {
    if (remaining % 2 === 1) result = composeCarrierDelta(result, power);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) power = composeCarrierDelta(power, power);
  }
  return sanitizeMotionTransform(result);
}

function remainingAfterRepeatedLoops(remaining: number, duration: number, repeatedLoops: number): number {
  if (!Number.isFinite(repeatedLoops)) return 0;
  const representedDuration = repeatedLoops * duration;
  if (!Number.isFinite(representedDuration)) return 0;
  const rest = remaining - representedDuration;
  return Number.isFinite(rest) && rest > 0 ? rest : 0;
}

function invertCarrierDelta(delta: Transform): Transform {
  return sanitizeMotionTransform({
    translation: [-delta.translation[0], -delta.translation[1], -delta.translation[2]],
    rotation: invertQuat(delta.rotation),
    scale: [scaleRatio(1, delta.scale[0]), scaleRatio(1, delta.scale[1]), scaleRatio(1, delta.scale[2])]
  });
}

function motionSampleRatio(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return clamp(time / duration, 0, 1);
}

function finiteMotionDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function sanitizeMotionTransform(transform: Transform): Transform {
  const sanitized = cloneTransform(transform);
  return {
    translation: [
      finiteCarrierComponent(sanitized.translation[0]),
      finiteCarrierComponent(sanitized.translation[1]),
      finiteCarrierComponent(sanitized.translation[2])
    ],
    rotation: [
      finiteCarrierComponent(sanitized.rotation[0]),
      finiteCarrierComponent(sanitized.rotation[1]),
      finiteCarrierComponent(sanitized.rotation[2]),
      finiteCarrierComponent(sanitized.rotation[3])
    ],
    scale: [
      finiteCarrierComponent(sanitized.scale[0]),
      finiteCarrierComponent(sanitized.scale[1]),
      finiteCarrierComponent(sanitized.scale[2])
    ]
  };
}
