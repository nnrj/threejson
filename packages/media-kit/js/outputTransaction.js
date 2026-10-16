const emptyOutput = () => Object.assign(new Error("The encoder produced no media data; no file was saved."), { code: "MEDIA_EMPTY_OUTPUT" });
export { emptyOutput };

/** A muxer's close/cancel only closes its staging stream. Commit the user's
 * destination once the entire export succeeds; abort preserves an existing file.
 */
export function createOutputTransaction(writable) {
  const writer = writable.getWriter();
  // Stream errors are propagated by writes/close; observe closed as well so a
  // rejected filesystem close never creates a separate unhandled rejection.
  void writer.closed.catch(() => {});
  let bytesWritten = 0, settled = false;
  const stream = new WritableStream({
    async write(chunk) {
      await writer.write(chunk);
      bytesWritten = Math.max(bytesWritten, chunk.position + chunk.data.byteLength);
    }
    // Deliberately no close(): Mediabunny also closes targets during cancel().
  });
  return {
    stream,
    get bytesWritten() { return bytesWritten; },
    async commit() {
      if (!bytesWritten) throw emptyOutput();
      await writer.close(); settled = true; writer.releaseLock();
    },
    async abort(reason) {
      if (settled) return;
      settled = true;
      try { await writer.abort(reason); } finally { writer.releaseLock(); }
    }
  };
}
