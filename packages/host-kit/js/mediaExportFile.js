/** Host-owned staging: no user-visible destination exists until encoding works.
 * OPFS keeps long exports off the JS heap. Older/private browsers may fall back
 * to media-kit's existing BufferTarget; quota failures are not hidden. */
export async function createStagedMediaFile(storage = globalThis.navigator?.storage) {
  if (!storage?.getDirectory) return null;
  let directory;
  try {
    directory = await (await storage.getDirectory()).getDirectoryHandle("threejson-media-exports", { create: true });
  } catch (error) {
    if (["SecurityError", "NotSupportedError"].includes(error.name)) return null;
    throw error;
  }
  const name = `${crypto.randomUUID()}.tmp`;
  const handle = await directory.getFileHandle(name, { create: true });
  let removed = false;
  return {
    openWritable: () => handle.createWritable(),
    async getFile() {
      const file = await handle.getFile();
      if (!file.size) throw Object.assign(new Error("No encoded media was produced."), { code: "MEDIA_EMPTY_OUTPUT" });
      return file;
    },
    async dispose() {
      if (removed) return;
      removed = true;
      try { await directory.removeEntry(name); } catch (error) { if (error.name !== "NotFoundError") throw error; }
    }
  };
}

/** Copy a finished artifact transactionally; a failed save can retry the same file. */
export async function saveCompletedMediaFile(file, handle, { signal } = {}) {
  if (!file?.size) throw Object.assign(new Error("Cannot save empty media."), { code: "MEDIA_EMPTY_OUTPUT" });
  signal?.throwIfAborted();
  const writable = await handle.createWritable();
  await file.stream().pipeTo(writable, { signal });
  if ((await handle.getFile()).size !== file.size) throw new Error("Saved media size does not match the completed export. Retry saving.");
}
