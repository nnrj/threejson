/**
 * @typedef {object} EditorApi
 * @property {() => import("../../../../core/command/types.js").CommandContext} getCommandContext
 * @property {(payload: object, options?: { label?: string, historyReplay?: boolean, skipRuntimeResolve?: boolean }) => Promise<{ ok: boolean, error?: string | null }>} ingest
 * @property {() => string | null} getSelection
 * @property {(id: string | null) => { ok: boolean, error?: string | null }} setSelection
 * @property {() => Promise<{ ok: boolean }>} undo
 * @property {() => Promise<{ ok: boolean }>} redo
 * @property {(target?: "selection" | "scene") => { ok: boolean }} fitView
 * @property {(input: string | object | object[], options?: { label?: string }) => Promise<{ ok: boolean, results: import("../../../../core/command/types.js").CommandResult[] }>} execCoreCommands
 * @property {(input: object, options?: object) => Promise<object>} [runAgent]
 */

export {};
