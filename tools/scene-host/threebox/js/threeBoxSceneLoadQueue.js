let tail = Promise.resolve();
let activeCount = 0;

function emitBusyChanged() {
  window.dispatchEvent(
    new CustomEvent("threebox:scene-load-busy", {
      detail: { busy: activeCount > 0, activeCount }
    })
  );
}

/**
 * Serializes ThreeBox-local scene loads. ThreeJSON's deploy scheduler is process-global, so two
 * createJsonScene calls in the same page can cancel each other's scheduled deployment.
 *
 * @template T
 * @param {() => Promise<T>|T} task
 * @returns {Promise<T>}
 */
export function enqueueThreeBoxSceneLoad(task) {
  const run = tail
    .catch(() => undefined)
    .then(async () => {
      activeCount += 1;
      emitBusyChanged();
      try {
        return await task();
      } finally {
        activeCount = Math.max(0, activeCount - 1);
        emitBusyChanged();
      }
    });
  tail = run.then(() => undefined, () => undefined);
  return run;
}

export function isThreeBoxSceneLoadBusy() {
  return activeCount > 0;
}
