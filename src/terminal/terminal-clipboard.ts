import { readText, writeText } from "../host/shell-host";
import { reportChromeMessage } from "../chrome/events";
import { readClipboardImage } from "../host/clipboard-image-host";

interface TerminalClipboardTarget {
  agent?(): string | null;
  getSelection(): string;
  hasSelection(): boolean;
  /**
   * xterm's own paste entry point — applies prepareTextForTerminal (\r?\n ->
   * \r) and bracketTextForPaste (DECSET 2004). Writing clipboard bytes to the
   * PTY directly skips both.
   */
  paste(text: string): void;
}

interface ClipboardDependencies {
  readImage?(): Promise<string | null>;
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  reportError(message: string): void;
}

const DEFAULT_DEPENDENCIES: ClipboardDependencies = Object.freeze({
  readImage: readClipboardImage,
  readText,
  writeText,
  reportError: reportChromeMessage,
});

export function copyTerminalSelection(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (!terminal.hasSelection()) {
    return;
  }
  const selection = terminal.getSelection();
  if (selection === "") {
    return;
  }
  void Promise.resolve()
    .then(() => dependencies.writeText(selection))
    .catch(() => {
      dependencies.reportError("Couldn't copy the terminal selection");
    });
}

export function pasteIntoTerminal(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  void Promise.resolve()
    .then(async () => {
      const image = await dependencies.readImage?.();
      if (!image) return dependencies.readText();
      // Codex recognizes pasted image paths; AGY resolves @ file references.
      // Never send Enter or submit the user's draft.
      const reference = `"${image.replace(/"/g, '\\"')}"`;
      return terminal.agent?.() === "agy" ? `@${reference} ` : reference;
    })
    .then((text) => terminal.paste(text))
    .catch(() => {
      dependencies.reportError("Couldn't paste from the clipboard");
    });
}

/** OSC 52 writes from CLI selections must reach the native system clipboard. */
export function copyOsc52(
  payload: string,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): boolean {
  const separator = payload.indexOf(";");
  if (separator < 0) return true;
  const selection = payload.slice(0, separator);
  const encoded = payload.slice(separator + 1);
  // Never expose clipboard contents to arbitrary terminal output queries.
  // Right-click paste goes through the user-initiated native clipboard path.
  if (!/^[cp]*$/.test(selection) || encoded === "?" || encoded.length > 1024 * 1024) {
    return true;
  }
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    void Promise.resolve()
      .then(() => dependencies.writeText(text))
      .catch(() => dependencies.reportError("Couldn't copy the terminal selection"));
  } catch {
    dependencies.reportError("Couldn't copy the terminal selection");
  }
  return true;
}

export function installTerminalMouseClipboard(
  element: HTMLElement,
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): () => void {
  const mouse = (event: MouseEvent) => {
    if (event.button !== 2 || event.shiftKey) return;
    // Stop xterm forwarding a right button report to the CLI, whose clipboard
    // reader may be unavailable in a GUI-launched Linux environment.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "mousedown") pasteIntoTerminal(terminal, dependencies);
  };
  const context = (event: MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  element.addEventListener("mousedown", mouse, true);
  element.addEventListener("mouseup", mouse, true);
  element.addEventListener("contextmenu", context, true);
  return () => {
    element.removeEventListener("mousedown", mouse, true);
    element.removeEventListener("mouseup", mouse, true);
    element.removeEventListener("contextmenu", context, true);
  };
}
