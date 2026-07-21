/** Probe a configurable HTTP endpoint without exposing credentials. */
export async function probeEndpoint(baseUrl, path = "/health", timeoutMs = 8000) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return { ok: false, status: 0, message: "Invalid URL" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, { method: "GET", cache: "no-store", signal: controller.signal });
    return { ok: response.ok, status: response.status, message: response.ok ? "OK" : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, message: error?.name === "AbortError" ? "Timeout" : (error?.message || "Network error") };
  } finally { clearTimeout(timer); }
}
