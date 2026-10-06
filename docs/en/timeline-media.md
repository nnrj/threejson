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

Particle V2 `render.opacity` (default 1) and `material.opacity` address the same runtime global multiplier, multiplied by the `particle.opacityOverLife` curve. CPU, WebGL compute and WebGPU compute points/billboards share this contract. Tracks work when opacity is omitted and never edit the source descriptor. This does not expose arbitrary simulation/emission fields as runtime paths. `controls:{type:"none"}` disables interactive controls for authored film cameras.

ThreeBox auto mode negotiates `outputKind:"scene"|"video"` in the existing AI classification call instead of routing natural language through keyword rules. A visible, stoppable output-type notice precedes authoring. Invalid decisions stop instead of silently selecting a scene. Retries retain the type; explicit continuation of a composition remains video. Explicit output settings take precedence.

createJsonScene lazily installs runtime.timeline: play/pause/seek/renderAt/reset. Disable autoplay with timelineAutoPlay:false. The synchronous simple loader requires explicit attachSceneTimeline or switching to the async loader. `/timeline` edits use existing SceneSession/JSON Patch transactions; playback never creates per-frame undo entries. Standard/friendly conversion and scene export preserve timeline metadata.

CPU/WebGL-compute particles replay fixed ticks (default 1/60 s, configurable simulationStep), independently of output fps. Stateful CPU particles cache checkpoints (default every 2 seconds within 32 MiB; checkpointInterval/checkpointBytes are configurable); GPU compute and other systems still replay. A cache budget is not a scene/particle limit. First-time late seeks may remain expensive. Cross-device floating-point bit identity is not promised. Custom/WebGPU simulation without resetTime is explicitly rejected. Interactive scripts, external physics and arbitrary events do not automatically become deterministic.

Tracks accept a signal instead of keyframes: constant/sine/pulse/noise/envelope/orbit/path/beat/samples, with start/duration/extrapolation (hold/loop/none). Additional targets are $renderer, $pass:id, $effect:id, $caption:id and $audio:id (gain/pan); address existing properties such as strength, uniforms.focus.value or params.amplitude. Camera lookAt is evaluated after transforms. Built-in TSL graph time and the pulse preset use the scene clock; custom factories receive timeNode. Third-party code using global TSL time is outside this guarantee.

## Particles and clips

Object-only timelines leave interactive camera controls available; enabled camera tracks own camera motion. Caption x/y are normalized canvas coordinates. Explicit fontSize/outlineWidth use `output.height` (1080 by default) as the authoring resolution and scale consistently between preview and export.

timeline.effects entries are `{id,target,operator,start,duration,backend,params}`. Built-ins: wave (amplitude/frequency/speed), swirl (speed/twist), orbit (radius/speed), morph (source/seed), scatter (distance/seed), wavefront (amplitude/frequency/speed/width), and flow (path/speed/length/spread). Flow reuses curve descriptors; speed is path cycles/second and length is the occupied path fraction. Morph deterministically samples Particle V2 sources, with spatial or index correspondence and staggered assembly; raster remains optional.

CPU reference effects compose after simulation without feeding positions back. Optional backend:"webgl" evaluates these seven analytic operators in vertex shaders on static Particle V2 points/billboards with simulation.backend:"cpu". It is not fluid/GPU-compute simulation. Use one effect backend per object; unsupported GPU operators fail explicitly. registerParticleMotionOperator accepts custom CPU callbacks. Lifecycle curves have no shared eight-key ceiling; actual hardware limits are reported.

Optional r184 WebGL preview passes: dof (focus/aperture/maxblur), selectivebloom (targets/strength/radius/threshold) and cinematic (vignette/saturation/contrast/exposure/streak). Register passes with id, retain a final output pass. Depth and bloom support built-in particle displacement and SDF fill/outline; arbitrary shaders and WebGPU are not implied.

Use existing SDF, mesh and texture text for spatial titles, particle text for morphing, and independent screen captions for dialogue. Mesh text needs a usable font JSON. Captions support CJK wrapping/safe areas, fadeIn/fadeOut, slideY, reveal:"typewriter", charactersPerSecond and highlights:[{text,color}]. Bilingual lines use separate IDs/y positions. No MathJax/LaTeX formula layout engine is included.

```json
{ "documentType": "composition", "compositionVersion": 1,
  "timeline": { "duration": 12, "clips": [
    { "id": "a", "source": "first.json", "start": 0, "duration": 7 },
    { "id": "b", "source": "second.tjz", "start": 6, "duration": 6, "sourceStart": 2, "rate": 1, "fadeIn": 1 }
  ] } }
```

Keep JSON/.tjz, no new extension. Sources can be inline scenes, scenes dictionary keys, JSON/.tjz URLs or pack references. Source time is sourceStart+(globalTime-start)*rate. Repeated sources have isolated state. Later clips composite on top: fadeIn over a visible lower clip gives a cross-dissolve. Global audio continues across cuts. Nested compositions currently require flattening.

clip.transitionIn accepts `{type:"wipe",duration:1,direction:"left"}` or `{type:"dissolve",duration:1,seed:7,softness:0.08}`; overlap clips to reveal the next image over the previous one. Arbitrary mask URLs are not supported yet. The nearest next clip is prepared within 2 seconds by default (preloadNext/preloadSeconds), sharing compatible WebGL renderers and releasing inactive resources.

Archive entryKind is composition, entry composition.json. Explicit assets and existing inline Base64 audio are hash-deduplicated as binary; packMediaDocument never silently fetches remote dependencies. Narration is shareable without its model. Single-scene loaders reject compositions clearly rather than producing placeholder cubes.

## ThreeBox filmmaking and Agent operations

Settings → AI offers automatic/scene/video output, requested duration (0 means content-driven), draft/balanced/high quality, and optional storyboard approval. Substantive explainers are encouraged to plan 90–180 seconds, not a required minimum or hard limit. Ordinary scene/model generation stays intact. Still/GIF output remains available in the studio rather than separate generation buttons.

The video route creates a storyboard, playable rough cut, per-shot refinements and checks. Stop pauses; a later message can continue or rebuild an individual shot without replacing the film. Reload does not restart paid requests. Cards have playback, seeking and shot selection; Editor opens a selected shot. History remains immutable with one active viewport by default.

Visual review uses declared image-input capability; unknown models receive structural diagnostics only. A user who knows the current model accepts images can explicitly enable actual timestamped frame review in settings (additional provider cost may apply). Unrendered output is never marked visually verified. Narrative, aesthetics and scientific correctness still depend on the model.

media-kit exposes createMediaProjectSession/createMediaOperationService; threejson/ai exposes runVideoAgent with an injected service, no reverse dependency. Operations include media.inspect/plan.set/shot.put/shot.edit/shot.query/shot.remove, timeline.inspect/edit, media.validate/captureFrames/render/shot.narrate. Commits are revision-checked and atomic with undo/redo. Explicit budgets, cancellation, provider failure or repeated non-progress stop work while preserving completed shots; there is no fixed total round ceiling. Runtime adapters are advertised only when supplied.

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

The “Optional speech models & cache” panel includes a pinned MeloTTS Chinese local narration preview, or accepts host manifests. Inspect license/size, explicitly download/import, then enable local narration. Other imported models still need matching producers. Download/cancel/quota/remove remain explicit actions.

The baseline site's `.assetsignore` includes only the required browser modules from audio-kit/media-kit and their host bridges. Ordinary scene startup remains independent. Other package sources and local configuration stay excluded. Independent React consumers must install/upgrade the published packages.

`/models` exports getBuiltinAudioModels/createLocalSpeechProducer for pinned MeloTTS + Sherpa-ONNX single-thread WASM: about 71 MiB, exact sizes/hashes/licenses, no npm model download. Actual Chinese PCM synthesis was verified in local Edge; cross-origin isolation is not required, but CSP must allow its Worker/WASM/blob modules. Single voice, dictionary-dependent mixed English, substantial memory use; mobile devices and professional voice quality are not validated. Kokoro remains future work. Browser speechSynthesis remains preview-only.

media.shot.narrate synthesizes/caches sentences and uses measured PCM durations. Its optional captions array separates displayed text from spoken formulas/terms. Duration conflicts fail unless extend:true explicitly retimes the shot and later clips. Sentence alignment is not word-level alignment.

Music ducking accepts `{mode:"narration",gain:0.25,attack:0.15,release:0.3}` (voice clips carry narration:true), or explicit targets. analyzePcm returns RMS/peak/clipping and a sampled envelope usable in animation tracks. A beat signal follows supplied BPM; it does not analyze unknown music. Audio gain/pan automation and export share clip/source time mapping.

## Incomplete video production

`media.plan.set` creates empty storyboard placeholders, not rendered shots. Titles, intents and narration in production metadata do not create visuals or sound. Produce scenes/timelines with `media.shot.put` or `media.shot.edit`. Changing an empty shot's stage cannot pass completion checks; explicitly intentional blank intervals may use `metadata.intentionalBlank:true`, and caption-only shots are supported.

ThreeBox preserves plans and committed shots on interruption. Plan-only documents show the storyboard and pause reason instead of a black video player. Partial productions retain their original timeline with an unfinished notice. History feedback is rebuilt from the actual document, not an old success recap. `production.lastError` stores the last failure explanation and `stopReason` distinguishes invalid output, provider failure, explicit budgets and storyboard approval.

The Agent accepts Markdown-wrapped JSON/JSONL command batches without executing prose or incomplete batches. Electronic background music uses `timeline.audio[].recipe.kind:"score"` and needs no installed TTS model. Merely mentioning music in the brief does not create an audio track.

## CLI, MCP and phase two

`threejson media-export --file film.json --output film.mp4 --browser /path/to/installed/chrome --fps 30`

Install optional media/audio-kit and Playwright packages, then select an existing browser; no automatic browser installation. --config media.json accepts file/output/executablePath/mediaOptions. CLI flags override configuration; config paths are relative to the config file. Existing outputs are never overwritten; failed/cancelled files are removed. MCP exposes synchronous `media.render` and background `media.start` from a file or immutable session snapshot. Background exports reuse `job.get` / `job.cancel`.

The separate /reconstruction subpath only negotiates declared modalities and forwards timestamped references to injected analysis adapters. No hidden upload/model call or fake reconstructed scene. Full reverse AI reconstruction is phase two and does not require core/server changes. New packages join the existing release workflow. Evidence and pending work: [implementation ledger](../dev/plans/timeline-media/02-implementation.md).
