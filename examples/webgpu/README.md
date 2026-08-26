# Explicit WebGPU/TSL preview

Run `index.html` through the repository's HTTP server. The page explicitly imports `threejson/webgpu`; no default ThreeJSON entry imports this adapter.

- `tsl-material.json`: TSL preset + graph materials and WebGPU bloom RenderPipeline.
- `tsl-burning-model.json`: external GLB material replacement plus an animated fractal-noise burn/dissolve TSL material, based on Pavel Boytchev's public Burning Lee demonstration.
- `webgpu-particles.json`: Particle V2 using `webgpu-compute`.

Append `?forceWebGL=1` to `index.html` to smoke-test Three.js WebGPURenderer's official WebGL2 fallback without changing the ThreeJSON scene contract.

The adapter is tested against Three.js r184. Other revisions run in `revisionPolicy: "best-effort"` mode with a warning; use `"strict"` when a host intentionally requires the tested revision. Use a browser with native WebGPU to test the native path. Three.js WebGPURenderer may use its WebGL2 fallback where supported. Neither path silently falls back to ThreeJSON's WebGL scene contract unless the JSON explicitly sets `compatibilityPolicy: "fallback-webgl"`.
