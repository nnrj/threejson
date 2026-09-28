import { CORE_COMMAND_SPECS } from "./specs.js";
import { withCommandContract } from "./contracts.js";
import { cloneDocumentData, freezeDocumentData, documentError } from "../document/sceneDocument.js";

/** Data contracts and pure transaction planners; no imperative runtime handler imports. */
export function createSceneOperationRegistry() {
  const entries = new Map(CORE_COMMAND_SPECS.map((spec) => [spec.op, { spec: freezeDocumentData(cloneDocumentData(spec)) }]));
  return {
    getSpec(op) { return entries.get(op)?.spec || null; },
    getPreparation(op) { return entries.get(op)?.prepare || null; },
    listSpecs() { return [...entries.values()].map(({ spec }) => spec); },
    register(spec, prepare) {
      if (!spec?.op || typeof prepare !== "function" || !spec.inputSchema) throw documentError("INVALID_COMMAND_CONTRACT", "Custom operations require an op, inputSchema and pure prepare function.");
      if (entries.has(spec.op)) throw documentError("COMMAND_ALREADY_REGISTERED", `Command already registered: ${spec.op}.`);
      if (spec.category === "runtime") throw documentError("NON_TRANSACTIONAL_COMMAND", "Register transient actions through a runtime adapter, not as authoring transactions.");
      const entry = { spec: freezeDocumentData(cloneDocumentData(withCommandContract(spec))), prepare };
      entries.set(spec.op, entry);
      return () => { if (entries.get(spec.op) === entry) entries.delete(spec.op); };
    }
  };
}

export const defaultSceneOperationRegistry = createSceneOperationRegistry();
