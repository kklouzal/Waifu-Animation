# Ozz Reference Notes

Reference checkout used during initial design:

- Repository: `https://github.com/guillaumeblanc/ozz-animation`
- Local path: `/Warehouse/_reference/ozz-animation`
- Observed commit: `6cbdc790123aa4731d82e255df187b3a8a808256`
- License: MIT, copyright Guillaume Blanc

`Waifu-Animation` does not copy Ozz C++ implementation code. It intentionally follows these Ozz runtime concepts:

- `Skeleton` stores joint parent indices, joint names, and rest poses as separate arrays. Ozz stores rest poses in SoA form for performance; this library stores one transform per joint because JavaScript engines and VRM adapters consume AoS shapes more naturally.
- `Animation` separates clip metadata from translation, rotation, and scale key data. Ozz sorts runtime keyframes for cache-friendly sampling. This library stores browser-delivered keyframe payloads as versioned binary data, decodes them into typed arrays, validates them aggressively, and samples into local pose buffers.
- Sampling writes local-space transforms. It does not directly mutate renderer bones.
- Root motion follows the Ozz motion extraction/playback split: callers explicitly choose a carrier joint, can extract translation and yaw/full rotation into reusable generic motion tracks with `extractRootMotion`, and can optionally bake selected carrier motion out to a cloned in-place `AnimationClip`. Runtime consumers can sample `MotionTracks`, compute signed interval deltas across looping or clamped ranges, and use `MotionAccumulator`/`MotionSampler` to accumulate motion outside renderer bone mutation. `AnimationRuntime.update(deltaSeconds, { collectRootMotion: true })` still exposes a blended override-layer motion delta without applying that motion to skeleton poses.
- Blending operates on local poses with explicit weights, masks, bind/rest fallback, quaternion shortest-path interpolation, and normalization. Per-joint mask weights follow Ozz semantics: negative and non-finite values are treated as zero, while positive values above `1` are preserved.
- Additive layers are separate from ordinary override blending and are applied as deltas.
- Local-to-model conversion happens after local pose composition and before world-space constraints.
- IK and aim/look-at are procedural jobs with explicit input/output boundaries, not scattered bone writes.
- Two-bone IK exposes correction quaternions for the first two chain joints, matching Ozz's separation between solving the chain and letting the caller apply corrections to the active pose.
- Aim IK accepts Ozz-style local forward/up/offset axes plus model-space joint and target inputs, but returns `jointCorrection` as a model-space delta for Waifu's correction adapters. Apply it before the current model rotation (`jointCorrection * jointModelRotation`); `targetDirection`, `offsettedForward`, `correctedForward`, `correctedUp`, and `alignmentError` are reported in that same model space.
- Two-bone IK keeps soft/limited extension separate from physical reach clamping. A softened solve can leave the endpoint slightly short near full extension without reporting the target as unreachable.
- Foot IK follows the Ozz `samples/foot_ik` ordering at the planning layer: derive ankle targets from ground point/normal, compute pelvis compensation from the lowest foot correction, then solve per-leg IK with explicit clamping and skipped-contact reporting. The TypeScript job returns a plan and correction quaternions for consumers instead of directly mutating renderer bones.

Intentional differences:

- The core is TypeScript and renderer-agnostic, so it avoids Ozz's C++ memory layout and SIMD-specific SoA implementation.
- Ozz `IKAimJob` outputs a local-space correction to multiply with the joint local-space quaternion; `solveAimIk` converts that solve into a model-space correction so it matches Waifu's existing world-correction application path.
- Ozz `MotionExtractor` operates on offline `RawAnimation` and has per-channel loop-distribution behavior. Waifu's first reusable extractor operates on the existing `AnimationClip` carrier tracks, returns generic runtime tracks, and bakes by cloning carrier tracks rather than mutating the input clip or introducing a separate raw-animation type.
- JSON is metadata-only. Waifu ships animation keyframes as `.waifuanim.bin` payloads, decoded by `Waifu-Animation` into typed arrays before runtime sampling or Three.js binding.
- VRM humanoid naming is first-class in adapters and manifests, but generic skeleton math is not VRM-only.
- Visual capture and browser/WebGL integration remain in the Waifu application, not the reusable core.
