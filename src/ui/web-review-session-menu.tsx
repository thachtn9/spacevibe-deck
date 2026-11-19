import { refreshWebReviewSessions } from "./web-review-publisher";
import { sameReviewTarget } from "../lib/web-review";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { Crosshair, Check } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "./controls/deck-icon";
import {
  useDismiss,
  useStageOverlayFlag,
  useSurfacePlacement,
  type AnchorRect,
} from "./worktree-card-menus";
import { webReviewHost } from "../host/web-review-host";
import { activeReviewTarget, reviewCandidates } from "./web-review-active";

export function WebReviewSessionMenu(props: { paneId: number; rect: AnchorRect; close(): void }) {
  const { ref, style, placed } = useSurfacePlacement(props.rect, "below");
  useDismiss(props.close, ref, null);
  useStageOverlayFlag();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active =
    activeReviewTarget.value?.paneId === props.paneId &&
    reviewCandidates.value.some(
      (c) =>
        c.paneId === props.paneId &&
        !!activeReviewTarget.value &&
        sameReviewTarget(c, activeReviewTarget.value),
    );
  const eligible = reviewCandidates.value.some((c) => c.paneId === props.paneId);
  useEffect(() => {
    void refreshWebReviewSessions?.();
  }, [props.paneId]);
  const element = ref.current;
  useEffect(() => {
    if (placed) element?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [placed, element]);
  return createPortal(
    <div
      ref={ref}
      style={style}
      class="toolbar-menu tab-strip-menu"
      role="menu"
      aria-label="Browser Review session"
      onKeyDown={(e) => {
        if (e.key === "Tab") props.close();
      }}
    >
      <div
        class="toolbar-menu__label"
        style={{ padding: "6px 12px", color: "var(--text-faint)", fontSize: "var(--type-micro)" }}
      >
        Browser Review
      </div>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={active}
        class="toolbar-menu__row"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void (async () => {
            await refreshWebReviewSessions?.();
            return webReviewHost.activate(active ? null : props.paneId);
          })()
            .then((target) => {
              activeReviewTarget.value = target;
              props.close();
            })
            .catch((e: unknown) =>
              setError(e instanceof Error ? e.message : "Could not activate this session."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <DeckIcon icon={Crosshair} size={CHROME_ICON} />
        <span class="toolbar-menu__label">
          {busy ? "Updating…" : active ? "Unset active agent" : "Set active agent"}
        </span>
        {active && <DeckIcon icon={Check} size={CHROME_ICON} />}
      </button>
      {!eligible && (
        <p role="status">
          Session identity is still being detected. Click Set active agent to refresh.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>,
    document.body,
  );
}
