import { invoke, listen } from "./bridge";
import { getDesktopEnvironment } from "../lib/platform";
import type { DesktopAgentRow, DesktopAgentTheme } from "../lib/desktop-agents";

export const desktopAgentsHost = {
  get available(): boolean {
    return (
      (globalThis as { __deckHost?: unknown }).__deckHost !== undefined &&
      getDesktopEnvironment().platform === "linux"
    );
  },
  publish(rows: readonly DesktopAgentRow[], theme: DesktopAgentTheme): Promise<void> {
    return invoke("desktop_agents_update", { rows, theme });
  },
  listenFocus(callback: (paneId: number) => void): Promise<() => void> {
    return listen<{ paneId: number }>("desktop-agents:focus", ({ payload }) =>
      callback(payload.paneId),
    );
  },
};
