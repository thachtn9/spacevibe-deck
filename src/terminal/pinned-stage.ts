import {
  dockNewPane,
  leaf,
  movePane,
  removeLeaf,
  setRatio,
  swapLeaves,
  type Edge,
  type TreeNode,
} from "../lib/split-tree";
import type { PaneRect } from "../lib/pane-geometry";
import { createLayoutEngine } from "./layout-engine";
import type { TerminalManager } from "./terminal-manager-types";
import {
  pinPosition,
  treeFromPinPlacements,
  wrapPinnedPane,
  setUnpinnedRatio,
  type PanePin,
} from "./pinned-pane-layout";
import { createPaneDragController } from "./pane-drag";

const WORKSPACE = -1;

/** Presentation only: the original managers retain panes, PTYs and close guards. */
export function createPinnedStage(
  host: HTMLElement,
  owner: (id: number) => TerminalManager | undefined,
  changed: () => void,
) {
  const workspace = document.createElement("div");
  workspace.className = "terminal-workspace";
  host.append(workspace);
  const pins = new Map<number, PanePin>();
  let nextOrder = 0;
  let disposed = false;
  let tree: TreeNode = leaf(WORKSPACE);
  let arranged = false;
  let focusedId: number | null = null;
  let workspaceVisible = true;
  const layout = createLayoutEngine(host, {
    getPaneElement: (id) =>
      id === WORKSPACE ? workspace : (owner(id)?.paneElement(id) ?? undefined),
    mountPane: (id) => {
      if (id !== WORKSPACE) owner(id)?.fitPane(id);
    },
    fitPane: (id) => {
      if (id !== WORKSPACE) owner(id)?.fitPane(id);
    },
    focusPane: (id) => {
      if (id !== WORKSPACE) owner(id)?.focusPane(id);
    },
  });

  function rebuild(): void {
    if (disposed) return;
    if (pins.size === 0) {
      workspace.style.display = "";
      host.replaceChildren(workspace);
      host.classList.remove("has-pinned-panes", "has-multiple-panes");
      return;
    }
    host.classList.add("has-pinned-panes");
    workspace.style.display = workspaceVisible ? "" : "none";
    const displayed = workspaceVisible ? tree : removeLeaf(tree, WORKSPACE)!;
    layout.sync({
      tree: displayed,
      activeId: focusedId,
      paneCount: pins.size + (workspaceVisible ? 1 : 0),
      focusExpand: false,
      onRatioCommit(path, ratio) {
        tree = workspaceVisible
          ? setRatio(tree, path, ratio)
          : setUnpinnedRatio(tree, new Set([WORKSPACE]), path, ratio);
        rememberPlacements();
        changed();
      },
    });
    // Keep hidden tab containers mounted while pins occupy the whole stage.
    if (!workspaceVisible) host.append(workspace);
    for (const [id] of pins) {
      owner(id)?.paneElement(id)?.parentElement?.classList.add("pinned-pane-slot");
    }
  }

  function placement(id: number): PanePin | undefined {
    const pin = pins.get(id);
    if (!pin) return undefined;
    const position = pinPosition(tree, id);
    const parent = position?.path[position.path.length - 1];
    return {
      edge: parent
        ? parent.direction === "row"
          ? parent.branch === "a"
            ? "left"
            : "right"
          : parent.branch === "a"
            ? "top"
            : "bottom"
        : pin.edge,
      order: pin.order,
      ratio: parent ? (parent.branch === "a" ? parent.ratio : 1 - parent.ratio) : pin.ratio,
      ...(arranged && position ? { position } : {}),
    };
  }

  function rememberPlacements(): void {
    for (const id of pins.keys()) pins.set(id, placement(id)!);
  }

  function slotRects(): PaneRect[] {
    return [...pins.keys()].flatMap((id) => {
      const element = owner(id)?.paneElement(id);
      if (!element?.isConnected) return [];
      const rect = element.getBoundingClientRect();
      return [{ id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    });
  }

  function dropRects(): PaneRect[] {
    const rects = slotRects();
    if (workspaceVisible || pins.size === 0) {
      const rect = workspace.getBoundingClientRect();
      rects.push({
        id: WORKSPACE,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    }
    return rects;
  }

  function rearrange(source: number, target: number, edge?: Edge): void {
    if (disposed || !pins.has(source) || (target !== WORKSPACE && !pins.has(target))) return;
    const next = edge ? movePane(tree, source, target, edge) : swapLeaves(tree, source, target);
    if (next === tree) return;
    tree = next;
    arranged = true;
    rememberPlacements();
    rebuild();
    owner(source)?.focusPane(source);
    changed();
  }

  const drag = createPaneDragController(host, {
    paneCount: () => pins.size + (workspaceVisible ? 1 : 0),
    paneIdForElement(element) {
      for (const id of pins.keys()) if (owner(id)?.paneElement(id)?.contains(element)) return id;
      return null;
    },
    slotRects: dropRects,
    ghostLabel: (id) =>
      owner(id)
        ?.paneElement(id)
        ?.querySelector(".pane-agent-header__message, .pane__cwd")
        ?.textContent?.trim() || "Pinned terminal",
    onMove: (source, target, edge) => rearrange(source, target, edge),
    onSwap: (source, target) => rearrange(source, target),
  });

  function pin(id: number, edge: Edge = "right", saved?: PanePin, targetId?: number): boolean {
    if (targetId !== undefined) {
      if (id === targetId || (targetId !== WORKSPACE && !pins.has(targetId))) return false;
      if (pins.has(id)) {
        rearrange(id, targetId, edge);
        return true;
      }
    }
    const manager = owner(id);
    if (!manager || !manager.setPanePinned(id, true)) return false;
    const placement = saved ?? { edge, order: nextOrder++, ratio: 0.35 };
    nextOrder = Math.max(nextOrder, placement.order + 1);
    pins.set(id, placement);
    if (saved) {
      arranged ||= saved.position !== undefined;
      tree = treeFromPinPlacements(pins, WORKSPACE);
    } else {
      const remaining = removeLeaf(tree, id) ?? leaf(WORKSPACE);
      tree =
        targetId === undefined
          ? wrapPinnedPane(remaining, id, placement)
          : dockNewPane(remaining, targetId, id, edge);
      arranged ||= targetId !== undefined;
      rememberPlacements();
    }
    rebuild();
    changed();
    return true;
  }

  function unpin(id: number): void {
    if (!pins.has(id)) return;
    pins.delete(id);
    tree = removeLeaf(tree, id) ?? leaf(WORKSPACE);
    rememberPlacements();
    owner(id)?.setPanePinned(id, false);
    rebuild();
    changed();
  }

  return {
    workspace,
    setWorkspaceVisible(visible: boolean) {
      const next = visible || pins.size === 0;
      if (workspaceVisible === next) return;
      workspaceVisible = next;
      rebuild();
    },
    pin,
    unpin,
    has: (id: number) => pins.has(id),
    placement,
    ids: () => [...pins.keys()],
    focused(id: number) {
      focusedId = pins.has(id) ? id : null;
      for (const key of pins.keys())
        owner(key)
          ?.paneElement(key)
          ?.parentElement?.classList.toggle("is-active", key === id);
    },
    prune() {
      let removed = false;
      for (const id of pins.keys())
        if (!owner(id)) {
          pins.delete(id);
          tree = removeLeaf(tree, id) ?? leaf(WORKSPACE);
          removed = true;
        }
      if (removed) {
        rememberPlacements();
        rebuild();
      }
    },
    dropRects,
    slotRects,
    dispose() {
      disposed = true;
      drag.dispose();
      pins.clear();
      workspace.remove();
      host.replaceChildren();
    },
  };
}
