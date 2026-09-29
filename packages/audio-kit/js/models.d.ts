export interface AudioModelFile { role: string; bytes: number; sha256: string; path?: string; url?: string; storageKey?: string }
export interface AudioModelIdentity { id: string; version: string }
export interface AudioModelManifest extends AudioModelIdentity { adapter: string; license: string; files: AudioModelFile[]; installedAt?: string }
export interface ModelStorage {
  kind?: string; directory?: string;
  getBlob(key: string): Promise<Blob | null | undefined>;
  getJson(key: string): Promise<AudioModelManifest | null | undefined>;
  putJson(key: string, value: AudioModelManifest): Promise<unknown>;
  createWriter(key: string): Promise<{ write(data: Uint8Array): Promise<unknown> | void; close(): Promise<unknown>; abort?(): Promise<unknown> }>;
  remove(key: string): Promise<unknown>; list(): Promise<string[]>;
  estimate?(): Promise<StorageEstimate>; persist?(): Promise<boolean>; close?(): void;
}
export interface ModelRequest { signal?: AbortSignal; onProgress?: (value: { role: string; loaded: number; total: number }) => void }
export interface ModelLease { manifest: AudioModelManifest; files: Record<string, Blob>; release(): void }
export interface AudioModelManager {
  download(manifest: AudioModelManifest, request?: ModelRequest): Promise<{ id: string; version: string; status: "ready" }>;
  import(manifest: AudioModelManifest, files: Record<string, Blob | Uint8Array>, request?: ModelRequest): Promise<{ id: string; version: string; status: "ready" }>;
  list(): Promise<AudioModelManifest[]>;
  status(identity: AudioModelIdentity): Promise<{ status: "missing" | "incomplete" | "ready"; manifest?: AudioModelManifest }>;
  acquire(identity: AudioModelIdentity): Promise<ModelLease>; remove(identity: AudioModelIdentity): Promise<void>;
  estimate(): Promise<StorageEstimate> | undefined; persist(): Promise<boolean> | undefined; close(): void;
}
export function validateAudioModelManifest(input: AudioModelManifest): AudioModelManifest;
export function createAudioModelManager(storage: ModelStorage, options?: { fetch?: typeof fetch; onCleanupError?: (error: Error, key: string) => void }): AudioModelManager;
export function createBrowserAudioModelStorage(options?: { preferIndexedDb?: boolean; storage?: StorageManager; onFallback?: (error: Error) => void }): Promise<ModelStorage>;
