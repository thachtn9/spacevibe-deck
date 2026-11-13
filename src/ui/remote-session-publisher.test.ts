import { afterEach, describe, expect, it, vi } from "vitest";
import { tabViews, type TabView } from "../terminal/tabs-store";
import type { TabManager } from "../terminal/tab-manager-types";
import { remotePaneIdentity, type RemoteRpcRequest } from "../lib/deck-remote";
import { installRemoteSessionPublisher, remotePanes } from "./remote-session-publisher";
import { paneSessionTitles } from "../terminal/session-title-store";

const host = vi.hoisted(() => ({
  available: true,
  publish: vi.fn(async () => {}),
  reply: vi.fn(async (..._args: unknown[]) => {}),
  onRequest: vi.fn(async (_callback: (request: RemoteRpcRequest) => void) => () => {}),
}));
vi.mock("../host/remote-host", () => ({ remoteHost: host }));

const tab: TabView = {
  key: 1,
  process: null,
  name: "Test",
  dotColor: null,
  workspacePath: "/project",
  agents: ["codex"],
  agentBusy: true,
  unread: false,
  panes: [
    {
      paneId: 7,
      agent: "codex",
      account: "codex-test",
      phase: "idle",
      attention: "none",
      hasRun: false,
      changedAt: 0,
      startedAt: 1,
    },
  ],
};
const manager = () =>
  ({
    paneAlive: vi.fn(() => true),
    serializePane: vi.fn(() => "ready"),
    sendRemoteInput: vi.fn(async () => ({ status: "sent" })),
    materializePane: vi.fn(async () => ({ paneId: 7, canFocus: () => true })),
    notifySurfacesChanged: vi.fn(),
  }) as unknown as TabManager;
afterEach(() => {
  tabViews.value = [];
  paneSessionTitles.value = new Map();
  vi.clearAllMocks();
});

describe("remote renderer adapter", () => {
  it("republishes the desktop conversation title when it arrives after pairing", () => {
    const current = manager();
    tabViews.value = [{ ...tab, name: null }];
    const stop = installRemoteSessionPublisher({ manager: () => current, rememberFolder: vi.fn() });
    paneSessionTitles.value = new Map([[7, "Sửa giao diện tiếng Việt"]]);
    expect(host.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({ paneId: 7, title: "Sửa giao diện tiếng Việt" }),
    ]);
    expect(remotePanes([tab], current, paneSessionTitles.peek())[0].title).toBe("Test");
    stop();
  });

  it("returns resolved screen colors without changing pane ownership or input", async () => {
    const current = manager();
    const screen = {
      text: "Tiếng Việt",
      foreground: "#cccccc",
      background: "#111111",
      rows: [
        [
          {
            text: "Tiếng Việt",
            foreground: "#ff3344",
            background: "#111111",
            flags: 0,
          },
        ],
      ],
    };
    current.remoteScreen = vi.fn(() => screen);
    tabViews.value = [tab];
    const stop = installRemoteSessionPublisher({ manager: () => current, rememberFolder: vi.fn() });
    const callback = host.onRequest.mock.calls.at(-1)![0];
    callback({
      requestId: "colored-screen",
      deadline: Date.now() + 10_000,
      operation: { kind: "screen", pane: remotePanes([tab], current)[0] },
    });
    await vi.waitFor(() =>
      expect(host.reply).toHaveBeenCalledWith("colored-screen", expect.objectContaining(screen)),
    );
    expect(current.serializePane).not.toHaveBeenCalled();
    expect(current.sendRemoteInput).not.toHaveBeenCalled();
    stop();
  });

  it("keeps watching tabs when installed before the tab manager finishes booting", async () => {
    tabViews.value = [];
    let current: TabManager | null = null;
    const stop = installRemoteSessionPublisher({ manager: () => current, rememberFolder: vi.fn() });
    current = manager();
    tabViews.value = [tab];
    expect(host.publish).toHaveBeenLastCalledWith(remotePanes([tab], current));
    stop();
  });

  it("rejects input for an earlier agent generation without touching the pane", async () => {
    const current = manager();
    tabViews.value = [tab];
    const stop = installRemoteSessionPublisher({ manager: () => current, rememberFolder: vi.fn() });
    const callback = host.onRequest.mock.calls.at(-1)![0];
    const old = remotePanes([tab], current)[0];
    callback({
      requestId: "old-agent",
      deadline: Date.now() + 10_000,
      operation: { kind: "input", pane: { ...old, startedAt: 0 }, text: "continue" },
    });
    await vi.waitFor(() =>
      expect(host.reply).toHaveBeenCalledWith(
        "old-agent",
        null,
        expect.stringContaining("changed"),
      ),
    );
    expect(current.sendRemoteInput).not.toHaveBeenCalled();
    stop();
  });

  it.each(["codex", "agy"] as const)(
    "creates a normal background %s tab with its exact account command",
    async (agentId) => {
      const current = manager();
      tabViews.value = [tab];
      const rememberFolder = vi.fn();
      const stop = installRemoteSessionPublisher({ manager: () => current, rememberFolder });
      const callback = host.onRequest.mock.calls.at(-1)![0];
      callback({
        requestId: "new-agent",
        deadline: Date.now() + 10_000,
        operation: {
          kind: "create",
          request: { path: "/project", agentId, accountId: `${agentId}-test` },
        },
      });
      await vi.waitFor(() => expect(host.reply).toHaveBeenCalledWith("new-agent", { paneId: 7 }));
      expect(current.materializePane).toHaveBeenCalledWith(
        expect.objectContaining({
          cwds: ["/project"],
          workspacePath: "/project",
          agent: agentId,
          launchCommand: `cli ${agentId}-test`,
          select: false,
          focusOnInit: false,
        }),
      );
      expect(rememberFolder).toHaveBeenCalledWith("/project");
      expect(remotePaneIdentity(remotePanes([tab], current)[0])).toContain("codex");
      stop();
    },
  );
});
