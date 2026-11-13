import { signal } from "@preact/signals";

/** Shared with chrome and shortcut guards; opening code never creates a PTY. */
export const codeViewerRoot = signal<string | null>(null);
