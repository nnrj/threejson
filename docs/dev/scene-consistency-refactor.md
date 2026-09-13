# Scene consistency refactor

Implementation record for the September 2026 authoring/runtime refactor. This is a
delivery checklist, not a claim that unchecked capabilities have shipped.

## Decisions

- Keep standard and friendly JSON as supported authoring forms. Add a versioned,
  renderer-independent document representation behind their adapters.
- Separate authoring, compiled resources, playback and viewport state.
- Preserve WebGL/synchronous entry points, optional capabilities, native hosts,
  raw mesh expression and explicit runtime capture. No account/service dependency
  enters the engine.
- Resource acquisition, preparation and failure must not destroy a valid scene.
- Domain edits retain parameters and stable part overrides; baking is explicit.
- Immutable history revisions, bounded live viewports, transactional undo.
- No production deployment, remote database changes or push during implementation.

## Delivery checklist

- [ ] Resource readiness, cancellation, cache isolation, PBR material preservation.
- [ ] Complete light capture and reload; no helper lights in authored data.
- [ ] Versioned authoring document, adapters, transactions and runtime session.
- [ ] Domain stable parts, overrides, conflict diagnostics and explicit bake.
- [ ] History viewport lifecycle and editor transaction/undo integration.
- [ ] Correct modeling operations, dependency/relationship evaluation and AI queries.
- [ ] Shared native/React/Cloud integration, archive/proxy metadata, diagnostics.
- [ ] End-to-end regressions, package boundary checks, migration and release guidance.

## Initial evidence

The pre-change baseline passed 124 targeted engine/host tests and 6 local Worker
texture tests. Additional failure injection reproduced an empty failed texture
remaining bound/cached, Physical material demotion during texture acquisition, and
loss of directional light target/parent transform during reverse capture. Existing
tests also accept lossy Domain child edits. These require new behavioral tests,
not just preservation of old assertions.

No R2 binding is a supported remote-texture mode, not itself a rendering failure.
Expired remote images without a cache/archive cannot be recovered; that condition
must remain distinguishable from loader, material, authorization and GPU failures.

## Implementation evidence: resource/light foundation

- Added decoded-texture readiness and reference-counted resource leases. Failure
  preserves the previous map/base material; cancellation releases late results;
  independent material views share acquisition, not repeat/color-space settings.
- Material texture acquisition no longer persists gateway URLs or credentials.
  Durable archive replicas accompany authoritative source URLs. Physical material
  features survive PBR assignment.
- Added per-runtime resource policies and scoped actual scene-object creation.
  A new concurrent-scene test reproduced and now prevents both scenes borrowing
  the last-created scene's asset base.
- Light/camera capture now retains parent/world-space placement, target identity,
  visibility, layers, shadows, orthographic projection, zoom and orientation.
- The complete local suite passed after these changes (one pre-existing skipped
  test). Browser visual tests and the remaining checklist are still outstanding.

## Implementation evidence: documents and transaction foundation

- Added `threejson/document` and `threejson/session` opt-in entries: immutable
  SceneDocument, standard/friendly adapters, explicit migration inspection,
  revision-checked copy-on-write operations and prepared runtime transactions.
- Runtime session transform transactions preserve Object3D, geometry, material,
  camera and renderer identities. Structural preparation failure preserves the
  last valid runtime. Graphical replacement uses a host-provided staging viewport.
- Session history stores inverse deltas, with a default depth of 50 and a bounded
  checkpoint journal. Observers cannot invalidate a committed operation.
- Adapter tests cover real roomShow/portShow parameters and IDs, native embeds,
  custom metadata, assetLibrary/lib references and editable mesh descriptions.
- Fixed legacy Editor history failure behavior while its full session migration
  remains outstanding: failed undo/redo retains the entry, rejects overlapping
  operations, and reports rollback separately instead of pretending it succeeded.
- Full local suite: 1,329 passed, 1 existing skip. The new session is connected to
  the real engine; existing hosts are not yet fully migrated to document ownership.

## Implementation evidence: Domain parts

- Port, cabinet, nested doors and standalone device factories now publish stable
  part addresses and replay local transform/material descriptor overrides.
- Bound export retains factory parameters plus modifications, rather than
  silently reverting moved children. Missing parts, structural edits and schema
  conflicts are explicit. Editor binding failure no longer silently bakes.
- Domain drill-in respects the active assembly for nested factories. Moving a
  bound root no longer clears its child-edit state.
- Tests cover material/pose save-reload, stable IDs after dimension changes,
  nested door routing, parent-and-child atomic patches, conflict behavior and
  existing door picking/hinge animation.
- Found and corrected generated port/stat descriptors that used business labels
  as unsupported geometry types; main crane parts must now all actually deploy.
- See [Domain part contract](./domain-part-overrides.md). Full host document
  integration and browser validation remain on the delivery checklist.

## Implementation evidence: atomic commands

- Added a document-first command planner. Each batch prepares privately and commits
  one scene revision or none; failed geometry/image preparation retains the old
  object, image, document, pending buffer draft and undo entry.
- Material and geometry transactions retain runtime/camera/Object3D identity.
  Same-layout BufferAttributes receive changed ranges; structural geometry is
  prepared before swapping. Playback poses are not reset by unrelated edits.
- Buffer append avoids argument spreading for large arrays. Journal array-splice
  deltas retain only changed portions, and editable topology edits log inverse deltas.
- Read-only commands use the authoring document, with projected geometry queries
  for commands earlier in the same batch. Runtime capture remains explicit.
- Full local suite at this checkpoint: 1,344 passed, 1 existing skip. Native/React
  cards will consume this API in the host-integration step; browser QA remains due.

## Implementation evidence: shared scene cards and resource lifetime

- Native and React cards now use the same document/session controller. Failed
  preparation keeps the old viewport; saves capture authoring data, not playback.
- History cards defer renderer creation. The host defaults to one active viewport,
  preserves a screenshot and its independent document when suspending, and supports
  a user-configured comparison budget. Clicking a dormant card reactivates it.
- Progressive textures are decoded before their material/document transaction.
  Stale plans and decode failures cannot overwrite current material state. Initial
  and historical loads now use the browser cache; fallback resolution is lazy.
- Resource tracking no longer strongly retains retired geometries and textures.
  Repeated mutation tests check that the live diagnostic index does not grow.
- WebGPU/TSL activation is shared with React and remains optional. Static hosts
  remain deployable without packages/. Shared session modules are synchronized by
  `node tools/dev/syncHostSessionModules.mjs`; parity is enforced by a test.
- Local checkpoint: 1,355 tests passed, 1 existing skip; React ThreeBox production
  build passed. Cloud package validation and browser visual QA remain outstanding.

## Implementation evidence: geometry, AI validation and imported resources

- Simplify now contracts manifold edges using accumulated plane quadrics; it no
  longer discards a sample of faces and leaves holes. Boundary/part/material seams
  are preserved by default. If the target cannot be reached without damaging the
  surface, the actual count and reason are reported. This is not a core size cap.
- Bevel uses the same real edge-chamfer operation for modifiers and commands;
  EdgeSplit separates connected smoothing fans. Concave n-gons use triangulation,
  not a triangle fan that can cross the polygon boundary. Unsupported modifiers
  fail explicitly. Reference: [quadric error metrics](https://www.cs.cmu.edu/~garland/Papers/quadrics.pdf).
- Structural validation no longer falls back to a weaker validator after a
  normalizer error. The pure capability inventory was moved out of AI so runtime
  validation has no dependency on AI. Spatial summaries have explicit pagination
  and no hidden 40-object cutoff; dense geometry remains excluded from summaries.
- External model loaders now capture per-scene URL policies and use independent
  loading managers. GLTF/OBJ child buffers and textures resolve relative to the
  authoritative model URL before gateway resolution. Cancellation rejects promptly
  and disposes late non-abortable results. Duplicate callback/Promise loaders were
  consolidated, retaining the synchronous deployment API.
- Imported empty image maps are removed after loading settles, retaining base
  material values. Video and GIF maps now wait for the first decoded frame;
  cancellation, failed decode and cloned views have explicit resource ownership.
- Behavioral coverage includes real concurrent GLTF requests, relative .bin paths,
  cross-scene registries, delayed cancellation, video first-frame readiness,
  material fallback and closed/wound simplified and beveled meshes. Browser and
  server-proxy integration checks are still tracked separately below.

## Implementation evidence: Editor authoring timeline

- The baseline Editor now owns a SceneSession: commands, object imports, property
  and material edits, undo/redo, save and recovery share its authored document.
  History stores inverse deltas (50 steps by default); one progressive texture
  enrichment is one undo group. Failed imports preserve the visible scene.
- Saving no longer copies unrelated animated poses or the inspection camera into
  authoring data. Nested Domain edits retain stable part overrides without copying
  generated children. Cancelling drill-in can rebuild the unchanged authoring
  revision to discard even topology/material previews.
- Object visibility is separate from shared material visibility. Array, prefixed
  vector and quaternion transforms now use a neutral shared mapper, including
  baked/instanced geometry. Ordinary property edits retain Object3D and renderer.
- Loader scheduling propagates failures instead of reporting a missing-object
  scene as successfully loaded. Full Editor loads stage off-screen and reject stale
  results. A tutorial regression registers its legitimate `floor` Domain instead
  of silently skipping it; the scene description itself was not replaced.
- Browser checks verified startup, recovery with lighting/color, adding/moving a
  cube, undo and selection. They also reproduced and fixed tree double-clicks
  bubbling into canvas picking and selecting TransformControls internals.
- Material sampling dialogs edit a private draft, so Cancel cannot change the
  document. Material-library labels are escaped and display no longer mutates the
  document. Hidden legacy fields cannot overwrite per-face material edits.
- Local suite checkpoint: 1,377 passed, 1 existing skip. Archive ownership,
  comprehensive scenario browser checks and other checklist entries remain open.

## Implementation evidence: portable archives and backdrop ownership

- Archive import no longer substitutes page-lifetime blob URLs into saved scene
  data. Stable namespaced pack references and portable assetLibrary file entries
  survive runtime disposal, JSON save/reload and re-packing without duplicate bytes.
- Runtime normalized payloads retain the full authoring envelope, including asset
  libraries and metadata. Binary BufferGeometry preparation is separate from the
  immutable document and works through incremental edits and undo.
- Actual GLTF loading tests cover relative binary files inside an offline archive.
  Model, texture, audio, font and script boundaries resolve embedded files in their
  owning scene. Partial Editor archive import now uses its transactional timeline.
- Reproduced an old backdrop bug: disposing the previous map could clear the new
  successful map. Slot-specific ownership now preserves successful replacements,
  retains old values on failure and disposes cancelled/late results.
- See [archive ownership](./archive-resource-ownership.md) for storage overhead,
  policy choices and limitations of previously persisted blob-only records.
- Local checkpoint: 1,385 tests passed, 1 existing skip.

## Implementation evidence: optional service delivery

- Server asset and texture downloads share streaming size checks, full-body
  timeout, cancellation and private-address checks. Text model formats are
  supported. HEAD/Range metadata and compressed lengths have explicit handling.
- Optional R2 archival preserves successful slots and reports each failed slot.
  Durable archiveMaps are separate from runtime proxy addresses and source maps.
  No new R2 requirement or database migration was introduced.
- Dashboard explains remote delivery versus archival and the full-download timeout.
- Local server suite: 81 passed; server typecheck and Dashboard production build
  passed. These changes have not been deployed.

## Implementation evidence: optional design expressions and relationships

- Standard/friendly authoring can now retain explicit units, shared numeric
  parameters, bindings, local anchors and static attach/lookAt relationships.
  Parameter/relationship dependencies are ordered before deployment; cycles,
  missing parts, invalid arithmetic and binding conflicts are structured failures.
- Binding-driven primitive changes update geometry in-place; unrelated material
  changes in constrained scenes retain the runtime. Changes affecting anchor
  geometry use full off-screen preparation before exposure. There is no per-frame
  constraint solver or silent conversion of every legacy coordinate into units.
- Editor numeric parameters, explicit detach-with-appearance and undo use the same
  document timeline. Derived fields cannot leak into authoring snapshots or leave
  an uncommitted drag pose. Rotation input now accurately labels radians and handles
  existing quaternion descriptors instead of ignoring their orientation.
- AI gets the detailed `sceneDesign` grammar only when the capability is selected.
  The example catalog includes a parameterized table with an anchored ornament.
- Browser checks verified loading, width changes from 200 to 350 cm, undo to 200,
  and retained blue material after clearing selection highlight. The full suite
  identified a missing mirrored Editor shell update; that source/template mismatch
  is fixed, including document/session import mappings in the generator template.
- See [design contract and limits](./scene-design.md). Remaining end-to-end scenario
  checks and optional resource/compute integration are still tracked above.

## Implementation evidence: optional WebGPU resource ownership

- TSL graph images and prepared module factories now belong to one load/runtime,
  not a global URL cache. Material sampling uses independently owned texture views.
  A builder without a scope cannot borrow resources from the last history canvas.
- Preparers return disposable resource groups. Failed preparation disposes previous
  groups; runtime disposal retires its own groups. Cancellation cannot publish a
  late image or code factory. Application policy/authorization remains independent
  from resource ownership; the explicit code entry still defaults to trusted.
- Graph URLs and relative images resolve before delivery proxies. Embedded graphs
  and relative images reload offline. The arbitrary 256-node graph limit is gone.
- Direct preparer consumers must retain the returned group, pass `graphResources`
  or `codeResources` when constructing materials, and dispose it when finished.
  `createJsonScene` manages this automatically. `getTslCodeExecutionState(resources)`
  reports that group's count; `clearPreparedTslCode(resources)` disposes only it.
- 27 targeted behavioral tests passed. This does not make JavaScript transactional:
  executing a module can have page-level side effects that cannot be rolled back.
  Normal remote ESM still uses the browser module loader to retain dependency/import
  map semantics. For exact-byte execution/integrity (including dependencies), a
  host `moduleLoader` must execute the supplied verified bytes; fetching a hash and
  then importing a mutable remote URL is not an atomic integrity guarantee.

## Browser checkpoint: Shower and legacy Domain hosts

- Browser testing found Shower never activated its advertised WebGPU/TSL examples.
  It now uses the shared optional-capability loader and document/viewport controller,
  with all required static import mappings. Ordinary scenes retain the WebGL path.
- Running a deliberately invalid graph keeps the previous animated scene visible.
  Superseded catalog fetches cannot replace a later choice. Errors explicitly say
  when the previous scene was retained; compilation failures are not called JSON
  syntax failures. Viewer-only helpers do not enter exported models.
- The third-party view gizmo uses WebGL LineMaterial. WebGPU hosts now give only
  this small widget a separate WebGL canvas; a default WebGL scene still shares
  its renderer. The widget no longer produces incompatible-material errors or
  garbled geometry on the TSL preview.
- `room-show.html` visibly retains textured flooring/walls/cabinets and lighting;
  its main door open/close interaction works. Further scenario checks remain below.

## Browser checkpoint: model paths and Domain panel isolation

- The real port benchmark exposed an explicit OBJ/MTL asset alias being resolved
  twice relative to the model directory. Page-relative `/assets/` aliases now use
  the page base; ordinary `mtllib` references remain model-relative. Browser reload
  confirms the ship materials load, alongside the textured quay and panel images.
- Device panels, their event bindings, visibility and replacement now use their
  owning scene's registry and resource policy. Same IDs in another history canvas
  cannot redirect a panel update. A pure Domain resolver no longer warns about
  legitimate forward references before the scene has deployed its panels.
- Panel images use decoded resource leases. Carrier replacement waits for the
  image, failed/superseded updates retain the old carrier, and retired panel
  geometry/materials are disposed. Runtime textures no longer enter panel JSON.
- Visibility changes no longer rewrite shared material visibility. 56 focused
  model/panel/visibility regression tests passed at this checkpoint.

## Implementation evidence: off-thread geometry

- Extracted pure control-mesh and procedural evaluators from runtime builders.
  A lazy optional Worker transfers evaluated buffers into prepared scene/session
  commits. Synchronous engine APIs remain intact; ordinary cubes load no worker.
- Native/React cards, Shower and Editor inject the shared host policy. Cancellation
  terminates running computation without losing queued work. Missing Worker/CSP
  support has an explicit host fallback, not a geometry simplification or hidden cap.
- Five real-Worker/queue tests verify deterministic geometry, cancellation, errors,
  transfer metadata and ownership. The full suite passed 1,423 tests with one
  existing skip. Browser loading of the editable lounge chair remains correct.
- See [compiler contract](./geometry-compilation.md) for generated bundle/release
  handling, CDN constraints and the boundaries of the worker-backed capabilities.
