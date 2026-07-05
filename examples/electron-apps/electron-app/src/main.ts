import { createJsonScene } from "threejson";
import "./style.css";

const SCENE_JSON_URL = "./demo-assets/scene/sceneRuntimeBasic.json";

async function bootstrap() {
  const wrap = document.getElementById("app");
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!wrap || !canvas) {
    throw new Error("Missing #app or #canvas");
  }

  const res = await fetch(SCENE_JSON_URL);
  if (!res.ok) {
    throw new Error(`Failed to load scene JSON: ${res.status} ${SCENE_JSON_URL}`);
  }
  const sceneRuntimeBasic = (await res.json()) as Record<string, unknown>;
  const data = JSON.parse(JSON.stringify(sceneRuntimeBasic)) as Record<string, unknown>;
  data.canvasWidth = wrap.clientWidth;
  data.canvasHeight = wrap.clientHeight;

  const runtime = await createJsonScene(data, { canvas, resetScene: true });
  runtime.start();

  const resizeObserver = new ResizeObserver(() => {
    runtime.resize?.({ width: wrap.clientWidth, height: wrap.clientHeight });
  });
  resizeObserver.observe(wrap);

  window.addEventListener("beforeunload", () => {
    resizeObserver.disconnect();
    runtime.stop();
    runtime.dispose();
  });
}

void bootstrap().catch((err) => {
  console.error("[electron-app]", err);
  document.body.innerHTML = `<pre style="color:#f66;padding:1rem">${String(err)}</pre>`;
});
