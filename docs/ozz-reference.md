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
- Blending operates on local poses with explicit weights, masks, bind/rest fallback, quaternion shortest-path interpolation, and normalization.
- Additive layers are separate from ordinary override blending and are applied as deltas.
- Local-to-model conversion happens after local pose composition and before world-space constraints.
- IK and aim/look-at are procedural jobs with explicit input/output boundaries, not scattered bone writes.
- Foot IK follows the Ozz `samples/foot_ik` ordering at the planning layer: derive ankle targets from ground point/normal, compute pelvis compensation from the lowest foot correction, then solve per-leg IK with explicit clamping and skipped-contact reporting. The TypeScript job returns a plan for consumers instead of directly mutating renderer bones.

Intentional differences:

- The core is TypeScript and renderer-agnostic, so it avoids Ozz's C++ memory layout and SIMD-specific SoA implementation.
- JSON is metadata-only. Waifu ships animation keyframes as `.waifuanim.bin` payloads, decoded by `Waifu-Animation` into typed arrays before runtime sampling or Three.js binding.
- VRM humanoid naming is first-class in adapters and manifests, but generic skeleton math is not VRM-only.
- Visual capture and browser/WebGL integration remain in the Waifu application, not the reusable core.
