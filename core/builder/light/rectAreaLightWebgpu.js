import { RectAreaLightNode } from "three/webgpu";
import { RectAreaLightTexturesLib } from "three/examples/jsm/lights/RectAreaLightTexturesLib.js";

let initialized = false;

export function ensureRectAreaLightWebgpuInitialized() {
  if (initialized) return;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  initialized = true;
}
