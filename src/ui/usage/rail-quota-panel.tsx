import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { formatQuota, quotaIsStale, type CliQuotaAccount } from "../../lib/cli-manager-quota";
import {
  cliQuota,
  cliQuotaAvailable,
  cliQuotaError,
  cliQuotaLoading,
  observeCliQuota,
} from "../../usage/cli-quota-store";
import { AccountHandle, type QuotaAccountActions } from "./cli-quota";
import { RailCodexCost } from "./rail-codex-cost";
import "./rail-quota-panel.css";

function weeklyReset(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function HalfMeter({ value, lower }: { readonly value: number | null; readonly lower?: boolean }) {
  // Separate endpoints leave a small gap between the two independently filled windows.
  const d = lower ? "M 93.8 54 A 44 44 0 0 1 6.2 54" : "M 6.2 46 A 44 44 0 0 1 93.8 46";
  return (
    <g class={`rail-quota__half ${value === null ? "is-unknown" : value === 0 ? "is-empty" : ""}`}>
      <path class="rail-quota__track" d={d} pathLength={100} />
      {value !== null && value > 0 && (
        <path class="rail-quota__fill" d={d} pathLength={100} strokeDasharray={`${value} 100`} />
      )}
    </g>
  );
}

interface AccountQuotaProps {
  readonly account: CliQuotaAccount;
  readonly actions?: QuotaAccountActions;
  readonly now: number;
}

function accountPresentation(account: CliQuotaAccount, now: number) {
  const ready = account.state === "ready";
  const short = ready ? account.fiveHour : null;
  const week = ready ? account.weekly : null;
  const resetShort = short === 0;
  const resetWeek = week === 0;
  const shortMinutes =
    account.fiveHourResetAtMs === null
      ? null
      : Math.max(0, Math.ceil((account.fiveHourResetAtMs - now) / 60_000));
  const shortLabel =
    shortMinutes === null
      ? "Reset unknown"
      : shortMinutes < 60
        ? `${shortMinutes}m`
        : `${Math.floor(shortMinutes / 60)}h${shortMinutes % 60}m`;
  const weekLabel =
    account.weeklyResetAtMs === null ? "Reset unknown" : weeklyReset(account.weeklyResetAtMs);
  const stale = ready && quotaIsStale(account, now);
  const state = !ready
    ? "Quota unavailable"
    : stale
      ? "Cached quota"
      : account.limited
        ? "Limited"
        : "";
  const description = [
    `5h ${formatQuota(short)} remaining`,
    `1w ${formatQuota(week)} remaining`,
    resetShort ? `5h reset: ${shortLabel}` : "",
    resetWeek ? `1w reset: ${weekLabel}` : "",
    state,
  ]
    .filter(Boolean)
    .join(". ");
  return { short, week, resetShort, resetWeek, shortLabel, weekLabel, stale, state, description };
}

/** Retained circle renderer; the sidebar now mounts account rows. */
export function AccountCircle({ account, actions, now }: AccountQuotaProps) {
  const { short, week, resetShort, resetWeek, shortLabel, weekLabel, stale, state, description } =
    accountPresentation(account, now);
  return (
    <div class="rail-quota__entry">
      <AccountHandle
        account={account}
        actions={actions}
        description={description}
        className={`rail-quota__account ${stale ? "is-stale" : ""}`}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <HalfMeter value={short} />
          <HalfMeter value={week} lower />
        </svg>
        <span class="rail-quota__center" aria-hidden="true">
          <strong title={account.name}>{account.name}</strong>
          {resetShort && <small class="rail-quota__reset">5h {shortLabel}</small>}
          {resetWeek && <small class="rail-quota__reset">1w {weekLabel}</small>}
        </span>
      </AccountHandle>
      {state && <small class="rail-quota__state">{state}</small>}
    </div>
  );
}

function QuotaMeter({
  value,
  weekly,
  reset,
}: {
  readonly value: number | null;
  readonly weekly?: boolean;
  readonly reset?: string;
}) {
  return (
    <span
      class={`rail-quota__meter ${weekly ? "is-weekly" : ""} ${value === null ? "is-unknown" : value === 0 ? "is-empty" : ""}`}
    >
      <span class={`rail-quota__window ${reset ? "rail-quota__reset" : ""}`} title={reset}>
        {reset ?? (weekly ? "1w" : "5h")}
      </span>
      {!reset && (
        <span class="rail-quota__bar">
          {value !== null && <span class="rail-quota__bar-fill" style={{ width: `${value}%` }} />}
        </span>
      )}
      <span class="rail-quota__percent">{formatQuota(value)}</span>
    </span>
  );
}

function AccountRow({ account, actions, now }: AccountQuotaProps) {
  const { short, week, resetShort, resetWeek, shortLabel, weekLabel, stale, state, description } =
    accountPresentation(account, now);
  return (
    <AccountHandle
      account={account}
      actions={actions}
      description={description}
      className={`rail-quota__row ${stale ? "is-stale" : ""}`}
    >
      <strong class="rail-quota__row-name" aria-hidden="true">
        {account.name}
      </strong>
      <span class="rail-quota__row-details" aria-hidden="true">
        <span class="rail-quota__meters">
          <QuotaMeter
            value={short}
            reset={
              resetShort
                ? account.fiveHourResetAtMs === null
                  ? "5h reset unknown"
                  : `5h resets in ${shortLabel}`
                : undefined
            }
          />
          <QuotaMeter
            value={week}
            weekly
            reset={
              resetWeek
                ? account.weeklyResetAtMs === null
                  ? "1w reset unknown"
                  : `1w ${weekLabel}`
                : undefined
            }
          />
        </span>
        {state && (state !== "Limited" || (!resetShort && !resetWeek)) && (
          <small class="rail-quota__state">{state}</small>
        )}
      </span>
    </AccountHandle>
  );
}

/** Independent sidebar region; its observer shares the dock's existing poll. */
export function RailQuotaPanel({
  accountActions,
}: {
  readonly accountActions?: QuotaAccountActions;
}) {
  const now = useSignal(Date.now());
  useEffect(observeCliQuota, []);
  useEffect(() => {
    // One clock per visible panel keeps exhausted-account countdowns live, including offline.
    const timer = setInterval(() => {
      now.value = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  }, [now]);
  const snapshot = cliQuota.value;
  const accounts = (snapshot?.accounts.filter((account) => account.agent === "codex") ?? []).sort(
    (a, b) => a.name.localeCompare(b.name, "en", { numeric: true }),
  );
  return (
    <section class="rail-quota" aria-label="Sidebar quota">
      {cliQuotaAvailable && <RailCodexCost />}
      <header class="rail-quota__head">
        <h2>Quota</h2>
        <span>Remaining</span>
      </header>
      <div class="rail-quota__scroll">
        {!cliQuotaAvailable && <p role="status">Available in the Electron app.</p>}
        {cliQuotaError.value && (
          <p role="status">CLI Manager offline.{snapshot ? " Cached quota." : ""}</p>
        )}
        {!snapshot && cliQuotaLoading.value && <p role="status">Reading quota…</p>}
        {snapshot && !snapshot.accounts.some((account) => account.agent === "codex") && (
          <p role="status">No Codex accounts in CLI Manager.</p>
        )}
        <div class="rail-quota__rows" aria-label="Codex quota">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              actions={accountActions}
              now={now.value}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
