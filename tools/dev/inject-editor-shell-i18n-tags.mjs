/**
 * Inject data-i18n / data-i18n-title from editor-shell.zh-CN.json into editor/index.html
 * Usage: node tools/dev/inject-editor-shell-i18n-tags.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const htmlPath = path.join(root, "tools/scene-host/editor/index.html");
const zhPath = path.join(root, "tools/scene-host/shared/i18n/locales/editor-shell.zh-CN.json");
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
    const cleaned = open
      .replace(/\sdata-i18n="[^"]*"/g, "")
      .replace(/\sdata-i18n-aria="[^"]*"/g, "");
    return upsertAttr(cleaned, attr, key) + close;
  });
}

let idCount = 0;
let titleCount = 0;
let menuCount = 0;

for (const [key, zhText] of Object.entries(zh)) {
  const titleMatch = key.match(/^editor\.shell\.([a-zA-Z][a-zA-Z0-9]*)\.title$/);
  if (titleMatch) {
    tagId(titleMatch[1], key, "title");
    titleCount++;
    continue;
  }
  const idMatch = key.match(/^editor\.shell\.([a-zA-Z][a-zA-Z0-9]*)$/);
  if (idMatch) {
    const kind = /Modal$/i.test(idMatch[1]) ? "aria" : "i18n";
    tagId(idMatch[1], key, kind);
    idCount++;
    continue;
  }
  if (key.startsWith("editor.menu.")) {
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
      continue;
    }
    const btnRe = new RegExp(
      `(<button[^>]*class="[^"]*topNestedTrigger[^"]*"[^>]*)(>\\s*${escaped}\\s*</button>)`
    );
    if (btnRe.test(html)) {
      html = html.replace(btnRe, (m, open, rest) => {
        if (open.includes("data-i18n=")) {
          return m;
        }
        return upsertAttr(open, "data-i18n", key) + rest;
      });
      menuCount++;
    }
  }
}

// Panel titles and chrome without ids: match by Chinese text once
const usedTexts = new Set();
for (const [key, zhText] of Object.entries(zh)) {
  if (!key.startsWith("editor.shell.panel.") && !key.startsWith("editor.shell.propLine.")) {
    continue;
  }
  if (!zhText || zhText.length > 120 || usedTexts.has(zhText)) {
    continue;
  }
  const escaped = zhText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(<(div|span|label|button)[^>]*)(>\\s*${escaped}\\s*</\\2>)`);
  if (!re.test(html)) {
    continue;
  }
  html = html.replace(re, (m, open, tag, rest) => {
    if (open.includes("data-i18n=")) {
      return m;
    }
    usedTexts.add(zhText);
    return upsertAttr(open, "data-i18n", key) + rest;
  });
}

fs.writeFileSync(htmlPath, html);
console.log(`Tagged index.html: ids=${idCount}, titles=${titleCount}, menus=${menuCount}`);
