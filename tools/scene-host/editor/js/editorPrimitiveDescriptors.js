import * as THREE from "three";
import { buildAdaptiveContentBoundingBoxTHREE } from "threejson";

const EDITOR_OBJ_TYPE_ALIASES = {
  heatMap: "heatmap",
  infoPanel: "infopanel",
  css3dPanel: "css3dpanel",
  shapePlane: "shapeplane",
  shapeExtrude: "shapeextrude",
  irregularPlane: "irregularplane",
  irregularGeometry: "irregulargeometry",
  bufferMesh: "buffermesh",
  objModel: "externalmodel",
  leakLine: "leakline"
};

const PRIMITIVE_SPAWN_SCENE_FRACTION = 0.05;
const PRIMITIVE_SPAWN_UNIT_MIN = 1;
const PRIMITIVE_SPAWN_UNIT_MAX = 500;

export function normalizeEditorPanelObjType(panelKey) {
  const key = String(panelKey || "").trim();
  if (!key) {
    return "";
  }
  return EDITOR_OBJ_TYPE_ALIASES[key] || key.toLowerCase();
}

function editorSquareShapeContour(unit) {
  const half = unit * 0.5;
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half }
  ];
}

export function resolveEditorPrimitiveSpawnContext(host) {
  const scene = host.getScene();
  const controls = host.getControls();
  const bounds = scene?.isScene
    ? buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper: null })
    : null;
  if (bounds && !bounds.isEmpty()) {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const unit = THREE.MathUtils.clamp(
      maxDim * PRIMITIVE_SPAWN_SCENE_FRACTION,
      PRIMITIVE_SPAWN_UNIT_MIN,
      PRIMITIVE_SPAWN_UNIT_MAX
    );
    return {
      position: { x: center.x, y: center.y, z: center.z },
      unit
    };
  }
  if (controls?.target) {
    return {
      position: {
        x: Number(controls.target.x) || 0,
        y: Number(controls.target.y) || 0,
        z: Number(controls.target.z) || 0
      },
      unit: 2
    };
  }
  return { position: { x: 0, y: 1, z: 0 }, unit: 1 };
}

/** Mirrors tools/old_version/scene-editor.html buildEditorPrimitiveDescriptor */
export function buildEditorPrimitiveDescriptor(panelKey, host) {
  const objType = normalizeEditorPanelObjType(panelKey);
  const stamp = Date.now();
  const name = `${panelKey || objType}-${stamp}`;
  const spawn = resolveEditorPrimitiveSpawnContext(host);
  const u = spawn.unit;
  const base = {
    objType,
    name,
    visible: true,
    position: spawn.position,
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
  const mat = (color) => ({ type: "standard", color });
  const half = u * 0.5;

  switch (objType) {
    case "sphere":
      return { ...base, geometry: { radius: half }, material: mat("#67c23a") };
    case "plane":
      return {
        ...base,
        geometry: { width: u, height: u },
        material: { type: "basic", color: "#e6a23c", side: "double" }
      };
    case "line":
      return {
        ...base,
        points: [
          { x: -half, y: 0, z: 0 },
          { x: half, y: 0, z: 0 }
        ],
        material: { color: "#f56c6c" }
      };
    case "cylinder":
      return {
        ...base,
        geometry: { radiusTop: half, radiusBottom: half, height: u },
        material: mat("#909399")
      };
    case "cone":
      return { ...base, geometry: { radius: half, height: u }, material: mat("#b37feb") };
    case "ring":
      return {
        ...base,
        geometry: { innerRadius: half * 0.6, outerRadius: half },
        material: mat("#36cfc9")
      };
    case "torus":
      return {
        ...base,
        geometry: { radius: half, tube: half * 0.3 },
        material: mat("#ffc53d")
      };
    case "capsule":
      return {
        ...base,
        geometry: { radius: half * 0.6, length: u },
        material: mat("#ff85c0")
      };
    case "group":
      return {
        ...base,
        boxModelList: [
          {
            objType: "box",
            name: `${name}-child`,
            geometry: { width: half, height: half, depth: half },
            position: { x: 0, y: 0, z: 0 },
            material: mat("#409eff")
          }
        ]
      };
    case "points":
      return {
        ...base,
        count: 200,
        bounds: { width: u, height: u, depth: u },
        material: {
          color: "#ffffff",
          size: Math.max(2, u * 0.02),
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.9
        }
      };
    case "sprite":
      return {
        ...base,
        material: { color: "#ffffff", size: Math.max(16, u * 8) }
      };
    case "shapeplane":
      return {
        ...base,
        shape: { contour: editorSquareShapeContour(u) },
        material: mat("#79bbff")
      };
    case "shapeextrude":
      return {
        ...base,
        shape: { contour: editorSquareShapeContour(u) },
        extrude: { depth: u * 0.25 },
        material: mat("#95d475")
      };
    case "irregularplane":
      return {
        ...base,
        objType: "shapePlane",
        shape: { contour: editorSquareShapeContour(u) },
        material: mat("#b37feb")
      };
    case "irregulargeometry":
      return {
        ...base,
        shape: { contour: editorSquareShapeContour(u) },
        extrude: { depth: u * 0.3 },
        material: mat("#e6a23c")
      };
    case "buffermesh":
      return {
        ...base,
        geometry: {
          positions: [0, 0, 0, u, 0, 0, 0, u, 0],
          indices: [0, 1, 2]
        },
        material: mat("#909399")
      };
    case "tube":
      return {
        ...base,
        path: {
          type: "catmullrom",
          points: [
            { x: -half, y: 0, z: -half },
            { x: half, y: 0, z: half }
          ]
        },
        geometry: { radius: u * 0.08 },
        material: mat("#36cfc9")
      };
    case "instanced":
      return {
        ...base,
        geometry: { width: half, height: half, depth: half },
        transforms: [{ position: { x: 0, y: 0, z: 0 } }],
        material: mat("#409eff")
      };
    case "box":
    default:
      return {
        ...base,
        geometry: { width: u, height: u, depth: u },
        material: mat("#409eff")
      };
  }
}
