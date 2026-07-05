import { runTextureFill } from "../../../threejson-agent/bridge/texture-fill.mjs";

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error("texture-bridge-worker requires process.parentPort.");
}

parentPort.on("message", async (event) => {
  const message = event?.data || event || {};
  if (message?.type !== "run") {
    return;
  }
  try {
    const result = await runTextureFill(message.payload || {});
    parentPort.postMessage({ ok: true, result });
    process.exit(0);
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: String(error?.message || error || "texture bridge failed")
    });
    process.exit(1);
  }
});
