import { expect, it, vi } from "vitest";
import { parseCliManagerStatus } from "../../lib/cli-manager-quota";
import { openQuotaAccount, openQuotaAccountTab, quotaAccountCommand } from "./quota-account-launch";
import type { TabManager } from "../../terminal/tab-manager-types";

const account = parseCliManagerStatus({
  antigravity: {},
  codex: { accounts: { codex1: { name: "codex1" } } },
}).accounts[0];

function setup() {
  let tabs = [{ key: 5, workspacePath: "/project", panes: [{ paneId: 7 }, { paneId: 8 }] }];
  const readCwd = vi.fn().mockResolvedValue("/project/nested");
  const manager = {
    activePaneId: () => 7,
    activeSlotRects: () => [7, 8].map((id) => ({ id, left: 0, top: 0, right: 100, bottom: 100 })),
    materialize: vi.fn().mockResolvedValue(true),
    dropAgentPane: vi.fn().mockResolvedValue(true),
    switchPaneAccount: vi.fn<TabManager["switchPaneAccount"]>().mockResolvedValue(true),
  };
  return {
    manager,
    readCwd,
    tabs: () => tabs,
    accounts: () => [account],
    closeSource: () => {
      tabs = [];
    },
  };
}

it("splits the dropped terminal with the exact account command without creating a tab", async () => {
  const deps = setup();
  await expect(
    openQuotaAccount(account, { kind: "split", paneId: 8, edge: "bottom" }, deps),
  ).resolves.toBe(true);
  expect(deps.readCwd).toHaveBeenCalledWith(8);
  expect(deps.manager.dropAgentPane).toHaveBeenCalledWith(
    8,
    "bottom",
    expect.objectContaining({ agent: "codex", command: "cli codex1", cwd: "/project/nested" }),
  );
  expect(deps.manager.materialize).not.toHaveBeenCalled();
});

it("routes a header drop to account switching without splitting or looking up cwd", async () => {
  const deps = setup();
  await expect(openQuotaAccount(account, { kind: "switch", paneId: 8 }, deps)).resolves.toBe(true);
  expect(deps.manager.switchPaneAccount).toHaveBeenCalledWith(8, account, expect.any(Function));
  expect(deps.manager.dropAgentPane).not.toHaveBeenCalled();
  expect(deps.manager.materialize).not.toHaveBeenCalled();
  expect(deps.readCwd).not.toHaveBeenCalled();
  const valid = deps.manager.switchPaneAccount.mock.calls[0][2];
  expect(valid()).toBe(true);
  deps.closeSource();
  expect(valid()).toBe(false);
});

it("uses the focused pane on double-click and creates a tab only for a folder drop", async () => {
  const deps = setup();
  await openQuotaAccount(account, { kind: "split" }, deps);
  expect(deps.manager.dropAgentPane).toHaveBeenCalledWith(7, "right", expect.anything());
  deps.manager.dropAgentPane.mockClear();
  deps.readCwd.mockClear();
  await openQuotaAccount(account, { kind: "folder", path: "/other/project" }, deps);
  expect(deps.manager.materialize).toHaveBeenCalledWith(
    expect.objectContaining({
      cwds: ["/other/project"],
      workspacePath: "/other/project",
      launchCommand: "cli codex1",
    }),
  );
  expect(deps.readCwd).not.toHaveBeenCalled();
  expect(deps.manager.dropAgentPane).not.toHaveBeenCalled();
});

it("cancels split launch if the source closes during cwd lookup", async () => {
  const deps = setup();
  deps.readCwd.mockImplementation(async () => {
    deps.closeSource();
    return "/project";
  });
  await expect(openQuotaAccount(account, { kind: "split", paneId: 7 }, deps)).resolves.toBe(false);
  expect(deps.manager.dropAgentPane).not.toHaveBeenCalled();
});

it("opens a separate named tab in the dropped pane's live cwd with the exact account command", async () => {
  const deps = setup();
  await expect(openQuotaAccountTab(account, 8, deps)).resolves.toBe(true);
  expect(deps.readCwd).toHaveBeenCalledWith(8);
  expect(deps.manager.materialize).toHaveBeenCalledWith(
    expect.objectContaining({
      layout: null,
      cwds: ["/project/nested"],
      workspacePath: "/project",
      agent: "codex",
      launchCommand: "cli codex1",
      chrome: { name: "codex1" },
      select: true,
    }),
  );
  const guard = deps.manager.materialize.mock.calls[0][0].canCommit;
  expect(guard()).toBe(true);
  deps.closeSource();
  expect(guard()).toBe(false);
});

it("uses the focused terminal for keyboard or click activation", async () => {
  const deps = setup();
  await openQuotaAccountTab(account, undefined, deps);
  expect(deps.readCwd).toHaveBeenCalledWith(7);
});

it("does not spawn if the source closes during cwd lookup", async () => {
  const deps = setup();
  deps.readCwd.mockImplementation(async () => {
    deps.closeSource();
    return "/project";
  });
  await expect(openQuotaAccountTab(account, 7, deps)).resolves.toBe(false);
  expect(deps.manager.materialize).not.toHaveBeenCalled();
});

it("refuses missing cwd rather than opening an account in the home directory", async () => {
  const deps = setup();
  deps.readCwd.mockResolvedValue(null);
  await expect(openQuotaAccountTab(account, 7, deps)).rejects.toThrow("target terminal's folder");
  expect(deps.manager.materialize).not.toHaveBeenCalled();
});

it("rejects unknown accounts, shell metacharacters and nonterminal drop targets", async () => {
  const deps = setup();
  expect(quotaAccountCommand({ id: "codex1; touch /tmp/unwanted" })).toBeNull();
  expect(quotaAccountCommand({ id: "acc2" })).toBe("cli acc2");
  await expect(openQuotaAccountTab({ ...account, id: "unknown" }, 7, deps)).resolves.toBe(false);
  await expect(openQuotaAccountTab(account, 999, deps)).resolves.toBe(false);
  expect(deps.manager.materialize).not.toHaveBeenCalled();
});
