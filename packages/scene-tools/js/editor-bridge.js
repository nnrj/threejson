import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { toolError } from "./files.js";

/** Explicit localhost relay. It neither owns a SceneSession nor imports editor/MCP code. */
export async function startEditorBridge({ origin, port = 0, ttlMs = 30 * 60 * 1000 } = {}) {
  if (!origin || new URL(origin).origin !== origin) throw toolError("EDITOR_ORIGIN_REQUIRED", "Provide the exact trusted Editor page origin, e.g. http://localhost:5173.");
  const secret = () => randomBytes(32).toString("base64url");
  const pairingToken = secret(), agentToken = secret(), jobs = new Map();
  let editorToken = null, paired = false, closed = false;
  const expiresAt = Date.now() + ttlMs;
  const send = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  const server = createServer(async (req, res) => {
    try {
      if (closed || Date.now() >= expiresAt) throw toolError("BRIDGE_EXPIRED", "Pairing session expired; start a new bridge.");
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) throw toolError("BRIDGE_HOST_REJECTED", "Unexpected relay host.");
      const url = new URL(req.url, "http://127.0.0.1");
      const browserEndpoint = url.pathname === "/pair" || url.pathname.startsWith("/editor/");
      if (browserEndpoint) {
        if (req.headers.origin !== origin) throw toolError("BRIDGE_ORIGIN_REJECTED", "Editor origin does not match the approved origin.");
        res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "authorization, content-type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      } else if (req.headers.origin) throw toolError("BRIDGE_ORIGIN_REJECTED", "Agent endpoints are not browser endpoints.");
      if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
      let body = {};
      if (req.method === "POST") {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw toolError("INVALID_CONTENT_TYPE", "JSON requests only.");
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (url.pathname === "/pair" && req.method === "POST") {
        if (paired || body.token !== pairingToken) throw toolError("PAIRING_REJECTED", "Invalid or already-used pairing token.");
        paired = true; editorToken = secret(); send(res, 200, { ok: true, token: editorToken, expiresAt }); return;
      }
      if (!token || token !== (browserEndpoint ? editorToken : agentToken)) throw toolError("BRIDGE_UNAUTHORIZED", "Invalid bridge token.");
      if (url.pathname === "/editor/poll" && req.method === "GET") {
        const entry = [...jobs.values()].find((job) => job.status === "queued");
        if (entry) entry.status = "dispatched";
        send(res, 200, { ok: true, request: entry ? { requestId: entry.requestId, method: entry.method, params: entry.params } : null }); return;
      }
      if (url.pathname === "/editor/result" && req.method === "POST") {
        const job = jobs.get(body.requestId);
        if (!job || job.status !== "dispatched") throw toolError("UNKNOWN_BRIDGE_REQUEST", "No dispatched request matches this response.");
        job.result = body.result; job.status = "completed"; send(res, 200, { ok: true }); return;
      }
      if (url.pathname === "/editor/disconnect" && req.method === "POST") {
        editorToken = null;
        for (const job of jobs.values()) if (job.status !== "completed") job.status = job.status === "dispatched" ? "delivery_unknown" : "cancelled";
        send(res, 200, { ok: true }); return;
      }
      if (url.pathname === "/agent/call" && req.method === "POST") {
        if (!editorToken) throw toolError("EDITOR_NOT_PAIRED", "Connect the Editor explicitly before submitting an operation.");
        if (!["discover", "execute", "preflight", "undo", "redo", "export"].includes(body.method)) throw toolError("UNKNOWN_BRIDGE_METHOD", "Unsupported editor method.");
        const requestId = body.requestId || randomUUID(), fingerprint = JSON.stringify([body.method, body.params]);
        const previous = jobs.get(requestId);
        if (previous && previous.fingerprint !== fingerprint) throw toolError("REQUEST_ID_CONFLICT", "Relay request ID reused with different payload.");
        if (!previous) jobs.set(requestId, { requestId, method: body.method, params: body.params || {}, fingerprint, status: "queued" });
        send(res, 200, { ok: true, requestId, status: jobs.get(requestId).status }); return;
      }
      if (url.pathname === "/agent/result" && req.method === "GET") {
        const job = jobs.get(url.searchParams.get("requestId"));
        if (!job) throw toolError("UNKNOWN_BRIDGE_REQUEST", "Unknown relay request.");
        send(res, 200, { ok: true, requestId: job.requestId, status: job.status, result: job.result }); return;
      }
      send(res, 404, { ok: false, code: "NOT_FOUND" });
    } catch (error) { send(res, 400, { ok: false, code: error.code || "BRIDGE_FAILED", error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { if (closed) return; closed = true; clearTimeout(timer); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  const timer = setTimeout(() => void close(), ttlMs); timer.unref();
  return { url, pairingUrl: `${url}/#${pairingToken}`, agentToken, expiresAt, close };
}

export async function callEditorBridge({ url, token, method, params, requestId, signal } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password) throw toolError("LOCAL_BRIDGE_REQUIRED", "Only an explicitly paired 127.0.0.1 bridge is supported.");
  endpoint.pathname = method ? "/agent/call" : "/agent/result";
  endpoint.search = method ? "" : new URLSearchParams({ requestId }); endpoint.hash = "";
  const response = await fetch(endpoint, { method: method ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(method ? { body: JSON.stringify({ method, params, requestId }) } : {}), signal });
  return response.json();
}
