/** Versioned contract shared by the Electron gateway and its renderer adapter. */
export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_INPUT_LIMIT = 32_768;
export const REMOTE_SCREEN_LIMIT = 262_144;

export interface RemotePane {
  readonly paneId: number;
  readonly tabKey: number;
  readonly title: string;
  readonly path: string | null;
  readonly agentId: string | null;
  readonly account: string | null;
  readonly phase: string;
  readonly attention: string;
  readonly startedAt: number;
}

export interface RemoteSession extends RemotePane {
  readonly id: string;
  readonly generation: string;
}

export interface RemoteCreate {
  readonly path: string;
  readonly agentId: "codex" | "agy" | null;
  readonly accountId: string | null;
}

export interface RemoteScreen {
  readonly text: string;
  readonly rows?: readonly (readonly RemoteScreenRun[])[];
  readonly foreground?: string;
  readonly background?: string;
  readonly capturedAtMs: number;
  readonly alive: boolean;
}

/** Display-only cells from the owning xterm buffer; never HTML or terminal commands. */
export interface RemoteScreenRun {
  readonly text: string;
  readonly foreground: string;
  readonly background: string;
  /** Bold, italic, underline, strikethrough and dim, in bits 0 through 4. */
  readonly flags: number;
}

export interface RemoteAccessStatus {
  readonly enabled: boolean;
  readonly port: number;
  readonly root: string;
  readonly addresses: readonly string[];
  readonly error: string | null;
}

export type RemoteOperation =
  | {
      readonly kind: "terminal";
      readonly pane: RemotePane;
      readonly request: RemoteTerminalRequest;
    }
  | { readonly kind: "screen"; readonly pane: RemotePane }
  | { readonly kind: "input"; readonly pane: RemotePane; readonly text: string }
  | { readonly kind: "create"; readonly request: RemoteCreate };

export interface RemoteRpcRequest {
  readonly requestId: string;
  readonly deadline: number;
  readonly operation: RemoteOperation;
}

/** A pane id alone must never retarget a request to a replacement agent/tab. */
export function remotePaneIdentity(pane: RemotePane): string {
  return JSON.stringify([
    pane.paneId,
    pane.tabKey,
    pane.startedAt,
    pane.agentId,
    pane.account,
    pane.phase === "exited",
  ]);
}

/** A browser lease changes geometry, never PTY ownership. */
export interface RemoteTerminalRequest {
  readonly action: "read" | "claim" | "release" | "write";
  readonly client: string;
  readonly generation: string;
  readonly cursor?: number;
  readonly cols?: number;
  readonly rows?: number;
  readonly data?: string;
}

export interface RemoteTerminalFrame {
  readonly alive?: boolean;
  readonly cursor: number;
  readonly data: string;
  readonly reset: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly controller: string | null;
}
