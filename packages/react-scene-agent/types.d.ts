import type { ReactNode } from "react";

export interface SceneCardRuntime {
  render(scene: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  setLabel(label?: string): string;
  applyCommands(commands: unknown[], options?: Record<string, unknown>): Promise<unknown>;
  applyCommandsWithResult(commands: unknown[], options?: Record<string, unknown>): Promise<any>;
  exportSceneJsonString(options?: Record<string, unknown>): Promise<string>;
  finalize(scene: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  updateSceneJson(scene: Record<string, unknown>): void;
  getRuntime(): any;
  setTextureProgress(event?: Record<string, unknown>): void;
  setPreviewAuxiliaryLightsEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface SceneAgentSceneCardProps {
  sceneJson: Record<string, unknown> | null;
  label?: string;
  options?: Record<string, unknown>;
  showToast?: (message: string, kind?: string) => void;
  onReady?: (card: SceneCardRuntime | null) => void;
  managed?: boolean;
}

export type SceneAgentReactNode = ReactNode;
