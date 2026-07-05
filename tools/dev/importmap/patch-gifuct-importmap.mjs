import fs from "fs";
import path from "path";

const GIF_LINE = `        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2"`;

function walkHtml(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, n.name);
    if (n.isDirectory()) {
      if (n.name === "node_modules") continue;
      walkHtml(f, out);
    } else if (n.name.endsWith(".html")) out.push(f);
  }
  return out;
}

const root = process.cwd();

for (const file of walkHtml(root)) {
  let s = fs.readFileSync(file, "utf8");
  if (!/type=["']importmap["']/i.test(s)) continue;
  if (s.includes('"gifuct-js"')) continue;

  const needle = `"html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4"`;
  if (!s.includes(needle)) continue;

  const idx = s.indexOf(needle);
  const end = idx + needle.length;
  const after = s.slice(end, end + 20);
  if (/^\s*,/.test(after)) {
    console.log("skip already comma", path.relative(root, file));
    continue;
  }

  const insert = `${needle},\n${GIF_LINE}`;
  s = s.slice(0, idx) + insert + s.slice(end);
  fs.writeFileSync(file, s, "utf8");
  console.log("patched", path.relative(root, file));
}

console.log("gifuct importmap patch done");
