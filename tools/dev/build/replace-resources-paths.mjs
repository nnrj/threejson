import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exts = new Set([".js", ".mjs", ".html", ".md", ".json", ".ps1", ".cmd", ".py", ".css"]);
const skipDirs = new Set(["node_modules", ".git", "oldplan"]);

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p);
      continue;
    }
    if (!exts.has(path.extname(ent.name))) {
      continue;
    }
    let text = fs.readFileSync(p, "utf8");
    if (!text.includes("assets/")) {
      continue;
    }
    const next = text
      .replaceAll("/assets/", "/assets/")
      .replaceAll('"assets/', '"assets/')
      .replaceAll("'assets/", "'assets/")
      .replaceAll("`assets/", "`assets/")
      .replaceAll("../assets/", "../assets/")
      .replaceAll("../../assets/", "../../assets/");
    if (next !== text) {
      fs.writeFileSync(p, next, "utf8");
      console.log("updated", path.relative(repoRoot, p));
    }
  }
}

walk(repoRoot);
console.log("replace-resources-paths done");
