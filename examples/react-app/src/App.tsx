import { useEffect, useRef } from "react";
import { createJsonScene } from "threejson";
import "./App.css";

const SCENE_JSON_URL = "/demo-assets/scene/sceneRuntimeBasic.json";

export default function App() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rtRef = useRef<Awaited<ReturnType<typeof createJsonScene>> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let alive = true;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const res = await fetch(SCENE_JSON_URL);
      if (!res.ok) {
        throw new Error(`Failed to load scene JSON: ${res.status} ${SCENE_JSON_URL}`);
      }
      const sceneRuntimeBasic = (await res.json()) as Record<string, unknown>;
      const data = JSON.parse(JSON.stringify(sceneRuntimeBasic)) as Record<string, unknown>;

      data.canvasWidth = wrap.clientWidth;
      data.canvasHeight = wrap.clientHeight;
      const created = await createJsonScene(data, { canvas, resetScene: true });
      if (!alive) {
        created.stop();
        created.dispose();
        return;
      }
      rtRef.current = created;
      created.start();

      resizeObserver = new ResizeObserver(() => {
        rtRef.current?.resize?.({
          width: wrap.clientWidth,
          height: wrap.clientHeight
        });
      });
      resizeObserver.observe(wrap);
    })();

    return () => {
      alive = false;
      resizeObserver?.disconnect();
      const r = rtRef.current;
      rtRef.current = null;
      r?.stop();
      r?.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="stage">
      <canvas ref={canvasRef} />
    </div>
  );
}
