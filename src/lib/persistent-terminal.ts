/** Linux terminal identity survives the UI process, but never aliases a new daemon. */
export interface PersistentTerminalMetadata {
  readonly agent: string | null;
  readonly sessionId: string | null;
  readonly launchCommand: string | null;
  readonly cwd: string | null;
  readonly account?: string | null;
}

export interface PersistentTerminalSnapshot {
  readonly id: number;
  readonly reference: string;
  readonly cols: number;
  readonly rows: number;
  readonly screen: string;
  readonly metadata: PersistentTerminalMetadata;
}

export const TERMINAL_REFERENCE = /^[0-9a-f-]{36}:[1-9][0-9]*$/i;

export function accountFromCommand(command: string | null): string | null {
  if (!command) return null;
  return (
    /^cli ([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(command)?.[1] ??
    /^cli resume [A-Za-z0-9._-]+ --acc ([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(command)?.[1] ??
    null
  );
}
