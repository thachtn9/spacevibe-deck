import { describe, expect, it } from "vitest";
import { leaf, type TreeNode } from "../lib/split-tree";
import {
  pinPosition,
  treeFromPinPlacements,
  setUnpinnedRatio,
  unpinnedTree,
  validatePanePin,
} from "./pinned-pane-layout";

describe("pinned pane layout", () => {
  const tree: TreeNode = {
    kind: "split",
    dir: "row",
    ratio: 0.4,
    a: leaf(1),
    b: { kind: "split", dir: "column", ratio: 0.6, a: leaf(2), b: leaf(3) },
  };

  it("collapses pinned leaves without changing the original layout", () => {
    expect(unpinnedTree(tree, new Set([1]))).toEqual(tree.kind === "split" ? tree.b : null);
    expect(unpinnedTree(tree, new Set([1, 2, 3]))).toBeNull();
    expect(unpinnedTree(tree, new Set())).toEqual(tree);
  });

  it("commits a visible divider through a collapsed branch", () => {
    const next = setUnpinnedRatio(tree, new Set([1]), [], 0.75);
    expect(next).toMatchObject({ ratio: 0.4, b: { ratio: 0.75 } });
    expect(tree).toMatchObject({ ratio: 0.4, b: { ratio: 0.6 } });
  });

  it("rejects corrupt placements and bounds saved ratios", () => {
    expect(validatePanePin({ edge: "diagonal", order: 0, ratio: 0.5 })).toBeUndefined();
    expect(validatePanePin({ edge: "right", order: -1, ratio: 0.5 })).toBeUndefined();
    expect(validatePanePin({ edge: "right", order: 1, ratio: Infinity })).toBeUndefined();
    expect(validatePanePin({ edge: "right", order: 1, ratio: 4 })).toEqual({
      edge: "right",
      order: 1,
      ratio: 0.85,
    });
  });

  it("restores nested arrangements with new pane ids and reversed tab restore order", () => {
    const arranged: TreeNode = {
      kind: "split",
      dir: "row",
      ratio: 0.6,
      a: leaf(-1),
      b: { kind: "split", dir: "column", ratio: 0.3, a: leaf(1), b: leaf(2) },
    };
    const saved = (id: number, order: number) =>
      validatePanePin({
        edge: "right",
        ratio: 0.35,
        order,
        position: pinPosition(arranged, id),
      })!;
    const restored = treeFromPinPlacements(
      new Map([
        [102, saved(2, 1)],
        [101, saved(1, 0)],
      ]),
    );
    expect(restored).toEqual({
      ...arranged,
      b: { kind: "split", dir: "column", ratio: 0.3, a: leaf(101), b: leaf(102) },
    });
    expect(treeFromPinPlacements(new Map([[102, saved(2, 1)]]))).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.6,
      a: leaf(-1),
      b: leaf(102),
    });
  });

  it("drops malformed positions and keeps every pin when saved paths conflict", () => {
    const base = { edge: "right", ratio: 0.35, order: 0 };
    expect(
      validatePanePin({ ...base, position: { path: [{ branch: "x" }], workspace: ["a"] } }),
    ).toEqual(base);
    const position = { path: [{ branch: "b", direction: "row", ratio: 0.65 }], workspace: ["a"] };
    const first = validatePanePin({ ...base, position })!;
    const second = validatePanePin({ ...base, order: 1, position })!;
    const restored = treeFromPinPlacements(
      new Map([
        [1, first],
        [2, second],
      ]),
    );
    expect(restored).toMatchObject({
      kind: "split",
      b: leaf(2),
      a: { kind: "split", b: leaf(1), a: leaf(-1) },
    });
  });
});
