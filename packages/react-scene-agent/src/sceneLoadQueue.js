/**
 * Tracks in-flight scene loads without serializing independent cards. ThreeJSON's deploy scheduler
 * is runtime-scoped, so separate canvases may load concurrently. Background work (for example
 * template thumbnails) still uses this busy signal to wait for a quiet moment.
 */
let activeCount = 0;

function emitBusyChanged() {
  window.dispatchEvent(
    new CustomEvent("scene-agent:scene-load-busy", { detail: { busy: activeCount > 0, activeCount } })
  );
}

export async function enqueueSceneAgentLoad(task) {
  activeCount += 1;
  emitBusyChanged();
  try {
    return await task();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    emitBusyChanged();
  }
}

export function isSceneAgentLoadBusy() {
  return activeCount > 0;
}
