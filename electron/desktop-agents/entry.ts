import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import type { DesktopAgentSnapshot } from "../../src/lib/desktop-agents";
import { activateDesktopAgent } from "./activation";

const [userData, rendererUrl] = process.argv.slice(-2);
app.setPath("userData", path.join(userData, "agent-widget"));
app.commandLine.appendSwitch("ozone-platform", "x11");
let snapshot: DesktopAgentSnapshot = { revision: 0, rows: [], theme: {} };
let window: BrowserWindow | null = null;
function position(): void {
  if (!window) return;
  // Use the full monitor: the text belongs inside the taskbar band, below the work area.
  const primary = screen.getPrimaryDisplay();
  const area = (screen.getAllDisplays().find((display) => display.id !== primary.id) ?? primary)
    .bounds;
  window.setBounds({ x: area.x + 12, y: area.y + area.height - 40, width: 420, height: 36 });
}
function publish(): void {
  if (!window || window.isDestroyed()) return;
  position();
  if (!snapshot.rows.length) window.hide();
  window.webContents.send("desktop-agents:snapshot", snapshot);
}
// Parent pipe closure owns this process's lifetime; the helper owns no terminals.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (input.length > 1024 * 1024) return app.quit();
  let end: number;
  while ((end = input.indexOf("\n")) >= 0) {
    const line = input.slice(0, end);
    input = input.slice(end + 1);
    try {
      snapshot = JSON.parse(line) as DesktopAgentSnapshot;
      publish();
    } catch {
      /* A malformed packet never becomes executable content. */
    }
  }
});
process.stdin.on("end", () => app.quit());
process.on("SIGTERM", () => app.quit());
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 420,
      height: 36,
      frame: false,
      transparent: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      // On Linux this creates an unmanaged overlay above ordinary windows, with
      // no taskbar entry or keyboard focus. It need not carry the WM's ABOVE hint.
      focusable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setVisibleOnAllWorkspaces(true);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    ipcMain.handle("desktop-agents:ready", () => snapshot);
    ipcMain.on("desktop-agents:rendered", (event) => {
      if (event.sender === window?.webContents && snapshot.rows.length && !window.isVisible()) {
        window.showInactive();
        // Reapply desktop hints when remapping a previously hidden window.
        window.setAlwaysOnTop(true, "floating");
        window.setVisibleOnAllWorkspaces(true);
      }
    });
    ipcMain.on("desktop-agents:activate", (event, key: unknown) => {
      if (
        event.sender === window?.webContents &&
        typeof key === "string" &&
        snapshot.rows.some((row) => row.key === key)
      ) {
        void activateDesktopAgent(userData, key).then((activated) => {
          if (!activated) process.stdout.write(JSON.stringify({ activate: key }) + "\n");
        });
      }
    });
    screen.on("display-metrics-changed", position);
    screen.on("display-added", position);
    screen.on("display-removed", position);
    await window.loadURL(rendererUrl);
    publish();
    process.stdout.write(JSON.stringify({ ready: true }) + "\n");
  })
  .catch((error) => {
    process.stderr.write(String(error));
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
