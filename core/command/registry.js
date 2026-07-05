import { CORE_COMMAND_HANDLERS } from "./commands/index.js";
import { CORE_COMMAND_SPECS, getCoreCommandSpecs } from "./specs.js";
import { COMMAND_API_VERSION } from "./types.js";

/**
 * @typedef {object} RegisteredCommand
 * @property {import("./commands/index.js").CommandHandler} handler
 * @property {import("./types.js").CommandSpec | null} spec
 */

/**
 * @typedef {object} CommandRegistry
 * @property {(op: string, handler: import("./commands/index.js").CommandHandler, spec?: import("./types.js").CommandSpec | null) => void} register
 * @property {(op: string) => import("./commands/index.js").CommandHandler | null} getHandler
 * @property {(op: string) => boolean} has
 * @property {(namespace?: string) => string[]} listOps
 * @property {(namespace?: string) => import("./types.js").CommandSpec[]} listSpecs
 */

/**
 * @param {Record<string, import("./commands/index.js").CommandHandler>} [seedHandlers]
 * @param {import("./types.js").CommandSpec[]} [seedSpecs]
 * @returns {CommandRegistry}
 */
export function createCommandRegistry(seedHandlers = CORE_COMMAND_HANDLERS, seedSpecs = CORE_COMMAND_SPECS) {
  /** @type {Map<string, RegisteredCommand>} */
  const commands = new Map();

  for (const spec of seedSpecs) {
    const handler = seedHandlers[spec.op];
    if (typeof handler === "function") {
      commands.set(spec.op, { handler, spec });
    }
  }
  for (const [op, handler] of Object.entries(seedHandlers)) {
    if (!commands.has(op) && typeof handler === "function") {
      commands.set(op, { handler, spec: null });
    }
  }

  return {
    register(op, handler, spec = null) {
      const key = String(op ?? "").trim();
      if (!key) {
        throw new Error("register requires non-empty op.");
      }
      if (typeof handler !== "function") {
        throw new Error(`register("${key}") requires a handler function.`);
      }
      commands.set(key, { handler, spec: spec || null });
    },
    getHandler(op) {
      const entry = commands.get(String(op ?? "").trim());
      return entry?.handler ?? null;
    },
    has(op) {
      return commands.has(String(op ?? "").trim());
    },
    listOps(namespace) {
      const prefix = namespace ? `${String(namespace).trim()}.` : "";
      return [...commands.keys()].filter((op) => (prefix ? op.startsWith(prefix) : true)).sort();
    },
    listSpecs(namespace) {
      const prefix = namespace ? `${String(namespace).trim()}.` : "";
      const specs = [];
      for (const entry of commands.values()) {
        if (!entry.spec) {
          continue;
        }
        if (!prefix || entry.spec.op.startsWith(prefix)) {
          specs.push(entry.spec);
        }
      }
      return specs.sort((a, b) => a.op.localeCompare(b.op));
    }
  };
}

/**
 * @param {CommandRegistry} registry
 * @param {string} [namespace]
 * @returns {string}
 */
export function getCommandHelp(registry, namespace) {
  const specs = registry.listSpecs(namespace);
  if (specs.length === 0) {
    const ops = registry.listOps(namespace);
    return ops.length ? ops.join("\n") : "No commands registered.";
  }
  const header =
    "Input formats: JSONL ({\"op\",\"args\"}) or micro DSL (object.patch id=x partial={...}). Lines may mix.\n";
  const body = specs
    .map((spec) => {
      const argLines = Object.entries(spec.args)
        .map(([name, desc]) => `  - ${name}: ${desc}`)
        .join("\n");
      const example = spec.microDslExample
        ? `\n  e.g. ${spec.microDslExample}`
        : spec.example
          ? `\n  e.g. ${JSON.stringify(spec.example)}`
          : "";
      return `${spec.op} [${spec.mode}]\n  ${spec.summary}${argLines ? `\n${argLines}` : ""}${example}`;
    })
    .join("\n\n");
  return header + body;
}

/**
 * @param {CommandRegistry} [registry]
 * @param {string} [namespace]
 * @returns {{ v: number, commands: import("./types.js").CommandSpec[] }}
 */
export function getCommandSpec(registry, namespace) {
  const resolved = registry || createCommandRegistry();
  const commands = resolved.listSpecs(namespace);
  const fallbackSpecs = namespace ? getCoreCommandSpecs(namespace) : getCoreCommandSpecs();
  return {
    v: COMMAND_API_VERSION,
    commands: commands.length > 0 ? commands : fallbackSpecs
  };
}
