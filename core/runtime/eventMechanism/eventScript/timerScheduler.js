/**
 * Core-managed timers for EventScript `await wait(ms)`.
 */

/**
 * @returns {{ wait: (ms: number) => Promise<void>, clearAll: () => void }}
 */
export function createTimerScheduler() {
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();

  return {
    wait(ms) {
      const delay = Math.max(0, Number(ms) || 0);
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          timers.delete(id);
          resolve();
        }, delay);
        timers.add(id);
      });
    },
    clearAll() {
      for (const id of timers) {
        clearTimeout(id);
      }
      timers.clear();
    }
  };
}
