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
}
