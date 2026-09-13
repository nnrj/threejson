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
