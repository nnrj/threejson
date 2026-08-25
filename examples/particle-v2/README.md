# Particle V2 examples

These descriptors can be loaded by Shower, Editor, or `createJsonScene()`. They intentionally use the same five-block Particle V2 contract on every backend.

- `text-logo.json`: browser-only `textMask` and `imageMask` sources; `threejson/particles-raster` is loaded on demand.
- `fire-smoke.json`: two continuous emitters with different lifecycle curves and forces.
- `rain-snow.json`: direct V2 weather emitters (the weather domain presets use the same contract).
- `attractor.json`: shell particles driven by two attractors.
- `mesh-surface.json`: particles sampled over a previously deployed mesh surface.
- The tutorial fixture [`../../assets/json/tutorial/track-02/02-10-particle-v2-sources.json`](../../assets/json/tutorial/track-02/02-10-particle-v2-sources.json) contains galaxy/halo, curve-stream, and firework examples.

Serve the repository over HTTP. `imageMask` follows browser CORS rules.
