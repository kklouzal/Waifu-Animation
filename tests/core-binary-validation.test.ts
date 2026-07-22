import type { AnimationClip } from "./test-api.js";
import { assert, decodeAnimationBinary, encodeAnimationBinary, quatFromAxisAngle, toFloat32Array } from "./test-api.js";
import {
  align4ForTest,
  binaryFloatByteOffsetForTest,
  createLegacyV1NodBinary,
  makeSourceRestQuaternionClip,
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
  const wrappedNodBinary = new Uint8Array(decodedNodClip.tracks[0]!.values.buffer.byteLength + 32);
  wrappedNodBinary.set(new Uint8Array(encodeAnimationBinary(nodClip)), 16);
  const decodedWrappedNodClip = decodeAnimationBinary(
    new Uint8Array(wrappedNodBinary.buffer, 16, encodeAnimationBinary(nodClip).byteLength),
    "wrapped-nod"
  );
  wrappedNodBinary.fill(0, 16);
  assert.deepEqual(
    Array.from(decodedWrappedNodClip.tracks[0]!.times),
    [0, 0.5, 1],
    "decodeAnimationBinary should copy ArrayBufferView input instead of aliasing the caller-owned backing buffer"
  );
  const normalizedDeltaClip: AnimationClip = {
    id: "binary-normalized-delta",
    duration: 1,
    tracks: [
      {
        humanBone: "head",
        property: "rotation",
        rotationSpace: "normalized-humanoid-delta",
        times: toFloat32Array([0]),
        values: toFloat32Array([0, 0, 0, 1])
      }
    ]
  };
  assert.equal(
    decodeAnimationBinary(encodeAnimationBinary(normalizedDeltaClip), "binary-normalized-delta").tracks[0]!
      .rotationSpace,
    "normalized-humanoid-delta",
    "current binary roundtrips should preserve normalized humanoid delta rotation-space metadata"
  );
  const rootMotionPolicyMetadataClip: AnimationClip = {
    id: "binary-root-motion-policy-metadata",
    duration: 1,
    loop: true,
    metadata: {
      rootMotionPolicy: "preserved",
      rootMotionProvenance: "preserved-in-clip",
      rootMotion: {
        carrier: { joint: "root" },
        translationOwner: "animation",
        yawOwner: "animation"
      }
    },
    tracks: [
      {
        joint: "root",
        property: "translation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, 0, 0])
      },
      {
        joint: "root",
        property: "rotation",
        times: toFloat32Array([0, 1]),
        values: toFloat32Array([0, 0, 0, 1, ...quatFromAxisAngle([0, 1, 0], Math.PI / 2)])
      }
    ]
  };
  assert.deepEqual(
    decodeAnimationBinary(encodeAnimationBinary(rootMotionPolicyMetadataClip), "binary-root-motion-policy-metadata")
      .metadata,
    rootMotionPolicyMetadataClip.metadata,
    "current binary roundtrips should preserve root-motion policy/provenance and carrier authority metadata"
  );
  const mixedTargetKindClip: AnimationClip = {
    id: "binary-mixed-target-kinds",
    duration: 1,
    tracks: [
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([1, 0, 0]) },
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([2, 0, 0]) }
    ]
  };
  const decodedMixedTargetKindClip = decodeAnimationBinary(
    encodeAnimationBinary(mixedTargetKindClip),
    "binary-mixed-target-kinds"
  );
  assert.deepEqual(
    decodedMixedTargetKindClip.tracks.map((track) => [track.joint, track.humanBone, Array.from(track.values)]),
    [
      ["head", undefined, [1, 0, 0]],
      [undefined, "head", [2, 0, 0]]
    ],
    "binary target records should preserve joint-vs-humanBone identity even when names match"
  );
  const duplicateDecodedChannelBinary = encodeAnimationBinary({
    id: "duplicate-decoded-channel",
    duration: 1,
    tracks: [
      { joint: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) },
      { joint: "neck", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  });
  new Uint8Array(duplicateDecodedChannelBinary).set(
    new TextEncoder().encode("head"),
    binaryStringByteOffsetForTest(duplicateDecodedChannelBinary) + 4
  );
  assert.throws(
    () => decodeAnimationBinary(duplicateDecodedChannelBinary, "duplicate-decoded-channel"),
    /animation track 1 duplicate target channel head\.translation/,
    "decodeAnimationBinary should reject duplicate target channels from corrupt binary string-table references"
  );
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
  const decodedV2ChildDirectionClip = decodeAnimationBinary(createV2SourceRestChildDirectionBinary(), "v2-child");
  assert.deepEqual(
    Array.from(decodedV2ChildDirectionClip.tracks[0]!.sourceRestChildDirection ?? []),
    [0, 1, 0],
    "decodeAnimationBinary should read v2 source-rest child-direction payloads from 44-byte track records"
  );
  const absentSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(absentSourceRestFlagBinary).setUint32(
    binaryTrackByteOffsetForTest(absentSourceRestFlagBinary) + 28,
    0,
    true
  );
  new DataView(absentSourceRestFlagBinary).setUint32(
    binaryTrackByteOffsetForTest(absentSourceRestFlagBinary) + 32,
    0,
    true
  );
  assert.equal(
    decodeAnimationBinary(absentSourceRestFlagBinary, "absent-source-rest-flag").tracks[0]!.sourceRestQuaternion,
    undefined,
    "decodeAnimationBinary should honor a false source-rest presence flag even when legacy offset bytes are non-empty"
  );
  const invalidSourceRestFlagBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidSourceRestFlagBinary).setUint32(
    binaryTrackByteOffsetForTest(invalidSourceRestFlagBinary) + 32,
    2,
    true
  );
  assert.throws(
    () => decodeAnimationBinary(invalidSourceRestFlagBinary, "invalid-source-rest-flag"),
    /animation track 0 source-rest presence flag is invalid/,
    "decodeAnimationBinary should reject malformed source-rest presence flags"
  );
  const invalidLayoutVersionBinary = encodeAnimationBinary(nodClip);
  new DataView(invalidLayoutVersionBinary).setUint32(12, 44, true);
  assert.throws(
    () => decodeAnimationBinary(invalidLayoutVersionBinary, "invalid-layout-version"),
    /animation binary layout is unsupported/,
    "decodeAnimationBinary should reject version/layout hybrids instead of guessing record semantics"
  );
  const unknownPropertyBinary = encodeAnimationBinary(nodClip);
  new DataView(unknownPropertyBinary).setUint32(binaryTrackByteOffsetForTest(unknownPropertyBinary) + 4, 99, true);
  assert.throws(
    () => decodeAnimationBinary(unknownPropertyBinary, "unknown-property"),
    /unknown animation binary property 99/,
    "decodeAnimationBinary should reject unknown binary property codes"
  );
  const invalidUtf8NameBinary = encodeAnimationBinary(nodClip);
  new Uint8Array(invalidUtf8NameBinary).fill(
    0xff,
    binaryStringByteOffsetForTest(invalidUtf8NameBinary),
    binaryStringByteOffsetForTest(invalidUtf8NameBinary) + new DataView(invalidUtf8NameBinary).getUint32(28, true)
  );
  assert.throws(
    () => decodeAnimationBinary(invalidUtf8NameBinary, "invalid-utf8-name"),
    /animation track 0 target name is not valid utf-8/,
    "decodeAnimationBinary should reject corrupt UTF-8 target names instead of replacement-decoding them"
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
  new DataView(absentChildDirectionFlagBinary).setUint32(
    binaryTrackByteOffsetForTest(absentChildDirectionFlagBinary) + 36,
    0,
    true
  );
  new DataView(absentChildDirectionFlagBinary).setUint32(
    binaryTrackByteOffsetForTest(absentChildDirectionFlagBinary) + 40,
    0,
    true
  );
  assert.equal(
    decodeAnimationBinary(absentChildDirectionFlagBinary, "absent-child-direction-flag").tracks[0]!
      .sourceRestChildDirection,
    undefined,
    "decodeAnimationBinary should honor a false source-rest child direction presence flag"
  );
  const invalidRotationSpacePropertyBinary = encodeAnimationBinary({
    id: "invalid-rotation-space-property",
    duration: 1,
    tracks: [
      { humanBone: "head", property: "translation", times: toFloat32Array([0]), values: toFloat32Array([0, 0, 0]) }
    ]
  });
  new DataView(invalidRotationSpacePropertyBinary).setUint32(
    binaryTrackByteOffsetForTest(invalidRotationSpacePropertyBinary) + 44,
    2,
    true
  );
  assert.throws(
    () => decodeAnimationBinary(invalidRotationSpacePropertyBinary, "invalid-rotation-space-property"),
    /animation binary decoded invalid clip: track 0 head\.translation rotationSpace is only valid on rotation tracks/,
    "decodeAnimationBinary should validate v3 rotation-space metadata against decoded track properties"
  );
  const corruptSourceRestBinary = encodeAnimationBinary(makeSourceRestQuaternionClip("corrupt-source-rest"));
  const corruptSourceRestFloatData = new Float32Array(
    corruptSourceRestBinary,
    binaryFloatByteOffsetForTest(corruptSourceRestBinary)
  );
  corruptSourceRestFloatData.set([0, 0, 0, 2], 5);
  assert.throws(
    () => decodeAnimationBinary(corruptSourceRestBinary, "corrupt-source-rest"),
    /animation binary decoded invalid clip: track 0 head\.rotation sourceRestQuaternion must be normalized/,
    "decodeAnimationBinary should reject corrupt source-rest quaternion metadata after decoding payload bounds"
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
  new DataView(invalidTargetKindBinary).setUint32(binaryTrackByteOffsetForTest(invalidTargetKindBinary), 99, true);
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
  const overlappingBinaryPayload = encodeAnimationBinary(endpointTrackTimeClip);
  const overlappingBinaryView = new DataView(overlappingBinaryPayload);
  overlappingBinaryView.setUint32(overlappingBinaryView.getUint32(8, true) + 20, 0, true);
  assert.throws(
    () => decodeAnimationBinary(overlappingBinaryPayload, "overlapping-binary-payload"),
    /animation track 0 value overlaps another float payload/,
    "decodeAnimationBinary should reject track records whose float ranges overlap"
  );
}

function createV2SourceRestChildDirectionBinary(): ArrayBuffer {
  const headerBytes = 32;
  const trackBytes = 44;
  const name = new TextEncoder().encode("head");
  const floats = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
  const stringByteOffset = headerBytes + trackBytes;
  const floatByteOffset = stringByteOffset + align4ForTest(name.byteLength);
  const buffer = new ArrayBuffer(floatByteOffset + floats.length * Float32Array.BYTES_PER_ELEMENT);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes.set(new TextEncoder().encode("WANI"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, headerBytes, true);
  view.setUint32(12, trackBytes, true);
  view.setFloat32(16, 1, true);
  view.setUint32(20, 0, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, name.byteLength, true);

  view.setUint32(headerBytes, 1, true);
  view.setUint32(headerBytes + 4, 2, true);
  view.setUint32(headerBytes + 8, 0, true);
  view.setUint32(headerBytes + 12, name.byteLength, true);
  view.setUint32(headerBytes + 16, 0, true);
  view.setUint32(headerBytes + 20, 1, true);
  view.setUint32(headerBytes + 24, 1, true);
  view.setUint32(headerBytes + 28, 5, true);
  view.setUint32(headerBytes + 32, 1, true);
  view.setUint32(headerBytes + 36, 9, true);
  view.setUint32(headerBytes + 40, 1, true);

  bytes.set(name, stringByteOffset);
  new Float32Array(buffer, floatByteOffset, floats.length).set(floats);
  return buffer;
}

function binaryStringByteOffsetForTest(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  return view.getUint32(8, true) + view.getUint32(24, true) * view.getUint32(12, true);
}

function binaryTrackByteOffsetForTest(buffer: ArrayBuffer): number {
  return new DataView(buffer).getUint32(8, true);
}
