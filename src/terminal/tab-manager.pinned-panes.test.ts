// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./tab-manager.fixtures";
import { activeTabIndex, tabViews } from "./tabs-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { validateWindowRecord } from "../lib/session-schema";

vi.mock("../lib/native-notification", () => ({ sendAgentNotification: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  tabViews.value = [];
  activeTabIndex.value = 0;
  settings.value = DEFAULT_SETTINGS;
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "linux", homeDir: "/home/test" });
});
afterEach(() => vi.useRealTimers());

describe("pinned terminals across folders", () => {
  it("keeps the existing pane visible and routes focus without changing folders", async () => {
    const paste = vi.fn();
    const { tm, pty } = setup({ paneOverrides: { paste } });
    try {
      await tm.materialize({ layout: null, cwds: ["/a"], workspacePath: "/a" });
      const id = tm.activePaneId()!;
      const element = document.querySelector(".tab-stage .pane__term");
      expect(tm.pinPane(id, "left")).toBe(true);
      await tm.materialize({ layout: null, cwds: ["/b"], workspacePath: "/b" });
      expect(element?.closest(".pinned-pane-slot")).not.toBeNull();
      expect(element?.closest(".tab-stage")).toBeNull();
      expect(tabViews.value[0].panes?.[0].pinned).toBe(true);
      expect(tm.allPaneIds()).toEqual([1, 2]);
      tm.activateForAttention(0, id);
      expect(tm.activeWorkspacePath()).toBe("/b");
      expect(activeTabIndex.value).toBe(1);
      expect(tm.activePaneId()).toBe(id);
      tm.runAction("paste");
      expect(paste).toHaveBeenCalledOnce();
      await tm.injectIntoPane(id, "still the same terminal", {
        autoSend: false,
        expectedAgent: null,
      });
      expect(
        pty.writes.some(
          (write) => write.id === id && write.data.includes("still the same terminal"),
        ),
      ).toBe(true);
      tm.unpinPane(id);
      expect(tm.activeWorkspacePath()).toBe("/a");
      expect(element?.closest(".tab-stage")).not.toBeNull();
      expect(document.querySelector(".has-pinned-panes")).toBeNull();
      expect(tm.allPaneIds()).toEqual([1, 2]);
    } finally {
      tm.dispose();
    }
  });

  it("round-trips placement through journal validation and materialization", async () => {
    const first = setup({});
    await first.tm.materialize({
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      cwds: ["/a", "/a"],
      workspacePath: "/a",
    });
    const id = first.tm.allPaneIds()[0];
    first.tm.pinPane(id, "bottom");
    const record = validateWindowRecord({
      savedAt: 1,
      activeTabIndex: 0,
      tabs: first.tm.captureSession(),
    });
    expect(record?.tabs[0].panes[0].pin).toEqual({ edge: "bottom", order: 0, ratio: 0.35 });
    first.tm.dispose();
    const restored = setup({});
    try {
      const tab = record!.tabs[0];
      await restored.tm.materialize({
        layout: tab.layout,
        cwds: tab.panes.map((p) => p.cwd),
        panePins: tab.panes.map((p) => p.pin),
        workspacePath: "/a",
      });
      expect(tabViews.value[0].panes?.[0].pinned).toBe(true);
      expect(document.querySelectorAll(".pinned-pane-slot")).toHaveLength(1);
      expect(document.querySelectorAll(".terminal-workspace .pane__term")).toHaveLength(1);
    } finally {
      restored.tm.dispose();
    }
  });

  it("creates an ordinary split in the original folder when splitting a focused pin", async () => {
    const { tm } = setup({});
    try {
      await tm.materialize({ layout: null, cwds: ["/a"], workspacePath: "/a" });
      const id = tm.activePaneId()!;
      tm.pinPane(id);
      await tm.materialize({ layout: null, cwds: ["/b"], workspacePath: "/b" });
      tm.activateForAttention(0, id);
      await tm.splitActive("row");
      expect(tm.activeWorkspacePath()).toBe("/a");
      expect(document.querySelectorAll(".pinned-pane-slot")).toHaveLength(1);
      expect(tabViews.value[0].panes?.filter((pane) => pane.pinned)).toHaveLength(1);
      expect(document.querySelectorAll(".terminal-workspace .tab-stage .pane__term")).toHaveLength(
        2,
      );
    } finally {
      tm.dispose();
    }
  });
  it("opens account drops as ordinary panes without adding another pin", async () => {
    const { tm } = setup({});
    try {
      await tm.materialize({ layout: null, cwds: ["/a"], workspacePath: "/a" });
      const id = tm.activePaneId()!;
      tm.pinPane(id);
      await tm.materialize({ layout: null, cwds: ["/b"], workspacePath: "/b" });
      expect(
        await tm.dropAgentPane(id, "bottom", {
          command: "cli codex1",
          agent: "codex",
          cwd: "/a",
          canCommit: () => true,
        }),
      ).toBe(true);
      expect(tm.activeWorkspacePath()).toBe("/a");
      expect(document.querySelectorAll(".pinned-pane-slot")).toHaveLength(1);
      expect(tabViews.value[0].panes?.filter((pane) => pane.pinned)).toHaveLength(1);
    } finally {
      tm.dispose();
    }
  });
  it("shows only pins when selecting their folders and restores the third terminal on return", async () => {
    const { tm, pty } = setup({});
    try {
      await tm.materialize({ layout: null, cwds: ["/a"], workspacePath: "/a" });
      tm.pinPane(tm.activePaneId()!);
      await tm.materialize({ layout: null, cwds: ["/b"], workspacePath: "/b" });
      tm.pinPane(tm.activePaneId()!);
      await tm.materialize({ layout: null, cwds: ["/c"], workspacePath: "/c" });
      const thirdId = tm.activePaneId()!;
      const thirdSession = pty.sessions.get(thirdId);
      const workspace = document.querySelector<HTMLElement>(".terminal-workspace")!;
      const placements = tm.captureSession().flatMap((tab) => tab.panes.map((pane) => pane.pin));
      expect(workspace.style.display).toBe("");
      tm.selectTab(0);
      expect(tm.activeWorkspacePath()).toBe("/a");
      expect(
        document.activeElement?.closest(".pinned-pane-slot")?.getAttribute("data-pane-id"),
      ).toBe("1");
      expect(workspace.style.display).toBe("none");
      expect(workspace.isConnected).toBe(true);
      expect(document.querySelector('.stage__tabs > .pane-slot[data-pane-id="-1"]')).toBeNull();
      expect(document.querySelectorAll(".pinned-pane-slot")).toHaveLength(2);
      tm.selectTab(1);
      expect(workspace.style.display).toBe("none");
      expect(pty.sessions.get(thirdId)).toBe(thirdSession);
      tm.selectTab(2);
      expect(workspace.style.display).toBe("");
      expect(tm.activePaneId()).toBe(thirdId);
      expect(tm.captureSession().flatMap((tab) => tab.panes.map((pane) => pane.pin))).toEqual(
        placements,
      );
      expect(tm.allPaneIds()).toHaveLength(3);
    } finally {
      tm.dispose();
    }
  });
});
