import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

let initialized = false;

export function ensureRectAreaLightWebglInitialized() {
  if (initialized) return;
  RectAreaLightUniformsLib.init();
  initialized = true;
}
