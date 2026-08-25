import {
  getSceneCapability,
  isSceneCapabilityAvailable
} from "./sceneCapabilityManifest.js";

export class SceneCapabilityError extends Error {
  constructor(diagnostics, message = "Scene uses unavailable ThreeJSON capabilities") {
    super(message);
    this.name = "SceneCapabilityError";
    this.code = "E_SCENE_CAPABILITY_UNAVAILABLE";
    this.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  }
}

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value) {
  return normalizeId(value).toLowerCase();
}

function addDiagnostic(out, diagnostic) {
  const key = `${diagnostic.category}:${diagnostic.id}:${diagnostic.pointer || ""}`;
  if (out.some((entry) => entry.key === key)) return;
  out.push({ key, severity: "error", ...diagnostic });
}

function visitRecords(value, pointer, visitor, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitRecords(entry, `${pointer}/${index}`, visitor, seen));
    return;
  }
  const materialType = normalizeMaterialType(value);
  const isDeclaredMaterial = Boolean(materialType && getSceneCapability("materials", materialType));
  if (typeof value.objType === "string" || value.passType || isDeclaredMaterial) {
    visitor(value, pointer || "/");
  }
  for (const [key, child] of Object.entries(value)) {
    // assetLibrary materialPreset records are executable scene capabilities too (for example a
    // ShaderMaterial reached through materialRef), so they must participate in compatibility
    // checks. Metadata/userData remain opaque application data.
    if (key === "metadata" || key === "userData") continue;
    if (child && typeof child === "object") visitRecords(child, `${pointer}/${key}`, visitor, seen);
  }
}

function checkCapability(out, category, id, pointer, rendererBackend) {
  const declaration = getSceneCapability(category, id, { rendererBackend });
  // Unknown ids may be supplied by a registered domain/extension. Only reject capabilities that
  // the canonical manifest explicitly declares unavailable.
  if (!id || !declaration || isSceneCapabilityAvailable(category, id, { rendererBackend })) return;
  addDiagnostic(out, {
    category,
    id,
    pointer,
    reason: declaration?.reason || `${category}.${id} is not available for renderer ${rendererBackend}`,
    rendererBackend
  });
}

function normalizeMaterialType(material) {
  const raw = normalizeLower(material?.type);
  const aliases = {
    meshbasicmaterial: "basic",
    meshlambertmaterial: "lambert",
    meshphongmaterial: "phong",
    meshstandardmaterial: "standard",
    meshphysicalmaterial: "physical",
    meshtoonmaterial: "toon",
    meshmatcapmaterial: "matcap",
    meshnormalmaterial: "normal",
    shadermaterial: "shader",
    rawshadermaterial: "shader",
    linematerial: "shader",
    nodematerial: "tsl"
  };
  return aliases[raw] || raw;
}

/** Return structured errors without logging or mutating the descriptor. */
export function collectSceneCapabilityDiagnostics(scene, options = {}) {
  const rendererBackend = normalizeLower(
    options.rendererBackend ?? scene?.sceneConfig?.renderer?.backend ?? scene?.renderer?.backend ?? "webgl"
  ) || "webgl";
  const diagnostics = [];
  checkCapability(diagnostics, "rendererBackends", rendererBackend, "/sceneConfig/renderer/backend", rendererBackend);
  const rootControlsType = normalizeLower(scene?.sceneConfig?.controls?.type || "orbit");
  if (rootControlsType) {
    const aliases = { firstperson: "firstPerson", mapcontrols: "map", trackballcontrols: "trackball", arcballcontrols: "arcball" };
    checkCapability(diagnostics, "controlsTypes", aliases[rootControlsType] || rootControlsType, "/sceneConfig/controls/type", rendererBackend);
  }
  const rootLights = Array.isArray(scene?.sceneConfig?.lights) ? scene.sceneConfig.lights : [];
  rootLights.forEach((light, index) => {
    const type = normalizeLower(light?.type).replace(/[\s_-]/g, "");
    const aliases = { ambientlight: "ambient", hemispherelight: "hemisphere", directionallight: "directional", pointlight: "point", spotlight: "spot", rectarea: "rectArea", rectarealight: "rectArea" };
    if (type) checkCapability(diagnostics, "lightTypes", aliases[type] || type, `/sceneConfig/lights/${index}/type`, rendererBackend);
  });

  visitRecords(scene, "", (record, pointer) => {
    const objType = normalizeLower(record.objType);
    if (objType) {
      const canonicalObjType = objType === "externalmodel" ? "externalModel"
        : objType === "particleemitter" ? "particleEmitter"
          : objType === "shadersurface" ? "shaderSurface"
            : objType === "heatmap" ? "heatMap"
              : objType;
      checkCapability(diagnostics, "objects", canonicalObjType, `${pointer}/objType`, rendererBackend);
    }

    if (objType === "controls") {
      const controlsType = normalizeLower(record.type || "orbit");
      const aliases = { firstperson: "firstPerson", mapcontrols: "map", trackballcontrols: "trackball", arcballcontrols: "arcball" };
      checkCapability(diagnostics, "controlsTypes", aliases[controlsType] || controlsType, `${pointer}/type`, rendererBackend);
    }

    if (objType === "light") {
      const type = normalizeLower(record.type).replace(/[\s_-]/g, "");
      const aliases = { ambientlight: "ambient", hemispherelight: "hemisphere", directionallight: "directional", pointlight: "point", spotlight: "spot", rectarea: "rectArea", rectarealight: "rectArea" };
      if (type) checkCapability(diagnostics, "lightTypes", aliases[type] || type, `${pointer}/type`, rendererBackend);
    }

    if (objType === "externalmodel" || objType === "skinned") {
      const explicit = normalizeLower(record.modelFileType || record.fileType);
      const path = typeof record.modelPath === "string" ? record.modelPath.split(/[?#]/)[0] : "";
      const inferred = path.includes(".") ? normalizeLower(path.slice(path.lastIndexOf(".") + 1)) : "";
      const format = explicit || inferred;
      if (format) checkCapability(diagnostics, "modelFormats", format, `${pointer}/modelFileType`, rendererBackend);
    }

    if (objType === "pass" || record.passType) {
      const passTypeRaw = normalizeLower(record.passType || "outline");
      const passAliases = { unrealbloom: "unrealBloom", shader: "shaderPreset", shaderpreset: "shaderPreset" };
      checkCapability(
        diagnostics,
        "passes",
        passAliases[passTypeRaw] || passTypeRaw,
        `${pointer}/passType`,
        rendererBackend
      );
    }

    const materialType = normalizeMaterialType(record);
    if (materialType) checkCapability(diagnostics, "materials", materialType, `${pointer}/type`, rendererBackend);

    if (objType === "shadersurface" && !normalizeId(record.shaderPreset ?? record.material?.shaderPreset)) {
      addDiagnostic(diagnostics, {
        category: "objects",
        id: "shaderSurface",
        pointer,
        rendererBackend,
        reason: "shaderSurface requires a registered shaderPreset"
      });
    }

    if (objType === "particleemitter") {
      const retiredFields = ["distribution", "count", "motion", "material", "provider", "particleProvider"]
        .filter((key) => Object.prototype.hasOwnProperty.call(record, key));
      if (retiredFields.length > 0) {
        addDiagnostic(diagnostics, {
          category: "particleDescriptor",
          id: "v1-schema",
          pointer,
          rendererBackend,
          reason: `Particle V1 fields were removed; migrate to source/emission/particle/simulation/render: ${retiredFields.join(", ")}`
        });
      }
      if (record.simulation !== undefined && (!record.simulation || typeof record.simulation !== "object" || Array.isArray(record.simulation))) {
        addDiagnostic(diagnostics, {
          category: "particleDescriptor",
          id: "simulation",
          pointer: `${pointer}/simulation`,
          rendererBackend,
          reason: "Particle V2 simulation must be an object containing backend."
        });
      }
      if (record.source !== undefined && (!record.source || typeof record.source !== "object" || Array.isArray(record.source))) {
        addDiagnostic(diagnostics, {
          category: "particleDescriptor",
          id: "source",
          pointer: `${pointer}/source`,
          rendererBackend,
          reason: "Particle V2 source must be an object containing type."
        });
      }
      const simulationRaw = normalizeLower(record.simulation?.backend ?? "cpu");
      checkCapability(
        diagnostics,
        "particleBackends",
        simulationRaw,
        `${pointer}/simulation`,
        rendererBackend
      );
      const sourceRaw = normalizeLower(record.source?.type ?? "box");
      const sourceAliases = {
        meshsurface: "meshSurface",
        textmask: "textMask",
        imagemask: "imageMask"
      };
      checkCapability(
        diagnostics,
        "particleSources",
        sourceAliases[sourceRaw] || sourceRaw,
        `${pointer}/source`,
        rendererBackend
      );
    }
  });

  return diagnostics.map(({ key, ...entry }) => entry);
}

export function assertSceneCapabilities(scene, options = {}) {
  const diagnostics = collectSceneCapabilityDiagnostics(scene, options);
  if (diagnostics.length > 0) throw new SceneCapabilityError(diagnostics);
  return true;
}
