/**
 * Walk material slots on box-like descriptors (shared by editor, AI texture pipeline).
 */

/** BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z */
export const BOX_FACE_LABELS = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

/**
 * Build nested path prefix from a JSON path (excludes object name; empty at root).
 * @param {string} basePath e.g. "" or "/joins/0"
 * @returns {string} e.g. "joins[0] · " or ""
 */
function formatNestedPathLabelPrefix(basePath) {
  const trimmed = String(basePath ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const segs = trimmed.replace(/^\//, "").split("/").filter(Boolean);
  if (!segs.length) {
    return "";
  }
  const parts = [];
  for (let i = 0; i < segs.length; ) {
    const key = segs[i];
    const idx = segs[i + 1];
    if (idx !== undefined && /^\d+$/.test(idx)) {
      parts.push(`${key}[${idx}]`);
      i += 2;
    } else {
      parts.push(key);
      i += 1;
    }
  }
  return parts.length ? `${parts.join(" / ")} · ` : "";
}

/**
 * @param {unknown[]} models
 * @param {string} basePointer with leading /
 * @param {MaterialSlot[]} out
 */
function walkBoxModelsForMaterialSlots(models, basePointer, out) {
  if (!Array.isArray(models)) {
    return;
  }
  models.forEach((model, i) => {
    if (!model || typeof model !== "object") {
      return;
    }
    const p = basePointer ? `${basePointer}/${i}` : "";
    const prefix = formatNestedPathLabelPrefix(p);

    if (model.material && typeof model.material === "object") {
      const hasSix =
        Array.isArray(model.materials) &&
        model.materials.length >= 6 &&
        model.materials.some((m) => m && typeof m === "object");
      if (!hasSix) {
        const matPtr = p ? `${p}/material` : "/material";
        out.push({
          pointer: matPtr.startsWith("/") ? matPtr : `/${matPtr}`,
          label: `${prefix}material（六面共用）`,
          slotKind: "material"
        });
      }
    }
    if (Array.isArray(model.materials)) {
      model.materials.forEach((mat, j) => {
        if (!mat || typeof mat !== "object") {
          return;
        }
        const faceLabel = BOX_FACE_LABELS[j] ?? `面${j}`;
        const slotPtr = p ? `${p}/materials/${j}` : `/materials/${j}`;
        out.push({
          pointer: slotPtr.startsWith("/") ? slotPtr : `/${slotPtr}`,
          label: `${prefix}materials[${j}]（${faceLabel}）`,
          slotKind: "materials",
          faceIndex: j
        });
      });
    }
    const nested = [
      ["joins", model.joins],
      ["inters", model.inters],
      ["holes", model.holes]
    ];
    nested.forEach(([key, list]) => {
      if (Array.isArray(list)) {
        const nestedBase = p ? `${p}/${key}` : `/${key}`;
        walkBoxModelsForMaterialSlots(list, nestedBase, out);
      }
    });
  });
}

/**
 * @typedef {object} MaterialSlot
 * @property {string} pointer RFC6901 to material object
 * @property {string} label
 * @property {"material"|"materials"} [slotKind]
 * @property {number} [faceIndex]
 */

/**
 * @param {object} descriptor
 * @returns {MaterialSlot[]}
 */
function listMaterialSlotsForDescriptor(descriptor) {
  const out = [];
  if (!descriptor || typeof descriptor !== "object") {
    return out;
  }
  walkBoxModelsForMaterialSlots([descriptor], "", out);
  return out;
}

/**
 * @param {unknown[]} models
 * @param {string} basePointer
 * @param {string[]} out
 */
function walkBoxModelsForTextureUrlPointers(models, basePointer, out) {
  if (!Array.isArray(models)) {
    return;
  }
  models.forEach((model, i) => {
    if (!model || typeof model !== "object") {
      return;
    }
    const p = `${basePointer}/${i}`;
    if (model.material && typeof model.material === "object") {
      out.push(`${p}/material/textureUrl`);
    }
    if (Array.isArray(model.materials)) {
      model.materials.forEach((mat, j) => {
        if (mat && typeof mat === "object") {
          out.push(`${p}/materials/${j}/textureUrl`);
        }
      });
    }
    const nested = [
      ["joins", model.joins],
      ["inters", model.inters],
      ["holes", model.holes]
    ];
    nested.forEach(([key, list]) => {
      if (Array.isArray(list)) {
        walkBoxModelsForTextureUrlPointers(list, `${p}/${key}`, out);
      }
    });
  });
}

/**
 * @param {object} sceneObj
 * @returns {string[]}
 */
function listTextureUrlPointers(sceneObj) {
  const out = [];
  const root = sceneObj?.worldInfo?.boxModelList;
  if (Array.isArray(root)) {
    walkBoxModelsForTextureUrlPointers(root, "/worldInfo/boxModelList", out);
  }
  return out;
}

export {
  walkBoxModelsForMaterialSlots,
  walkBoxModelsForTextureUrlPointers,
  listMaterialSlotsForDescriptor,
  listTextureUrlPointers
};
