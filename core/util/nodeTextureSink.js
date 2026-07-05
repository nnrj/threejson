/**
 * Node-only texture persistence helpers for external tools (CLI / MCP / bridge).
 * Not exported from core/index.js — import this path only in Node runners.
 */
import path from "node:path";
import { toSiteRelativeTexturePath } from "../ai/textureAiService.js";

function hashPointer(ptr) {
  let h = 0;
  const s = String(ptr);
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 12);
}

/**
 * @param {string} outputDir
 * @param {Blob} blob
 * @param {{ pointer: string, index: number, mimeType?: string }} meta
 * @param {string} [projectRoot]
 */
export async function saveTextureBlobToLocalDir(outputDir, blob, meta, projectRoot) {
  const fs = await import("node:fs/promises");
  const ext =
    meta.mimeType && meta.mimeType.includes("png")
      ? "png"
      : meta.mimeType && (meta.mimeType.includes("jpeg") || meta.mimeType.includes("jpg"))
        ? "jpg"
        : "png";
  const safeName = `texture-${meta.index}-${hashPointer(meta.pointer)}.${ext}`;
  const dir = path.resolve(outputDir);
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, safeName);
  const buf = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(full, buf);
  return toSiteRelativeTexturePath(full, projectRoot);
}

/**
 * @param {string} localOutputDir
 * @param {string} [projectRoot]
 * @returns {{ saveLocal: (blob: Blob, meta: object) => Promise<string> }}
 */
export function createLocalOutputDirSink(localOutputDir, projectRoot) {
  const dir = path.resolve(localOutputDir);
  return {
    saveLocal: (blob, meta) => saveTextureBlobToLocalDir(dir, blob, meta, projectRoot)
  };
}

/**
 * Maps legacy `localOutputDir` fillTextureUrls / runSceneAgent options to a sink.
 * @param {object} options
 * @returns {object}
 */
export function withNodeTextureSink(options = {}) {
  const { localOutputDir, projectRoot, sink, ...rest } = options;
  if (sink?.saveLocal || sink?.upload) {
    return { ...rest, sink, projectRoot };
  }
  if (localOutputDir) {
    return {
      ...rest,
      sink: createLocalOutputDirSink(localOutputDir, projectRoot),
      projectRoot
    };
  }
  return { ...rest, sink };
}
