import { type AnimationClip, type AnimationTrack, type ClipValidationIssue, normalizedTrackProperty, toFloat32Array, trackStride, validateClip } from "./clip.js";

export const WAIFU_ANIMATION_BINARY_FORMAT = "waifu-animation-bin";

const MAGIC = "WANI";
const VERSION = 1;
const HEADER_BYTES = 32;
const TRACK_BYTES = 36;
const NO_OFFSET = 0xffffffff;

type TargetKind = 1 | 2;
type BinaryProperty = 1 | 2 | 3;

const TARGET_HUMAN_BONE: TargetKind = 1;
const TARGET_JOINT: TargetKind = 2;

const PROPERTY_TRANSLATION: BinaryProperty = 1;
const PROPERTY_ROTATION: BinaryProperty = 2;
const PROPERTY_SCALE: BinaryProperty = 3;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeAnimationBinary(clip: AnimationClip): ArrayBuffer {
  assertValidClipForBinaryEncoding(clip);

  const trackRecords = clip.tracks.map((track) => {
    const targetName = track.humanBone ?? track.joint;
    if (!targetName) throw new Error(`animation track in ${clip.id} is missing joint or humanBone`);
    const times = toFloat32Array(track.times);
    const values = toFloat32Array(track.values);
    const property = normalizedTrackProperty(track.property);
    if (!property) throw new Error(`animation track ${targetName}.${track.property} has unsupported property`);
    const stride = trackStride(property);
    if (times.length < 1) throw new Error(`animation track ${targetName}.${track.property} has no keys`);
    if (values.length !== times.length * stride) {
      throw new Error(`animation track ${targetName}.${track.property} has mismatched key/value counts`);
    }
    return {
      targetKind: track.humanBone ? TARGET_HUMAN_BONE : TARGET_JOINT,
      targetName: String(targetName),
      property: encodeProperty(property),
      times,
      values,
      sourceRestQuaternion: readSourceRestQuaternion(track)
    };
  });

  const encodedNames = trackRecords.map((record) => textEncoder.encode(record.targetName));
  const stringBytes = encodedNames.reduce((sum, encoded) => sum + encoded.byteLength, 0);
  const stringPaddedBytes = align4(stringBytes);

  const floatCount = trackRecords.reduce((sum, record) => {
    return sum + record.times.length + record.values.length + (record.sourceRestQuaternion?.length ?? 0);
  }, 0);

  const floatByteOffset = HEADER_BYTES + trackRecords.length * TRACK_BYTES + stringPaddedBytes;
  const byteLength = floatByteOffset + floatCount * Float32Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes.set(textEncoder.encode(MAGIC), 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, HEADER_BYTES, true);
  view.setUint32(12, TRACK_BYTES, true);
  view.setFloat32(16, clip.duration, true);
  view.setUint32(20, clip.loop ? 1 : 0, true);
  view.setUint32(24, trackRecords.length, true);
  view.setUint32(28, stringBytes, true);

  let stringOffset = 0;
  let floatOffset = 0;
  const floatData = new Float32Array(buffer, floatByteOffset, floatCount);

  for (let index = 0; index < trackRecords.length; index += 1) {
    const record = trackRecords[index]!;
    const encodedName = encodedNames[index]!;
    const trackOffset = HEADER_BYTES + index * TRACK_BYTES;
    const timeOffset = floatOffset;
    floatData.set(record.times, floatOffset);
    floatOffset += record.times.length;

    const valueOffset = floatOffset;
    floatData.set(record.values, floatOffset);
    floatOffset += record.values.length;

    let sourceRestOffset = NO_OFFSET;
    if (record.sourceRestQuaternion) {
      sourceRestOffset = floatOffset;
      floatData.set(record.sourceRestQuaternion, floatOffset);
      floatOffset += record.sourceRestQuaternion.length;
    }

    view.setUint32(trackOffset, record.targetKind, true);
    view.setUint32(trackOffset + 4, record.property, true);
    view.setUint32(trackOffset + 8, stringOffset, true);
    view.setUint32(trackOffset + 12, encodedName.byteLength, true);
    view.setUint32(trackOffset + 16, timeOffset, true);
    view.setUint32(trackOffset + 20, valueOffset, true);
    view.setUint32(trackOffset + 24, record.times.length, true);
    view.setUint32(trackOffset + 28, sourceRestOffset, true);
    view.setUint32(trackOffset + 32, record.sourceRestQuaternion ? 1 : 0, true);

    bytes.set(encodedName, HEADER_BYTES + trackRecords.length * TRACK_BYTES + stringOffset);
    stringOffset += encodedName.byteLength;
  }

  return buffer;
}

function assertValidClipForBinaryEncoding(clip: AnimationClip): void {
  const issue = validateClip(clip)[0];
  if (!issue) return;
  throw new Error(`animation clip ${clip.id || "<unknown>"} is invalid: ${formatClipValidationIssue(issue)}`);
}

function formatClipValidationIssue(issue: ClipValidationIssue): string {
  const context: string[] = [];
  if (issue.track !== undefined) context.push(`track ${issue.track}`);
  const channel = [issue.joint, issue.property].filter((value) => value !== undefined && value !== "").join(".");
  if (channel) context.push(channel);
  if (issue.index !== undefined) context.push(`index ${issue.index}`);
  return context.length > 0 ? `${context.join(" ")} ${issue.message}` : issue.message;
}

export function decodeAnimationBinary(input: ArrayBuffer | ArrayBufferView, id = "animation"): AnimationClip {
  const buffer = normalizeArrayBuffer(input);
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < HEADER_BYTES) throw new Error("animation binary is too small");
  if (textDecoder.decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error("animation binary magic is invalid");

  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`unsupported animation binary version ${version}`);
  const headerBytes = view.getUint32(8, true);
  const trackBytes = view.getUint32(12, true);
  if (headerBytes !== HEADER_BYTES || trackBytes !== TRACK_BYTES) throw new Error("animation binary layout is unsupported");

  const duration = view.getFloat32(16, true);
  const flags = view.getUint32(20, true);
  const trackCount = view.getUint32(24, true);
  const stringBytes = view.getUint32(28, true);
  const stringByteOffset = HEADER_BYTES + trackCount * TRACK_BYTES;
  const floatByteOffset = stringByteOffset + align4(stringBytes);
  if (stringByteOffset + stringBytes > bytes.byteLength || floatByteOffset > bytes.byteLength) {
    throw new Error("animation binary table bounds are invalid");
  }
  if ((bytes.byteLength - floatByteOffset) % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("animation binary float data is misaligned");
  }
  const floatData = new Float32Array(buffer, floatByteOffset);
  const tracks: AnimationTrack[] = [];

  for (let index = 0; index < trackCount; index += 1) {
    const trackOffset = HEADER_BYTES + index * TRACK_BYTES;
    const targetKind = view.getUint32(trackOffset, true);
    const propertyCode = view.getUint32(trackOffset + 4, true);
    const nameByteOffset = view.getUint32(trackOffset + 8, true);
    const nameByteLength = view.getUint32(trackOffset + 12, true);
    const timeOffset = view.getUint32(trackOffset + 16, true);
    const valueOffset = view.getUint32(trackOffset + 20, true);
    const keyCount = view.getUint32(trackOffset + 24, true);
    const sourceRestOffset = view.getUint32(trackOffset + 28, true);
    const property = decodeProperty(propertyCode);
    const stride = trackStride(property);

    if (targetKind !== TARGET_HUMAN_BONE && targetKind !== TARGET_JOINT) {
      throw new Error(`animation track ${index} target kind is invalid`);
    }
    if (nameByteOffset + nameByteLength > stringBytes) throw new Error(`animation track ${index} name bounds are invalid`);
    assertFloatBounds(index, "time", timeOffset, keyCount, floatData.length);
    assertFloatBounds(index, "value", valueOffset, keyCount * stride, floatData.length);
    if (sourceRestOffset !== NO_OFFSET) assertFloatBounds(index, "source-rest", sourceRestOffset, 4, floatData.length);

    const name = textDecoder.decode(bytes.subarray(stringByteOffset + nameByteOffset, stringByteOffset + nameByteOffset + nameByteLength));
    const trackBase = {
      property,
      times: floatData.subarray(timeOffset, timeOffset + keyCount),
      values: floatData.subarray(valueOffset, valueOffset + keyCount * stride)
    };
    const sourceRestQuaternion =
      sourceRestOffset !== NO_OFFSET ? floatData.subarray(sourceRestOffset, sourceRestOffset + 4) : undefined;
    const track =
      targetKind === TARGET_HUMAN_BONE
        ? { ...trackBase, humanBone: name, ...(sourceRestQuaternion ? { sourceRestQuaternion } : {}) }
        : { ...trackBase, joint: name, ...(sourceRestQuaternion ? { sourceRestQuaternion } : {}) };
    tracks.push(track);
  }

  return {
    id,
    duration,
    loop: Boolean(flags & 1),
    tracks
  };
}

function encodeProperty(property: "translation" | "rotation" | "scale"): BinaryProperty {
  if (property === "translation") return PROPERTY_TRANSLATION;
  if (property === "rotation") return PROPERTY_ROTATION;
  return PROPERTY_SCALE;
}

function decodeProperty(property: number): "translation" | "rotation" | "scale" {
  if (property === PROPERTY_TRANSLATION) return "translation";
  if (property === PROPERTY_ROTATION) return "rotation";
  if (property === PROPERTY_SCALE) return "scale";
  throw new Error(`unknown animation binary property ${property}`);
}

function readSourceRestQuaternion(track: AnimationTrack): Float32Array | null {
  if (!track.sourceRestQuaternion) return null;
  const sourceRestQuaternion = toFloat32Array(track.sourceRestQuaternion);
  if (sourceRestQuaternion.length !== 4) {
    const targetName = track.humanBone ?? track.joint ?? "<unknown>";
    throw new Error(`animation track ${targetName}.${track.property} sourceRestQuaternion must contain exactly 4 values`);
  }
  return sourceRestQuaternion;
}

function assertFloatBounds(trackIndex: number, label: string, offset: number, count: number, floatCount: number): void {
  if (offset + count > floatCount) throw new Error(`animation track ${trackIndex} ${label} bounds are invalid`);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function normalizeArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const copy = new Uint8Array(input.byteLength);
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  return copy.buffer;
}
