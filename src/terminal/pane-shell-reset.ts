/** A killed TUI cannot run its normal terminal teardown. Keep scrollback intact. */
export const AGENT_EXIT_RESET =
  "\x1b[?2026l" +
  "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l" +
  "\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l" +
  "\x1b[?1004l\x1b[?2004l\x1b[?1049l\x1b[?1047l\x1b[?47l\x1b[0m\x1b[?25h";

/** Clear pending readline input and reset the daemon's screen through real PTY output. */
export function shellResumeInput(command: string, windows: boolean): string {
  if (windows) return `${command}\r`;
  const reset = AGENT_EXIT_RESET.split("\x1b").join("\\033");
  return `\x15stty sane && printf '${reset}' && ${command}\r`;
}
