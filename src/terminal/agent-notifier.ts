import type { AttentionKind, AttentionSource } from "./agent-attention";
import type { AgentNotificationPayload } from "../lib/native-notification";

/**
 * Pure, injectable policy for turning an `AgentAttentionTracker` transition
 * into a background sound alert. This module is deliberately dumb: it never
 * imports Tauri, the settings store, or a window-focus API — every fact it
 * needs (setting enabled, window focus, and the permission-guarded `send`
 * from Task 20's adapter) arrives through `AgentNotifierDeps`, so it can be
 * unit tested with plain fakes and wired to real sources by the caller
 * (Task 23).
 *
 * The notification copy is built from ONLY `workspaceLabel` + `agentLabel` +
 * a fixed phrase per `AttentionKind`. It never receives raw terminal/OSC
 * text, so it cannot leak any into a notification.
 */

/** Injected dependencies — kept as three plain functions so the notifier
 * stays pure and testable without touching Tauri or the settings store. */
export interface AgentNotifierDeps {
  /** Whether the user has enabled agent notifications (settings.agentNotifications). */
  isEnabled: () => boolean;
  /** Live window-focus state. Sound alerts are background-only — the
   * in-app attention rail already covers the foreground case. */
  isWindowFocused: () => boolean;
  /** Sound adapter `send`; the notifier never touches playback directly. */
  send: (payload: AgentNotificationPayload) => void;
}

/** One attention transition the caller wants evaluated for a notification. */
export interface AttentionNotification {
  paneId: number;
  /** The tracker snapshot revision this transition carries — half of the
   * notifier's dedupe key (the other half is `paneId`). Monotonic per pane. */
  revision: number;
  kind: AttentionKind;
  /** Signal origin. Generic terminal notifications stay visible in-app but silent. */
  source: AttentionSource | null;
  /** Inferred output timing is useful UI context, but too noisy for audio. */
  confidence: "explicit" | "inferred";
  /** Normalized workspace/tab label — never raw terminal text. */
  workspaceLabel: string;
  /** Normalized agent/process label — never raw terminal text. */
  agentLabel: string | null;
}

/** The notifier's public surface — see `createAgentNotifier`. */
export interface AgentNotifier {
  /** Evaluate one transition; fires at most one `send` per (paneId, revision). */
  maybeNotify(n: AttentionNotification): void;
  /** Forget dedupe state for panes outside `live` — call after a pane/tab closes. */
  prune(live: readonly number[]): void;
}

/**
 * Fixed, deterministic copy per actionable kind — the ONLY kind-derived text
 * that reaches a notification. `"none"` is intentionally absent: it is the
 * one `AttentionKind` value that never justifies a notification.
 */
const KIND_PHRASE: Record<Exclude<AttentionKind, "none">, string> = {
  completed: "finished",
  requested: "needs attention",
  warning: "warning",
  error: "error",
};

/**
 * Audio is reserved for agent-owned protocol signals. Terminal BEL/OSC
 * notifications are shared by arbitrary subprocesses, while output timing is
 * only a heuristic; both caused unrelated sounds despite remaining useful as
 * in-app attention hints.
 */
function isAudible(
  n: AttentionNotification,
): n is AttentionNotification & { kind: Exclude<AttentionKind, "none"> } {
  if (n.kind === "none" || n.confidence !== "explicit") return false;
  if (n.kind === "requested") {
    return n.source === "registry" || n.source === "hook" || n.source === "server";
  }
  return n.source === "osc-progress" || n.source === "hook" || n.source === "server";
}

/**
 * Build the injectable, transition-driven notification policy described in
 * the module doc. `maybeNotify` fires `deps.send` only when every gate
 * holds:
 *
 * 1. `deps.isEnabled()` is true.
 * 2. `deps.isWindowFocused()` is false (background-only).
 * 3. The transition came from an explicit agent-owned protocol signal.
 * 4. `n.revision` is strictly greater than the last revision notified for
 *    that pane (monotonic guard — see below).
 *
 * Dedupe state is only recorded once a notification actually fires, so a
 * transition suppressed by an earlier gate (disabled, foreground, or
 * non-actionable) never blocks a later, otherwise-eligible attempt at the
 * same revision.
 *
 * The guard is `revision > lastNotified` rather than `revision !==
 * lastNotified`: a caller that ever hands back a revision at or below the
 * one already notified for that pane (a stale re-poll, an out-of-order
 * delivery, a tracker reset) must not fire again and must not drag the
 * stored high-water mark downward.
 */
export function createAgentNotifier(deps: AgentNotifierDeps): AgentNotifier {
  // paneId -> highest revision actually notified for that pane so far.
  const lastNotified = new Map<number, number>();

  return {
    maybeNotify(n) {
      if (!deps.isEnabled() || deps.isWindowFocused() || !isAudible(n)) {
        return;
      }
      const previous = lastNotified.get(n.paneId) ?? -Infinity;
      if (n.revision <= previous) {
        return; // same or older revision — already notified, or out of order
      }
      lastNotified.set(n.paneId, n.revision);

      const phrase = KIND_PHRASE[n.kind];
      const agent = n.agentLabel ?? "Agent";
      deps.send({
        title: n.workspaceLabel,
        body: `${agent} ${phrase}`,
      });
    },

    prune(live) {
      const keep = new Set(live);
      const doomed: number[] = [];
      for (const paneId of lastNotified.keys()) {
        if (!keep.has(paneId)) {
          doomed.push(paneId);
        }
      }
      for (const paneId of doomed) {
        lastNotified.delete(paneId);
      }
    },
  };
}
