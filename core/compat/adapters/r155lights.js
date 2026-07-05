import { latestAdapter } from "./latest.js";

/** r155+ uses physical light units; same as latest for intensity resolution. */
export const r155lightsAdapter = {
  id: "r155lights",
  resolveLightIntensity: latestAdapter.resolveLightIntensity
};
