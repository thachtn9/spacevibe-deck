import { TextEditorButton } from "../../files/text-editor-button";
import {
  ArrowsOut,
  ChatText,
  Gear,
  Globe,
  SquareSplitHorizontal,
  SquareSplitVertical,
  XSquare,
} from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { RETIRED_ACTIONS } from "../../terminal/action-registry";
import { shortcutLabel } from "../../lib/shortcut-label";
import { FeatureToolbar } from "./feature-toolbar";
import type { ToolbarItem, ToolbarItemState } from "./toolbar-item";
import { toolbarLabel } from "./toolbar-label";

/** Split and Focus expand stay on the strip; close lives on the focused pane. */

export { toolbarLabel };

/**
 * The toolbar's `Overview` button is HIDDEN for now (owner, 2026-10-04).
 * Mission Control itself stays: ⌘⇧O and View ▸ Mission Control still open it
 * (DL-35.1). `App` reads this flag and passes no `missionControl`, so the
 * component and its tests stand — restoring the button is flipping this one
 * constant, the revert seam the rail's old hidden-tools flag established.
 */
export const MISSION_CONTROL_BUTTON_HIDDEN = true;

const IDLE: ToolbarItemState = { kind: "idle" };
const ACTIVE: ToolbarItemState = { kind: "active" };

interface DeckToolbarProps {
  /**
   * Mission Control's entry on the bar (DL-35.1), in the place and treatment
   * the Agent Board's one button had (DL-34.1's view control) — the overview
   * you step into and back out of. It toggles either way, as ⌘⇧O does.
   */
  readonly missionControl?: {
    readonly open: boolean;
    onToggle(): void;
  };
  /** Top-tab mode exposes global tools directly because it has no rail. */
  readonly compact?: boolean;
  /** The rail owns the global tools and the Prompt Board popover when mounted. */
  readonly railToolsMounted?: boolean;
  /** The browser surface holds the stage — the chip may be open without it. */
  readonly browserActive: boolean;
  readonly settingsOpen: boolean;
  readonly expandActive: boolean;
  readonly promptsOpen: boolean;
  /** Why Prompts cannot run right now, or null when it can (spec §3/§4). */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the Prompts control's slot while open. */
  readonly promptPopover?: ComponentChildren;
  readonly updateAction?: ComponentChildren;
  /** Retained for callers; the shipping toolbar omits Open in (DL-23.11). */
  readonly externalApp?: ComponentChildren;
  /**
   * The needs-you chip (DL-27.26, amended 2026-10-06), built by `App` because
   * the focus it triggers runs the app's attention preflight. Projected in as a
   * node, like `externalApp`: it owns its own count, colour and popover.
   */
  readonly attention?: ComponentChildren;
  /**
   * The dev servers chip (DL-36.1), built by `App` for the same reason: it
   * owns its own count, dot and popover, and its Open in Deck needs the app's
   * stage rule. Absent where the host cannot discover servers.
   */
  readonly devServers?: ComponentChildren;
  onToggleBrowser(): void;
  onSplitRow(): void;
  onSplitColumn(): void;
  onToggleExpand(): void;
  onClosePane(): void;
  onTogglePrompts(): void;
  onToggleSettings(): void;
}

export function DeckToolbar(props: DeckToolbarProps) {
  // Null overflow priority keeps these controls directly available at every width.
  const paneItems: ToolbarItem[] = [
    {
      id: "split-row",
      label: toolbarLabel("split-row"),
      icon: SquareSplitHorizontal,
      group: "pane",
      shortcut: shortcutLabel("split-row"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onSplitRow,
    },
    {
      id: "split-column",
      label: toolbarLabel("split-column"),
      icon: SquareSplitVertical,
      group: "pane",
      shortcut: shortcutLabel("split-column"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onSplitColumn,
    },
    {
      id: "toggle-expand",
      label: toolbarLabel("toggle-expand"),
      icon: ArrowsOut,
      group: "pane",
      shortcut: shortcutLabel("toggle-expand"),
      state: props.expandActive ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: props.onToggleExpand,
    },
    {
      id: "close-pane",
      label: toolbarLabel("close-pane"),
      icon: XSquare,
      group: "pane",
      shortcut: shortcutLabel("close-pane"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onClosePane,
    },
  ];

  // The rail holds global tools when mounted; otherwise they appear directly on the bar.
  const globalOnBar = props.compact === true || props.railToolsMounted !== true;

  const globalItems: ToolbarItem[] = [
    {
      id: "toggle-browser",
      label: toolbarLabel("toggle-browser"),
      icon: Globe,
      group: "global",
      shortcut: shortcutLabel("toggle-browser"),
      state: props.browserActive ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: props.onToggleBrowser,
    },
    {
      id: "toggle-prompts",
      label: toolbarLabel("toggle-prompts"),
      icon: ChatText,
      group: "global",
      shortcut: shortcutLabel("toggle-prompts"),
      state:
        props.promptsUnavailable !== null
          ? { kind: "unavailable", reason: props.promptsUnavailable }
          : props.promptsOpen
            ? ACTIVE
            : IDLE,
      overflowOrder: null,
      toggles: "dialog",
      anchored: props.promptsOpen ? props.promptPopover : undefined,
      onActivate: props.onTogglePrompts,
    },
    {
      id: "toggle-settings",
      label: toolbarLabel("toggle-settings"),
      icon: Gear,
      group: "global",
      shortcut: shortcutLabel("toggle-settings"),
      state: props.settingsOpen ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      controlClass: "iconbtn--gear",
      onActivate: props.onToggleSettings,
    },
  ];

  return (
    <>
      {props.missionControl ? (
        <div class="agent-view-switch" role="group" aria-label="Agent view">
          {/* One item. A press fires even while pressed: it is the way out of
              Mission Control as well as the way in. */}
          <button
            type="button"
            class={`tab agent-view-switch__tab ${props.missionControl.open ? "is-active" : ""}`}
            aria-pressed={props.missionControl.open}
            title="Mission Control"
            onClick={() => props.missionControl?.onToggle()}
          >
            Overview
          </button>
        </div>
      ) : null}
      <TextEditorButton />
      <FeatureToolbar
        items={[
          ...paneItems.filter((item) => item.id !== "close-pane"),
          ...(globalOnBar ? globalItems.filter((item) => !RETIRED_ACTIONS.has(item.id)) : []),
        ]}
        attention={props.attention}
        devServers={props.devServers}
        updateAction={props.updateAction}
      />
    </>
  );
}
