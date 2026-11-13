import { ClockCounterClockwise, Gauge } from "@phosphor-icons/react";
import type { DeckIconComponent } from "../controls/deck-icon";
import type { ActionId } from "../../terminal/action-registry";
import type { DockTab } from "../../settings/settings-schema";

/**
 * The surfaces the docked side panel can host. Order of `DOCK_TABS`
 * below is display order everywhere a caller iterates it.
 *
 * An alias, not a second declaration: the union is owned by
 * `settings-schema.ts` because it is a PERSISTED value, and two independent
 * spellings of one storage contract is how they drift apart.
 */
export type DockTabId = DockTab;

export interface DockTabDescriptor {
  readonly id: DockTabId;
  readonly label: string;
  readonly icon: DeckIconComponent;
  /**
   * The action whose chord the chip's tooltip prints (DL-23.1). It is the
   * REGISTRY id, not a literal chord, so a rebind reaches the tooltip and a
   * platform never sees the other one's notation — `shortcutLabel` resolves
   * both. Each visible tab has an action whose chord can resolve here.
   */
  readonly action: ActionId;
}

/** Visible dock surfaces; the persisted explorer id remains readable for old settings. */
export const DOCK_TABS: readonly DockTabDescriptor[] = Object.freeze([
  { id: "usage", label: "Quota", icon: Gauge, action: "toggle-usage" },
  {
    id: "sessions",
    label: "Session history",
    icon: ClockCounterClockwise,
    action: "toggle-sessions",
  },
]);

/**
 * Drops the sessions tab entirely when the host cannot answer
 * `sessions_list`. `deck-toolbar.tsx`'s own `toggle-sessions` control follows
 * the same precedent: a control that opens an empty surface is worse than no
 * control, so the tab is omitted rather than shown disabled.
 */
export function availableDockTabs(sessionsAvailable: boolean): readonly DockTabDescriptor[] {
  return sessionsAvailable ? DOCK_TABS : DOCK_TABS.filter((tab) => tab.id !== "sessions");
}

/** Retired or unsupported selections fall back to the always-available quota view. */
export function resolveDockTab(requested: DockTabId, sessionsAvailable: boolean): DockTabId {
  const available = availableDockTabs(sessionsAvailable);
  return available.some((tab) => tab.id === requested) ? requested : "usage";
}
