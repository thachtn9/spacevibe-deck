/* oxlint-disable eslint/no-control-regex -- Terminal protocol assertions intentionally match ESC control sequences. */
interface MouseTerminal {
  readonly _core?: { readonly coreMouseService?: { readonly activeEncoding?: string } };
}

/** xterm's serializer preserves mouse tracking but omits its wire encoding. */
export function terminalMouseEncodingSequence(terminal: unknown): string {
  const encoding = (terminal as MouseTerminal | null)?._core?.coreMouseService?.activeEncoding;
  if (encoding === "SGR") return "\x1b[?1006h";
  if (encoding === "SGR_PIXELS") return "\x1b[?1016h";
  // Record DEFAULT explicitly so a compatibility reader never guesses another encoding.
  return encoding === "DEFAULT" ? "\x1b[?1006l\x1b[?1016l" : "";
}

/** Older detached services cannot be replaced while their PTYs are running. */
export function restoreLegacyCodexMouseEncoding(screen: string, agent: string | null): string {
  if (
    agent !== "codex" ||
    !/\x1b\[\?(?:9|1000|1002|1003)h/.test(screen) ||
    /\x1b\[\?(?:1006|1016)[hl]/.test(screen)
  )
    return screen;
  // Codex's crossterm mouse capture expects SGR, never the legacy binary reports.
  return `${screen}\x1b[?1006h`;
}
