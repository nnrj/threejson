/**
 * Helpers for binding payload inspection and execution ordering (§3.1.8).
 */

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry|null|undefined} binding
 * @returns {boolean}
 */
export function bindingHasScriptPayload(binding) {
  const payload = binding?.payload;
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (typeof payload.scriptText === "string" && payload.scriptText.length > 0) {
    return true;
  }
  const source = payload.scriptSource?.source;
  return typeof source === "string" && source.length > 0;
}

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry|null|undefined} binding
 * @returns {boolean}
 */
export function bindingHasRuntimeHandler(binding) {
  const payload = binding?.payload;
  return Boolean(payload && typeof payload === "object" && typeof payload.handler === "function");
}

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry|null|undefined} binding
 * @returns {boolean}
 */
export function bindingHasActionPayload(binding) {
  const payload = binding?.payload;
  return Boolean(payload && typeof payload === "object" && Array.isArray(payload.actions) && payload.actions.length > 0);
}

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry|null|undefined} binding
 * @returns {string|null}
 */
export function resolveBindingScriptText(binding) {
  const payload = binding?.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.scriptText === "string" && payload.scriptText.length > 0) {
    return payload.scriptText;
  }
  const source = payload.scriptSource?.source;
  return typeof source === "string" && source.length > 0 ? source : null;
}

/**
 * Domain trigger bindings run before action/script bindings on the same target/event.
 *
 * @param {import("./eventBindingRegistry.js").EventBindingEntry[]} bindings
 * @returns {{ domainBindings: import("./eventBindingRegistry.js").EventBindingEntry[], actionBindings: import("./eventBindingRegistry.js").EventBindingEntry[], scriptBindings: import("./eventBindingRegistry.js").EventBindingEntry[], handlerBindings: import("./eventBindingRegistry.js").EventBindingEntry[] }}
 */
export function partitionBindingsForExecution(bindings) {
  /** @type {import("./eventBindingRegistry.js").EventBindingEntry[]} */
  const domainBindings = [];
  /** @type {import("./eventBindingRegistry.js").EventBindingEntry[]} */
  const actionBindings = [];
  /** @type {import("./eventBindingRegistry.js").EventBindingEntry[]} */
  const scriptBindings = [];
  /** @type {import("./eventBindingRegistry.js").EventBindingEntry[]} */
  const handlerBindings = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const hasActions = bindingHasActionPayload(binding);
    const hasScript = bindingHasScriptPayload(binding);
    if (binding.executorKind === "domain" && !hasActions && !hasScript) {
      domainBindings.push(binding);
      continue;
    }
    if (hasActions) {
      actionBindings.push(binding);
    }
    if (hasScript) {
      scriptBindings.push(binding);
      continue;
    }
    if (bindingHasRuntimeHandler(binding)) {
      handlerBindings.push(binding);
      continue;
    }
    if (binding.executorKind === "core" && !bindingHasActionPayload(binding)) {
      scriptBindings.push(binding);
    }
  }

  return { domainBindings, actionBindings, scriptBindings, handlerBindings };
}
