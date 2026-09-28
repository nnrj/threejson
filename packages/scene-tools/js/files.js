import { readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const toolError = (code, message) => Object.assign(new Error(message), { code });
export const fileVersion = (data) => createHash("sha256").update(data).digest("hex");
export async function readVersionedFile(file) {
  try { const bytes = await readFile(file); return { bytes, version: fileVersion(bytes) }; }
  catch (error) { if (error.code === "ENOENT") return { bytes: null, version: null }; throw error; }
}

/** Same-directory atomic replacement plus cooperative lock and optimistic version check. */
export async function writeVersionedFile(file, data, expectedVersion) {
  const target = path.resolve(file), lockPath = `${target}.threejson-lock`, temporary = `${target}.${randomUUID()}.tmp`;
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw toolError("FILE_BUSY", "Another scene writer holds this file's lock. Inspect an abandoned lock before removing it."); throw error; }
  try {
    if (expectedVersion === undefined) throw toolError("FILE_VERSION_REQUIRED", "Read the destination version before replacing it.");
    const before = await readVersionedFile(target);
    if (before.version !== expectedVersion) throw toolError("FILE_CHANGED", "The scene file changed externally; reopen or save a new file instead of overwriting it.");
    await writeFile(temporary, data, { flag: "wx" });
    if ((await readVersionedFile(target)).version !== expectedVersion) throw toolError("FILE_CHANGED", "The scene file changed during export; the original was preserved.");
    // External programs do not obey our lock: this is optimistic concurrency, not an OS-wide CAS.
    await rename(temporary, target);
    return { path: target, version: fileVersion(data) };
  } finally {
    try { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
    finally { try { await lock.close(); } finally { await unlink(lockPath); } }
  }
}
