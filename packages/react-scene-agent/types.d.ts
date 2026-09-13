import type { ReactNode } from "react";

export interface SceneCardRuntime {
  render(scene: Record<string, unknown> | string, options?: Record<string, unknown>): Promise<unknown>;
  setLabel(label?: string): string;
  applyCommands(commands: unknown[], options?: Record<string, unknown>): Promise<unknown>;
  applyCommandsWithResult(commands: unknown[], options?: Record<string, unknown>): Promise<any>;
  exportSceneJsonString(options?: Record<string, unknown>): Promise<string>;
  finalize(scene: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  updateSceneJson(scene: Record<string, unknown>): Promise<Record<string, unknown>>;
  applyTextureAssignment(assignment: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  getRuntime(): any;
  activate(): Promise<unknown>;
  setViewportLimit(value: number): Promise<void> | undefined;
  setTextureProgress(event?: Record<string, unknown>): void;
  setPreviewAuxiliaryLightsEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface SceneAgentSceneCardProps {
  /** Serialized history is decoded on demand when defer is true. */
  sceneJson: Record<string, unknown> | string | null;
  label?: string;
  options?: Record<string, unknown>;
  showToast?: (message: string, kind?: string) => void;
  onReady?: (card: SceneCardRuntime | null) => void;
  managed?: boolean;
  defer?: boolean;
}

export type SceneAgentReactNode = ReactNode;
