/**
 * Copy tools/common/editor-single/{command,ai,domainEditSession.js} → scene-host/editor/lib/
 * and rewrite core import paths (do not import frozen editor-single at runtime).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const srcRoot = path.join(repoRoot, "tools/common/editor-single");
const destRoot = path.join(repoRoot, "tools/scene-host/editor/lib");

function rewriteContent(text, relFile) {
  const segments = relFile.split("/");
  const dirSegments = segments.slice(0, -1);
  const depthToRoot = ["tools", "scene-host", "editor", "lib", ...dirSegments].length;
  const prefix = "../".repeat(depthToRoot);
  return text.replace(/from "(\.\.\/)+core\//g, `from "${prefix}core/`);
}

function copyFile(rel) {
  const src = path.join(srcRoot, rel);
  const dest = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = fs.readFileSync(src, "utf8");
  fs.writeFileSync(dest, rewriteContent(text, rel));
  console.log("copied", rel);
}

function walk(absDir, relBase = "") {
  for (const name of fs.readdirSync(absDir)) {
    const full = path.join(absDir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      walk(full, rel);
    } else if (name.endsWith(".js")) {
      copyFile(rel);
    }
  }
}

fs.rmSync(destRoot, { recursive: true, force: true });
walk(path.join(srcRoot, "command"), "command");
walk(path.join(srcRoot, "ai"), "ai");
copyFile("domainEditSession.js");

const libReadme = `# editor/lib — copied from tools/common/editor-single/

Frozen baseline: \`tools/common/editor-single/\` is not imported at runtime.

Regenerate:

\`\`\`bash
node tools/scene-host/scripts/copy-scene-editor-lib.mjs
\`\`\`
`;
fs.writeFileSync(path.join(destRoot, "README.md"), libReadme);
console.log("done");
