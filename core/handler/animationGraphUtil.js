/**
 * Pure animationGraph parsing and condition evaluation (no THREE dependency; easy to unit-test).
 */

/**
 * @param {object|null|undefined} descriptor
 * @returns {object|null}
 */
export function resolveAnimationGraph(descriptor) {
  const graph = descriptor?.animationGraph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return null;
  }
  if (!graph.states || typeof graph.states !== "object" || Array.isArray(graph.states)) {
    return null;
  }
  const defaultState =
    typeof graph.defaultState === "string" && graph.defaultState.trim()
      ? graph.defaultState.trim()
      : Object.keys(graph.states)[0] ?? "";
  if (!defaultState || !graph.states[defaultState]) {
    return null;
  }
  return graph;
}

/**
 * @param {object|null|undefined} graph
 * @returns {Record<string, boolean|number>}
 */
export function buildAnimationParameterDefaults(graph) {
  const out = {};
  const params = graph?.parameters;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return out;
  }
  for (const key of Object.keys(params)) {
    const spec = params[key];
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      continue;
    }
    const type = typeof spec.type === "string" ? spec.type.trim().toLowerCase() : "float";
    if (type === "bool" || type === "boolean") {
      out[key] = Boolean(spec.default);
    } else {
      const n = Number(spec.default);
      out[key] = Number.isFinite(n) ? n : 0;
    }
  }
  return out;
}

/**
 * @param {string} currentState
 * @param {string|undefined|null} from
 * @returns {boolean}
 */
export function transitionMatchesFrom(currentState, from) {
  const raw = typeof from === "string" ? from.trim() : "";
  if (!raw || raw === "*") {
    return true;
  }
  return raw === currentState;
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @returns {boolean}
 */
function valuesEqual(actual, expected) {
  if (typeof expected === "boolean" || typeof actual === "boolean") {
    return Boolean(actual) === Boolean(expected);
  }
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return a === b;
  }
  return actual === expected;
}

/**
 * @param {object} when
 * @param {Record<string, boolean|number>} parameters
 * @param {Set<string>} pendingEvents
 * @returns {boolean}
 */
export function evaluateAnimationWhen(when, parameters, pendingEvents) {
  if (!when || typeof when !== "object" || Array.isArray(when)) {
    return false;
  }

  if (typeof when.event === "string" && when.event.trim()) {
    return pendingEvents.has(when.event.trim());
  }

  const paramName = typeof when.param === "string" ? when.param.trim() : "";
  if (!paramName) {
    return false;
  }
  const value = parameters[paramName];

  if (Object.prototype.hasOwnProperty.call(when, "eq")) {
    return valuesEqual(value, when.eq);
  }
  if (Object.prototype.hasOwnProperty.call(when, "ne")) {
    return !valuesEqual(value, when.ne);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(when, "gt")) {
    return n > Number(when.gt);
  }
  if (Object.prototype.hasOwnProperty.call(when, "gte")) {
    return n >= Number(when.gte);
  }
  if (Object.prototype.hasOwnProperty.call(when, "lt")) {
    return n < Number(when.lt);
  }
  if (Object.prototype.hasOwnProperty.call(when, "lte")) {
    return n <= Number(when.lte);
  }
  return false;
}

/**
 * @param {string} currentState
 * @param {object} graph
 * @param {Record<string, boolean|number>} parameters
 * @param {Set<string>} pendingEvents
 * @returns {{ to: string, crossFade: number }|null}
 */
export function pickAnimationTransition(currentState, graph, parameters, pendingEvents) {
  const transitions = Array.isArray(graph?.transitions) ? graph.transitions : [];
  for (let i = 0; i < transitions.length; i += 1) {
    const tr = transitions[i];
    if (!tr || typeof tr !== "object") {
      continue;
    }
    const to = typeof tr.to === "string" ? tr.to.trim() : "";
    if (!to || to === currentState || !graph.states?.[to]) {
      continue;
    }
    if (!transitionMatchesFrom(currentState, tr.from)) {
      continue;
    }
    if (!evaluateAnimationWhen(tr.when, parameters, pendingEvents)) {
      continue;
    }
    const crossFade = Number(tr.crossFade);
    return {
      to,
      crossFade: Number.isFinite(crossFade) && crossFade >= 0 ? crossFade : 0.2
    };
  }
  return null;
}
