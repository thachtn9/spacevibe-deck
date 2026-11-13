import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from "electron";
import { CodeViewerChild } from "./code-viewer-child";
import { stat } from "node:fs/promises";
import { resolveInsideRoot, resolveRoot } from "./fs/path-guard";
import { CHANNELS, EVENTS } from "./ipc/channels";

export interface ViewerRequest {
  root: string;
  path: string | null;
  line: number;
  column: number;
  nonce: number;
}

/** File-only windows never join the terminal coordinator, journal or close census. */
export function registerCodeViewerWindows(deps: {
  windows: Map<string, BrowserWindow>;
  preload: string;
  renderer: string;
  devServerUrl?: string;
  isDeckWindow(event: IpcMainInvokeEvent): boolean;
  onClosed(label: string): void;
  invoke(label: string, channel: string, payload: Record<string, unknown>): Promise<unknown>;
}) {
  const requests = new Map<number, ViewerRequest>();
  const helpers = new Map<string, CodeViewerChild>();
  let nonce = 0;
  let opening: Promise<void> = Promise.resolve();
  ipcMain.handle(CHANNELS.codeViewerState, (event) => {
    const request = requests.get(event.sender.id);
    if (!request) throw new Error("This is not a code viewer window");
    return request;
  });
  ipcMain.handle(CHANNELS.codeViewerOpen, (event, { root, path: file, line, column }) => {
    if (!deps.isDeckWindow(event) && !requests.has(event.sender.id))
      throw new Error("Unknown source window");
    return open({ root, path: file, line, column }, BrowserWindow.fromWebContents(event.sender));
  });
  function open(
    payload: Record<string, unknown>,
    source: BrowserWindow | null = null,
  ): Promise<void> {
    const { root, path: file, line, column } = payload;
    // Serialize opens so two clicks while stat is in flight reuse one window.
    const next = opening
      .catch(() => {})
      .then(async () => {
        if (typeof root !== "string") throw new Error("Choose a folder to view code");
        const canonical = resolveRoot(root);
        if (!canonical || !(await stat(canonical)).isDirectory())
          throw new Error("The folder is unavailable");
        const target =
          file === null || file === undefined
            ? null
            : typeof file === "string"
              ? resolveInsideRoot(canonical, file)
              : null;
        if (file != null && !target) throw new Error("The file is outside this folder");
        const positive = (value: unknown) =>
          typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
        const request: ViewerRequest = {
          root: canonical,
          path: target,
          line: positive(line),
          column: positive(column),
          nonce: ++nonce,
        };
        const label = `code-viewer:${canonical}`;
        if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
          let helper = helpers.get(label);
          if (!helper) {
            helper = new CodeViewerChild({
              preload: deps.preload,
              renderer: deps.renderer,
              devServerUrl: deps.devServerUrl,
              invoke: (channel, payload) =>
                channel === "code_viewer_open"
                  ? open(payload)
                  : deps.invoke(label, channel, payload),
              closed: () => {
                helpers.delete(label);
                deps.onClosed(label);
              },
            });
            helpers.set(label, helper);
          }
          await helper.open(request);
          return;
        }
        const current = source
          ? screen.getDisplayMatching(source.getBounds())
          : screen.getPrimaryDisplay();
        const display =
          screen.getAllDisplays().find((display) => display.id !== current.id) ?? current;
        const area = display.workArea;
        let window = deps.windows.get(label);
        if (window && !window.isDestroyed()) {
          requests.set(window.webContents.id, request);
          window.webContents.send(EVENTS.codeViewerOpen, request);
          if (window.isMinimized()) window.restore();
          if (screen.getDisplayMatching(window.getBounds()).id !== display.id) {
            if (window.isMaximized()) window.unmaximize();
            window.setBounds({
              x: area.x + 32,
              y: area.y + 32,
              width: Math.min(1280, area.width - 64),
              height: Math.min(860, area.height - 64),
            });
            window.maximize();
          }
          window.show();
          window.focus();
          return;
        }
        window = new BrowserWindow({
          title: `Code — ${canonical}`,
          x: area.x + 32,
          y: area.y + 32,
          width: 1280,
          height: 860,
          minWidth: 640,
          minHeight: 420,
          show: false,
          autoHideMenuBar: true,
          backgroundColor: "#0a0a0a",
          webPreferences: {
            preload: deps.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            additionalArguments: ["--deck-code-viewer"],
          },
        });
        const created = window;
        const senderId = created.webContents.id;
        deps.windows.set(label, created);
        requests.set(senderId, request);
        created.setMenu(null);
        created.webContents.on("will-navigate", (navigation) => navigation.preventDefault());
        created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        created.on("closed", () => {
          deps.windows.delete(label);
          requests.delete(senderId);
          deps.onClosed(label);
        });
        created.once("ready-to-show", () => {
          created.maximize();
          created.show();
        });
        try {
          if (deps.devServerUrl) {
            const url = new URL(deps.devServerUrl);
            url.searchParams.set("codeViewer", "1");
            await created.loadURL(url.href);
          } else await created.loadFile(deps.renderer, { query: { codeViewer: "1" } });
        } catch (error) {
          created.destroy();
          throw error;
        }
      });
    opening = next;
    return next;
  }
  return {
    hasWindows: () => helpers.size > 0 || deps.windows.size > 0,
    sendEvent: (label: string, event: string, payload: unknown) => {
      const helper = helpers.get(label);
      helper?.event(event, payload);
      return !!helper;
    },
    dispose: () => {
      for (const helper of helpers.values()) helper.dispose();
    },
  };
}
