# AI scene operations: approved implementation context

Date: 2026-09-29 (Asia/Shanghai). Baseline: `d9b20a9`.

The maintainer approved the Alpha revision of the AI-operation architecture plan,
then explicitly requested implementation. The anonymous AI wishlist is inspiration,
not an authoritative requirements source. Existing documents and actual consumers
take precedence over historical notes in `old_refer_plan`.

## Human review

- Reviewer: repository maintainer, in this task conversation.
- Date: 2026-09-29.
- Decision: approved; begin implementation. This records approval of the design,
  not a claim that the resulting implementation has already been reviewed.

## Decisions

- Reuse SceneDocument / SceneSession / the runtime driver and undo journal.
- Editor, ThreeBox, optional AI, CLI and MCP consume neutral local operations.
  Editor does not depend on MCP; core does not import applications or AI.
- Alpha contracts may change when the change is beneficial. Human-readable
  shorthand remains useful without requiring a second grammar for every advanced
  representation. Never silently discard advanced fields.
- Retain explicit raw-coordinate modeling and optional host budgets. No artificial
  mesh-size or AI-quality-round limits.
- CLI/MCP may be rebuilt. Desktop product modernization is deferred; maintain
  necessary entry wiring. No account/payment/sync rewrite without an integration need.
- Retain independent historical canvases, source exports, undo/redo and Domain
  behavior. Do not erase user files, settings, credentials or histories.
- Local commits are allowed; do not push, publish packages or deploy.
