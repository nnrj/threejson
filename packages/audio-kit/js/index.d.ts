export interface Pcm { sampleRate: number; channels: Float32Array[] }
export interface AudioContextOptions { signal?: AbortSignal; onProgress?: (progress: unknown) => void }
export interface ScoreNote { id: string; tick: number; duration: number; pitch: number; velocity?: number; tie?: string; lyric?: string }
export interface ScoreTrack { id: string; instrument?: string; program?: number; percussion?: boolean; gain?: number; pan?: number; notes: ScoreNote[] }
export interface Score { version: 1; ppq?: number; tempos?: { tick: number; bpm: number }[]; tracks: ScoreTrack[]; repeats?: { startTick: number; endTick: number; count: number }[] }
export interface PerformanceNote extends ScoreNote { trackId: string; instrument: string; gain: number; pan: number; velocity: number; start: number; endTick: number }
export interface PerformancePlan { version: 1; ppq: number; duration: number; events: PerformanceNote[] }
export interface BlockRenderer { sampleRate: number; channels: number; render(startFrame: number, frameCount: number): Pcm }
export interface ScoreRenderer extends BlockRenderer { duration: number }
export interface SynthesisOptions { sampleRate?: number; release?: number; gain?: number }
export interface AudioRecipe { kind: string; producer?: string; text?: string; score?: Score; options?: SynthesisOptions; [key: string]: unknown }
export interface AudioProducer { capabilities?: Record<string, unknown>; synthesize(recipe: AudioRecipe, context?: AudioContextOptions): Promise<Pcm> | Pcm; dispose?(): void }
export interface AudioClip { id?: string; pcm?: Pcm; renderer?: ScoreRenderer; start?: number; duration?: number; sourceStart?: number; rate?: number; gain?: number; pan?: number; loop?: boolean; padSilence?: boolean; fadeIn?: number; fadeOut?: number }
export function compileScore(score: Score): PerformancePlan;
export function validatePcm(pcm: Pcm): Pcm;
export function pcmDuration(pcm: Pcm): number;
export function encodeWav(pcm: Pcm): Uint8Array;
export function createScoreRenderer(score: Score | PerformancePlan, options?: SynthesisOptions): ScoreRenderer;
export function synthesizeScore(score: Score | PerformancePlan, options?: SynthesisOptions): Pcm;
export function createPcmMixer(clips: AudioClip[], options?: { sampleRate?: number; channels?: number }): BlockRenderer;
export function decodeAudio(source: string | URL | Blob | ArrayBuffer | Uint8Array, options?: AudioContextOptions & { AudioContext?: typeof AudioContext; fetch?: typeof fetch }): Promise<Pcm>;
export function registerScoreInstrument(id: string, render: (sample: { event: PerformanceNote; time: number; phase: number; frequency: number; sampleRate: number }) => number): () => void;
export function registerAudioProducer(id: string, producer: AudioProducer): () => void;
export function getAudioProducers(): { id: string; [key: string]: unknown }[];
export function produceAudio(recipe: AudioRecipe, context?: AudioContextOptions): Promise<Pcm>;
export function createPcmPlayback(renderer: BlockRenderer & { duration?: number }, options?: { context?: AudioContext; duration?: number; onEnded?: () => void; onError?: (error: Error) => void }): {
  readonly time: number; readonly playing: boolean;
  play(at?: number, options?: { duration?: number; rate?: number }): Promise<void>;
  pause(): void; dispose(): void;
};
