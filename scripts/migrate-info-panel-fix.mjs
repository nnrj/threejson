import fs from "node:fs";

const paths = [
  "assets/json/tutorial/track-04/04-08-info-panel-gallery.json",
  "assets/json/tutorial/track-00/00-03-friendly-full-scene.json",
  "assets/json/tutorial/track-00/00-04-standard-objectlist.json",
  "assets/json/sceneRuntimeBasic.json",
  "assets/json/roomShow.json",
  "assets/json/portShow.json",
  "examples/react-app/public/demo-assets/scene/sceneRuntimeBasic.json",
  "examples/vue-app/public/demo-assets/scene/sceneRuntimeBasic.json",
  "examples/electron-apps/electron-app/public/demo-assets/scene/sceneRuntimeBasic.json",
  "examples/electron-apps/electron-vue/public/demo-assets/scene/sceneRuntimeBasic.json",
  "examples/electron-apps/electron-react-app/public/demo-assets/scene/sceneRuntimeBasic.json"
];

for (const p of paths) {
  if (!fs.existsSync(p)) {
    console.log("skip", p);
    continue;
  }
  let text = fs.readFileSync(p, "utf8");
  const before = text;
  // dismissTrigger-only (no fix) → fix:false, remove redundant dismissTrigger:dblclick
  text = text.replace(
    /("visible"\s*:\s*true\s*,\s*\r?\n\s*)"dismissTrigger"\s*:\s*"dblclick"/g,
    '$1"fix": false'
  );
  text = text.replace(
    /("fix"\s*:\s*false\s*,\s*\r?\n\s*)"dismissTrigger"\s*:\s*"dblclick"\s*,?\s*\r?\n/g,
    '$1'
  );
  if (text !== before) {
    fs.writeFileSync(p, text);
    console.log("updated", p);
  } else {
    console.log("unchanged", p);
  }
}
