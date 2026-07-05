import {
  createDirectorySink,
  createUploadSink,
  createZipDownloadSink
} from "../../../../../core/ai/index.js";
import { DESKTOP_CAPABILITIES } from "./hostPlatform.js";

export function createDesktopTextureSink(platform) {
  return {
    saveLocal: async (blob, meta) => {
      const ext = blob.type?.includes("jpeg") ? "jpg" : "png";
      const rel = `assets/textures/ai-generated/texture-${meta?.index ?? 0}.${ext}`;
      const buf = new Uint8Array(await blob.arrayBuffer());
      return platform.invoke(DESKTOP_CAPABILITIES.textureWrite, rel, buf);
    }
  };
}

export function createBrowserTextureSink(dom) {
  const mode = dom.textureBrowserMode?.value || "directory";
  if (mode === "upload") {
    const endpoint = dom.textureUploadEndpoint?.value?.trim();
    if (!endpoint) {
      throw new Error("请填写图床 upload endpoint。");
    }
    return createUploadSink({ endpoint });
  }
  if (mode === "zipDownload") {
    const sink = createZipDownloadSink();
    dom._textureZipSink = sink;
    return sink;
  }
  if (!dom._textureDirectoryHandle) {
    throw new Error("请先点击「选择纹理输出目录」授权本地目录。");
  }
  return createDirectorySink(dom._textureDirectoryHandle);
}

export function createTextureSink(platform, dom) {
  if (platform?.has?.(DESKTOP_CAPABILITIES.textureWrite)) {
    return createDesktopTextureSink(platform);
  }
  return createBrowserTextureSink(dom);
}
