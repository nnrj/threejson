// One-shot cross-origin handshake. Match the ThreeBox transport, but accept only
// the explicitly allowed opener, popup source and unpredictable session token.
const allowed = new Set(["https://threejson.org", "https://threebox.org", "https://cloud.threebox.org", "https://editor.threejson.org", "https://player.threejson.org", "https://shower.threejson.org", "http://localhost:5180", "http://localhost:5181", "http://localhost:5182", "http://localhost:5183"]);
export function receiveVideoProject(load, options = {}) {
  const params = new URLSearchParams(location.search), session = params.get("bridgeSession"), origin = params.get("openerOrigin"), opener = window.opener;
  const origins = new Set([...allowed, location.origin, ...(options.allowedOrigins || [])]);
  if (!session || !origin || !origins.has(origin) || !opener) throw new Error("Video project transfer origin/session is not allowed.");
  let received = false;
  const reply = message => opener.postMessage({ channel: "threejson:scene-transfer", version: 1, session, ...message }, origin);
  const listener = async event => {
    const value = event.data;
    if (received || event.origin !== origin || event.source !== opener || value?.channel !== "threejson:scene-transfer" || value.version !== 1 || value.session !== session || value.action !== "load") return;
    received = true; cleanup();
    try { await load(value.payload); reply({ action: "loaded", ok: true }); }
    catch (error) { reply({ action: "loaded", ok: false, error: error.message }); }
    finally { window.opener = null; }
  };
  const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", listener); };
  const timer = setTimeout(cleanup, 15000);
  window.addEventListener("message", listener); reply({ action: "ready" }); return cleanup;
}
