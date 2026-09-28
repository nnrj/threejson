[中文](../zh/scene-operations.md) | [English](./scene-operations.md)

# Scene operations and AI tools

## Ownership and dependency direction

Editor, ThreeBox, optional AI, CLI and MCP share a neutral operation service backed by the existing
SceneSession. There is no second scene database or undo stack. The editor does not depend on MCP;
tool adapters depend on the engine, never the reverse. Standard JSON is the full representation.
Friendly JSON remains a hand-authoring entry and need not invent a second spelling for every advanced field.
Dense coordinates are not automatically simplified.

```js
import { createSceneSession, createSceneOperationService } from 'threejson/session';
const session = createSceneSession({ objectList: [{ objType: 'box', threeJsonId: 'chair' }] });
const service = createSceneOperationService({ session });
const commands = [{ op: 'object.transform', args: { id: 'chair', frame: 'world', position: [2, 0, 1] } }];
await service.preflight(commands); // Read check coverage; this is not proof of rendering.
const result = await service.execute(commands, { baseRevision: 0, requestId: 'move-chair-1' });
await service.undo({ baseRevision: result.revision, requestId: 'undo-chair-1' });
session.dispose();
```

## Contracts and receipts

discover returns input/output schemas, target types, prerequisites, category, cancellation and undo semantics.
`threejson/operations` exports neutral contracts/registry/validation. Custom prepare functions return document
operations, not imperative side effects. Authoring batches prepare entirely before publishing one revision;
reads create no history, buffer drafts are not commits, and runtime actions do not rewrite source.

Statuses: read, draft, noop, preflight, committed, applied, partial, failed, cancelled, unavailable.
camera.fit can run after an authoring commit; a failed viewport action returns partial and does not undo
already committed authoring. Runtime action.invoke must run separately and is not transactional/undoable.
Same request ID and payload share a receipt within one session, including undo/redo. Different payloads
conflict. Closing/restarting expires this guarantee: no durable exactly-once claim is made.

Preflight prepares and releases a candidate, without publishing document/history/drafts or viewport commands.
It may read resources, populate caches or compile geometry. Document-only sessions cannot prove rendering.
Arguments, references, structure, geometry, resources, render and postconditions have separate check coverage;
unchecked is not passed. Cancellation is honored before commit; synchronous CPU work needs a yield or worker.

## Query and edit

scene.query/observe select by IDs, types, names/semantic aliases, parents/descendants, tags, category, part and
world AABB. Projections: identity, transform, bounds, summary, controls, semantic, materials, descriptor.
Only explicit descriptor/object.get requests return dense coordinates. Page limits never limit mesh capacity.
Authored, evaluated (parameters/compiled anchor poses), and runtime (current playback) states are distinct.
Results include revision, timestamp, length units (default m), radians, local pose and exact world matrices.
Cursors bind revision/query; sinceRevision uses changes observed by this session, including descendants
affected by parent movement and unfiltered removed IDs. These are authoring deltas, not an animation stream.
Reads after edits inside one batch describe an uncommitted candidate, labelled `documentState:candidate`,
with `revision:null` and `baseRevision`; they never expose intermediate revisions as published ones.
Cursor/delta queries require a committed document.

spatial.measure reports origin distance and AABB gaps/overlap, not exact solid collision. spatial.raycast
requires compiled geometry in the current runtime. scene.check supports existence, count, world position,
AABB size, material fields and AABB gap. Unsupported assertions such as photorealism remain unchecked.

object.transform requires parent/world/object/camera frame; object-frame operations are deltas. Length units
support m/cm/mm/km/in/ft. Singular inverses or unrepresentable shear fail instead of silently approximating.
Reparent preserves world pose by default. Clone regenerates subtree IDs, remaps known internal references,
preserves/reports external references, and does not guess arbitrary metadata strings to be references.
scene.layout offers row/grid/circle/polyline/seeded scatter placement; object.attach persists design relations.
Bound fields cannot be overwritten through generic object.patch or JSON Patch: edit parameters or detach first.
`design.parameter.set` preserves an existing quantity's unit/metadata; derived parameters require editing
their inputs or explicitly replacing the expression. Nested layout targets are evaluated parent-first.

model.node.patch and model.parameter.set use stable IDs and model revisions. points.sampleCurve samples
polyline arclength; points.scatterMesh uses deterministic area-weighted triangles, with normals/face indices.
Connect them to points.instance and instances.realize rather than writing repeated coordinates. These sampling
operators currently use CPU reference implementations; no GPU acceleration is claimed. Raw/control/graph
model representations and custom operators remain available.

Domains/hosts may add inputSchema and targets to existing registerEventAction(type, executor, contract).
Only contracted executors are discoverable; arbitrary click handlers are not automatically exposed as tools.

## Rendering feedback

scene.capture kind=scene uses the actual compositor with no extra light. It reports camera/light/environment/
exposure/resource diagnostics, rejecting zero-size or invalid canvas images. Capturing pixels does not prove
all resources loaded. kind=diagnostic uses host multi-view, relit model previews explicitly tagged
diagnosticRelighting:true; it cannot prove the original scene is correctly lit.

## Tools and optional AI

See [scene-tools](../../packages/scene-tools/README.md) for CLI/MCP setup. Ordinary operations need no model
key and start no browser. Version-checked atomic file replacement preserves externally changed originals;
cooperative lock files are not an OS-wide CAS for unrelated editors. Jobs support poll/cancel; cancelling does
not reverse a committed operation. Browser checks require explicit invocation and optional Playwright, using
an installed browser; no automatic browser download.

Editor Settings → Connect local scene tools pairs with `editor-bridge --origin <exact-editor-origin>`.
The relay binds 127.0.0.1, verifies origin, consumes a one-use pairing token, expires after 30 minutes, and
stores credentials only in memory. Discover the scene ID before editing. Changing scenes requires pairing
again. editor.call returns a queued request ID; editor.result reconciles it without resending. A disconnected
write may have unknown delivery. HTTPS pages may need browser local-network permission; engine code cannot
bypass that permission.

`threejson/ai` exposes runSceneOperationAgent: JSONL or explicitly selected native functions use the same
contracts/executor. The host must verify provider support before choosing native. No fixed quality-round cap;
no-progress/repeated operations, explicit budget, cancellation or provider failure stop with a truthful reason.
Optional deterministic assertions must pass before completion is claimed. Existing ThreeBox/Editor orchestration
is retained and uses the unified command service; this change does not force a provider switch.

Legacy Python/Gradio and MCP shells were retired; user settings/scenes/history were not deleted. Explicit AI,
texture and asset services moved to the Node package. Default web scraping was retired in favor of explicit
URLs/providers. Old source remains in Git. Desktop only changes its texture entry; full desktop product work,
multi-agent merging, precise physics/CAD constraints and richer visual tools remain phase two.
