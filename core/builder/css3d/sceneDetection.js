/**
 * Detect whether payload declares css3dPanel (standard objectList, friendly css3dPanelList, subSceneList, nested subScene).
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function payloadHasCss3dPanels(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (recordsHaveCss3dPanel(payload.objectList)) {
    return true;
  }
  if (scanSubSceneListBlocks(payload.subSceneList)) {
    return true;
  }
  const worldInfo = payload.worldInfo;
  if (worldInfo && typeof worldInfo === "object") {
    if (recordsHaveCss3dPanel(worldInfo.css3dPanelList)) {
      return true;
    }
    if (recordsHaveCss3dPanel(worldInfo.objectList)) {
      return true;
    }
  }
  return false;
}

/** @param {unknown} list */
function recordsHaveCss3dPanel(list) {
  if (!Array.isArray(list)) {
    return false;
  }
  for (let i = 0; i < list.length; i++) {
    if (recordHasCss3dPanel(list[i])) {
      return true;
    }
  }
  return false;
}

/** @param {unknown} record */
function recordHasCss3dPanel(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const objType = String(record.objType || "").trim().toLowerCase();
  if (objType === "css3dpanel") {
    return true;
  }
  if (recordsHaveCss3dPanel(record.subScene)) {
    return true;
  }
  return false;
}

/** @param {unknown} blocks */
function scanSubSceneListBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return false;
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block || typeof block !== "object") {
      continue;
    }
    const objects = Array.isArray(block.objects)
      ? block.objects
      : Array.isArray(block.subScene)
        ? block.subScene
        : [];
    if (recordsHaveCss3dPanel(objects)) {
      return true;
    }
  }
  return false;
}
