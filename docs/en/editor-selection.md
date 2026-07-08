[中文](../zh/editor-selection.md) | [English](./editor-selection.md)

# Editor Selection: Box Edges And Highlights

This document defines the shared selection convention used by the editor and integrated pages.

## Terms

- Box edge: `THREE.BoxHelper`, used by the editor for direct editing selection.
- Highlight: post-processing `OutlinePass` from `domains/sceneHighlight`.

Highlight channels:

- `info`: white, single informational selection.
- `locate`: yellow, locate or handled alarm selection.
- `alarm`: red, alarm selection.

## Layer Responsibilities

1. Core provides generic runtime utilities and does not know business fields.
2. The `sceneHighlight` domain creates and deploys OutlinePass runtime bundles.
3. Pages decide business routing, such as which highlight channel to use for a device type.

## Editor Rules

1. Post-processing highlight is for visual state and does not replace the editor BoxHelper.
2. The `info` channel is single-selection and overwrites the previous info highlight.
3. `locate` and `alarm` are additive channels.
4. Integrated pages should clear only the relevant channel when clearing views.
5. The editor should clear highlight state and hide BoxHelper when exiting edit mode.
6. Business enums and field checks stay in page or domain code, not in core.
