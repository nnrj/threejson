import { RenderPipeline } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";

function passRecords(payload) {
  const list = [];
  const candidates = [payload?.objectList, payload?.sceneConfig?.passList];
  for (const candidate of candidates) if (Array.isArray(candidate)) for (const record of candidate) {
    if (record?.objType === "pass" || record?.passType) list.push(record);
  }
  return list;
}

export class WebgpuRenderPipelineAdapter {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.pipeline = null;
  }
  configureThreeJsonPasses(payload) {
    const records = passRecords(payload);
    const scenePass = pass(this.scene, this.camera); const sceneColor = scenePass.getTextureNode(); let output = sceneColor;
    for (const record of records) {
      const type = String(record.passType || "render").toLowerCase();
      if (type === "render" || type === "output") continue;
      if (type === "bloom") {
        output = output.add(bloom(sceneColor, Number(record.strength ?? 1), Number(record.radius ?? 0.2), Number(record.threshold ?? 0.85)));
        continue;
      }
      const error = new Error(`WebGPU RenderPipeline does not support passType: ${type}`); error.code = "E_WEBGPU_PASS_INCOMPATIBLE"; throw error;
    }
    this.pipeline?.dispose?.(); this.pipeline = new RenderPipeline(this.renderer, output);
    return records;
  }
  render() { if (this.pipeline) this.pipeline.render(); else this.renderer.render(this.scene, this.camera); }
  dispose() { this.pipeline?.dispose?.(); this.pipeline = null; }
}

