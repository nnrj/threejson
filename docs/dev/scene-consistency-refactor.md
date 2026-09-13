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
