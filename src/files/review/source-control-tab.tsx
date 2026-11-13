/* oxlint-disable react-hooks/exhaustive-deps -- useSignal stores are stable; effects depend on their inputs, not the state they publish. */
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ArrowClockwise } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { discoverReview } from "../../host/git-review-host";
import type { ReviewDiscovery } from "../../lib/git-review";
import { ExplorerTab, type ExplorerTabProps } from "../ui/explorer-tab";
import { ReviewRepositoryGroup } from "./review-repository";
import { ReviewDiffView, type ReviewSelection } from "./review-diff";
import { sourceControlView } from "./review-store";
import { installTurnEndWatch } from "../changes/turn-end";
import "./source-control.css";

export function SourceControlTab(props: ExplorerTabProps) {
  const { workspacePath } = props;
  const discovery = useSignal<ReviewDiscovery | null>(null);
  const error = useSignal<string | null>(null);
  const scanning = useSignal(false);
  const scanVersion = useSignal(0);
  const refreshVersion = useSignal(0);
  const selected = useSignal<ReviewSelection | null>(null);
  const view = sourceControlView.value;
  useEffect(() => {
    if (!workspacePath || view !== "changes") return;
    let cancelled = false;
    scanning.value = true;
    error.value = null;
    void discoverReview(workspacePath)
      .then((value) => {
        if (!cancelled) discovery.value = value;
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          error.value =
            reason instanceof Error
              ? reason.message
              : "Could not scan this folder. Refresh to retry.";
      })
      .finally(() => {
        if (!cancelled) scanning.value = false;
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, view, scanVersion.value]);
  useEffect(() => {
    if (!workspacePath || view !== "changes") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = installTurnEndWatch((root) => {
      if (root !== workspacePath && !root.startsWith(`${workspacePath.replace(/\/$/, "")}/`))
        return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshVersion.value += 1;
      }, 1000);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [workspacePath, view]);
  return (
    <div class="git-review">
      <div
        class="git-review__tabs"
        role="tablist"
        aria-label="Project view"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = event.key === "ArrowLeft" ? "changes" : "files";
          sourceControlView.value = next;
          event.currentTarget
            .querySelector<HTMLButtonElement>(`[data-review-view="${next}"]`)
            ?.focus();
        }}
      >
        {(
          [
            ["changes", "Changes & commits"],
            ["files", "Files"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            class={`explorer-switch__chip${view === id ? " is-active" : ""}`}
            data-review-view={id}
            aria-selected={view === id}
            tabIndex={view === id ? 0 : -1}
            onClick={() => {
              sourceControlView.value = id;
            }}
          >
            {label}
          </button>
        ))}
        {view === "changes" && (
          <button
            type="button"
            class="git-review__icon git-review__rescan"
            aria-label="Refresh repositories"
            title="Find repositories and refresh changes"
            disabled={scanning.value}
            onClick={() => {
              scanVersion.value += 1;
              refreshVersion.value += 1;
            }}
          >
            <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
          </button>
        )}
      </div>
      {view === "files" ? (
        <ExplorerTab {...props} changesAvailable={false} />
      ) : !workspacePath ? (
        <p class="git-review__message">Open a project folder to review its changes and commits.</p>
      ) : (
        <>
          <div class="git-review__repositories" hidden={selected.value !== null}>
            {scanning.value && !discovery.value && (
              <p class="git-review__message" role="status">
                Finding Git repositories…
              </p>
            )}
            {error.value && (
              <p class="git-review__message is-error" role="alert">
                {error.value}
              </p>
            )}
            {discovery.value?.repositories.length === 0 && (
              <p class="git-review__message">
                No Git repositories found in this folder. Refresh after creating or cloning one.
              </p>
            )}
            {discovery.value?.repositories.map((repository) => (
              <ReviewRepositoryGroup
                key={repository.path}
                repository={repository}
                refresh={refreshVersion.value}
                onSelect={(selection) => {
                  selected.value = selection;
                }}
              />
            ))}
            {discovery.value?.truncated && (
              <p class="git-review__message">
                Scan limited to 40 repositories and 6 folder levels. Open a smaller folder to see
                more.
              </p>
            )}
          </div>
          {selected.value && (
            <ReviewDiffView
              selection={selected.value}
              onBack={() => {
                selected.value = null;
              }}
              onSelect={(selection) => {
                selected.value = selection;
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
