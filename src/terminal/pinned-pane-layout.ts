import {
  leaf,
  leafIds,
  type Branch,
  type Direction,
  type Edge,
  type Path,
  type TreeNode,
} from "../lib/split-tree";

interface PinStep {
  readonly branch: Branch;
  readonly direction: Direction;
  readonly ratio: number;
}

export interface PinPosition {
  readonly path: readonly PinStep[];
  readonly workspace: Path;
}

export interface PanePin {
  readonly edge: Edge;
  readonly order: number;
  /** Fraction of the enclosing split reserved for this pinned pane. */
  readonly ratio: number;
  /** Split paths survive PTY id changes and restore tabs in any order. */
  readonly position?: PinPosition;
}

function validatePinPosition(raw: unknown): PinPosition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.path) ||
    !value.path.length ||
    value.path.length > 32 ||
    !Array.isArray(value.workspace) ||
    !value.workspace.length ||
    value.workspace.length > 32 ||
    !value.workspace.every((branch) => branch === "a" || branch === "b")
  )
    return undefined;
  const path: PinStep[] = [];
  for (const item of value.path) {
    if (!item || typeof item !== "object") return undefined;
    const step = item as Record<string, unknown>;
    if (
      (step.branch !== "a" && step.branch !== "b") ||
      (step.direction !== "row" && step.direction !== "column") ||
      typeof step.ratio !== "number" ||
      !Number.isFinite(step.ratio)
    )
      return undefined;
    path.push({
      branch: step.branch,
      direction: step.direction,
      ratio: Math.min(0.85, Math.max(0.15, step.ratio)),
    });
  }
  return { path, workspace: value.workspace as Branch[] };
}

export function validatePanePin(raw: unknown): PanePin | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pin = raw as Record<string, unknown>;
  if (
    typeof pin.edge !== "string" ||
    !["left", "right", "top", "bottom"].includes(pin.edge) ||
    !Number.isSafeInteger(pin.order) ||
    Number(pin.order) < 0 ||
    typeof pin.ratio !== "number" ||
    !Number.isFinite(pin.ratio)
  )
    return undefined;
  const position = validatePinPosition(pin.position);
  return {
    edge: pin.edge as Edge,
    order: Number(pin.order),
    ratio: Math.min(0.85, Math.max(0.15, pin.ratio)),
    ...(position ? { position } : {}),
  };
}

export function wrapPinnedPane(tree: TreeNode, id: number, pin: PanePin): TreeNode {
  const first = pin.edge === "left" || pin.edge === "top";
  return {
    kind: "split",
    dir: pin.edge === "left" || pin.edge === "right" ? "row" : "column",
    ratio: first ? pin.ratio : 1 - pin.ratio,
    a: first ? leaf(id) : tree,
    b: first ? tree : leaf(id),
  };
}

function pathFor(tree: TreeNode, id: number): PinStep[] | null {
  if (tree.kind === "leaf") return tree.paneId === id ? [] : null;
  for (const branch of ["a", "b"] as const) {
    const rest = pathFor(tree[branch], id);
    if (rest) return [{ branch, direction: tree.dir, ratio: tree.ratio }, ...rest];
  }
  return null;
}

export function pinPosition(tree: TreeNode, id: number, workspaceId = -1): PinPosition | undefined {
  const path = pathFor(tree, id);
  const workspace = pathFor(tree, workspaceId);
  return path && workspace ? { path, workspace: workspace.map((step) => step.branch) } : undefined;
}

/** Reconstruct a global split tree without persisting process-specific pane ids. */
export function treeFromPinPlacements(
  pins: ReadonlyMap<number, PanePin>,
  workspaceId = -1,
): TreeNode {
  const entries = [...pins];
  const fallback = () =>
    entries
      .sort((a, b) => a[1].order - b[1].order)
      .reduce((tree, [id, pin]) => wrapPinnedPane(tree, id, pin), leaf(workspaceId) as TreeNode);
  if (!entries.length || entries.some(([, pin]) => !pin.position)) return fallback();
  const workspace = entries[0][1].position!.workspace;
  if (entries.some(([, pin]) => pin.position!.workspace.join("") !== workspace.join("")))
    return fallback();
  const items = entries.map(([id, pin]) => ({
    id,
    branches: pin.position!.path.map((step) => step.branch),
    steps: pin.position!.path,
  }));
  items.push({ id: workspaceId, branches: [...workspace], steps: [] });
  let invalid = false;
  function build(group: typeof items, depth: number): TreeNode | null {
    if (!group.length) return null;
    const exact = group.find((item) => item.branches.length === depth);
    if (exact) {
      if (group.length !== 1) invalid = true;
      return leaf(exact.id);
    }
    const a = build(
      group.filter((item) => item.branches[depth] === "a"),
      depth + 1,
    );
    const b = build(
      group.filter((item) => item.branches[depth] === "b"),
      depth + 1,
    );
    if (!a || !b) return a ?? b;
    const step = group.find((item) => item.steps[depth])?.steps[depth];
    if (!step) {
      invalid = true;
      return a;
    }
    if (
      group.some(
        (item) =>
          item.steps[depth] &&
          (item.steps[depth].direction !== step.direction ||
            item.steps[depth].ratio !== step.ratio),
      )
    )
      invalid = true;
    return { kind: "split", dir: step.direction, ratio: step.ratio, a, b };
  }
  const restored = build(items, 0);
  return !invalid && restored && leafIds(restored).length === pins.size + 1 ? restored : fallback();
}

/** Hide pinned leaves without changing the tab's identity or serialized tree. */
export function unpinnedTree(tree: TreeNode | null, pinned: ReadonlySet<number>): TreeNode | null {
  if (!tree) return null;
  if (tree.kind === "leaf") return pinned.has(tree.paneId) ? null : tree;
  const a = unpinnedTree(tree.a, pinned);
  const b = unpinnedTree(tree.b, pinned);
  return a && b ? { ...tree, a, b } : (a ?? b);
}

/** Resolve a visible divider through collapsed branches into the original tree. */
export function setUnpinnedRatio(
  tree: TreeNode,
  pinned: ReadonlySet<number>,
  path: Path,
  ratio: number,
): TreeNode {
  if (tree.kind === "leaf") return tree;
  const a = unpinnedTree(tree.a, pinned);
  const b = unpinnedTree(tree.b, pinned);
  if (!a) return { ...tree, b: setUnpinnedRatio(tree.b, pinned, path, ratio) };
  if (!b) return { ...tree, a: setUnpinnedRatio(tree.a, pinned, path, ratio) };
  if (path.length === 0) return { ...tree, ratio };
  const branch = path[0];
  return { ...tree, [branch]: setUnpinnedRatio(tree[branch], pinned, path.slice(1), ratio) };
}
