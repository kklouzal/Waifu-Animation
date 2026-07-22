# Mandatory Rust/WASM animation kernel

Status: ABI v1.5. The retained Rust/WASM kernel is mandatory for the migrated numeric runtime. The package builds and ships a portable scalar-WASM artifact and a SIMD128-WASM artifact. Runtime initialization is fail-closed; there is no TypeScript execution fallback in `src/wasm-kernel.ts` or `src/runtime-wasm.ts`.

## Required initialization

```ts
const initialized = await loadWaifuAnimationWasmKernel({
  // Optional hosting overrides. Packaged URLs are used when omitted.
  source: { url: scalarUrl },
  simdSource: { url: simdUrl },
  requiredFeatures
});

const runtime = new AnimationRuntime(skeleton, { backend: createWasmAnimationRuntimeBackend(initialized, skeleton) });
```

`loadWaifuAnimationWasmKernel` detects SIMD128 with `WebAssembly.validate`. A SIMD-capable engine selects `waifu_animation_kernel.simd.wasm`; a non-SIMD engine selects `waifu_animation_kernel.scalar.wasm`. A selected-asset fetch/compile/instantiate/ABI/feature/mode failure rejects with `WaKernelInitializationError`. It never retries through TypeScript and does not silently downgrade a SIMD-capable engine to another implementation. `createWasmAnimationRuntime` is the async convenience factory and has the same rejection behavior.

Initialization errors have stable codes:

- `webassembly-unavailable`
- `missing-asset`
- `asset-load-failed`
- `instantiate-failed`
- `abi-mismatch`
- `required-feature-missing`
- `malformed-exports`
- `memory-initialization-failed`

Malformed retained jobs return ABI status codes at raw seams. Checked facade operations throw `WaKernelJobError` with the job and status. Capacity, handle, bounds, alignment, unsupported-export, and internal errors never invoke a TypeScript numeric implementation.

There is no process-global avatar state in TypeScript. Each `WaifuAnimationWasmKernel` is an instantiated module/memory, and each skeleton/avatar/clip/sampling/skinning/pose context owns independent handles and retained offsets. Synchronous facades are valid only after callers possess an initialized kernel/context. Multiple avatars may share one immutable initialized module but never pose arenas, caches, descriptors, or handles.

## Artifacts and SIMD dispatch

`npm run build:wasm` produces:

- `dist/wasm-kernel/waifu_animation_kernel.scalar.wasm`
- `dist/wasm-kernel/waifu_animation_kernel.simd.wasm`

The SIMD build enables `wasm32 simd128` and Cargo feature `simd`. SIMD v128 loads, splats, multiplies, adds, and stores execute in the matrix hot path used by:

1. local-to-model parent × local matrix propagation, including root/range updates;
2. model × inverse-bind skinning palette construction.

ABI exports `wa_execution_mode()` and `wa_simd_execution_count()`. The latter increments only in SIMD matrix implementations. Tests require the SIMD feature bit, reported mode, scalar/SIMD parity, and a counter increase after a retained matrix job. The artifact audit also records the SIMD opcode-prefix byte delta; the execution counter is the stronger proof that selected v128 code ran.

Pose blend/additive/normalize, packed sampling, procedural corrections, and CPU vertex influence accumulation currently use the common scalar Rust implementation inside both artifacts. This is intentional per-job dispatch: the SIMD artifact is real, while jobs without a proven SIMD implementation keep exact scalar-WASM semantics.

## Ozz-style data and job contract

- Local poses are padded groups of four joints in contiguous SoA order: translation xyz, quaternion xyzw, scale xyz.
- Model poses and palettes are contiguous column-major matrices.
- Immutable skeleton parents, packed tracks/times/values, inverse binds, remaps, indices, and weights are copied at setup.
- Sampling contexts retain coherent lower-key cursors and explicit reset state.
- Every job validates handles, generations, capacities, alignment, bounds, hierarchy/ranges, and output aliasing before execution.
- Pose arenas and typed views survive memory growth through one memory-buffer/epoch contract. Callers refresh only when `wa_memory_epoch` or `wa_refresh_views_required` changes.
- Setup may grow linear memory; steady-state jobs do not allocate or grow memory.
- Destruction is explicit and deterministic. Stale generations fail with `WA_ERR_BAD_HANDLE`.

Semantics preserved by scalar and SIMD artifacts include finite repair, quaternion hemisphere selection and normalization, signed scale/additive ratios, mask truncation and zero-fill, blend threshold/rest fallback, loop/clamp/seek cache behavior, parent-before-child multi-root/range propagation, restored-last and explicit skin weights, joint remaps, normals/tangents, and ordered two-bone/aim/foot correction descriptors.

## Inventory

### Migrated retained jobs (mandatory WASM execution)

| Family                      | Rust ABI / facade                                                         | TypeScript role                                              |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Local-to-model              | `wa_local_to_model`, `WasmLocalToModelContext`, pose-arena `localToModel` | descriptor setup and output materialization only             |
| Blend/masks/normalize       | `wa_blend_poses`, `wa_normalize_pose`, `WasmPoseArenaContext`             | layer scheduling and compact descriptor writes               |
| Additive                    | `wa_additive_delta`, `wa_apply_additive`                                  | scheduling and mask slot ownership                           |
| Packed sampling/composition | retained clip/sampling handles and `wa_sample_packed_clip*`               | import-time packing, clip identity, cache reset scheduling   |
| Palette/CPU skinning        | retained skinning handle, `wa_build_skinning_palette`, `wa_skin_vertices` | geometry layout adaptation and upload ownership              |
| Procedural corrections      | `wa_apply_procedural_corrections`                                         | contact/policy resolution and ordered descriptor submission  |
| Retained runtime chain      | `WasmAnimationRuntimeBackend`                                             | ids, fades, priorities, root-motion orchestration, lifecycle |

The migrated facades contain no `runOrFallback`, `sampleTimeOrFallback`, forced-disable seam, `kind: "typescript"`, or fallback backend. Unsupported source-basis callbacks, unpackable clips, capacity overflow, diagnostics requests on the retained backend, and non-success statuses fail explicitly.

### Intentional nonnumeric TypeScript orchestration

These remain shipped and runtime-reachable by design:

- manifests, includes, URL/loading policy, importer/config planning, binary wrappers, validation and debug/report objects;
- clip string/humanoid target resolution and one-time packed-asset construction;
- animation ids, layer ownership, crossfade/fade scheduling, priorities, motion-carrier selection, and root-motion interval policy;
- contact acquisition/raycast callbacks, foot lock/stick state, bilateral support choice, pelvis policy, rejection reasons, and correction descriptor ordering;
- Three.js/VRM adaptation, `Object3D`/`BufferGeometry`, renderer uploads, materials, and app integration;
- memory view refresh, handle ownership, and public object materialization outside retained hot loops.

### Remaining shipped TypeScript numeric APIs (explicit debt, not a retained-runtime fallback)

The legacy direct APIs in `src/clip-sampling.ts`, `src/pose.ts`, `src/skeleton.ts`, `src/packed-runtime.ts`, `src/skinning.ts`, and `src/ik-core.ts` still contain scalar algorithms because broad public API consumers and the existing non-backend `AnimationRuntime` constructor depend on their synchronous signatures. `src/runtime.ts` still has its standalone TypeScript evaluation path when constructed without a backend, and root-motion interval sampling is TypeScript-owned. These paths are not reachable from `createWasmAnimationRuntime`/`WasmAnimationRuntimeBackend`, but they are still package-reachable code debt. Removing them safely requires a separately versioned facade migration rather than silently retaining them as fallback. The next library slice should require an initialized backend/context for `AnimationRuntime`, move direct numeric references under `tests/support`, and replace standalone pose/skeleton/skinning exports with context-bound adapters.

Source-basis callbacks must be baked into packed clips before entering the mandatory runtime. Retained runtime diagnostics must use an explicit offline/reference evaluation path; requesting diagnostics does not switch execution backend.

### Test-only references

Differential oracles remain under `tests/wasm-kernel-fixtures.ts`, `tests/wasm-kernel-contract.test.ts`, and `tests/wasm-procedural-corrections.test.ts`. They call the legacy direct APIs only as test references. They are excluded by `package.json#files` and are not imported from shipped `src/`.

## Validation and benchmark contract

Required gates:

- scalar and SIMD Rust build, fmt, clippy, and unit tests;
- scalar/SIMD differential fixtures, deterministic repeats, malformed handles/bounds/statuses, lifecycle, memory growth/epoch, and independent contexts;
- required initialization rejection tests with no TypeScript execution fallback;
- package dry run containing both WASM artifacts and declarations;
- TypeScript checks, runtime tests, lint/format/knip/publint/audit/coverage/cycles, and `git diff --check`;
- `npm run bench:wasm-kernel:simd -- --smoke` (directional) and a steadier non-smoke run.

The SIMD benchmark reports startup, setup, memory, local-to-model, and a retained blend/additive/normalize/local-to-model chain separately. Checksums, max absolute difference, mode, feature bits, and SIMD execution count are mandatory. SIMD remains the selected artifact on supported engines even if one measured row is slower; per-job code inside that artifact may remain scalar until a lane is both exact and useful.

### Dev-01 baseline (2026-07-22 UTC)

Command: `npm run bench:wasm-kernel:simd -- --iterations 5000 --warmup 500 --joints 72`.

| Measurement                                         |           scalar-WASM |             SIMD-WASM |
| --------------------------------------------------- | --------------------: | --------------------: |
| Startup (one ordered run; compile/cache sensitive)  |             16.065 ms |              0.436 ms |
| Retained setup                                      |              2.308 ms |              0.913 ms |
| Linear memory after setup                           |           1,114,112 B |           1,114,112 B |
| Local-to-model, 72 joints                           | 0.004669 ms/iteration | 0.003451 ms/iteration |
| Blend + additive + normalize + local-to-model chain | 0.053238 ms/iteration | 0.051676 ms/iteration |

Parity guard: maximum matrix component difference `7.152557373046875e-7`; retained-chain checksums `37.80746214278042` (scalar) and `37.80746309645474` (SIMD). The SIMD-only execution counter advanced from `390571` to `781071`. Artifact sizes were 68,631 B scalar and 68,313 B SIMD; raw `0xfd` byte counts were 22 and 145 respectively.

Startup numbers are not an A/B speed claim because scalar was instantiated first and engine caching/order can dominate. The 5,000-iteration steady-state rows are the selection evidence. A separate smoke run showed SIMD local-to-model slower (0.006734 vs 0.005475 ms) while its retained chain was faster (0.071206 vs 0.078364 ms), confirming that short runs are noisy and must be reported honestly.
