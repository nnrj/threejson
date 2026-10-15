import type { PreviewPolicy, PreviewBudget } from "threejson/visual-quality";
export type HostPreviewMode = "auto" | "full" | "balanced" | "economy";
export interface HostPreviewOptions { profiles?: Record<string, PreviewBudget>; device?: { navigator?: { deviceMemory?: number; hardwareConcurrency?: number }; coarsePointer?: boolean }; allowPointSampling?: boolean; allowLod?: boolean; targetFps?: number; samples?: number; downWindows?: number; upWindows?: number; maxSampleMs?: number; downThreshold?: number; upThreshold?: number; onChange?: (event: { mode: string; budget: PreviewBudget }) => void }
export const PREVIEW_PROFILES: Readonly<Record<Exclude<HostPreviewMode, "auto">, Readonly<Required<PreviewBudget> & { mode: string }>>>;
export function resolvePreviewPerformance(mode?: HostPreviewMode, device?: HostPreviewOptions["device"], profiles?: HostPreviewOptions["profiles"]): PreviewBudget & { mode: string };
export function createHostPreviewPerformance(mode?: HostPreviewMode | PreviewPolicy | false, options?: HostPreviewOptions): (PreviewPolicy & { readonly mode?: string }) | undefined;
