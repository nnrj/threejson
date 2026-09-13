import { compileAuthoring, formatAuthoring } from "./document/authoringAdapters.js";
import { SceneSession } from "./document/sceneSession.js";

export { SceneSession };
export { executeSceneSessionCommands, planSceneCommands, diffSceneDocuments } from "./document/sceneCommandPlan.js";
export function createSceneSession(payload, options = {}) {
  return new SceneSession(compileAuthoring(payload, options), options);
}
export function captureSceneSession(session, options = {}) {
  return formatAuthoring(session.document, options);
}

/** Opt-in transactional runtime; importing this entry never starts a renderer. */
export async function createRuntimeSceneSession(payload, options = {}) {
  const { createSceneSessionRuntimeDriver } = await import("./runtime/sceneSessionDriver.js");
  const driver = createSceneSessionRuntimeDriver(options);
  const session = createSceneSession(payload, { ...options, driver });
  Object.defineProperty(session, "runtime", { get: () => driver.runtime });
  Object.defineProperty(session, "commandOptions", { value: options.commandOptions || {} });
  Object.defineProperty(session, "suspendRuntime", { value: () => driver.suspend() });
  try { if (!options.initialRuntime && !options.deferInitial) await session.prepare({ signal: options.signal }); }
  catch (error) { session.dispose(); throw error; }
  return session;
}
