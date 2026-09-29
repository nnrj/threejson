import { validatePcm } from "./pcm.js";
let producer;
self.onmessage = async ({ data }) => {
  try {
    let value;
    if (data.op === "init") {
      const module = await import(data.moduleUrl);
      producer = await module.default(data.init);
      if (typeof producer?.synthesize !== "function") throw new Error("Worker module must create an audio producer.");
    } else if (data.op === "synthesize") {
      value = validatePcm(await producer.synthesize(data.recipe, { onProgress: (progress) => self.postMessage({ id: data.id, progress }) }));
    } else throw new Error("Unknown audio worker operation.");
    self.postMessage({ id: data.id, value }, value ? [...new Set(value.channels.map((channel) => channel.buffer))] : []);
  } catch (error) { self.postMessage({ id: data.id, error: { message: String(error.message || error), code: error.code } }); }
};
