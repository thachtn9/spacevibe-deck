/* oxlint-disable react-hooks/exhaustive-deps -- useSignal stores are stable; effects depend on their inputs, not the state they publish. */
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  CaretDown,
  CaretRight,
  GitBranch,
  ArrowClockwise,
  ArrowDown,
  X,
} from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import * as host from "../../host/git-review-host";
import type {
  ReviewCommit,
  ReviewDiff,
  ReviewRepository,
  ReviewSnapshot,
} from "../../lib/git-review";
import { reviewTarget, saveReviewTarget } from "./review-store";
import type { ReviewSelection } from "./review-diff";

function CommitRow(props: {
  readonly root: string;
  readonly commit: ReviewCommit;
  readonly target?: string | null;
  readonly selected?: ReviewSelection | null;
  onSelect(selection: ReviewSelection): void;
}) {
  const open = useSignal(false);
  const files = useSignal<ReviewDiff | null>(null);
  const error = useSignal<string | null>(null);
  const { root, commit } = props;
  useEffect(() => {
    if (!open.value || files.peek()) return;
    let cancelled = false;
    error.value = null;
    void host
      .readReviewDiff(root, commit.id)
      .then((value) => {
        if (!cancelled) files.value = value;
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          error.value = reason instanceof Error ? reason.message : "Could not read this commit";
      });
    return () => {
      cancelled = true;
    };
  }, [root, commit.id, open.value]);
  const publication =
    commit.publication === "local"
      ? "Local only"
      : commit.publication === "pushed"
        ? "Pushed"
        : "No upstream";
  return (
    <div class="git-review-commit">
      <button
        type="button"
        class="git-review-commit__row"
        aria-expanded={open.value}
        onClick={() => {
          open.value = !open.value;
        }}
        title={`${commit.subject}\n${commit.author} · ${commit.date}\n${commit.id}`}
      >
        <DeckIcon icon={open.value ? CaretDown : CaretRight} size={ROW_ICON} />
        <span class="git-review-commit__text">
          <span class="git-review-commit__subject">{commit.subject}</span>
          <span class="git-review-commit__meta">
            <code>{commit.shortId}</code>
            <span>{commit.author}</span>
            <time dateTime={commit.date}>{new Date(commit.date).toLocaleDateString()}</time>
          </span>
        </span>
        {props.target && (
          <span class="git-review-commit__badge">
            {commit.inTarget ? `In ${props.target}` : `Not in ${props.target}`}
          </span>
        )}
        <span
          class={`git-review-commit__badge${commit.publication === "local" ? " is-local" : ""}`}
        >
          {publication}
        </span>
      </button>
      {open.value && (
        <div class="git-review-commit__files">
          {!files.value && !error.value && <p class="git-review__message">Reading files…</p>}
          {error.value && (
            <p class="git-review__message is-error" role="alert">
              {error.value}
            </p>
          )}
          {files.value?.files.map((file) => (
            <button
              type="button"
              class="git-review-file"
              aria-pressed={
                props.selected?.root === root &&
                props.selected.commit === commit.id &&
                props.selected.path === file.path
              }
              key={file.path}
              title={file.path}
              onClick={() =>
                props.onSelect({ root, commit: commit.id, path: file.path, title: commit.subject })
              }
            >
              <span class="git-review-file__status">{file.status}</span>
              <span class="git-review-file__name">{file.path}</span>
            </button>
          ))}
          {files.value?.files.length === 0 && (
            <p class="git-review__message">No file changes against the first parent.</p>
          )}
          {files.value?.truncated && (
            <p class="git-review__message">Showing the first 500 files.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewRepositoryGroup(props: {
  readonly repository: ReviewRepository;
  readonly refresh: number;
  readonly selected?: ReviewSelection | null;
  onSelect(selection: ReviewSelection): void;
  onRead?(root: string): void;
  onRemove?(): void;
}) {
  const { path: root, label } = props.repository;
  const element = useRef<HTMLElement>(null);
  const visible = useSignal(false);
  const expanded = useSignal(true);
  const snapshot = useSignal<ReviewSnapshot | null>(null);
  const error = useSignal<string | null>(null);
  const reading = useSignal(false);
  const fetching = useSignal(false);
  const target = useSignal<string | undefined>(undefined);
  const refreshLocal = useSignal(0);
  const preferencesReady = useSignal(false);
  const commitView = useSignal<"pending" | "recent">("pending");
  const readEpoch = useRef(0);
  useEffect(() => {
    let cancelled = false;
    void reviewTarget(root).then((value) => {
      if (!cancelled) {
        target.value = value;
        preferencesReady.value = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [root]);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") {
      visible.value = true;
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.value = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!visible.value || !preferencesReady.value) return;
    const epoch = ++readEpoch.current;
    let cancelled = false;
    async function refresh() {
      if (reading.peek() || document.visibilityState === "hidden") return;
      reading.value = true;
      try {
        const value = await host.readReview(root, target.peek());
        if (!cancelled && epoch === readEpoch.current) {
          snapshot.value = value;
          error.value = null;
          props.onRead?.(root);
        }
      } catch (reason) {
        if (!cancelled)
          error.value =
            reason instanceof Error
              ? reason.message
              : "Could not read this repository. Refresh to retry.";
      } finally {
        if (epoch === readEpoch.current) reading.value = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (expanded.peek()) void refresh();
    }, 30000);
    const onFocus = () => {
      if (expanded.peek()) void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      reading.value = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [
    root,
    props.refresh,
    refreshLocal.value,
    target.value,
    visible.value,
    preferencesReady.value,
  ]);
  const data = snapshot.value;
  async function fetchRemote() {
    if (!data?.fetchRemote || fetching.peek()) return;
    fetching.value = true;
    try {
      await host.fetchReview(root, data.fetchRemote);
      refreshLocal.value += 1;
    } catch (reason) {
      error.value =
        reason instanceof Error
          ? reason.message
          : "Fetch failed. Check your connection and refresh.";
    } finally {
      fetching.value = false;
    }
  }
  const dirty = data?.changes.entries ?? [];
  const recent = commitView.value === "recent" || !data?.target;
  const shownCommits = recent ? (data?.history ?? data?.commits ?? []) : (data?.commits ?? []);
  return (
    <section
      class="git-review-repository"
      ref={element}
      data-repository={root}
      aria-label={`Repository ${label}`}
    >
      <header class="git-review-repository__header">
        <button
          type="button"
          class="git-review-repository__toggle"
          aria-expanded={expanded.value}
          onClick={() => {
            expanded.value = !expanded.value;
          }}
          title={root}
        >
          <DeckIcon icon={expanded.value ? CaretDown : CaretRight} size={ROW_ICON} />
          <DeckIcon icon={GitBranch} size={ROW_ICON} />
          <strong>{label}</strong>
          {data && (
            <span class="git-review-repository__count">
              {data.target ? `${data.ahead} pending` : "Choose target"}
            </span>
          )}
        </button>
        <button
          type="button"
          class="git-review__icon"
          aria-label={`Refresh ${label}`}
          disabled={reading.value}
          onClick={() => {
            refreshLocal.value += 1;
          }}
        >
          <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
        </button>
        {props.onRemove && (
          <button
            type="button"
            class="git-review__icon"
            aria-label={`Remove ${label} from source control`}
            title="Hide this repository; keep its files on disk"
            onClick={props.onRemove}
          >
            <DeckIcon icon={X} size={ROW_ICON} />
          </button>
        )}
      </header>
      {expanded.value && (
        <div class="git-review-repository__body">
          {data && (
            <>
              <div class="git-review-repository__comparison">
                <span title={data.branch ?? "Detached HEAD"}>
                  {data.branch ?? (data.changes.initial ? "No commits yet" : "Detached HEAD")}
                </span>
                <span aria-hidden="true">→</span>
                <select
                  class="git-review__select"
                  aria-label={`Target branch for ${label}`}
                  value={
                    target.value === undefined
                      ? (data.target ?? "")
                      : data.refs.includes(target.value)
                        ? target.value
                        : ""
                  }
                  disabled={fetching.value}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    target.value = next;
                    void saveReviewTarget(root, next).catch((reason: unknown) => {
                      error.value =
                        reason instanceof Error
                          ? reason.message
                          : "Could not save the target branch";
                    });
                  }}
                >
                  <option value="">Choose target…</option>
                  {data.refs.map((ref) => (
                    <option key={ref} value={ref}>
                      {ref}
                    </option>
                  ))}
                </select>
              </div>
              <div class="git-review-repository__sync">
                <span>
                  {data.upstream
                    ? `${data.unpushed ?? 0} unpushed · ${data.upstream}`
                    : "No upstream configured"}
                </span>
                {data.fetchRemote && (
                  <button
                    type="button"
                    class="git-review__text-button"
                    disabled={fetching.value}
                    onClick={() => void fetchRemote()}
                    title="Update remote refs before comparing. This does not push or merge."
                  >
                    <DeckIcon icon={ArrowDown} size={ROW_ICON} />
                    {fetching.value ? "Fetching…" : `Fetch ${data.fetchRemote}`}
                  </button>
                )}
              </div>
              {data.target && (
                <p class="git-review__message">
                  {data.ahead} ahead · {data.behind} behind {data.target}
                </p>
              )}
            </>
          )}
          {error.value && (
            <p class="git-review__message is-error" role="alert">
              {error.value}
            </p>
          )}
          {!data && !error.value && (
            <p class="git-review__message" role="status">
              {reading.value ? "Reading repository…" : "Waiting to read repository…"}
            </p>
          )}
          {data && (
            <>
              <div class="git-review__section-title">
                Working changes{" "}
                <span>
                  {dirty.length}
                  {data.changes.omitted ? "+" : ""} files
                </span>
              </div>
              {dirty.length === 0 && <p class="git-review__message">Working tree clean.</p>}
              {dirty.map((file) => (
                <button
                  type="button"
                  class="git-review-file"
                  aria-pressed={
                    props.selected?.root === root &&
                    props.selected.commit === null &&
                    props.selected.path === file.path
                  }
                  key={file.path}
                  title={
                    file.path.endsWith("/")
                      ? `${file.path} — review this nested repository in its own group`
                      : file.path
                  }
                  disabled={file.path.endsWith("/")}
                  onClick={() =>
                    props.onSelect({
                      root,
                      commit: null,
                      path: file.path,
                      title: "Working changes",
                    })
                  }
                >
                  <span class={`git-review-file__status is-${file.status}`}>
                    {file.status === "untracked" ? "?" : file.status[0].toUpperCase()}
                  </span>
                  <span class="git-review-file__name">{file.path}</span>
                  <span class="git-review-file__counts">
                    <span class="diff-counts__added">{file.added ? `+${file.added}` : ""}</span>
                    <span class="diff-counts__removed">
                      {file.removed ? `−${file.removed}` : ""}
                    </span>
                  </span>
                </button>
              ))}
              {data.changes.omitted > 0 && (
                <p class="git-review__message">More changed files are omitted from this preview.</p>
              )}
              <div
                class="git-review__section-title"
                title="Compared with local refs; Fetch updates remote refs. Squash merges can retain different commit IDs."
              >
                Commits
                <select
                  class="git-review__select"
                  aria-label={`Commit view for ${label}`}
                  value={recent ? "recent" : "pending"}
                  onChange={(event) => {
                    commitView.value = event.currentTarget.value as "pending" | "recent";
                  }}
                >
                  <option value="pending" disabled={!data.target}>
                    Not in target{data.target ? ` (${data.ahead})` : ""}
                  </option>
                  <option value="recent">Recent commits</option>
                </select>
              </div>
              {!data.target && (
                <p class="git-review__message">
                  Choose a target branch to compare this repository.
                </p>
              )}
              {shownCommits.length === 0 ? (
                <p class="git-review__message">
                  {recent ? "No commits yet." : `No commits ahead of ${data.target}.`}
                </p>
              ) : (
                shownCommits.map((commit) => (
                  <CommitRow
                    key={commit.id}
                    root={root}
                    commit={commit}
                    target={data.target}
                    selected={props.selected}
                    onSelect={props.onSelect}
                  />
                ))
              )}
              {!recent && data.ahead > data.commits.length && (
                <p class="git-review__message">
                  Showing the latest {data.commits.length} of {data.ahead} commits.
                </p>
              )}
              {recent && data.historyLimited && (
                <p class="git-review__message">Showing the latest 100 commits.</p>
              )}
              {data.target && (
                <p class="git-review__message">
                  Compared by commit ancestry against local refs. Fetch updates remote refs. Squash
                  or rebase can leave different commit IDs after changes are merged.
                </p>
              )}
              {data.target && data.behind > 0 && (
                <p class="git-review__message">
                  {data.behind} commits behind {data.target}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
