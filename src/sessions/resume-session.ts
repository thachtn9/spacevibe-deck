import { managerResumeCommand } from "../lib/cli-manager-sessions";
/**
 * A history row's one action: open a single-pane tab in the session's own
 * directory and type that CLI's exact resume command.
 *
 * Manager sessions use a validated `cli resume <id> --acc <account>` command.
 * Legacy scanner entries retain their native resume path. Both reuse the
 * existing MaterializeIntent rather than writing into an existing pane.
 */
import { buildResumeCommand } from "../lib/agent-resume";
import { noteResumedPane } from "../terminal/session-tail-store";
import { countAgentLaunch } from "../telemetry/usage-counters";
import type { CustomAgent } from "../lib/agent-catalog";
import { BUILT_IN_PRESET } from "../lib/preset-schema";
import type { SessionEntry } from "../lib/session-history";
import type { MaterializeIntent } from "../terminal/tab-materialize";

export interface ResumeSessionDeps {
  materialize(intent: MaterializeIntent): Promise<boolean>;
  readonly customAgents: readonly CustomAgent[];
  /** True when the session's recorded cwd no longer exists on disk. */
  isDead(cwd: string): boolean;
}

export async function resumeSession(
  entry: SessionEntry,
  deps: ResumeSessionDeps,
): Promise<boolean> {
  // Checked BEFORE spawn: Deck must not inherit the silent
  // dead-cwd-lands-in-$HOME behaviour here. Resuming a conversation in the
  // wrong directory is worse than not resuming it (spec §4).
  if (deps.isDead(entry.cwd)) {
    return false;
  }
  const command = entry.manager
    ? managerResumeCommand(entry)
    : buildResumeCommand(entry.agent, { kind: "id", id: entry.sessionId }, deps.customAgents);
  // `buildResumeCommand` degrades an unsafe id to the BARE agent command. A
  // bare `claude` here would silently open a NEW conversation while the user
  // asked to resume an old one, so this path refuses instead. The empty id is
  // its own clause: it also fails `SESSION_REF_SAFE`, but every string
  // `.includes("")`, so the survived-into-the-command test cannot see it.
  if (command === null || entry.sessionId === "" || !command.includes(entry.sessionId)) {
    return false;
  }
  const opened = await deps.materialize({
    layout: entry.manager ? null : BUILT_IN_PRESET.layout,
    cwds: [entry.cwd],
    paneCommands: [command],
    workspacePath: entry.cwd,
  });
  // The rail's turn line, same reason as session restore (2026-08-17): this
  // pane continues an existing conversation, so the session already on disk is
  // its own and the tail store's never-ran rule must not hide it. Marked only
  // once the tab exists — an intent that failed leaves no pane to claim it.
  if (opened) {
    noteResumedPane(entry.cwd, entry.agent);
    // Usage analytics (spec §4): a resumed agent is a launch. Counted here
    // rather than in `materialize`, which sees only the pane command and
    // deliberately not this agent id.
    countAgentLaunch(entry.agent);
  }
  return opened;
}
