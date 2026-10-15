import { Box3, Vector3, MathUtils } from "three";

export const LIGHTING_RECIPES = Object.freeze(["product", "interior", "outdoor", "night", "diagram"]);
export const MATERIAL_RECIPES = Object.freeze({
  ceramic: { type: "physical", color: "#e7e1d6", roughness: .25, metalness: 0, clearcoat: .35, clearcoatRoughness: .18 },
  brushedMetal: { type: "standard", color: "#b7bdc4", roughness: .32, metalness: 1 },
  glass: { type: "physical", color: "#ffffff", roughness: .08, metalness: 0, transmission: 1, thickness: .1, ior: 1.5 },
  plastic: { type: "physical", color: "#3978ab", roughness: .36, metalness: 0, clearcoat: .15 },
  matte: { type: "standard", color: "#ad9680", roughness: .78, metalness: 0 },
  diagram: { type: "basic", color: "#6fcfff" }
});

export function createMaterialRecipe(name, overrides = {}) {
  if (!Object.hasOwn(MATERIAL_RECIPES, name)) throw new TypeError(`Unknown material recipe: ${name}`);
  return { ...MATERIAL_RECIPES[name], ...overrides };
}

/** Expands to ordinary persisted sceneConfig fields; never installs hidden lights. */
export function createLightingRecipe(name = "product", { center = [0, 0, 0], size = 2, viewDirection = [0, .25, 1] } = {}) {
  if (!LIGHTING_RECIPES.includes(name)) throw new TypeError(`Unknown lighting recipe: ${name}`);
  if (!Number.isFinite(size) || size <= 0 || !Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)) throw new TypeError("Lighting requires a finite center and positive size.");
  if (!Array.isArray(viewDirection) || viewDirection.length !== 3 || !viewDirection.every(Number.isFinite)) throw new TypeError("Lighting viewDirection must contain three finite numbers.");
  const c = new Vector3(...center), forward = new Vector3(...viewDirection).normalize();
  if (!forward.lengthSq()) throw new TypeError("Lighting viewDirection cannot be zero.");
  let right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward).normalize();
  if (!right.lengthSq()) right.set(1, 0, 0);
  const position = (x, y, z) => { const p = c.clone().addScaledVector(right, x * size).addScaledVector(new Vector3(0, 1, 0), y * size).addScaledVector(forward, z * size); return { x: p.x, y: p.y, z: p.z }; };
  const target = { x: c.x, y: c.y, z: c.z }, night = name === "night";
  const lights = name === "diagram" ? [] : [
    { type: "directional", threeJsonId: "look-key", position: position(-1, 1.5, 1.4), target, color: night ? "#91b4ff" : "#fff2e1", intensity: night ? 1 : name === "outdoor" ? 3 : 2.5, castShadow: true, shadow: { mapSize: { width: 1024, height: 1024 }, normalBias: size * .0005, camera: { near: size * .01, far: size * 6, left: -size, right: size, top: size, bottom: -size } } },
    { type: "hemisphere", threeJsonId: "look-fill", skyColor: night ? "#6583c3" : "#dceaff", groundColor: "#65584d", intensity: night ? .25 : .8, castShadow: false },
    { type: "directional", threeJsonId: "look-rim", position: position(1, .7, -1), target, color: "#d9eaff", intensity: night ? .65 : 1, castShadow: false }
  ];
  return { scene: { ...(name !== "diagram" ? { environment: { type: "studio" }, environmentIntensity: night ? .15 : name === "interior" ? .45 : .8 } : {}) }, lights, renderer: { toneMapping: "agx", toneMappingExposure: 1, outputColorSpace: "srgb" } };
}

/** A persisted camera, not a viewport-only zoom. Unit-agnostic and aspect-aware. */
export function createFramingCamera({ bounds, aspect = 16 / 9, fov = 40, occupancy = .72, viewDirection = [0, .25, 1] }) {
  if (![bounds?.min, bounds?.max, viewDirection].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new TypeError("Framing bounds and viewDirection require finite three-component vectors.");
  const box = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
  if (box.isEmpty() || ![...bounds.min, ...bounds.max, aspect, fov, occupancy].every(Number.isFinite) || aspect <= 0 || fov <= 0 || fov >= 175 || occupancy <= 0 || occupancy > .95) throw new TypeError("Invalid framing bounds/lens/occupancy.");
  const center = box.getCenter(new Vector3()), radius = box.getSize(new Vector3()).length() / 2;
  const direction = new Vector3(...viewDirection).normalize();
  if (!direction.lengthSq()) throw new TypeError("Camera direction cannot be zero.");
  const halfAngle = Math.min(MathUtils.degToRad(fov / 2), Math.atan(Math.tan(MathUtils.degToRad(fov / 2)) * aspect));
  const distance = Math.max(.01, radius / (Math.sin(halfAngle) * occupancy));
  const p = center.clone().addScaledVector(direction, distance);
  return { type: "perspective", fov, near: Math.max(.0001, distance / 1000), far: Math.max(100, distance * 20), position: { x: p.x, y: p.y, z: p.z }, lookAt: { x: center.x, y: center.y, z: center.z } };
}
