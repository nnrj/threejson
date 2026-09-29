# Timeline, audio and procedural media (alpha / preview)

[中文](../zh/timeline-media.md)

A normal ThreeJSON scene can be a still, animation or complete film. Multiple dynamic clips are optional. Export evaluates explicit timestamps rather than recording wall-clock speed; no video AI provider is required.

## Applications and authoring

Use Timeline / Media export on native/React ThreeBox cards, Shower, or Editor/Player file menus. The shared studio offers playback, seeking, JSON/.tjz import, temporary local music/voice import, dimensions/duration/fps and export. Its isolated runtime does not change history, authoring JSON or undo. Temporary audio and export settings are not automatically persisted into the scene.

See the website Timeline & Procedural Media gallery and [HTML studio](../../examples/html-demo/track-08-media/08-01-media-studio.html). Captions and soundtracks play in the studio. Ordinary scene canvases animate 3D tracks without automatically importing audio production SDKs; existing ambient/positional audio remains unchanged.

Add `timeline:{version:1,duration:8,tracks:[...]}` to a normal scene:

```json
{ "id": "camera", "target": "$camera", "property": "position", "easing": "smoothstep",
  "keyframes": [{ "time": 0, "value": [7,5,10] }, { "time": 8, "value": [0,2,6] }] }
```

Time is seconds, rotation radians. Targets are threeJsonId, `$camera`, `$scene`. Properties include transforms/components, visibility, material color/opacity, morphTargetInfluences.0, camera fov/lookAt. Quaternions `[x,y,z,w]` use spherical interpolation. IDs are unique and keyframe times strictly increase. Initial values remain before the first keyframe; final values remain afterward. Easing: linear/step/smoothstep/easeIn/easeOut/easeInOut or registerTimelineEasing.

`material.opacity` / `material.color` address all of the object's material slots. A group without its own material (including the internal billboard text wrapper) addresses descendant materials, so SDF text fill and outline fade together. `material.1.opacity` selects one slot; on groups this index is interpreted per descendant material list. Transform tracks still operate on the target itself. Missing properties or slots report the track ID, target ID and object type rather than silently dropping an animation.

createJsonScene lazily installs runtime.timeline: play/pause/seek/renderAt/reset. Disable autoplay with timelineAutoPlay:false. The synchronous simple loader requires explicit attachSceneTimeline or switching to the async loader. `/timeline` edits use existing SceneSession/JSON Patch transactions; playback never creates per-frame undo entries. Standard/friendly conversion and scene export preserve timeline metadata.

CPU/WebGL-compute particles replay fixed ticks (default 1/60 s, configurable simulationStep), independently of output fps. Backward seek resets/replays and may be expensive. Cross-device floating-point bit identity is not promised. Custom/WebGPU simulation without resetTime is explicitly rejected. Interactive scripts, external physics and arbitrary events do not automatically become deterministic.

## Particles and clips

Object-only timelines leave interactive camera controls available; enabled camera tracks own camera motion. Caption x/y are normalized canvas coordinates. Explicit fontSize/outlineWidth use `output.height` (1080 by default) as the authoring resolution and scale consistently between preview and export.

timeline.effects entries are `{id,target,operator,start,duration,params}`. Built-ins: wave (amplitude/frequency/speed), swirl (speed/twist), orbit (radius/speed), morph (source/seed). Morph deterministically samples an existing Particle V2 source to the current count; raster remains optional. registerParticleMotionOperator accepts custom pure callbacks. CPU position effects compose after simulation without feeding positions back into physics. Lifecycle curves no longer share an eight-key ceiling; real GPU uniform limits are reported.

```json
{ "documentType": "composition", "compositionVersion": 1,
  "timeline": { "duration": 12, "clips": [
    { "id": "a", "source": "first.json", "start": 0, "duration": 7 },
    { "id": "b", "source": "second.tjz", "start": 6, "duration": 6, "sourceStart": 2, "rate": 1, "fadeIn": 1 }
  ] } }
```

Keep JSON/.tjz, no new extension. Sources can be inline scenes, scenes dictionary keys, JSON/.tjz URLs or pack references. Source time is sourceStart+(globalTime-start)*rate. Repeated sources have isolated state. Later clips composite on top: fadeIn over a visible lower clip gives a cross-dissolve. Global audio continues across cuts. Nested compositions currently require flattening.

Archive entryKind is composition, entry composition.json. Explicit binary assets are hash-deduplicated; packMediaDocument never silently fetches all remote dependencies. Single-scene loaders reject compositions clearly rather than producing placeholder cubes.

## Export

```js
import { renderImage, renderGif, renderVideo, packMediaDocument } from '@threejson/media-kit';
const still = await renderImage(scene, { time: 3, type: 'image/png', alpha: true });
const gif = await renderGif(scene, { end: 8, fps: 20, signal });
const film = await renderVideo(scene, { format: 'mp4', width: 1920, height: 1080,
  fps: 30, signal, onProgress: ({progress}) => updateProgress(progress) });
const archive = await packMediaDocument(scene, { assets: {'voice.wav': wavBytes} });
```

MP4 uses H.264/AAC; WebM VP9/Opus, subject to actual browser codecs. Unsupported formats fail; explicitly select another. PNG/JPEG/WebP return their actual MIME type. GIF is silent, palette-limited, and uses centisecond delays. Frames cover `[start,end)`.

Pass a Mediabunny target or position-aware writable for streaming output instead of a final in-memory Blob. Audio/video submission is interleaved with backpressure; default scores synthesize bounded blocks. GIF uses a Worker when module resolution permits, otherwise reports a main-thread fallback through onWarning. gifModuleUrl can point to an installed codec. Existing MediaRecorder stays a separate real-time tool.

Used textures, fonts and video frames must be ready before capture. CORS/decode/context failures are reported. Hidden scene autoplay is disabled; only explicit timeline.audio enters offline mixing, not inferred spatial/interactive sounds. DOM overlays are excluded; use scene text or captions. Host-preloaded fonts are needed for identical glyphs across machines.

## Audio and optional models

Audio clips need id, url or recipe, and may specify start/duration/sourceStart/rate/loop/gain/pan/fadeIn/fadeOut. Rate changes pitch as well as speed. Source overrun requires loop or padSilence. Audio beyond the film needs an extended timeline or explicit end/trimAudio.

Score example: `{kind:'score',score:{version:1,ppq:480,tempos:[{tick:0,bpm:120}],tracks:[{id:'melody',instrument:'bell',notes:[{id:'n',tick:0,duration:480,pitch:60,velocity:.7}]}]}}`. Ticks are musical time. Tempo maps, tracks, velocity, pan, adjacent equal-pitch ties and explicit repeats compile to a performance. Sine/triangle/soft-piano/bell/noise are electronic synthesis, not natural singing. MIDI/MusicXML interchange and a full notation/arrangement UI are not implemented in this delivery.

audio-kit exports score compilation/synthesis, PCM mixing/playback, WAV, decodeAudio and registerAudioProducer. createPcmPlayback schedules short blocks on the WebAudio clock; a host can drive 3D playback from its time. Optional subpaths:

- /soundfont: host-supplied SpessaSynth library and user sound bank, no automatic download.
- /models: explicit download/import/status/list/remove/acquire, progress, cancellation, size/hash verification, atomic manifests and leases. OPFS first, IndexedDB fallback; browser storage may be evicted.
- /node-models: configurable user cache directory, not package.json machine paths.
- /sherpa: supplied compatible WASM/model/config; `{file:'role'}` / `{directory:'subdir'}` map to owned virtual filesystem paths.
- /worker-producer: trusted host module, background synthesis, progress/cancellation. Scene recipes cannot select executable module URLs.

Model manifests require id/version/adapter/license/files; files require role/bytes/sha256, optionally path/url. Download/import occurs only after user selection. Weights are tool dependencies; generated audio is the shareable artifact.

The shared workbench includes an “Optional speech models & cache” panel: select a host-provided `modelCatalog` entry or import a manifest, inspect license/size, explicitly download/import files, cancel, inspect quota and remove cached models. A cached model still needs its matching audio producer; the panel does not claim otherwise.

The baseline site's `.assetsignore` now includes only the required browser modules from audio-kit/media-kit and two host-kit modules. Ordinary scene startup remains independent. Other package sources and local configuration stay excluded. Independent React consumers must install/upgrade the published packages.

**No preverified downloadable Melo/Kokoro catalog is bundled yet.** Storage/runtime/Worker bindings exist, but real model distribution, loading and quality need separate verification. Mock contract tests are not voice model validation. Browser speechSynthesis is preview-only, not exportable PCM.

## CLI, MCP and phase two

`threejson media-export --file film.json --output film.mp4 --browser /path/to/installed/chrome --fps 30`

Install optional media/audio-kit and Playwright packages, then select an existing browser; no automatic browser installation. --config media.json accepts file/output/executablePath/mediaOptions. CLI flags override configuration; config paths are relative to the config file. Existing outputs are never overwritten; failed/cancelled files are removed. MCP exposes synchronous `media.render` and background `media.start` from a file or immutable session snapshot. Background exports reuse `job.get` / `job.cancel`.

The separate /reconstruction subpath only negotiates declared modalities and forwards timestamped references to injected analysis adapters. No hidden upload/model call or fake reconstructed scene. Full reverse AI reconstruction is phase two and does not require core/server changes. New packages join the existing release workflow. Evidence and pending work: [implementation ledger](../dev/plans/timeline-media/02-implementation.md).
