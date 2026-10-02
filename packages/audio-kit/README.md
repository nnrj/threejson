# @threejson/audio-kit

Optional local audio primitives for ThreeJSON or other applications. Importing this package does not download speech models, create an AudioContext or call a provider.

```js
import { synthesizeScore, encodeWav } from '@threejson/audio-kit';
const pcm = synthesizeScore({ version: 1, tracks: [{ id: 'melody', instrument: 'bell',
  notes: [{ id: 'note', tick: 0, duration: 960, pitch: 60 }]
}] });
const wav = encodeWav(pcm);
```

Use `createScoreRenderer` and `createPcmMixer` for bounded-block synthesis. `createPcmPlayback` schedules the same blocks on a WebAudio clock. Basic electronic instruments are not natural singing.

Optional subpaths: `/models` (explicit download/import, SHA-256 verification, OPFS/IndexedDB, leases), `/node-models` (user cache), `/worker-producer`, `/sherpa`, `/soundfont`.

`/models` exports `getBuiltinAudioModels` and `createLocalSpeechProducer({modelManager})`: a pinned MeloTTS Chinese + Sherpa-ONNX single-thread WASM preview, about 71 MiB, loaded only after explicit installation. Actual Chinese PCM synthesis was verified in local Edge; this is not a claim of professional voice quality or mobile performance. Kokoro and other voices still need adapters. Weights are not shipped or downloaded by npm installation.

`analyzePcm` returns RMS, peak, clipping and a sampled envelope. The deterministic mixer supports gain/pan automation and music ducking keyed to narration or explicit clip IDs. Generated WAVs are portable; listeners do not need the original voice model.

[中文指南](https://github.com/nnrj/threejson/blob/master/docs/zh/timeline-media.md) · [English guide](https://github.com/nnrj/threejson/blob/master/docs/en/timeline-media.md)
