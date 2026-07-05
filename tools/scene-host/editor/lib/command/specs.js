import { COMMAND_API_VERSION } from "../../../../../core/command/types.js";

/** @type {import("../../../core/command/types.js").CommandSpec[]} */
export const EDITOR_COMMAND_SPECS = [
  {
    op: "editor.exec",
    mode: "runtime",
    summary: "Execute core commands with editor history and UI refresh (preferred AI entry in editor).",
    args: {
      commands: "JSONL string, command array, or single {op,args}.",
      label: "History label."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "editor.exec",
      args: {
        label: "添加立方体",
        commands: [
          {
            op: "object.add",
            args: {
              descriptor: { objType: "box", name: "Cube1", geometry: { width: 1, height: 1, depth: 1 } }
            }
          }
        ]
      }
    },
    microDslExample:
      'editor.exec label=添加立方体 commands=[{"op":"object.add","args":{"descriptor":{"objType":"box","name":"Cube1","geometry":{"width":1,"height":1,"depth":1}}}}]'
  },
  {
    op: "editor.ingest",
    mode: "runtime",
    summary: "Full editor scene reload (history, sidebar, view preserve) — not raw scene.load.",
    args: {
      json: "Scene payload.",
      label: "Hint label for history/UI.",
      options: "ingestScenePayloadFromParsedJson options."
    },
    example: { v: COMMAND_API_VERSION, op: "editor.ingest", args: { label: "AI 场景", json: {} } }
  },
  {
    op: "editor.selection.get",
    mode: "runtime",
    summary: "Get current selected object threeJsonId.",
    args: {},
    example: { v: COMMAND_API_VERSION, op: "editor.selection.get", args: {} }
  },
  {
    op: "editor.selection.set",
    mode: "runtime",
    summary: "Select object by threeJsonId (null to clear).",
    args: { id: "threeJsonId or null." },
    example: { v: COMMAND_API_VERSION, op: "editor.selection.set", args: { id: "obj-1" } }
  },
  {
    op: "editor.history.undo",
    mode: "runtime",
    summary: "Undo last editor operation.",
    args: {},
    example: { v: COMMAND_API_VERSION, op: "editor.history.undo", args: {} }
  },
  {
    op: "editor.history.redo",
    mode: "runtime",
    summary: "Redo last undone operation.",
    args: {},
    example: { v: COMMAND_API_VERSION, op: "editor.history.redo", args: {} }
  },
  {
    op: "editor.view.fit",
    mode: "runtime",
    summary: "Fit camera to scene content bounds or current selection.",
    args: { target: '"scene" (default) or "selection" (requires selected object).' },
    example: { v: COMMAND_API_VERSION, op: "editor.view.fit", args: { target: "scene" } }
  },
  {
    op: "editor.agent.run",
    mode: "runtime",
    summary: "Run multi-step scene agent (generate/update/fromImage) via editor LLM client.",
    args: {
      input: "Agent input: { mode, prompt, currentSceneJsonString?, image? }.",
      options: "Optional agent/texture/transport options."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "editor.agent.run",
      args: {
        input: { mode: "generate", prompt: "A simple room with a table." }
      }
    }
  }
];
