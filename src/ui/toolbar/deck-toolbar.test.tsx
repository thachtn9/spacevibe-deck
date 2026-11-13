// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckToolbar, toolbarLabel } from "./deck-toolbar";

/**
 * The shipping projection: registry actions in, `ToolbarItem`s out, both
 * layouts mounting the same element. What matters here is the boundary work —
 * label re-casing (D6), the D7 group contents, unavailable-not-disabled for
 * Prompts, and the two presentation carriers (`iconbtn--gear`, the anchored
 * popover) surviving the move off `ChromeActions`.
 */
describe("DeckToolbar", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  // An open `More` menu is a document-level surface; leaving it mounted would
  // let the next test read this test's rows.
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const handlers = () => ({
    onToggleBrowser: vi.fn(),
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onToggleExpand: vi.fn(),
    onClosePane: vi.fn(),
    onTogglePrompts: vi.fn(),
    onToggleSettings: vi.fn(),
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const on = handlers();
    act(() =>
      render(
        <DeckToolbar
          browserActive={false}
          // Defaults to the host every release still ships (no `sessions_list`),
          // which is also what keeps the D7 label list below exhaustive.
          settingsOpen={false}
          expandActive={false}
          promptsOpen={false}
          promptsUnavailable={null}
          {...on}
          {...overrides}
        />,
        host,
      ),
    );
    return on;
  }

  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === name,
    );
    if (found === undefined) {
      throw new Error(`no button named ${name}`);
    }
    return found;
  };

  it("re-cases registry labels to sentence case and drops menu ellipses", () => {
    expect(toolbarLabel("split-row")).toBe("Split vertically");
    expect(toolbarLabel("toggle-settings")).toBe("Settings");
    expect(toolbarLabel("toggle-prompts")).toBe("Prompts");
    expect(toolbarLabel("toggle-browser")).toBe("Browser");
    expect(toolbarLabel("toggle-usage")).toBe("Quota");
    expect(toolbarLabel("toggle-explorer")).toBe("Explorer");
  });

  it("shows splits and Focus expand directly alongside global tools when no rail holds them", () => {
    mount();
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Text Editor",
      "Split vertically",
      "Split horizontally",
      "Focus expand",
      "Settings",
    ]);
  });

  it.each([false, true])(
    "shows one Mission Control entry in compact=%s, pressed while it is open",
    (compact) => {
      const onToggle = vi.fn();
      mount({ compact, missionControl: { open: false, onToggle } });
      const buttons = () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>(".agent-view-switch button"));
      expect(buttons().map((button) => button.textContent)).toEqual(["Overview"]);
      expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
      act(() => buttons()[0].click());
      expect(onToggle).toHaveBeenCalledTimes(1);

      onToggle.mockClear();
      mount({ compact, missionControl: { open: true, onToggle } });
      expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
      // It fires WHILE pressed: the one button is the way out as well as in.
      act(() => buttons()[0].click());
      expect(onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it("omits the Mission Control entry entirely when none is handed in", () => {
    mount({ missionControl: undefined });
    expect(host.querySelector(".agent-view-switch")).toBeNull();
  });

  it("shows splits and Focus expand when the rail holds the global tools", () => {
    const on = mount({ railToolsMounted: true, expandActive: true });
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Text Editor",
      "Split vertically",
      "Split horizontally",
      "Focus expand",
    ]);
    expect(button("Focus expand").getAttribute("aria-pressed")).toBe("true");
    act(() => button("Split vertically").click());
    act(() => button("Split horizontally").click());
    expect(on.onSplitRow).toHaveBeenCalledOnce();
    expect(on.onSplitColumn).toHaveBeenCalledOnce();
    act(() => button("Focus expand").click());
    expect(on.onToggleExpand).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="More actions"]')).toBeNull();
  });

  it.each([{ compact: true }, { railToolsMounted: false }])(
    "keeps global tools reachable directly (%o)",
    (overrides) => {
      const on = mount(overrides);
      expect(host.querySelector('[aria-label="Browser"]')).toBeNull();
      expect(host.querySelector('[aria-label="Prompts"]')).toBeNull();
      act(() => button("Settings").click());
      expect(on.onToggleBrowser).not.toHaveBeenCalled();
      expect(on.onTogglePrompts).not.toHaveBeenCalled();
      expect(on.onToggleSettings).toHaveBeenCalledOnce();
      expect(host.querySelector('[aria-label="More actions"]')).toBeNull();
    },
  );

  it("keeps the prompt popover on exactly one anchor", () => {
    mount({ railToolsMounted: false, promptsOpen: true, promptPopover: <div class="pp" /> });
    expect(host.querySelectorAll(".pp")).toHaveLength(0);
    mount({ railToolsMounted: true, promptsOpen: true, promptPopover: <div class="pp" /> });
    expect(host.querySelector(".pp")).toBeNull();
  });

  it("omits Open in and keeps attention and dev-server controls", () => {
    mount({
      railToolsMounted: true,
      externalApp: <button aria-label="Open in editor" />,
      attention: <button aria-label="2 need you" />,
      devServers: <button aria-label="Dev servers" />,
    });
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Text Editor",
      "Split vertically",
      "Split horizontally",
      "2 need you",
      "Dev servers",
      "Focus expand",
    ]);
    expect(host.querySelector(".ftoolbar__drag")).not.toBeNull();
  });
});
