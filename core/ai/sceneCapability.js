/**
 * Intent → capability hints and post-generation capability fit checks.
 * Does not penalize box-heavy scenes when the user prompt calls for them.
 */
import { DEFAULT_FRIENDLY_SCENE_LIST_ORDER } from "../handler/sceneFriendlyMap.js";

/** @typedef {{ id: string, patterns: RegExp[], lists?: string[], objTypes?: string[], note: string, boxFriendly?: boolean }} IntentSignal */

const INTENT_SIGNALS = [
  {
    id: "sphere",
    patterns: [/sphere|planet|ball|globe|dome|orb|太阳|月亮|星球|球体|球形/i],
    lists: ["sphereModelList"],
    objTypes: ["sphere"],
    note: "Use sphereModelList or objType sphere with geometry.radius."
  },
  {
    id: "cylinder",
    patterns: [/cylinder|column|pillar|pipe|圆柱|柱/i],
    lists: ["modelList"],
    objTypes: ["cylinder"],
    note: "Use modelList with objType cylinder and radiusTop/radiusBottom/height."
  },
  {
    id: "cone",
    patterns: [/cone|pyramid|圆锥|锥/i],
    lists: ["modelList"],
    objTypes: ["cone"],
    note: "Use modelList with objType cone and radius/height."
  },
  {
    id: "torus",
    patterns: [/torus|donut|ring shape|圆环(?!线)|环面/i],
    lists: ["modelList"],
    objTypes: ["torus"],
    note: "Use modelList with objType torus (radius, tube, segments)."
  },
  {
    id: "ring",
    patterns: [/flat ring|ring geometry|平面环|环片/i],
    lists: ["modelList"],
    objTypes: ["ring"],
    note: "Use modelList with objType ring (innerRadius, outerRadius)."
  },
  {
    id: "capsule",
    patterns: [/capsule|pill shape|胶囊/i],
    lists: ["modelList"],
    objTypes: ["capsule"],
    note: "Use modelList with objType capsule (radius, length)."
  },
  {
    id: "line",
    patterns: [/line|path|route|cable|wire|boundary|polyline|道路|路径|管线|边界|折线/i],
    lists: ["lineList"],
    objTypes: ["line"],
    note: "Use lineList with points[] and optional topology."
  },
  {
    id: "infoPanel",
    patterns: [/label|sign|hud|billboard text|info panel|看板|标签|标牌|信息牌/i],
    lists: ["infoPanelList"],
    objTypes: ["infoPanel"],
    note: "Use infoPanelList with type text|html|img (static panel backing; not clickable)."
  },
  {
    id: "css3dPanel",
    patterns: [
      /css3d|interactive panel|clickable(?:\s+\w+)*\s+panel|form panel|iframe panel|dom panel|control panel|控制台|可点击|表单面板/i
    ],
    lists: ["css3dPanelList", "objectList"],
    objTypes: ["css3dPanel"],
    note: "Use css3dPanelList with objType css3dPanel (html or url); host must enable CSS3D pass."
  },
  {
    id: "sceneText",
    patterns: [
      /3d text|floating text|scene text|floor label|title text|extruded text|sdf text|立体字|场景文字|悬浮文字|纯文字/i
    ],
    lists: ["objectList"],
    objTypes: ["text"],
    note: "Use objectList objType text (mode sdf|texture|mesh). Not infoPanelList unless a panel is required."
  },
  {
    id: "group",
    patterns: [/group|assembly|rig|compound|组合|分组|装配/i],
    lists: ["groupList"],
    objTypes: ["group"],
    note: "Use groupList; children in subScene[] on each group record (not boxModelList/subGroup on the group)."
  },
  {
    id: "floor",
    patterns: [/floor|ground|slab|terrain base|地面|地板|地坪/i],
    lists: ["boxModelList", "floorList"],
    objTypes: ["floor"],
    note: "Use objType floor in boxModelList or floorList."
  },
  {
    id: "wall",
    patterns: [/wall|facade|fence|curtain wall|墙|幕墙|围栏/i],
    lists: ["boxModelList", "wallList", "domainModelList"],
    objTypes: ["wall"],
    note: "Use objType wall or domainModelList domain wall."
  },
  {
    id: "glass",
    patterns: [/glass|window|glazing|透明玻璃|窗户|玻璃/i],
    lists: ["boxModelList", "glassList"],
    objTypes: ["glass"],
    note: "Use objType glass with glassKind when needed."
  },
  {
    id: "particles",
    patterns: [/particle|points|starfield|dust|spark|粒子|星尘|点云/i],
    lists: ["objectList", "particleList", "domainModelList"],
    objTypes: ["particleEmitter", "points"],
    note: "Prefer objectList objType particleEmitter (simulation cpu|gpuCompute); particleList/points is legacy."
  },
  {
    id: "weather",
    patterns: [/rain|snow|weather|ember|sparkle|雨|雪|天气/i],
    lists: ["particleList", "domainModelList"],
    objTypes: ["points", "domain"],
    note: "Use particleList or domainModelList domain weather."
  },
  {
    id: "tube",
    patterns: [/tube|spline path|catmull|管道|样条/i],
    lists: ["tubeList"],
    objTypes: ["tube"],
    note: "Use tubeList with path.type catmullRom and points."
  },
  {
    id: "sprite",
    patterns: [/sprite|billboard|marker icon|精灵|广告牌/i],
    lists: ["spriteList"],
    objTypes: ["sprite"],
    note: "Use spriteList for textured billboards."
  },
  {
    id: "instanced",
    patterns: [/instanc|grid of|阵列|实例化/i],
    lists: ["instancedList"],
    objTypes: ["instanced"],
    note: "Use instancedList with transforms[]."
  },
  {
    id: "native",
    patterns: [
      /native|torus knot|lathe|dodecahedron|icosahedron|octahedron|tetrahedron|extrude geometry|three\.js geometry|TorusKnot|LatheGeometry/i
    ],
    lists: ["objectList"],
    objTypes: ["native"],
    note: "Use objType native or geometry.type (e.g. TorusKnotGeometry) with parseMode auto|native."
  },
  {
    id: "cameraControl",
    patterns: [/orthographic|ortho|isometric|bird.?eye|fly controls|fly mode|正交相机|俯视|飞行控制/i],
    lists: ["objectList"],
    objTypes: ["camera", "controls"],
    note: "Use sceneConfig/objectList camera with type orthographic when requested, and controls.type fly for roaming."
  },
  {
    id: "external",
    patterns: [/gltf|glb|obj model|fbx|外部模型|导入模型/i],
    lists: ["externalModelList", "objModelList"],
    objTypes: ["externalModel"],
    note: "Use externalModelList or objModelList with modelPath."
  },
  {
    id: "heat",
    patterns: [/heatmap|heat map|热力图|热场/i],
    lists: ["heatList"],
    objTypes: ["heatMap"],
    note: "Use heatList with heatMap data array."
  },
  {
    id: "shaderSurface",
    patterns: [/shader surface|custom shader|glsl plane|shader plane|着色器面|自定义着色器/i],
    lists: ["shaderSurfaceList", "objectList"],
    objTypes: ["shaderSurface"],
    note: "Use shaderSurfaceList with objType shaderSurface and shaderSource/material."
  },
  {
    id: "wind",
    patterns: [/wind strip|wind field|风场|风带/i],
    lists: ["windList"],
    objTypes: ["wind"],
    note: "Use windList for animated wind strips."
  },
  {
    id: "audio",
    patterns: [/audio|sound|ambient|spatial audio|音效|音频|环境声/i],
    lists: ["audioList"],
    objTypes: ["audio"],
    note: "Use audioList with audioUrl and mode positional|ambient."
  },
  {
    id: "blockout",
    patterns: [/blockout|placeholder|abstract block|灰盒|体块|全是盒|only box|boxes only|方块/i],
    boxFriendly: true,
    note: "Box-heavy blockout is appropriate for this prompt."
  },
  {
    id: "animationGraph",
    patterns: [
      /animation graph|state machine|animator controller|blend tree|动画状态机|状态机动画/i
    ],
    objTypes: ["animationGraph"],
    note: "Use glTF clips with animationGraph block (parameters, states, transitions) when user asks for state-machine style animation."
  }
];

/**
 * @param {string} prompt
 * @returns {IntentSignal[]}
 */
function matchIntentSignals(prompt) {
  const text = String(prompt || "");
  if (!text.trim()) {
    return [];
  }
  return INTENT_SIGNALS.filter((signal) => signal.patterns.some((re) => re.test(text)));
}

/**
 * @param {string} prompt
 * @returns {string}
 */
function buildIntentHints(prompt) {
  const matched = matchIntentSignals(prompt);
  if (matched.length === 0) {
    return "";
  }
  const lines = matched.map((signal) => `- ${signal.note}`);
  return `Capability hints inferred from the user prompt:\n${lines.join("\n")}`;
}

const COMMAND_INTENT_NOTES = {
  group:
    "Multi-part assembly (command mode): object.add objType group with explicit threeJsonId first, then object.add parent=<that id> for each part (box, sphere, cylinder, …). Rotate/move the whole assembly via object.patch on the group threeJsonId."
};

/**
 * Command-mode intent hints (maps assembly keywords to parent= workflow).
 * @param {string} prompt
 * @returns {string}
 */
function buildCommandIntentHints(prompt) {
  const matched = matchIntentSignals(prompt);
  if (matched.length === 0) {
    return "";
  }
  const lines = matched.map((signal) => {
    const commandNote = COMMAND_INTENT_NOTES[signal.id];
    if (commandNote) {
      return `- ${commandNote}`;
    }
    return `- Command mode: use object.add / object.patch — JSON-only hint: ${signal.note}`;
  });
  return `Capability hints for this request:\n${lines.join("\n")}`;
}

/**
 * @param {object} sceneObj
 * @returns {{ listsUsed: string[], objTypes: Set<string>, totalItems: number }}
 */
function analyzeSceneUsage(sceneObj) {
  const listsUsed = [];
  const objTypes = new Set();
  let totalItems = 0;

  const wi = sceneObj?.worldInfo;
  if (wi && typeof wi === "object") {
    for (let i = 0; i < DEFAULT_FRIENDLY_SCENE_LIST_ORDER.length; i += 1) {
      const listName = DEFAULT_FRIENDLY_SCENE_LIST_ORDER[i];
      const arr = wi[listName];
      if (Array.isArray(arr) && arr.length > 0) {
        listsUsed.push(listName);
        totalItems += arr.length;
        for (let j = 0; j < arr.length; j += 1) {
          collectObjTypes(arr[j], objTypes);
        }
      }
    }
  }

  const objectList = sceneObj?.objectList;
  if (Array.isArray(objectList) && objectList.length > 0) {
    if (!listsUsed.includes("objectList")) {
      listsUsed.push("objectList");
    }
    totalItems += objectList.length;
    for (let i = 0; i < objectList.length; i += 1) {
      collectObjTypes(objectList[i], objTypes);
    }
  }

  return { listsUsed, objTypes, totalItems };
}

/**
 * @param {object} record
 * @param {Set<string>} objTypes
 */
function collectObjTypes(record, objTypes) {
  if (!record || typeof record !== "object") {
    return;
  }
  if (typeof record.objType === "string" && record.objType.trim()) {
    objTypes.add(record.objType.trim());
  }
  if (record.geometry?.type && typeof record.geometry.type === "string") {
    objTypes.add("native");
  }
  if (record.parseMode === "native") {
    objTypes.add("native");
  }
  const nestedLists = ["boxModelList", "subGroup", "joins", "inters", "holes", "children"];
  for (let i = 0; i < nestedLists.length; i += 1) {
    const key = nestedLists[i];
    const nested = record[key];
    if (Array.isArray(nested)) {
      for (let j = 0; j < nested.length; j += 1) {
        collectObjTypes(nested[j], objTypes);
      }
    }
  }
}

/**
 * @param {IntentSignal} signal
 * @param {{ listsUsed: string[], objTypes: Set<string> }} usage
 * @returns {boolean}
 */
function signalSatisfied(signal, usage) {
  if (signal.boxFriendly) {
    return true;
  }
  const listHit =
    !signal.lists || signal.lists.some((listName) => usage.listsUsed.includes(listName));
  const typeHit =
    !signal.objTypes ||
    signal.objTypes.some((typeName) => usage.objTypes.has(typeName));
  return listHit && typeHit;
}

/**
 * @param {string} prompt
 * @param {object} sceneObj
 * @returns {{ ok: boolean, matchedSignals: string[], gaps: string[], blockoutOk: boolean }}
 */
function evaluateCapabilityFit(prompt, sceneObj) {
  const matched = matchIntentSignals(prompt);
  const usage = analyzeSceneUsage(sceneObj);

  if (matched.length === 0) {
    return { ok: true, matchedSignals: [], gaps: [], blockoutOk: false };
  }

  const blockoutOk = matched.some((signal) => signal.boxFriendly === true);
  if (blockoutOk) {
    return {
      ok: true,
      matchedSignals: matched.map((s) => s.id),
      gaps: [],
      blockoutOk: true
    };
  }

  const gaps = [];
  for (let i = 0; i < matched.length; i += 1) {
    const signal = matched[i];
    if (signal.boxFriendly) {
      continue;
    }
    if (!signalSatisfied(signal, usage)) {
      gaps.push(signal.note);
    }
  }

  return {
    ok: gaps.length === 0,
    matchedSignals: matched.map((s) => s.id),
    gaps,
    blockoutOk: false
  };
}

/**
 * @param {string} userPrompt
 * @param {{ gaps: string[] }} fit
 * @returns {string}
 */
function buildCapabilityFixPrompt(userPrompt, fit) {
  const gapBlock = fit.gaps.map((g) => `- ${g}`).join("\n");
  return [
    "Improve this ThreeJSON scene so it better matches the user's intent using appropriate engine capabilities.",
    "Keep existing layout and IDs where possible; add or replace objects with the correct lists/objTypes/geometry fields.",
    "Do not remove content unless necessary.",
    "",
    `User intent: ${userPrompt}`,
    "",
    "Missing or underused capabilities:",
    gapBlock
  ].join("\n");
}

export {
  INTENT_SIGNALS,
  matchIntentSignals,
  buildIntentHints,
  buildCommandIntentHints,
  analyzeSceneUsage,
  evaluateCapabilityFit,
  buildCapabilityFixPrompt
};
