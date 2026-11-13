/* oxlint-disable react-hooks/exhaustive-deps -- Signals are stable outputs; effects track the requested root and refresh version. */
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { discoverReview } from "../../host/git-review-host";
import type { ReviewDiscovery } from "../../lib/git-review";
import { ReviewRepositoryGroup } from "./review-repository";
import { ReviewDiffView, type ReviewSelection } from "./review-diff";
import "./source-control.css";
import { hiddenReviewRepositories, saveHiddenReviewRepositories } from "./review-store";

/** Mounted only in View code's Source control mode; Files starts no Git review reads. */
export function CodeSourceControl({ root }: { root: string }) {
  const discovery = useSignal<ReviewDiscovery | null>(null);
  const error = useSignal("");
  const scanning = useSignal(true);
  const version = useSignal(0);
  const diffVersion = useSignal(0);
  const selected = useSignal<ReviewSelection | null>(null);
  const hidden = useSignal<readonly string[]>([]);
  const preferencesReady = useSignal(false);
  useEffect(() => {
    let cancelled = false;
    void hiddenReviewRepositories(root)
      .then((paths) => {
        if (!cancelled) hidden.value = paths;
      })
      .catch((reason: unknown) => {
        if (!cancelled) error.value = String(reason);
      })
      .finally(() => {
        if (!cancelled) preferencesReady.value = true;
      });
    return () => {
      cancelled = true;
    };
  }, [root]);
  const saveHidden = (paths: readonly string[]) => {
    hidden.value = paths;
    void saveHiddenReviewRepositories(root, paths).catch((reason: unknown) => {
      error.value = `This choice is temporary: ${String(reason)}`;
    });
  };
  const repositories =
    discovery.value?.repositories.filter((repository) => !hidden.value.includes(repository.path)) ??
    [];
  useEffect(() => {
    let cancelled = false;
    scanning.value = true;
    error.value = "";
    void discoverReview(root)
      .then((value) => {
        if (!cancelled) {
          discovery.value = value;
          if (
            selected.peek() &&
            !value.repositories.some((repository) => repository.path === selected.peek()?.root)
          )
            selected.value = null;
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          error.value =
            reason instanceof Error
              ? reason.message
              : "Could not read repositories. Refresh to retry.";
      })
      .finally(() => {
        if (!cancelled) scanning.value = false;
      });
    return () => {
      cancelled = true;
    };
  }, [root, version.value]);
  return (
    <section class="git-review code-source-control" aria-label="Source control">
      <header class="git-review__tabs">
        <span>Changes and commits</span>
        {hidden.value.length > 0 && (
          <button type="button" class="btn" onClick={() => saveHidden([])}>
            Show hidden folders ({hidden.value.length})
          </button>
        )}
        <button
          type="button"
          class="btn git-review__rescan"
          disabled={scanning.value}
          onClick={() => {
            version.value += 1;
          }}
        >
          Refresh source control
        </button>
      </header>
      <div class="code-source-control__body">
        <aside class="code-source-control__list" aria-label="Repository changes and commits">
          {scanning.value && (
            <p class="git-review__message" role="status">
              Finding repositories…
            </p>
          )}
          {error.value && (
            <p class="git-review__message is-error" role="alert">
              {error.value}
            </p>
          )}
          {preferencesReady.value &&
            repositories.map((repository) => (
              <ReviewRepositoryGroup
                key={repository.path}
                repository={repository}
                refresh={version.value}
                selected={selected.value}
                onRemove={() => {
                  if (selected.value?.root === repository.path) selected.value = null;
                  saveHidden([...hidden.value, repository.path]);
                }}
                onRead={(repositoryRoot) => {
                  if (selected.peek()?.root === repositoryRoot && selected.peek()?.commit === null)
                    diffVersion.value += 1;
                }}
                onSelect={(value) => {
                  selected.value = value;
                }}
              />
            ))}
          {preferencesReady.value &&
            discovery.value &&
            discovery.value.repositories.length > 0 &&
            repositories.length === 0 && (
              <p class="git-review__message">
                All repositories are hidden. Use Show hidden folders to bring them back.
              </p>
            )}
          {discovery.value?.repositories.length === 0 && (
            <p class="git-review__message">
              No Git repositories found. Use Files to browse this folder, or refresh after creating
              a repository.
            </p>
          )}
          {discovery.value?.truncated && (
            <p class="git-review__message">
              Repository scan limit reached. Open a smaller folder to see more.
            </p>
          )}
        </aside>
        <div class="code-source-control__detail">
          {selected.value ? (
            <ReviewDiffView
              selection={selected.value}
              refresh={diffVersion.value}
              onBack={() => {
                selected.value = null;
              }}
              onSelect={(value) => {
                selected.value = value;
              }}
            />
          ) : (
            <div class="code-viewer__empty">
              <h2>Select a file to see its changes</h2>
              <p>Review working changes, or expand a commit to inspect its files.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
