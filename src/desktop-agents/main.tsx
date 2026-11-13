import { render, type TargetedAnimationEvent } from "preact";
import { signal } from "@preact/signals";
import { useCallback, useEffect, useLayoutEffect, useState } from "preact/hooks";
import { applyThemeVars } from "../lib/theme-vars";
import { DESKTOP_AGENT_LABELS, type DesktopAgentSnapshot } from "../lib/desktop-agents";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import "../styles/01-tokens.css";
import "./widget.css";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface WidgetBridge {
  subscribe(callback: (snapshot: DesktopAgentSnapshot) => void): () => void;
  activate(key: string): void;
  rendered(): void;
}
const bridge = (globalThis as unknown as { __deckAgents?: WidgetBridge }).__deckAgents;
const snapshot = signal<DesktopAgentSnapshot>({ revision: -1, rows: [], theme: {} });
type WidgetRow = DesktopAgentSnapshot["rows"][number];

function activateAgent(event: { currentTarget: EventTarget | null }): void {
  const key = (event.currentTarget as HTMLButtonElement).dataset.key;
  if (key) bridge?.activate(key);
}

function AgentContent({ row }: { row: WidgetRow }) {
  return (
    <>
      <span class="agent-widget__glyph">
        <AgentGlyph agent={row.agentId} className="agent-widget__logo" />
      </span>
      <span class="agent-widget__topline">
        <span class="agent-widget__project">{row.project}</span>
        <span class="agent-widget__separator" aria-hidden="true">
          ·
        </span>
        <span class="agent-widget__state">
          {row.state === "working" && (
            <span class="agent-widget__spinner" aria-hidden="true">
              {BRAILLE_FRAMES.map((frame) => (
                <i key={frame}>{frame}</i>
              ))}
            </span>
          )}
          {DESKTOP_AGENT_LABELS[row.state]}
        </span>
      </span>
      <span class="agent-widget__bottomline">
        <span class="agent-widget__session">{row.session}</span>
      </span>
    </>
  );
}

function Widget() {
  const { rows, revision } = snapshot.value;
  const [rowIndex, setRowIndex] = useState(0);
  const rowKeys = rows.map((row) => row.key).join("\u0000");
  useLayoutEffect(() => {
    bridge?.rendered();
  }, [revision]);
  useEffect(() => setRowIndex(0), [rowKeys]);
  const advanceAgent = useCallback(
    (event: TargetedAnimationEvent<HTMLButtonElement>) => {
      if (event.target === event.currentTarget && event.animationName === "agent-widget-out") {
        setRowIndex((index) => (index + 1) % rows.length);
      }
    },
    [rows.length],
  );
  if (!rows.length) return null;
  const row = rows[rowIndex % rows.length];
  const nextRow = rows.length > 1 ? rows[(rowIndex + 1) % rows.length] : undefined;
  return (
    <section class="agent-widget" aria-label="Agent activity">
      <button
        key={row.key}
        data-key={row.key}
        class={`agent-widget__row${nextRow ? " agent-widget__row--outgoing" : ""}`}
        data-state={row.state}
        title={`Open ${row.agent} in ${row.project}\n${row.session} · ${DESKTOP_AGENT_LABELS[row.state]}`}
        aria-label={`Open ${row.agent}, ${row.project}, ${row.session}, ${DESKTOP_AGENT_LABELS[row.state]}`}
        onClick={activateAgent}
        onAnimationEnd={advanceAgent}
      >
        <AgentContent row={row} />
      </button>
      {nextRow && (
        <div
          key={`${row.key}:${nextRow.key}`}
          class="agent-widget__row agent-widget__row--incoming"
          data-state={nextRow.state}
          aria-hidden="true"
        >
          <AgentContent row={nextRow} />
        </div>
      )}
    </section>
  );
}
bridge?.subscribe((next) => {
  if (next.revision < snapshot.value.revision) return;
  applyThemeVars(document.documentElement.style, next.theme);
  snapshot.value = next;
});
render(<Widget />, document.getElementById("root")!);
