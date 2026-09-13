/** Runtime-only, deduplicated diagnostic state. Observers cannot affect resource transactions. */
export function createResourceDiagnosticsStore() {
  const entries = new Map(), observers = new Set();
  let disposed = false;
  const key = (value) => JSON.stringify([value.code, value.source, value.field, value.objectId]);
  const snapshot = () => [...entries.values()];
  const notify = () => { const list = snapshot(); for (const observer of observers) { try { observer(list); } catch { /* observer only */ } } };
  return {
    snapshot,
    report(value) {
      if (disposed || !value?.code) return;
      const id = key(value), previous = entries.get(id);
      if (previous && previous.message === value.message) return;
      entries.set(id, Object.freeze({ severity: "warning", ...value })); notify();
    },
    resolve(value) { if (entries.delete(key(value))) notify(); },
    subscribe(observer) {
      if (disposed) return () => {};
      observers.add(observer); try { observer(snapshot()); } catch { /* observer only */ }
      return () => observers.delete(observer);
    },
    dispose() { disposed = true; entries.clear(); observers.clear(); }
  };
}
