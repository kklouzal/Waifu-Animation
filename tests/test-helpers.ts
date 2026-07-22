import type {
  AnimationAction,
  AnimationManifestEntry,
  ReferenceAnimationRuntime,
  AnimationClip,
  Pose,
  ThreeRuntimeClip,
  createThreeAnimationClip
} from "./test-api.js";
import {
  AnimationMixer,
  LoopOnce,
  Object3D,
  Vector3,
  WAIFU_ANIMATION_BINARY_FORMAT,
  assert,
  createSkeleton,
  normalizeVec3,
  quatFromAxisAngle,
  sampleClipToPose,
  sanitizeQuaternionTrackValues,
  toFloat32Array,
  transformPoint
} from "./test-api.js";

type SourceRestQuaternionTrackOverrides = Omit<
  Partial<AnimationClip["tracks"][number]>,
  "sourceRestQuaternion" | "times" | "values"
> & {
  sourceRestQuaternion?: ArrayLike<number>;
  times?: ArrayLike<number>;
  values?: ArrayLike<number>;
};

type RuntimeActionStub = AnimationAction & {
  time: number;
  enabled: boolean;
  paused: boolean;
  effectiveWeight: number;
  effectiveTimeScale: number;
  resetCount: number;
  playCount: number;
  stopFadingCount: number;
  stopWarpingCount: number;
  reset(): RuntimeActionStub;
  play(): RuntimeActionStub;
  stopFading(): RuntimeActionStub;
  stopWarping(): RuntimeActionStub;
  setEffectiveTimeScale(value: number): RuntimeActionStub;
  setEffectiveWeight(value: number): RuntimeActionStub;
  getEffectiveWeight(): number;
  isRunning(): boolean;
  isScheduled(): boolean;
};

export const skeleton = createSkeleton([
  { name: "hips", humanoid: "hips", rest: { translation: [0, 1, 0] } },
  { name: "spine", parentName: "hips", humanoid: "spine" },
  { name: "head", parentName: "spine", humanoid: "head" },
  { name: "leftUpperArm", parentName: "spine", humanoid: "leftUpperArm" }
]);

export const nodClip: AnimationClip = {
  id: "nod",
  duration: 1,
  loop: true,
  tracks: [
    {
      humanBone: "head",
      property: "quaternion",
      times: toFloat32Array([0, 0.5, 1]),
      values: sanitizeQuaternionTrackValues([0, 0, 0, 1, 0.15, 0, 0, 0.9887, 0, 0, 0, 1])
    }
  ]
};

export function createRootMotionTestFixture(): {
  motionSkeleton: ReturnType<typeof createSkeleton>;
  motionClip: AnimationClip;
} {
  const motionSkeleton = createSkeleton([
    { name: "root" },
    { name: "hips", parentName: "root", humanoid: "hips", rest: { translation: [0, 1, 0] } },
    { name: "spine", parentName: "hips", humanoid: "spine" }
  ]);
  const motionClip: AnimationClip = {
    id: "root-motion",
    duration: 1,
    loop: true,
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 10, 0, 0])
      },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: sanitizeQuaternionTrackValues([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI)])
      },
      {
        humanBone: "hips",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 1, 0, 0, 1, 6])
      }
    ]
  };
  return { motionSkeleton, motionClip };
}

export function sampleNodPose(): Pose {
  return sampleClipToPose(skeleton, nodClip, 0.5);
}

export const invalidValidationStatusManifestEntry = {
  id: "typo-status",
  label: "Typo Status",
  url: "/typo-status.waifuanim.bin",
  format: WAIFU_ANIMATION_BINARY_FORMAT,
  validation: { status: "acceptted" } as unknown as { status: "accepted" }
};

export const quarantinedManifestEntry = {
  id: "quarantined",
  label: "Quarantined",
  url: "/quarantined.waifuanim.bin",
  format: WAIFU_ANIMATION_BINARY_FORMAT,
  validation: { status: "quarantined", reason: "manual hold" }
} satisfies AnimationManifestEntry;

export function assertFiniteEvaluation(evaluation: ReturnType<ReferenceAnimationRuntime["evaluate"]>): void {
  for (const transform of evaluation.localPose) {
    assert.ok(transform.translation.every(Number.isFinite));
    assert.ok(transform.rotation.every(Number.isFinite));
    assert.ok(transform.scale.every(Number.isFinite));
  }
  for (const matrix of evaluation.modelPose) {
    assert.ok(Array.from(matrix).every(Number.isFinite));
  }
}

export function assertFinitePose(pose: Pose): void {
  for (const transform of pose) {
    assert.ok(transform.translation.every(Number.isFinite));
    assert.ok(transform.rotation.every(Number.isFinite));
    assert.ok(transform.scale.every(Number.isFinite));
  }
}

export function makeSourceRestQuaternionClip(
  id: string,
  track: SourceRestQuaternionTrackOverrides = {}
): AnimationClip {
  return {
    id,
    duration: 1,
    tracks: [makeSourceRestQuaternionTrack(track)]
  };
}

export function makeSourceRestQuaternionTrack(
  track: SourceRestQuaternionTrackOverrides = {}
): AnimationClip["tracks"][number] {
  const {
    humanBone = "head",
    joint,
    property = "quaternion",
    sourceRestQuaternion = [0, 0, 0, 1],
    times = [0],
    values = [0, 0, 0, 1]
  } = track;
  return {
    ...(joint === undefined ? { humanBone } : { joint }),
    property,
    sourceRestQuaternion: toFloat32Array(sourceRestQuaternion),
    times: toFloat32Array(times),
    values: toFloat32Array(values)
  };
}

export function makeTransformTrack(
  humanBone: string,
  property: "position" | "translation" | "quaternion",
  values: number[],
  times = [0]
): AnimationClip["tracks"][number] {
  return { humanBone, property, times: toFloat32Array(times), values: toFloat32Array(values) };
}

export function makeAuthoredLoopClip(id: string, tracks: readonly string[]): AnimationClip {
  return {
    id,
    duration: 1,
    loop: true,
    tracks: tracks.map((track) => {
      const [humanBone, property = "quaternion"] = track.split(".") as [string, "position" | "quaternion" | undefined];
      return property === "position"
        ? makeTransformTrack(humanBone, "position", [0, 0, 0, 0, 0, 1], [0, 1])
        : makeTransformTrack(humanBone, "quaternion", [0, 0, 0, 1, 0, 0, 0, 1], [0, 1]);
    })
  };
}

export function createLegacyV1NodBinary(): ArrayBuffer {
  const headerBytes = 32;
  const legacyTrackBytes = 36;
  const name = new TextEncoder().encode("head");
  const floats = [0, 0.5, 1, 0, 0, 0, 1, 0.15, 0, 0, 0.9887, 0, 0, 0, 1];
  const stringByteOffset = headerBytes + legacyTrackBytes;
  const floatByteOffset = stringByteOffset + align4ForTest(name.byteLength);
  const buffer = new ArrayBuffer(floatByteOffset + floats.length * Float32Array.BYTES_PER_ELEMENT);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes.set(new TextEncoder().encode("WANI"), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, headerBytes, true);
  view.setUint32(12, legacyTrackBytes, true);
  view.setFloat32(16, 1, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, name.byteLength, true);

  view.setUint32(headerBytes, 1, true);
  view.setUint32(headerBytes + 4, 2, true);
  view.setUint32(headerBytes + 8, 0, true);
  view.setUint32(headerBytes + 12, name.byteLength, true);
  view.setUint32(headerBytes + 16, 0, true);
  view.setUint32(headerBytes + 20, 3, true);
  view.setUint32(headerBytes + 24, 3, true);
  view.setUint32(headerBytes + 28, 0xffffffff, true);
  view.setUint32(headerBytes + 32, 0, true);

  bytes.set(name, stringByteOffset);
  new Float32Array(buffer, floatByteOffset, floats.length).set(floats);
  return buffer;
}

export function align4ForTest(value: number): number {
  return (value + 3) & ~3;
}

export function binaryFloatByteOffsetForTest(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  const headerBytes = view.getUint32(8, true);
  const trackBytes = view.getUint32(12, true);
  const trackCount = view.getUint32(24, true);
  const stringBytes = view.getUint32(28, true);
  const metadataBytes = view.getUint32(4, true) >= 4 ? view.getUint32(32, true) : 0;
  return headerBytes + trackCount * trackBytes + align4ForTest(stringBytes) + align4ForTest(metadataBytes);
}

export function attachArmChain(
  root: Object3D,
  bones: Map<string, Object3D>,
  side: "left" | "right",
  sign: 1 | -1
): void {
  const upper = bones.get(`${side}UpperArm`)!;
  const lower = bones.get(`${side}LowerArm`)!;
  const hand = bones.get(`${side}Hand`)!;
  upper.position.set(sign * 0.24, 1.38, 0);
  lower.position.set(sign * 0.53, 0.98, 0);
  hand.position.set(sign * 0.72, 0.58, 0);
  root.add(upper);
  upper.add(lower);
  lower.add(hand);
}

export function signedJointForwardOffset(a: Vector3, b: Vector3, c: Vector3, axis: Vector3): number {
  const ac = c.clone().sub(a);
  const ab = b.clone().sub(a);
  const lengthSq = ac.lengthSq();
  if (lengthSq <= 1e-8) return 0;
  const closest = a.clone().addScaledVector(ac, ab.dot(ac) / lengthSq);
  return b.clone().sub(closest).dot(axis);
}

export function makeRuntimeClipDiagnosticStub(options: {
  id: string;
  label: string;
  lane: "base" | "overlay" | "debug";
  weight: number;
  targetWeight: number;
  time: number;
  duration: number;
  scheduled: boolean;
  running: boolean;
  instance?: number;
  states?: string[];
  emotions?: string[];
  gestures?: string[];
  source?: Record<string, unknown>;
  action?: RuntimeActionStub;
}): ThreeRuntimeClip {
  const action = options.action ?? makeRuntimeActionStub(options.weight);
  if (!options.action) {
    action.time = options.time;
    action.isRunning = () => options.running;
    action.isScheduled = () => options.scheduled;
  }
  return {
    id: options.id,
    label: options.label,
    url: `/${options.id}.waifuanim.bin`,
    format: WAIFU_ANIMATION_BINARY_FORMAT,
    sourceId: options.id,
    instance: options.instance ?? 0,
    action,
    duration: options.duration,
    targetWeight: options.targetWeight,
    lastTriggeredAt: 0,
    lane: options.lane,
    ...(options.states ? { states: options.states } : {}),
    ...(options.emotions ? { emotions: options.emotions } : {}),
    ...(options.gestures ? { gestures: options.gestures } : {}),
    ...(options.source ? { source: options.source } : {})
  };
}

export function makeRuntimeActionStub(initialWeight: number): RuntimeActionStub {
  return {
    time: 0,
    enabled: false,
    paused: true,
    effectiveWeight: initialWeight,
    effectiveTimeScale: 0,
    resetCount: 0,
    playCount: 0,
    stopFadingCount: 0,
    stopWarpingCount: 0,
    reset(this: RuntimeActionStub) {
      this.resetCount += 1;
      this.time = 0;
      return this;
    },
    play(this: RuntimeActionStub) {
      this.playCount += 1;
      return this;
    },
    stopFading(this: RuntimeActionStub) {
      this.stopFadingCount += 1;
      return this;
    },
    stopWarping(this: RuntimeActionStub) {
      this.stopWarpingCount += 1;
      return this;
    },
    setEffectiveTimeScale(this: RuntimeActionStub, value: number) {
      this.effectiveTimeScale = value;
      return this;
    },
    setEffectiveWeight(this: RuntimeActionStub, value: number) {
      this.effectiveWeight = value;
      return this;
    },
    getEffectiveWeight(this: RuntimeActionStub) {
      return this.effectiveWeight;
    },
    isRunning() {
      return false;
    },
    isScheduled() {
      return false;
    }
  } as unknown as RuntimeActionStub;
}

export function createMirroredLimbBones(
  mirroredLimbTargetRestLeft: readonly number[],
  mirroredLimbTargetRestRight: readonly number[]
) {
  const root = new Object3D();
  root.name = "mirroredLimbRoot";

  const leftUpperArm = new Object3D();
  leftUpperArm.name = "leftUpperArm";
  leftUpperArm.quaternion.fromArray(mirroredLimbTargetRestLeft);
  root.add(leftUpperArm);

  const leftLowerArm = new Object3D();
  leftLowerArm.name = "leftLowerArm";
  leftLowerArm.position.set(0, 1, 0);
  leftUpperArm.add(leftLowerArm);

  const rightUpperArm = new Object3D();
  rightUpperArm.name = "rightUpperArm";
  rightUpperArm.quaternion.fromArray(mirroredLimbTargetRestRight);
  root.add(rightUpperArm);

  const rightLowerArm = new Object3D();
  rightLowerArm.name = "rightLowerArm";
  rightLowerArm.position.set(0, 1, 0);
  rightUpperArm.add(rightLowerArm);

  root.updateMatrixWorld(true);
  return { root, leftUpperArm, leftLowerArm, rightUpperArm, rightLowerArm };
}

export function createSingleLimbBones(
  targetRest: readonly number[],
  upperName = "leftUpperArm",
  lowerName = "leftLowerArm",
  lowerOffset: readonly number[] = [0, 1, 0]
) {
  const root = new Object3D();
  root.name = "singleLimbRoot";

  const upper = new Object3D();
  upper.name = upperName;
  upper.quaternion.fromArray(targetRest);
  root.add(upper);

  const lower = new Object3D();
  lower.name = lowerName;
  lower.position.set(lowerOffset[0] ?? 0, lowerOffset[1] ?? 1, lowerOffset[2] ?? 0);
  upper.add(lower);

  root.updateMatrixWorld(true);
  return { root, upper, lower };
}

export function createNamedBone(name: string, rotation: readonly number[]): Object3D {
  const bone = new Object3D();
  bone.name = name;
  bone.quaternion.fromArray(rotation);
  return bone;
}

export function sampleThreeClipOnce(root: Object3D, clip: ReturnType<typeof createThreeAnimationClip>, time = 1): void {
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  root.updateMatrixWorld(true);
}

export function readChildDirection(parent: Object3D, child: Object3D): [number, number, number] {
  const parentWorld = new Vector3();
  const childWorld = new Vector3();
  parent.getWorldPosition(parentWorld);
  child.getWorldPosition(childWorld);
  childWorld.sub(parentWorld).normalize();
  return [childWorld.x, childWorld.y, childWorld.z];
}

export function vectorNearlyEqual(actual: readonly number[], expected: readonly number[], tolerance: number): boolean {
  return (
    Math.abs(actual[0]! - expected[0]!) <= tolerance &&
    Math.abs(actual[1]! - expected[1]!) <= tolerance &&
    Math.abs(actual[2]! - expected[2]!) <= tolerance
  );
}

export function distance3(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

export function modelPosition(matrix: Float32Array): [number, number, number] {
  return transformPoint(matrix, [0, 0, 0]);
}

export function matrixDirection(
  matrix: Float32Array,
  localDirection: [number, number, number]
): [number, number, number] {
  const origin = modelPosition(matrix);
  const point = transformPoint(matrix, localDirection);
  return normalizeVec3([point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]);
}

export function assertMat4NearlyEqual(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance: number,
  message: string
): void {
  assert.equal(actual.length, 16, `${message}: actual matrix length`);
  assert.equal(expected.length, 16, `${message}: expected matrix length`);
  for (let index = 0; index < 16; index += 1) {
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= tolerance,
      `${message}: matrix value ${index} expected ${expected[index]} got ${actual[index]}`
    );
  }
}

export function assertFiniteAnimationSampleError(
  report: {
    translation: { rms: number; max: number };
    rotation: { rms: number; max: number };
    scale: { rms: number; max: number };
    modelSpace?: {
      position: { rms: number; max: number };
      rotation: { rms: number; max: number };
      scale: { rms: number; max: number };
      joints: readonly {
        position: { rms: number; max: number };
        rotation: { rms: number; max: number };
        scale: { rms: number; max: number };
      }[];
    };
  },
  label: string
): void {
  assertFiniteSampleErrorMetric(report.translation, `${label} local translation`);
  assertFiniteSampleErrorMetric(report.rotation, `${label} local rotation`);
  assertFiniteSampleErrorMetric(report.scale, `${label} local scale`);
  if (report.modelSpace) assertFiniteModelSpaceSampleError(report.modelSpace, label);
}

export function assertFiniteModelSpaceSampleError(
  report: {
    position: { rms: number; max: number };
    rotation: { rms: number; max: number };
    scale: { rms: number; max: number };
    joints: readonly {
      position: { rms: number; max: number };
      rotation: { rms: number; max: number };
      scale: { rms: number; max: number };
    }[];
  },
  label: string
): void {
  assertFiniteSampleErrorMetric(report.position, `${label} model position`);
  assertFiniteSampleErrorMetric(report.rotation, `${label} model rotation`);
  assertFiniteSampleErrorMetric(report.scale, `${label} model scale`);
  for (const joint of report.joints) {
    assertFiniteSampleErrorMetric(joint.position, `${label} per-joint model position`);
    assertFiniteSampleErrorMetric(joint.rotation, `${label} per-joint model rotation`);
    assertFiniteSampleErrorMetric(joint.scale, `${label} per-joint model scale`);
  }
}

export function assertFiniteSampleErrorMetric(metric: { rms: number; max: number }, label: string): void {
  assert.ok(Number.isFinite(metric.rms), `${label} RMS should be finite`);
  assert.ok(Number.isFinite(metric.max), `${label} max should be finite`);
}

export function quaternionNearlyEqual(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number
): boolean {
  const direct =
    Math.abs(actual[0]! - expected[0]!) <= tolerance &&
    Math.abs(actual[1]! - expected[1]!) <= tolerance &&
    Math.abs(actual[2]! - expected[2]!) <= tolerance &&
    Math.abs(actual[3]! - expected[3]!) <= tolerance;
  const negated =
    Math.abs(actual[0]! + expected[0]!) <= tolerance &&
    Math.abs(actual[1]! + expected[1]!) <= tolerance &&
    Math.abs(actual[2]! + expected[2]!) <= tolerance &&
    Math.abs(actual[3]! + expected[3]!) <= tolerance;
  return direct || negated;
}
