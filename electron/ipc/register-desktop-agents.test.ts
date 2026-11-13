import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  handle: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  options: null as null | { activate: (key: string) => void },
}));
vi.mock("electron", () => ({ ipcMain: { handle: fake.handle } }));
vi.mock("../desktop-agents/widget", () => ({
  DesktopAgentWidget: class {
    constructor(options: typeof fake.options) {
      fake.options = options;
    }
    update = fake.update;
    dispose = fake.dispose;
  },
}));
import { registerDesktopAgents } from "./register-desktop-agents";
function setup() {
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  const emit = vi.fn(() => true);
  const assertOwner = vi.fn((id: number, label: string) => {
    if (id !== 1 || label !== "main") throw new Error("Wrong owner");
  });
  const controller = registerDesktopAgents({
    userData: "/tmp/widget-test",
    rendererUrl: "file:///app/widget.html",
    labelOf: () => "main",
    assertOwner,
    windowFor: () => window as never,
    emit,
  });
  const publish = fake.handle.mock.calls[0][1];
  return { window, emit, controller, publish, assertOwner };
}
beforeEach(() => vi.clearAllMocks());
describe("desktop widget owner boundary", () => {
  it("drops panes owned elsewhere and ignores clicks outside its latest snapshot", () => {
    const { publish, emit } = setup();
    publish(
      {},
      {
        rows: [
          {
            paneId: 1,
            agentId: "codex",
            agent: "Codex",
            project: "deck",
            session: "Session one",
            state: "working",
          },
          {
            paneId: 2,
            agentId: "agy",
            agent: "AGY",
            project: "other",
            session: "Session two",
            state: "working",
          },
        ],
        theme: {},
      },
    );
    expect(fake.update.mock.calls[0][0].rows.map((r: { paneId: number }) => r.paneId)).toEqual([1]);
    fake.options!.activate("main:2");
    expect(emit).not.toHaveBeenCalled();
  });
  it("restores the owning window and routes the exact pane, then forgets it on close", () => {
    const { publish, emit, window, controller } = setup();
    publish(
      {},
      {
        rows: [
          {
            paneId: 1,
            agentId: "codex",
            agent: "Codex",
            project: "deck",
            session: "Session one",
            state: "requested",
          },
        ],
        theme: {},
      },
    );
    controller.activate("main:1");
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("main", "desktop-agents:focus", { paneId: 1 });
    controller.forgetWindow("main");
    controller.activate("main:1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(fake.update.mock.calls.at(-1)![0].rows).toEqual([]);
    controller.dispose();
    expect(fake.dispose).toHaveBeenCalledOnce();
  });
  it("rechecks ownership when clicking after a transfer", () => {
    const { publish, emit, assertOwner, controller } = setup();
    publish(
      {},
      {
        rows: [
          {
            paneId: 1,
            agentId: "codex",
            agent: "Codex",
            project: "deck",
            session: "Session one",
            state: "working",
          },
        ],
        theme: {},
      },
    );
    assertOwner.mockImplementation(() => {
      throw new Error("Transferred");
    });
    fake.options!.activate("main:1");
    controller.activate("main:1");
    controller.activate({ desktopAgentKey: "main:1" });
    expect(emit).not.toHaveBeenCalled();
  });
});
