/* oxlint-disable react-hooks/exhaustive-deps -- useSignal stores are stable; effects depend on their inputs, not the state they publish. */
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ArrowLeft } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { readReviewDiff } from "../../host/git-review-host";
import type { ReviewDiff } from "../../lib/git-review";

export interface ReviewSelection {
  readonly root: string;
  readonly commit: string | null;
  readonly path: string;
  readonly title: string;
}
export function ReviewDiffView(props: {
  readonly selection: ReviewSelection;
  readonly refresh?: number;
  onBack(): void;
  onSelect(selection: ReviewSelection): void;
}) {
  const result = useSignal<ReviewDiff | null>(null);
  const error = useSignal<string | null>(null);
  const { root, commit, path, title } = props.selection;
  useEffect(() => {
    let cancelled = false;
    result.value = null;
    error.value = null;
    void readReviewDiff(root, commit, path)
      .then((value) => {
        if (!cancelled) result.value = value;
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          error.value =
            reason instanceof Error
              ? reason.message
              : "Could not read this diff. Go back and refresh.";
      });
    return () => {
      cancelled = true;
    };
  }, [root, commit, path, props.refresh]);
  return (
    <section class="git-review-diff" aria-label="Git diff">
      <header class="git-review-diff__header">
        <button
          type="button"
          class="git-review__icon"
          aria-label="Back to changes"
          onClick={props.onBack}
        >
          <DeckIcon icon={ArrowLeft} size={ROW_ICON} />
        </button>
        <div class="git-review-diff__identity">
          <strong title={title}>{title}</strong>
          <span title={path}>{path}</span>
        </div>
      </header>
      {(result.value?.files.length ?? 0) > 1 && (
        <select
          class="git-review__select"
          aria-label="Changed file"
          value={path}
          onChange={(event) =>
            props.onSelect({ ...props.selection, path: event.currentTarget.value })
          }
        >
          {result.value!.files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
      )}
      {error.value && (
        <p class="git-review__message is-error" role="alert">
          {error.value}
        </p>
      )}
      {!result.value && !error.value && (
        <p class="git-review__message" role="status">
          Reading diff…
        </p>
      )}
      {result.value && (
        <>
          {result.value.truncated && (
            <p class="git-review__message">Showing a limited preview of this large diff.</p>
          )}
          {result.value.patch ? (
            <pre
              class="git-review-diff__patch"
              data-native-shortcuts=""
              tabIndex={0}
              aria-label={`Diff for ${path}`}
            >
              {result.value.patch.split("\n").map((line, index) => (
                <span
                  key={index}
                  class={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "is-added"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "is-removed"
                        : line.startsWith("@@")
                          ? "is-hunk"
                          : undefined
                  }
                >
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : (
            <p class="git-review__message">
              No diff remains for this file. Go back and refresh the list.
            </p>
          )}
        </>
      )}
    </section>
  );
}
