import type { Scene, Camera, Color, Quaternion } from "three";
export type TimelineValue = number | string | boolean | TimelineValue[] | { [key: string]: TimelineValue };
export interface TimelineSignal { type: "constant" | "sine" | "pulse" | "noise" | "envelope" | "orbit" | "path" | string; duration?: number; points?: number[][]; [key: string]: unknown }
export interface TimelineTrack { id: string; target: string; property: string; enabled?: boolean; easing?: string; start?: number; duration?: number; extrapolation?: "hold" | "none" | "loop"; signal?: TimelineSignal; keyframes?: { time: number; value: TimelineValue; easing?: string }[] }
export interface TimelineClip { id: string; source: string | Record<string, unknown>; start?: number; duration: number; sourceStart?: number; rate?: number; fadeIn?: number; fadeOut?: number; enabled?: boolean; transitionIn?: { type: "wipe" | "dissolve"; duration: number; direction?: "left" | "right" | "up" | "down"; seed?: number; softness?: number } }
export interface TimelineItem { id: string; start?: number; duration?: number; enabled?: boolean; [key: string]: unknown }
export interface Timeline { version?: 1; duration?: number; rate?: number; loop?: boolean; simulationStep?: number; tracks?: TimelineTrack[]; audio?: TimelineItem[]; captions?: TimelineItem[]; clips?: TimelineClip[]; effects?: TimelineItem[] }
export interface SceneClock { readonly time: number; readonly playing: boolean; readonly duration: number; readonly rate: number; play(): void; pause(): void; seek(time: number): number; reset(): void; advance(delta: number): number; setRate(rate: number): void }
export interface TimelineController { timeline: Timeline; clock: SceneClock; readonly time: number; readonly duration: number; readonly playing: boolean; evaluateAt(time: number): number; seek(time: number): number; play(): void; pause(): void; reset(): number; advance(delta: number): void; renderAt(time: number): Promise<HTMLCanvasElement | undefined>; dispose(): void }
export interface TimelineRuntime { scene: Scene; camera?: Camera; timeline?: TimelineController; [key: string]: unknown }
export function createSceneClock(options?: { duration?: number; rate?: number; loop?: boolean }): SceneClock;
export function validateTimeline(input?: Timeline): Timeline;
export function getTimelineDuration(timeline?: Timeline): number;
export function getActiveClips(timeline: Timeline, time: number): (TimelineClip & { sourceTime: number; localTime: number; opacity: number })[];
export function timelineError(code: string, message: string, details?: Record<string, unknown>): Error & { code: string };
export function registerTimelineEasing(id: string, evaluate: (time: number) => number): () => void;
export function registerTimelineSignal(id: string, evaluate: (signal: TimelineSignal, time: number) => TimelineValue): () => void;
export function getTimelineSignals(): string[];
export function validateTimelineSignal(signal: TimelineSignal): TimelineSignal;
export function sampleTimelineSignal(signal: TimelineSignal, time: number): TimelineValue;
export function sampleTimelineWindow(item: TimelineItem | TimelineTrack, time: number): { time: number; progress: number } | null;
export function matchParticlePositions(source: Float32Array, destination: Float32Array, mode?: "spatial" | "index"): Float32Array;
export function sampleTimelineTrack(track: TimelineTrack, time: number, kind?: "color" | "quaternion"): TimelineValue | Color | Quaternion | undefined;
export function compileTimelineTracks(runtime: TimelineRuntime, tracks?: TimelineTrack[], options?: Record<string, unknown>): { restore(): void; evaluate(time: number): void };
export function createSceneTimelineController(runtime: TimelineRuntime, input?: Timeline, options?: Record<string, unknown>): TimelineController;
export function attachSceneTimeline(runtime: TimelineRuntime, input: Timeline, options?: Record<string, unknown>): Promise<TimelineController>;
export function prepareTimelineResources(runtime: TimelineRuntime, options?: { signal?: AbortSignal }): Promise<void>;
export function registerParticleMotionOperator(id: string, evaluate: (context: { x: number; y: number; z: number; time: number; progress: number; index: number; count: number; params: Record<string, unknown>; destination?: Float32Array; flow?: Float32Array }) => [number, number, number]): () => void;
export function getParticleMotionOperators(): string[];
export function prepareParticleEffects(runtime: TimelineRuntime, effects: TimelineItem[], options?: { signal?: AbortSignal }): Promise<{ bindTimeline(timeline: Timeline): void; restore(): void; reset(): void; evaluateAt(time: number): void; dispose(): void }>;
