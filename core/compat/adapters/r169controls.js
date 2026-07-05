import { r155lightsAdapter } from "./r155lights.js";

/** r169+ shares physical lights with r155; controls differ (see controls module). */
export const r169controlsAdapter = {
  id: "r169controls",
  resolveLightIntensity: r155lightsAdapter.resolveLightIntensity
};
