import type { Transform } from "./math.js";
import type { HumanoidBoneNameLike } from "./skeleton.js";

export type TrackProperty = "translation" | "rotation" | "scale" | "position" | "quaternion";
export type NormalizedTrackProperty = "translation" | "rotation" | "scale";

export type RotationSpace = "local-source" | "normalized-humanoid-delta";

export type AnimationTrack = {
  joint?: string;
  humanBone?: HumanoidBoneNameLike;
  property: TrackProperty;
  times: Float32Array;
  values: Float32Array;
  /**
   * Rotation values are legacy local source-bone samples by default. New importer-baked humanoid clips use
   * normalized-humanoid-delta: VRM Animation/Pixiv normalized humanoid relative rotations in identity rest space.
   */
  rotationSpace?: RotationSpace;
  sourceRestQuaternion?: Float32Array;
  sourceRestChildDirection?: Float32Array;
};

export type AnimationClip = {
  id: string;
  name?: string;
  duration: number;
  loop?: boolean;
  tracks: AnimationTrack[];
  metadata?: Record<string, unknown>;
};

export type ClipValidationIssue = {
  track?: number;
  joint?: string;
  index?: number;
  property?: string;
  message: string;
};

export type SampleRepairDiagnostic = ClipValidationIssue & {
  sample?: number;
};

export type SampleOptions = {
  loop?: boolean;
  restPose?: readonly Transform[];
  diagnostics?: SampleRepairDiagnostic[];
  sourceBasisQuaternion?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
  targetRestChildDirection?: (humanBone: string, jointIndex: number) => ArrayLike<number> | null | undefined;
  /** Skip structurally unsupported external channels after validation has reported them. */
  skipUnsupportedTracks?: boolean;
};

export type SampleRatioOptions = Omit<SampleOptions, "loop">;
