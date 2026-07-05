import { parseCommandLine, parseCommandScript } from "./parser.js";
import { createCommandRegistry } from "./registry.js";
import {
  buildCommandResult,
  createCommandContext,
  resolveCommandMode,
  RUNTIME_OPS
} from "./types.js";

/** @type {ReturnType<typeof createCommandRegistry> | null} */
let defaultRegistry = null;

/**
 * @param {ReturnType<typeof createCommandRegistry>} [registry]
 * @returns {ReturnType<typeof createCommandRegistry>}
 */
function resolveRegistry(registry) {
  if (registry) {
    return registry;
  }
  if (!defaultRegistry) {
    defaultRegistry = createCommandRegistry();
  }
  return defaultRegistry;
}

/**
 * @param {import("./types.js").CommandContext} ctx
 * @param {string} op
 */
function assertRuntimeContext(ctx, op) {
  if (!RUNTIME_OPS.has(op)) {
    return null;
  }
  if (!ctx.scene?.isScene) {
    return buildCommandResult(op, {
      ok: false,
      mode: "runtime",
      error: `${op} requires ctx.scene. Use document-mode commands (e.g. scene.validate) or scene.load first.`
    });
  }
  return null;
}

/**
 * @param {import("./types.js").CommandContext} ctx
 * @param {string} op
 * @param {import("./types.js").CommandMode} mode
 * @param {string} [executeMode]
 * @returns {import("./types.js").CommandResult | null}
 */
function maybeSkipInAutoExecuteMode(ctx, op, mode, executeMode) {
  if (executeMode !== "auto" || mode !== "runtime" || op === "scene.load") {
    return null;
  }
  if (ctx.scene?.isScene) {
    return null;
  }
  return buildCommandResult(op, {
    ok: true,
    mode: "runtime",
    data: { skipped: true, reason: "no runtime context (auto mode)" },
    warnings: [`skipped ${op}: ctx.scene not available in auto executeMode`]
  });
}

/**
 * @param {import("./types.js").CommandContext} ctx
 * @param {import("./types.js").ParsedCommand} command
 * @param {{ registry?: ReturnType<typeof createCommandRegistry>, skipRuntimeGuard?: boolean, executeMode?: 'auto' | 'runtime' | 'document' }} [options]
 * @returns {Promise<import("./types.js").CommandResult>}
 */
export async function executeCommand(ctx, command, options = {}) {
  const registry = resolveRegistry(options.registry);
  const parsed = typeof command === "string" || Array.isArray(command)
    ? parseCommandLine(command)
    : command;
  const op = parsed.op;
  const mode = resolveCommandMode(op);
  const executeMode = options.executeMode || "runtime";
  const handler = registry.getHandler(op);
  if (!handler) {
    return buildCommandResult(op, {
      ok: false,
      mode,
      error: `unknown command "${op}".`
    });
  }
  const skipped = maybeSkipInAutoExecuteMode(ctx, op, mode, executeMode);
  if (skipped) {
    return skipped;
  }
  if (executeMode === "document" && mode === "runtime" && op !== "scene.load") {
    return buildCommandResult(op, {
      ok: false,
      mode: "runtime",
      error: `${op} is runtime-only; executeMode is document.`
    });
  }
  const sceneOptionalOps = new Set(["object.get"]);
  if (!options.skipRuntimeGuard && mode === "runtime" && op !== "scene.load" && !sceneOptionalOps.has(op)) {
    const guard = assertRuntimeContext(ctx, op);
    if (guard) {
      return guard;
    }
  }
  try {
    const raw = await handler(ctx, parsed.args || {});
    if (raw && typeof raw === "object" && typeof raw.ok === "boolean" && raw.op) {
      return raw;
    }
    return buildCommandResult(op, {
      ok: true,
      mode,
      data: raw && typeof raw === "object" ? raw : undefined
    });
  } catch (err) {
    return buildCommandResult(op, {
      ok: false,
      mode,
      error: String(err?.message || err)
    });
  }
}

/**
 * @param {import("./types.js").CommandContext} ctx
 * @param {string | import("./types.js").ParsedCommand[] | object} inputs
 * @param {{ registry?: ReturnType<typeof createCommandRegistry>, stopOnError?: boolean, executeMode?: 'auto' | 'runtime' | 'document', dryRun?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, dryRun?: boolean, results: import("./types.js").CommandResult[] }>}
 */
export async function executeCommands(ctx, inputs, options = {}) {
  /** @type {import("./types.js").ParsedCommand[]} */
  let commands;
  if (Array.isArray(inputs)) {
    commands = inputs.map((item) => parseCommandLine(item));
  } else if (inputs && typeof inputs === "object" && typeof inputs.op === "string") {
    commands = [parseCommandLine(inputs)];
  } else {
    commands = parseCommandScript(inputs);
  }
  const registry = resolveRegistry(options.registry);
  const executeMode = options.executeMode || "runtime";
  const results = [];
  for (let i = 0; i < commands.length; i += 1) {
    const parsed = commands[i];
    const op = parsed.op;
    const mode = resolveCommandMode(op);
    let result;
    if (options.dryRun === true) {
      const handler = registry.getHandler(op);
      if (!handler) {
        result = buildCommandResult(op, {
          ok: false,
          mode,
          error: `unknown command "${op}".`
        });
      } else {
        const skipped = maybeSkipInAutoExecuteMode(ctx, op, mode, executeMode);
        if (skipped) {
          result = skipped;
        } else if (executeMode === "document" && mode === "runtime" && op !== "scene.load") {
          result = buildCommandResult(op, {
            ok: false,
            mode: "runtime",
            error: `${op} is runtime-only; executeMode is document.`
          });
        } else {
          result = buildCommandResult(op, {
            ok: true,
            mode,
            data: { dryRun: true, args: parsed.args || {} }
          });
        }
      }
    } else {
      result = await executeCommand(ctx, parsed, {
        registry: options.registry,
        executeMode: options.executeMode
      });
    }
    results.push(result);
    if (!result.ok && options.stopOnError !== false) {
      return { ok: false, dryRun: options.dryRun === true, results };
    }
  }
  return {
    ok: results.every((item) => item.ok),
    dryRun: options.dryRun === true,
    results
  };
}

export { createCommandContext };
