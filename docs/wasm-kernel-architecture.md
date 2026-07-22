# Rust/WASM Kernel Architecture Contract

Status: implemented through Phase 2 scalar Rust/WASM local-to-model plus retained padded-SoA blend, additive, masks, and normalization. Packed sampling, runtime scheduling, skinning, IK, Three.js/VRM, and app integration remain outside the kernel.

## Bounded kernel boundary

The kernel may own only dense numeric jobs whose inputs/outputs can live in one `WebAssembly.Memory` without per-frame JavaScript object marshaling:

1. packed clip sampling into mutable local TRS pose arenas;
2. blend, additive, per-joint masks, quaternion hemisphere accumulation, normalization, and finite-value repair over local pose arenas;
3. local-to-model matrix propagation and partial range refreshes;
4. skinning matrix palette construction and optional CPU skinning over typed buffers;
5. scalar two-bone IK, aim IK, and foot-plant math after their TypeScript parity cases are frozen;
6. a WASM-backed `AnimationRuntime` facade that schedules numeric jobs while TypeScript keeps orchestration.

These stay TypeScript-owned and non-kernel:

- Three.js, VRM, `AnimationMixer`, `Object3D`, `BufferGeometry`, renderer upload flags, debug geometry, and concrete Waifu app integration;
- manifests, includes, URL/loading policy, binary encode/decode wrappers, asset validation, importer/config planning, user/content metadata, and validation/debug/report objects;
- lifecycle/orchestration: async WASM loading, feature selection, fallback, layer ids, crossfade policy, root-motion policy, diagnostics formatting, telemetry, handle ownership, and public API facades.

TypeScript remains the source-compatible public API. WASM receives prevalidated numeric descriptors/handles and returns status codes plus offsets/lengths. Object-shaped results are reused facade views, not per-frame marshaled inputs.

## Current call graph and data-shape audit

### Clip sampling

- Entry points: `sampleClipToPose`, `sampleClipToPoseAtRatio`, `sampleClipToPoseWithContext` in `src/clip-sampling.ts`; packed equivalents in `src/packed-runtime.ts`.
- Current ordinary shape: `AnimationClip.tracks[]` stores `Float32Array times`, `Float32Array values`, string joint/humanoid identifiers, property names, and optional retarget metadata. Sampling starts from `createRestPose(skeleton)` and writes a JS `Transform[]` pose.
- Current packed shape: `PackedRuntimeAnimation` has sorted `keyControllers`, shared `times`/`values`, iframe tables, and per-track seek tables, still represented as TS objects/arrays.
- Hot operations: time wrapping/clamping, coherent lower-key cache reuse/seek, stride-3 lerp, stride-4 slerp, finite repair, quaternion normalization/hemisphere continuity, source-rest retargeting, and per-track writes into pose transforms.
- Kernel rule: raw strings and validation stay TS/import-time. First sampling kernel should mirror `PackedRuntimeAnimation` into static numeric asset handles.

### Blend, additive, and masks

- Entry points: `blendPoses`, `additiveDeltaPose`, `applyAdditivePose`, `normalizePose`, `validateJointMask` in `src/pose.ts`.
- Current shape: `Pose = Transform[]`; `JointMask = Float32Array`; layer records carry pose references, scalar weights, and optional masks.
- Hot operations: all-joint layer loops, mask reads, finite checks, threshold fallback pose contribution, quaternion dot/hemisphere/normalization, additive rest-to-sample delta, and output pose allocation.
- Kernel rule: useful only when poses are already contiguous SoA arenas; do not marshal JS `Transform` objects each frame.

### Local-to-model

- Entry points: `localToModelPose`, `updateLocalToModelPoseRange` in `src/skeleton.ts`; `composeMat4` and `multiplyMat4` in `src/math.ts`.
- Current shape: `Skeleton.parents` is `Int16Array`; local pose is `Transform[]`; model pose is `Mat4[]` of column-major `Float32Array(16)`. Joints are parent-before-child. Range refresh supports `root`, `from`, `to`, and `fromExcluded`.
- Hot operations: one quaternion-to-matrix compose per joint and one parent-child matrix multiply per non-root joint.
- Kernel value: lowest-risk first kernel because data is dense, deterministic, and independent of asset string semantics.

### Skinning palette and CPU skinning

- Entry points: `buildSkinningMatrixPalette`, `skinVertices`, `validateSkinningJob` in `src/skinning.ts`; Three adaptation remains in `src/three-geometry.ts`.
- Current shape: palettes are arrays of mat4-like buffers; `SkinningJob` accepts positions, optional normals/tangents, joint indices/weights, inverse binds, remaps, output buffers, stride/offset, and `restored-last` or explicit weights.
- Hot operations: palette `model * inverseBind`, per-vertex influence loops, restored-last weight reconstruction, finite fallback, normal/tangent vector transforms, output alias/capacity handling.
- Kernel rule: TypeScript validates/adapts geometry; WASM receives sanitized numeric layouts and caller-owned output offsets.

### Two-bone IK, aim IK, and foot plant

- Entry points: `solveTwoBoneIkCorrections`, `solveTwoBoneIkModel`, `applyTwoBoneIkLocalCorrections`, `solveAimIk`, `applyAimIkModelCorrection`, aim chains in `src/ik-core.ts`; foot-plant and Ozz-style leg helpers in `src/foot-plant.ts`.
- Current shape: small fixed Vec3/Quat/Mat4 inputs, local/model pose arrays, ray/contact callbacks for floor acquisition, per-leg plan results, and local-to-model partial refreshes.
- Hot operations: vector normalization/dot/cross, reach clamp/softening, quaternion correction, ankle target projection, pelvis compensation, local correction application, and range refresh.
- Kernel rule: raycasts/contact acquisition and skipped-reason/debug text stay TypeScript. Numeric solve kernels come after local-to-model parity.

### AnimationRuntime composition

- Entry points: `AnimationRuntime.update` and `AnimationRuntime.evaluate` in `src/runtime.ts`.
- Current shape: TypeScript `Map<string, AnimationLayer>` stores clips, masks, weights, priorities, crossfade state, loop/speed, motion-carrier metadata, and optional diagnostics.
- Evaluation call graph: active layer sanitize/sort -> sample each clip -> group override layers by priority -> `blendPoses` -> additive delta/apply -> `normalizePose` -> `localToModelPose` -> object-shaped result.
- Kernel rule: ids, layer ownership, crossfade semantics, diagnostics, root-motion policy, and public result shape stay TypeScript. WASM-backed runtime submits compact numeric layer commands into per-avatar arenas.

## Ranked hot paths

The committed benchmark harness is `benchmarks/wasm-kernel-baseline.ts`, exposed by:

```bash
npm run bench:wasm-kernel:smoke
npm run bench:wasm-kernel -- --iterations 900 --warmup 180 --joints 72 --avatars 24 --runtime-avatars 8
```

It emits JSON only, includes environment/fixture/results/checksums, and intentionally does **not** claim precise heap allocation counts from Node heap deltas.

Observed smoke baseline on Dev-01, 2026-07-22 UTC, command `npm run bench:wasm-kernel:smoke`:

- environment: Node v24.18.0, V8 13.6.233.17-node.50, linux x64, 8 x Intel(R) Xeon(R) CPU E3-1285 v6 @ 4.10GHz, 67,301,683,200 bytes RAM;
- fixture: 72 joints = 18 SoA groups, 3 clips, 216 tracks/clip, 5 keys/track, 2 override layers, 1 additive layer, 4096 CPU-skinned vertices x 4 influences, smoke iterations 60 after 20 warmup;
- scalar-WASM startup: 16.852436 ms, reported separately and excluded from steady-state rows.

| Workload                                                       | ms/avatar-frame |    ops/sec |    Checksum |
| -------------------------------------------------------------- | --------------: | ---------: | ----------: |
| `sampling_3_clips_1_avatar`                                    |     0.810434517 |   1233.906 |   19.292506 |
| `blend_additive_masks_typescript_object_pose_1_avatar`         |     0.221787983 |   4508.811 |   12.768127 |
| `blend_additive_masks_scalar_wasm_already_packed_1_avatar`     |       0.0792188 |  12623.266 |   12.768127 |
| `blend_additive_masks_scalar_wasm_already_packed_multi_avatar` |     0.052393175 |  19086.455 |    51.07251 |
| `local_to_model_1_avatar`                                      |     0.038418733 |  26028.969 |  819.347673 |
| `local_to_model_scalar_wasm_1_avatar`                          |     0.009679633 | 103309.698 |  819.347681 |
| `skinning_palette_cpu_1_avatar`                                |      3.20263725 |    312.243 |  433.285489 |
| `sample_blend_local_to_model_1_avatar`                         |     1.077307217 |     928.24 |  732.760487 |
| `sample_blend_local_to_model_multi_avatar`                     |     0.935913025 |   1068.475 | 2933.879263 |
| `animation_runtime_evaluate_1_avatar`                          |     0.801986383 |   1246.904 |  731.334951 |
| `animation_runtime_evaluate_multi_avatar`                      |     0.779247675 |   1283.289 | 1463.644778 |

These smoke numbers are local synthetic evidence, not a production speedup claim. The TypeScript pose row uses object-shaped poses; the WASM rows begin already packed, so packing/materialization and end-to-end sampling/runtime costs are intentionally outside that comparison.

Measured/structural priority:

1. **Skinning palette and CPU vertex skinning** — largest measured numeric loop in the synthetic workload; high value for CPU-skinned/debug geometry paths, while production GPU-skinned avatars may not hit it every frame.
2. **AnimationRuntime composition frame** — highest aggregate always-on pose-evaluation cost; includes update/sort, sampling, blend/additive/masks, normalization, and local-to-model once per avatar frame.
3. **Clip sampling into local TRS poses** — per active layer per avatar frame; heavy interpolation/repair and current `Transform[]` materialization. Packed sampling is the preferred source shape.
4. **Blend/additive/mask composition** — dense all-joint/layer loops and quaternion accumulation; high value after pose arenas exist.
5. **Local-to-model propagation** — smaller measured slice but safest first kernel and required by IK/skinning/model-space consumers.
6. **Two-bone/aim IK and foot plant** — structurally important for procedural correction, but migrate after local-to-model due to edge-case semantics and partial refresh coupling.

If future target-workload JSON contradicts this order, measured workload priority may change; first implementation safety still starts with local-to-model or blend/local-to-model.

## ABI contract

### Versioning

- ABI identity: `waifu_animation_kernel`, major `1`. Phase 1 is minor `0`; Phase 2 pose jobs report minor `1`.
- Loader calls `wa_version_major()`, `wa_version_minor()`, and `wa_feature_flags()` before enabling any kernel job.
- Major mismatch rejects the kernel. The default scalar local-to-model loader still accepts ABI v1.0. Pose jobs require ABI v1.1, their feature bits, and all four pose-job exports, so the minor addition remains backward-compatible and explicitly gated.
- Exports use C-compatible scalar parameters and return `i32` status. Multi-value returns are written into caller-provided memory structs.

### Status codes

| Code | Name                 | Meaning                                                                 |
| ---: | -------------------- | ----------------------------------------------------------------------- |
|    0 | `WA_OK`              | completed successfully                                                  |
|    1 | `WA_ERR_ABI_VERSION` | loader/kernel ABI mismatch                                              |
|    2 | `WA_ERR_BAD_HANDLE`  | stale, wrong-kind, destroyed, or null handle                            |
|    3 | `WA_ERR_OOB`         | offset/capacity/range exceeds current memory                            |
|    4 | `WA_ERR_INVALID_ARG` | invalid count, enum, alignment, NaN where not sanitizable, or bad range |
|    5 | `WA_ERR_CAPACITY`    | output/arena capacity too small; no partial write committed             |
|    6 | `WA_ERR_UNSUPPORTED` | job or feature unavailable in this build                                |
|    7 | `WA_ERR_INTERNAL`    | invariant violation; loader must fall back and quarantine the instance  |

Debug exports may expose last-error text, but public diagnostics remain TypeScript-owned and must not depend on WASM message wording.

### Handles, offsets, and capacities

- Handles are non-zero `u32` with generation bits. Handle `0` is invalid.
- Static asset handles are immutable after creation: skeletons, packed clips, masks, inverse bind palettes.
- Per-avatar handles own mutable pose/context/scratch ranges.
- Every dynamic buffer parameter is `(offset_bytes: u32, element_count: u32, capacity_bytes: u32)` or a handle descriptor containing those fields.
- Counts are element counts unless the parameter name ends in `_bytes`.
- f32 arrays are 16-byte aligned; matrix regions are 64-byte aligned when practical; descriptors are 8-byte aligned.
- Functions validate `offset + required_bytes <= memory.buffer.byteLength` and `required_bytes <= capacity_bytes` before writes.
- `WA_ERR_CAPACITY` and `WA_ERR_OOB` leave output buffers unchanged.

### Initial exported surface for the first implementation slice

```c
uint32_t wa_version_major(void);
uint32_t wa_version_minor(void);
uint32_t wa_feature_flags(void);
uint32_t wa_memory_epoch(void);
uint32_t wa_refresh_views_required(uint32_t observed_epoch);
uint32_t wa_create_avatar(uint32_t skeleton_handle, uint32_t joint_count, uint32_t flags, uint32_t out_handle_ptr);
uint32_t wa_destroy_handle(uint32_t handle);
uint32_t wa_local_to_model(
  uint32_t avatar_handle,
  uint32_t local_pose_offset,
  uint32_t model_pose_offset,
  uint32_t joint_count,
  uint32_t options_ptr
);
```

Phase 1 adds the support exports needed to materialize that surface from TypeScript without JS-side memory ownership ambiguity:

```c
uint32_t wa_heap_base(void);
uint32_t wa_alloc(uint32_t size_bytes, uint32_t alignment, uint32_t out_offset_ptr);
uint32_t wa_create_skeleton(
  uint32_t parent_indices_offset,
  uint32_t joint_count,
  uint32_t parent_indices_capacity_bytes,
  uint32_t out_handle_ptr
);
uint32_t wa_force_memory_growth_for_test(uint32_t min_extra_pages); /* debug/test only */
uint32_t wa_reset_for_test(void);                                  /* debug/test only */
```

`wa_create_skeleton` creates the documented static skeleton handle from an immutable parent-index table already copied into the exported memory. `wa_create_avatar` requires that skeleton handle and creates the mutable avatar handle. The TypeScript loader treats the debug/test exports as optional and never requires them in production paths.

Phase 1 `wa_local_to_model` uses a 32-byte `options_ptr` descriptor so offsets remain capacity-checked despite the small C-compatible call surface:

| Byte offset | Type  | Meaning                                      |
| ----------: | ----- | -------------------------------------------- |
|           0 | `u32` | parent indices offset                        |
|           4 | `u32` | parent index count                           |
|           8 | `u32` | parent index capacity bytes                  |
|          12 | `i32` | `from`, or `-1`/`NO_PARENT`                  |
|          16 | `i32` | `to`, inclusive                              |
|          20 | `u32` | flags: bit 0 `fromExcluded`, bit 1 `hasRoot` |
|          24 | `u32` | root matrix offset when `hasRoot`            |
|          28 | `u32` | root matrix capacity bytes                   |

The TypeScript `WasmLocalToModelContext` owns reusable local-pose SoA, model-matrix AoS, options, parent, and root-memory regions. Object-shaped `Transform[]`/`Mat4[]` adapters are outside the kernel and are explicit about copying; callers that maintain the SoA view can invoke the per-frame WASM path without per-joint JS object marshaling.

Phase 2 adds `wa_blend_poses`, `wa_additive_delta`, `wa_apply_additive`, and `wa_normalize_pose`. Every pose range includes a capacity, blend uses a retained array of 24-byte descriptors (`pose offset`, `pose capacity`, `weight`, `mask offset`, `mask count`, `mask capacity`), and masks use current TypeScript semantics: omitted means all ones, short means missing joints are zero, extra values are ignored, and sparse masks are ordinary dense buffers with zero entries. All descriptors/ranges/capacities are validated before output writes.

`WasmPoseArenaContext` owns contiguous retained pose slots, mask slots, and layer descriptors per avatar. Slot 0 starts as the skeleton rest pose. `poseView()` and `maskView()` permit already-packed steady-state jobs with caller-selected reusable output slots. `writePose()` and `copyPoseToTransforms()` are explicit object packing/materialization adapters; they do not claim allocation-free object conversion. The contexts keep no process-global TypeScript mutable state, and refresh typed views after memory growth. Existing object-shaped pose APIs remain scalar TypeScript by default.

Later phases add packed sampling, runtime composition, skinning, and IK/foot-plant behind feature bits.

## Memory model and layouts

### One memory

- Use exactly one exported `WebAssembly.Memory` per kernel instance.
- Do not require `SharedArrayBuffer`, threads, atomics, cross-origin isolation, or worker-only execution.
- Memory may grow during asset/avatar creation, never inside per-frame evaluation once capacities are reserved.
- Every successful growth increments `wa_memory_epoch()`.
- TypeScript stores an observed epoch and refreshes all `Float32Array`/`Int32Array`/`Uint8Array` views when the epoch changes or `memory.buffer !== cachedBuffer`.
- Public facades must never retain stale typed-array views after a memory growth.

### Padded groups-of-four SoA TRS

Use Ozz-style padded groups of four joints. `group_count = ceil(joint_count / 4)`, `group = joint >> 2`, `lane = joint & 3`. Padded lanes in the final group are identity and ignored in comparisons.

`WaSoaTransform` per group, 40 f32 / 160 bytes:

| Field       | f32 count | Offset order                       |
| ----------- | --------: | ---------------------------------- |
| translation |        12 | `tx[4]`, `ty[4]`, `tz[4]`          |
| rotation    |        16 | `qx[4]`, `qy[4]`, `qz[4]`, `qw[4]` |
| scale       |        12 | `sx[4]`, `sy[4]`, `sz[4]`          |

Identity is translation `(0,0,0)`, rotation `(0,0,0,1)`, scale `(1,1,1)`.

### Matrix layout

- Model matrices and palettes are column-major 4x4 f32 matrices compatible with current `Mat4`/Three.js order.
- External/facade output is dense AoS: 16 f32 = 64 bytes per joint, joint-major order.
- SIMD-internal matrix SoA may use groups of four with `m00[4]`, `m01[4]`, ..., `m33[4]` order, but any public output offset must be convertible to the AoS column-major contract without per-frame JS object creation.

### Static and mutable arenas

Static skeleton asset arena:

- `i32 parents[joint_count]`, parent before child, `-1` for roots;
- rest local pose as `WaSoaTransform[group_count]`;
- optional rest model matrices and inverse bind matrices;
- optional numeric humanoid remap tables built by TypeScript.

Static packed animation arena:

- header with duration, loop flag, controller count, iframe count;
- sorted controller table with numeric joint index, property enum, stride, key count, time/value offsets, seek table offsets, rotation-space enum;
- f32 time/value buffers and optional source-rest retarget payload;
- no strings or JS objects.

Per-avatar mutable arena:

- local pose slots: rest/current/sample/blend scratch as SoA;
- model matrix output buffer;
- sampling context lower-key caches per animation/controller;
- runtime layer command/result scratch;
- IK/foot-plant scratch and partial refresh metadata;
- optional CPU skinning scratch/output.

## Marshaling and facade policy

- No per-frame JS object marshaling into WASM.
- No per-frame `Transform`/`Mat4`/diagnostic object creation in the steady-state WASM path.
- WASM-backed results live in reusable typed arrays. Existing public object-shaped facades are refreshed lazily and reuse object instances by joint/index.
- Scalar TypeScript fallback keeps current return shapes exactly.
- Diagnostics/debug modes may allocate TypeScript issue objects; benchmarked release paths must not require diagnostics.

## Feature selection and fallback

Loader decision order:

1. If disabled by option/env or instantiation fails, use scalar TypeScript.
2. Instantiate scalar-WASM when ABI/version/features match.
3. Probe SIMD with a small `WebAssembly.validate()` detector or equivalent bundler-safe helper; if supported and a SIMD build is available, select SIMD-WASM.
4. Fall back from SIMD-WASM to scalar-WASM on instantiate/self-test failure.
5. Fall back from any WASM build to scalar TypeScript on unsupported status, internal status, CSP rejection, async init timeout, or failed parity self-test.

Requirements:

- No `SharedArrayBuffer` requirement.
- Async init is explicit: an async factory may opt in, while current synchronous constructors remain usable through scalar TypeScript until a kernel is ready.
- Consumers can provide bytes, a `WebAssembly.Module`, or a URL/fetch strategy so bundlers and CSP-constrained apps can decide asset loading.
- Public APIs do not become WASM-only.

Feature bits:

- bit 0: scalar local-to-model;
- bit 1: scalar override blend;
- bit 2: scalar additive delta/application;
- bit 3: scalar dense/short/sparse-by-zero joint masks;
- bits 4-15: reserved for later scalar jobs (packed sampling, runtime composition, skinning, IK, foot plant);
- bit 16: SIMD local-to-model;
- bit 17: SIMD blend/additive/masks;
- bit 18: SIMD packed sampling;
- bit 31: debug/self-test exports.

## Numeric parity, quaternion, and sanitization contract

Executable TypeScript reference coverage for the future differential suite lives in `tests/wasm-kernel-fixtures.ts` and `tests/wasm-kernel-contract.test.ts`. Those tests intentionally use today's scalar TS implementation as the oracle for clip sampling, context sampling, blend/mask composition, local-to-model propagation, skinning output reuse/finite repair, two-bone IK, aim IK, aim-chain application, and foot-plant planning. Future scalar-WASM/SIMD-WASM tests should consume the same fixtures and compare the WASM outputs against those TS references before enabling any accelerated path.

Differential tests compare TypeScript scalar reference against scalar-WASM and SIMD-WASM when available:

| Output                                   | Tolerance                                                          |
| ---------------------------------------- | ------------------------------------------------------------------ |
| translations/scales/local TRS            | abs <= `1e-5`, relative <= `1e-5`                                  |
| quaternions                              | hemisphere-aligned component abs <= `2e-5`, length error <= `2e-5` |
| local-to-model matrices/palettes         | abs <= `2e-5`, relative <= `2e-5`                                  |
| CPU-skinned positions/normals/tangents   | abs <= `3e-5`, relative <= `3e-5`                                  |
| IK/foot-plant target vectors/corrections | abs <= `5e-5`, angular error <= `1e-4` radians                     |

Quaternion rules:

- Normalize before use unless the TypeScript reference treats the value as invalid.
- Non-normalizable rotations use identity or the documented rest/source-rest fallback.
- Before interpolation and weighted accumulation, if `dot(reference, candidate) < 0`, negate the candidate.
- Final parity treats `q` and `-q` as equivalent, but storage should preserve the reference shortest-hemisphere rule for stable diffs.

Invalid/NaN rules:

- Public TypeScript validation remains the first line of defense.
- Kernel jobs repair numeric lanes to match scalar semantics: non-finite translation components -> `0`; scale -> `1`; invalid/non-finite/non-normalizable rotation -> identity/rest fallback; negative/non-finite mask weights -> `0`; non-finite nonnegative weights -> documented fallback.
- Invalid parent indices, counts, offsets, capacities, enum tags, or impossible ranges return status errors instead of repair.
- Padded lanes remain finite identity lanes and do not affect output comparisons.

## Phased migration order and exit gates

### Phase 0 — contract and baseline (implemented)

Files: this architecture contract, deterministic benchmark harness, TypeScript contract fixtures/tests, package scripts, README link.

Gates:

- benchmark smoke emits valid JSON with environment and result rows;
- `npm run check`, benchmark typecheck, relevant tests/full tests when practical, formatting/lint for changed files, and `git diff --check` pass;
- baseline commit contained no Rust implementation and was not pushed by the bounded worker.

### Phase 1 — Rust workspace, loader, feature detection, local-to-model parity (implemented)

Add Rust crate/build, TypeScript loader, memory epoch/view refresh, scalar fallback, and local-to-model kernel only.

Implemented tooling surface:

- Rust workspace/crate: `Cargo.toml`, `Cargo.lock`, `crates/waifu-animation-kernel`.
- WASM build: `npm run build:wasm` compiles `wasm32-unknown-unknown --release --locked` and copies the intentionally packed scalar asset to `dist/wasm-kernel/waifu_animation_kernel.wasm` plus a generated README. The generated `target/` and `dist/` outputs stay ignored.
- Loader/capability/context: `src/wasm-kernel.ts`, exported from `src/index.ts`, supports explicit bytes/module/URL initialization, ABI/feature validation, SIMD probe seam, scalar fallback, forced-disable/reset test hooks, and epoch-based typed-array refresh.
- Public synchronous TypeScript APIs remain scalar-safe. The accelerated path is opt-in through a retained context (or through `updateLocalToModelPoseRange(..., { kernel })`), and it falls back to scalar TypeScript when disabled, unsupported, or failed.
- Benchmark JSON now reports WASM startup separately in `wasmKernel.startupMs` and adds a steady-state `local_to_model_scalar_wasm_1_avatar` row when the scalar WASM asset is available.

Gates:

- scalar TS remains default-safe while WASM initializes;
- local-to-model parity over rest, animated, multi-root, rooted, ranged, invalid, and padded joint-count fixtures;
- benchmark includes TS vs scalar-WASM local-to-model rows;
- forced disable and instantiate failure fall back cleanly.

Phase 1 parity is green and remains the scalar fallback boundary for local-to-model.

### Phase 2 — blend/additive/masks kernel (implemented)

Implemented:

- retained padded-SoA override blending with fallback threshold, quaternion hemisphere accumulation, normalization, and finite repair;
- additive delta generation and ordered signed application, including zero/negative scale-ratio edges;
- omitted/full, zero, short, sparse-by-zero, invalid, and extra-value masks matching TypeScript rules;
- reusable caller-owned output slots, capacity/range/handle validation, deterministic repeats, memory-growth view refresh, forced-disable behavior, and ABI/feature/export rejection coverage;
- differential tests across single/multiple layers, custom fallback, antipodes, signed/non-finite weights, padded counts, malformed ranges/capacities, and additive ordering;
- benchmark rows for current TypeScript object-pose composition versus scalar-WASM already-packed one- and multi-avatar arenas. Startup is separate and no production speedup or precise heap-allocation claim is made.

### Phase 3 — packed clip sampling kernel

Gates: parity for loops/clamps/seeks, coherent lower-key caches, packed/raw sampling equivalence, source-rest retargeting, quaternion repairs, skip-unsupported behavior, and memory growth only outside frames.

### Phase 4 — AnimationRuntime WASM-backed composition facade

Gates: existing runtime tests pass in scalar and WASM modes; root-motion collection remains TS unless separately proven; async init/fallback do not change constructor behavior; multi-avatar benchmark remains valid JSON.

### Phase 5 — skinning palette and CPU skinning

Gates: parity for restored-last/explicit weights, remaps, invalid indices, finite fallback, aliasing/capacity behavior, normals/tangents, and atomic capacity failures.

### Phase 6 — IK, aim, and foot-plant numeric kernels

Gates: parity for reach clamp, soften/maxStretch, twist/pole fallback, local/model correction conversion, aim offsets, ankle target projection, pelvis compensation, skipped statuses, and local-to-model partial refresh after each correction.

### Phase 7 — SIMD optimization

Gates: scalar-WASM and SIMD-WASM both pass parity; SIMD detector works without `SharedArrayBuffer`; bundler/CSP fallback is proven; benchmark reports TS/scalar-WASM/SIMD-WASM rows where available.

## Risks and mitigations

- **Bundler/CSP:** allow caller-supplied module/bytes/URL and automatic scalar fallback.
- **Async WASM init:** keep synchronous APIs usable through scalar default or explicit async factory.
- **Memory growth:** reserve frame arenas up front, grow only during asset/avatar creation, refresh views by epoch, retry capacity failures once outside the frame.
- **SIMD detection:** optional feature probe; scalar-WASM and scalar-TS remain supported.
- **Public API compatibility:** preserve object-shaped results and diagnostics through reusable facade conversion.
- **Numeric drift:** enforce tolerances, hemisphere rules, and TypeScript-scalar reference tests before accepting performance claims.
- **Stale handles/views:** generation-tag handles, epoch refresh, and quarantine on `WA_ERR_INTERNAL`.
