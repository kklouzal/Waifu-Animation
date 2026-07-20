# Validation

## Package Gates

Run these from this repository root, shown as `<waifu-animation-repo>`:

```bash
npm run check
npm test
npm run build
```

Current coverage includes:

- finite transform and clip validation, including duplicate resolved target-channel rejection;
- VRM humanoid identifier and hierarchy validation for skeleton joints, humanoid maps, raw skeleton traversal/build caps, and clip `humanBone` tracks;
- quaternion sanitization and shortest-path retargeting, including normalized `sourceRestQuaternion` metadata, binary source-rest roundtrips, malformed source-rest encode rejection, and rotation sample quaternion validation;
- malformed binary payload rejection, including invalid target kinds, malformed optional metadata presence flags, and misaligned float tables;
- manifest metadata hardening, including malformed runtime JSON status/root-motion policy/provenance rejection, structural unusable-clip filtering, asset-report classification of structural rejects, and rejected-report surfacing;
- local clip sampling;
- local-to-model pose conversion;
- Ozz-style attachment transform composition from joint model matrices plus offsets, including target resolution, pre-resolved attachment bindings, batch bound evaluation, offset sanitization/rejection, and invalid input handling;
- weighted pose blending with masks;
- runtime layer evaluation, explicit override-layer root-motion collection, subtractive additive runtime weights, opt-in evaluation diagnostics, and override crossfade orchestration;
- declarative track-name masks;
- Three adapter clip binding and runtime lane construction;
- look-at target distribution;
- deterministic presence planning for cues, gaze targets, non-skeletal look-at outputs, and bounded procedural bone targets exposed as reusable library data;
- two-bone IK solve sanity, including diagonal target projection onto the upper-bone sphere;
- normalized two-bone IK correction quaternions;
- foot-plant planning for flat/moderate-ground contacts, optional too-steep ground-slope rejection, missing-contact degradation, ankle correction clamping, pelvis compensation, finite leg IK output, deterministic contact/influence stabilization, and reusable Three.js application/cleanup of pelvis plus leg correction quaternions with sanitized timing;
- viseme stack limiting with hostile input sanitization;
- configurable viseme smoothing, facial expression composition, and blink scheduler trigger/timing sanity;
- pose delta metrics across rotation, translation, and scale, including sign-equivalent/non-unit quaternion handling and max joint attribution.
- `poseDiscontinuityMetric()` for deterministic runtime/video validation of timestamped local-pose frames, reporting per-interval angular velocity in radians/sec plus translation and scale velocity in distance units/sec with optional angular, translation, and scale spike thresholds.

## Runtime Evaluation Diagnostics

`AnimationRuntime.evaluate()` keeps the realtime path lean by default and returns only the evaluated local/model poses plus active layer metadata. Consumers that need Ozz-style validation around a frame can call `evaluate({ diagnostics: true })` to receive sampled-layer and final local-pose diagnostics with layer id, clip id, joint/index, track/sample where applicable, and validation messages while still getting a normalized finite output pose. Sample-stage diagnostics also include translation, scale, rotation, and source-rest quaternion repair events from the tolerant sampler path.

`AnimationRuntime.update(deltaSeconds, { collectRootMotion: true })` returns a finite explicit `rootMotionDelta` plus deterministic per-layer contribution metadata for active override layers. Additive layers are excluded from root-motion collection, and invalid/non-finite timing resolves to identity motion.

## Waifu Integration Gates

Run these from the consuming Waifu app checkout, shown as `<waifu-app-repo>`, after building both repositories and starting the app server. Set `WAIFU_RENDER_URL` to that app server URL.

```bash
npm run test:animation
npm run check
npm run build
PORT="<app-port>" HOST="<app-bind-host>" npm start
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_RENDER_SCREENSHOT=cache/waifu-animation-integration/pass-4/render-check.png npm run render:check
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_ANIMATION_RUNTIME_OUT_DIR=cache/waifu-animation-integration/pass-4/animations npm run visual:animations
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-integration/pass-4/actions npm run visual:actions
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISEME_OUT_DIR=cache/waifu-animation-integration/pass-4/visemes npm run visual:visemes
```

Important operational note: the Waifu production server should be restarted after `npm run build`. The current static server can serve a fresh `index.html` that references a newly hashed bundle before the running static route sees that new asset.

## Current Evidence

Final integration artifacts from the initial package integration were under the consuming app cache:

`<waifu-app-repo>/cache/waifu-animation-integration/pass-4`

Pass-4 results:

- `render:check`: passed with real VRM, `avatarReady=true`, `fallbackActive=false`, `animationReady=true`, WebGL active, `clips 6/564`.
- `visual:animations`: passed with 564 manifest clips, 555 unique clip assets, zero asset issues, zero runtime issues, and representative debug playback for idle, conversation, and gesture clips.
- `visual:actions`: passed with 9 captures, recorded WebM, zero motion issues, and zero bad logs.
- `visual:visemes`: passed with recorded WebM, zero bad logs, mouth max `0.227`, target max `0.244`, and all five viseme channels active.
- Manual artifact review checked real-avatar render, action contact sheet, viseme contact sheet, and final viseme screenshot. No fallback avatar, pose explosion, or stuck-open mouth was observed in those reviewed artifacts.

Targeted facial-runtime validation after moving facial/blink composition into `Waifu-Animation`:

- Artifact directory: `<waifu-app-repo>/cache/waifu-animation-foundation/2026-06-08/facial-runtime/visemes`
- Command: `WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISEME_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/facial-runtime/visemes npm run visual:visemes`
- Result: passed with recorded WebM, zero bad logs, mouth max `0.285`, target max `0.340`, eight mouth/target changes, and all five viseme channels active.

Targeted presence-planner validation after moving deterministic cue/gaze/body target planning into `Waifu-Animation`:

- Artifact directory: `<waifu-app-repo>/cache/waifu-animation-foundation/2026-06-08/presence-planner/actions`
- Command: `WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/presence-planner/actions npm run visual:actions`
- Result: passed with nine captures, recorded WebM, zero bad logs, zero motion issues, and bounded pose deltas from `0.0097` to `0.0352` across idle, speaking, thinking, emphasize, wave, listening, and shrug states.

Historical targeted rendered foot-plant application validation after adding the reusable Three.js application hook:

- Artifact directory: `<waifu-app-repo>/cache/waifu-animation-foundation/2026-06-08/foot-plant-apply/animations`
- Command: package/Waifu visual gate using the then-available foot-plant application flag.
- Result: passed with recorded WebM, final screenshot, 564 manifest clips, 555 unique clip assets, zero asset/runtime issues, and rendered foot-plant application telemetry for walk, jog, and stand-to-walk representatives. Each locomotion representative produced six planted samples, six active applied samples, six pelvis samples, and twelve leg/ankle correction samples. Max correction remained within the 0.22 m clamp (`0.182` max); minimum target reach remained at or above `0.974`. This remains evidence for the reusable package hook, not current Waifu skeletal application policy.

Final broad visual validation after the foot-plant hook:

- `WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/final-actions npm run visual:actions`: passed with nine captures, recorded WebM, zero bad logs, zero motion issues, and pose deltas from `0.0082` to `0.0299`.
- `WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" WAIFU_VISEME_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/final-visemes npm run visual:visemes`: passed with recorded WebM, zero bad logs, mouth max `0.255`, target max `0.277`, seven mouth/target changes, and all five viseme channels active.

## Active Manifest Status

The active Waifu manifest expands to 564 entries: 9 curated paid clips plus 555 generated Mocap Online entries. The current manifest has zero entries marked `rejected` or `quarantined`, and the latest asset inspection reported zero clip asset issues.

Root-motion manifest metadata is intentionally split between policy and provenance. `source.rootMotion.policy` says how consumers should treat the runtime clip (`none`, `preserved`, or `stripped-to-in-place`). Optional `source.rootMotion.provenance` records how the root-carrier translation reached that state (`not-authored`, `preserved-in-clip`, `stripped-during-conversion`, or `requires-runtime-stripping`). Legacy manifests that only set `{ "policy": "stripped-to-in-place" }` remain readable and report `rootMotionProvenance: "unknown"`; asset reports also include root-carrier translation track counts so consumers can distinguish current binary state from missing provenance.

Manifest entries can opt into required resolved joint coverage with `source.requiredHumanBones` and `source.requiredJoints`. These arrays are validation policy only: if present, `inspectAnimationAsset` and `validateAnimationManifestAssets` reject decoded clips whose target-skeleton `jointCoverage` does not include every declared humanoid bone or named joint. No category-level requirements are inferred when these fields are omitted.

The generated Mocap Online library currently records explicit root-motion policy metadata but not conversion provenance:

- 223 generated `root-motion-*` entries are marked `source.rootMotion.policy: "stripped-to-in-place"`.
- Those clips currently omit hips/pelvis translation tracks; package asset reports expose this as zero root-carrier translation tracks with unknown provenance until the Waifu conversion manifest records `source.rootMotion.provenance: "stripped-during-conversion"`.
- `visual:animations` now samples representative paid idle/conversation clips plus walk, jog, and stand-to-walk root-motion candidates.

## Known Limits

- The package has IK, look-at, facial, Three adapter, and `PresencePlanner` foundations. See `docs/architecture.md` for the current Waifu skeletal runtime policy this validation assumes.
- The package exposes an Ozz-inspired foot-plant planning job, reusable two-bone IK correction quaternions, and optional Three.js application hooks. Those remain reusable library capabilities, but current Waifu visual gates should not rely on app-side foot-plant application flags.
- The current visual gates validate standing, speaking, listening, thinking, shrug/wave/emphasis behavior, debug clip playback, representative in-place walk/jog/stand-to-walk root-motion candidates, non-skeletal look-at/face/viseme cues, and idle transitions. They do not yet validate a full locomotion state machine, sitting, stretching, arbitrary rendered foot planting, preserved root-motion application, prop attachments, or multi-avatar retargeting.

## 2026-06-08 Final Hardening Pass

Changes validated in this pass:

- Added Ozz-style thresholded override pose blending and runtime threshold configuration.
- Added reusable Three `applyThreePresenceTargets` procedural target application for consumers that opt into procedural skeletal targets; see Known Limits for current Waifu usage policy.
- Rebuilt package `dist/` and Waifu production client bundle.

Commands run:

```bash
# <waifu-animation-repo>
npm run check
npm test
npm run build

# <waifu-app-repo>
npm run check
npm run test:animation
npm run build
PORT="<app-port>" npm run start
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" \
  WAIFU_RENDER_SCREENSHOT=cache/waifu-animation-final-hardening/render-check-current.png \
  npm run render:check
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" \
  WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-final-hardening/actions-current \
  npm run visual:actions
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" \
  WAIFU_ANIMATION_RUNTIME_OUT_DIR=cache/waifu-animation-final-hardening/animations-current \
  npm run visual:animations
WAIFU_RENDER_URL="http://<waifu-app-host>:<app-port>/" \
  WAIFU_VISEME_OUT_DIR=cache/waifu-animation-final-hardening/visemes-current \
  npm run visual:visemes
```

Artifacts:

- Render screenshot: `<waifu-app-repo>/cache/waifu-animation-final-hardening/render-check-current.png`
- Action contact sheet: `<waifu-app-repo>/cache/waifu-animation-final-hardening/actions-current/contact.png`
- Action video: `<waifu-app-repo>/cache/waifu-animation-final-hardening/actions-current/page@17b0a07f739b0792e76caeae4ca55cf9.webm`
- Animation video: `<waifu-app-repo>/cache/waifu-animation-final-hardening/animations-current/page@16fd40741149087b1cccc1f070e86d7f.webm`
- Viseme video: `<waifu-app-repo>/cache/waifu-animation-final-hardening/visemes-current/page@360eea484cd5223c37d2f88b89c35951.webm`
- Viseme final screenshot: `<waifu-app-repo>/cache/waifu-animation-final-hardening/visemes-current/final.png`

Results:

- Package check/test/build passed.
- Waifu check/test/build passed.
- Render gate passed with real avatar, animation-ready runtime, WebGL, post-processing, MSAA, and no bad logs.
- Action visual gate passed: 9 captures, video recorded, bounded pose deltas (`0.0084`–`0.0307` after idle baseline), no motion issues, no bad logs.
- Animation runtime gate passed: 564 manifest clips, 555 unique assets, and no asset/runtime issues. Historical runs also validated the reusable foot-plant application hook, but current Waifu skeletal policy is authored clips only.
- Viseme gate passed: 90 samples, video recorded, no bad logs, mouth max `0.321`, target max `0.34`, all five viseme channels active.

Note: an initial visual run accidentally targeted an already-running app server from an older deployment. The final evidence above targets a fresh app server serving the rebuilt client bundle.
