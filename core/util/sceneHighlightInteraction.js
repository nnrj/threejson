/**
 * Post-processing highlight interaction controller (no WebGL / modelBuilder dependency; easy to unit test).
 */

/** @typedef {import("three").Object3D} Object3D */

/** @typedef {object} HighlightPassStyle
 * @property {string} [visibleEdgeColor]
 * @property {string} [hiddenEdgeColor]
 * @property {number} [edgeThickness]
 * @property {number} [edgeStrength]
 * @property {number} [edgeGlow]
 * @property {number} [pulsePeriod]
 */

export const DEFAULT_INFO_PASS_STYLE = {
  visibleEdgeColor: "#FFFFFF",
  hiddenEdgeColor: "#FFFFFF"
};

export const DEFAULT_LOCATE_PASS_STYLE = {
  visibleEdgeColor: "#FFFFFF",
  hiddenEdgeColor: "#FFFFFF"
};

export const DEFAULT_ALARM_PASS_STYLE = {
  visibleEdgeColor: "#FFFFFF",
  hiddenEdgeColor: "#FFFFFF"
};

export const DEFAULT_PARENT_NAME_ALIASES = ["men", "cabinet"];

/**
 * @param {import("three/examples/jsm/postprocessing/OutlinePass.js").OutlinePass|null|undefined} pass
 * @param {HighlightPassStyle} [style]
 */
export function applyPassStyle(pass, style) {
  if (!pass || !style) {
    return;
  }
  if (style.visibleEdgeColor != null) {
    pass.visibleEdgeColor?.set?.(style.visibleEdgeColor);
  }
  if (style.hiddenEdgeColor != null) {
    pass.hiddenEdgeColor?.set?.(style.hiddenEdgeColor);
  }
  if (style.edgeThickness != null) {
    pass.edgeThickness = style.edgeThickness;
  }
  if (style.edgeStrength != null) {
    pass.edgeStrength = style.edgeStrength;
  }
  if (style.edgeGlow != null) {
    pass.edgeGlow = style.edgeGlow;
  }
  if (style.pulsePeriod != null) {
    pass.pulsePeriod = style.pulsePeriod;
  }
}

/**
 * @param {object} bundle
 */
export function syncHighlightPassActivity(bundle) {
  if (!bundle) {
    return;
  }
  const infoPass = bundle.infoPass ?? bundle.outlinePass;
  const infoN = infoPass?.selectedObjects?.length ?? 0;
  const locateN = bundle.locatePass?.selectedObjects?.length ?? 0;
  const alarmN = bundle.alarmPass?.selectedObjects?.length ?? 0;
  if (infoPass) {
    infoPass.enabled = infoN > 0;
  }
  if (bundle.locatePass) {
    bundle.locatePass.enabled = locateN > 0;
  }
  if (bundle.alarmPass) {
    bundle.alarmPass.enabled = alarmN > 0;
  }
}

/**
 * @param {object} [options]
 * @returns {(obj: Object3D) => Object3D|null}
 */
export function createHighlightTargetResolver(options = {}) {
  const aliases = new Set(
    (options.parentNameAliases ?? DEFAULT_PARENT_NAME_ALIASES).map((n) =>
      String(n).trim().toLowerCase()
    )
  );
  if (typeof options.resolveTarget === "function") {
    return (obj) => options.resolveTarget(obj);
  }
  return (obj) => {
    if (!obj) {
      return null;
    }
    const name = typeof obj.name === "string" ? obj.name.trim().toLowerCase() : "";
    if (name && aliases.has(name) && obj.parent) {
      const j = obj.userData?.objJson;
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const objType = typeof j.objType === "string" ? j.objType.trim() : "";
        if (objType) {
          return obj;
        }
      }
      return obj.parent;
    }
    return obj;
  };
}

function resolveInfoPass(bundle) {
  return bundle.infoPass ?? bundle.outlinePass ?? null;
}

function removeObjectFromPass(pass, object) {
  if (!pass?.selectedObjects?.length || !object) {
    return;
  }
  const idx = pass.selectedObjects.indexOf(object);
  if (idx >= 0) {
    pass.selectedObjects.splice(idx, 1);
  }
}

function concatUniqueTargets(pass, objects) {
  if (!pass?.selectedObjects || !Array.isArray(objects)) {
    return;
  }
  const current = pass.selectedObjects;
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj && !current.includes(obj)) {
      current.push(obj);
    }
  }
}

/**
 * @param {object} bundle
 */
export function createSceneHighlightInteractionController(bundle) {
  if (!bundle) {
    throw new Error("[sceneHighlightInteraction] bundle is required");
  }

  let locateTarget = null;
  const resolve =
    typeof bundle.resolveTarget === "function"
      ? (obj) => bundle.resolveTarget(obj)
      : (obj) => obj;
  const sync = () => syncHighlightPassActivity(bundle);
  const infoPass = () => resolveInfoPass(bundle);

  return {
    get infoPass() {
      return infoPass();
    },
    get locatePass() {
      return bundle.locatePass;
    },
    get alarmPass() {
      return bundle.alarmPass;
    },
    resolveTarget: resolve,

    isHighlightActive() {
      return Boolean(locateTarget);
    },

    setHighlight(obj) {
      const target = resolve(obj);
      locateTarget = target;
      if (bundle.locatePass) {
        bundle.locatePass.selectedObjects = target ? [target] : [];
      }
      sync();
    },

    clearHighlight() {
      locateTarget = null;
      if (bundle.locatePass?.selectedObjects) {
        bundle.locatePass.selectedObjects = [];
      }
      sync();
    },

    setInfoHighlight(obj) {
      const target = resolve(obj);
      const pass = infoPass();
      if (pass) {
        pass.selectedObjects = target ? [target] : [];
      }
      sync();
    },

    clearInfoHighlight() {
      const pass = infoPass();
      if (pass?.selectedObjects) {
        pass.selectedObjects = [];
      }
      sync();
    },

    addLocateObjects(objects) {
      const list = Array.isArray(objects) ? objects.map(resolve).filter(Boolean) : [];
      if (bundle.locatePass && list.length) {
        concatUniqueTargets(bundle.locatePass, list);
      }
      sync();
    },

    clearLocateHighlights() {
      if (bundle.locatePass?.selectedObjects) {
        bundle.locatePass.selectedObjects = [];
      }
      locateTarget = null;
      sync();
    },

    addAlarmObjects(objects) {
      const list = Array.isArray(objects) ? objects.map(resolve).filter(Boolean) : [];
      if (bundle.alarmPass && list.length) {
        concatUniqueTargets(bundle.alarmPass, list);
      }
      sync();
    },

    clearAlarmHighlights() {
      if (bundle.alarmPass?.selectedObjects) {
        bundle.alarmPass.selectedObjects = [];
      }
      sync();
    },

    removeLocateObject(object) {
      const target = resolve(object);
      if (target) {
        removeObjectFromPass(bundle.locatePass, target);
      }
      if (locateTarget === target) {
        locateTarget = null;
      }
      sync();
    },

    removeAlarmObject(object) {
      const target = resolve(object);
      if (target) {
        removeObjectFromPass(bundle.alarmPass, target);
      }
      sync();
    },

    clearAll() {
      locateTarget = null;
      if (typeof bundle.clearSelectedObjects === "function") {
        bundle.clearSelectedObjects();
      } else {
        const pass = infoPass();
        if (pass?.selectedObjects) {
          pass.selectedObjects = [];
        }
        if (bundle.locatePass?.selectedObjects) {
          bundle.locatePass.selectedObjects = [];
        }
        if (bundle.alarmPass?.selectedObjects) {
          bundle.alarmPass.selectedObjects = [];
        }
      }
      sync();
    },

    syncPassActivity() {
      sync();
    },

    dispose() {
      locateTarget = null;
      if (typeof bundle.dispose === "function") {
        bundle.dispose();
      }
    }
  };
}
