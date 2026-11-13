import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { CHANNELS, EVENTS } from "./channels";
import {
  DesktopAgentModel,
  validateDesktopAgents,
  validateDesktopAgentTheme,
} from "../desktop-agents/model";
import { DesktopAgentWidget } from "../desktop-agents/widget";

export function registerDesktopAgents(deps: {
  userData: string;
  rendererUrl: string;
  labelOf: (event: IpcMainInvokeEvent) => string;
  assertOwner: (paneId: number, label: string) => void;
  windowFor: (label: string) => BrowserWindow | undefined;
  emit: (label: string, event: string, payload: unknown) => boolean;
}) {
  const model = new DesktopAgentModel();
  const widget = new DesktopAgentWidget({
    userData: deps.userData,
    rendererUrl: deps.rendererUrl,
    activate,
  });
  function activate(key: unknown): void {
    if (typeof key !== "string") return;
    const target = model.target(key);
    if (!target) return;
    try {
      deps.assertOwner(target.paneId, target.label);
    } catch {
      return;
    }
    const window = deps.windowFor(target.label);
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    deps.emit(target.label, EVENTS.desktopAgentFocus, { paneId: target.paneId });
  }
  ipcMain.handle(CHANNELS.desktopAgentsUpdate, (event, { rows, theme }) => {
    const label = deps.labelOf(event);
    const validated = validateDesktopAgents(rows);
    // A transfer can race the publisher. Drop panes this sender no longer owns.
    const owned = validated.filter((row) => {
      try {
        deps.assertOwner(row.paneId, label);
        return true;
      } catch {
        return false;
      }
    });
    model.update(label, owned, validateDesktopAgentTheme(theme));
    widget.update(model.snapshot());
  });
  return {
    activate,
    forgetWindow(label: string): void {
      model.forget(label);
      widget.update(model.snapshot());
    },
    dispose(): void {
      widget.dispose();
    },
  };
}
