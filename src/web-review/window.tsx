/* oxlint-disable react-hooks/exhaustive-deps -- Window-scoped signals and keyed editors own their lifecycle. */
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal, useSignal, useSignalEffect } from "@preact/signals";
import {
  ArrowLeft,
  ArrowRight,
  ArrowClockwise,
  Cursor,
  Selection,
  ChatTeardropText,
  Gear,
  PaperPlaneTilt,
  X,
  Crosshair,
  Check,
  Image,
  Globe,
} from "@phosphor-icons/react";
import { invoke, listen } from "../host/bridge";
import { DeckIcon, CHROME_ICON } from "../ui/controls/deck-icon";
import { applyThemeVars } from "../lib/theme-vars";
import {
  sameReviewTarget,
  reviewReady,
  type ReviewAnnotation,
  type ReviewSnapshot,
} from "../lib/web-review";
import "../styles/01-tokens.css";
import "./web-review.css";

const state = signal<ReviewSnapshot | null>(null);
const selected = signal<string | null>(null);
const configuration = signal(false);
const panelOpen = signal(true);
const error = signal("");
const busy = signal(false);
const checked = signal<Set<string>>(new Set());
const screenshot = signal<string | null>(null);
let writes: Promise<unknown> = Promise.resolve();

function report(reason: unknown): void {
  error.value = reason instanceof Error ? reason.message : String(reason);
}
async function action(channel: string, payload: unknown = {}): Promise<unknown> {
  error.value = "";
  try {
    return await invoke(channel, payload);
  } catch (reason) {
    report(reason);
    throw reason;
  }
}
function run(channel: string, payload: unknown = {}): void {
  void action(channel, payload).catch(() => {});
}
function update(snapshot: ReviewSnapshot): void {
  const changed = state.value?.project.id !== snapshot.project.id;
  state.value = snapshot;
  applyThemeVars(document.documentElement.style, snapshot.theme);
  if (changed) {
    selected.value = null;
    checked.value = new Set();
    screenshot.value = null;
    configuration.value = !snapshot.project.url;
  }
}
function editable(annotation: ReviewAnnotation): boolean {
  return !state.value?.project.batches.some(
    (b) =>
      !["queued", "cancelled"].includes(b.status) &&
      b.annotations.some((a) => a.id === annotation.id),
  );
}
function saveComment(id: string, comment: string, steps: string): void {
  const projectId = state.value?.project.id;
  // Queue every edit before a close can arrive; the host flushes these writes on close.
  const next = invoke("web_review_comment", { projectId, id, comment, steps });
  writes = Promise.all([writes.catch(() => {}), next]);
  void next.catch(report);
}
type Icon = typeof ArrowLeft;
function IconButton(props: {
  icon: Icon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      class="wr-icon"
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <DeckIcon icon={props.icon} size={CHROME_ICON} />
    </button>
  );
}

function CommentEditor({ annotation }: { annotation: ReviewAnnotation }) {
  const text = useSignal(annotation.comment),
    steps = useSignal(annotation.steps),
    image = useSignal("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canEdit = editable(annotation);
  useEffect(() => {
    let alive = true;
    void invoke<string>("web_review_image", { id: annotation.id, kind: "crop" })
      .then((url) => {
        if (alive) image.value = url;
      })
      .catch(report);
    if (!annotation.comment) textarea.current?.focus();
    return () => {
      alive = false;
    };
  }, [annotation.id]);
  const persist = () => saveComment(annotation.id, text.value, steps.value);
  return (
    <section class="wr-editor" aria-label="Selected comment">
      <div class="wr-editor-heading">
        <strong>
          {annotation.capture.kind === "region"
            ? "Selected region"
            : annotation.capture.label || annotation.capture.tag || "Selected element"}
        </strong>
        <IconButton
          icon={X}
          label="Close comment"
          onClick={() => {
            selected.value = null;
          }}
        />
      </div>
      {image.value && (
        <button
          type="button"
          class="wr-image"
          title="View captured screen"
          onClick={() => {
            void action("web_review_image", { id: annotation.id, kind: "screen" })
              .then((url) => {
                screenshot.value = String(url);
              })
              .catch(() => {});
          }}
        >
          <img src={image.value} alt="Selected area at the time of this comment" />
          <span>
            <DeckIcon icon={Image} size={CHROME_ICON} /> View captured screen
          </span>
        </button>
      )}
      <p class="wr-page" title={annotation.capture.url}>
        {annotation.capture.title || annotation.capture.url}
        <small>{new URL(annotation.capture.url).pathname}</small>
      </p>
      {annotation.capture.dialog && <p class="wr-detail">Dialog: {annotation.capture.dialog}</p>}
      {annotation.capture.selectedTab && (
        <p class="wr-detail">Tab: {annotation.capture.selectedTab}</p>
      )}
      <label class="wr-field">
        Requested change
        <textarea
          ref={textarea}
          value={text.value}
          disabled={!canEdit}
          maxLength={8000}
          rows={5}
          placeholder="Describe what should change here…"
          onInput={(e) => {
            text.value = e.currentTarget.value;
            persist();
          }}
        />
      </label>
      <details class="wr-details">
        <summary>Steps and expected behavior</summary>
        <label class="wr-field">
          Additional context
          <textarea
            value={steps.value}
            disabled={!canEdit}
            maxLength={4000}
            rows={3}
            placeholder="For behavior changes: what triggers it, and what should happen?"
            onInput={(e) => {
              steps.value = e.currentTarget.value;
              persist();
            }}
          />
        </label>
      </details>
      <details class="wr-details">
        <summary>Captured context</summary>
        <dl>
          <dt>Viewport</dt>
          <dd>
            {annotation.capture.viewport.width} × {annotation.capture.viewport.height}
          </dd>
          <dt>Component</dt>
          <dd>{annotation.capture.components.join(" → ") || "Not exposed by this page"}</dd>
          <dt>Source hint</dt>
          <dd>{annotation.capture.source || "Agent will locate the source using page evidence"}</dd>
          <dt>Selector</dt>
          <dd>{annotation.capture.selector || "Region selection"}</dd>
          {annotation.git && (
            <>
              <dt>Checkout</dt>
              <dd>
                {annotation.git.branch} · {annotation.git.commit.slice(0, 8)}
                {annotation.git.dirty ? " · local changes" : ""}
              </dd>
            </>
          )}
        </dl>
      </details>
      <div class="wr-editor-actions">
        <button
          type="button"
          class="wr-button"
          onClick={() => run("web_review_reveal", { id: annotation.id })}
        >
          <DeckIcon icon={Crosshair} size={CHROME_ICON} /> Locate
        </button>
        <button
          type="button"
          class="wr-button"
          onClick={() =>
            run("web_review_reviewed", {
              projectId: state.value?.project.id,
              id: annotation.id,
              reviewed: !annotation.reviewed,
            })
          }
        >
          <DeckIcon icon={Check} size={CHROME_ICON} />
          {annotation.reviewed ? "Reopen" : "Mark reviewed"}
        </button>
        <IconButton
          icon={X}
          label="Remove comment"
          onClick={() => {
            void action("web_review_remove", {
              projectId: state.value?.project.id,
              id: annotation.id,
            })
              .then(() => {
                selected.value = null;
              })
              .catch(() => {});
          }}
        />
      </div>
      {!canEdit && (
        <p class="wr-detail">
          This request has already been sent. Add a new comment for follow-up changes.
        </p>
      )}
    </section>
  );
}

function Configuration() {
  const url = useSignal(state.value?.project.url || "");
  return (
    <form
      class="wr-config"
      onSubmit={(e) => {
        e.preventDefault();
        busy.value = true;
        void action("web_review_configure", { projectId: state.value?.project.id, url: url.value })
          .then(() => {
            configuration.value = false;
          })
          .catch(() => {})
          .finally(() => {
            busy.value = false;
          });
      }}
    >
      <label class="wr-field">
        Local web address
        <input
          autoFocus
          type="text"
          value={url.value}
          placeholder="http://localhost:4200"
          required
          onInput={(e) => {
            url.value = e.currentTarget.value;
          }}
        />
      </label>
      <p>
        Include the port and starting path. Start your project's dev server before opening it here.
      </p>
      <div>
        <button class="wr-primary" type="submit" disabled={busy.value}>
          Save and open
        </button>
        <button
          class="wr-button"
          type="button"
          onClick={() => {
            configuration.value = false;
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Queue() {
  const snapshot = state.value!;
  const batches = snapshot.project.batches
    .filter((b) => b.status !== "cancelled")
    .slice()
    .reverse();
  if (!batches.length) return null;
  const target = snapshot.project.selectedTarget;
  return (
    <section class="wr-queue" aria-label="Review queue">
      <h2>Queue and delivery</h2>
      {batches.map((batch) => {
        const live = snapshot.targets.find((c) => sameReviewTarget(c, batch.target));
        const status =
          batch.status === "queued"
            ? !live
              ? "Session unavailable"
              : live.inputPending
                ? "Waiting for a completed turn"
                : live.phase === "working"
                  ? "Waiting for current task"
                  : !reviewReady(live)
                    ? "Waiting for confirmed idle state"
                    : "Queued"
            : {
                dispatching: "Sending…",
                sent: "Sent",
                staged: "Check composer",
                uncertain: "Check delivery",
                cancelled: "Cancelled",
              }[batch.status];
        return (
          <article class="wr-batch" key={batch.id}>
            <div class="wr-row">
              <strong>
                {batch.annotations.length} {batch.annotations.length === 1 ? "comment" : "comments"}
              </strong>
              <span class="wr-status" data-status={batch.status}>
                {status}
              </span>
            </div>
            <p>{batch.target.label}</p>
            <small>
              {batch.status === "queued" && live?.inputPending
                ? "Finish any draft in the terminal and let one task complete before automatic delivery."
                : batch.message}
            </small>
            <div class="wr-editor-actions">
              {batch.status === "queued" && (
                <button
                  class="wr-button"
                  type="button"
                  onClick={() =>
                    run("web_review_cancel", { projectId: snapshot.project.id, id: batch.id })
                  }
                >
                  Cancel batch
                </button>
              )}
              {batch.status === "queued" && target && !sameReviewTarget(target, batch.target) && (
                <button
                  class="wr-button"
                  type="button"
                  onClick={() =>
                    run("web_review_retarget", {
                      projectId: snapshot.project.id,
                      id: batch.id,
                      key: `${target.clientId}:${target.paneId}`,
                    })
                  }
                >
                  Use selected session
                </button>
              )}
              {["staged", "uncertain"].includes(batch.status) && (
                <button
                  class="wr-button"
                  type="button"
                  onClick={() =>
                    run("web_review_cancel", { projectId: snapshot.project.id, id: batch.id })
                  }
                >
                  I checked the conversation
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function App() {
  const view = useRef<HTMLDivElement>(null);
  const address = useSignal("");
  const snapshot = state.value;
  useSignalEffect(() => {
    address.value = state.value?.page.url || state.value?.project.url || "";
  });
  useEffect(() => {
    let stopped = false;
    const stops: (() => void)[] = [];
    void Promise.all([
      listen<ReviewSnapshot>("web-review:state", ({ payload }) => update(payload)),
      listen("web-review:configure", () => {
        configuration.value = true;
      }),
      listen<{ id: string }>("web-review:selected", ({ payload }) => {
        selected.value = payload.id;
        panelOpen.value = true;
        screenshot.value = null;
      }),
    ])
      .then((unlisten) => {
        if (stopped) {
          unlisten.forEach((fn) => fn());
          return;
        }
        stops.push(...unlisten);
        return invoke<ReviewSnapshot>("web_review_state").then(update);
      })
      .catch(report);
    return () => {
      stopped = true;
      stops.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const sync = () => {
      const r = element.getBoundingClientRect();
      run("web_review_bounds", {
        bounds: {
          x: r.x,
          y: r.y,
          width: screenshot.value ? 0 : r.width,
          height: screenshot.value ? 0 : r.height,
        },
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    sync();
    return () => observer.disconnect();
  }, [snapshot?.project.id, panelOpen.value, configuration.value, screenshot.value]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && screenshot.value) {
        screenshot.value = null;
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!snapshot)
    return (
      <div class="wr-loading" role="status">
        {error.value || "Opening Web Review…"}
      </div>
    );
  const project = snapshot.project;
  const target = project.selectedTarget;
  const targetKey = target ? `${target.clientId}:${target.paneId}` : "";
  const targetLive = target && snapshot.targets.some((c) => sameReviewTarget(c, target));
  const annotations = project.annotations;
  const current = annotations.find((a) => a.id === selected.value);
  const sentIds = new Set(
    project.batches
      .filter((b) => b.status !== "cancelled")
      .flatMap((b) => b.annotations.map((a) => a.id)),
  );
  const sendable = annotations.filter((a) => !sentIds.has(a.id) && a.comment.trim() && !a.reviewed);
  const selectedIds = sendable.filter((a) => checked.value.has(a.id)).map((a) => a.id);
  const sendIds = selectedIds.length ? selectedIds : sendable.map((a) => a.id);
  const send = async () => {
    busy.value = true;
    try {
      await writes;
      await action("web_review_enqueue", { projectId: project.id, ids: sendIds });
      checked.value = new Set();
      selected.value = null;
    } catch (reason) {
      report(reason);
    } finally {
      busy.value = false;
    }
  };
  return (
    <div class="wr-app">
      <header class="wr-header">
        <div class="wr-source">
          <DeckIcon icon={Globe} size={CHROME_ICON} />
          <strong>{project.root.split(/[\\/]/).filter(Boolean).at(-1)}</strong>
          <span title={project.root}>{project.root}</span>
        </div>
        <label class="wr-target">
          Send to
          <select
            aria-label="Agent conversation"
            value={targetLive ? targetKey : ""}
            onChange={(e) =>
              run("web_review_target", { projectId: project.id, key: e.currentTarget.value })
            }
          >
            <option value="" disabled selected={!targetLive}>
              {target && !targetLive ? "Selected session unavailable" : "Select existing session"}
            </option>
            {snapshot.targets.map((c) => (
              <option key={`${c.clientId}:${c.paneId}`} value={`${c.clientId}:${c.paneId}`}>
                {c.label}
                {c.phase === "working" ? " · working" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav class="wr-toolbar" aria-label="Web review tools">
        <div class="wr-tools">
          <IconButton
            icon={ArrowLeft}
            label="Back"
            onClick={() => run("web_review_navigate", { action: "back" })}
          />
          <IconButton
            icon={ArrowRight}
            label="Forward"
            onClick={() => run("web_review_navigate", { action: "forward" })}
          />
          <IconButton
            icon={ArrowClockwise}
            label="Reload web app"
            disabled={!project.url}
            onClick={() => run("web_review_navigate", { action: "reload" })}
          />
        </div>
        <form
          class="wr-address"
          onSubmit={(e) => {
            e.preventDefault();
            run("web_review_navigate", { url: address.value });
          }}
        >
          <input
            aria-label="Page address"
            value={address.value}
            placeholder="Configure a local web address"
            disabled={!project.url}
            onInput={(e) => {
              address.value = e.currentTarget.value;
            }}
          />
        </form>
        <div class="wr-tools">
          <button
            type="button"
            class="wr-button"
            aria-pressed={snapshot.page.mode === "element"}
            disabled={!project.url || snapshot.page.loading || Boolean(screenshot.value)}
            onClick={() =>
              run("web_review_mode", {
                mode: snapshot.page.mode === "element" ? "browse" : "element",
              })
            }
          >
            <DeckIcon icon={Cursor} size={CHROME_ICON} /> Element
          </button>
          <button
            type="button"
            class="wr-button"
            aria-pressed={snapshot.page.mode === "region"}
            disabled={!project.url || snapshot.page.loading || Boolean(screenshot.value)}
            onClick={() =>
              run("web_review_mode", {
                mode: snapshot.page.mode === "region" ? "browse" : "region",
              })
            }
          >
            <DeckIcon icon={Selection} size={CHROME_ICON} /> Region
          </button>
        </div>
        <IconButton
          icon={ChatTeardropText}
          label={`Comments (${annotations.length})`}
          active={panelOpen.value}
          onClick={() => {
            panelOpen.value = !panelOpen.value;
          }}
        />
        <IconButton
          icon={Gear}
          label="Web Preview Settings"
          active={configuration.value}
          onClick={() => {
            configuration.value = !configuration.value;
          }}
        />
      </nav>
      {configuration.value && <Configuration key={project.id} />}
      {(error.value || snapshot.page.error) && (
        <div class="wr-notice" role="alert">
          <span>{error.value || snapshot.page.error}</span>
          {error.value && (
            <IconButton
              icon={X}
              label="Dismiss error"
              onClick={() => {
                error.value = "";
              }}
            />
          )}
        </div>
      )}
      <div class="wr-hint" role="status">
        {snapshot.page.mode === "element"
          ? "Click an element. Use ↑ to select its parent, Enter to confirm, or Escape to cancel."
          : snapshot.page.mode === "region"
            ? "Drag a region, or click its two opposite corners. Escape cancels."
            : "Browse your app, then choose Element or Region to add a comment."}
      </div>
      <main class="wr-main">
        <div ref={view} class="wr-viewport" aria-label="Project web page">
          {!project.url && (
            <div class="wr-empty">
              <DeckIcon icon={Globe} size={CHROME_ICON} />
              <h1>Open your local web app</h1>
              <p>
                Set this source's address once, then select elements or regions and send comments to
                its agent.
              </p>
              <button
                class="wr-primary"
                onClick={() => {
                  configuration.value = true;
                }}
              >
                Configure web address
              </button>
            </div>
          )}
          {screenshot.value && (
            <div class="wr-screenshot">
              <div>
                <strong>Captured screen</strong>
                <button
                  class="wr-button"
                  onClick={() => {
                    screenshot.value = null;
                  }}
                >
                  Return to live page
                </button>
              </div>
              <img src={screenshot.value} alt="Full page viewport at annotation time" />
            </div>
          )}
        </div>
        {panelOpen.value && (
          <aside class="wr-panel" aria-label="Review comments">
            <div class="wr-panel-title">
              <h1>
                Comments <span>{annotations.length}</span>
              </h1>
              <IconButton
                icon={X}
                label="Hide comments"
                onClick={() => {
                  panelOpen.value = false;
                }}
              />
            </div>
            <div class="wr-scroll">
              {annotations.length === 0 && (
                <div class="wr-empty wr-empty-small">
                  <p>Select an element or a region, then describe your change.</p>
                  <small>
                    Comments keep the page, screenshot and position where you added them.
                  </small>
                </div>
              )}
              <ol class="wr-comments">
                {annotations.map((a, index) => (
                  <li key={a.id} class={selected.value === a.id ? "is-selected" : ""}>
                    {!sentIds.has(a.id) && !a.reviewed ? (
                      <input
                        type="checkbox"
                        aria-label={`Select comment ${index + 1}`}
                        checked={checked.value.has(a.id)}
                        onChange={(e) => {
                          const next = new Set(checked.value);
                          if (e.currentTarget.checked) next.add(a.id);
                          else next.delete(a.id);
                          checked.value = next;
                        }}
                      />
                    ) : (
                      <span class="wr-done" aria-label={a.reviewed ? "Reviewed" : "In batch"}>
                        {a.reviewed ? <DeckIcon icon={Check} size={CHROME_ICON} /> : null}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        selected.value = a.id;
                      }}
                    >
                      <span class="wr-number">{index + 1}</span>
                      <span>
                        <strong>{a.comment || "Write your requested change…"}</strong>
                        <small>
                          {a.capture.title || new URL(a.capture.url).pathname}
                          {a.reviewed ? " · reviewed" : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {current && <CommentEditor key={current.id} annotation={current} />}
              <Queue />
            </div>
            <footer class="wr-send">
              <button
                class="wr-primary"
                type="button"
                disabled={!targetLive || !sendIds.length || busy.value}
                onClick={() => void send()}
              >
                <DeckIcon icon={PaperPlaneTilt} size={CHROME_ICON} />
                {busy.value
                  ? "Queuing…"
                  : `Queue ${sendIds.length} ${sendIds.length === 1 ? "comment" : "comments"}`}
              </button>
              <small>
                {!snapshot.targets.length
                  ? "Open Codex or AGY in this source and start a conversation."
                  : !targetLive
                    ? "Select the conversation that should receive these comments."
                    : "Sent when the selected agent is idle. Its current task continues."}
              </small>
            </footer>
          </aside>
        )}
      </main>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
