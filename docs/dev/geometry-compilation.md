# Optional geometry compilation

Control mesh evaluation and procedural surface math now live in `core/geometry`.
They have no runtime, object registry, material, AI or service imports. Their existing
synchronous builder APIs remain supported and use these same evaluators.

Applications can inject a compiler:

```js
import { createWorkerGeometryCompiler } from "threejson/geometry-worker";
import { createJsonScene } from "threejson";

const geometryCompiler = createWorkerGeometryCompiler();
const runtime = await createJsonScene(sceneJson, { geometryCompiler, signal });
// Reuse the compiler across independent scenes. The application owns it.
runtime.dispose();
geometryCompiler.dispose();
```

The worker is lazy: importing its API or loading an ordinary cube starts no worker
and downloads no evaluator bundle. Editable meshes, subdivision/modifiers and
procedural surfaces are prepared before visible scene assembly. Incremental session
geometry changes use the same compiler; adopted buffers are not evaluated again.
`bufferMesh` already supplies final coordinates and does not need this math worker.
Domain factory expansion and CSG remain separate runtime paths, not silently
advertised as worker-backed.

Typed attributes and indices are transferred, not serialized into decimal JSON.
The return value includes source topology, statistics and diagnostics; it omits the
expanded `evaluatedTopology` because rendering does not consume it. Call the existing
synchronous geometry evaluator explicitly if the expanded topology itself is needed.
No artificial vertex/triangle/byte or computation-time limit is imposed. An explicit
`meshBudget` continues to apply. The 10-second startup watchdog only detects a missing
or blocked worker script, not a slow geometry computation.

Cancelling active work terminates the worker; other queued requests continue in a
fresh worker. Cancelling a queued request does not affect active work. Runtime and
session cancellation cannot publish a late result. Compiler errors retain the old
scene through normal prepared transactions. Dispose the compiler to reject remaining
requests and release its worker.

Native ThreeBox, React cards, Shower and the baseline Editor inject this compiler.
If Worker is unavailable or blocked at startup, these hosts explicitly fall back to
the same direct evaluator. Computation failures do not trigger an expensive second
attempt on the UI thread or an automatic mesh simplification. Applications can
choose strict worker-only operation by using the engine compiler directly.

The worker bundle includes the small required subset of Three.js and carries its
license notice. It does not rely on an HTML import map (workers do not inherit one).
`npm run build:geometry-worker` regenerates it; `npm pack` also runs the build.
The generated artifact is committed for unbundled static deployments. A regression
test compares it with its sources. There are no new runtime npm dependencies.

Bundled hosts use `new Worker(new URL(..., import.meta.url))`. For a cross-origin CDN,
custom CSP or non-browser environment, inject `workerFactory()` returning a module
Worker-compatible transport. Cross-origin Worker URLs cannot be assumed to work just
because ordinary ESM imports do; a same-origin hosted worker or a host-approved blob
bootstrap is required. Node tests use worker_threads through this transport contract.
