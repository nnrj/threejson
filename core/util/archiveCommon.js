/**
 * Archive helpers shared by tjz parser/packer.
 */

const ZIP_MAGIC_0 = 0x50; // P
const ZIP_MAGIC_1 = 0x4b; // K
const ZIP_MAGIC_2A = 0x03;
const ZIP_MAGIC_3A = 0x04;
const ZIP_MAGIC_2B = 0x05;
const ZIP_MAGIC_3B = 0x06;
const ZIP_MAGIC_2C = 0x07;
const ZIP_MAGIC_3C = 0x08;

function hasValue(value) {
  return value !== undefined && value !== null;
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function isZipMagic(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return false;
  }
  if (bytes[0] !== ZIP_MAGIC_0 || bytes[1] !== ZIP_MAGIC_1) {
    return false;
  }
  const b2 = bytes[2];
  const b3 = bytes[3];
  return (
    (b2 === ZIP_MAGIC_2A && b3 === ZIP_MAGIC_3A)
    || (b2 === ZIP_MAGIC_2B && b3 === ZIP_MAGIC_3B)
    || (b2 === ZIP_MAGIC_2C && b3 === ZIP_MAGIC_3C)
  );
}

function normalizeArchivePath(path) {
  const raw = String(path || "").replace(/\\/g, "/").trim();
  if (!raw) {
    return "";
  }
  const stripped = raw.replace(/^\/+/, "");
  const pieces = stripped.split("/").filter(Boolean);
  const normalized = [];
  for (let i = 0; i < pieces.length; i++) {
    const one = pieces[i];
    if (one === ".") {
      continue;
    }
    if (one === "..") {
      throw new Error(`[archive] illegal path segment '..': ${path}`);
    }
    normalized.push(one);
  }
  return normalized.join("/");
}

function isLikelyJsonString(text) {
  const s = String(text || "").trim();
  return s.startsWith("{") || s.startsWith("[");
}

function normalizeArchiveExt(pathLike) {
  const s = String(pathLike || "").trim().toLowerCase();
  const clean = s.split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function isArchiveExtension(pathLike) {
  const ext = normalizeArchiveExt(pathLike);
  return ext === "tjz" || ext === "threejson" || ext === "tjson" || ext === "zip";
}

function isPackRef(value) {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("pack://");
}

function parsePackRef(value) {
  if (!isPackRef(value)) {
    return "";
  }
  const body = value.trim().slice("pack://".length);
  return normalizeArchivePath(body);
}

async function readInputAsUint8Array(input) {
  const bytes = toUint8Array(input);
  if (bytes) {
    return bytes;
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const ab = await input.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof Response !== "undefined" && input instanceof Response) {
    const ab = await input.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof input === "string" && input.trim()) {
    const text = input.trim();
    if (isLikelyJsonString(text)) {
      throw new Error("[archive] input string looks like JSON text, not archive bytes/url");
    }
    const res = await fetch(text);
    if (!res.ok) {
      throw new Error(`[archive] fetch failed: ${res.status} ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error("[archive] unsupported binary input type");
}

function createObjectUrlRegistry() {
  const urls = [];
  return {
    add(blob) {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        throw new Error("[archive] URL.createObjectURL is not available in current environment");
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    },
    dispose() {
      if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
        return;
      }
      for (let i = 0; i < urls.length; i++) {
        URL.revokeObjectURL(urls[i]);
      }
      urls.length = 0;
    },
    size() {
      return urls.length;
    }
  };
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

export {
  createObjectUrlRegistry,
  isArchiveExtension,
  isLikelyJsonString,
  isPackRef,
  isZipMagic,
  normalizeArchiveExt,
  normalizeArchivePath,
  parsePackRef,
  readInputAsUint8Array,
  toUint8Array
};
