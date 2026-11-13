// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { copyOsc52, installTerminalMouseClipboard } from "./terminal-clipboard";

function harness() {
  return {
    readText: vi.fn(async () => "clipboard text"),
    writeText: vi.fn(async (_text: string) => {}),
    reportError: vi.fn(),
  };
}

it("copies OSC 52 UTF-8 text and refuses clipboard queries", async () => {
  const dependencies = harness();
  const text = "Tiếng Việt 👋";
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  expect(copyOsc52(`c;${encoded}`, dependencies)).toBe(true);
  await vi.waitFor(() => expect(dependencies.writeText).toHaveBeenCalledWith(text));
  copyOsc52("c;?", dependencies);
  expect(dependencies.readText).not.toHaveBeenCalled();
  expect(dependencies.writeText).toHaveBeenCalledTimes(1);
});

it("reports invalid OSC 52 data and native clipboard failures", async () => {
  const dependencies = harness();
  copyOsc52("c;%%%", dependencies);
  expect(dependencies.reportError).toHaveBeenCalledOnce();
  dependencies.writeText.mockRejectedValueOnce(new Error("clipboard failed"));
  copyOsc52("c;aGVsbG8=", dependencies);
  await vi.waitFor(() => expect(dependencies.reportError).toHaveBeenCalledTimes(2));
});

it("right-click pastes once without forwarding mouse reports, and disposes cleanly", async () => {
  const dependencies = harness();
  const element = document.createElement("div");
  const terminal = { getSelection: () => "", hasSelection: () => false, paste: vi.fn() };
  const dispose = installTerminalMouseClipboard(element, terminal, dependencies);
  const cliMouse = vi.fn();
  element.addEventListener("mousedown", cliMouse);
  for (const type of ["mousedown", "mouseup", "contextmenu"]) {
    element.dispatchEvent(new MouseEvent(type, { button: 2, bubbles: true, cancelable: true }));
  }
  await vi.waitFor(() => expect(terminal.paste).toHaveBeenCalledExactlyOnceWith("clipboard text"));
  expect(cliMouse).not.toHaveBeenCalled();
  element.dispatchEvent(new MouseEvent("mousedown", { button: 2, shiftKey: true }));
  expect(cliMouse).toHaveBeenCalledOnce();
  dispose();
  element.dispatchEvent(new MouseEvent("mousedown", { button: 2 }));
  expect(cliMouse).toHaveBeenCalledTimes(2);
});
