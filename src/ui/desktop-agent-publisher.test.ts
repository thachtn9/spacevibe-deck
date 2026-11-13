// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tabViews, type TabView, type PaneView } from "../terminal/tabs-store";
const host = vi.hoisted(() => ({
  available: true,
  publish: vi.fn().mockResolvedValue(undefined),
  listenFocus: vi.fn(),
}));
vi.mock("../host/desktop-agents-host", () => ({ desktopAgentsHost: host }));
vi.mock("../host/store-host", () => ({ Store: { load: vi.fn() } }));
import { desktopAgentRows, installDesktopAgentPublisher } from "./desktop-agent-publisher";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { paneAgentLines, paneTasks } from "../terminal/session-tail-store";
const pane = (id: number, changes: Partial<PaneView> = {}): PaneView => ({
  paneId: id,
  agent: "codex",
  attention: "none",
  phase: "working",
  hasRun: true,
  changedAt: 0,
  ...changes,
});
const tab = (panes: PaneView[], path = "/data/deck"): TabView => ({
  key: 1,
  workspacePath: path,
  panes,
  process: null,
  name: null,
  dotColor: null,
  agents: ["codex"],
  agentBusy: true,
  unread: false,
});
let stop: (() => void) | undefined;
beforeEach(() => {
  settings.value = { ...DEFAULT_SETTINGS };
  host.available = true;
  host.publish.mockClear();
  host.listenFocus.mockClear();
  host.listenFocus.mockResolvedValue(vi.fn());
  tabViews.value = [];
  paneAgentLines.value = new Map();
  paneTasks.value = new Map();
});
afterEach(() => {
  stop?.();
  stop = undefined;
});
describe("desktop activity publisher", () => {
  it("keeps attention above phase and excludes no-signal, shell and exited panes", () => {
    expect(
      desktopAgentRows([
        tab([
          pane(1),
          pane(2, { attention: "requested" }),
          pane(3, { agent: null }),
          pane(4, { phase: "unknown" }),
          pane(5, { phase: "exited", attention: "error" }),
          pane(6, { phase: "idle", phaseConfidence: "explicit", hasRun: false }),
          pane(7, { phase: "idle", phaseConfidence: "explicit" }),
        ]),
      ]),
    ).toEqual([
      {
        paneId: 1,
        agentId: "codex",
        agent: "Codex",
        project: "deck",
        session: "Waiting for agent update",
        state: "working",
      },
      {
        paneId: 2,
        agentId: "codex",
        agent: "Codex",
        project: "deck",
        session: "Waiting for agent update",
        state: "requested",
      },
      {
        paneId: 6,
        agentId: "codex",
        agent: "Codex",
        project: "deck",
        session: "Waiting for agent update",
        state: "idle",
      },
    ]);
  });
  it("hides an acknowledged finish and shows the pane again for its next task", () => {
    const finished = {
      attention: "completed",
      phase: "idle",
      phaseConfidence: "explicit",
    } as const;
    tabViews.value = [tab([pane(1, finished), pane(2, finished)])];
    stop = installDesktopAgentPublisher(vi.fn());
    expect(
      host.publish.mock.calls.at(-1)?.[0].map((row: { paneId: number }) => row.paneId),
    ).toEqual([1, 2]);

    tabViews.value = [tab([pane(1, { ...finished, attention: "none" }), pane(2, finished)])];
    expect(
      host.publish.mock.calls.at(-1)?.[0].map((row: { paneId: number }) => row.paneId),
    ).toEqual([2]);

    tabViews.value = [tab([pane(1), pane(2, finished)])];
    expect(host.publish.mock.calls.at(-1)?.[0][0]).toMatchObject({ paneId: 1, state: "working" });

    tabViews.value = [tab([pane(1, finished), pane(2, finished)])];
    expect(host.publish.mock.calls.at(-1)?.[0][0]).toMatchObject({ paneId: 1, state: "completed" });
  });
  it("never substitutes the user prompt or a tab name for an agent update", () => {
    const named = { ...tab([pane(1)]), name: "Release prep" };
    expect(desktopAgentRows([named])[0]?.session).toBe("Waiting for agent update");
  });
  it("shows the latest public assistant line instead of the conversation name", () => {
    const named = { ...tab([pane(1)]), name: "Release prep" };
    expect(
      desktopAgentRows([named], new Map([[1, "Agent cost is above Quota."]]))[0]?.session,
    ).toBe("Agent cost is above Quota.");
  });
  it("deduplicates pinned pane projections and bounds snapshots", () => {
    expect(desktopAgentRows([tab([pane(1)]), tab([pane(1)])])).toHaveLength(1);
    expect(desktopAgentRows([tab(Array.from({ length: 300 }, (_, i) => pane(i)))])).toHaveLength(
      256,
    );
  });
  it("publishes changes without re-sending identical snapshots and stops with its window", async () => {
    const focus = vi.fn();
    stop = installDesktopAgentPublisher(focus);
    expect(host.publish).toHaveBeenCalledTimes(1);
    tabViews.value = [tab([pane(1)])];
    expect(host.publish).toHaveBeenCalledTimes(2);
    tabViews.value = [tab([pane(1)])];
    expect(host.publish).toHaveBeenCalledTimes(2);
    host.listenFocus.mock.calls[0][0](1);
    expect(focus).toHaveBeenCalledWith(1);
    await Promise.resolve();
    stop();
    tabViews.value = [];
    expect(host.publish).toHaveBeenCalledTimes(2);
  });
  it("clears activity immediately when hidden and restores the latest state when enabled", () => {
    tabViews.value = [tab([pane(1)])];
    stop = installDesktopAgentPublisher(vi.fn());
    expect(host.publish.mock.calls.at(-1)?.[0]).toHaveLength(1);
    settings.value = { ...settings.value, showDesktopAgents: false };
    expect(host.publish.mock.calls.at(-1)?.[0]).toEqual([]);
    tabViews.value = [tab([pane(2)])];
    expect(host.publish.mock.calls.at(-1)?.[0]).toEqual([]);
    settings.value = { ...settings.value, showDesktopAgents: true };
    expect(host.publish.mock.calls.at(-1)?.[0][0].paneId).toBe(2);
  });
  it("does nothing on hosts without the capability", () => {
    host.available = false;
    stop = installDesktopAgentPublisher(vi.fn());
    expect(host.publish).not.toHaveBeenCalled();
    expect(host.listenFocus).not.toHaveBeenCalled();
  });
  it("publishes a new agent update without waiting for a pane state change", () => {
    tabViews.value = [tab([pane(1)])];
    paneTasks.value = new Map([[1, "User request"]]);
    stop = installDesktopAgentPublisher(vi.fn());
    paneAgentLines.value = new Map([[1, "Build completed."]]);
    expect(host.publish.mock.calls.at(-1)?.[0][0].session).toBe("Build completed.");
    const count = host.publish.mock.calls.length;
    paneTasks.value = new Map([[1, "Another user request"]]);
    expect(host.publish).toHaveBeenCalledTimes(count);
  });
});
