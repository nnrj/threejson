import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileVersion, readVersionedFile, writeVersionedFile, toolError } from "./files.js";

/** Host-owned providers, not an engine dependency. No scraping or paid API is enabled implicitly. */
export async function searchAssets({ query = "", provider, urls, allowedLicenses, signal } = {}) {
  let items;
  if (urls) items = urls.map((item) => typeof item === "string" ? { url: item, license: "unknown", source: "user-url" } : item);
  else if (typeof provider === "function") items = await provider({ query, signal });
  else if (provider?.endpoint) {
    const endpoint = new URL(provider.endpoint); endpoint.searchParams.set(provider.queryParameter || "query", query);
    const response = await fetch(endpoint, { signal, headers: provider.headers });
    if (!response.ok) throw toolError("ASSET_PROVIDER_FAILED", `Asset provider returned HTTP ${response.status}.`);
    const json = await response.json(); items = Array.isArray(json) ? json : json.items || json.results;
  } else throw toolError("ASSET_PROVIDER_REQUIRED", "Provide explicit URLs or a configured JSON search provider. Automatic public-web crawling is not enabled.");
  if (!Array.isArray(items)) throw toolError("ASSET_PROVIDER_FORMAT", "Search providers must return an items array.");
  return { ok: true, items: items.map((item) => ({ ...item, url: item.url || item.urls?.full, license: item.license || "unknown" })).filter((item) => item.url && (!allowedLicenses || allowedLicenses.includes(item.license))), licensePolicy: "Unknown licenses are labeled, not assumed CC0. The host chooses allowedLicenses." };
}

/** Content-addressed import preserving source/license metadata and never overwriting another file. */
export async function importAsset({ source, directory, filename, metadata = {}, signal } = {}) {
  if (!source || !directory) throw toolError("ASSET_INPUT_REQUIRED", "Provide source and destination directory.");
  let bytes, contentType;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal });
    if (!response.ok) throw toolError("ASSET_DOWNLOAD_FAILED", `Asset download returned HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer()); contentType = response.headers.get("content-type");
  } else bytes = await readFile(source);
  signal?.throwIfAborted();
  const hash = fileVersion(bytes), extension = path.extname(new URL(source, "file:///").pathname).replace(/[^.\w-]/g, "");
  const name = filename || `${hash}${extension}`;
  if (path.basename(name) !== name || name === "." || name === "..") throw toolError("INVALID_ASSET_FILENAME", "filename must be a plain file name.");
  const root = path.resolve(directory); await mkdir(root, { recursive: true });
  const target = path.join(root, name), prior = await readVersionedFile(target);
  if (prior.version && prior.version !== hash) throw toolError("FILE_CHANGED", "The requested asset filename already contains different data.");
  if (!prior.version) await writeVersionedFile(target, bytes, null);
  const sidecar = `${target}.source.json`, old = await readVersionedFile(sidecar);
  const provenance = { ...metadata, source, contentType: contentType || metadata.contentType || null, sha256: hash, license: metadata.license || "unknown", importedAt: new Date().toISOString() };
  // The first import owns its provenance. Reusing bytes does not silently replace attribution.
  if (!old.bytes) await writeVersionedFile(sidecar, JSON.stringify(provenance, null, 2), null);
  return { ok: true, path: target, version: hash, metadataPath: sidecar, reused: Boolean(prior.bytes) };
}
