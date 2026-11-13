import { PushPin } from "@phosphor-icons/react";
import { tabViews } from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";

export function RailPanePin({ id }: { id: number | undefined }) {
  const pinned = tabViews.value.some((tab) =>
    tab.panes?.some((pane) => pane.paneId === id && pane.pinned),
  );
  return pinned ? (
    <span class="asr-card__pin" title="Pinned terminal" aria-label="Pinned terminal">
      <DeckIcon icon={PushPin} size={CHROME_ICON} />
    </span>
  ) : null;
}
