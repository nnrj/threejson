/**
 * Shape outline parsing, self-intersection detection, and THREE.Shape construction.
 */

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * @param {unknown} raw
 * @returns {Array<[number, number]>}
 */
export function parseContour2D(raw) {
  if (!Array.isArray(raw) || raw.length < 3) {
    return [];
  }
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const pt = raw[i];
    if (Array.isArray(pt) && pt.length >= 2) {
      const x = Number(pt[0]);
      const y = Number(pt[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push([x, y]);
      }
      continue;
    }
    if (pt && typeof pt === "object") {
      const x = Number(pt.x);
      const y = Number(pt.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push([x, y]);
      }
    }
  }
  return out.length >= 3 ? out : [];
}

function orientation(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return (
    Math.min(ax, bx) <= cx + 1e-9
    && cx <= Math.max(ax, bx) + 1e-9
    && Math.min(ay, by) <= cy + 1e-9
    && cy <= Math.max(ay, by) + 1e-9
  );
}

function segmentsIntersect2D(a, b, c, d) {
  const o1 = orientation(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orientation(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orientation(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orientation(c[0], c[1], d[0], d[1], b[0], b[1]);

  if (o1 === 0 && onSegment(a[0], a[1], b[0], b[1], c[0], c[1])) {
    return true;
  }
  if (o2 === 0 && onSegment(a[0], a[1], b[0], b[1], d[0], d[1])) {
    return true;
  }
  if (o3 === 0 && onSegment(c[0], c[1], d[0], d[1], a[0], a[1])) {
    return true;
  }
  if (o4 === 0 && onSegment(c[0], c[1], d[0], d[1], b[0], b[1])) {
    return true;
  }
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * @param {Array<[number, number]>} contour
 * @returns {boolean}
 */
export function contourHasSelfIntersection(contour) {
  const n = contour.length;
  if (n < 4) {
    return false;
  }
  for (let i = 0; i < n; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n || i === (j + 1) % n) {
        continue;
      }
      const c = contour[j];
      const d = contour[(j + 1) % n];
      if (segmentsIntersect2D(a, b, c, d)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {object} record
 * @returns {"reject"|"warn"|"off"}
 */
export function resolveShapeSelfIntersectMode(record) {
  const raw = record?.shapeValidation?.selfIntersect ?? record?.shape?.shapeValidation?.selfIntersect;
  const mode = typeof raw === "string" ? raw.trim().toLowerCase() : "reject";
  if (mode === "warn" || mode === "off") {
    return mode;
  }
  return "reject";
}

/**
 * @param {object} shapeDef
 * @param {object} record
 * @returns {{ ok: boolean, code?: string, warn?: boolean }}
 */
export function validateShapeDefinition(shapeDef, record = {}) {
  const contour = parseContour2D(shapeDef?.contour);
  if (contour.length < 3) {
    return { ok: false, code: "E_SHAPE_CONTOUR_INVALID" };
  }
  const mode = resolveShapeSelfIntersectMode(record);
  if (mode === "off") {
    return { ok: true };
  }
  if (contourHasSelfIntersection(contour)) {
    if (mode === "warn") {
      return { ok: true, warn: true, code: "E_SHAPE_CONTOUR_SELF_INTERSECT" };
    }
    return { ok: false, code: "E_SHAPE_CONTOUR_SELF_INTERSECT" };
  }
  const holes = Array.isArray(shapeDef?.holes) ? shapeDef.holes : [];
  for (let hi = 0; hi < holes.length; hi++) {
    const hole = parseContour2D(holes[hi]);
    if (hole.length >= 3 && contourHasSelfIntersection(hole)) {
      if (mode === "warn") {
        return { ok: true, warn: true, code: "E_SHAPE_CONTOUR_SELF_INTERSECT" };
      }
      return { ok: false, code: "E_SHAPE_CONTOUR_SELF_INTERSECT" };
    }
  }
  return { ok: true };
}

/**
 * @param {typeof import("three")} THREE
 * @param {object} shapeDef
 * @returns {import("three").Shape|null}
 */
export function buildThreeShapeFromDef(THREE, shapeDef) {
  const contour = parseContour2D(shapeDef?.contour);
  if (contour.length < 3) {
    return null;
  }
  const shape = new THREE.Shape();
  shape.moveTo(contour[0][0], contour[0][1]);
  for (let i = 1; i < contour.length; i++) {
    shape.lineTo(contour[i][0], contour[i][1]);
  }
  shape.closePath();

  const holes = Array.isArray(shapeDef?.holes) ? shapeDef.holes : [];
  for (let hi = 0; hi < holes.length; hi++) {
    const holePts = parseContour2D(holes[hi]);
    if (holePts.length < 3) {
      continue;
    }
    const holePath = new THREE.Path();
    holePath.moveTo(holePts[0][0], holePts[0][1]);
    for (let j = 1; j < holePts.length; j++) {
      holePath.lineTo(holePts[j][0], holePts[j][1]);
    }
    holePath.closePath();
    shape.holes.push(holePath);
  }
  return shape;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function recordHasExplicitRotation(record) {
  return Boolean(record && typeof record === "object" && hasOwn(record, "rotation"));
}
