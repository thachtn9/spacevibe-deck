import { Terminal } from "@xterm/headless";
import { expect, it } from "vitest";
import { AGENT_EXIT_RESET, shellResumeInput } from "./pane-shell-reset";

it("disables a killed TUI's mouse modes and returns to the shell without deleting scrollback", async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const write = (data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));
  try {
    await write(
      "shell history\r\n\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[?25l",
    );
    expect(terminal.modes.mouseTrackingMode).toBe("any");
    expect(terminal.buffer.active.type).toBe("alternate");
    await write(AGENT_EXIT_RESET);
    expect(terminal.modes.mouseTrackingMode).toBe("none");
    expect(terminal.modes.bracketedPasteMode).toBe(false);
    expect(terminal.modes.sendFocusMode).toBe(false);
    expect(terminal.buffer.active.type).toBe("normal");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("shell history");
  } finally {
    terminal.dispose();
  }
});

it("clears the shell's pending line and restores PTY modes before resume", () => {
  const data = shellResumeInput("cli resume exact-id --acc codex2", false);
  expect(data.startsWith("\x15stty sane && printf '")).toBe(true);
  expect(data).toContain("\\033[?1003l");
  expect(data.endsWith(" && cli resume exact-id --acc codex2\r")).toBe(true);
  expect(shellResumeInput("cli resume exact-id --acc codex2", true)).toBe(
    "cli resume exact-id --acc codex2\r",
  );
});
