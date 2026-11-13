/** Bounded, display-only activity; never contains terminal output or resume identities. */
export const DESKTOP_AGENT_STATES = [
  "working",
  "requested",
  "warning",
  "error",
  "completed",
  "done",
  "idle",
] as const;
export type DesktopAgentState = (typeof DESKTOP_AGENT_STATES)[number];
export interface DesktopAgentRow {
  readonly paneId: number;
  readonly agentId: string;
  readonly agent: string;
  readonly project: string;
  readonly session: string;
  readonly state: DesktopAgentState;
}
export interface DesktopAgentTheme {
  readonly background?: string;
  readonly foreground?: string;
  readonly blue?: string;
  readonly green?: string;
  readonly yellow?: string;
  readonly red?: string;
}
export interface DesktopAgentSnapshot {
  readonly revision: number;
  readonly rows: readonly (DesktopAgentRow & { readonly key: string })[];
  readonly theme: DesktopAgentTheme;
}
export const DESKTOP_AGENT_LABELS: Record<DesktopAgentState, string> = {
  working: "Working",
  requested: "Needs you",
  warning: "Needs you",
  error: "Error",
  completed: "Finished",
  done: "Finished",
  idle: "Ready",
};
const PRIORITY: Record<DesktopAgentState, number> = {
  error: 4,
  requested: 3,
  warning: 3,
  completed: 2,
  working: 1,
  done: 0,
  idle: 0,
};
export function orderDesktopAgents<T extends DesktopAgentRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => PRIORITY[b.state] - PRIORITY[a.state]);
}
