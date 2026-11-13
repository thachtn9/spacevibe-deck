import {
  DESKTOP_AGENT_STATES,
  orderDesktopAgents,
  type DesktopAgentRow,
  type DesktopAgentSnapshot,
  type DesktopAgentTheme,
} from "../../src/lib/desktop-agents";

export function validateDesktopAgents(rows: unknown): DesktopAgentRow[] {
  if (!Array.isArray(rows) || rows.length > 256) throw new Error("Invalid desktop agent rows");
  const seen = new Set<number>();
  return rows.map((row) => {
    if (
      !row ||
      !Number.isSafeInteger(row.paneId) ||
      row.paneId < 0 ||
      seen.has(row.paneId) ||
      typeof row.agentId !== "string" ||
      !row.agentId.trim() ||
      row.agentId.length > 80 ||
      typeof row.agent !== "string" ||
      !row.agent.trim() ||
      row.agent.length > 80 ||
      typeof row.project !== "string" ||
      row.project.length > 160 ||
      typeof row.session !== "string" ||
      !row.session.trim() ||
      row.session.length > 160 ||
      !DESKTOP_AGENT_STATES.includes(row.state)
    )
      throw new Error("Invalid desktop agent row");
    seen.add(row.paneId);
    return {
      paneId: row.paneId,
      agentId: row.agentId,
      agent: row.agent,
      project: row.project,
      session: row.session,
      state: row.state,
    };
  });
}
export function validateDesktopAgentTheme(theme: unknown): DesktopAgentTheme {
  if (!theme || typeof theme !== "object") return {};
  const result: Record<string, string> = {};
  for (const key of ["background", "foreground", "blue", "green", "yellow", "red"] as const) {
    const value = (theme as Record<string, unknown>)[key];
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) result[key] = value;
  }
  return result;
}

/** The owner label stays in main, never accepted from a renderer or widget click. */
export class DesktopAgentModel {
  private windows = new Map<string, { rows: DesktopAgentRow[]; theme: DesktopAgentTheme }>();
  private revision = 0;
  update(label: string, rows: DesktopAgentRow[], theme: DesktopAgentTheme): void {
    this.windows.set(label, { rows, theme });
  }
  forget(label: string): void {
    this.windows.delete(label);
  }
  target(key: string): { label: string; paneId: number } | null {
    for (const [label, { rows }] of this.windows) {
      const row = rows.find((candidate) => key === `${label}:${candidate.paneId}`);
      if (row) return { label, paneId: row.paneId };
    }
    return null;
  }
  snapshot(): DesktopAgentSnapshot {
    const rows = [...this.windows].flatMap(([label, state]) =>
      state.rows.map((row) => ({ ...row, key: `${label}:${row.paneId}` })),
    );
    return {
      revision: ++this.revision,
      rows: orderDesktopAgents(rows),
      theme: [...this.windows.values()].at(-1)?.theme ?? {},
    };
  }
}
