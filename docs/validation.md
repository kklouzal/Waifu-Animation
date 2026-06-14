# Validation

## Package Gates

Run these in `/Warehouse/Waifu-Animation`:

```bash
npm run check
npm test
npm run build
```

Current coverage includes:

- finite transform and clip validation, including duplicate resolved target-channel rejection;
- quaternion sanitization and shortest-path retargeting, including normalized `sourceRestQuaternion` metadata and rotation sample quaternion validation;
- local clip sampling;
- local-to-model pose conversion;
- weighted pose blending with masks;
- runtime layer evaluation, subtractive additive runtime weights, opt-in evaluation diagnostics, and override crossfade orchestration;
- declarative track-name masks;
- Three adapter clip binding and runtime lane construction;
- look-at target distribution;
- deterministic presence planning for cues, gaze targets, and bounded procedural bone targets;
- two-bone IK solve sanity;
- normalized two-bone IK correction quaternions;
- foot-plant planning for flat-ground contacts, missing-contact degradation, ankle correction clamping, pelvis compensation, finite leg IK output, and Three.js application/cleanup of pelvis plus leg correction quaternions;
- viseme stack limiting;
- configurable viseme smoothing, facial expression composition, and blink scheduler trigger sanity;
- pose rotation metrics.

## Runtime Evaluation Diagnostics

`AnimationRuntime.evaluate()` keeps the realtime path lean by default and returns only the evaluated local/model poses plus active layer metadata. Consumers that need Ozz-style validation around a frame can call `evaluate({ diagnostics: true })` to receive sampled-layer and final local-pose diagnostics with layer id, clip id, joint/index, and validation messages while still getting a normalized finite output pose.

## Waifu Integration Gates

Run these in `/Warehouse/Waifu` after building both repositories and starting the Waifu server:

```bash
npm run test:animation
npm run check
npm run build
PORT=18100 HOST=127.0.0.1 npm start
WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_RENDER_SCREENSHOT=cache/waifu-animation-integration/pass-4/render-check.png npm run render:check
WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_ANIMATION_RUNTIME_OUT_DIR=cache/waifu-animation-integration/pass-4/animations npm run visual:animations
WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-integration/pass-4/actions npm run visual:actions
WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISEME_OUT_DIR=cache/waifu-animation-integration/pass-4/visemes npm run visual:visemes
```

Important operational note: the Waifu production server should be restarted after `npm run build`. The current static server can serve a fresh `index.html` that references a newly hashed bundle before the running static route sees that new asset.

## Current Evidence

Final integration artifacts from the initial package integration are under:

`/Warehouse/Waifu/cache/waifu-animation-integration/pass-4`

Pass-4 results:

- `render:check`: passed with real VRM, `avatarReady=true`, `fallbackActive=false`, `animationReady=true`, WebGL active, `clips 6/564`.
- `visual:animations`: passed with 564 manifest clips, 555 unique clip assets, zero asset issues, zero runtime issues, and representative debug playback for idle, conversation, and gesture clips.
- `visual:actions`: passed with 9 captures, recorded WebM, zero motion issues, and zero bad logs.
- `visual:visemes`: passed with recorded WebM, zero bad logs, mouth max `0.227`, target max `0.244`, and all five viseme channels active.
- Manual artifact review checked real-avatar render, action contact sheet, viseme contact sheet, and final viseme screenshot. No fallback avatar, pose explosion, or stuck-open mouth was observed in those reviewed artifacts.

Targeted facial-runtime validation after moving facial/blink composition into `Waifu-Animation`:

- Artifact directory: `/Warehouse/Waifu/cache/waifu-animation-foundation/2026-06-08/facial-runtime/visemes`
- Command: `WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISEME_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/facial-runtime/visemes npm run visual:visemes`
- Result: passed with recorded WebM, zero bad logs, mouth max `0.285`, target max `0.340`, eight mouth/target changes, and all five viseme channels active.

Targeted presence-planner validation after moving deterministic cue/gaze/body target planning into `Waifu-Animation`:

- Artifact directory: `/Warehouse/Waifu/cache/waifu-animation-foundation/2026-06-08/presence-planner/actions`
- Command: `WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/presence-planner/actions npm run visual:actions`
- Result: passed with nine captures, recorded WebM, zero bad logs, zero motion issues, and bounded pose deltas from `0.0097` to `0.0352` across idle, speaking, thinking, emphasize, wave, listening, and shrug states.


Targeted rendered foot-plant application validation after adding the reusable Three.js application hook:

- Artifact directory: `/Warehouse/Waifu/cache/waifu-animation-foundation/2026-06-08/foot-plant-apply/animations`
- Command: `WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_ANIMATION_RUNTIME_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/foot-plant-apply/animations WAIFU_ANIMATION_APPLY_FOOT_PLANT=1 npm run visual:animations`
- Result: passed with recorded WebM, final screenshot, 564 manifest clips, 555 unique clip assets, zero asset/runtime issues, and rendered foot-plant application telemetry for walk, jog, and stand-to-walk representatives. Each locomotion representative produced six planted samples, six active applied samples, six pelvis samples, and twelve leg/ankle correction samples. Max correction remained within the 0.22 m clamp (`0.182` max); minimum target reach remained at or above `0.974`. The remaining IK reach-clamp messages are bounded diagnostic notes, not failed runtime issues.

Final broad visual validation after the foot-plant hook:

- `WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/final-actions npm run visual:actions`: passed with nine captures, recorded WebM, zero bad logs, zero motion issues, and pose deltas from `0.0082` to `0.0299`.
- `WAIFU_RENDER_URL=http://127.0.0.1:18100/ WAIFU_VISEME_OUT_DIR=cache/waifu-animation-foundation/2026-06-08/final-visemes npm run visual:visemes`: passed with recorded WebM, zero bad logs, mouth max `0.255`, target max `0.277`, seven mouth/target changes, and all five viseme channels active.

## Active Manifest Status

The active Waifu manifest expands to 564 entries: 9 curated paid clips plus 555 generated Mocap Online entries. The current manifest has zero entries marked `rejected` or `quarantined`, and the latest asset inspection reported zero clip asset issues.

The generated Mocap Online library now records explicit root-motion policy metadata:

- 223 generated `root-motion-*` entries are marked `source.rootMotion.policy: "stripped-to-in-place"`.
- Those clips currently omit hips/pelvis translation tracks; they are validated as in-place debug/runtime candidates, not as preserved root-motion clips.
- `visual:animations` now samples representative paid idle/conversation clips plus walk, jog, and stand-to-walk root-motion candidates.

## Known Limits

- The package has IK, look-at, facial, Three adapter, and `PresencePlanner` foundations. Waifu still applies package-produced procedural targets through Three/VRM bone writes in `src/client/main.ts`; final browser pose application has not fully moved onto package-owned local-pose buffers.
- The package now exposes an Ozz-inspired foot-plant planning job, reusable two-bone IK correction quaternions, and an optional Three.js application hook. Waifu feeds studio-floor debug contacts into the job for representative locomotion clips and can enable rendered pelvis/leg corrections with `?footPlant=apply` or `WAIFU_ANIMATION_APPLY_FOOT_PLANT=1` in the visual animation gate.
- The current visual gates validate standing, speaking, listening, thinking, shrug/wave/emphasis behavior, debug clip playback, representative in-place walk/jog/stand-to-walk root-motion candidates, rendered foot-plant application telemetry for those locomotion debug clips, visemes, and idle transitions. They do not yet validate a full locomotion state machine, sitting, stretching, arbitrary rendered foot planting beyond those representatives, preserved root-motion application, prop attachments, or multi-avatar retargeting.
- The current Waifu runtime still uses Three `AnimationMixer` as the renderer backend through the package adapter. The package provides an Ozz-style local-pose runtime, but Waifu has not yet moved final browser pose application fully onto that buffer pipeline.


## 2026-06-08 Final Hardening Pass

Changes validated in this pass:

- Added Ozz-style thresholded override pose blending and runtime threshold configuration.
- Added reusable Three `applyThreePresenceTargets` procedural target application and moved Waifu's procedural bone slerp through that package API.
- Rebuilt package `dist/` and Waifu production client bundle.

Commands run:

```bash
# /Warehouse/Waifu-Animation
npm run check
npm test
npm run build

# /Warehouse/Waifu
npm run check
npm run test:animation
npm run build
PORT=18100 npm run start
WAIFU_RENDER_URL=http://127.0.0.1:18100/ \
  WAIFU_RENDER_SCREENSHOT=cache/waifu-animation-final-hardening/render-check-current.png \
  npm run render:check
WAIFU_RENDER_URL=http://127.0.0.1:18100/ \
  WAIFU_VISUAL_OUT_DIR=cache/waifu-animation-final-hardening/actions-current \
  npm run visual:actions
WAIFU_RENDER_URL=http://127.0.0.1:18100/ \
  WAIFU_ANIMATION_RUNTIME_OUT_DIR=cache/waifu-animation-final-hardening/animations-current \
  WAIFU_ANIMATION_APPLY_FOOT_PLANT=1 \
  npm run visual:animations
WAIFU_RENDER_URL=http://127.0.0.1:18100/ \
  WAIFU_VISEME_OUT_DIR=cache/waifu-animation-final-hardening/visemes-current \
  npm run visual:visemes
```

Artifacts:

- Render screenshot: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/render-check-current.png`
- Action contact sheet: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/actions-current/contact.png`
- Action video: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/actions-current/page@17b0a07f739b0792e76caeae4ca55cf9.webm`
- Animation/foot-plant video: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/animations-current/page@16fd40741149087b1cccc1f070e86d7f.webm`
- Animation/foot-plant final screenshot: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/animations-current/foot-plant-apply-final.png`
- Viseme video: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/visemes-current/page@360eea484cd5223c37d2f88b89c35951.webm`
- Viseme final screenshot: `/Warehouse/Waifu/cache/waifu-animation-final-hardening/visemes-current/final.png`

Results:

- Package check/test/build passed.
- Waifu check/test/build passed.
- Render gate passed with real avatar, animation-ready runtime, WebGL, post-processing, MSAA, and no bad logs.
- Action visual gate passed: 9 captures, video recorded, bounded pose deltas (`0.0084`–`0.0307` after idle baseline), no motion issues, no bad logs.
- Animation runtime gate passed: 564 manifest clips, 555 unique assets, no asset/runtime issues, foot-plant application enabled for representative locomotion clips, max correction about `0.1816` below the `0.22` clamp, applied leg/ankle correction count `12` for each locomotion representative.
- Viseme gate passed: 90 samples, video recorded, no bad logs, mouth max `0.321`, target max `0.34`, all five viseme channels active.

Note: an initial visual run accidentally targeted the already-running port `8080` server from an older deployment and failed to observe new foot-plant telemetry. The final evidence above targets the fresh `PORT=18100` server serving the rebuilt client bundle.
