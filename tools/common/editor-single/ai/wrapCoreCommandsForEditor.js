import { COMMAND_API_VERSION } from "../../../../core/command/types.js";

/**
 * Wrap parsed core commands as a single editor.exec command for the editor registry.
 * @param {import("../../../../core/command/types.js").ParsedCommand[] | import("../../../../core/command/types.js").ParsedCommand} commands
 * @param {string} [label]
 * @returns {import("../../../../core/command/types.js").ParsedCommand}
 */
export function wrapAsEditorExec(commands, label = "AI 调整") {
  const list = Array.isArray(commands) ? commands : [commands];
  return {
    v: COMMAND_API_VERSION,
    op: "editor.exec",
    args: {
      commands: list,
      label: typeof label === "string" ? label : "AI 调整"
    }
  };
}

/**
 * @param {import("../../../../core/command/types.js").ParsedCommand[] | import("../../../../core/command/types.js").ParsedCommand} commands
 * @param {string} [label]
 * @returns {string}
 */
export function wrapAsEditorExecScript(commands, label = "AI 调整") {
  return JSON.stringify(wrapAsEditorExec(commands, label));
}
