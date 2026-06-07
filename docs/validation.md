# Validation

## Package Gates

Run these in `/Warehouse/Waifu-Animation`:

```bash
npm run check
npm test
npm run build
```

Current coverage includes:

- finite transform and clip validation;
- quaternion sanitization and shortest-path retargeting;
- local clip sampling;
- local-to-model pose conversion;
- weighted pose blending with masks;
- runtime layer evaluation;
- declarative track-name masks;
- Three adapter clip binding and runtime lane construction;
- look-at target distribution;
- two-bone IK solve sanity;
- viseme stack limiting;
- blink scheduler sanity;
- pose rotation metrics.

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

## Active Manifest Status

The active Waifu manifest expands to 564 entries: 9 curated paid clips plus 555 generated Mocap Online entries. The current manifest has zero entries marked `rejected` or `quarantined`, and the pass-4 asset inspection reported zero clip asset issues.

## Known Limits

- The package has IK and look-at foundations plus the Three animation adapter, but Waifu still applies most procedural pose corrections through Three/VRM code in `src/client/main.ts`.
- The current visual gates validate standing, speaking, listening, thinking, shrug/wave/emphasis behavior, debug clip playback, visemes, and idle transitions. They do not yet validate full locomotion, sitting, stretching, foot planting, root motion, prop attachments, or multi-avatar retargeting.
- The current Waifu runtime still uses Three `AnimationMixer` as the renderer backend through the package adapter. The package provides an Ozz-style local-pose runtime, but Waifu has not yet moved final browser pose application fully onto that buffer pipeline.
