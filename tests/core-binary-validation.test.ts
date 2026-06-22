import type { AnimationClip } from "./test-api.js";
import { assert, decodeAnimationBinary, encodeAnimationBinary, toFloat32Array } from "./test-api.js";
import {
  binaryFloatByteOffsetForTest,
  createLegacyV1NodBinary,
  nodClip,
  quaternionNearlyEqual
} from "./test-helpers.js";

export async function runCoreBinaryValidationTests(): Promise<void> {
  const duplicateDeclaredChannelClip: AnimationClip = {
    id: "duplicate-declared-channel",
    duration: 1,
    tracks: [
      { joint: "head", property: "position", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  };
  const endpointTrackTimeClip: AnimationClip = {
    id: "endpoint-track-time",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      }
    ]
  };

  const decodedNodClip = decodeAnimationBinary(encodeAnimationBinary(nodClip), "nod");
  assert.equal(decodedNodClip.id, "nod");
  assert.equal(decodedNodClip.tracks.length, 1);
  assert.deepEqual(Array.from(decodedNodClip.tracks[0]!.times), [0, 0.5, 1]);
  assert.ok(decodedNodClip.tracks[0]!.values instanceof Float32Array);
  const decodedLegacyNodClip = decodeAnimationBinary(createLegacyV1NodBinary(), "legacy-nod");
  assert.equal(decodedLegacyNodClip.id, "legacy-nod");
  assert.equal(decodedLegacyNodClip.loop, true);
  assert.equal(decodedLegacyNodClip.tracks.length, 1);
  assert.equal(decodedLegacyNodClip.tracks[0]!.humanBone, "head");
  assert.equal(decodedLegacyNodClip.tracks[0]!.property, "rotation");
  assert.deepEqual(Array.from(decodedLegacyNodClip.tracks[0]!.times), [0, 0.5, 1]);
  assert.ok(
    quaternionNearlyEqual(Array.from(decodedLegacyNodClip.tracks[0]!.values.slice(4, 8)), [0.15, 0, 0, 0.9887], 1e-6),
    "decodeAnimationBinary should read legacy v1 track/string/float offsets using the v1 record size"
  );
  const absentSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 28, 0, true);
  new DataView(absentSourceRestFlagBinary).setUint32(32 + 32, 0, true);
  assert.equal(
    decodeAnimationBinary(absentSourceRestFlagBinary, "absent-source-rest-flag").tracks[0]!.sourceRestQuaternion,
    undefined,
    "decodeAnimationBinary should honor a false source-rest presence flag even when legacy offset bytes are non-empty"
  );
  const invalidSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidSourceRestFlagBinary).setUint32(32 + 32, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidSourceRestFlagBinary, "invalid-source-rest-flag"),
    /animation track 0 source-rest presence flag is invalid/,
    "decodeAnimationBinary should reject malformed source-rest presence flags"
  );
  const childDirectionBinaryClip: AnimationClip = {
    id: "binary-child-direction",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "quaternion",
        sourceRestQuaternion: toFloat32Array([0, 0, 0, 1]),
        sourceRestChildDirection: toFloat32Array([0, 1, 0]),
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  const absentChildDirectionFlagBinary = encodeAnimationBinary(childDirectionBinaryClip);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 36, 0, true);
  new DataView(absentChildDirectionFlagBinary).setUint32(32 + 40, 0, true);
  assert.equal(
    decodeAnimationBinary(absentChildDirectionFlagBinary, "absent-child-direction-flag").tracks[0]!
      .sourceRestChildDirection,
    undefined,
    "decodeAnimationBinary should honor a false source-rest child direction presence flag"
  );
  assert.throws(
    () => encodeAnimationBinary({ ...nodClip, id: "binary-non-finite-duration", duration: Number.NaN }),
    /animation clip binary-non-finite-duration is invalid: clip duration must be positive and finite/,
    "binary encoding should reject non-finite clip durations"
  );
  assert.throws(
    () =>
      encodeAnimationBinary({
        id: "binary-non-finite-values",
        duration: 1,
        tracks: [
          {
            joint: "head",
            property: "translation",
            times: toFloat32Array([0]),
            values: toFloat32Array([0, Number.NaN, 0])
          }
        ]
      }),
    /animation clip binary-non-finite-values is invalid: track 0 head\.translation track values must be finite/,
    "binary encoding should reject non-finite track values"
  );
  assert.throws(
    () =>
      encodeAnimationBinary({
        id: "binary-non-normalized-rotation",
        duration: 1,
        tracks: [
          { joint: "head", property: "rotation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0, 2]) }
        ]
      }),
    /animation clip binary-non-normalized-rotation is invalid: track 0 head\.rotation rotation track quaternions must be normalized/,
    "binary encoding should reject non-normalized rotation sample quaternions"
  );
  assert.throws(
    () => encodeAnimationBinary(duplicateDeclaredChannelClip),
    /animation clip duplicate-declared-channel is invalid: track 1 head\.translation duplicate target channel head\.translation conflicts with track 0 \(head\.translation\)/,
    "binary encoding should reject duplicate target channels without a skeleton"
  );
  const invalidTargetKindBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidTargetKindBinary).setUint32(32, 99, true);
  assert.throws(
    () => decodeAnimationBinary(invalidTargetKindBinary, "invalid-target-kind"),
    /animation track 0 target kind is invalid/,
    "decodeAnimationBinary should reject unknown target kinds instead of treating them as joint tracks"
  );
  assert.throws(
    () =>
      decodeAnimationBinary(
        invalidTargetKindBinary.slice(0, invalidTargetKindBinary.byteLength - 1),
        "misaligned-floats"
      ),
    /animation binary float data is misaligned/,
    "decodeAnimationBinary should reject payloads whose float table is not 4-byte aligned"
  );
  const invalidFlagsBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidFlagsBinary).setUint32(20, 2, true);
  assert.throws(
    () => decodeAnimationBinary(invalidFlagsBinary, "invalid-flags"),
    /animation binary flags are invalid/,
    "decodeAnimationBinary should reject unknown binary header flags"
  );
  const nonFiniteDurationBinary = encodeAnimationBinary(nodClip);
  new DataView(nonFiniteDurationBinary).setFloat32(16, Number.NaN, true);
  assert.throws(
    () => decodeAnimationBinary(nonFiniteDurationBinary, "non-finite-binary-duration"),
    /animation binary duration must be positive and finite/,
    "decodeAnimationBinary should reject non-finite binary durations before exposing clips"
  );
  const unsortedBinaryTimes = encodeAnimationBinary(endpointTrackTimeClip);
  new Float32Array(unsortedBinaryTimes, binaryFloatByteOffsetForTest(unsortedBinaryTimes))[1] = 0;
  assert.throws(
    () => decodeAnimationBinary(unsortedBinaryTimes, "unsorted-binary-times"),
    /animation track 0 time values must be sorted/,
    "decodeAnimationBinary should reject duplicate or unsorted binary time samples"
  );
  const nonFiniteBinaryValue = encodeAnimationBinary(nodClip);
  new Float32Array(nonFiniteBinaryValue, binaryFloatByteOffsetForTest(nonFiniteBinaryValue))[3] = Number.NaN;
  assert.throws(
    () => decodeAnimationBinary(nonFiniteBinaryValue, "non-finite-binary-value"),
    /animation track 0 values must be finite/,
    "decodeAnimationBinary should reject non-finite binary value samples"
  );
}
