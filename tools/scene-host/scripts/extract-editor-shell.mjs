import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const htmlPath = path.join(repoRoot, "scene-editor.html");
const outPath = path.join(repoRoot, "tools/scene-host/editor/_shell-body.html");

const lines = fs.readFileSync(htmlPath, "utf8").split(/\r?\n/);

function slice1(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

const chunks = [
  slice1(3150, 3309),
  slice1(3311, 3370),
  slice1(3372, 3603),
  slice1(3605, 3710),
  slice1(3711, 3888),
  slice1(3890, 3895),
  slice1(4084, 4133),
  slice1(4134, 4146),
  slice1(4158, 4168),
  slice1(4186, 4199),
  slice1(4200, 4214)
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `<!-- Extracted from scene-editor.html for scene-host editor (phase 2b+) -->\n${chunks.join("\n")}\n  </div>\n</div>\n`
);
console.log("Wrote", outPath);
