import { invoke } from "./bridge";

/** Image clipboard support is Electron-only; other hosts retain text paste. */
export const available = (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export function readClipboardImage(): Promise<string | null> {
  return available ? invoke<string | null>("clipboard_read_image") : Promise.resolve(null);
}
