// @vitest-environment jsdom
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings-schema";
import { createPane, toFontStack, type PaneEvents } from "./pane";

beforeAll(() => {
  // Never fires: nothing in this file resizes anything, and `fit()` is
  // already try/caught in pane.ts for the zero-sized case. This exists only
  // so the constructor at pane.ts:251 does not throw.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const silentEvents: PaneEvents = {
  onData: () => Promise.resolve(true),
  onResize: () => {},
  onFocus: () => {},
};

describe("Pane transfer primitives", () => {
  it("flush() resolves after xterm has parsed everything already written", async () => {
    const pane = createPane(1, DEFAULT_SETTINGS as Settings, silentEvents);
    pane.write("hello");
    await pane.flush();
    expect(pane.serializeScrollback(100)).toContain("hello");
    pane.dispose();
  });

  it("flush() resolves on an idle terminal with nothing queued", async () => {
    const pane = createPane(2, DEFAULT_SETTINGS as Settings, silentEvents);
    await expect(pane.flush()).resolves.toBeUndefined();
    pane.dispose();
  });

  it("serializeScrollback keeps the newest lines when the buffer is longer", async () => {
    const pane = createPane(3, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 20,
      rows: 4,
    });
    for (let i = 0; i < 40; i += 1) {
      pane.write(`line-${i}\r\n`);
    }
    await pane.flush();
    const serialized = pane.serializeScrollback(5);
    expect(serialized).toContain("line-39");
    expect(serialized).not.toContain("line-0\r");
    pane.dispose();
  });

  it("constructs at the requested geometry so an adopted pane starts at capture size", () => {
    const pane = createPane(4, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 133,
      rows: 41,
    });
    expect(pane.cols).toBe(133);
    expect(pane.rows).toBe(41);
    pane.dispose();
  });
});

describe("Pane input provenance", () => {
  it("distinguishes an automatic cursor report from a real paste", async () => {
    const writes: Array<{ data: string; userInput: boolean }> = [];
    const pane = createPane(7, DEFAULT_SETTINGS as Settings, {
      ...silentEvents,
      onData: async (_id, data, userInput = false) => {
        writes.push({ data, userInput });
        return true;
      },
    });
    // Keep the real onData path; only bypass browser textarea cleanup.
    const paste = vi.spyOn(Terminal.prototype, "paste").mockImplementation(function (
      this: Terminal,
      text,
    ) {
      this.input(text, true);
    });
    pane.write("\x1b[6n");
    await pane.flush();
    expect(writes.some((write) => write.data.endsWith("R") && !write.userInput)).toBe(true);
    await pane.pasteText("first prompt");
    paste.mockRestore();
    expect(writes.at(-1)).toEqual({ data: "first prompt", userInput: true });
    pane.dispose();
  });
});

describe("Pane column floor", () => {
  it.each(["process metadata", "split startup banner"])(
    "keeps AGY's response visible during resize (identified by %s)",
    async (identity) => {
      const propose = vi
        .spyOn(FitAddon.prototype, "proposeDimensions")
        .mockReturnValue({ cols: 40, rows: 24 });
      const pane = createPane(32, DEFAULT_SETTINGS as Settings, silentEvents, {
        cols: 80,
        rows: 24,
      });
      try {
        if (identity === "process metadata") {
          pane.setHeaderInfo({ agent: true, badge: "agy", cwd: "/tmp", dotColor: "gray" });
        } else {
          pane.write("\x1b[1mAntigrav");
          pane.write("ity CLI 1.3.5\x1b[m\r\n");
          pane.setHeaderInfo({ agent: false, badge: "python3", cwd: "/tmp", dotColor: "gray" });
        }
        pane.write("ORIGINAL RESPONSE\r\nSTATUS");
        await pane.flush();
        pane.fit();
        await vi.waitFor(() => expect(pane.cols).toBe(40));
        pane.write("\x1b[?2026h\x1b[H\x1b[JSTATUS\x1b[?2026l");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(pane.serializeScrollback(100)).toContain("ORIGINAL RESPONSE");
        pane.write("\x1b[2J\x1b[3J\x1b[H\x1b[?2026hREFORMATTED RESPONSE\r\nSTATUS\x1b[?2026l");
        await pane.flush();
        const content = pane.serializeScrollback(100);
        expect(content).toContain("REFORMATTED RESPONSE");
        expect(content).not.toContain("ORIGINAL RESPONSE");
      } finally {
        pane.dispose();
        propose.mockRestore();
      }
    },
  );

  it("parses queued cursor-relative frames at their original width before resizing", async () => {
    const propose = vi
      .spyOn(FitAddon.prototype, "proposeDimensions")
      .mockReturnValue({ cols: 30, rows: 24 });
    const pane = createPane(31, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 80,
      rows: 24,
    });
    try {
      pane.write(`${"A".repeat(60)}\r\n${"B".repeat(60)}\r\n`);
      // The CLI clears its two-row frame using the geometry it wrote with.
      pane.write("\x1b[2A\r\x1b[JREADY\r\n");
      pane.fit();
      await pane.flush();
      const content = pane.serializeScrollback(100);
      expect(content).toContain("READY");
      expect(content).not.toContain("AAAA");
      expect(content).not.toContain("BBBB");
      expect(pane.cols).toBe(30);
    } finally {
      pane.dispose();
      propose.mockRestore();
    }
  });

  it("never resizes the terminal below 24 columns, however narrow the box measures", async () => {
    const propose = vi
      .spyOn(FitAddon.prototype, "proposeDimensions")
      .mockReturnValue({ cols: 18, rows: 3 });
    const resize = vi.spyOn(Terminal.prototype, "resize");
    const pane = createPane(30, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 101,
      rows: 16,
    });
    try {
      pane.fit();
      await pane.flush();
      expect(resize).toHaveBeenLastCalledWith(24, 3);
      expect(pane.cols).toBe(24);
      propose.mockReturnValue({ cols: 18, rows: 1 });
      pane.fit();
      await pane.flush();
      expect(resize).toHaveBeenLastCalledWith(24, 1);
      propose.mockReturnValue({ cols: 90, rows: 30 });
      pane.fit();
      await pane.flush();
      expect(resize).toHaveBeenLastCalledWith(90, 30);
    } finally {
      pane.dispose();
      propose.mockRestore();
      resize.mockRestore();
    }
  });
});

describe("toFontStack", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it("is the original stack byte for byte on macOS", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    expect(toFontStack("SF Mono")).toBe('"SF Mono", Menlo, Monaco, monospace');
  });

  it("is the macOS stack where the platform is unsupported", () => {
    initializeDesktopEnvironment({ platform: "unsupported", homeDir: "" });
    expect(toFontStack("SF Mono")).toBe('"SF Mono", Menlo, Monaco, monospace');
  });

  it("ends on the Windows faces before the generic family on Windows", () => {
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    expect(toFontStack("SF Mono")).toBe(
      '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, monospace',
    );
  });

  it("uses a user-entered fallback list verbatim", () => {
    expect(toFontStack('"Iosevka", monospace')).toBe('"Iosevka", monospace');
  });
});
