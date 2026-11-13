import { ChatText, Gauge, Gear, Globe, SquaresFour } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { shortcutLabel } from "../lib/shortcut-label";
import { RETIRED_ACTIONS, type ActionId } from "../terminal/action-registry";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "./controls/action-tooltip";
import { DeckIcon, RAIL_ICON, type DeckIconComponent } from "./controls/deck-icon";
import { RailToolsMenu } from "./rail-tools-menu";
import { isUnavailable, unavailableReason, type ToolbarItem } from "./toolbar/toolbar-item";
import { toolbarLabel } from "./toolbar/toolbar-label";

/** The left quota toggle and Settings are independent of the right dock. */
export interface SidebarActionsProps {
  /** Retained caller contract; Session history now lives only in the right dock. */
  readonly sessionsAvailable: boolean;
  /** Why Prompts cannot run right now, or null when it can. */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the row's slot while the popover is open. */
  readonly promptPopover?: ComponentChildren;
  /** Only so the popover mounts in this row's slot — never painted as state. */
  readonly promptsOpen: boolean;
  /**
   * The rail is the avatar column (DL-27.29): one `Tools` button opens the
   * icons as a popover (DL-28.6). Electron only, like the row itself.
   */
  readonly collapsed?: boolean;
  readonly quotaOpen?: boolean;
  onOpenSessions(): void;
  onOpenUsage(): void;
  onOpenExplorer(): void;
  onOpenPrompts(): void;
  onOpenBrowser(): void;
  onOpenSettings(): void;
}

function toolItem(
  id: ActionId,
  icon: DeckIconComponent,
  onActivate: () => void,
  extra: Partial<ToolbarItem> = {},
): ToolbarItem {
  return {
    id,
    label: toolbarLabel(id),
    icon,
    group: "tools",
    shortcut: shortcutLabel(id),
    state: { kind: "idle" },
    overflowOrder: null,
    onActivate,
    ...extra,
  };
}

export function railToolItems(props: SidebarActionsProps): readonly ToolbarItem[] {
  const prompts = toolItem("toggle-prompts", ChatText, props.onOpenPrompts, {
    // DL-23.6: unavailable is not disabled — the control keeps its place in the
    // tab order, reads faint and carries the reason, which the tooltip prints.
    state:
      props.promptsUnavailable === null
        ? { kind: "idle" }
        : { kind: "unavailable", reason: props.promptsUnavailable },
    // `aria-haspopup` without `aria-expanded`: it opens the popover but never
    // reports or reverses its state, so claiming to be expanded would promise a
    // control it does not offer.
    toggles: "dialog",
  });
  return [
    toolItem("toggle-usage", Gauge, props.onOpenUsage, {
      shortcut: null,
      toggles: "pressed",
      state: { kind: props.quotaOpen ? "active" : "idle" },
    }),
    prompts,
    toolItem("toggle-browser", Globe, props.onOpenBrowser),
    toolItem("toggle-settings", Gear, props.onOpenSettings),
  ].filter((item) => !RETIRED_ACTIONS.has(item.id));
}

interface ToolButtonProps {
  readonly item: ToolbarItem;
  /** The Prompt Board popover flies up from the row, over where any tooltip would open. */
  readonly tooltipSuppressed: boolean;
}

/** One icon and its tooltip — a component because the tooltip is a hook per control. */
function ToolButton({ item, tooltipSuppressed }: ToolButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility("above");
  const reason = unavailableReason(item);
  const tooltipId = `rail-tool-tip-${item.id}`;
  const showTooltip = tooltip.anchor !== null && !tooltipSuppressed;

  return (
    <>
      <button
        ref={ref}
        type="button"
        class={`iconbtn sidebar-actions__tool ${reason !== null ? "is-unavailable" : ""}`}
        aria-pressed={item.toggles === "pressed" ? item.state.kind === "active" : undefined}
        aria-label={item.label}
        aria-haspopup={item.toggles === "dialog" ? "dialog" : undefined}
        aria-disabled={reason !== null ? true : undefined}
        aria-describedby={showTooltip ? tooltipId : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={() => {
          if (isUnavailable(item)) {
            return;
          }
          item.onActivate();
        }}
      >
        <DeckIcon icon={item.icon} size={RAIL_ICON} />
      </button>
      {showTooltip && tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={item.label}
          shortcut={item.shortcut}
          reason={reason}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

interface OpenToolsMenu {
  readonly trigger: HTMLButtonElement;
  readonly rect: DOMRect;
}

/**
 * Collapsed, the tools give way to one grid button at the column's foot
 * (DL-28.6) that opens the same tools as rows of a popover. It carries a native
 * `title` like the column's avatars: a tooltip centred above a 36px column
 * would hang far from its button, and the name is all it would say.
 */
function CollapsedTools(props: SidebarActionsProps) {
  const [open, setOpen] = useState<OpenToolsMenu | null>(null);
  const close = (restoreFocus: boolean): void => {
    const trigger = open?.trigger;
    setOpen(null);
    if (restoreFocus) {
      trigger?.focus();
    }
  };

  return (
    <nav class="sidebar-actions sidebar-actions--collapsed" aria-label="Tools">
      {/* Also the Prompt Board's anchor while the rail is collapsed. */}
      <div class="sidebar-actions__slot">
        <button
          type="button"
          class="iconbtn sidebar-actions__tool"
          aria-label="Tools"
          title="Tools"
          aria-haspopup="menu"
          aria-expanded={open !== null}
          onClick={(event) => {
            if (open !== null) {
              close(false);
              return;
            }
            const trigger = event.currentTarget;
            setOpen({ trigger, rect: trigger.getBoundingClientRect() });
          }}
        >
          <DeckIcon icon={SquaresFour} size={RAIL_ICON} />
        </button>
        {open !== null && (
          <RailToolsMenu
            items={railToolItems(props)}
            rect={open.rect}
            trigger={open.trigger}
            onClose={close}
          />
        )}
        {!RETIRED_ACTIONS.has("toggle-prompts") && props.promptsOpen ? props.promptPopover : null}
      </div>
    </nav>
  );
}

export function SidebarActions(props: SidebarActionsProps) {
  if (props.collapsed === true) {
    return <CollapsedTools {...props} />;
  }
  return (
    <nav class="sidebar-actions" aria-label="Tools">
      {/* The positioning context for the Prompt Board popover, which opens from
          the row rather than from a toolbar slot in this layout. */}
      <div class="sidebar-actions__slot">
        <div class="sidebar-actions__tools">
          {railToolItems(props).map((item) => (
            <ToolButton
              key={item.id}
              item={item}
              tooltipSuppressed={!RETIRED_ACTIONS.has("toggle-prompts") && props.promptsOpen}
            />
          ))}
        </div>
        {!RETIRED_ACTIONS.has("toggle-prompts") && props.promptsOpen ? props.promptPopover : null}
      </div>
    </nav>
  );
}
