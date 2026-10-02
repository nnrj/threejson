import type { Timeline } from "threejson/timeline";
import type { BlockRenderer, AudioRecipe, Pcm } from "@threejson/audio-kit";
export interface MediaDocument { documentType?: "scene" | "composition"; compositionVersion?: 1; timeline?: Timeline; output?: { width?: number; height?: number; fps?: number; background?: string }; [key: string]: unknown }
export type MediaInput = MediaDocument | string | Blob | ArrayBuffer | Uint8Array;
export interface MediaProgress { stage: string; frame: number; frames: number; progress: number; time?: number }
export interface MediaAudioClip { id: string; url?: string; pcm?: Pcm; recipe?: AudioRecipe; start?: number; duration?: number; [key: string]: unknown }
export interface MediaOptions {
  width?: number; height?: number; fps?: number; duration?: number; start?: number; end?: number; time?: number; alpha?: boolean;
  format?: "mp4" | "webm"; type?: "image/png" | "image/jpeg" | "image/webp"; quality?: number; repeat?: number;
  audio?: boolean; sampleRate?: number; trimAudio?: boolean; audioClips?: MediaAudioClip[];
  signal?: AbortSignal; onProgress?: (progress: MediaProgress) => void;
  baseUrl?: string; fetch?: typeof fetch; canvas?: HTMLCanvasElement | OffscreenCanvas;
  createCanvas?: () => HTMLCanvasElement | OffscreenCanvas;
  runtimeOptions?: Record<string, unknown>;
  preloadNext?: boolean; preloadSeconds?: number;
  writable?: WritableStream<{ type: "write"; position: number; data: Uint8Array }>;
  videoBitrate?: number; audioBitrate?: number; [key: string]: unknown;
}
export interface OpenMediaDocument {
  document: MediaDocument; baseUrl?: string;
  resolveAsset(url: string): Promise<string>; loadScene(source: string | MediaDocument): Promise<MediaDocument>;
  materialize<T>(value: T): Promise<T>; ownerOf(scene: MediaDocument): OpenMediaDocument; dispose(): void;
}
export interface MediaProject {
  canvas: HTMLCanvasElement | OffscreenCanvas; document: MediaDocument; duration: number; width: number; height: number;
  resolveAsset(url: string, context?: { kind?: string }): Promise<string>; renderAt(time: number): Promise<HTMLCanvasElement | OffscreenCanvas>;
  getAudioClips(): Promise<MediaAudioClip[]>; dispose(): void;
}
export interface MediaResult { blob: Blob | null; mimeType: string; width?: number; height?: number; duration?: number; frames?: number; time?: number; audio?: boolean }
export function validateMediaDocument(input: MediaDocument): MediaDocument;
export function openMediaDocument(input: MediaInput, options?: MediaOptions): Promise<OpenMediaDocument>;
export function packMediaDocument(document: MediaDocument, options?: { assets?: Record<string, Blob | ArrayBuffer | Uint8Array>; outputType?: "bytes" }): Promise<Uint8Array>;
export function packMediaDocument(document: MediaDocument, options: { assets?: Record<string, Blob | ArrayBuffer | Uint8Array>; outputType: "blob" }): Promise<Blob>;
export function createMediaProject(input: MediaInput, options?: MediaOptions): Promise<MediaProject>;
export function resolveFrameRange(project: MediaProject, options?: MediaOptions): { start: number; end: number; duration: number; fps: number; frames: number };
export function prepareProjectAudio(project: MediaProject, options?: MediaOptions): Promise<(BlockRenderer & { duration: number }) | null>;
export function getMediaCapabilities(options?: MediaOptions): Promise<{ images: string[]; gif: boolean; video: Record<string, { video: boolean; audio: boolean }>; localSpeech: boolean; note: string }>;
export function renderImage(input: MediaInput | MediaProject, options?: MediaOptions): Promise<MediaResult>;
export function renderGif(input: MediaInput | MediaProject, options?: MediaOptions): Promise<MediaResult>;
export function renderVideo(input: MediaInput | MediaProject, options?: MediaOptions): Promise<MediaResult>;
export interface MediaCommand { op: string; args?: Record<string, unknown> }
export interface MediaTransactionOptions { baseRevision?: number; requestId?: string; sessionId?: string; label?: string; signal?: AbortSignal }
export interface MediaProjectSession {
  readonly document: MediaDocument; readonly revision: number; readonly disposed: boolean;
  snapshot(): MediaDocument; inspect(): Record<string, unknown>;
  subscribe(listener: (event: { document: MediaDocument; previousDocument: MediaDocument; revision: number; label: string }) => void): () => void;
  dispatch(commands: MediaCommand | MediaCommand[], options?: MediaTransactionOptions): Promise<unknown>;
  undo(options?: MediaTransactionOptions): Promise<unknown>; redo(options?: MediaTransactionOptions): Promise<unknown>; dispose(): void;
}
export function createMediaProjectSession(input?: MediaDocument, options?: { duration?: number; historyLimit?: number; prepare?: (document: MediaDocument, context: unknown) => Promise<void>; onError?: (error: Error) => void }): MediaProjectSession;
export function inspectMediaDocument(document: MediaDocument, revision?: number): Record<string, unknown>;
export function diagnoseMediaDocument(document: MediaDocument): { satisfied: boolean; diagnostics: { code: string; message: string; shotId?: string; severity: string }[]; checks: Record<string, string> };
export interface MediaOperationReceipt { ok: boolean; status: string; revision: number; results: { op: string; ok: boolean; data: unknown }[]; code?: string; error?: string; [key: string]: unknown }
export function createMediaOperationService(options: { session: MediaProjectSession; adapters?: Record<string, (...args: any[]) => Promise<unknown>> }): {
  readonly revision: number; sessionId: string; discover(): Record<string, unknown>; execute(commands: MediaCommand | MediaCommand[], options?: MediaTransactionOptions): Promise<MediaOperationReceipt>;
};
export interface Narration { duration: number; cues: { id: string; text: string; start: number; duration: number; url: string }[]; model?: string; modelVersion?: string }
export function synthesizeNarration(text: string, producer: import("@threejson/audio-kit").AudioProducer, options?: { signal?: AbortSignal; speed?: number; captionSentences?: string[]; cache?: Map<string, unknown>; onProgress?: (progress: unknown) => void }): Promise<Narration>;
export function createNarrationCommands(document: MediaDocument, shotId: string, narration: Narration, options?: { extend?: boolean }): MediaCommand[];
