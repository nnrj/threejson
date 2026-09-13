import { cloneDocumentData, documentError, indexSceneDocument, isSceneDocument } from "./sceneDocument.js";

const units = Object.freeze({
  m: [1, "length"], cm: [0.01, "length"], mm: [0.001, "length"], km: [1000, "length"],
  in: [0.0254, "length"], ft: [0.3048, "length"], rad: [1, "angle"], deg: [Math.PI / 180, "angle"],
  s: [1, "time"], ms: [0.001, "time"]
});
const scalar = (value, dimension = "scalar") => {
  if (!Number.isFinite(value)) throw documentError("DESIGN_NON_FINITE", "Design expressions must produce finite numbers.");
  return { value, dimension };
};

function productDimension(a, b, factor = 1) {
  const powers = new Map();
  for (const [dimension, multiplier] of [[a, 1], [b, factor]]) {
    if (dimension === "scalar") continue;
    for (const term of dimension.split("*")) {
      const [name, exponent = "1"] = term.split("^");
      powers.set(name, (powers.get(name) || 0) + Number(exponent) * multiplier);
    }
  }
  return [...powers].filter(([, power]) => power !== 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, power]) => power === 1 ? name : `${name}^${power}`).join("*") || "scalar";
}

/** Topological order is deterministic; cycles and missing dependencies are errors, not fallbacks. */
export function orderSceneDependencies(dependencies) {
  const pending = new Map(), dependents = new Map(), queue = [], ordered = [];
  for (const [id, refs] of dependencies) {
    const unique = new Set(refs); pending.set(id, unique.size);
    for (const ref of unique) {
      if (!dependencies.has(ref)) throw documentError("DESIGN_REFERENCE_MISSING", `Missing design dependency: ${ref}.`, { id, reference: ref });
      if (!dependents.has(ref)) dependents.set(ref, []);
      dependents.get(ref).push(id);
    }
    if (!unique.size) queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; ordered.push(id);
    for (const next of dependents.get(id) || []) {
      pending.set(next, pending.get(next) - 1);
      if (pending.get(next) === 0) queue.push(next);
    }
  }
  if (ordered.length !== dependencies.size) throw documentError("DESIGN_DEPENDENCY_CYCLE", "Cyclic design dependencies.", { ids: [...pending].filter(([, count]) => count > 0).map(([id]) => id) });
  return ordered;
}

function expressionReferences(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (typeof value.param === "string") result.add(value.param);
  for (const item of Object.values(value)) expressionReferences(item, result);
  return result;
}

/** Static relation validation is shared by authoring/AI and runtime preparation. */
export function planSceneDesignRelations(payload, relations = payload.design?.relations || []) {
  if (!Array.isArray(relations)) throw documentError("DESIGN_SCHEMA_INVALID", "Design relations must be an array.");
  const index = indexSceneDocument(payload), bySource = new Map();
  const dependencies = new Map([...index].map(([id, entry]) => [id, new Set(entry.parentId ? [entry.parentId] : [])]));
  for (const relation of relations) {
    if (!relation || !["attach", "lookAt"].includes(relation.type)) throw documentError("DESIGN_RELATION_UNSUPPORTED", `Unsupported relation: ${relation?.type}.`);
    if (!index.has(relation.object) || !index.has(relation.target)) throw documentError("DESIGN_REFERENCE_MISSING", `Missing relation object/target: ${relation.object}/${relation.target}.`);
    // A static relation has one transform owner. Two independent orientation /
    // attachment equations require an iterative solver; do not pretend order is a solver.
    if (bySource.has(relation.object)) throw documentError("DESIGN_RELATION_CONFLICT", `Multiple transform relations for ${relation.object}; combine attachment with orientation:target, or use a parent assembly.`);
    if (relation.orientation != null && !["target", "preserve"].includes(relation.orientation)) throw documentError("DESIGN_ORIENTATION_INVALID", `Unknown orientation: ${relation.orientation}.`);
    if (relation.offsetSpace != null && !["world", "target"].includes(relation.offsetSpace)) throw documentError("DESIGN_SPACE_INVALID", `Unknown offsetSpace: ${relation.offsetSpace}.`);
    bySource.set(relation.object, [relation]);
    dependencies.get(relation.object).add(relation.target);
  }
  const isDescendant = (child, ancestor) => {
    let parent = index.get(child)?.parentId;
    while (parent) { if (parent === ancestor) return true; parent = index.get(parent)?.parentId; }
    return false;
  };
  const bounded = (anchor, record) => typeof anchor === "string" && anchor !== "origin" && !record.anchors?.[anchor];
  for (const relation of relations) {
    // A computed bounding anchor includes descendants. Wait for any constrained
    // descendants, and diagnose self-referential bounds rather than drifting.
    for (const id of bySource.keys()) {
      if (bounded(relation.targetAnchor, index.get(relation.target).record) && isDescendant(id, relation.target)) dependencies.get(relation.object).add(id);
      if (bounded(relation.anchor, index.get(relation.object).record) && isDescendant(id, relation.object)) dependencies.get(relation.object).add(id);
    }
  }
  return { index, bySource, order: orderSceneDependencies(dependencies) };
}

function pointerParts(path) {
  if (typeof path !== "string" || !/^\/(?!$)/.test(path) || /~(?![01])/u.test(path)) throw documentError("DESIGN_BINDING_PATH", `Invalid binding pointer: ${path}.`);
  const parts = path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some((part) => ["__proto__", "constructor", "prototype"].includes(part)) || ["threeJsonId", "objType", "domain", "subScene", "levels"].includes(parts[0])) {
    throw documentError("DESIGN_BINDING_PATH", "Bindings cannot change object identity or hierarchy.");
  }
  return parts;
}

function writeBoundField(record, path, value, remove = false) {
  const parts = pointerParts(path); let current = record;
  for (const part of parts.slice(0, -1)) {
    if (current[part] == null && !remove) current[part] = {};
    if (!current[part] || typeof current[part] !== "object") {
      if (remove) return;
      throw documentError("DESIGN_BINDING_PATH", `Binding crosses a non-object: ${path}.`);
    }
    current = current[part];
  }
  const key = parts.at(-1);
  if (Array.isArray(current) && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) throw documentError("DESIGN_BINDING_PATH", `Binding array index does not exist: ${path}.`);
  if (remove) delete current[key]; else current[key] = value;
}

/** Optional authoring design layer. Bare legacy numbers are never rescaled. Units
 * apply to explicit quantities in design expressions; output angles are radians. */
export function evaluateSceneDesign(input) {
  const source = isSceneDocument(input) ? input.root : input;
  const design = source?.design;
  if (!design) return { payload: source, parameters: {}, bindings: [], relations: [] };
  if (typeof design !== "object" || Array.isArray(design) || (design.parameters != null && (typeof design.parameters !== "object" || Array.isArray(design.parameters)))) throw documentError("DESIGN_SCHEMA_INVALID", "Design and parameters must be objects.");
  if (design.version != null && design.version !== 1) throw documentError("DESIGN_VERSION_UNSUPPORTED", `Unsupported design version: ${design.version}.`);
  const lengthUnit = design.units?.length || "m";
  if (units[lengthUnit]?.[1] !== "length") throw documentError("DESIGN_UNIT_UNSUPPORTED", `Invalid scene length unit: ${lengthUnit}.`);
  const values = new Map(), definitions = design.parameters || {};
  const evaluate = (expression) => {
    if (typeof expression === "number") return scalar(expression);
    if (!expression || typeof expression !== "object" || Array.isArray(expression)) throw documentError("DESIGN_EXPRESSION_INVALID", "Expected a numeric expression.");
    if (expression.expr !== undefined) return evaluate(expression.expr);
    if (typeof expression.param === "string") {
      const value = values.get(expression.param);
      if (!value) throw documentError("DESIGN_REFERENCE_MISSING", `Unknown parameter: ${expression.param}.`);
      return value;
    }
    if (typeof expression.unit === "string") {
      const unit = units[expression.unit];
      if (!unit) throw documentError("DESIGN_UNIT_UNSUPPORTED", `Unsupported unit: ${expression.unit}.`);
      if (typeof expression.value !== "number") throw documentError("DESIGN_EXPRESSION_INVALID", "A quantity requires a numeric value.");
      return scalar(expression.value * unit[0] / (unit[1] === "length" ? units[lengthUnit][0] : 1), unit[1]);
    }
    if (typeof expression.value === "number" && expression.op == null) return scalar(expression.value);
    if (expression.args != null && !Array.isArray(expression.args)) throw documentError("DESIGN_EXPRESSION_INVALID", "Expression args must be an array.");
    const args = (expression.args || []).map(evaluate), numbers = args.map((arg) => arg.value);
    const op = expression.op;
    const required = { add: 2, sub: 2, mul: 2, div: 2, pow: 2, sqrt: 1, min: 2, max: 2, clamp: 3, abs: 1, neg: 1, sin: 1, cos: 1 }[op];
    if (!required || args.length !== required) throw documentError("DESIGN_EXPRESSION_INVALID", `Unsupported operation or arity: ${op}.`);
    const sameUnits = () => {
      if (!args.every((arg) => arg.dimension === args[0].dimension)) throw documentError("DESIGN_UNIT_MISMATCH", `Incompatible units for ${op}.`);
      return args[0].dimension;
    };
    if (op === "add" || op === "sub") return scalar(op === "add" ? numbers[0] + numbers[1] : numbers[0] - numbers[1], sameUnits());
    if (op === "min" || op === "max") return scalar(Math[op](...numbers), sameUnits());
    if (op === "clamp") { const dimension = sameUnits(); if (numbers[1] > numbers[2]) throw documentError("DESIGN_EXPRESSION_INVALID", "Clamp minimum exceeds maximum."); return scalar(Math.max(numbers[1], Math.min(numbers[2], numbers[0])), dimension); }
    if (op === "abs" || op === "neg") return scalar(op === "abs" ? Math.abs(numbers[0]) : -numbers[0], args[0].dimension);
    if (op === "sin" || op === "cos") {
      if (!["angle", "scalar"].includes(args[0].dimension)) throw documentError("DESIGN_UNIT_MISMATCH", "Trigonometry expects an angle.");
      return scalar(Math[op](numbers[0]));
    }
    if (op === "mul") {
      return scalar(numbers[0] * numbers[1], productDimension(args[0].dimension, args[1].dimension));
    }
    if (op === "sqrt" || op === "pow") {
      if (op === "pow" && args[1].dimension !== "scalar") throw documentError("DESIGN_UNIT_MISMATCH", "An exponent must be dimensionless.");
      const exponent = op === "sqrt" ? 0.5 : numbers[1];
      return scalar(numbers[0] ** exponent, productDimension("scalar", args[0].dimension, exponent));
    }
    return scalar(numbers[0] / numbers[1], productDimension(args[0].dimension, args[1].dimension, -1));
  };
  const dependencies = new Map(Object.entries(definitions).map(([id, expression]) => [id, expressionReferences(expression)]));
  for (const id of orderSceneDependencies(dependencies)) values.set(id, evaluate(definitions[id]));
  const valueOf = (value) => Array.isArray(value) ? value.map(valueOf) : evaluate(value).value;
  const payload = cloneDocumentData(source), index = indexSceneDocument(payload);
  const bindings = design.bindings || [], boundPaths = new Set();
  if (!Array.isArray(bindings) || !Array.isArray(design.relations || [])) throw documentError("DESIGN_SCHEMA_INVALID", "Design bindings and relations must be arrays.");
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object") throw documentError("DESIGN_BINDING_PATH", "A binding requires an object and path.");
    const target = index.get(binding.object);
    if (!target) throw documentError("DESIGN_REFERENCE_MISSING", `Binding object missing: ${binding.object}.`);
    const key = `${binding.object}:${binding.path}`;
    if ([...boundPaths].some((other) => other === key || other.startsWith(`${key}/`) || key.startsWith(`${other}/`))) throw documentError("DESIGN_BINDING_CONFLICT", `Overlapping design bindings: ${key}.`);
    boundPaths.add(key); writeBoundField(target.record, binding.path, valueOf(binding.value));
  }
  const relations = (design.relations || []).map((relation) => {
    if (!relation || typeof relation !== "object") throw documentError("DESIGN_SCHEMA_INVALID", "A relation must be an object.");
    return { ...cloneDocumentData(relation), ...(relation.offset ? { offset: valueOf(relation.offset) } : {}) };
  });
  planSceneDesignRelations(payload, relations);
  return { payload, bindings, relations, parameters: Object.fromEntries([...values].map(([id, value]) => [id, { ...value }])) };
}

/** Keep calculated binding values out of an authoring save. Baking is explicit. */
export function restoreSceneDesignAuthoring(payload, source) {
  if (!source?.design) return payload;
  const before = indexSceneDocument(source), after = indexSceneDocument(payload);
  for (const binding of source.design.bindings || []) {
    const original = before.get(binding.object)?.record, output = after.get(binding.object)?.record;
    if (!original || !output) continue;
    let value = original;
    for (const part of pointerParts(binding.path)) value = value?.[part];
    writeBoundField(output, binding.path, value === undefined ? undefined : cloneDocumentData(value), value === undefined);
  }
  for (const relation of source.design.relations || []) {
    const original = before.get(relation.object)?.record, output = after.get(relation.object)?.record;
    if (!original || !output) continue;
    const fields = relation.type === "attach" ? ["position"] : [];
    if (relation.type === "lookAt" || relation.orientation === "target") fields.push("rotation", "quaternion");
    for (const field of fields) {
      if (original[field] === undefined) delete output[field];
      else output[field] = cloneDocumentData(original[field]);
    }
  }
  payload.design = cloneDocumentData(source.design);
  return payload;
}
