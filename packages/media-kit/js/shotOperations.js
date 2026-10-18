import { defaultSceneOperationRegistry, validateCommandSchema } from "threejson/operations";

// Shot sessions own document transactions, not a live renderer or viewport.
// Derive contracts from the same registry used by their SceneOperation service.
const needsRuntime = spec => spec.category === "runtime" || (spec.requirements || []).some(key => ["runtime", "capture-adapter", "viewport", "action-contract"].includes(key));
const wrapperFor = spec => needsRuntime(spec) ? null : spec.category === "read" ? "media.shot.query" : "media.shot.edit";
const discovery = ops => ({ op: "media.shot.discover", args: ops ? { ops } : {} });

export function shotCommandsSchema(wrapper) {
  const specs = defaultSceneOperationRegistry.listSpecs().filter(spec => !needsRuntime(spec) && (wrapper !== "media.shot.query" || spec.category === "read"));
  return { type: "array", minItems: 1, description: 'Nested SceneOperations as {op,args}. Call media.shot.discover with ops:[name] for exact argument schemas. Do not put media.* or timeline.* commands here.',
    items: { type: "object", required: ["op"], properties: { op: { type: "string", enum: specs.map(spec => spec.op) }, args: { type: "object", additionalProperties: true } }, additionalProperties: false } };
}

export function discoverShotOperations(ops) {
  if (ops !== undefined && (!Array.isArray(ops) || !ops.length || ops.some(op => typeof op !== "string" || !op.trim()))) {
    throw Object.assign(new Error("media.shot.discover ops must be a nonempty array of operation names, or omitted for the index."), { code: "INVALID_COMMAND_ARGUMENTS" });
  }
  const catalog = defaultSceneOperationRegistry.listSpecs();
  return { kind: ops ? "contracts" : "index", runtime: false,
    commands: catalog.filter(spec => !ops || ops.includes(spec.op)).map(spec => ({
      ...(ops ? spec : { op: spec.op, category: spec.category, summary: spec.summary, required: spec.inputSchema.required || [] }),
      wrapper: wrapperFor(spec), available: !needsRuntime(spec)
    })),
    unknownOperations: ops?.filter(op => !catalog.some(spec => spec.op === op)) || [],
    guidance: "Request exact schemas with ops:[name]. Use media.shot.query for reads and media.shot.edit for document edits. Nested commands use {op,args}, not JSON Patch records. Runtime captures use media.captureFrames with composition times. Buffer drafts must be committed within the same edit batch." };
}

export function shotOperationError(error, { id, wrapper, command, index } = {}) {
  const operation = command?.op, spec = defaultSceneOperationRegistry.getSpec(operation);
  const code = error.code || "MEDIA_SCENE_OPERATION_FAILED";
  const path = error.path || (Number.isInteger(index) ? `args.commands[${index}]` : "args.commands");
  const message = `Shot ${JSON.stringify(id)}, ${wrapper}${operation ? ` > ${operation}` : ""}: ${error.message}`;
  const recovery = {
    message: "The failed operation was not committed. Inspect the shot and correct this command using its actual contract; preserve other shots and existing audio.",
    discovery: discovery(spec ? [operation] : undefined),
    ...(spec ? { expectedWrapper: wrapperFor(spec), inputSchema: spec.inputSchema } : {})
  };
  if (code === "UNKNOWN_SCENE_OPERATION") recovery.message = "Unknown nested operation, not a read/write permission error. Discover valid names; use scene.query or object.get for objects, media.shot.inspect for a shot, and timeline.inspect at the media level for timing. Do not repeat the unknown name.";
  if (code === "MEDIA_QUERY_READ_ONLY") recovery.message = "This is a document edit sent to a read-only query. No edit was applied. If the edit is intended, submit it explicitly through media.shot.edit in a separate authoring response; otherwise choose a read operation.";
  if (code === "MEDIA_SHOT_RUNTIME_UNAVAILABLE") recovery.message = "Nested shot sessions have no live runtime. Use authored/evaluated queries for document data, media.validate for project structure, or media.captureFrames for actual output. Do not request camera.fit or live runtime actions here.";
  return Object.assign(new Error(message), { code, path, shotId: id, operation, commandIndex: index, recovery });
}

export function assertShotCommands(commands, wrapper, id) {
  if (!Array.isArray(commands) || !commands.length) throw shotOperationError({ code: "INVALID_COMMAND_ARGUMENTS", message: "commands must be a nonempty array of {op,args}." }, { id, wrapper });
  for (const [index, command] of commands.entries()) {
    try {
      if (!command || typeof command !== "object" || Array.isArray(command) || typeof command.op !== "string" || !command.op.trim()) {
        throw Object.assign(new Error("Expected a nested {op,args} operation with a nonempty op name."), { code: "INVALID_COMMAND_ARGUMENTS" });
      }
      const spec = defaultSceneOperationRegistry.getSpec(command.op);
      if (!spec) throw Object.assign(new Error(`Unknown scene operation: ${command.op}.`), { code: "UNKNOWN_SCENE_OPERATION" });
      if (needsRuntime(spec) || command.args?.state === "runtime") throw Object.assign(new Error(`${command.op} requires a live runtime, unavailable in a document-only shot session.`), { code: "MEDIA_SHOT_RUNTIME_UNAVAILABLE" });
      if (wrapper === "media.shot.query" && spec.category !== "read") throw Object.assign(new Error(`${command.op} is ${spec.category}, not read-only.`), { code: "MEDIA_QUERY_READ_ONLY" });
      validateCommandSchema(command.args ?? {}, spec.inputSchema, `args.commands[${index}].args`);
    } catch (error) { throw shotOperationError(error, { id, wrapper, command, index }); }
  }
}

/** Preserve the failing child command instead of replacing its error with a generic wrapper error. */
export function assertShotReceipt(receipt, commands, wrapper, id) {
  if (receipt.ok) return;
  const failed = receipt.results?.findIndex(result => !result.ok) ?? -1;
  const index = failed >= 0 ? failed : commands.length === 1 ? 0 : undefined;
  throw shotOperationError({ code: receipt.code, message: receipt.error || "Scene operation failed." }, { id, wrapper, command: commands[index], index });
}
