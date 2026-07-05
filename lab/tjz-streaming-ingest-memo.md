# tjz Streaming Ingest Memo

**状态**：`idea`（PoC 设计；v1 未实现）

## Goal

Support asynchronous/chunked/stream-like ingest so callers can send scene JSON first, then deliver assets in batches.

## Why not in v1

Current core deploy flow is payload-first and resolves most assets at deploy time. Runtime-level asset hot-patching (texture/model/audio rebinding) is possible but requires a dedicated state machine and object targeting contract.

## Proposed architecture

1. `createTjzIngestSession(options)` returns a mutable session:
   - `acceptSceneJson(jsonOrObject)`
   - `acceptArchiveChunk(bytes)`
   - `acceptAsset(path, blobOrBytes)`
   - `finalize()`
2. Runtime mapping store:
   - key by stable `threeJsonId` + material slot / model descriptor path
   - delayed assets trigger targeted rebinding
3. Backpressure:
   - queue size caps
   - `onDrain` callback for producers

## Protocol sketch

- `sessionStart` -> returns `sessionId`
- `scenePayload` (required first)
- `assetChunk` repeated
- `assetReady` (path complete)
- `finalize`

## Risk points

- Rebinding external models can invalidate child UUID references.
- Texture hot-swap needs consistent disposal to avoid GPU leaks.
- Audio node replacement must preserve playback policy and mute state.

## Milestones

1. PoC: texture-only delayed patch
2. Beta: texture + audio
3. Stable: texture + audio + external model with retry and rollback
