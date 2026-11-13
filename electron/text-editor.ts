import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicSnapshot,
  fingerprint,
  loadSnapshot,
  readText,
  TEXT_LIMIT,
  saveText,
} from "./text-editor-storage";

export function registerTextEditor(deps: {
  preload: string;
  rendererDir: string;
  devServerUrl: string | undefined;
  isDeckWindow(event: IpcMainInvokeEvent): boolean;
}): { hasWindow(): boolean; closeForQuit(): void } {
  let window: BrowserWindow | null = null;
  let quitting = false;
  let allowClose = false;
  let opening: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const authorized = new Set<string>();
  const snapshot = () => path.join(app.getPath("userData"), "text-editor", "workspace.json");
  const assertEditor = (event: IpcMainInvokeEvent) => {
    if (!window || event.sender.id !== window.webContents.id)
      throw new Error("Editor window required.");
  };
  ipcMain.handle("text_editor_open", async (event) => {
    if (!deps.isDeckWindow(event)) throw new Error("Deck window required.");
    if (opening) return opening;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    opening = (async () => {
      const created = new BrowserWindow({
        title: "Text Editor — Deck",
        width: 1120,
        height: 780,
        minWidth: 600,
        minHeight: 400,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#0a0a0a",
        webPreferences: {
          preload: deps.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      window = created;
      allowClose = false;
      created.on("close", (event) => {
        if (allowClose) return;
        event.preventDefault();
        created.webContents.send("text-editor:close-requested");
      });
      created.setMenu(null);
      created.webContents.on("will-navigate", (event) => event.preventDefault());
      created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      created.on("closed", () => {
        window = null;
        authorized.clear();
        if (quitting) {
          quitting = false;
          app.quit();
        }
      });
      created.once("ready-to-show", () => created.show());
      try {
        if (deps.devServerUrl)
          await created.loadURL(new URL("text-editor.html", deps.devServerUrl).href);
        else await created.loadFile(path.join(deps.rendererDir, "text-editor.html"));
      } catch (error) {
        created.destroy();
        throw error;
      }
    })();
    try {
      await opening;
    } finally {
      opening = null;
    }
  });
  ipcMain.handle("text_editor_restore", async (event) => {
    assertEditor(event);
    await writes;
    const state = await loadSnapshot(snapshot());
    for (const doc of state.documents) if (doc.path) authorized.add(doc.path);
    return state;
  });
  ipcMain.handle("text_editor_persist", (event, state) => {
    assertEditor(event);
    const next = writes.then(() => atomicSnapshot(snapshot(), state));
    writes = next.catch(() => {});
    return next;
  });
  ipcMain.handle("text_editor_read", async (event, { file }: { file?: string }) => {
    assertEditor(event);
    let files: string[];
    if (file !== undefined) {
      if (typeof file !== "string" || !path.isAbsolute(file))
        throw new Error("Choose a local file.");
      files = [file];
    } else {
      const result = await dialog.showOpenDialog(window!, {
        title: "Open text files",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return [];
      files = result.filePaths;
    }
    const documents = await Promise.all(files.map(readText));
    for (const doc of documents) authorized.add(doc.path);
    return documents;
  });
  ipcMain.handle(
    "text_editor_save",
    async (
      event,
      payload: {
        path: string | null;
        name: string;
        content: string;
        fingerprint: string | null;
        saveAs: boolean;
      },
    ) => {
      assertEditor(event);
      if (typeof payload.content !== "string" || Buffer.byteLength(payload.content) > TEXT_LIMIT)
        throw new Error("Documents must be smaller than 8 MB.");
      let target = payload.path;
      const saveAs = payload.saveAs || target === null;
      let expected = payload.fingerprint;
      if (saveAs) {
        const result = await dialog.showSaveDialog(window!, {
          title: "Save text file",
          defaultPath: target ?? payload.name,
        });
        if (result.canceled || !result.filePath) return null;
        target = result.filePath;
        expected = await readFile(target)
          .then(fingerprint)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
      } else if (!target || !authorized.has(target))
        throw new Error("Reopen this file before saving.");
      const savedFingerprint = await saveText(target!, payload.content, expected);
      authorized.add(target!);
      return {
        path: target!,
        name: path.basename(target!),
        fingerprint: savedFingerprint,
      };
    },
  );
  ipcMain.handle("text_editor_cancel_close", (event) => {
    assertEditor(event);
    quitting = false;
  });
  ipcMain.handle("text_editor_close", (event) => {
    assertEditor(event);
    allowClose = true;
    window?.close();
  });
  return {
    hasWindow: () => window !== null && !window.isDestroyed(),
    closeForQuit: () => {
      quitting = true;
      window?.close();
    },
  };
}
