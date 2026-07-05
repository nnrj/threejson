/**
 * Browser-side texture sinks for fillTextureUrls (File System Access, upload, ZIP fallback).
 */

/**
 * @param {string} pathPrefix e.g. "/assets/textures/ai-generated"
 * @returns {Promise<{ saveLocal: (blob: Blob, meta: object) => Promise<string> }>}
 */
export function createDirectorySink(directoryHandle, pathPrefix = "/assets/textures/ai-generated") {
  if (!directoryHandle || typeof directoryHandle.getFileHandle !== "function") {
    throw new Error("createDirectorySink: valid directory handle required.");
  }
  const prefix = String(pathPrefix || "/assets/textures/ai-generated").replace(/\/+$/, "");

  async function ensureSubdir(name) {
    return directoryHandle.getDirectoryHandle(name, { create: true });
  }

  return {
    async saveLocal(blob, meta) {
      const ext =
        meta.mimeType && meta.mimeType.includes("jpeg")
          ? "jpg"
          : meta.mimeType && meta.mimeType.includes("webp")
            ? "webp"
            : "png";
      const fileName = `texture-${meta.index ?? 0}-${hashPointer(meta.pointer)}.${ext}`;
      const sub = await ensureSubdir("ai-generated");
      const fileHandle = await sub.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return `${prefix}/${fileName}`;
    }
  };
}

/**
 * @param {{ endpoint: string, headers?: Record<string,string>, fieldName?: string }} config
 */
export function createUploadSink(config) {
  const endpoint = config?.endpoint;
  if (!endpoint) {
    throw new Error("createUploadSink: endpoint URL required.");
  }
  const fieldName = config.fieldName || "file";
  const headers = config.headers || {};

  return {
    async upload(blob, meta) {
      const form = new FormData();
      const ext = blob.type?.includes("jpeg") ? "jpg" : "png";
      form.append(fieldName, blob, `texture-${meta.index ?? 0}.${ext}`);
      const resp = await fetch(endpoint, { method: "POST", headers, body: form });
      if (!resp.ok) {
        throw new Error(`Upload failed: ${resp.status}`);
      }
      const data = await resp.json().catch(() => ({}));
      const url = data.url || data.data?.url || data.link;
      if (!url) {
        throw new Error("Upload response missing url field.");
      }
      return String(url);
    }
  };
}

/** Collect blobs and offer a single ZIP download (no FS permission). */
export function createZipDownloadSink() {
  /** @type {{ name: string, blob: Blob }[]} */
  const pending = [];

  return {
    async saveLocal(blob, meta) {
      const ext = blob.type?.includes("jpeg") ? "jpg" : "png";
      const name = `texture-${meta.index ?? 0}-${hashPointer(meta.pointer)}.${ext}`;
      pending.push({ name, blob });
      return `pending-zip://${name}`;
    },
    async finalizeDownload(zipBaseName = "threejson-textures") {
      if (!pending.length) {
        return { count: 0 };
      }
      if (typeof JSZip === "undefined") {
        for (const { name, blob } of pending) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          URL.revokeObjectURL(a.href);
        }
        return { count: pending.length, mode: "individual" };
      }
      const zip = new JSZip();
      pending.forEach(({ name, blob }) => {
        zip.file(name, blob);
      });
      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = `${zipBaseName}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      pending.length = 0;
      return { count: pending.length, mode: "zip" };
    },
    getPendingCount() {
      return pending.length;
    }
  };
}

function hashPointer(ptr) {
  let h = 0;
  const s = String(ptr);
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 12);
}
