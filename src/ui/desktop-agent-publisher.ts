import { effect } from "@preact/signals";
import { desktopAgentsHost } from "../host/desktop-agents-host";
import { tabViews, type TabView } from "../terminal/tabs-store";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { workspaceLabel } from "../lib/workspace-label";
import type { DesktopAgentRow } from "../lib/desktop-agents";
import { paneAgentLines } from "../terminal/session-tail-store";

export function desktopAgentRows(
  tabs: readonly TabView[],
  agentLines: ReadonlyMap<number, string> = new Map(),
): DesktopAgentRow[] {
  const rows = new Map<number, DesktopAgentRow>();
  for (const tab of tabs) {
    for (const pane of tab.panes ?? []) {
      if (!pane.agent || pane.phase === "exited") continue;
      if (
        pane.attention === "none" &&
        pane.phase !== "working" &&
        (pane.phase === "unknown" ||
          pane.phaseConfidence === undefined ||
          pane.phaseConfidence === "unknown")
      ) {
        continue;
      }
      const state =
        pane.attention !== "none"
          ? pane.attention
          : pane.phase === "working"
            ? "working"
            : pane.hasRun
              ? "done"
              : "idle";
      // Focusing a finished pane clears its completion attention in the tracker.
      if (state === "done") continue;
      const agent =
        BUILTIN_AGENTS.find((candidate) => candidate.id === pane.agent)?.label ?? pane.agent;
      rows.set(pane.paneId, {
        paneId: pane.paneId,
        agentId: pane.agent.slice(0, 80),
        agent: agent.slice(0, 80),
        project: workspaceLabel(tab.workspacePath ?? "").slice(0, 160),
        session: (agentLines.get(pane.paneId)?.trim() || "Waiting for agent update").slice(0, 160),
        state,
      });
    }
  }
  return [...rows.values()].slice(0, 256);
}

/** Window-scoped publisher: the main process stamps the sender's identity. */
export function installDesktopAgentPublisher(focusPane: (paneId: number) => void): () => void {
  if (!desktopAgentsHost.available) return () => {};
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void desktopAgentsHost
    .listenFocus((paneId) => {
      if (!stopped) focusPane(paneId);
    })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(console.warn);
  let previous = "";
  const stopEffect = effect(() => {
    const theme = resolveTheme(settings.value);
    const tabs = tabViews.value;
    const payload = {
      rows: settings.value.showDesktopAgents ? desktopAgentRows(tabs, paneAgentLines.value) : [],
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        blue: theme.blue,
        green: theme.green,
        yellow: theme.yellow,
        red: theme.red,
      },
    };
    const serialized = JSON.stringify(payload);
    if (serialized === previous) return;
    previous = serialized;
    void desktopAgentsHost.publish(payload.rows, payload.theme).catch(console.warn);
  });
  return () => {
    stopped = true;
    stopEffect();
    unlisten?.();
  };
}
