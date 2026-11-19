import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { reviewComposerEmpty } from "./review-composer";

describe("review composer evidence", () => {
  it.each([
    ["› ", true],
    ["❯ ", true],
    ["› draft", false],
    ["› draft\r\x1b[2C", false],
    ["› \r\n\r\ncontinued draft\x1b[1;3H", false],
    ["› \r\n────────────────\r\nstatus\x1b[1;3H", true],
    ["› \r\n  ? for shortcuts\x1b[1;3H", true],
    ["old › \r\n", false],
  ])("checks the cursor and remaining composer: %j", async (screen, empty) => {
    const term = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) => term.write(screen, resolve));
      expect(reviewComposerEmpty(term)).toBe(empty);
    } finally {
      term.dispose();
    }
  });
});
