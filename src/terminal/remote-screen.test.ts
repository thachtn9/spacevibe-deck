import { Terminal } from "@xterm/headless";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { afterEach, describe, expect, it } from "vitest";
import { readRemoteScreen } from "./remote-screen";

const terminals: Terminal[] = [];
afterEach(() => {
  for (const term of terminals.splice(0)) term.dispose();
});
function terminal() {
  const term = new Terminal({
    cols: 80,
    rows: 4,
    allowProposedApi: true,
    theme: {
      foreground: "#cccccc",
      background: "#111111",
      red: "#ff3344",
      brightRed: "#ff6677",
    },
  });
  term.loadAddon(new UnicodeGraphemesAddon());
  term.unicode.activeVersion = "15-graphemes";
  terminals.push(term);
  return term;
}
const write = (term: Terminal, text: string) =>
  new Promise<void>((resolve) => term.write(text, resolve));

describe("remote terminal display snapshot", () => {
  it("preserves Vietnamese graphemes and blank columns after cursor edits", async () => {
    const term = terminal();
    await write(term, "\x1b[31mTiếng Việt\x1b[0m  cột  2\r\nold\r\x1b[2KĐã sửa");
    const screen = readRemoteScreen(term, 1000);
    expect(screen.text).toBe("Tiếng Việt  cột  2\nĐã sửa");
    expect(screen.rows[0][0]).toMatchObject({ text: "Tiếng Việt", foreground: "#ff3344" });
    expect(screen.text).not.toContain("old");
    expect(screen.text).not.toContain("\x1b");
  });
  it("retains wide characters and emoji without duplicating continuation cells", async () => {
    const term = terminal();
    await write(term, "Tiếng Việt 界 👩‍💻");
    expect(readRemoteScreen(term, 1000).text).toBe("Tiếng Việt 界 👩‍💻");
  });
  it("resolves RGB, palette, inverse and style attributes from the current terminal", async () => {
    const term = terminal();
    await write(
      term,
      "\x1b[1;31mBold\x1b[0m \x1b[38;2;12;34;56;48;5;21;3;4mRGB\x1b[0m \x1b[7mInverse\x1b[0m",
    );
    const runs = readRemoteScreen(term, 1000).rows[0];
    expect(runs.find((run) => run.text === "Bold")).toMatchObject({
      foreground: "#ff6677",
      flags: 1,
    });
    expect(runs.find((run) => run.text === "RGB")).toMatchObject({
      foreground: "#0c2238",
      background: "#0000ff",
      flags: 6,
    });
    expect(runs.find((run) => run.text === "Inverse")).toMatchObject({
      foreground: "#111111",
      background: "#cccccc",
    });
  });
  it("does not expose concealed text and bounds the returned rows", async () => {
    const term = terminal();
    await write(term, "one\r\ntwo\r\n\x1b[8msecret\x1b[0m visible");
    const screen = readRemoteScreen(term, 2);
    expect(screen.rows.length).toBeLessThanOrEqual(2);
    expect(screen.text).not.toContain("secret");
    expect(screen.text).toContain("visible");
  });
});
