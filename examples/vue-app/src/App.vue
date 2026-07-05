<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { createJsonScene } from "threejson";

const SCENE_JSON_URL = "/demo-assets/scene/sceneRuntimeBasic.json";

const canvasEl = ref<HTMLCanvasElement | null>(null);
const wrapEl = ref<HTMLDivElement | null>(null);
const runtime = shallowRef<Awaited<ReturnType<typeof createJsonScene>> | null>(null);
let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  const canvas = canvasEl.value;
  const wrap = wrapEl.value;
  if (!canvas || !wrap) return;

  const res = await fetch(SCENE_JSON_URL);
  if (!res.ok) {
    throw new Error(`Failed to load scene JSON: ${res.status} ${SCENE_JSON_URL}`);
  }
  const sceneRuntimeBasic = (await res.json()) as Record<string, unknown>;
  const data = JSON.parse(JSON.stringify(sceneRuntimeBasic)) as Record<string, unknown>;
  data.canvasWidth = wrap.clientWidth;
  data.canvasHeight = wrap.clientHeight;

  const rt = await createJsonScene(data, { canvas, resetScene: true });
  rt.start();
  runtime.value = rt;

  resizeObserver = new ResizeObserver(() => {
    rt.resize?.({ width: wrap.clientWidth, height: wrap.clientHeight });
  });
  resizeObserver.observe(wrap);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  const rt = runtime.value;
  rt?.stop?.();
  rt?.dispose?.();
  runtime.value = null;
});
</script>

<template>
  <div ref="wrapEl" class="stage">
    <canvas ref="canvasEl" />
  </div>
</template>

<style scoped>
.stage {
  width: 100vw;
  height: 100vh;
  margin: 0;
  overflow: hidden;
  background: #222;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
