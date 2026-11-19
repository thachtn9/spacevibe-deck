import type { Terminal } from "@xterm/xterm";

/** Only recognize an empty prompt at the live cursor, never a prompt in scrollback. */
export function reviewComposerEmpty(term: Pick<Terminal, "buffer">): boolean {
  const buffer = term.buffer.active;
  const row = buffer.baseY + buffer.cursorY;
  const line = buffer.getLine(row);
  if (!line || line.isWrapped) return false;
  const before = line.translateToString(false, 0, buffer.cursorX);
  if (!/^\s*[›❯>]\s*$/.test(before)) return false;
  if (line.translateToString(true, buffer.cursorX).trim()) return false;
  // Inspect the whole remaining composer, including blank lines before a draft.
  for (let y = row + 1; y < buffer.length; y++) {
    const next = buffer.getLine(y);
    if (!next) break;
    if (next.isWrapped) return false;
    const text = next.translateToString(true);
    if (!text.trim()) continue;
    if (/^[\s─━╰╯└┘]+$/.test(text)) return true;
    // Codex's footer sits below its borderless composer.
    if (/^\s*\? for shortcuts(?:\s+.*)?$/.test(text)) return true;
    return false;
  }
  return true;
}
