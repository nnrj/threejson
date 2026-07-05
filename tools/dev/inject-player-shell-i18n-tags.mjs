/**
 * Inject data-i18n / data-i18n-title from player-shell.zh-CN.json into player/index.html
 * Usage: node tools/dev/inject-player-shell-i18n-tags.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const htmlPath = path.join(root, "tools/scene-host/player/index.html");
const zhPath = path.join(root, "tools/scene-host/shared/i18n/locales/player-shell.zh-CN.json");
const zh = JSON.parse(fs.readFileSync(zhPath, "utf8"));

let html = fs.readFileSync(htmlPath, "utf8");

function upsertAttr(openTag, attrName, attrValue) {
  if (new RegExp(`\\s${attrName}=`).test(openTag)) {
    return openTag.replace(
      new RegExp(`\\s${attrName}="[^"]*"`),
      ` ${attrName}="${attrValue}"`
    );
  }
  return `${openTag} ${attrName}="${attrValue}"`;
}

function tagId(id, key, kind = "i18n") {
  const attr =
    kind === "title" ? "data-i18n-title" : kind === "aria" ? "data-i18n-aria" : "data-i18n";
  const re = new RegExp(`(<[a-zA-Z][^>]*\\sid="${id}"[^>]*)(>)`, "g");
  html = html.replace(re, (full, open, close) => {
    if (open.includes(`${attr}=`)) {
      return full;
    }
    return upsertAttr(open, attr, key) + close;
  });
}

let idCount = 0;
let titleCount = 0;
let menuCount = 0;

for (const [key, zhText] of Object.entries(zh)) {
  const titleMatch = key.match(/^player\.shell\.([a-zA-Z][a-zA-Z0-9]*)\.title$/);
  if (titleMatch) {
    tagId(titleMatch[1], key, "title");
    titleCount++;
    continue;
  }
  const ariaMatch = key.match(/^player\.shell\.([a-zA-Z][a-zA-Z0-9]*)\.aria$/);
  if (ariaMatch) {
    tagId(ariaMatch[1], key, "aria");
    titleCount++;
    continue;
  }
  const idMatch = key.match(/^player\.shell\.([a-zA-Z][a-zA-Z0-9]*)$/);
  if (idMatch) {
    tagId(idMatch[1], key, "i18n");
    idCount++;
    continue;
  }
  if (key.startsWith("player.menu.")) {
    const escaped = zhText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(<summary[^>]*)(>\\s*${escaped}\\s*</summary>)`);
    if (re.test(html)) {
      html = html.replace(re, (m, open, rest) => {
        if (open.includes("data-i18n=")) {
          return m;
        }
        return upsertAttr(open, "data-i18n", key) + rest;
      });
      menuCount++;
    }
  }
}

const panelTitleKey = "player.shell.playlistPanelTitle";
if (zh[panelTitleKey]) {
  const escaped = zh[panelTitleKey].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(
    new RegExp(`(<div class="panelTitle")(>\\s*${escaped}\\s*</div>)`),
    (m, open, rest) => {
      if (open.includes("data-i18n=")) {
        return m;
      }
      return upsertAttr(open, "data-i18n", panelTitleKey) + rest;
    }
  );
}

const dialogTitleKey = "player.shell.sceneJsonDialogTitle";
if (zh[dialogTitleKey]) {
  const escaped = zh[dialogTitleKey].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(
    new RegExp(`(<div class="sceneJsonDialogHeader">\\s*<span)(>\\s*${escaped}\\s*</span>)`),
    (m, open, rest) => upsertAttr(open, "data-i18n", dialogTitleKey) + rest
  );
}

const copyLabelKey = "player.shell.playlistContextCopyLabel";
if (zh[copyLabelKey]) {
  const escaped = zh[copyLabelKey].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(
    new RegExp(`(<span)(>\\s*${escaped}\\s*</span>)`),
    (m, open, rest) => {
      if (open.includes("data-i18n=")) {
        return m;
      }
      return upsertAttr(open, "data-i18n", copyLabelKey) + rest;
    }
  );
}

const ariaTags = [
  ["sceneJsonModal", "player.shell.sceneJsonModal.aria"],
  ["playlistList", "player.shell.playlistList"],
  ["playlistContextMenu", "player.shell.playlistContextMenu.aria"],
  ["playlistContextSubmenu", "player.shell.playlistContextCopySubmenu.aria"]
];
for (const [id, key] of ariaTags) {
  const re = new RegExp(`(<[a-zA-Z][^>]*\\sid="${id}"[^>]*)(>)`, "g");
  html = html.replace(re, (full, open, close) => {
    if (open.includes("data-i18n-aria=")) {
      return full;
    }
    return upsertAttr(open, "data-i18n-aria", key) + close;
  });
}

const topMenubarKey = "player.shell.topMenubar";
if (zh[topMenubarKey]) {
  html = html.replace(
    /(<nav class="topMenubar")([^>]*)(>)/,
    (m, open, mid, close) => {
      if (mid.includes("data-i18n-aria=") || open.includes("data-i18n-aria=")) {
        return m;
      }
      return `${open} data-i18n-aria="${topMenubarKey}"${mid}${close}`;
    }
  );
}

fs.writeFileSync(htmlPath, html);
console.log(`Tagged player index.html: ids=${idCount}, titles=${titleCount}, menus=${menuCount}`);
