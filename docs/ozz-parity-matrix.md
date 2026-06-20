# Ozz Capability Parity Matrix

This matrix compares `Waifu-Animation` against the local Ozz Animation reference checkout at `/Warehouse/_reference/ozz-animation`. It is meant to drive coding slices, not to copy Ozz implementation details.

Ozz is MIT licensed. `Waifu-Animation` may reimplement compatible concepts and public behavior, but should not blindly copy Ozz C++ implementation code, memory layout, or SDK integration.

## Status And Priority

- `implemented`: the current TypeScript library covers the capability at the reusable runtime/API level.
- `partial`: a useful subset exists, but material Ozz behavior or sample coverage is missing.
- `missing`: no source-level equivalent was found.
- `intentionally different`: the capability belongs at a different boundary for a TypeScript/browser/VRM library.
- `not applicable to TS/browser core`: keep outside the core unless a consumer explicitly needs it.

Priority:

- `P0`: core parity gap that blocks Ozz-like runtime behavior.
- `P1`: high-value reusable runtime or asset-pipeline gap.
- `P2`: useful parity or tooling gap after the core runtime surfaces exist.
- `P3`: app-owned, optional, or only worth adding for a concrete consumer.

## Intentional Non-1:1 Differences

- `Waifu-Animation` is TypeScript and stores transforms as AoS objects/typed arrays. Ozz stores runtime skeleton and animation data in C++ SoA/SIMD-friendly layouts.
- Ozz jobs validate raw pointer/span inputs and operate on caller-owned buffers. Waifu exposes safer TypeScript functions/classes that allocate ordinary arrays unless an output parameter already exists.
- Three.js and VRM concerns stay in `src/three.ts` and app adapters. Core pose math should stay renderer-agnostic.
- Rendering, visual capture, audio, websocket state, WebGL scenes, and final avatar presentation remain app-owned.
- Waifu uses `.waifuanim.bin` for browser-ready animation payloads. It does not read or write Ozz `.ozz` archives.
- Ozz FBX import depends on Autodesk FBX SDK. Waifu should not bundle an FBX SDK dependency unless explicitly added as a separate Node/offline import package.

## Runtime Capabilities

| Ozz capability | Ozz evidence | Current status | Waifu evidence | Implementation notes |
| --- | --- | --- | --- | --- |
| Runtime skeleton: parent-index hierarchy, joint names, rest poses, max-joint guard | `include/ozz/animation/runtime/skeleton.h` | implemented | `src/skeleton.ts`, `tests/run-tests.ts` | Uses AoS `SkeletonJoint` plus `Int16Array` parents and VRM humanoid maps. Keeps Ozz-style 1024-joint safety limit. |
| Runtime animation clip object | `include/ozz/animation/runtime/animation.h` | partial | `src/clip.ts`, `src/binary.ts`, `tests/run-tests.ts` | `AnimationClip` covers duration, looping, TRS tracks, binary encode/decode, and metadata. Missing Ozz-style immutable runtime `Animation` with sorted packed key controllers, timepoint tables, iframe acceleration, archive tags, and keyframe-count utilities. `P1` if sampling scale/perf becomes important. |
| Sampling skeletal animation into local-space transforms | `include/ozz/animation/runtime/sampling_job.h`, `samples/playback` | partial | `src/clip.ts`, `src/runtime.ts`, `tests/run-tests.ts` | Samples by seconds with loop/clamp handling, linear vec3 interpolation, quaternion slerp, diagnostics, and rest-pose fallback. Missing `SamplingJob::Context`-style cache/coherent forward sampling, ratio API, iframe seeking, and step interpolation. `P1`. |
| Override blending with rest-pose fallback threshold | `include/ozz/animation/runtime/blending_job.h`, `samples/blend` | implemented | `src/pose.ts`, `src/runtime.ts`, `docs/architecture.md`, `tests/run-tests.ts` | Supports layer weights, masks, negative weight sanitation, quaternion shortest-path accumulation, rest fallback threshold, runtime priority groups, crossfade orchestration, and diagnostics. Priority groups are a Waifu extension. |
| Additive blending | `include/ozz/animation/runtime/blending_job.h`, `samples/additive` | implemented | `src/pose.ts`, `src/runtime.ts`, `tests/run-tests.ts` | `additiveDeltaPose`, `applyAdditivePose`, signed additive runtime weights, and masks cover runtime additive layering. Offline additive animation building remains partial below. |
| Partial-body blending and joint masks | `include/ozz/animation/runtime/blending_job.h`, `samples/partial_blend` | implemented | `src/pose.ts`, `src/masks.ts`, `src/runtime.ts`, `src/three.ts`, `tests/run-tests.ts` | `createJointMask`, `createSubtreeJointMask`, source-track policies, and overlay upper-body policy cover the reusable mask behavior. |
| Local-to-model conversion | `include/ozz/animation/runtime/local_to_model_job.h`, `samples/playback` | partial | `src/skeleton.ts`, `src/runtime.ts`, `tests/run-tests.ts` | Converts full local pose to model matrices. Missing Ozz options for root matrix, range-limited `from`/`to`, and `from_excluded` partial hierarchy updates. `P2`. |
| Motion playback and runtime motion blending | `include/ozz/animation/runtime/motion_blending_job.h`, `samples/framework/motion_utils.*`, `samples/motion_playback`, `samples/motion_blend` | partial | `src/motion.ts`, `src/runtime.ts`, `src/manifest.ts`, `src/masks.ts`, `docs/ozz-reference.md`, `tests/run-tests.ts` | Can sample a motion carrier, compute looping interval deltas, collect/blend root-motion deltas from override layers, and validate root-motion policy metadata. Missing generic motion tracks, MotionSampler/MotionAccumulator path controls, angular path deformation, and offline extraction/bake. `P1`. |
| Generic runtime tracks: float, float2, float3, float4, quaternion | `include/ozz/animation/runtime/track.h`, `samples/user_channel`, `samples/motion_playback` | partial | `src/clip.ts` | `AnimationTrack` only covers skeletal TRS-style tracks. There is no generic named user-channel track type, no float/float2/float4 track types, no quaternion user track, and no step/linear per-key mode. `P1`. |
| Track sampling | `include/ozz/animation/runtime/track_sampling_job.h`, `samples/user_channel` | partial | `src/clip.ts`, `src/motion.ts`, `tests/run-tests.ts` | `sampleTrack` samples `AnimationTrack` by time. Ozz samples generic tracks by ratio and supports all track value types. Add `sampleUserTrack`/`TrackSamplingJob` equivalents with step interpolation. `P1`. |
| Track triggering / edge detection | `include/ozz/animation/runtime/track_triggering_job.h`, `include/ozz/animation/runtime/track_triggering_job_trait.h`, `samples/user_channel` | missing | none found | Needed for frame-rate independent user channels such as attach/detach events. Implement threshold crossing over arbitrary forward/backward/looping ranges. `P1`. |
| Two-bone IK job | `include/ozz/animation/runtime/ik_two_bone_job.h`, `samples/two_bone_ik` | partial | `src/ik.ts`, `src/three.ts`, `tests/run-tests.ts` | Current solver handles root/joint/end positions, pole vector, max stretch, reach reporting, and correction quaternions. Missing model-matrix job API, local middle axis validation, twist angle, separate soften ratio semantics, weight blending, and direct child-range update helpers. `P1`. |
| Aim IK job | `include/ozz/animation/runtime/ik_aim_job.h`, `samples/look_at`, `samples/foot_ik` | missing | `src/procedural.ts`, `src/three.ts` only provide higher-level look/presence targets | `distributeLookAt` returns yaw/pitch distribution but not an Ozz-style `IKAimJob` correction quaternion with forward/up axes, offset, pole vector, twist angle, weight, and reach flag. This blocks full look-at and ankle-alignment parity. `P0`. |
| Skeleton utilities | `include/ozz/animation/runtime/skeleton_utils.h`, `samples/partial_blend` | partial | `src/skeleton.ts`, `src/pose.ts`, `src/attachments.ts`, `tests/run-tests.ts` | Existing APIs resolve names/humanoid bones and create subtree masks. Missing exported `getJointLocalRestPose`, `isLeaf`, depth-first iterator, and reverse-depth-first iterator. `P2`. |
| Animation utilities | `include/ozz/animation/runtime/animation_utils.h`, `samples/optimize` | missing | none found | Add keyframe count/stat helpers for translation, rotation, scale, total tracks, and maybe per-track diagnostics once runtime animation/track surfaces are formalized. `P2/P3`. |
| Attachment from model-space joint matrices | `samples/attach` | implemented | `src/attachments.ts`, `docs/architecture.md`, `tests/run-tests.ts` | Pre-resolved attachment bindings and joint-relative offset composition match the Ozz attach sample concept. |
| Runtime validation/debug diagnostics | Ozz jobs expose `Validate()` per job | intentionally different | `src/validation.ts`, `src/debug.ts`, `src/runtime.ts`, `src/asset-validation.ts`, `tests/run-tests.ts` | Waifu uses structured validation reports and optional evaluation diagnostics instead of job-level bool validation. Keep this TypeScript-friendly shape. |

## Offline And Import Capabilities

| Ozz capability | Ozz evidence | Current status | Waifu evidence | Implementation notes |
| --- | --- | --- | --- | --- |
| `RawSkeleton` editable hierarchy | `include/ozz/animation/offline/raw_skeleton.h`, `samples/millipede` | partial | `src/skeleton.ts` | `JointDefinition` can build flat parent-index skeletons directly. Missing mutable hierarchical roots/children API, breadth-first/depth-first raw traversal helpers, and raw serialization. `P2`. |
| `SkeletonBuilder` | `include/ozz/animation/offline/skeleton_builder.h` | partial | `src/skeleton.ts` | `createSkeleton` builds runtime data directly, but there is no raw-to-runtime builder that preserves Ozz's offline/runtime split or depth-first ordering contract. `P2`. |
| `RawAnimation` editable per-joint key tracks | `include/ozz/animation/offline/raw_animation.h`, `samples/millipede`, `samples/optimize` | partial | `src/clip.ts` | `AnimationClip` is editable and validated, but is also the runtime clip type. Missing offline `JointTrack` separation, strict raw validation type, and raw archive support. `P1/P2`. |
| Raw animation utilities | `include/ozz/animation/offline/raw_animation_utils.h`, `samples/optimize` | partial | `src/clip.ts`, `src/asset-validation.ts` | Sampling and validation exist for runtime clips/tracks. Missing raw `SampleAnimation`, `ExtractTimePoints`, and fixed-rate sampling time utility. `P2`. |
| `AnimationBuilder` | `include/ozz/animation/offline/animation_builder.h` | partial | `src/binary.ts`, `src/clip.ts` | Encoding validates and packs `.waifuanim.bin`, but there is no explicit raw-to-runtime builder with iframe interval, key controller packing, or immutable runtime output. `P1` if adding runtime `Animation` parity. |
| `AdditiveAnimationBuilder` | `include/ozz/animation/offline/additive_animation_builder.h`, `samples/additive` | partial | `src/pose.ts`, `src/runtime.ts` | Runtime additive deltas exist, but no offline raw clip-to-delta clip builder using first frame or a reference pose. `P2`. |
| `AnimationOptimizer` | `include/ozz/animation/offline/animation_optimizer.h`, `samples/optimize` | missing | none found | Add keyframe reduction with hierarchy-aware error tolerance and per-joint overrides if asset size/runtime cost becomes a problem. `P2`. |
| `MotionExtractor` | `include/ozz/animation/offline/motion_extractor.h`, `samples/motion_extraction` | missing | `src/motion.ts`, `src/manifest.ts` only cover runtime sampling/policy validation | Needed to extract root translation/rotation into tracks, optionally bake/remove motion from the source clip, choose reference mode, select axes, and make loopable motion. `P1`. |
| `RawTrack` user-channel tracks | `include/ozz/animation/offline/raw_track.h`, `samples/user_channel`, `samples/motion_extraction` | missing | none found beyond `AnimationTrack` | Add raw float/float2/float3/float4/quaternion track types with ratio keys and step/linear interpolation. `P1`. |
| Raw track utilities | `include/ozz/animation/offline/raw_track_utils.h` | missing | none found beyond `sampleTrack` on `AnimationTrack` | Add ratio sampling and validation for raw user tracks. `P1`. |
| `TrackBuilder` | `include/ozz/animation/offline/track_builder.h` | missing | none found | Needed after raw track types to produce runtime track payloads for user channels and motion tracks. `P1`. |
| `TrackOptimizer` | `include/ozz/animation/offline/track_optimizer.h` | missing | none found | Add redundant-key removal for user/motion tracks. `P2`. |
| FBX manager, IO settings, axis/unit conversion, scene loading | `include/ozz/animation/offline/fbx/fbx.h`, `src/animation/offline/fbx/*` | intentionally different | none found | Do not add to browser core. If needed, create a separate optional Node/offline package or CLI and decide whether an FBX SDK dependency is acceptable. `P3`. |
| FBX skeleton import | `include/ozz/animation/offline/fbx/fbx_skeleton.h`, `samples/baked/config.json` | missing / intentionally different | none found | Current library expects consumers to provide skeletons/VRM mappings. Optional importer should live outside core. `P3`. |
| FBX animation and property/user-track import | `include/ozz/animation/offline/fbx/fbx_animation.h`, `samples/user_channel/config.json`, `samples/motion_extraction` | missing / intentionally different | none found | No FBX animation import, custom property import, or track extraction. Prefer external conversion tooling over runtime dependency. `P3`. |
| Ozz archive I/O (`.ozz`) | Ozz runtime/offline headers use `io::Archive` tags | intentionally different | `src/binary.ts`, `docs/ozz-reference.md` | Waifu uses `.waifuanim.bin`; direct `.ozz` archive compatibility is not needed for TS/browser core unless a tooling bridge is requested. `P3`. |

## Sample-Demonstrated Capabilities

| Ozz sample capability | Ozz evidence | Current status | Waifu evidence | Implementation notes |
| --- | --- | --- | --- | --- |
| Playback: load clip/skeleton, sample, local-to-model, render | `samples/playback` | implemented | `src/runtime.ts`, `src/clip.ts`, `src/skeleton.ts`, `src/three.ts`, `README.md`, `tests/run-tests.ts` | Core playback exists; app owns actual rendering and currently can also play authored clips through Three `AnimationMixer`. |
| Blend: walk/jog/run style weighted blending and speed sync | `samples/blend` | partial | `src/runtime.ts`, `src/pose.ts`, `src/three.ts`, `tests/run-tests.ts` | Weighted blend exists. Ozz sample-specific speed synchronization across a locomotion set is not a first-class helper. `P2`. |
| Partial blend | `samples/partial_blend` | implemented | `src/pose.ts`, `src/masks.ts`, `src/three.ts`, `tests/run-tests.ts` | Subtree and policy masks cover lower/upper-body split patterns. |
| Additive pose/animation | `samples/additive` | implemented for runtime, partial for offline | `src/pose.ts`, `src/runtime.ts`, `tests/run-tests.ts` | Runtime additive layers exist. Offline additive clip generation remains a gap. `P2`. |
| Skinning / local-to-model | `samples/skinning`, `include/ozz/geometry/runtime/skinning_job.h` | intentionally different | `src/skeleton.ts`, `src/three.ts`, `docs/architecture.md` | Local-to-model matrices exist. Skinning, inverse-bind-pose mesh processing, and rendering stay with Three/app consumers. `P3`. |
| Attach object to joint | `samples/attach` | implemented | `src/attachments.ts`, `tests/run-tests.ts` | Binding and offset composition are reusable and renderer-agnostic. |
| Foot IK | `samples/foot_ik` | partial | `src/ik.ts`, `src/three.ts`, `docs/ozz-reference.md`, `tests/run-tests.ts` | Has ankle target planning, pelvis compensation, two-bone corrections, clamping/skipped statuses, and optional Three application. Missing Ozz-style aim IK ankle alignment and full activation/blend state machine. `P1`. |
| Look-at / aim IK | `samples/look_at` | partial | `src/procedural.ts`, `src/three.ts`, `tests/run-tests.ts` | Look-at distribution and presence targets exist, but full aim job parity is missing. `P0`. |
| Two-bone IK demo | `samples/two_bone_ik` | partial | `src/ik.ts`, `tests/run-tests.ts` | Position solve and correction quaternions exist; job parity gaps are listed in runtime matrix. `P1`. |
| User channels and attachment edge triggering | `samples/user_channel`, `samples/user_channel/config.json` | missing | none found | Requires generic tracks, track sampling by ratio, and track triggering. `P1`. |
| Motion extraction | `samples/motion_extraction` | missing | `src/motion.ts`, `src/manifest.ts` only cover runtime/policy side | Add offline extraction/bake once generic raw/runtime track types exist. `P1`. |
| Motion playback | `samples/motion_playback`, `samples/framework/motion_utils.*` | partial | `src/motion.ts`, `src/runtime.ts`, `tests/run-tests.ts` | Interval deltas and layer blending exist; missing persistent motion-track accumulator helpers and angular path deformation. `P1/P2`. |
| Motion blending | `samples/motion_blend` | partial | `src/runtime.ts`, `src/motion.ts`, `tests/run-tests.ts` | Blends override-layer motion deltas by effective weight. Missing separate generic motion tracks and sample-style accumulator API. `P1/P2`. |
| Baked/scaled tracks and instanced rigid objects | `samples/baked`, `samples/baked/config.json` | partial / intentionally different | `src/clip.ts`, `src/skeleton.ts`, `src/three.ts` | Scale tracks and local-to-model support exist. Camera-as-joint and instanced rendering are app/importer responsibilities. `P3`. |
| Offline procedural skeleton/animation creation | `samples/millipede` | partial | `src/skeleton.ts`, `src/clip.ts` | Can create runtime skeletons and clips directly. Missing Ozz-style raw offline builders and rebuildable raw hierarchy/animation APIs. `P2`. |
| Keyframe optimization visualization | `samples/optimize` | missing | `src/asset-validation.ts`, `src/debug.ts` only provide validation/metrics | No optimizer or raw/runtime error comparison helper. `P2`. |
| Multithreaded/perf update pattern | `samples/multithread` | not applicable to TS/browser core | none found | JavaScript runtime constraints differ. If needed, add optional Web Worker/batch evaluator around pure data inputs, not C++ thread parity. `P3`. |
| Crowd/instancing patterns | `samples/baked`, `samples/multithread` | not applicable to TS/browser core | none found | No dedicated crowd API in Ozz reference. Waifu core should remain reusable; app/renderers can batch avatars or instances. `P3`. |

## Recommended First Implementation Slices

1. Generic track runtime/offline surface: add raw/runtime float, float2, float3, float4, and quaternion tracks; ratio sampling with step/linear interpolation; and `TrackTriggeringJob`-style edge iteration. This unlocks user channels and motion tracks.
2. Aim IK plus two-bone IK parity: implement an Ozz-style aim IK correction job and fill two-bone job gaps for mid-axis, twist, soften, weight, and model-matrix inputs. This unlocks full look-at and foot-ankle alignment parity.
3. Motion extraction and playback tooling: after generic tracks exist, add offline root-motion extraction/bake with axis/reference/loop settings plus reusable motion accumulator/sampler helpers for runtime playback and blending.
