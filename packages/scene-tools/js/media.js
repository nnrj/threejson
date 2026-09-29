import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { renderMediaInBrowser } from "./browser.js";

/** Uses an installed browser; never installs browsers, FFmpeg or paid services. */
export async function renderSceneMedia(options = {}) {
  if (!options.output) throw new Error("Media export requires an explicit output path.");
  const target = path.resolve(options.output), handle = await open(target, "wx");
  let successful = false;
  try {
    const requestedFormat = options.format || path.extname(target).slice(1).toLowerCase();
    const format = requestedFormat === "jpg" ? "jpeg" : requestedFormat;
    if (!["mp4", "webm", "gif", "png", "jpeg", "webp"].includes(format)) throw new Error("Select mp4, webm, gif, png, jpeg or webp.");
    const result = await renderMediaInBrowser({ ...options, mediaOptions: { ...options.mediaOptions, format }, onOutput: async (position, data) => {
      let written = 0;
      while (written < data.length) written += (await handle.write(data, written, data.length-written, position+written)).bytesWritten;
    } });
    successful = result.ok;
    return { ...result, output: successful ? target : null };
  } finally { await handle.close(); if (!successful) await unlink(target); }
}
