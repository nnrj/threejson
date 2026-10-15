import type { BufferGeometry } from "three";
export interface PreviewBudget { maxPixelRatio?: number; maxPixels?: number; maxPoints?: number; lodBias?: number }
export interface PreviewFrameSample { workTimeMs: number; frameIntervalMs?: number | null; realtime?: boolean; targetFrameMs?: number }
export interface PreviewPolicy extends PreviewBudget { getBudget?: () => PreviewBudget; onFrame?: (sample: PreviewFrameSample) => void; resetFeedback?: () => void }
export type PreviewPerformance = false | "full" | PreviewPolicy;
export const FULL_PREVIEW_BUDGET: Readonly<Required<PreviewBudget> & { mode: "full" }>;
export function resolvePreviewBudget(options?: PreviewPerformance): Required<PreviewBudget> & { mode: "full" | "limited" };
export function createPreviewPerformance(options?: PreviewPerformance): { readonly profile: ReturnType<typeof resolvePreviewBudget>; pixelRatio(requested: number, width: number, height: number): number; constrainResolution(renderer: any, composer?: any): void; draw(scene: any, camera: any, renderer: any, composer: any, render: () => any): any; reportFrame(sample: PreviewFrameSample): void; resetFeedback(): void; dispose(): void };
export interface QualityProfile { id: string; repairRounds: number; views: number; samplesPerShot: number; alternatives: number; reviewVisual: boolean; [key: string]: unknown }
export interface QualityIssue { code: string; severity?: "info" | "warning" | "error"; message?: string; [key: string]: unknown }
export interface QualityView { name: string; dataUrl: string; width?: number; height?: number; diagnosticRelighting?: boolean; [key: string]: unknown }
export interface QualityObservation { available: boolean; warnings?: QualityIssue[]; views?: QualityView[]; [key: string]: unknown }
export interface QualityReport { version: 1; sourceRevision: string; savedRevision?: string; observedRevision?: string; profile: string; repairs: number; structural: "checked" | "failed" | "unchecked"; visual: "passed" | "needs-work" | "not-requested" | "unavailable" | "stale"; checksComplete?: boolean; completed: boolean; stale?: boolean; stopReason: string; messageCode?: string; message: string; issues: QualityIssue[]; observation: QualityObservation; coverage?: { structural: unknown; visual: "sampled" | "none"; viewCount: number }; visualReason?: string; error?: string; referencedAssets?: { name?: string; source?: string; license: string; author?: string; landingUrl?: string }[] }
export function resolveQualityReviewProfile(value?: Partial<QualityProfile>): QualityProfile;
export function providerSupportsVision(provider?: { capabilities?: { vision?: boolean; inputModalities?: string[] }; [key: string]: unknown }): boolean;
export function buildCreationQualityInstructions(value?: Partial<QualityProfile>): string;
export function sceneQualityRevision(document: unknown): Promise<string>;
export function runCreationQualityReview<T extends object>(document: T, options?: {
  profile?: Partial<QualityProfile>; signal?: AbortSignal; visionAvailable?: boolean;
  inspect?: (document: T, context: { profile: QualityProfile; signal?: AbortSignal }) => QualityObservation | Promise<QualityObservation>;
  review?: (context: { document: T; observed: QualityObservation; profile: QualityProfile; signal?: AbortSignal }) => { satisfied: boolean; issues: QualityIssue[] } | Promise<{ satisfied: boolean; issues: QualityIssue[] }>;
  repair?: (document: T, context: { issues: QualityIssue[]; observed: QualityObservation; profile: QualityProfile; signal?: AbortSignal }) => T | Promise<T>;
  validate?: (document: T) => boolean | Promise<boolean>;
  onProgress?: (event: { kind: string; message: string; qualityReport: QualityReport }) => void;
}): Promise<{ document: T; report: QualityReport }>;
export function bindStoredQualityReport(report: QualityReport | null | undefined, document: unknown): Promise<QualityReport | null>;
export function invalidateQualityReport(report: QualityReport | null | undefined, reason?: string): QualityReport | null;
export function verifyStoredQualityReport(report: QualityReport | null | undefined, document: unknown): Promise<QualityReport | null | undefined>;
export interface GeometryQuality { vertices: number; triangles: number; inspectedTriangles: number; inspectedVertices?: number; invalidPositions: number; invalidNormals: number; invalidIndices: number; degenerateTriangles: number; reversedNormals: number; boundaryEdges: number; nonManifoldEdges: number; inconsistentWindingEdges: number; complete: boolean }
export function inspectGeometryQuality(geometry: BufferGeometry, options?: { maxTriangles?: number; maxVertices?: number; tolerance?: number }): GeometryQuality;
export function observeSceneRuntime(runtime: any, options?: { maxObjects?: number; maxTriangles?: number; maxVertices?: number; occlusion?: boolean }): QualityObservation;
export function captureSceneFrame(runtime: any, options?: { signal?: AbortSignal; mimeType?: string; revision?: string | number }): Promise<{ kind: "scene"; diagnosticRelighting: false; timestamp: string; revision: string | number | null; views: QualityView[]; observation: QualityObservation }>;
export function measureSubjectRegions(canvas: HTMLCanvasElement, observation: QualityObservation): { id: string; approximate: true; displayLuminance: { p10: number; median: number; p90: number }; samplePixels: number }[];
export type Vector3Tuple = [number, number, number];
export type LightingRecipe = "product" | "interior" | "outdoor" | "night" | "diagram";
export type MaterialRecipe = "ceramic" | "brushedMetal" | "glass" | "plastic" | "matte" | "diagram";
export const LIGHTING_RECIPES: readonly LightingRecipe[];
export const MATERIAL_RECIPES: Readonly<Record<MaterialRecipe, Record<string, unknown>>>;
export function createLightingRecipe(name?: LightingRecipe, options?: { center?: Vector3Tuple; size?: number; viewDirection?: Vector3Tuple }): Record<string, any>;
export function createMaterialRecipe(name: MaterialRecipe, overrides?: Record<string, unknown>): Record<string, any>;
export function createFramingCamera(options: { bounds: { min: Vector3Tuple; max: Vector3Tuple }; aspect?: number; fov?: number; occupancy?: number; viewDirection?: Vector3Tuple }): Record<string, any>;
