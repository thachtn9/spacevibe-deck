import type { CliQuotaAccount } from "../../lib/cli-manager-quota";
import { freshCwd } from "../../terminal/pane-info";
import type { TabManager } from "../../terminal/tab-manager-types";
import type { Edge } from "../../lib/split-tree";

export function quotaAccountCommand(account: Pick<CliQuotaAccount, "id">): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(account.id) ? `cli ${account.id}` : null;
}

export type QuotaAccountTarget =
  | { readonly kind: "split"; readonly paneId?: number; readonly edge?: Edge }
  | { readonly kind: "switch"; readonly paneId: number }
  | { readonly kind: "folder"; readonly path: string };

export async function openQuotaAccount(
  account: CliQuotaAccount,
  target: QuotaAccountTarget,
  deps: Parameters<typeof openQuotaAccountTab>[2] & {
    readonly manager: Pick<
      TabManager,
      "activePaneId" | "activeSlotRects" | "materialize" | "dropAgentPane" | "switchPaneAccount"
    >;
  },
): Promise<boolean> {
  const command = quotaAccountCommand(account);
  const known = () =>
    deps.accounts().some((row) => row.id === account.id && row.agent === account.agent);
  if (!command || !known()) return false;
  if (target.kind === "folder") {
    return deps.manager.materialize({
      layout: null,
      cwds: [target.path],
      workspacePath: target.path,
      agent: account.agent,
      launchCommand: command,
      chrome: { name: account.id },
      canCommit: known,
      select: true,
    });
  }
  const paneId = target.paneId ?? deps.manager.activePaneId();
  if (paneId === null || !deps.manager.activeSlotRects().some((rect) => rect.id === paneId))
    return false;
  const owner = deps.tabs().find((tab) => tab.panes?.some((pane) => pane.paneId === paneId));
  if (!owner) return false;
  const valid = () =>
    known() &&
    deps
      .tabs()
      .some((tab) => tab.key === owner.key && tab.panes?.some((pane) => pane.paneId === paneId)) &&
    deps.manager.activeSlotRects().some((rect) => rect.id === paneId);
  if (target.kind === "switch") {
    return deps.manager.switchPaneAccount(paneId, account, valid);
  }
  const cwd = await (deps.readCwd ?? freshCwd)(paneId);
  if (!valid()) return false;
  if (!cwd) throw new Error("Could not read the target terminal's folder. Try again.");
  return deps.manager.dropAgentPane(paneId, target.edge ?? "right", {
    agent: account.agent,
    command,
    cwd,
    canCommit: valid,
  });
}

/** Reuse the ordinary new-tab path; a drop never writes into the target PTY. */
export async function openQuotaAccountTab(
  account: CliQuotaAccount,
  targetPaneId: number | undefined,
  deps: {
    readonly manager: Pick<TabManager, "activePaneId" | "activeSlotRects" | "materialize">;
    readonly tabs: () => readonly {
      readonly key: number;
      readonly workspacePath: string | null;
      readonly panes?: readonly { readonly paneId: number }[];
    }[];
    readonly accounts: () => readonly CliQuotaAccount[];
    readonly readCwd?: (id: number) => Promise<string | null>;
  },
): Promise<boolean> {
  const command = quotaAccountCommand(account);
  const paneId = targetPaneId ?? deps.manager.activePaneId();
  const knownAccount = () =>
    deps.accounts().some((row) => row.id === account.id && row.agent === account.agent);
  if (!command || paneId === null || !knownAccount()) return false;
  if (!deps.manager.activeSlotRects().some((rect) => rect.id === paneId)) return false;
  const owner = deps.tabs().find((tab) => tab.panes?.some((pane) => pane.paneId === paneId));
  if (!owner) return false;
  const canCommit = () =>
    knownAccount() &&
    deps
      .tabs()
      .some((tab) => tab.key === owner.key && tab.panes?.some((pane) => pane.paneId === paneId));
  const cwd = await (deps.readCwd ?? freshCwd)(paneId);
  if (!canCommit() || !deps.manager.activeSlotRects().some((rect) => rect.id === paneId))
    return false;
  if (!cwd) throw new Error("Could not read the target terminal's folder. Try again.");
  return deps.manager.materialize({
    layout: null,
    cwds: [cwd],
    agent: account.agent,
    launchCommand: command,
    chrome: { name: account.id },
    ...(owner.workspacePath ? { workspacePath: owner.workspacePath } : {}),
    canCommit,
    select: true,
  });
}
