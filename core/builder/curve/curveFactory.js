function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point3(value, THREE) {
  if (Array.isArray(value)) return new THREE.Vector3(finite(value[0]), finite(value[1]), finite(value[2]));
  return new THREE.Vector3(finite(value?.x), finite(value?.y), finite(value?.z));
}

function normalizeType(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]/g, "") : "";
}

function pointsFrom(definition, THREE) {
  const raw = Array.isArray(definition?.points) ? definition.points : [];
  return raw.map((entry) => point3(entry, THREE));
}

export class CurveDescriptorError extends Error {
  constructor(message, code = "E_CURVE_DESCRIPTOR_INVALID", details = {}) {
    super(message);
    this.name = "CurveDescriptorError";
    this.code = code;
    Object.assign(this, details);
  }
}

function requirePoints(points, count, type) {
  if (points.length >= count) return points;
  throw new CurveDescriptorError(`${type} requires at least ${count} points`, "E_CURVE_POINTS_REQUIRED", {
    curveType: type,
    required: count,
    actual: points.length
  });
}

function linePath(points, THREE) {
  if (points.length < 2) return null;
  if (points.length === 2) return new THREE.LineCurve3(points[0], points[1]);
  const path = new THREE.CurvePath();
  for (let index = 1; index < points.length; index++) {
    path.add(new THREE.LineCurve3(points[index - 1], points[index]));
  }
  return path;
}

function ellipseCurve3(definition, THREE) {
  const center = point3(definition.center ?? definition.position, THREE);
  const ellipse = new THREE.EllipseCurve(
    0,
    0,
    Math.max(0, finite(definition.xRadius ?? definition.radiusX ?? definition.radius, 1)),
    Math.max(0, finite(definition.yRadius ?? definition.radiusY ?? definition.radius, 1)),
    finite(definition.startAngle, 0),
    finite(definition.endAngle, Math.PI * 2),
    definition.clockwise === true,
    finite(definition.rotation, 0)
  );
  const plane = String(definition.plane || "xy").trim().toLowerCase();
  const curve = new THREE.Curve();
  curve.getPoint = (t, target = new THREE.Vector3()) => {
    const point = ellipse.getPoint(t);
    if (plane === "xz") return target.set(center.x + point.x, center.y, center.z + point.y);
    if (plane === "yz") return target.set(center.x, center.y + point.x, center.z + point.y);
    return target.set(center.x + point.x, center.y + point.y, center.z);
  };
  return curve;
}

/**
 * Build a Three.js curve from a serializable definition. This is shared by
 * TubeGeometry, path animations and particle sources so their path semantics
 * cannot drift apart.
 */
export function createCurveFromDescriptor(definition, THREE) {
  if (!definition || typeof definition !== "object" || !THREE) return null;
  const type = normalizeType(definition.type || "catmullRom");
  if (type === "curvepath" || type === "path") {
    const children = Array.isArray(definition.curves ?? definition.segments)
      ? (definition.curves ?? definition.segments)
      : [];
    if (!children.length) return linePath(pointsFrom(definition, THREE), THREE);
    const path = new THREE.CurvePath();
    for (const child of children) {
      const curve = createCurveFromDescriptor(child, THREE);
      if (!curve) throw new CurveDescriptorError("curvePath contains an invalid segment");
      path.add(curve);
    }
    path.autoClose = definition.closed === true;
    return path;
  }
  const points = pointsFrom(definition, THREE);
  if (type === "line" || type === "linear" || type === "linecurve3") return linePath(requirePoints(points, 2, "line"), THREE);
  if (type === "quadraticbezier" || type === "quadraticbeziercurve3") {
    const resolved = points.length >= 3
      ? points
      : (definition.v0 != null && definition.v1 != null && definition.v2 != null
        ? [point3(definition.v0, THREE), point3(definition.v1, THREE), point3(definition.v2, THREE)]
        : requirePoints(points, 3, "quadraticBezier"));
    return new THREE.QuadraticBezierCurve3(resolved[0], resolved[1], resolved[2]);
  }
  if (type === "cubicbezier" || type === "cubicbeziercurve3" || type === "bezier") {
    const resolved = points.length >= 4
      ? points
      : (definition.v0 != null && definition.v1 != null && definition.v2 != null && definition.v3 != null
        ? [point3(definition.v0, THREE), point3(definition.v1, THREE), point3(definition.v2, THREE), point3(definition.v3, THREE)]
        : requirePoints(points, 4, "cubicBezier"));
    return new THREE.CubicBezierCurve3(resolved[0], resolved[1], resolved[2], resolved[3]);
  }
  if (type === "ellipse" || type === "ellipsecurve" || type === "arc") return ellipseCurve3(definition, THREE);
  if (!["catmullrom", "catmullromcurve3", "curve"].includes(type)) {
    throw new CurveDescriptorError(`Curve type is not available: ${type}`, "E_CURVE_TYPE_UNAVAILABLE", { curveType: type });
  }
  requirePoints(points, 2, "catmullRom");
  return new THREE.CatmullRomCurve3(
    points,
    definition.closed === true,
    String(definition.curveType || "centripetal"),
    finite(definition.tension, 0.5)
  );
}

export function sampleCurveDescriptor(definition, count, THREE, options = {}) {
  const curve = createCurveFromDescriptor(definition, THREE);
  if (!curve) throw new CurveDescriptorError("Invalid curve descriptor");
  const output = new Float32Array(Math.max(0, count) * 3);
  const spaced = options.spaced !== false;
  for (let index = 0; index < count; index++) {
    const t = count <= 1 ? 0 : index / (count - 1);
    const point = spaced && typeof curve.getPointAt === "function" ? curve.getPointAt(t) : curve.getPoint(t);
    output[index * 3] = finite(point.x);
    output[index * 3 + 1] = finite(point.y);
    output[index * 3 + 2] = finite(point.z);
  }
  return output;
}
