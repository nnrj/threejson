/** Transfer one frame at a time, with backpressure. No import-map assumptions in workers. */
export async function createGifEncoder(options = {}) {
  let worker, sequence = 0;
  const waiting = new Map();
  const fail = (error) => { for (const task of waiting.values()) task.reject(error); waiting.clear(); };
  const abort = () => fail(options.signal?.reason || new DOMException("Cancelled", "AbortError"));
  if (!options.gifEncoder && options.worker !== false && typeof Worker !== "undefined") {
    try {
      let url = options.gifModuleUrl;
      if (!url) { try { url = import.meta.resolve("gifenc"); } catch { /* Bundlers resolve the worker's static module branch. */ } }
      worker = url
        ? new Worker(new URL("./gifWorker.js", import.meta.url), { type: "module" })
        : new Worker(new URL("./gifBundledWorker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => { const task = waiting.get(data.id); if (task) { waiting.delete(data.id); data.error ? task.reject(new Error(data.error)) : task.resolve(data.value); } };
      worker.onerror = (event) => { event.preventDefault(); fail(new Error(event.message || "GIF worker failed.")); };
      const call = (data, transfer = []) => new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); worker.postMessage({ id, ...data }, transfer); });
      options.signal?.addEventListener("abort", abort, { once: true });
      options.signal?.throwIfAborted();
      await call({ op: "init", url });
      return {
        frame(pixels, width, height, config) { return call({ op: "frame", pixels: pixels.buffer, width, height, options: config }, [pixels.buffer]); },
        finish: () => call({ op: "finish" }),
        dispose() { worker.terminate(); abort(); options.signal?.removeEventListener("abort", abort); }
      };
    } catch (error) {
      worker?.terminate(); options.signal?.removeEventListener("abort", abort); options.signal?.throwIfAborted();
      options.onWarning?.({ code: "GIF_WORKER_UNAVAILABLE", message: error.message });
    }
  }
  const module = options.gifEncoder || await import("gifenc"), library = module.GIFEncoder ? module : module.default, encoder = library.GIFEncoder();
  return {
    frame(pixels, width, height, config) {
      const palette = library.quantize(pixels, 256, { format: "rgba4444", oneBitAlpha: true });
      const indices = library.applyPalette(pixels, palette, "rgba4444"), transparentIndex = palette.findIndex((color) => color[3] === 0);
      encoder.writeFrame(indices, width, height, { ...config, palette, dispose: 2, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
    },
    finish() { encoder.finish(); return encoder.bytes(); }, dispose() {}
  };
}
