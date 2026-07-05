import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tpl = fs.readFileSync(path.join(dir, "../editor/index.template.html"), "utf8");
const shell = fs.readFileSync(path.join(dir, "../editor/_shell-body.html"), "utf8");
const marker =
  "<!--#include _shell-body.html — inlined at build time; see scripts/assemble-editor-index.mjs -->";
const html = tpl.replace(
  marker,
  `${shell.trim()}\n<script type="module" src="./js/main.js"></script>\n`
);
fs.writeFileSync(path.join(dir, "../editor/index.html"), html);
console.log("Wrote editor/index.html");
