import type { SessionEntry, SessionsSnapshot } from "./session-history";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Exact manager resume, never fall back to a different account or a fresh session. */
export function managerResumeCommand(entry: SessionEntry): string | null {
  const info = entry.manager;
  if (
    !info ||
    info.isClient ||
    !info.workspaceExists ||
    !entry.cwd ||
    !SAFE_ID.test(entry.sessionId) ||
    !SAFE_ACCOUNT.test(info.account) ||
    (entry.agent !== "codex" && entry.agent !== "agy")
  )
    return null;
  return `cli resume ${entry.sessionId} --acc ${info.account}`;
}

export function parseManagerSessions(raw: unknown, requestedLimit = 500): SessionsSnapshot {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { sessions?: unknown }).sessions)) {
    throw new Error("Invalid CLI Manager session response");
  }
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(2000, Math.floor(requestedLimit)))
    : 500;
  const entries: SessionEntry[] = [];
  const seen = new Set<string>();
  for (const value of (raw as { sessions: unknown[] }).sessions) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const agent = row.engine === "codex" ? "codex" : row.engine === "antigravity" ? "agy" : null;
    const time = typeof row.updated_at === "string" ? Date.parse(row.updated_at) : NaN;
    if (
      !agent ||
      typeof row.id !== "string" ||
      !SAFE_ID.test(row.id) ||
      !Number.isFinite(time) ||
      typeof row.account !== "string" ||
      !SAFE_ACCOUNT.test(row.account)
    )
      continue;
    const key = `${agent}:${row.id}:${row.account}:${row.is_client === true}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      agent,
      sessionId: row.id,
      cwd: typeof row.workspace === "string" && row.workspace ? row.workspace : "(No folder)",
      title: typeof row.title === "string" && row.title.trim() ? row.title : null,
      lastActivityMs: time,
      sourcePath: "",
      manager: {
        account: row.account,
        isClient: row.is_client === true,
        workspaceExists:
          row.workspace_exists === true &&
          typeof row.workspace === "string" &&
          row.workspace.length > 0,
        running: row.is_running === true,
      },
    });
  }
  entries.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  const totals = { claude: 0, codex: 0, agy: 0 };
  for (const entry of entries) totals[entry.agent]++;
  const counts = { codex: 0, agy: 0, claude: 0 };
  return { entries: entries.filter((entry) => counts[entry.agent]++ < limit), totals, limit };
}
