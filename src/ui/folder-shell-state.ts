import { signal } from "@preact/signals";

/** Shared with the shortcut guard so terminal actions cannot run behind the picker. */
export const folderShellRoot = signal<string | null>(null);
