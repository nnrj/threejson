export function installGifWorker(loadLibrary) {
let library, encoder;
self.onmessage = async ({ data }) => {
  try {
    let value;
    if (data.op === "init") {
      const module = await loadLibrary(data); library = module.GIFEncoder ? module : module.default;
      encoder = library.GIFEncoder();
    } else if (data.op === "frame") {
      const rgba = new Uint8ClampedArray(data.pixels);
      const palette = library.quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
      const indices = library.applyPalette(rgba, palette, "rgba4444");
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      encoder.writeFrame(indices, data.width, data.height, { ...data.options, palette, dispose: 2, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
    } else if (data.op === "finish") { encoder.finish(); value = encoder.bytes().slice(); }
    else throw new Error("Unknown GIF worker operation.");
    self.postMessage({ id: data.id, value }, value ? [value.buffer] : []);
  } catch (error) { self.postMessage({ id: data.id, error: String(error.message || error) }); }
};
}
