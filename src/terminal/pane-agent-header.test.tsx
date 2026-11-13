import { paneSessionTitles } from "./session-title-store";
import { registerPanePinAction } from "./pane-pin-actions";
// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tabViews, type PaneView } from "./tabs-store";
import { sessionEntries } from "../sessions/sessions-store";
import type { SessionEntry } from "../lib/session-history";
import { paneTails } from "./session-tail-store";
import { mountPaneAgentHeader } from "./pane-agent-header";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { registerPaneHeaderActions } from "./pane-header-actions";
import { detectedAgents } from "./agent-detection-store";
vi.mock("../ui/controls/deck-icon", () => ({ DeckIcon: () => null, CHROME_ICON: 12 }));

const pane: PaneView = {
  paneId: 1,
  agent: "claude",
  sessionId: "session-1",
  attention: "none",
  phase: "idle",
  hasRun: false,
  changedAt: 0,
};
const send = vi.fn<(data: string) => Promise<boolean>>();
const focus = vi.fn();
function publish(next: PaneView, workspacePath: string | null = "/repo") {
  tabViews.value = [
    {
      key: 1,
      process: next.agent ?? "shell",
      name: null,
      dotColor: null,
      workspacePath,
      agents: next.agent ? [next.agent] : [],
      agentBusy: false,
      unread: false,
      panes: [next],
    },
  ];
}
let element: HTMLDivElement;
let bar: HTMLDivElement;
let stop: () => void;
function mountHeader() {
  act(() => {
    stop = mountPaneAgentHeader(1, element, bar, { send, focus });
  });
}
beforeEach(() => {
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
  vi.resetAllMocks();
  send.mockResolvedValue(true);
  settings.value = DEFAULT_SETTINGS;
  sessionEntries.value = [];
  paneSessionTitles.value = new Map();
  publish(pane);
  paneTails.value = new Map([[1, "Checking launch behavior"]]);
  element = document.createElement("div");
  bar = document.createElement("div");
  bar.className = "pane__bar";
  element.append(bar);
  document.body.append(element);
  mountHeader();
});
afterEach(() => {
  act(() => stop());
  element.remove();
  sessionEntries.value = [];
  tabViews.value = [];
  paneTails.value = new Map();
  settings.value = DEFAULT_SETTINGS;
  vi.unstubAllGlobals();
});
describe("agent pane header", () => {
  it("keeps the agent name stable and retains the tail in its tooltip", () => {
    expect(element.querySelector(".pane-agent-header__message")?.getAttribute("title")).toContain(
      "Checking launch behavior",
    );
    act(() => {
      paneTails.value = new Map([[1, "Running tests"]]);
    });
    expect(element.querySelector(".pane-agent-header__message")?.getAttribute("title")).toContain(
      "Running tests",
    );
    expect(element.textContent).not.toContain("Running tests");
    act(() => publish({ ...pane, agent: null }));
    expect(element.classList.contains("pane--agent-header")).toBe(true);
  });
  it("shows the selected account and updates when the pane changes accounts", () => {
    act(() => publish({ ...pane, agent: "codex", account: "codex1" }));
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [codex1]",
    );
    act(() => publish({ ...pane, agent: "codex", account: "codex2" }));
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [codex2]",
    );
    act(() => publish({ ...pane, agent: "agy", account: "acc5" }));
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe("repo - [acc5]");
  });
  it("prefers the exact local session account over the original launch", () => {
    act(() => {
      publish({ ...pane, agent: "codex", account: "codex1" });
      sessionEntries.value = [
        {
          agent: "codex",
          sessionId: "session-1",
          manager: { account: "codex2", isClient: false },
        } as SessionEntry,
      ];
    });
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [codex2]",
    );
    act(() => {
      sessionEntries.value = [
        {
          agent: "codex",
          sessionId: "other-session",
          manager: { account: "codex3", isClient: false },
        } as SessionEntry,
      ];
    });
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [codex1]",
    );
  });
  it("falls back to the agent name when no account is known", () => {
    act(() => publish({ ...pane, agent: "codex" }));
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [Codex]",
    );
  });

  it("prefers the live process account after switching over stale session history", () => {
    act(() => {
      publish({ ...pane, agent: "codex", account: "codex2", accountIsLive: true });
      sessionEntries.value = [
        {
          agent: "codex",
          sessionId: "session-1",
          manager: { account: "codex1", isClient: false },
        } as SessionEntry,
      ];
    });
    expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
      "repo - [codex2]",
    );
  });
  it("keeps Close visible on an inactive agent pane", () => {
    expect(element.querySelector('[aria-label="Close pane"]')?.getAttribute("aria-label")).toBe(
      "Close pane",
    );
  });
});
it("closes its own pane with or without focus and does not start a drag", () => {
  const handlers = { split: vi.fn(), close: vi.fn(), toggleExpand: vi.fn() };
  const dispose = registerPaneHeaderActions(handlers);
  act(() => publish({ ...pane, focused: true }));
  const buttons = [
    ...element.querySelectorAll<HTMLButtonElement>(".pane-agent-header__actions button"),
  ];
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Close pane"]);
  act(() => buttons.forEach((b) => b.click()));
  expect(handlers.split).not.toHaveBeenCalled();
  expect(handlers.close).toHaveBeenCalledWith(1);
  expect(handlers.toggleExpand).not.toHaveBeenCalled();
  act(() => publish({ ...pane, focused: false }));
  const close = element.querySelector<HTMLButtonElement>(
    '.pane-agent-header__actions [aria-label="Close pane"]',
  )!;
  const pointerDown = vi.fn();
  const mouseDown = vi.fn();
  element.addEventListener("pointerdown", pointerDown);
  element.addEventListener("mousedown", mouseDown);
  close.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  close.dispatchEvent(mouse);
  expect(pointerDown).not.toHaveBeenCalled();
  expect(mouseDown).not.toHaveBeenCalled();
  expect(mouse.defaultPrevented).toBe(true);
  act(() => close.click());
  expect(handlers.close).toHaveBeenNthCalledWith(2, 1);
  expect(focus).not.toHaveBeenCalled();
  dispose();
});
describe("shell pane header in a split tab", () => {
  const shell: PaneView = { ...pane, agent: null, sessionId: null };
  const sibling: PaneView = { ...shell, paneId: 2 };
  function publishPanes(panes: readonly PaneView[]) {
    tabViews.value = [{ ...tabViews.value[0], panes }];
  }
  beforeEach(() => {
    detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
  });
  afterEach(() => {
    detectedAgents.value = [];
  });

  it("keeps a header even while the shell is alone", () => {
    act(() => publishPanes([shell]));
    expect(element.querySelector(".pane-quick-agents")).not.toBeNull();
    expect(element.classList.contains("pane--agent-header")).toBe(true);
  });

  it("offers the pinned agents once the tab holds two panes", () => {
    act(() => publishPanes([shell, sibling]));
    expect(element.classList.contains("pane--agent-header")).toBe(true);
    expect(
      [...element.querySelectorAll(".pane-quick-agents button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Run Claude Code here"]);
  });

  it("types the agent's command into this pane's shell", async () => {
    act(() => publishPanes([shell, sibling]));
    await act(async () => {
      (element.querySelector(".pane-quick-agents button") as HTMLButtonElement).click();
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.stringMatching(/^claude\b.*\r$/));
  });
});

it("shows the current pin state and unpins its own terminal", () => {
  const toggle = vi.fn();
  const dispose = registerPanePinAction(toggle);
  try {
    act(() => publish({ ...pane, pinned: true }));
    const button = element.querySelector<HTMLButtonElement>('[aria-label="Unpin terminal"]')!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => button.click());
    expect(toggle).toHaveBeenCalledWith(pane.paneId);
  } finally {
    dispose();
  }
});

it("shows the owner project, conversation title and bracketed account and follows title changes", () => {
  act(() => {
    publish({ ...pane, agent: "codex", account: "codex2", pinned: true }, "/data/FTIIDC/");
    paneSessionTitles.value = new Map([[1, "Identify the next task"]]);
  });
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
    "FTIIDC - Identify the next task - [codex2]",
  );
  act(() => {
    paneSessionTitles.value = new Map([[1, "Implement the fix"]]);
  });
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
    "FTIIDC - Implement the fix - [codex2]",
  );
  expect(element.querySelector('[aria-label="Pin terminal"]')).toBeNull();
});

it("uses only exact session titles when no live title is available", () => {
  act(() => {
    publish({ ...pane, agent: "agy", account: "acc5" });
    sessionEntries.value = [
      { agent: "agy", sessionId: "session-1", title: "Review the changes" } as SessionEntry,
    ];
  });
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
    "repo - Review the changes - [acc5]",
  );
  act(() => {
    sessionEntries.value = [
      { agent: "agy", sessionId: "unrelated", title: "Another session" } as SessionEntry,
    ];
  });
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe("repo - [acc5]");
});

it("keeps a pinned header's project when another folder is open", () => {
  act(() => {
    publish({ ...pane, agent: "codex", account: "codex2", pinned: true }, "/data/FTIIDC");
    tabViews.value = [
      { ...tabViews.value[0], key: 2, workspacePath: "/data/other", panes: [] },
      tabViews.value[0],
    ];
    paneSessionTitles.value = new Map([[1, "Check progress"]]);
  });
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe(
    "FTIIDC - Check progress - [codex2]",
  );
});

it("omits missing project and title without leaving empty separators", () => {
  act(() => publish({ ...pane, agent: "codex", account: "codex2" }, null));
  expect(element.querySelector(".pane-agent-header__message")?.textContent).toBe("[codex2]");
});
