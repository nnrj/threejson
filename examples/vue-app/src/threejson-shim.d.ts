declare module "threejson" {
  export function createJsonScene(
    payload: Record<string, unknown>,
    options?: { canvas?: HTMLCanvasElement; resetScene?: boolean }
  ): Promise<{
    start: () => void;
    stop: () => void;
    dispose: () => void;
    resize?: (size?: { width?: number; height?: number }) => void;
  }>;

  export function createSceneRuntimeAsync(options: {
    canvas: HTMLCanvasElement;
    config?: Record<string, unknown>;
  }): Promise<{
    scene: import("three").Scene;
    camera: import("three").PerspectiveCamera;
    renderer: import("three").WebGLRenderer;
    dispose: () => void;
    start: () => void;
    stop: () => void;
  }>;
}
