import { applyDocumentOperations, cloneDocumentData, documentError, isSceneDocument } from "./sceneDocument.js";

/**
 * One authoring timeline; any number of independent views/playback consumers.
 * A driver prepares off the visible state, then commits synchronously or rolls back.
 */
export class SceneSession {
  #document; #driver; #queue = Promise.resolve(); #disposed = false; #active = null;
  #listeners = new Set(); #undo = []; #redo = []; #viewports = new Set(); #journal = [];
  #historyLimit; #checkpointInterval; #onError;

  constructor(document, options = {}) {
    if (!isSceneDocument(document)) throw documentError("INVALID_SCENE_DOCUMENT", "SceneSession requires a compiled authoring document.");
    this.#document = document;
    this.#driver = options.driver || {};
    this.#historyLimit = options.historyLimit ?? 50;
    this.#checkpointInterval = options.checkpointInterval ?? 20;
    for (const value of [this.#historyLimit, this.#checkpointInterval]) {
      if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError("History limits must be positive integers or Infinity.");
    }
    this.#onError = options.onError;
    this.#journal.push({ revision: document.revision, checkpoint: document });
  }

  get document() { return this.#document; }
  get revision() { return this.#document.revision; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get disposed() { return this.#disposed; }
  snapshot() { return this.#document; }

  subscribe(listener) {
    this.#assertOpen();
    if (typeof listener !== "function") throw new TypeError("SceneSession listener must be a function.");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #assertOpen() {
    if (this.#disposed) throw documentError("SESSION_DISPOSED", "SceneSession is disposed.");
  }

  #report(error) {
    try { this.#onError?.(error); } catch { /* observer failures do not undo valid edits */ }
  }

  #enqueue(callback) {
    const task = this.#queue.then(() => { this.#assertOpen(); return callback(); });
    this.#queue = task.catch(() => {});
    return task;
  }

  async #commit(command, mode = "edit", historyEntry = null) {
    const before = this.#document;
    const result = applyDocumentOperations(before, command.operations, { baseRevision: command.baseRevision });
    if (!result.changed && mode !== "refresh") return { ...result, revision: this.revision };
    const controller = new AbortController();
    this.#active = controller;
    const abort = () => controller.abort(command.signal.reason);
    if (command.signal?.aborted) abort();
    else command.signal?.addEventListener("abort", abort, { once: true });
    let prepared;
    try {
      controller.signal.throwIfAborted();
      prepared = await this.#driver.prepare?.(result.document, {
        previousDocument: mode === "refresh" ? undefined : before, operations: result.operations, signal: controller.signal, mode, prepareOptions: command.prepareOptions
      });
      controller.signal.throwIfAborted();
      this.#assertOpen();
      const committed = prepared?.commit?.();
      if (committed?.then) throw documentError("ASYNC_TRANSACTION_COMMIT", "Prepare asynchronous work before the synchronous transaction commit.");
      this.#document = result.document;
    } catch (error) {
      try { await prepared?.rollback?.(); } catch (rollbackError) { this.#report(rollbackError); }
      try { prepared?.dispose?.(); } catch (disposeError) { this.#report(disposeError); }
      throw error;
    } finally {
      command.signal?.removeEventListener("abort", abort);
      if (this.#active === controller) this.#active = null;
    }

    if (mode === "refresh") {
      try { prepared?.finalize?.(); } catch (error) { this.#report(error); }
      return { ...result, revision: this.revision, refreshed: true };
    }
    if (mode === "edit" && command.recordHistory !== false) {
      const previous = this.#undo[this.#undo.length - 1];
      if (command.historyGroup && previous?.historyGroup === command.historyGroup) {
        previous.operations = previous.operations.concat(result.operations);
        previous.inverse = result.inverse.concat(previous.inverse);
      } else this.#undo.push({ operations: result.operations, inverse: result.inverse, label: command.label || "", historyGroup: command.historyGroup });
      if (this.#undo.length > this.#historyLimit) this.#undo.shift();
      this.#redo.length = 0;
    } else if (mode === "edit") {
      // A non-recorded edit still invalidates redo against the previous document.
      this.#redo.length = 0;
    } else if (mode === "undo" && historyEntry) {
      this.#undo.pop(); this.#redo.push(historyEntry);
    } else if (mode === "redo" && historyEntry) {
      this.#redo.pop(); this.#undo.push(historyEntry);
    }
    this.#journal.push({ revision: this.revision, baseRevision: before.revision, operations: result.operations, label: command.label || "" });
    if (this.#journal.length > this.#checkpointInterval) this.#journal = [{ revision: this.revision, checkpoint: this.#document }];
    const event = { ...result, previousDocument: before, revision: this.revision, mode, label: command.label || "" };
    for (const listener of this.#listeners) { try { listener(event); } catch (error) { this.#report(error); } }
    for (const viewport of this.#viewports) { try { viewport.onDocumentChanged?.(event); } catch (error) { this.#report(error); } }
    // Retired resources can be freed after consumers see the committed document.
    try { prepared?.finalize?.(); } catch (error) { this.#report(error); }
    return event;
  }

  dispatch(command) {
    this.#assertOpen();
    // Capture caller-owned commands before asynchronous queuing. Signals are intentionally not cloned.
    const captured = { ...command, operations: cloneDocumentData(command.operations) };
    return this.#enqueue(() => this.#commit(captured));
  }

  configureHistory(options = {}) {
    const limit = options.limit ?? this.#historyLimit;
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new TypeError("History limit must be positive or Infinity.");
    this.#historyLimit = limit;
    if (this.#undo.length > limit) this.#undo.splice(0, this.#undo.length - limit);
    if (this.#redo.length > limit) this.#redo.splice(0, this.#redo.length - limit);
  }

  clearHistory() { this.#undo.length = 0; this.#redo.length = 0; }

  /** Discard uncommitted playback/preview state without inventing an authoring revision. */
  refreshRuntime(options = {}) {
    return this.#enqueue(() => this.#commit({ ...options, operations: [] }, "refresh"));
  }

  undo(options = {}) {
    return this.#enqueue(async () => {
      const entry = this.#undo[this.#undo.length - 1];
      if (!entry) return { changed: false, revision: this.revision };
      const result = await this.#commit({ ...options, label: entry.label, operations: entry.inverse, baseRevision: this.revision }, "undo", entry);
      return result;
    });
  }

  redo(options = {}) {
    return this.#enqueue(async () => {
      const entry = this.#redo[this.#redo.length - 1];
      if (!entry) return { changed: false, revision: this.revision };
      const result = await this.#commit({ ...options, label: entry.label, operations: entry.operations, baseRevision: this.revision }, "redo", entry);
      return result;
    });
  }

  attachViewport(viewport) {
    this.#assertOpen();
    if (!viewport || typeof viewport !== "object") throw new TypeError("Expected a viewport consumer.");
    this.#viewports.add(viewport);
    return () => this.#viewports.delete(viewport);
  }

  async prepare(options = {}) {
    return this.#enqueue(async () => {
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal.reason);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      this.#active = controller;
      let prepared;
      try {
        controller.signal.throwIfAborted();
        prepared = await this.#driver.prepare?.(this.#document, { previousDocument: null, operations: [], ...options, signal: controller.signal });
        this.#assertOpen(); controller.signal.throwIfAborted();
        const committed = prepared?.commit?.();
        if (committed?.then) throw documentError("ASYNC_TRANSACTION_COMMIT", "Initial commit must be synchronous.");
        prepared?.finalize?.();
        return prepared;
      } catch (error) {
        try { await prepared?.rollback?.(); } catch (rollbackError) { this.#report(rollbackError); }
        try { prepared?.dispose?.(); } catch (disposeError) { this.#report(disposeError); }
        throw error;
      } finally {
        options.signal?.removeEventListener("abort", abort);
        if (this.#active === controller) this.#active = null;
      }
    });
  }

  /** Playback capture is explicit; it never writes animation/physics back into the document. */
  capturePlayback(options = {}) { this.#assertOpen(); return this.#driver.capturePlayback?.(options) ?? null; }
  getJournal() { return cloneDocumentData(this.#journal); }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active?.abort(new DOMException("Session disposed.", "AbortError"));
    this.#listeners.clear();
    for (const viewport of this.#viewports) { try { viewport.dispose?.(); } catch (error) { this.#report(error); } }
    this.#viewports.clear(); this.#undo.length = 0; this.#redo.length = 0; this.#journal.length = 0;
    this.#driver.dispose?.();
  }
}
