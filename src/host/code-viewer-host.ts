import { invoke, listen, type UnlistenFn } from "./bridge";

export interface CodeViewerRequest {
  readonly root: string;
  readonly path: string | null;
  readonly line: number;
  readonly column: number;
  readonly nonce: number;
}
export function openCodeViewer(
  root: string,
  path: string | null = null,
  line = 1,
  column = 1,
): Promise<void> {
  return invoke("code_viewer_open", { root, path, line, column });
}
export function codeViewerState(): Promise<CodeViewerRequest> {
  return invoke("code_viewer_state");
}
export function listenCodeViewerOpen(
  handler: (request: CodeViewerRequest) => void,
): Promise<UnlistenFn> {
  return listen<CodeViewerRequest>("code-viewer:open", (event) => handler(event.payload));
}
