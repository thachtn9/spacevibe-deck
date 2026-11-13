import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentSnapshot } from "../../src/lib/desktop-agents";

contextBridge.exposeInMainWorld("__deckAgents", {
  subscribe: (callback: (snapshot: DesktopAgentSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: DesktopAgentSnapshot) => callback(snapshot);
    ipcRenderer.on("desktop-agents:snapshot", handler);
    void ipcRenderer.invoke("desktop-agents:ready").then(callback);
    return () => ipcRenderer.removeListener("desktop-agents:snapshot", handler);
  },
  activate: (key: string) => ipcRenderer.send("desktop-agents:activate", key),
  rendered: () => ipcRenderer.send("desktop-agents:rendered"),
});
