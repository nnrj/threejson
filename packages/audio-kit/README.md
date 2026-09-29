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

Optional subpaths: `/models` (explicit download/import, SHA-256 verification, OPFS/IndexedDB, leases), `/node-models` (user cache), `/worker-producer`, `/sherpa`, `/soundfont`. Host applications supply matching runtime factories, models and licenses. No preverified downloadable Melo/Kokoro catalog is bundled; adapter tests are not voice-quality validation.

[中文指南](https://github.com/nnrj/threejson/blob/master/docs/zh/timeline-media.md) · [English guide](https://github.com/nnrj/threejson/blob/master/docs/en/timeline-media.md)
