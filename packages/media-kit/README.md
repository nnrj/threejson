# @threejson/media-kit

Opt-in deterministic scene/composition playback and offline image/GIF/video export. Uses `threejson/timeline`, optional audio-kit, Mediabunny/WebCodecs and gifenc. Ordinary ThreeJSON scenes do not import this package.

```js
import { renderVideo, renderImage } from '@threejson/media-kit';
const video = await renderVideo(sceneJson, { end: 8, width: 1920, height: 1080, fps: 30, format: 'mp4' });
const image = await renderImage(sceneJson, { time: 2, type: 'image/png' });
```

Inputs: scene/composition object, JSON text/URL, Blob, `.tjz` bytes. A browser canvas is required; Node users can use the installed-browser adapter in `@threejson/scene-tools/media`.

`createMediaProject` shares replay and resources between preview and encoding. `renderVideo` supports a seekable StreamTarget-compatible WritableStream; MP4 uses H.264/AAC, WebM uses VP9/Opus. Actual encoder availability is checked, not assumed. GIF is silent and palette-limited. Cancellation releases runtimes and encoders.

`/reconstruction` is a separate phase-two interface for host-injected analysis, not a video-to-3D implementation. It never uploads media or calls AI implicitly.

[中文指南](https://github.com/nnrj/threejson/blob/master/docs/zh/timeline-media.md) · [English guide](https://github.com/nnrj/threejson/blob/master/docs/en/timeline-media.md)
