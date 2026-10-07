# @threejson/media-kit

Opt-in deterministic scene/composition playback and offline image/GIF/video export. Uses `threejson/timeline`, optional audio-kit, Mediabunny/WebCodecs and gifenc. Ordinary ThreeJSON scenes do not import this package.

```js
import { renderVideo, renderImage } from '@threejson/media-kit';
const video = await renderVideo(sceneJson, { end: 8, width: 1920, height: 1080, fps: 30, format: 'mp4' });
const image = await renderImage(sceneJson, { time: 2, type: 'image/png' });
```

Inputs: scene/composition object, JSON text/URL, Blob, `.tjz` bytes. A browser canvas is required; Node users can use the installed-browser adapter in `@threejson/scene-tools/media`.

`createMediaProject` shares replay and resources between preview and encoding. `renderVideo` supports a seekable StreamTarget-compatible WritableStream; MP4 uses H.264/AAC, WebM uses VP9/Opus. Actual encoder availability is checked, not assumed. GIF is silent and palette-limited. Cancellation releases runtimes and encoders.

`createMediaProjectSession` / `createMediaOperationService` support revision-checked, atomic storyboard/shot/timeline edits, undo/redo, compact queries and injected frame-capture/export/narration adapters. `threejson/ai` can drive this service through `runVideoAgent` without depending on this package. Ordinary scene generation is unchanged.

NLE operations: `media.clip.insert/update/split/remove/roll/reorder`, `media.item.duplicate`, `media.asset.put`, `media.lanes.set` and explicit `media.document.replace`. Clips reference scene sources (copy-on-write when edited) or `{type:"media",assetId}` entries in `mediaAssets`. Split/trim/rate changes map linked audio/captions via `linkedClipId`; locked or overlapping ripple targets reject atomically. `timeline.lanes` describes editing layers, not animation bindings. Root automation follows NLE edits; exact JSON `timeline.edit` upserts opt in using `retimeAutomation:true`. Changes that cannot preserve automation exactly reject rather than corrupt the project.

`probeMediaAsset` checks browser decodability; `extractMediaAudio` produces a bounded WAV asset from imported media. `createMediaProject` composites images and timestamp-decoded video alongside procedural scenes. `OpenMediaDocument.getPackedAssets()` exposes archive Blobs for durable host storage; the host owns persistence and object-URL lifetime.

Compositions support cross-dissolves, wipe and seeded dissolve reveals, CJK-safe captions with highlights/typewriter effects, and bounded next-shot preloading. Narration uses actual PCM sentence duration; `packMediaDocument` turns existing inline audio into deduplicated binary assets without downloading remote dependencies. Runtime resource resolution preserves host gateway/cache policies.

`/reconstruction` is a separate phase-two interface for host-injected analysis, not a video-to-3D implementation. It never uploads media or calls AI implicitly.

[中文指南](https://github.com/nnrj/threejson/blob/master/docs/zh/timeline-media.md) · [English guide](https://github.com/nnrj/threejson/blob/master/docs/en/timeline-media.md)
