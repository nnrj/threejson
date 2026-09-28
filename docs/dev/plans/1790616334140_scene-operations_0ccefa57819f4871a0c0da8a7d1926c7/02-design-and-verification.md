# Implementation and verification ledger

## Architecture

`Editor / ThreeBox / optional AI / CLI / MCP -> scene operation service -> SceneSession -> runtime`.

The service owns protocol receipts, session-scoped idempotency and check coverage.
The session remains the sole authoring timeline. Commands share machine-readable
contracts; transaction preparation is distinct from imperative runtime actions.
Queries distinguish authored/evaluated/live state, coordinate frames, revisions and
approximation accuracy. Rendering feedback distinguishes scene lighting from relit
diagnostic previews.

## Work packages

- [x] Contracts, strict errors, genuine preflight, atomic execution and receipts.
- [x] Structured queries, projections, spatial operations and postconditions.
- [x] Transform/clone/reparent/layout and stable-node modeling edits.
- [x] Real scene capture and explicit diagnostic image metadata.
- [x] Shared Node CLI/MCP, session lifecycle, optional browser verification and bridge.
- [x] AI and host integration; command discovery and feedback use shared semantics.
- [x] Release wiring, bilingual documentation, workflow examples and regression audit.

These are dependency checkpoints, not requests for separate user acceptance.
Use this ledger to report unfinished work honestly; unchecked coverage is not success.

## Required evidence

- Wrong args/type/capability, stale revisions, partial preparation failure, cancellation,
  no-op/read/commit distinction, duplicate request IDs and ID-payload conflicts.
- No preflight mutation of document, canvas, selection, history or pending buffer drafts.
- Nested transforms, singular/sheared matrices, binding ownership, reference remapping,
  Domain parts, independent scenes sharing object IDs, deterministic layouts.
- Query responses for large meshes do not echo dense geometry unless requested.
- CLI/MCP/local API execute the same operations and retain originals on failed writes.
- Missing browser/renderer/credentials are reported as unchecked/unavailable, not
  falsely verified. Live paid-provider tests require explicit authorization.
- Preserve room-show, port-show, html-demo, simple-cube boundaries and current suites.

## Baseline

Before edits: scene command transactions 5/5, modeling boundaries 5/5, Editor
authoring 10/10. All four repository worktrees were clean. Runtime warning fixtures
are not counted as newly fixed issues.

## Delivered implementation

- Added a neutral operation registry/service, schema and target validation, revision
  guards, session-local idempotency, explicit commit/read/draft/runtime results and
  per-category verification coverage. Preflight prepares and releases candidates
  without publishing changes to the document, visible scene, undo history or drafts.
- Added compact semantic/spatial queries, revision-bound cursors and document deltas,
  exact world matrices, explicit coordinate frames and honest AABB approximations.
  Reads inside an edit batch identify their uncommitted candidate state instead of
  exposing an internal revision as a committed one.
- Added transform, clone, reparent, layout, attachment and design-parameter operations;
  stable modeling-node edits; deterministic CPU curve and mesh-surface sampling.
  Binding ownership is enforced across generic patch paths, including rotation aliases.
- Added actual-scene capture distinct from explicitly relit diagnostic views. Fixed
  viewport sizing so an offscreen/local verification canvas does not silently become
  zero-sized; missing renderer and unavailable validation stay visible in receipts.
- Routed ThreeBox/shared host and Editor authoring through the same service without
  adding a second undo system. Added opt-in contract discovery for runtime actions,
  and optional AI orchestration with native tools or JSONL and truthful stop reasons.
- Added `@threejson/scene-tools`: persistent Node sessions, CLI, SDK-based MCP, jobs,
  cancellation, guarded file writes, opt-in browser verification, explicit AI/assets/
  texture entry points and a one-use paired local Editor bridge.
- Retired the old Python/Gradio shell and duplicated MCP/Node bridge implementation.
  No user configuration, scene, history, download or cache was deleted. Retired source
  remains recoverable from Git. Desktop texture entry paths were updated, but a full
  desktop product rebuild is outside this phase.
- Added bilingual usage/architecture documents, runnable operation examples, package
  export and release checks. No package versions were bumped and nothing was published,
  pushed or deployed. The server, dashboard and Cloud repositories required no edits.

## Final verification (2026-09-29, Windows / Node 24 / Edge)

- Full Node suite: **1,579 tests, 1,578 passed, 0 failed, 1 skipped**. The skip is the
  existing DOM-dependent CSS3D panel test. The suite includes transaction rollback,
  wrong types/arguments, revision conflicts, idempotency, stale cursors, binding
  ownership, units, nested layouts, large-mesh projections and package boundaries.
- Optional AI static verification: **3 passed**. Provider fixtures exercise tool
  responses, no-progress/truncation handling and partial-result preservation; these
  are not live paid-provider tests.
- Real browser integration: **8 checks passed**: simple cube, room-show, port-show,
  FPS walk, scene intro, computable modeling with Worker completion, particle sources,
  and the Editor. No recorded page errors or failed network requests in these checks.
- Editor end-to-end: new scene, explicit local pairing, external object addition,
  undo, and comparison confirming the original source JSON was restored.
- Screenshots of the room, port and computable-modeling scenes were visually inspected.
  These smoke checks are not a claim of exhaustive visual correctness on all devices.
- Modeling Worker build, host-module synchronization check, release-state check,
  engine/tool-package dry-run packing, CLI workflow example and `git diff --check`
  passed. No real AI credentials or services were used.
- Local reproducible outputs are ignored under `dist/scene-operation-check/`:
  `node-tests.log`, `report.json` and scene screenshots. Browser checks can be rerun
  with `tools/dev/verify-scene-operations-browser.mjs` and an installed browser.

## Deliberate limits and follow-up

- Idempotency and change cursors are session-scoped, not durable collaboration or an
  exactly-once guarantee across process restarts. File locks coordinate participating
  writers; they do not provide operating-system-wide compare-and-swap.
- Runtime action contracts are opt-in. Arbitrary legacy event callbacks are not
  automatically exposed as tools, and imperative side effects are not undoable.
- Real image capture does not prove all asynchronous resources are ready. Resource
  readiness remains separately reported; AABB measurements are not solid collision
  or CAD/manufacturing verification. Sampling currently uses the CPU reference backend.
- Existing ThreeBox/Editor interaction flows remain; the new optional native-tool
  agent does not force users to replace their configured provider.
- No live paid-provider, full Electron installer, exhaustive mobile or cross-browser
  certification was performed. Desktop UX, multi-agent collaboration, physics/CAD
  constraints and additional visual authoring tools remain phase-two work.
- Before npm release, bump and publish the coordinated engine and workspace package
  versions using the release scripts; the already published versions do not contain
  these new exports. Deployment and publication remain the user's explicit next step.

## Rollback

Keep changes in reviewable local commits. Revert the relevant implementation commit
if necessary; never reset or delete user scenes, remote data or configuration.
