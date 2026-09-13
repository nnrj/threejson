import { resolvePosition, resolveRotation, resolveScale } from "./vectorValue.js";

/** Shared descriptor pose mapping, independent of any geometry or material builder. */
export function applyObjectTransform(object, source = {}, options = {}) {
  const partial = options.partial === true;
  const p = resolvePosition(source.position, partial ? object.position : undefined);
  const r = resolveRotation(source.rotation, partial ? object.rotation : undefined);
  const s = resolveScale(source.scale, partial ? object.scale : undefined);
  object.position.set(p.x, p.y, p.z);
  object.rotation.set(r.x, r.y, r.z, source.rotation?.order || (partial ? object.rotation.order : "XYZ"));
  if (source.quaternion !== undefined) {
    const q = source.quaternion;
    if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite) || Math.hypot(...q) === 0) throw new TypeError("quaternion requires four finite components and a nonzero norm.");
    object.quaternion.fromArray(q).normalize();
  }
  object.scale.set(s.x, s.y, s.z);
  if (typeof source.visible === "boolean") object.visible = source.visible;
}
