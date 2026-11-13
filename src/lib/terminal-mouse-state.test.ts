/* oxlint-disable eslint/no-control-regex -- Terminal protocol assertions intentionally match ESC control sequences. */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { SerializeAddon as SerializeType } from "@xterm/addon-serialize";
import {
  restoreLegacyCodexMouseEncoding,
  terminalMouseEncodingSequence,
} from "./terminal-mouse-state";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as { Terminal: typeof HeadlessTerminal };
const { SerializeAddon } = require("@xterm/addon-serialize") as {
  SerializeAddon: typeof SerializeType;
};
const write = (terminal: HeadlessTerminal, data: string) =>
  new Promise<void>((resolve) => terminal.write(data, resolve));

function createScreen() {
  const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 4000 });
  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);
  return { terminal, serialize };
}

describe("persistent terminal mouse encoding", () => {
  it.each(["SGR", "SGR_PIXELS", "DEFAULT"] as const)(
    "preserves %s alongside long scrollback",
    async (encoding) => {
      const source = createScreen(),
        restored = createScreen();
      try {
        await write(
          source.terminal,
          Array.from({ length: 3000 }, (_, i) => `Conversation ${i}\r\n`).join("") +
            "\x1b[?1000h" +
            (encoding === "SGR" ? "\x1b[?1006h" : encoding === "SGR_PIXELS" ? "\x1b[?1016h" : ""),
        );
        const mode = terminalMouseEncodingSequence(source.terminal);
        expect(mode).not.toBe("");
        await write(restored.terminal, source.serialize.serialize() + mode);
        expect(restored.terminal.buffer.active.baseY).toBeGreaterThan(2000);
        expect(restored.terminal.modes.mouseTrackingMode).toBe("vt200");
        expect(terminalMouseEncodingSequence(restored.terminal)).toBe(mode);
        const data: string[] = [],
          binary: string[] = [];
        restored.terminal.onData((chunk) => data.push(chunk));
        restored.terminal.onBinary((chunk) => binary.push(chunk));
        const mouse = (
          restored.terminal as unknown as {
            _core: { coreMouseService: { triggerMouseEvent(event: object): boolean } };
          }
        )._core.coreMouseService;
        expect(
          mouse.triggerMouseEvent({
            col: 2,
            row: 3,
            x: 20,
            y: 30,
            button: 4,
            action: 0,
            ctrl: false,
            alt: false,
            shift: false,
          }),
        ).toBe(true);
        if (encoding === "DEFAULT") expect(binary[0]).toMatch(/^\x1b\[M/);
        else expect(data[0]).toMatch(/^\x1b\[<64;/);
      } finally {
        source.terminal.dispose();
        restored.terminal.dispose();
      }
    },
  );

  it("repairs Codex snapshots from an already-running older service", async () => {
    const source = createScreen(),
      restored = createScreen();
    try {
      await write(source.terminal, "\x1b[?1000h\x1b[?1006hConversation");
      const legacy = source.serialize.serialize();
      expect(legacy).not.toContain("\x1b[?1006h");
      await write(restored.terminal, restoreLegacyCodexMouseEncoding(legacy, "codex"));
      expect(terminalMouseEncodingSequence(restored.terminal)).toBe("\x1b[?1006h");
      expect(restored.terminal.modes.mouseTrackingMode).toBe("vt200");
    } finally {
      source.terminal.dispose();
      restored.terminal.dispose();
    }
  });

  it("respects explicit encodings, other agents and ordinary terminal scrolling", () => {
    const tracking = "\x1b[?1000h";
    for (const mode of ["\x1b[?1006h", "\x1b[?1016h", "\x1b[?1006l\x1b[?1016l"])
      expect(restoreLegacyCodexMouseEncoding(tracking + mode, "codex")).toBe(tracking + mode);
    expect(restoreLegacyCodexMouseEncoding(tracking, "agy")).toBe(tracking);
    expect(restoreLegacyCodexMouseEncoding(tracking, null)).toBe(tracking);
    expect(restoreLegacyCodexMouseEncoding("Plain scrollback", "codex")).toBe("Plain scrollback");
    expect(terminalMouseEncodingSequence({})).toBe("");
  });
});
