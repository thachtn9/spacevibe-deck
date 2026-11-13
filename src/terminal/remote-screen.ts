import type { Terminal, ITheme } from "@xterm/xterm";
import { REMOTE_SCREEN_LIMIT, type RemoteScreenRun } from "../lib/deck-remote";

const paletteNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
const defaultPalette = [
  "#2e3436",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
];
const rgb = (value: number) => `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
function paletteColor(index: number, theme: ITheme): string {
  if (index < 16) return theme[paletteNames[index]] ?? defaultPalette[index];
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return rgb((gray << 16) | (gray << 8) | gray);
  }
  const value = index - 16;
  const channel = (n: number) => (n === 0 ? 0 : 55 + n * 40);
  return rgb(
    (channel(Math.floor(value / 36)) << 16) |
      (channel(Math.floor(value / 6) % 6) << 8) |
      channel(value % 6),
  );
}

/** Read resolved cells, preserving cursor edits, blank columns and complete graphemes. */
export function readRemoteScreen(term: Pick<Terminal, "buffer" | "options">, limit: number) {
  const theme = term.options.theme ?? {};
  const foreground = theme.foreground ?? "#ffffff";
  const background = theme.background ?? "#000000";
  const buffer = term.buffer.active;
  const rows: RemoteScreenRun[][] = [];
  const cell = buffer.getNullCell();
  let characters = 0;
  let estimatedBytes = 0;
  for (let y = buffer.length - 1; y >= Math.max(0, buffer.length - limit); y--) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const runs: RemoteScreenRun[] = [];
    for (let x = 0; x < line.length; x++) {
      const value = line.getCell(x, cell);
      if (!value || value.getWidth() === 0) continue;
      let fg = foreground;
      let bg = background;
      if (value.isFgRGB()) fg = rgb(value.getFgColor());
      else if (value.isFgPalette()) {
        let index = value.getFgColor();
        if (value.isBold() && index < 8 && term.options.drawBoldTextInBrightColors !== false)
          index += 8;
        fg = paletteColor(index, theme);
      }
      if (value.isBgRGB()) bg = rgb(value.getBgColor());
      else if (value.isBgPalette()) bg = paletteColor(value.getBgColor(), theme);
      if (value.isInverse()) [fg, bg] = [bg, fg];
      const text = value.isInvisible()
        ? " ".repeat(value.getWidth())
        : (value.getChars() || " ").normalize("NFC");
      const flags =
        (value.isBold() ? 1 : 0) |
        (value.isItalic() ? 2 : 0) |
        (value.isUnderline() ? 4 : 0) |
        (value.isStrikethrough() ? 8 : 0) |
        (value.isDim() ? 16 : 0);
      const last = runs[runs.length - 1];
      if (last && last.foreground === fg && last.background === bg && last.flags === flags)
        runs[runs.length - 1] = { ...last, text: last.text + text };
      else runs.push({ text, foreground: fg, background: bg, flags });
    }
    // Retain painted spaces; drop only unused cells at the default background.
    while (runs.length && runs[runs.length - 1].background === background) {
      const last = runs[runs.length - 1];
      const trimmed = last.text.replace(/ +$/, "");
      if (trimmed) {
        runs[runs.length - 1] = { ...last, text: trimmed };
        break;
      }
      runs.pop();
    }
    if (!rows.length && !runs.length) continue;
    const length = runs.reduce((total, run) => total + run.text.length, 0) + 1;
    const bytes = length * 3 + runs.length * 120;
    if (
      characters + length > REMOTE_SCREEN_LIMIT ||
      estimatedBytes + bytes > REMOTE_SCREEN_LIMIT * 4
    )
      break;
    characters += length;
    estimatedBytes += bytes;
    rows.push(runs);
  }
  rows.reverse();
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
    foreground,
    background,
  };
}
