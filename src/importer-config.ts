import type {
  AdditiveAnimationClipBuildOptions,
  AnimationOptimizerJointTolerance,
  AnimationOptimizerOptions,
  AnimationOptimizerSampleErrorOptions,
  AnimationOptimizerTolerances
} from "./clip.js";
import type { Transform } from "./math.js";
import type {
  ExtractRawRootMotionOptions,
  MotionCarrier,
  MotionExtractionAxisMask,
  MotionExtractionReference,
  MotionRotationExtractionMode
} from "./motion.js";
import type { BakedCameraJointOptions, MatrixLike, RigidInstanceMatrixOptions } from "./baked.js";
import type { JointReference, Skeleton } from "./skeleton.js";
import type { UserTrackInterpolation, UserTrackType } from "./tracks.js";

export type ImporterConfigIssue = {
  path: string;
  message: string;
  value?: unknown;
};

export type ImporterConfigNormalizationResult<T> = {
  plan: T;
  issues: ImporterConfigIssue[];
};

export type AdditiveReferencePolicy = "first-key" | "skeleton-rest" | "explicit-pose";

export type AdditiveReferenceImportPlan = {
  policy: AdditiveReferencePolicy;
  options: AdditiveAnimationClipBuildOptions;
  requiresSkeletonRestPose: boolean;
  source?: Readonly<Record<string, unknown>>;
};

export type RawMotionChannelImportPlan = {
  reference: MotionExtractionReference;
  bake: boolean;
  loop: boolean;
};

export type RawMotionTranslationImportPlan = RawMotionChannelImportPlan & {
  axes: Required<MotionExtractionAxisMask>;
};

export type RawMotionRotationImportPlan = RawMotionChannelImportPlan & {
  mode: MotionRotationExtractionMode;
  axes: Required<MotionExtractionAxisMask>;
};

export type RawMotionExtractionImportPlan = {
  enabled: boolean;
  options: ExtractRawRootMotionOptions;
  translation: RawMotionTranslationImportPlan | null;
  rotation: RawMotionRotationImportPlan | null;
  nonMutatingBake: boolean;
  source?: Readonly<Record<string, unknown>>;
};

export type AnimationOptimizationImportPlan = {
  enabled: boolean;
  options: AnimationOptimizerOptions;
  tolerances: Required<AnimationOptimizerTolerances>;
  hierarchyWeight: number;
  diagnostics:
    | false
    | {
        sampleFrequency?: number;
        includeModelSpace?: boolean;
      };
  source?: Readonly<Record<string, unknown>>;
};

export type UserTrackSourceProperty = {
  nodeName: string;
  propertyName: string;
  animationName?: string;
  sourceType?: string;
  outputFilename?: string;
};

export type UserTrackImportSpec = {
  name: string;
  type: UserTrackType;
  interpolation: UserTrackInterpolation;
  source: UserTrackSourceProperty;
  metadata: Readonly<Record<string, unknown>>;
};

export type UserTrackImportPlan = {
  tracks: UserTrackImportSpec[];
};

export type BakedSkeletonNodeTypes = {
  skeleton: boolean;
  marker: boolean;
  camera: boolean;
  geometry: boolean;
  light: boolean;
  null: boolean;
  any: boolean;
};

export type BakedRigidInstanceJointFilters = {
  includes: readonly string[];
  excludes: readonly string[];
  caseSensitive: boolean;
};

export type BakedImportPlan = {
  camera: {
    options: BakedCameraJointOptions;
  };
  rigidInstances: {
    options: RigidInstanceMatrixOptions;
    filters: BakedRigidInstanceJointFilters;
  };
  skeletonNodeTypes: BakedSkeletonNodeTypes;
  source?: Readonly<Record<string, unknown>>;
};

export type OzzOfflineImportPlan = {
  additive: AdditiveReferenceImportPlan;
  motion: RawMotionExtractionImportPlan;
  optimization: AnimationOptimizationImportPlan;
  userTracks: UserTrackImportPlan;
  baked: BakedImportPlan;
};

const DEFAULT_OPTIMIZER_TOLERANCES: Required<AnimationOptimizerTolerances> = {
  translation: 1e-3,
  rotation: 1e-3,
  scale: 1e-3
};

const OZZ_DEFAULT_TRANSLATION_AXES: Required<MotionExtractionAxisMask> = { x: true, y: false, z: true };
const OZZ_DEFAULT_ROTATION_AXES: Required<MotionExtractionAxisMask> = { x: false, y: true, z: false };
const DEFAULT_BAKED_NODE_TYPES: BakedSkeletonNodeTypes = {
  skeleton: true,
  marker: false,
  camera: false,
  geometry: false,
  light: false,
  null: false,
  any: false
};

export function normalizeOzzOfflineImportConfig(
  input: unknown
): ImporterConfigNormalizationResult<OzzOfflineImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const record = asRecord(input);
  const firstAnimation = readFirstAnimationRecord(record);
  const additive = normalizeAdditiveReferenceImportConfig(
    readFirstDefined(record, ["additive", "additiveReference", "additive_reference"])
  );
  const motion = normalizeRawMotionExtractionImportConfig(
    readFirstDefined(record, ["motion", "motionExtraction", "motion_extraction", "rootMotion", "root_motion"])
  );
  const optimization = normalizeAnimationOptimizationImportConfig(
    readFirstDefined(record, ["optimization", "optimizationSettings", "optimization_settings"]) ??
      readFirstDefined(firstAnimation, ["optimization", "optimizationSettings", "optimization_settings"])
  );
  const userTracks = normalizeUserTrackImportSpecs(input);
  const baked = normalizeBakedImportConfig(input);
  issues.push(...additive.issues, ...motion.issues, ...optimization.issues, ...userTracks.issues, ...baked.issues);
  return {
    plan: {
      additive: additive.plan,
      motion: motion.plan,
      optimization: optimization.plan,
      userTracks: userTracks.plan,
      baked: baked.plan
    },
    issues
  };
}

export function normalizeAdditiveReferenceImportConfig(
  input: unknown
): ImporterConfigNormalizationResult<AdditiveReferenceImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const record = asRecord(input);
  const source = cloneRecord(readFirstDefined(record, ["source", "metadata"]));
  const rawPolicy =
    typeof input === "string"
      ? input
      : readFirstDefined(record, ["policy", "reference", "referencePolicy", "reference_policy"]);
  const referencePose = readFirstDefined(record, ["referencePose", "reference_pose", "pose"]);
  const policy = normalizeAdditiveReferencePolicy(rawPolicy, referencePose, issues, "additive.policy");

  if (policy === "explicit-pose") {
    const pose = normalizeReferencePose(referencePose, issues, "additive.referencePose");
    if (pose.length > 0) {
      return {
        plan: withOptionalSource(
          {
            policy,
            options: { referencePose: pose },
            requiresSkeletonRestPose: false
          },
          source
        ),
        issues
      };
    }
    issues.push({
      path: "additive.referencePose",
      message: "explicit additive reference pose is invalid; using first keyed sample"
    });
    return {
      plan: withOptionalSource(
        {
          policy: "first-key",
          options: {},
          requiresSkeletonRestPose: false
        },
        source
      ),
      issues
    };
  }

  return {
    plan: withOptionalSource(
      {
        policy,
        options: {},
        requiresSkeletonRestPose: policy === "skeleton-rest"
      },
      source
    ),
    issues
  };
}

export function toAdditiveAnimationOptions(
  plan: AdditiveReferenceImportPlan,
  skeleton?: Skeleton
): AdditiveAnimationClipBuildOptions {
  if (plan.policy === "skeleton-rest" && skeleton) {
    return { referencePose: skeleton.restPose.map(cloneTransformStrict) };
  }
  return plan.options.referencePose ? { referencePose: plan.options.referencePose.map(cloneTransformStrict) } : {};
}

export function normalizeRawMotionExtractionImportConfig(
  input: unknown
): ImporterConfigNormalizationResult<RawMotionExtractionImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const record = asRecord(input);
  const source = cloneRecord(readFirstDefined(record, ["source", "metadata"]));
  const enabled = readBoolean(readFirstDefined(record, ["enable", "enabled"]), true, issues, "motion.enabled");
  const reference = readMotionReference(
    readFirstDefined(record, ["reference"]),
    "skeleton",
    issues,
    "motion.reference"
  );
  const defaultBake = readBoolean(readFirstDefined(record, ["bake"]), true, issues, "motion.bake");
  const defaultLoop = readBoolean(readFirstDefined(record, ["loop"]), false, issues, "motion.loop");
  const carrier = normalizeMotionCarrier(
    readFirstDefined(record, ["carrier", "root", "rootJoint", "root_joint", "rootJointIndex", "root_joint_index"]),
    issues,
    "motion.carrier"
  );

  const translation = enabled
    ? normalizeMotionTranslationChannel(
        readFirstDefined(record, ["translation", "position"]),
        reference,
        defaultBake,
        defaultLoop,
        issues
      )
    : null;
  const rotation = enabled
    ? normalizeMotionRotationChannel(
        readFirstDefined(record, ["rotation"]),
        reference,
        defaultBake,
        defaultLoop,
        issues
      )
    : null;

  const options: ExtractRawRootMotionOptions = {
    translation: translation
      ? {
          axes: translation.axes,
          reference: translation.reference,
          bake: translation.bake,
          loop: translation.loop
        }
      : false,
    rotation: rotation
      ? {
          mode: rotation.mode,
          reference: rotation.reference,
          bake: rotation.bake,
          loop: rotation.loop
        }
      : false
  };
  if (carrier) options.carrier = carrier;
  const rawAnimationId = readString(readFirstDefined(record, ["rawAnimationId", "raw_animation_id"]));
  if (rawAnimationId) options.rawAnimationId = rawAnimationId;

  return {
    plan: withOptionalSource(
      {
        enabled,
        options,
        translation,
        rotation,
        nonMutatingBake: Boolean(translation?.bake || rotation?.bake)
      },
      source
    ),
    issues
  };
}

export function toRawRootMotionExtractionOptions(plan: RawMotionExtractionImportPlan): ExtractRawRootMotionOptions {
  return cloneRawRootMotionOptions(plan.options);
}

export function normalizeAnimationOptimizationImportConfig(
  input: unknown
): ImporterConfigNormalizationResult<AnimationOptimizationImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const record = asRecord(input);
  const source = cloneRecord(readFirstDefined(record, ["source", "metadata"]));
  const enabled = readBoolean(readFirstDefined(record, ["enable", "enabled"]), true, issues, "optimization.enabled");
  const toleranceFallback = readFiniteNonNegative(
    readFirstDefined(record, ["tolerance"]),
    DEFAULT_OPTIMIZER_TOLERANCES.translation,
    issues,
    "optimization.tolerance"
  );
  const tolerancesRecord = asRecord(readFirstDefined(record, ["tolerances", "localTolerances", "local_tolerances"]));
  const tolerances: Required<AnimationOptimizerTolerances> = {
    translation: readFiniteNonNegative(
      readFirstDefined(tolerancesRecord, ["translation"]) ??
        readFirstDefined(record, ["translationTolerance", "translation_tolerance"]),
      toleranceFallback,
      issues,
      "optimization.tolerances.translation"
    ),
    rotation: readFiniteNonNegative(
      readFirstDefined(tolerancesRecord, ["rotation"]) ??
        readFirstDefined(record, ["rotationTolerance", "rotation_tolerance"]),
      toleranceFallback,
      issues,
      "optimization.tolerances.rotation"
    ),
    scale: readFiniteNonNegative(
      readFirstDefined(tolerancesRecord, ["scale"]) ?? readFirstDefined(record, ["scaleTolerance", "scale_tolerance"]),
      toleranceFallback,
      issues,
      "optimization.tolerances.scale"
    )
  };
  const hierarchyWeight = readFiniteNonNegative(
    readFirstDefined(record, ["hierarchyWeight", "hierarchy_weight"]) ?? readFirstDefined(record, ["distance"]),
    0,
    issues,
    "optimization.hierarchyWeight"
  );
  const jointTolerances = normalizeJointTolerances(record, issues);
  const diagnostics = normalizeOptimizationDiagnostics(record, issues);
  const options: AnimationOptimizerOptions = {
    tolerances,
    hierarchyWeight
  };
  if (Object.keys(jointTolerances).length > 0) options.jointTolerances = jointTolerances;
  const sampleError = diagnosticsToSampleError(diagnostics);
  if (sampleError !== false && sampleError !== undefined) options.sampleError = sampleError;

  return {
    plan: withOptionalSource(
      {
        enabled,
        options,
        tolerances,
        hierarchyWeight,
        diagnostics
      },
      source
    ),
    issues
  };
}

export function toAnimationOptimizerOptions(
  plan: AnimationOptimizationImportPlan,
  skeleton?: Skeleton
): AnimationOptimizerOptions {
  const options: AnimationOptimizerOptions = {
    tolerances: { ...plan.tolerances },
    hierarchyWeight: plan.hierarchyWeight
  };
  if (plan.options.jointTolerances) {
    options.jointTolerances = cloneJointTolerances(plan.options.jointTolerances);
  }
  if (skeleton) options.skeleton = skeleton;
  const sampleError = plan.diagnostics !== false && skeleton ? diagnosticsToSampleError(plan.diagnostics) : false;
  if (sampleError !== false && sampleError !== undefined) options.sampleError = sampleError;
  return options;
}

export function normalizeUserTrackImportSpecs(input: unknown): ImporterConfigNormalizationResult<UserTrackImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const specs = findUserTrackSpecInputs(input);
  const tracks: UserTrackImportSpec[] = [];
  specs.forEach(({ value, path, animationName }, index) => {
    const record = asRecord(value);
    if (!record) {
      issues.push({ path, message: "user track import spec must be an object", value });
      return;
    }
    const type = normalizeUserTrackType(
      readFirstDefined(record, ["type", "trackType", "track_type"]),
      issues,
      `${path}.type`
    );
    if (!type) return;
    const source = normalizeUserTrackSource(record, animationName, issues, path);
    if (!source) return;
    const interpolation = normalizeInterpolation(
      readFirstDefined(record, ["interpolation", "defaultInterpolation", "default_interpolation"]),
      "linear",
      issues,
      `${path}.interpolation`
    );
    const rawName = readString(readFirstDefined(record, ["name", "trackName", "track_name"]));
    const name = rawName && rawName.length > 0 ? rawName : `${source.nodeName}.${source.propertyName}`;
    tracks.push({
      name,
      type,
      interpolation,
      source,
      metadata: {
        sourceIndex: index,
        sourcePath: path,
        ...clonePlainRecord(record)
      }
    });
  });
  return { plan: { tracks }, issues };
}

export function normalizeBakedImportConfig(input: unknown): ImporterConfigNormalizationResult<BakedImportPlan> {
  const issues: ImporterConfigIssue[] = [];
  const record = asRecord(input);
  const source = cloneRecord(readFirstDefined(record, ["source", "metadata"]));
  const skeletonImport = asRecord(asRecord(readFirstDefined(record, ["skeleton"]))?.import);
  const nodeTypes = normalizeBakedNodeTypes(
    readFirstDefined(skeletonImport, ["types", "nodeTypes", "node_types"]),
    issues
  );
  const cameraOptions = normalizeBakedCameraOptions(
    readFirstDefined(record, ["camera", "cameraJoint", "camera_joint"]),
    issues
  );
  const rigid = normalizeBakedRigidInstances(
    readFirstDefined(record, ["rigidInstances", "rigid_instances", "instances"]),
    issues
  );
  return {
    plan: withOptionalSource(
      {
        camera: { options: cameraOptions },
        rigidInstances: rigid,
        skeletonNodeTypes: nodeTypes
      },
      source
    ),
    issues
  };
}

export function toBakedCameraJointOptions(plan: BakedImportPlan): BakedCameraJointOptions {
  return { ...plan.camera.options };
}

export function toRigidInstanceMatrixOptions(plan: BakedImportPlan, skeleton?: Skeleton): RigidInstanceMatrixOptions {
  const options: RigidInstanceMatrixOptions = { ...plan.rigidInstances.options };
  if (
    skeleton &&
    (plan.rigidInstances.filters.includes.length > 0 || plan.rigidInstances.filters.excludes.length > 0)
  ) {
    options.jointIndices = resolveFilteredJointIndices(skeleton, plan.rigidInstances.filters);
  }
  return options;
}

function normalizeAdditiveReferencePolicy(
  value: unknown,
  referencePose: unknown,
  issues: ImporterConfigIssue[],
  path: string
): AdditiveReferencePolicy {
  if (referencePose !== undefined) return "explicit-pose";
  if (value === undefined || value === null) return "first-key";
  const raw = readString(value);
  if (!raw) {
    issues.push({ path, message: "unsupported additive reference policy; using first keyed sample", value });
    return "first-key";
  }
  const normalized = raw.trim().toLocaleLowerCase().replace(/_/g, "-");
  if (normalized === "first" || normalized === "first-key" || normalized === "first-frame" || normalized === "default")
    return "first-key";
  if (
    normalized === "skeleton" ||
    normalized === "rest" ||
    normalized === "rest-pose" ||
    normalized === "skeleton-rest"
  )
    return "skeleton-rest";
  if (normalized === "explicit" || normalized === "explicit-pose" || normalized === "pose") return "explicit-pose";
  issues.push({ path, message: "unsupported additive reference policy; using first keyed sample", value });
  return "first-key";
}

function normalizeReferencePose(input: unknown, issues: ImporterConfigIssue[], path: string): Transform[] {
  if (!Array.isArray(input)) {
    issues.push({ path, message: "additive reference pose must be an array of transforms", value: input });
    return [];
  }
  const pose: Transform[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const transform = normalizeTransform(input[index], `${path}[${index}]`, issues);
    if (!transform) return [];
    pose.push(transform);
  }
  return pose;
}

function normalizeMotionTranslationChannel(
  input: unknown,
  defaultReference: MotionExtractionReference,
  defaultBake: boolean,
  defaultLoop: boolean,
  issues: ImporterConfigIssue[]
): RawMotionTranslationImportPlan | null {
  if (input === false || input === null) return null;
  const record = asRecord(input);
  const axes = normalizeAxisMask(
    readFirstDefined(record, ["axes", "components"]),
    OZZ_DEFAULT_TRANSLATION_AXES,
    issues,
    "motion.translation.axes"
  );
  return {
    axes,
    reference: readMotionReference(
      readFirstDefined(record, ["reference"]),
      defaultReference,
      issues,
      "motion.translation.reference"
    ),
    bake: readBoolean(readFirstDefined(record, ["bake"]), defaultBake, issues, "motion.translation.bake"),
    loop: readBoolean(readFirstDefined(record, ["loop"]), defaultLoop, issues, "motion.translation.loop")
  };
}

function normalizeMotionRotationChannel(
  input: unknown,
  defaultReference: MotionExtractionReference,
  defaultBake: boolean,
  defaultLoop: boolean,
  issues: ImporterConfigIssue[]
): RawMotionRotationImportPlan | null {
  if (input === false || input === null) return null;
  const record = asRecord(input);
  const axes = normalizeAxisMask(
    readFirstDefined(record, ["axes", "components"]),
    OZZ_DEFAULT_ROTATION_AXES,
    issues,
    "motion.rotation.axes"
  );
  const mode = normalizeRotationMode(readFirstDefined(record, ["mode"]), axes, issues, "motion.rotation.mode");
  return {
    mode,
    axes,
    reference: readMotionReference(
      readFirstDefined(record, ["reference"]),
      defaultReference,
      issues,
      "motion.rotation.reference"
    ),
    bake: readBoolean(readFirstDefined(record, ["bake"]), defaultBake, issues, "motion.rotation.bake"),
    loop: readBoolean(readFirstDefined(record, ["loop"]), defaultLoop, issues, "motion.rotation.loop")
  };
}

function normalizeRotationMode(
  value: unknown,
  axes: Required<MotionExtractionAxisMask>,
  issues: ImporterConfigIssue[],
  path: string
): MotionRotationExtractionMode {
  if (value !== undefined) {
    if (value === "yaw" || value === "full") return value;
    issues.push({ path, message: "rotation mode must be yaw or full; using axes-derived mode", value });
  }
  if (axes.x || axes.z) {
    if (!axes.y) {
      issues.push({
        path: "motion.rotation.axes",
        message: "pitch/roll-only extraction is not supported by core raw extraction; using full rotation"
      });
    }
    return "full";
  }
  return "yaw";
}

function normalizeAxisMask(
  value: unknown,
  fallback: Required<MotionExtractionAxisMask>,
  issues: ImporterConfigIssue[],
  path: string
): Required<MotionExtractionAxisMask> {
  if (value === undefined) return { ...fallback };
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === "all" || normalized === "xyz") return { x: true, y: true, z: true };
    if (normalized === "none") return { x: false, y: false, z: false };
    const axes = { x: false, y: false, z: false };
    for (const token of normalized.split(/[\s,|+]+/).filter(Boolean)) {
      if (token === "x" || token === "y" || token === "z") axes[token] = true;
      else issues.push({ path, message: "axis mask contains unsupported component", value: token });
    }
    return axes;
  }
  if (Array.isArray(value)) {
    const axes = { x: false, y: false, z: false };
    for (const axis of value) {
      if (isAxisName(axis)) axes[axis] = true;
      else issues.push({ path, message: "axis mask array entries must be x, y, or z", value: axis });
    }
    return axes;
  }
  const record = asRecord(value);
  if (!record) {
    issues.push({ path, message: "axis mask must be a string, array, or object; using defaults", value });
    return { ...fallback };
  }
  return {
    x: readBoolean(record.x, fallback.x, issues, `${path}.x`),
    y: readBoolean(record.y, fallback.y, issues, `${path}.y`),
    z: readBoolean(record.z, fallback.z, issues, `${path}.z`)
  };
}

function isAxisName(value: unknown): value is "x" | "y" | "z" {
  return value === "x" || value === "y" || value === "z";
}

function normalizeMotionCarrier(
  input: unknown,
  issues: ImporterConfigIssue[],
  path: string
): MotionCarrier | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "number") {
    if (Number.isInteger(input) && input >= 0) return { jointIndex: input };
    issues.push({
      path,
      message: "motion carrier joint index must be a non-negative integer; using root",
      value: input
    });
    return undefined;
  }
  if (typeof input === "string") return { joint: input };
  const record = asRecord(input);
  if (!record) {
    issues.push({
      path,
      message: "motion carrier must be a joint name, joint index, or object; using root",
      value: input
    });
    return undefined;
  }
  const jointIndex = readFirstDefined(record, ["jointIndex", "joint_index", "index"]);
  if (jointIndex !== undefined) return normalizeMotionCarrier(jointIndex, issues, `${path}.jointIndex`);
  const joint = readString(readFirstDefined(record, ["joint", "name", "jointName", "joint_name"]));
  if (joint) return { joint };
  const humanBone = readString(readFirstDefined(record, ["humanBone", "human_bone", "humanoid"]));
  if (humanBone) return { humanBone };
  issues.push({
    path,
    message: "motion carrier object must name jointIndex, joint, or humanBone; using root",
    value: input
  });
  return undefined;
}

function readMotionReference(
  value: unknown,
  fallback: MotionExtractionReference,
  issues: ImporterConfigIssue[],
  path: string
): MotionExtractionReference {
  if (value === undefined || value === null) return fallback;
  if (value === "absolute" || value === "skeleton" || value === "animation") return value;
  issues.push({ path, message: "motion reference must be absolute, skeleton, or animation; using fallback", value });
  return fallback;
}

function normalizeJointTolerances(
  record: Record<string, unknown> | null,
  issues: ImporterConfigIssue[]
): Record<string, AnimationOptimizerJointTolerance> {
  const output: Record<string, AnimationOptimizerJointTolerance> = {};
  const raw = readFirstDefined(record, ["jointTolerances", "joint_tolerances", "overrides", "override"]);
  if (raw === undefined) return output;
  if (Array.isArray(raw)) {
    raw.forEach((entry, index) => {
      const normalized = normalizeJointToleranceEntry(entry, `optimization.override[${index}]`, issues);
      if (normalized) output[normalized.key] = normalized.value;
    });
    return output;
  }
  const overrides = asRecord(raw);
  if (!overrides) {
    issues.push({
      path: "optimization.jointTolerances",
      message: "joint tolerance overrides must be an object or array",
      value: raw
    });
    return output;
  }
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = normalizeJointToleranceValues(value, `optimization.jointTolerances.${key}`, issues);
    if (normalized) output[key] = normalized;
  }
  return output;
}

function normalizeJointToleranceEntry(
  input: unknown,
  path: string,
  issues: ImporterConfigIssue[]
): { key: string; value: AnimationOptimizerJointTolerance } | null {
  const record = asRecord(input);
  if (!record) {
    issues.push({ path, message: "joint tolerance override must be an object", value: input });
    return null;
  }
  const keyValue = readFirstDefined(record, [
    "name",
    "joint",
    "jointName",
    "joint_name",
    "humanBone",
    "human_bone",
    "index",
    "jointIndex",
    "joint_index"
  ]);
  const key =
    typeof keyValue === "number" && Number.isInteger(keyValue) && keyValue >= 0
      ? String(keyValue)
      : readString(keyValue);
  if (!key) {
    issues.push({
      path,
      message: "joint tolerance override must include a joint name, humanoid name, or joint index",
      value: input
    });
    return null;
  }
  const normalized = normalizeJointToleranceValues(record, path, issues);
  return normalized ? { key, value: normalized } : null;
}

function normalizeJointToleranceValues(
  input: unknown,
  path: string,
  issues: ImporterConfigIssue[]
): AnimationOptimizerJointTolerance | null {
  const record = asRecord(input);
  if (!record) {
    issues.push({ path, message: "joint tolerance override value must be an object", value: input });
    return null;
  }
  const toleranceFallback = readFiniteNonNegative(
    readFirstDefined(record, ["tolerance"]),
    Number.NaN,
    issues,
    `${path}.tolerance`
  );
  const output: AnimationOptimizerJointTolerance = {};
  const translation = readFiniteNonNegative(
    readFirstDefined(record, ["translation", "translationTolerance", "translation_tolerance"]),
    toleranceFallback,
    issues,
    `${path}.translation`
  );
  const rotation = readFiniteNonNegative(
    readFirstDefined(record, ["rotation", "rotationTolerance", "rotation_tolerance"]),
    toleranceFallback,
    issues,
    `${path}.rotation`
  );
  const scale = readFiniteNonNegative(
    readFirstDefined(record, ["scale", "scaleTolerance", "scale_tolerance"]),
    toleranceFallback,
    issues,
    `${path}.scale`
  );
  if (Number.isFinite(translation)) output.translation = translation;
  if (Number.isFinite(rotation)) output.rotation = rotation;
  if (Number.isFinite(scale)) output.scale = scale;
  const rawWeight = readFirstDefined(record, ["weight"]) ?? readFirstDefined(record, ["distance"]);
  if (rawWeight !== undefined) {
    const weight = readFinitePositive(rawWeight, 1, issues, `${path}.weight`);
    output.weight = weight;
  }
  return Object.keys(output).length > 0 ? output : null;
}

function normalizeOptimizationDiagnostics(
  record: Record<string, unknown> | null,
  issues: ImporterConfigIssue[]
): AnimationOptimizationImportPlan["diagnostics"] {
  const raw = readFirstDefined(record, ["diagnostics", "sampleError", "sample_error"]);
  if (raw === undefined || raw === false) return false;
  if (raw === true) return {};
  const diagnostics = asRecord(raw);
  if (!diagnostics) {
    issues.push({
      path: "optimization.diagnostics",
      message: "optimizer diagnostics must be boolean or object; disabling diagnostics",
      value: raw
    });
    return false;
  }
  const output: Exclude<AnimationOptimizationImportPlan["diagnostics"], false> = {};
  const sampleFrequency = readFirstDefined(diagnostics, ["sampleFrequency", "sample_frequency"]);
  if (sampleFrequency !== undefined) {
    output.sampleFrequency = readFinitePositive(
      sampleFrequency,
      30,
      issues,
      "optimization.diagnostics.sampleFrequency"
    );
  }
  const includeModelSpace = readFirstDefined(diagnostics, ["includeModelSpace", "include_model_space"]);
  if (includeModelSpace !== undefined) {
    output.includeModelSpace = readBoolean(
      includeModelSpace,
      true,
      issues,
      "optimization.diagnostics.includeModelSpace"
    );
  }
  return output;
}

function diagnosticsToSampleError(
  diagnostics: AnimationOptimizationImportPlan["diagnostics"]
): true | AnimationOptimizerSampleErrorOptions | false {
  if (diagnostics === false) return false;
  const sampleError: AnimationOptimizerSampleErrorOptions = {};
  if (diagnostics.sampleFrequency !== undefined) sampleError.sampleFrequency = diagnostics.sampleFrequency;
  if (diagnostics.includeModelSpace !== undefined) sampleError.includeModelSpace = diagnostics.includeModelSpace;
  return Object.keys(sampleError).length === 0 ? true : sampleError;
}

function normalizeUserTrackType(value: unknown, issues: ImporterConfigIssue[], path: string): UserTrackType | null {
  const raw = readString(value);
  if (!raw) {
    issues.push({ path, message: "user track type is required", value });
    return null;
  }
  const normalized = raw.trim().toLocaleLowerCase();
  switch (normalized) {
    case "float":
    case "float1":
    case "kfloat1":
      return "float";
    case "float2":
    case "kfloat2":
      return "float2";
    case "float3":
    case "point":
    case "vector":
    case "kfloat3":
    case "kpoint":
    case "kvector":
      return "float3";
    case "float4":
    case "kfloat4":
      return "float4";
    case "quaternion":
    case "quat":
      return "quaternion";
    default:
      issues.push({ path, message: "unsupported user track type", value });
      return null;
  }
}

function normalizeUserTrackSource(
  record: Record<string, unknown>,
  animationName: string | undefined,
  issues: ImporterConfigIssue[],
  path: string
): UserTrackSourceProperty | null {
  const nodeName = readString(readFirstDefined(record, ["nodeName", "node_name", "jointName", "joint_name", "joint"]));
  const propertyName = readString(readFirstDefined(record, ["propertyName", "property_name", "property", "name"]));
  if (!nodeName) {
    issues.push({ path: `${path}.nodeName`, message: "user track source node/joint name is required" });
    return null;
  }
  if (!propertyName) {
    issues.push({ path: `${path}.propertyName`, message: "user track source property name is required" });
    return null;
  }
  const source: UserTrackSourceProperty = { nodeName, propertyName };
  const localAnimationName = readString(readFirstDefined(record, ["animationName", "animation_name"]));
  const resolvedAnimationName = localAnimationName ?? animationName;
  if (resolvedAnimationName) source.animationName = resolvedAnimationName;
  const sourceType = readString(readFirstDefined(record, ["sourceType", "source_type", "type"]));
  if (sourceType) source.sourceType = sourceType;
  const outputFilename = readString(
    readFirstDefined(record, ["filename", "output", "outputFilename", "output_filename"])
  );
  if (outputFilename) source.outputFilename = outputFilename;
  return source;
}

function normalizeInterpolation(
  value: unknown,
  fallback: UserTrackInterpolation,
  issues: ImporterConfigIssue[],
  path: string
): UserTrackInterpolation {
  if (value === undefined || value === null) return fallback;
  if (value === "linear" || value === "step") return value;
  issues.push({ path, message: "user track interpolation must be linear or step; using fallback", value });
  return fallback;
}

function findUserTrackSpecInputs(input: unknown): { value: unknown; path: string; animationName?: string }[] {
  if (isUnknownArray(input)) return input.map((value, index) => ({ value, path: `userTracks[${index}]` }));
  const record = asRecord(input);
  const direct = readFirstDefined(record, ["userTracks", "user_tracks", "properties"]);
  if (isUnknownArray(direct)) return direct.map((value, index) => ({ value, path: `userTracks[${index}]` }));
  const tracks = asRecord(readFirstDefined(record, ["tracks"]));
  if (isUnknownArray(tracks?.properties))
    return tracks.properties.map((value, index) => ({ value, path: `tracks.properties[${index}]` }));
  const animations = readFirstDefined(record, ["animations"]);
  if (!isUnknownArray(animations)) return [];
  const specs: { value: unknown; path: string; animationName?: string }[] = [];
  animations.forEach((animation, animationIndex) => {
    const animationRecord = asRecord(animation);
    const animationName = readString(
      readFirstDefined(animationRecord, ["name", "filename", "animationName", "animation_name"])
    );
    const animationTracks = asRecord(readFirstDefined(animationRecord, ["tracks"]));
    const properties = animationTracks?.properties;
    if (!isUnknownArray(properties)) return;
    properties.forEach((value, propertyIndex) => {
      const item: { value: unknown; path: string; animationName?: string } = {
        value,
        path: `animations[${animationIndex}].tracks.properties[${propertyIndex}]`
      };
      if (animationName) item.animationName = animationName;
      specs.push(item);
    });
  });
  return specs;
}

function normalizeBakedNodeTypes(input: unknown, issues: ImporterConfigIssue[]): BakedSkeletonNodeTypes {
  const output: BakedSkeletonNodeTypes = { ...DEFAULT_BAKED_NODE_TYPES };
  const record = asRecord(input);
  if (!record) return output;
  for (const key of Object.keys(output) as (keyof BakedSkeletonNodeTypes)[]) {
    output[key] = readBoolean(record[key], output[key], issues, `baked.skeletonNodeTypes.${key}`);
  }
  return output;
}

function normalizeBakedCameraOptions(input: unknown, issues: ImporterConfigIssue[]): BakedCameraJointOptions {
  if (typeof input === "string" && input.length > 0) return { includes: input };
  const record = asRecord(input);
  if (!record) return { includes: "camera" };
  const options: BakedCameraJointOptions = {};
  const joint = normalizeJointReference(
    readFirstDefined(record, ["joint", "jointName", "joint_name", "index", "jointIndex", "joint_index"]),
    issues,
    "baked.camera.joint"
  );
  if (joint !== undefined) options.joint = joint;
  const includes = readString(readFirstDefined(record, ["includes", "name", "jointIncludes", "joint_includes"]));
  if (includes) options.includes = includes;
  const caseSensitive = readFirstDefined(record, ["caseSensitive", "case_sensitive"]);
  if (caseSensitive !== undefined)
    options.caseSensitive = readBoolean(caseSensitive, false, issues, "baked.camera.caseSensitive");
  const fallbackMatrix = normalizeMatrix(
    readFirstDefined(record, ["fallbackMatrix", "fallback_matrix"]),
    issues,
    "baked.camera.fallbackMatrix"
  );
  if (fallbackMatrix) options.fallbackMatrix = fallbackMatrix;
  if (options.joint === undefined && options.includes === undefined) options.includes = "camera";
  return options;
}

function normalizeBakedRigidInstances(
  input: unknown,
  issues: ImporterConfigIssue[]
): BakedImportPlan["rigidInstances"] {
  const record = asRecord(input);
  const options: RigidInstanceMatrixOptions = {};
  const filters: BakedRigidInstanceJointFilters = { includes: [], excludes: [], caseSensitive: false };
  if (record) {
    const jointIndices = normalizeJointIndices(
      readFirstDefined(record, ["jointIndices", "joint_indices", "indices"]),
      issues,
      "baked.rigidInstances.jointIndices"
    );
    if (jointIndices) options.jointIndices = jointIndices;
    const count = readFirstDefined(record, ["count"]);
    if (count !== undefined) options.count = readNonNegativeInteger(count, 0, issues, "baked.rigidInstances.count");
    const fallbackMatrix = normalizeMatrix(
      readFirstDefined(record, ["fallbackMatrix", "fallback_matrix"]),
      issues,
      "baked.rigidInstances.fallbackMatrix"
    );
    if (fallbackMatrix) options.fallbackMatrix = fallbackMatrix;
    filters.includes = normalizeStringList(
      readFirstDefined(record, ["jointNameIncludes", "joint_name_includes", "includes"]),
      issues,
      "baked.rigidInstances.includes"
    );
    filters.excludes = normalizeStringList(
      readFirstDefined(record, ["jointNameExcludes", "joint_name_excludes", "excludes"]),
      issues,
      "baked.rigidInstances.excludes"
    );
    filters.caseSensitive = readBoolean(
      readFirstDefined(record, ["caseSensitive", "case_sensitive"]),
      false,
      issues,
      "baked.rigidInstances.caseSensitive"
    );
  }
  return { options, filters };
}

function normalizeJointReference(
  input: unknown,
  issues: ImporterConfigIssue[],
  path: string
): JointReference | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isInteger(input) && input >= -1) return input;
  issues.push({ path, message: "joint reference must be a name or integer index", value: input });
  return undefined;
}

function normalizeJointIndices(input: unknown, issues: ImporterConfigIssue[], path: string): number[] | undefined {
  if (input === undefined) return undefined;
  if (!isUnknownArray(input)) {
    issues.push({ path, message: "joint indices must be an array", value: input });
    return undefined;
  }
  const output: number[] = [];
  input.forEach((value, index) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) output.push(value);
    else issues.push({ path: `${path}[${index}]`, message: "joint index must be a non-negative integer", value });
  });
  return output;
}

function normalizeMatrix(input: unknown, issues: ImporterConfigIssue[], path: string): MatrixLike | undefined {
  if (input === undefined) return undefined;
  if (!isMatrixLike(input)) {
    issues.push({ path, message: "matrix must contain 16 finite numeric components", value: input });
    return undefined;
  }
  return Array.from({ length: 16 }, (_, index) => input[index]!);
}

function resolveFilteredJointIndices(skeleton: Skeleton, filters: BakedRigidInstanceJointFilters): number[] {
  const includes = filters.includes.map((value) => (filters.caseSensitive ? value : value.toLocaleLowerCase()));
  const excludes = filters.excludes.map((value) => (filters.caseSensitive ? value : value.toLocaleLowerCase()));
  const output: number[] = [];
  skeleton.joints.forEach((joint, index) => {
    const name = filters.caseSensitive ? joint.name : joint.name.toLocaleLowerCase();
    const included = includes.length === 0 || includes.some((needle) => name.includes(needle));
    const excluded = excludes.some((needle) => name.includes(needle));
    if (included && !excluded) output.push(index);
  });
  return output;
}

function normalizeTransform(input: unknown, path: string, issues: ImporterConfigIssue[]): Transform | null {
  const record = asRecord(input);
  if (!record) {
    issues.push({ path, message: "transform must be an object", value: input });
    return null;
  }
  const translation = normalizeNumberTuple(record.translation, 3, `${path}.translation`, issues);
  const rotation = normalizeNumberTuple(record.rotation, 4, `${path}.rotation`, issues);
  const scale = normalizeNumberTuple(record.scale, 3, `${path}.scale`, issues);
  if (!translation || !rotation || !scale) return null;
  return {
    translation: [translation[0]!, translation[1]!, translation[2]!],
    rotation: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    scale: [scale[0]!, scale[1]!, scale[2]!]
  };
}

function normalizeNumberTuple(
  input: unknown,
  length: number,
  path: string,
  issues: ImporterConfigIssue[]
): number[] | null {
  if (!isArrayLike(input) || input.length < length) {
    issues.push({ path, message: `expected ${length} numeric components`, value: input });
    return null;
  }
  const output: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = input[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ path: `${path}[${index}]`, message: "component must be finite", value });
      return null;
    }
    output.push(value);
  }
  return output;
}

function cloneTransformStrict(transform: Transform): Transform {
  return {
    translation: [transform.translation[0], transform.translation[1], transform.translation[2]],
    rotation: [transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]],
    scale: [transform.scale[0], transform.scale[1], transform.scale[2]]
  };
}

function cloneRawRootMotionOptions(options: ExtractRawRootMotionOptions): ExtractRawRootMotionOptions {
  const cloned: ExtractRawRootMotionOptions = {};
  if (options.translation === false) {
    cloned.translation = false;
  } else if (typeof options.translation === "object") {
    cloned.translation = {
      ...options.translation,
      ...(options.translation.axes ? { axes: { ...options.translation.axes } } : {})
    };
  } else if (options.translation !== undefined) {
    cloned.translation = options.translation;
  }
  if (options.rotation === false || options.rotation === "yaw" || options.rotation === "full") {
    cloned.rotation = options.rotation;
  } else if (typeof options.rotation === "object") {
    cloned.rotation = { ...options.rotation };
  }
  if (options.carrier) cloned.carrier = { ...options.carrier };
  if (options.reference !== undefined) cloned.reference = options.reference;
  if (options.bake !== undefined) cloned.bake = options.bake;
  if (options.loop !== undefined) cloned.loop = options.loop;
  if (options.rawAnimationId !== undefined) cloned.rawAnimationId = options.rawAnimationId;
  return cloned;
}

function cloneJointTolerances(
  input: NonNullable<AnimationOptimizerOptions["jointTolerances"]>
): NonNullable<AnimationOptimizerOptions["jointTolerances"]> {
  const output: Record<string, AnimationOptimizerJointTolerance> = {};
  for (const [key, value] of Object.entries(input)) output[key] = { ...value };
  return output;
}

function readFirstDefined(record: Record<string, unknown> | null, keys: readonly string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function readFirstAnimationRecord(record: Record<string, unknown> | null): Record<string, unknown> | null {
  const animations = readFirstDefined(record, ["animations"]);
  return Array.isArray(animations) ? asRecord(animations[0]) : null;
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function readBoolean(input: unknown, fallback: boolean, issues: ImporterConfigIssue[], path: string): boolean {
  if (input === undefined) return fallback;
  if (typeof input === "boolean") return input;
  issues.push({ path, message: "value must be boolean; using fallback", value: input });
  return fallback;
}

function readFiniteNonNegative(input: unknown, fallback: number, issues: ImporterConfigIssue[], path: string): number {
  if (input === undefined) return fallback;
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) return input;
  issues.push({ path, message: "value must be finite and non-negative; using fallback", value: input });
  return fallback;
}

function readFinitePositive(input: unknown, fallback: number, issues: ImporterConfigIssue[], path: string): number {
  if (input === undefined) return fallback;
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input;
  issues.push({ path, message: "value must be positive and finite; using fallback", value: input });
  return fallback;
}

function readNonNegativeInteger(input: unknown, fallback: number, issues: ImporterConfigIssue[], path: string): number {
  if (typeof input === "number" && Number.isInteger(input) && input >= 0) return input;
  issues.push({ path, message: "value must be a non-negative integer; using fallback", value: input });
  return fallback;
}

function normalizeStringList(input: unknown, issues: ImporterConfigIssue[], path: string): string[] {
  if (input === undefined) return [];
  if (typeof input === "string") return input.length > 0 ? [input] : [];
  if (!Array.isArray(input)) {
    issues.push({ path, message: "value must be a string or string array", value: input });
    return [];
  }
  const output: string[] = [];
  input.forEach((value, index) => {
    if (typeof value === "string" && value.length > 0) output.push(value);
    else issues.push({ path: `${path}[${index}]`, message: "value must be a non-empty string", value });
  });
  return output;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function isUnknownArray(input: unknown): input is unknown[] {
  return Array.isArray(input);
}

function cloneRecord(input: unknown): Record<string, unknown> | undefined {
  const record = asRecord(input);
  return record ? clonePlainRecord(record) : undefined;
}

function clonePlainRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) output[key] = value;
  return output;
}

function withOptionalSource<T extends object>(value: T, source: Record<string, unknown> | undefined): T {
  if (!source) return value;
  return { ...value, source };
}

function isArrayLike(input: unknown): input is ArrayLike<number> {
  return (
    typeof input === "object" &&
    input !== null &&
    "length" in input &&
    Number.isInteger((input as ArrayLike<number>).length)
  );
}

function isMatrixLike(input: unknown): input is MatrixLike {
  if (!isArrayLike(input) || input.length < 16) return false;
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(input[index])) return false;
  }
  return true;
}
