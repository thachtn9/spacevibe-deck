export const CLI_MANAGER_URL = "http://cli-manager.localhost:1428/";
export const QUOTA_MAX_AGE_MS = 5 * 60_000;
export type QuotaAgent = "agy" | "codex";

export interface CliQuotaAccount {
  readonly agent: QuotaAgent;
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly state: "ready" | "unavailable" | "error";
  readonly limited: boolean;
  readonly observedAtMs: number | null;
  readonly fiveHour: number | null;
  readonly weekly: number | null;
  readonly fiveHourResetAtMs: number | null;
  readonly weeklyResetAtMs: number | null;
}

export interface CliQuotaSnapshot {
  readonly checkedAtMs: number;
  readonly accounts: readonly CliQuotaAccount[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/** Only public quota fields cross IPC; missing quota is never treated as 100%. */
export function parseCliManagerStatus(raw: unknown, checkedAtMs = Date.now()): CliQuotaSnapshot {
  const root = record(raw);
  if (!record(root?.antigravity) || !record(root?.codex))
    throw new Error("CLI Manager returned an invalid status");
  const accounts = (["agy", "codex"] as const).flatMap((agent) => {
    const engine = record(root![agent === "agy" ? "antigravity" : "codex"])!;
    const prefix = agent === "agy" ? "gemini" : "codex";
    return Object.entries(record(engine.accounts) ?? {})
      .flatMap(([id, rawAccount]) => {
        const account = record(rawAccount);
        if (!account) return [];
        const quota = record(account.quota);
        const ready = quota?.status === "ok";
        const observedAtMs = timestamp(quota?.fetched_at);
        const reset = (window: "5h" | "weekly"): number | null => {
          if (!ready) return null;
          if (agent === "agy") return timestamp(quota?.[`${prefix}_${window}_reset`]);
          const seconds = quota?.[`${prefix}_${window}_reset_after_seconds`];
          const at =
            observedAtMs !== null &&
            typeof seconds === "number" &&
            Number.isSafeInteger(seconds) &&
            seconds >= 0
              ? observedAtMs + seconds * 1000
              : null;
          return at !== null && Number.isFinite(new Date(at).getTime()) ? at : null;
        };
        const name = typeof account.name === "string" ? account.name.slice(0, 80) : id;
        return [
          {
            agent,
            id,
            name,
            active: engine.active === id || engine.active === name,
            state: ready
              ? ("ready" as const)
              : quota?.status === "error"
                ? ("error" as const)
                : ("unavailable" as const),
            limited:
              account.is_limited === true ||
              account.in_cooldown === true ||
              quota?.limit_reached === true,
            observedAtMs,
            fiveHour: ready ? percent(quota?.[`${prefix}_5h_pct`]) : null,
            weekly: ready ? percent(quota?.[`${prefix}_weekly_pct`]) : null,
            fiveHourResetAtMs: reset("5h"),
            weeklyResetAtMs: reset("weekly"),
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          a.name.localeCompare(b.name, "en", { numeric: true }),
      );
  });
  return { checkedAtMs, accounts };
}

export function formatQuota(value: number | null): string {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function quotaIsStale(account: CliQuotaAccount, now = Date.now()): boolean {
  return account.observedAtMs === null || now - account.observedAtMs > QUOTA_MAX_AGE_MS;
}
