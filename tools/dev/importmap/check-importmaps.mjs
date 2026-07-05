import fs from "fs";
import path from "path";

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
const re = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;

for (const f of walkHtml(root)) {
  const html = fs.readFileSync(f, "utf8");
  let m;
  let bi = 0;
  while ((m = re.exec(html))) {
    bi += 1;
    const json = m[1].trim();
    try {
      JSON.parse(json);
    } catch (e) {
      console.log("FAIL", path.relative(root, f), "block", bi, e.message);
      console.log(json.slice(0, 400));
    }
  }
}
console.log("importmap scan done");
