import { app, BrowserWindow, clipboard, ipcMain, screen } from "electron";
import { CODE_VIEWER_CHANNELS } from "./code-viewer-policy";
import type { ViewerRequest } from "./code-viewer-windows";
import { EVENTS } from "./ipc/channels";

app.setPath("userData", process.argv[process.argv.length - 1]);
app.commandLine.appendSwitch("ozone-platform", "x11");
let window: BrowserWindow | null = null;
let current: ViewerRequest | null = null;
let nextId = 0;
process.stdout.on("error", () => app.quit());
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
function send(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}
function position(): void {
  if (!window) return;
  const displays = screen.getAllDisplays();
  const source = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const target = displays.find((display) => display.id !== source.id) ?? source;
  const area = target.workArea;
  if (window.isMaximized()) window.unmaximize();
  window.setBounds({
    x: area.x + 32,
    y: area.y + 32,
    width: Math.min(1280, area.width - 64),
    height: Math.min(860, area.height - 64),
  });
  window.maximize();
}
async function open(message: {
  request: ViewerRequest;
  renderer: string;
  preload: string;
  devServerUrl?: string;
}) {
  current = message.request;
  if (window && !window.isDestroyed()) {
    position();
    window.webContents.send(EVENTS.codeViewerOpen, current);
    window.show();
    window.focus();
    send({ opened: current.nonce });
    return;
  }
  window = new BrowserWindow({
    title: `Code — ${current.root}`,
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: message.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ["--deck-code-viewer"],
    },
  });
  window.setMenu(null);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => {
    position();
    window?.show();
    window?.focus();
  });
  window.on("closed", () => {
    window = null;
    app.quit();
  });
  if (message.devServerUrl) {
    const url = new URL(message.devServerUrl);
    url.searchParams.set("codeViewer", "1");
    await window.loadURL(url.href);
  } else await window.loadFile(message.renderer, { query: { codeViewer: "1" } });
  send({ opened: message.request.nonce });
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (input.length > 32 * 1024 * 1024) return app.quit();
  let end: number;
  while ((end = input.indexOf("\n")) >= 0) {
    const line = input.slice(0, end);
    input = input.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.open)
        void open(message.open).catch((error: unknown) =>
          send({ failed: message.open.request.nonce, error: String(error) }),
        );
      else if (message.event) window?.webContents.send(message.event, message.payload);
      else if (typeof message.id === "number") {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error));
        else request?.resolve(message.result);
      }
    } catch {
      /* Ignore non-protocol diagnostics. */
    }
  }
});
process.stdin.on("end", () => app.quit());
process.on("SIGTERM", () => app.quit());
app.whenReady().then(() => {
  for (const channel of CODE_VIEWER_CHANNELS)
    ipcMain.handle(channel, (_event, payload) => {
      if (channel === "code_viewer_state") return current;
      if (channel === "window_close") return window?.close();
      if (channel === "window_toggle_maximize")
        return window?.isMaximized() ? window.unmaximize() : window?.maximize();
      if (channel === "clipboard_read_text") return clipboard.readText();
      if (channel === "clipboard_write_text")
        return clipboard.writeText(String(payload.text ?? ""));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        send({ id, channel, payload });
      });
    });
  send({ ready: true });
});
