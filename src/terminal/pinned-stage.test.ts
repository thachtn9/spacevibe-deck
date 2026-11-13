// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinnedStage } from "./pinned-stage";
import { treeFromPinPlacements } from "./pinned-pane-layout";
import { leaf } from "../lib/split-tree";
import type { TerminalManager } from "./terminal-manager-types";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";

beforeEach(() => {
  document.body.replaceChildren();
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "linux", homeDir: "/home/test" });
});
afterEach(() => resetDesktopEnvironmentForTests());

function pointer(target: EventTarget, type: string, x: number, y: number, ctrlKey = false) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ctrlKey });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

function setup() {
  const host = document.createElement("div");
  document.body.append(host);
  const elements = new Map<number, HTMLElement>();
  const manager = {
    setPanePinned: vi.fn(() => true),
    paneElement: (id: number) => elements.get(id) ?? null,
    fitPane: vi.fn(),
    focusPane: vi.fn(() => true),
  } as unknown as TerminalManager;
  const changed = vi.fn();
  const stage = createPinnedStage(host, () => manager, changed);
  const rect = (left: number, right: number) => ({
    left,
    right,
    top: 0,
    bottom: 400,
    width: right - left,
    height: 400,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  stage.workspace.getBoundingClientRect = () => rect(0, 400);
  for (const id of [1, 2, 3]) {
    const pane = document.createElement("div");
    pane.className = "pane";
    const bar = document.createElement("div");
    bar.className = "pane__bar";
    bar.textContent = `Pinned ${id}`;
    pane.append(bar);
    elements.set(id, pane);
    pane.getBoundingClientRect = () => rect(id === 1 ? 400 : 600, id === 1 ? 600 : 800);
    if (id !== 3) stage.pin(id);
  }
  const snapshot = () =>
    treeFromPinPlacements(new Map(stage.ids().map((id) => [id, stage.placement(id)!])));
  return { stage, host, elements, manager, changed, snapshot };
}

describe("pinned terminal dragging", () => {
  it.each(["left", "right", "top", "bottom"] as const)(
    "pins a new terminal at the %s edge of one existing pin",
    (edge) => {
      const { stage, elements, snapshot } = setup();
      try {
        const target = elements.get(1);
        const other = elements.get(2);
        expect(stage.dropRects().map((rect) => rect.id)).toEqual([1, 2, -1]);
        expect(stage.pin(3, edge, undefined, 1)).toBe(true);
        const first = edge === "left" || edge === "top";
        expect(snapshot()).toEqual({
          kind: "split",
          dir: "row",
          ratio: 0.65,
          a: {
            kind: "split",
            dir: "row",
            ratio: 0.65,
            a: leaf(-1),
            b: {
              kind: "split",
              dir: edge === "left" || edge === "right" ? "row" : "column",
              ratio: 0.5,
              a: leaf(first ? 3 : 1),
              b: leaf(first ? 1 : 3),
            },
          },
          b: leaf(2),
        });
        expect(elements.get(1)).toBe(target);
        expect(elements.get(2)).toBe(other);
        stage.setWorkspaceVisible(false);
        expect(stage.dropRects().map((rect) => rect.id)).toEqual([1, 2, 3]);
      } finally {
        stage.dispose();
      }
    },
  );

  it("repositions a pin from the tree without pinning it again or accepting itself as a target", () => {
    const { stage, manager, snapshot } = setup();
    try {
      stage.setWorkspaceVisible(false);
      const original = snapshot();
      expect(stage.pin(1, "top", undefined, 1)).toBe(false);
      expect(snapshot()).toEqual(original);
      expect(stage.pin(2, "top", undefined, 1)).toBe(true);
      expect(snapshot()).toMatchObject({
        a: leaf(-1),
        b: { dir: "column", ratio: 0.5, a: leaf(2), b: leaf(1) },
      });
      expect(stage.ids()).toEqual([1, 2]);
      expect(manager.setPanePinned).toHaveBeenCalledTimes(2);
    } finally {
      stage.dispose();
    }
  });

  it("docks a pinned header beside another pin and journals the nested layout", () => {
    const { stage, elements, snapshot, manager } = setup();
    try {
      const original = elements.get(2)!;
      pointer(original.firstElementChild!, "pointerdown", 700, 10);
      pointer(window, "pointermove", 500, 390);
      expect(document.querySelector(".drop-overlay")?.getAttribute("style")).toContain(
        "display: block",
      );
      pointer(window, "pointerup", 500, 390);
      expect(snapshot()).toEqual({
        kind: "split",
        dir: "row",
        ratio: 0.65,
        a: leaf(-1),
        b: { kind: "split", dir: "column", ratio: 0.5, a: leaf(1), b: leaf(2) },
      });
      expect(elements.get(2)).toBe(original);
      expect(stage.ids()).toEqual([1, 2]);
      expect(manager.focusPane).toHaveBeenLastCalledWith(2);
    } finally {
      stage.dispose();
    }
  });

  it("swaps pins with Ctrl and leaves the layout unchanged when a drag is canceled", () => {
    const { stage, elements, snapshot } = setup();
    try {
      const before = snapshot();
      pointer(elements.get(2)!.firstElementChild!, "pointerdown", 700, 10);
      pointer(window, "pointermove", 500, 100, true);
      pointer(window, "pointerup", 500, 100, true);
      expect(snapshot()).toMatchObject({ b: leaf(1), a: { b: leaf(2) } });
      const swapped = snapshot();
      expect(swapped).not.toEqual(before);
      pointer(elements.get(2)!.firstElementChild!, "pointerdown", 700, 10);
      pointer(window, "pointermove", 20, 200);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      pointer(window, "pointerup", 20, 200);
      expect(snapshot()).toEqual(swapped);
      expect(document.querySelector(".drop-overlay")).toBeNull();
    } finally {
      stage.dispose();
    }
  });

  it("moves a single pin around the workspace without converting an ordinary pane to a pin", () => {
    const { stage, elements, snapshot } = setup();
    try {
      stage.unpin(2);
      pointer(elements.get(1)!.firstElementChild!, "pointerdown", 500, 10);
      pointer(window, "pointermove", 20, 200);
      pointer(window, "pointerup", 20, 200);
      expect(stage.placement(1)?.edge).toBe("left");
      expect(stage.ids()).toEqual([1]);
      expect(stage.placement(2)).toBeUndefined();
      expect(snapshot()).toBeDefined();
    } finally {
      stage.dispose();
    }
  });
  it("collapses the workspace without losing the complete saved layout or hidden containers", () => {
    const { stage, host, snapshot } = setup();
    try {
      const before = snapshot();
      stage.setWorkspaceVisible(false);
      expect(stage.workspace.style.display).toBe("none");
      expect(stage.workspace.isConnected).toBe(true);
      expect(host.querySelector('[data-pane-id="-1"]')).toBeNull();
      expect(host.querySelectorAll(".pinned-pane-slot")).toHaveLength(2);
      expect(snapshot()).toEqual(before);
      stage.setWorkspaceVisible(true);
      expect(stage.workspace.style.display).toBe("");
      expect(host.querySelector('[data-pane-id="-1"]')).not.toBeNull();
      expect(snapshot()).toEqual(before);
    } finally {
      stage.dispose();
    }
  });

  it("resizes a pins-only divider in the full saved tree", () => {
    const { stage, host, elements, snapshot } = setup();
    try {
      pointer(elements.get(2)!.firstElementChild!, "pointerdown", 700, 10);
      pointer(window, "pointermove", 500, 390);
      pointer(window, "pointerup", 500, 390);
      stage.setWorkspaceVisible(false);
      const split = host.querySelector<HTMLElement>(":scope > .split")!;
      split.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        right: 800,
        top: 0,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      });
      const divider = split.querySelector<HTMLElement>(":scope > .split__divider")!;
      divider.setPointerCapture = vi.fn();
      pointer(divider, "pointerdown", 400, 200);
      pointer(divider, "pointermove", 400, 300);
      pointer(divider, "pointerup", 400, 300);
      expect(snapshot()).toMatchObject({
        ratio: 0.65,
        a: leaf(-1),
        b: { dir: "column", ratio: 0.75 },
      });
      stage.setWorkspaceVisible(true);
      expect(snapshot()).toMatchObject({ ratio: 0.65, a: leaf(-1), b: { ratio: 0.75 } });
    } finally {
      stage.dispose();
    }
  });
});
