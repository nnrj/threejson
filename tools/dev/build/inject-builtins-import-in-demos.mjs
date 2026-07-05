import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const demoRoot = path.join(repoRoot, "examples", "html-demo");

function builtinsImportFor(filePath) {
  const rel = path.relative(path.dirname(filePath), path.join(repoRoot, "builtins", "register.js"));
  return rel.split(path.sep).join("/");
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p);
      continue;
    }
    if (!ent.name.endsWith(".html")) {
      continue;
    }
    let text = fs.readFileSync(p, "utf8");
    if (!text.includes("core/index.js") || text.includes("builtins/register")) {
      continue;
    }
    const imp = `  import "${builtinsImportFor(p)}";\n`;
    const marker = '<script type="module">';
    const idx = text.indexOf(marker);
    if (idx < 0) {
      continue;
    }
    const after = idx + marker.length;
    text = text.slice(0, after) + "\n" + imp + text.slice(after);
    fs.writeFileSync(p, text, "utf8");
    console.log("injected", path.relative(repoRoot, p));
  }
}

walk(demoRoot);
