/**
 * Serializes inline scene-card loads so concurrent React effects cannot race for WebGL contexts.
 *
 * The vanilla original does not serialize — it is only a busy tracker — because a plain page never
 * starts two scene loads for the same canvas at once. React's StrictMode does: it double-invokes a
 * card's render effect (mount → unmount → remount), so two `createJsonScene` calls can otherwise
 * race on one canvas and create two WebGL contexts, leaving the loading mask stuck. Chaining tasks
 * so each runs after the previous finishes (and its runtime is disposed) fixes that, and is also
 * kinder to the GPU when many cards render at once.
 */
let activeCount = 0;
let tail = Promise.resolve();

function emitBusyChanged() {
  window.dispatchEvent(
    new CustomEvent("scene-agent:scene-load-busy", { detail: { busy: activeCount > 0, activeCount } })
  );
}

export function enqueueSceneAgentLoad(task) {
  activeCount += 1;
  emitBusyChanged();
  const run = tail.then(
    () => task(),
    () => task() // a previous task's failure must not block the queue
  );
  // Keep the chain going regardless of this task's outcome; swallow here so `tail` never rejects.
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    activeCount = Math.max(0, activeCount - 1);
    emitBusyChanged();
  });
}

export function isSceneAgentLoadBusy() {
  return activeCount > 0;
}
