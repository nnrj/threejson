function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const key of Object.keys(value)) {
      next[key] = cloneValue(value[key]);
    }
    return next;
  }
  return value;
}

function mergeDefaults(explicitValue, defaultValue) {
  if (explicitValue === undefined) {
    return cloneValue(defaultValue);
  }
  if (Array.isArray(explicitValue)) {
    return explicitValue.map(cloneValue);
  }
  if (isPlainObject(explicitValue) && isPlainObject(defaultValue)) {
    const next = {};
    const keys = new Set([
      ...Object.keys(defaultValue),
      ...Object.keys(explicitValue)
    ]);
    for (const key of keys) {
      next[key] = mergeDefaults(explicitValue[key], defaultValue[key]);
    }
    return next;
  }
  return cloneValue(explicitValue);
}

const DEFAULT_FRIENDLY_SCENE_LIST_ORDER = [
  "boxModelList",
  "sphereModelList",
  "meshList",
  "groupList",
  "lineList",
  "infoPanelList",
  "css3dPanelList",
  "heatList",
  "windList",
  "shaderSurfaceList",
  "planeList",
  "shapePlaneList",
  "irregularPlaneList",
  "bufferMeshList",
  "particleList",
  "spriteList",
  "tubeList",
  "shapeExtrudeList",
  "irregularGeometryList",
  "instancedList",
  "audioList",
  "skinnedList",
  "externalModelList",
  "objModelList",
  "passList",
  "domainModelList",
  "modelList",
  "objectList"
];

const DEFAULT_FRIENDLY_SCENE_LIST_MAP = {
  boxModelList: {
    scope: "worldInfo",
    family: "primary",
    allowObjTypeOmit: false,
    preprocess: "coalesceBoxModelList"
  },
  sphereModelList: {
    scope: "worldInfo",
    family: "primary",
    objType: "sphere",
    allowObjTypeOmit: true
  },
  meshList: {
    scope: "worldInfo",
    family: "primary",
    mixed: true,
    allowObjTypeOmit: false,
    preprocess: "coalesceBoxModelList"
  },
  groupList: {
    scope: "worldInfo",
    family: "primary",
    objType: "group",
    allowObjTypeOmit: true
  },
  lineList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "line",
    allowObjTypeOmit: true
  },
  infoPanelList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "infoPanel",
    allowObjTypeOmit: true
  },
  css3dPanelList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "css3dPanel",
    allowObjTypeOmit: true
  },
  heatList: {
    scope: "worldInfo",
    family: "effect",
    objType: "heatMap",
    allowObjTypeOmit: true
  },
  windList: {
    scope: "worldInfo",
    family: "effect",
    objType: "wind",
    allowObjTypeOmit: true
  },
  shaderSurfaceList: {
    scope: "worldInfo",
    family: "effect",
    objType: "shaderSurface",
    allowObjTypeOmit: true
  },
  planeList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "plane",
    allowObjTypeOmit: true
  },
  shapePlaneList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "shapePlane",
    allowObjTypeOmit: true
  },
  irregularPlaneList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "irregularPlane",
    allowObjTypeOmit: true
  },
  bufferMeshList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "bufferMesh",
    allowObjTypeOmit: true
  },
  particleList: {
    scope: "worldInfo",
    family: "effect",
    objType: "points",
    allowObjTypeOmit: true
  },
  spriteList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "sprite",
    allowObjTypeOmit: true
  },
  tubeList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "tube",
    allowObjTypeOmit: true
  },
  shapeExtrudeList: {
    scope: "worldInfo",
    family: "primary",
    objType: "shapeExtrude",
    allowObjTypeOmit: true
  },
  irregularGeometryList: {
    scope: "worldInfo",
    family: "primary",
    objType: "irregularGeometry",
    allowObjTypeOmit: true
  },
  instancedList: {
    scope: "worldInfo",
    family: "primary",
    objType: "instanced",
    allowObjTypeOmit: true
  },
  audioList: {
    scope: "worldInfo",
    family: "overlay",
    objType: "audio",
    allowObjTypeOmit: true
  },
  skinnedList: {
    scope: "worldInfo",
    family: "import",
    objType: "skinned",
    allowObjTypeOmit: true
  },
  externalModelList: {
    scope: "worldInfo",
    family: "import",
    objType: "externalModel",
    allowObjTypeOmit: true
  },
  objModelList: {
    scope: "worldInfo",
    family: "import",
    objType: "externalModel",
    allowObjTypeOmit: true,
    defaults: {
      modelFileType: "obj"
    }
  },
  passList: {
    scope: "worldInfoOrSceneConfig",
    family: "runtime",
    objType: "pass",
    allowObjTypeOmit: true
  },
  domainModelList: {
    scope: "worldInfo",
    family: "domain",
    objType: "domain",
    allowObjTypeOmit: true
  },
  modelList: {
    scope: "topLevelOrWorldInfo",
    family: "mixed",
    allowObjTypeOmit: false,
    mixed: true
  },
  objectList: {
    scope: "topLevelOrWorldInfo",
    family: "mixed",
    allowObjTypeOmit: false,
    mixed: true
  }
};

function normalizeFriendlySceneListDefinition(listName, definition = {}, baseDefinition = {}) {
  const next = {
    listName,
    scope: "worldInfo",
    family: "custom",
    allowObjTypeOmit: false,
    mixed: false,
    preprocess: "",
    defaults: {},
    ...(baseDefinition || {})
  };
  if (!isPlainObject(definition)) {
    if (typeof definition === "string" && definition.trim()) {
      next.objType = definition.trim();
      next.allowObjTypeOmit = true;
    }
    return next;
  }
  if (typeof definition.scope === "string" && definition.scope) {
    next.scope = definition.scope;
  }
  if (typeof definition.family === "string" && definition.family) {
    next.family = definition.family;
  }
  if (typeof definition.objType === "string" && definition.objType.trim()) {
    next.objType = definition.objType.trim();
  }
  if (hasOwn(definition, "allowObjTypeOmit")) {
    next.allowObjTypeOmit = Boolean(definition.allowObjTypeOmit);
  } else if (next.objType) {
    next.allowObjTypeOmit = true;
  }
  if (hasOwn(definition, "mixed")) {
    next.mixed = Boolean(definition.mixed);
  }
  if (typeof definition.preprocess === "string" && definition.preprocess) {
    next.preprocess = definition.preprocess;
  }
  if (isPlainObject(definition.defaults)) {
    next.defaults = mergeDefaults(definition.defaults, next.defaults);
  }
  return next;
}

function resolveFriendlySceneMap(payload = {}) {
  const rootMap = isPlainObject(payload.friendlyMap) ? payload.friendlyMap : {};
  const worldMap = isPlainObject(payload?.worldInfo?.friendlyMap) ? payload.worldInfo.friendlyMap : {};
  const next = {};
  for (let i = 0; i < DEFAULT_FRIENDLY_SCENE_LIST_ORDER.length; i++) {
    const listName = DEFAULT_FRIENDLY_SCENE_LIST_ORDER[i];
    next[listName] = normalizeFriendlySceneListDefinition(
      listName,
      worldMap[listName] ?? rootMap[listName],
      DEFAULT_FRIENDLY_SCENE_LIST_MAP[listName]
    );
  }
  const customNames = new Set([
    ...Object.keys(rootMap),
    ...Object.keys(worldMap)
  ]);
  for (const listName of customNames) {
    if (hasOwn(next, listName)) {
      continue;
    }
    next[listName] = normalizeFriendlySceneListDefinition(
      listName,
      worldMap[listName] ?? rootMap[listName]
    );
  }
  return next;
}

function getFriendlySceneListEntries(payload = {}) {
  const resolvedMap = resolveFriendlySceneMap(payload);
  const orderedNames = [...DEFAULT_FRIENDLY_SCENE_LIST_ORDER];
  for (const listName of Object.keys(resolvedMap)) {
    if (!orderedNames.includes(listName)) {
      orderedNames.push(listName);
    }
  }
  return orderedNames.map((listName) => resolvedMap[listName]);
}

function applyFriendlySceneDefaults(record, definition = {}) {
  if (!record || typeof record !== "object") {
    return record;
  }
  if (!isPlainObject(definition.defaults) || Object.keys(definition.defaults).length <= 0) {
    return { ...record };
  }
  return mergeDefaults(record, definition.defaults);
}

export {
  DEFAULT_FRIENDLY_SCENE_LIST_MAP,
  DEFAULT_FRIENDLY_SCENE_LIST_ORDER,
  applyFriendlySceneDefaults,
  getFriendlySceneListEntries,
  resolveFriendlySceneMap
};
