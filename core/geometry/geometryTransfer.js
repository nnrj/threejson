import { BufferGeometry, BufferAttribute, Box3, Sphere, Vector3 } from "three";

/** Transfer typed buffers, never JSON-stringify evaluated vertex arrays. */
export function serializeGeometryResult(result) {
  if (!result.geometry) return { result, transfers: [] };
  const geometry = result.geometry, transfers = new Set();
  const attribute = (value) => {
    if (!value) return null;
    if (value.isInterleavedBufferAttribute) throw new Error("Geometry compiler produced an unsupported interleaved attribute.");
    transfers.add(value.array.buffer);
    return { array: value.array, itemSize: value.itemSize, normalized: value.normalized, usage: value.usage, gpuType: value.gpuType };
  };
  const packed = {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, value]) => [key, attribute(value)])),
    index: attribute(geometry.index),
    morphAttributes: Object.fromEntries(Object.entries(geometry.morphAttributes).map(([key, values]) => [key, values.map(attribute)])),
    morphTargetsRelative: geometry.morphTargetsRelative, groups: geometry.groups, drawRange: geometry.drawRange,
    boundingBox: geometry.boundingBox && [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray()],
    boundingSphere: geometry.boundingSphere && [geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius],
    userData: geometry.userData
  };
  // The expanded topology can dwarf the original description and is not needed for runtime assembly.
  const { evaluatedTopology, ...metadata } = result;
  return { result: { ...metadata, geometry: packed }, transfers: [...transfers] };
}

export function deserializeGeometryResult(result) {
  if (!result.geometry) return result;
  const packed = result.geometry, geometry = new BufferGeometry();
  const attribute = (value) => {
    const output = new BufferAttribute(value.array, value.itemSize, value.normalized);
    output.setUsage(value.usage); output.gpuType = value.gpuType; return output;
  };
  for (const [key, value] of Object.entries(packed.attributes)) geometry.setAttribute(key, attribute(value));
  if (packed.index) geometry.setIndex(attribute(packed.index));
  geometry.morphAttributes = Object.fromEntries(Object.entries(packed.morphAttributes).map(([key, values]) => [key, values.map(attribute)]));
  geometry.morphTargetsRelative = packed.morphTargetsRelative; geometry.groups = packed.groups; geometry.drawRange = packed.drawRange;
  geometry.userData = packed.userData;
  if (packed.boundingBox) geometry.boundingBox = new Box3(new Vector3().fromArray(packed.boundingBox[0]), new Vector3().fromArray(packed.boundingBox[1]));
  if (packed.boundingSphere) geometry.boundingSphere = new Sphere(new Vector3().fromArray(packed.boundingSphere[0]), packed.boundingSphere[1]);
  return { ...result, geometry };
}
