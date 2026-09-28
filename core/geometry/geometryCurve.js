import { Vector3, Curve, CurvePath, LineCurve3, EllipseCurve, QuadraticBezierCurve3, CubicBezierCurve3, CatmullRomCurve3 } from "three";
import { createCurveFromDescriptor } from "../builder/curve/curveFactory.js";

// Pass only the constructors used by the injectable curve factory. Passing the entire Three.js
// namespace prevents tree-shaking and unnecessarily bundles WebGLRenderer into geometry workers.
const constructors = { Vector3, Curve, CurvePath, LineCurve3, EllipseCurve, QuadraticBezierCurve3, CubicBezierCurve3, CatmullRomCurve3 };
export function createGeometryCurve(descriptor) { return createCurveFromDescriptor(descriptor, constructors); }
