import { listMaterialSlotsForDescriptor } from "../../../../core/util/materialDescriptorWalk.js";

export function boxUsesIntentionalMaterialsArray(data) {
  return Array.isArray(data?.materials) && data.materials.length > 0;
}

export function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, n));
}

export function toHexColorString(value, fallback = "#ffffff") {
  const raw = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw;
  }
  return fallback;
}

export function readMaterialFieldFromObjJson(data, key, fallback = null) {
  if (boxUsesIntentionalMaterialsArray(data)) {
    const slot = data.materials[0];
    if (slot && typeof slot === "object" && slot[key] !== undefined) {
      return slot[key];
    }
    return fallback;
  }
  const mat = data?.material;
  if (mat && typeof mat === "object" && mat[key] !== undefined) {
    return mat[key];
  }
  const arr = data?.materials;
  if (Array.isArray(arr) && arr[0] && typeof arr[0] === "object" && arr[0][key] !== undefined) {
    return arr[0][key];
  }
  return fallback;
}

export function writeMaterialFieldToObjJson(data, key, value) {
  if (!data || typeof data !== "object") {
    return;
  }
  if (boxUsesIntentionalMaterialsArray(data)) {
    for (let i = 0; i < data.materials.length; i += 1) {
      const slot = data.materials[i];
      if (slot && typeof slot === "object") {
        slot[key] = value;
      }
    }
    return;
  }
  if (!data.material || typeof data.material !== "object") {
    data.material = {};
  }
  data.material[key] = value;
  if (Array.isArray(data.materials) && data.materials[0] && typeof data.materials[0] === "object") {
    data.materials[0][key] = value;
  }
}

export function writeTextureUrlToObjJson(data, url) {
  if (!data || typeof data !== "object") {
    return;
  }
  const trimmed = String(url ?? "").trim();
  if (boxUsesIntentionalMaterialsArray(data)) {
    for (let i = 0; i < data.materials.length; i += 1) {
      const slot = data.materials[i];
      if (slot && typeof slot === "object") {
        if (trimmed) {
          slot.textureUrl = trimmed;
        } else {
          delete slot.textureUrl;
        }
      }
    }
    return;
  }
  if (!data.material || typeof data.material !== "object") {
    data.material = {};
  }
  if (trimmed) {
    data.material.textureUrl = trimmed;
  } else {
    delete data.material.textureUrl;
  }
  if (Array.isArray(data.materials) && data.materials[0] && typeof data.materials[0] === "object") {
    if (trimmed) {
      data.materials[0].textureUrl = trimmed;
    } else {
      delete data.materials[0].textureUrl;
    }
  }
}

export function clampTextureRepeatComponent(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0.01, n);
}

export function isDefaultTextureRepeat(repeat) {
  return repeat?.x === 1 && repeat?.y === 1;
}

export function readTextureRepeatFromObjJson(data) {
  const tr = readMaterialFieldFromObjJson(data, "textureRepeat", null);
  if (tr && typeof tr === "object" && !Array.isArray(tr)) {
    return {
      x: clampTextureRepeatComponent(tr.x, 1),
      y: clampTextureRepeatComponent(tr.y, 1)
    };
  }
  return { x: 1, y: 1 };
}

export function writeTextureRepeatToObjJson(data, repeat) {
  const normalized = {
    x: clampTextureRepeatComponent(repeat?.x, 1),
    y: clampTextureRepeatComponent(repeat?.y, 1)
  };
  if (isDefaultTextureRepeat(normalized)) {
    if (data.material && typeof data.material === "object") {
      delete data.material.textureRepeat;
    }
    if (Array.isArray(data.materials)) {
      for (const entry of data.materials) {
        if (entry && typeof entry === "object") {
          delete entry.textureRepeat;
        }
      }
    }
    return;
  }
  writeMaterialFieldToObjJson(data, "textureRepeat", normalized);
}

export function shouldRedeployForDescriptorMaterial(data) {
  if (!data) {
    return false;
  }
  if (boxUsesIntentionalMaterialsArray(data)) {
    return true;
  }
  const slots = listMaterialSlotsForDescriptor(data);
  return Array.isArray(slots) && slots.length > 0;
}
