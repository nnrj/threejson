export interface MediaReference { kind: "image" | "gif" | "video"; source?: unknown; frames?: { time: number; source: unknown }[] }
export interface AnalysisCapabilities { inputModalities: string[] }
export type AnalysisRoute = "image" | "video" | "frames";
export function selectMediaAnalysisRoute(capabilities: AnalysisCapabilities, kind: MediaReference["kind"], preference?: "auto" | "frames"): AnalysisRoute;
export function validateMediaReference(input: MediaReference): MediaReference;
export function analyzeMediaReference(input: MediaReference, options: {
  analyzer: { capabilities: AnalysisCapabilities; analyze(options: { reference: MediaReference; route: AnalysisRoute; userPrompt?: string; signal?: AbortSignal }): Promise<unknown> };
  extractFrames?: (reference: MediaReference, options: { signal?: AbortSignal }) => Promise<NonNullable<MediaReference["frames"]>>;
  preference?: "auto" | "frames"; signal?: AbortSignal; userPrompt?: string;
}): Promise<{ kind: "media-analysis"; version: 1; reference: MediaReference; route: AnalysisRoute; userPrompt?: string; analysis: unknown; reconstruction: "approximate"; note: string }>;
