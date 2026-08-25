import { createCurveFromDescriptor } from "../builder/curve/curveFactory.js";

/** Backward-compatible function name; semantics now come from the shared curve factory. */
export function buildCurveFromPathDef(pathDef, THREE) {
  return createCurveFromDescriptor(pathDef, THREE);
}
