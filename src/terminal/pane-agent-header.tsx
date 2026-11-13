import { togglePanePin } from "./pane-pin-actions";
import { PushPinSlash, XSquare } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "../ui/controls/deck-icon";
import { shortcutLabel } from "../lib/shortcut-label";
import { workspaceLabel } from "../lib/workspace-label";
import { paneHeaderActions } from "./pane-header-actions";
import { effect } from "@preact/signals";
import { render } from "preact";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { tabViews, type PaneView } from "./tabs-store";
import { sessionEntries } from "../sessions/sessions-store";
import { paneTails } from "./session-tail-store";
import { displayAgent, sessionTitlesFor } from "../ui/agent-rail-card-model";
import { paneSessionTitles } from "./session-title-store";
import { PaneQuickAgents } from "./pane-quick-agents";
import "./pane-agent-header.css";

interface PaneHeaderInput {
  send(data: string): Promise<boolean>;
  focus(): void;
}

function PaneActions({ pane }: { pane: PaneView }) {
  return (
    <div
      class="pane-agent-header__actions"
      role="group"
      aria-label="Terminal actions"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {pane.pinned && (
        <button
          type="button"
          class="pane-agent-header__act"
          aria-label="Unpin terminal"
          aria-pressed="true"
          title="Unpin terminal"
          onClick={() => togglePanePin(pane.paneId)}
        >
          <DeckIcon icon={PushPinSlash} size={CHROME_ICON} />
        </button>
      )}
      <button
        type="button"
        class="pane-agent-header__act"
        aria-label="Close pane"
        title={`Close pane (${shortcutLabel("close-pane")})`}
        onClick={() => paneHeaderActions().close(pane.paneId)}
      >
        <DeckIcon icon={XSquare} size={CHROME_ICON} />
      </button>
    </div>
  );
}

export function PaneAgentHeader({
  pane,
  message,
  input,
  shell = false,
  sessionTitle = "",
  project = "",
}: {
  pane: PaneView;
  message: string;
  sessionTitle?: string;
  project?: string;
  input: PaneHeaderInput;
  /** A shell pane in a split tab: the header offers the quick agents instead of a message. */
  shell?: boolean;
}) {
  if (!pane.agent) {
    if (!shell) return null;
    return (
      <div class="pane-agent-header">
        <PaneQuickAgents paneId={pane.paneId} input={input} />
        <span class="pane-agent-header__message" />
        <PaneActions pane={pane} />
      </div>
    );
  }
  // Exact local session metadata also covers agents started manually in a shell.
  const accounts = new Set(
    sessionEntries.value.flatMap((entry) =>
      pane.sessionId &&
      entry.sessionId === pane.sessionId &&
      entry.agent === pane.agent &&
      entry.manager &&
      !entry.manager.isClient
        ? [entry.manager.account]
        : [],
    ),
  );
  const account = pane.accountIsLive
    ? pane.account
    : accounts.size === 1
      ? [...accounts][0]
      : pane.account;
  const label = [
    project.trim(),
    sessionTitle.trim(),
    `[${account?.trim() || displayAgent(pane.agent)}]`,
  ]
    .filter(Boolean)
    .join(" - ");
  return (
    <div class="pane-agent-header">
      <span class="pane-agent-header__identity" title={pane.agent}>
        <AgentGlyph agent={pane.agent} className="pane-agent-header__logo" />
      </span>
      <span
        class="pane-agent-header__message"
        title={[label, message.trim()].filter(Boolean).join("\n")}
      >
        {label}
      </span>
      <PaneActions pane={pane} />
    </div>
  );
}

/** Reuse the pane bar; legacy cwd nodes remain available to the drag ghost. */
export function mountPaneAgentHeader(
  id: number,
  element: HTMLElement,
  bar: HTMLElement,
  input: PaneHeaderInput,
): () => void {
  if ((globalThis as { __deckHost?: unknown }).__deckHost === undefined) return () => {};
  const host = document.createElement("div");
  host.className = "pane-agent-header-host";
  bar.append(host);
  const stop = effect(() => {
    const tab = tabViews.value.find((candidate) =>
      candidate.panes?.some((pane) => pane.paneId === id),
    );
    const pane = tab?.panes?.find((candidate) => candidate.paneId === id);
    // Every terminal keeps its close action reachable without focusing first.
    const shell = Boolean(pane) && !pane?.agent;
    const message = paneTails.value.get(id) ?? "";
    const sessionTitle =
      sessionTitlesFor(tab ? [tab] : [], sessionEntries.value, paneSessionTitles.value).get(id) ??
      "";
    element.classList.toggle("pane--agent-header", Boolean(pane?.agent) || shell);
    render(
      pane && (pane.agent || shell) ? (
        <PaneAgentHeader
          pane={pane}
          message={message}
          sessionTitle={sessionTitle}
          project={tab?.workspacePath ? workspaceLabel(tab.workspacePath) : ""}
          input={input}
          shell={shell}
        />
      ) : null,
      host,
    );
  });
  return () => {
    stop();
    render(null, host);
    host.remove();
    element.classList.remove("pane--agent-header");
  };
}
