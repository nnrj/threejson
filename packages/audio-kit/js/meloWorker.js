import { createMeloEngine } from "./meloRuntime.js";
import { validatePcm } from "./pcm.js";
let producer;
self.onmessage = async ({ data }) => {
  try {
    let value;
    if (data.op === "init") producer = await createMeloEngine(data.init);
    else if (data.op === "synthesize") value = validatePcm(await producer.synthesize(data.recipe));
    else throw new Error("Unknown local speech operation.");
    self.postMessage({ id: data.id, value }, value ? value.channels.map(c => c.buffer) : []);
  } catch (error) { self.postMessage({ id: data.id, error: { message: String(error.message || error), code: error.code } }); }
};
