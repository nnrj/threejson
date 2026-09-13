/** Serialize BufferGeometry without introducing Three.js, network or renderer dependencies. */
export function describeBufferGeometry(geometry) {
  const attribute = (value) => ({ array: Array.from(value.array), itemSize: value.itemSize,
    type: value.array.constructor.name, normalized: value.normalized === true,
    ...(value.name ? { name: value.name } : {}) });
  const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, value]) => [name, attribute(value)])),
    ...(geometry.index ? { index: attribute(geometry.index) } : {}),
    groups: geometry.groups.map((group) => ({ ...group })),
    drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : Math.max(0, count - geometry.drawRange.start) },
    morphAttributes: Object.fromEntries(Object.entries(geometry.morphAttributes).map(([name, targets]) => [name, targets.map(attribute)])),
    morphTargetsRelative: geometry.morphTargetsRelative === true
  };
}
