import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Parser } from "tar";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

function integrityExpectation(metadata) {
  if (metadata?.integrity) {
    // Use the strongest supported algorithm, not a weaker fallback on mismatch.
    const tokens = String(metadata.integrity).trim().split(/\s+/);
    for (const algorithm of ["sha512", "sha384", "sha256", "sha1"]) {
      const values = tokens.filter((token) => token.startsWith(`${algorithm}-`))
        .map((token) => token.slice(algorithm.length + 1).split("?")[0]);
      if (values.length) return { algorithm, encoding: "base64", values };
    }
    throw new Error("Unsupported archive integrity algorithm.");
  }
  if (/^[0-9a-f]{40}$/i.test(metadata?.shasum || "")) {
    return { algorithm: "sha1", encoding: "hex", values: [metadata.shasum] };
  }
  throw new Error("Archive metadata lacks a usable integrity/shasum.");
}

function safeEntryPath(entry) {
  const name = entry.path;
  const normalized = entry.type === "Directory" ? name.replace(/\/$/, "") : name;
  const parts = normalized.split("/");
  if (/[\\\x00-\x1f\x7f:]/.test(name) || /[\\\x00-\x1f\x7f:]/.test(entry.header.path || "")
    || parts[0] !== "package" || parts.some((part) => !part || part === "." || part === "..")
    || (parts.length === 1 && entry.type !== "Directory")) {
    throw new Error(`Unsafe package archive path: ${JSON.stringify(name)}`);
  }
  return parts.slice(1).join("/");
}

/** Hash raw file bytes without extracting the archive or buffering its files. */
export async function readPackageContents(source, metadata, options = {}) {
  const expected = integrityExpectation(metadata);
  const archiveHash = createHash(expected.algorithm);
  const files = new Map();
  const seen = new Map();
  let archiveBytes = 0;
  let unpackedBytes = 0;
  let eof = false;
  const parser = new Parser({ strict: true });
  const fail = (error) => parser.abort(error);
  parser.on("ignoredEntry", (entry) => fail(new Error(`Unsupported archive entry: ${entry.path} (${entry.type})`)));
  parser.on("eof", () => { eof = true; });
  parser.on("entry", (entry) => {
    try {
      const name = safeEntryPath(entry);
      if (seen.has(name)) throw new Error(`Duplicate archive path: ${name}`);
      if (seen.size >= (options.maxEntries ?? MAX_ENTRIES)) throw new Error("Archive entry limit exceeded.");
      seen.set(name, entry.type);
      if (entry.type === "Directory") {
        if (entry.size !== 0) throw new Error(`Invalid directory entry: ${name}`);
        entry.resume();
        return;
      }
      if (!["File", "OldFile", "ContiguousFile"].includes(entry.type)) {
        throw new Error(`Unsupported archive entry: ${name} (${entry.type})`);
      }
      unpackedBytes += entry.size;
      if (!Number.isSafeInteger(entry.size) || entry.size < 0
        || unpackedBytes > (options.maxUnpackedBytes ?? MAX_UNPACKED_BYTES)) {
        throw new Error("Archive unpacked size limit exceeded.");
      }
      const hash = createHash("sha256");
      let size = 0;
      entry.on("data", (chunk) => { size += chunk.length; hash.update(chunk); });
      entry.on("end", () => {
        if (size !== entry.size) return fail(new Error(`Incomplete archive file: ${name}`));
        files.set(name, { size, digest: hash.digest("hex"), executable: (entry.mode || 0) & 0o111 });
      });
      entry.on("error", fail);
      entry.resume();
    } catch (error) {
      fail(error);
    }
  });
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      archiveBytes += chunk.length;
      if (archiveBytes > (options.maxArchiveBytes ?? MAX_ARCHIVE_BYTES)) {
        callback(new Error("Archive download size limit exceeded."));
        return;
      }
      archiveHash.update(chunk);
      callback(null, chunk);
    }
  });
  await pipeline(source, guard, parser);
  const actual = archiveHash.digest();
  const verified = expected.values.some((value) => {
    const bytes = Buffer.from(value, expected.encoding);
    return bytes.length === actual.length && timingSafeEqual(bytes, actual);
  });
  if (!verified) throw new Error("Archive integrity mismatch; refusing to compare unverified contents.");
  if (!eof || !files.has("package.json")) throw new Error("Incomplete npm archive: missing EOF or package.json.");
  for (const name of seen.keys()) {
    const parts = name.split("/");
    while (parts.length > 1) {
      parts.pop();
      const parent = parts.join("/");
      if (seen.has(parent) && seen.get(parent) !== "Directory") {
        throw new Error(`Archive file/directory collision: ${parent}`);
      }
    }
  }
  return files;
}

export function diffPackageContents(local, published) {
  const added = [...local.keys()].filter((name) => !published.has(name)).sort();
  const removed = [...published.keys()].filter((name) => !local.has(name)).sort();
  const modified = [...local.keys()].filter((name) => {
    const a = local.get(name);
    const b = published.get(name);
    return b && (a.size !== b.size || a.digest !== b.digest || a.executable !== b.executable);
  }).sort();
  return { equal: !added.length && !removed.length && !modified.length, added, removed, modified };
}

export function formatPackageDifferences(diff) {
  return [
    `新增 ${diff.added.length}，删除 ${diff.removed.length}，修改 ${diff.modified.length}（相对于 npm 已发布包）：`,
    ...diff.added.map((name) => `  + ${name}`),
    ...diff.removed.map((name) => `  - ${name}`),
    ...diff.modified.map((name) => `  ~ ${name}`)
  ].join("\n");
}

/** Called only after the optional file comparison has been authorized. */
export async function comparePackageTarball(localFile, localMetadata, publishedMetadata, options = {}) {
  if (!publishedMetadata?.tarball) throw new Error("Published metadata lacks dist.tarball; unable to compare files.");
  const url = new URL(publishedMetadata?.tarball);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Published tarball must have an HTTPS URL without embedded credentials.");
  }
  integrityExpectation(publishedMetadata);
  const local = await readPackageContents(fs.createReadStream(localFile), localMetadata, options);
  const response = await (options.fetchImpl || globalThis.fetch)(url.href, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000), redirect: "error"
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Unable to download published tarball: HTTP ${response.status}`);
  }
  const published = await readPackageContents(Readable.fromWeb(response.body), publishedMetadata, options);
  return diffPackageContents(local, published);
}
