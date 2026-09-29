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
  resolveAsset(url: string): Promise<string>; renderAt(time: number): Promise<HTMLCanvasElement | OffscreenCanvas>;
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
