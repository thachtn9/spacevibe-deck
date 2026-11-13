import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { CaretDown, DotsSixVertical } from "@phosphor-icons/react";
import {
  CLI_MANAGER_URL,
  formatQuota,
  quotaIsStale,
  type CliQuotaAccount,
  type QuotaAgent,
} from "../../lib/cli-manager-quota";
import { openUrl } from "../../host/shell-host";
import {
  cliQuota,
  cliQuotaAvailable,
  cliQuotaError,
  cliQuotaLoading,
  observeCliQuota,
  refreshCliQuota,
} from "../../usage/cli-quota-store";
import { AgentGlyph } from "../controls/agent-glyph";
import { DeckIcon, CHROME_ICON } from "../controls/deck-icon";
import { createNewPaneDragController } from "../new-pane-drag";
import type { PaneRect } from "../../lib/pane-geometry";
import { quotaAccountCommand, type QuotaAccountTarget } from "./quota-account-launch";

export interface QuotaAccountActions {
  slotRects(): readonly PaneRect[];
  headerRects?(): readonly PaneRect[];
  folderTargets?(): readonly { readonly path: string; readonly rect: PaneRect }[];
  open(account: CliQuotaAccount, target?: QuotaAccountTarget): void;
}

export function AccountHandle({
  account,
  actions,
  children,
  className = "cli-quota__account",
  description,
}: {
  readonly account: CliQuotaAccount;
  readonly actions?: QuotaAccountActions;
  readonly children?: ComponentChildren;
  readonly className?: string;
  readonly description?: string;
}) {
  const handle = useRef<HTMLButtonElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const latestAccount = useRef(account);
  latestAccount.current = account;
  const accountId = account.id;
  const accountName = account.name;
  const enabled = !!actions && quotaAccountCommand(account) !== null;
  useLayoutEffect(() => {
    if (!enabled || !handle.current) return;
    const controller = createNewPaneDragController(handle.current, {
      ghostLabel: `cli ${accountId}`,
      targetShape: "edge",
      dropLabel: `Split with ${accountName}`,
      slotRects: () => latest.current?.slotRects() ?? [],
      onDrop: (paneId, edge) =>
        latest.current?.open(latestAccount.current, { kind: "split", paneId, edge }),
      folderTargets: () => latest.current?.folderTargets?.() ?? [],
      onFolderDrop: (path) => latest.current?.open(latestAccount.current, { kind: "folder", path }),
      headerTargets: () => latest.current?.headerRects?.() ?? [],
      headerDropLabel: `Switch to ${accountName} and resume`,
      onHeaderDrop: (paneId) =>
        latest.current?.open(latestAccount.current, { kind: "switch", paneId }),
    });
    return () => controller.dispose();
  }, [enabled, accountId, accountName]);
  return (
    <button
      ref={handle}
      type="button"
      class={className}
      disabled={!enabled}
      aria-label={`Split with ${account.name}${description ? `. ${description}` : ""}`}
      title={`${description ? `${description}\n` : ""}Double-click to split. Drag to a terminal to split, to its header to switch accounts and resume, or to a folder for a new tab.`}
      onDblClick={() => latest.current?.open(account, { kind: "split" })}
    >
      {children ?? (
        <>
          <DeckIcon icon={DotsSixVertical} size={CHROME_ICON} />
          <span class="cli-quota__name">{account.name}</span>
        </>
      )}
    </button>
  );
}

function useCliQuota() {
  useEffect(observeCliQuota, []);
  return cliQuota.value;
}

function resetLabel(at: number | null): string {
  if (at === null) return "";
  const minutes = Math.ceil((at - Date.now()) / 60_000);
  if (minutes <= 0) return "Reset due";
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function QuotaCell({
  value,
  resetsAt,
  label,
}: {
  readonly value: number | null;
  readonly resetsAt: number | null;
  readonly label: string;
}) {
  return (
    <td class={value !== null && value <= 15 ? "cli-quota__low" : ""}>
      <span class="cli-quota__value">
        {value !== null && (
          <span
            class="cli-quota__meter"
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={`${formatQuota(value)} remaining`}
          >
            <span class="cli-quota__fill" style={{ width: `${value}%` }} />
          </span>
        )}
        <strong>{formatQuota(value)}</strong>
      </span>
      {value !== null && resetsAt !== null && (
        <small title={new Date(resetsAt).toLocaleString()}>
          {resetsAt <= Date.now() ? "Reset due" : `Resets in ${resetLabel(resetsAt)}`}
        </small>
      )}
    </td>
  );
}

function accountState(account: CliQuotaAccount): string {
  if (account.state !== "ready") return "Quota unavailable";
  if (quotaIsStale(account)) return "Cached quota";
  return account.limited ? "Limited" : "";
}

export function CliQuotaBody({
  accountActions,
}: {
  readonly accountActions?: QuotaAccountActions;
}) {
  const snapshot = useCliQuota();
  const [collapsed, setCollapsed] = useState<Record<QuotaAgent, boolean>>({
    codex: false,
    agy: false,
  });
  return (
    <section class="cli-quota" aria-label="Quota remaining">
      <header class="cli-quota__head">
        <h2>Quota remaining</h2>
        <button
          type="button"
          class="cfg-btn"
          disabled={!cliQuotaAvailable || cliQuotaLoading.value}
          onClick={() => void refreshCliQuota()}
        >
          {cliQuotaLoading.value ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      <p class="cli-quota__note">
        Double-click or drop onto a terminal body to split. Drop onto its header to switch accounts
        and resume, or onto a folder for a new tab.
      </p>
      {!cliQuotaAvailable && <p role="status">Quota is available in the Electron app.</p>}
      {cliQuotaError.value && (
        <p role="status">
          CLI Manager is unavailable.
          {snapshot ? " Showing the last reading." : " Open CLI Manager, then refresh."}
        </p>
      )}
      {!snapshot && cliQuotaLoading.value && <p role="status">Reading quota…</p>}
      {snapshot && !snapshot.accounts.length && <p role="status">No accounts in CLI Manager.</p>}
      {(["codex", "agy"] as const).map((agent) => {
        const accounts = (
          snapshot?.accounts.filter((account) => account.agent === agent) ?? []
        ).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
        if (!accounts.length) return null;
        return (
          <section
            class="cli-quota__group"
            key={agent}
            aria-label={`${agent === "agy" ? "AGY" : "Codex"} accounts`}
          >
            <h3>
              <button
                type="button"
                class="cli-quota__toggle"
                aria-expanded={!collapsed[agent]}
                aria-controls={`quota-${agent}-accounts`}
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [agent]: !current[agent] }))
                }
              >
                <DeckIcon icon={CaretDown} size={CHROME_ICON} />
                <AgentGlyph agent={agent} className="cli-quota__logo" />
                {agent === "agy" ? "AGY" : "Codex"}
                <small>{accounts.length}</small>
              </button>
            </h3>
            <table id={`quota-${agent}-accounts`} hidden={collapsed[agent]}>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">5 hours</th>
                  <th scope="col">Weekly</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <th scope="row">
                      <AccountHandle account={account} actions={accountActions} />
                      {accountState(account) && <small>{accountState(account)}</small>}
                    </th>
                    <QuotaCell
                      value={account.fiveHour}
                      resetsAt={account.fiveHourResetAtMs}
                      label={`${account.name}: 5-hour quota remaining`}
                    />
                    <QuotaCell
                      value={account.weekly}
                      resetsAt={account.weeklyResetAtMs}
                      label={`${account.name}: weekly quota remaining`}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <footer class="cli-quota__foot">
        <button class="cli-quota__link" type="button" onClick={() => void openUrl(CLI_MANAGER_URL)}>
          Open CLI Manager
        </button>
        {snapshot && (
          <small>
            Checked{" "}
            {new Date(snapshot.checkedAtMs).toLocaleTimeString("en", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
      </footer>
    </section>
  );
}

export function RailCliQuota({ onOpenUsage }: { readonly onOpenUsage: () => void }) {
  const snapshot = useCliQuota();
  return (
    <section class="agent-usage-summary" aria-label="Remaining quota">
      <ul class="agent-usage-summary__rows">
        {(["codex", "agy"] as const).map((agent) => {
          const account = snapshot?.accounts.find((row) => row.agent === agent && row.active);
          const values = [account?.fiveHour, account?.weekly].filter(
            (value): value is number => typeof value === "number",
          );
          const remaining = values.length ? Math.min(...values) : null;
          const label = agent === "agy" ? "AGY" : "Codex";
          const detail = account
            ? `${account.name} · 5 hours: ${formatQuota(account.fiveHour)} · Weekly: ${formatQuota(account.weekly)}${accountState(account) ? ` · ${accountState(account)}` : ""}`
            : "Quota unavailable";
          return (
            <li key={agent}>
              <button
                type="button"
                class="agent-usage-summary__agent"
                onClick={onOpenUsage}
                title={`${label} · ${detail}${cliQuotaError.value ? " · CLI Manager unavailable" : ""}`}
                aria-label={`${label}: ${detail}. Open quota`}
              >
                <span>
                  {label} <b class="agent-usage-summary__limit">{formatQuota(remaining)}</b>
                  {cliQuotaError.value || (account && quotaIsStale(account)) ? " · cached" : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
