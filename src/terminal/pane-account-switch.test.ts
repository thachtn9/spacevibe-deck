import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { switchPaneAccount } from "./pane-account-switch";

const sessionId = "11111111-1111-4111-8111-111111111111";
const account = { id: "codex2", agent: "codex" };
const agent: PaneProcessInfo = {
  id: 7,
  processId: 123,
  cwd: "/project",
  process: "codex",
  kind: "agent",
  agent: "codex",
  codexSessionId: sessionId,
  account: "codex1",
};
const shell: PaneProcessInfo = {
  id: 7,
  processId: 100,
  cwd: "/project",
  process: "bash",
  kind: "idle-shell",
  agent: null,
};

function setup() {
  let info: PaneProcessInfo = agent;
  const releaseInput = vi.fn();
  const deps = {
    pty: {
      ptyInfo: vi.fn(async () => [info]),
      killForeground: vi.fn(async () => {
        info = shell;
      }),
      writePty: vi.fn(async (_id: number, _data: string) => {
        info = {
          ...agent,
          agent: info.agent ?? "codex",
          agySessionId: sessionId,
          processId: 456,
          account: account.id,
        };
      }),
    },
    platform: "linux" as const,
    valid: vi.fn(() => true),
    prepare: vi.fn(async (command: string) => command),
    stopped: vi.fn(async () => {}),
    pauseInput: vi.fn(async () => releaseInput),
    resetTerminal: vi.fn(async () => {}),
    launched: vi.fn(),
  };
  return {
    deps,
    releaseInput,
    setInfo: (value: PaneProcessInfo) => {
      info = value;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(["codex", "agy"])(
  "stops %s and resumes the exact session in the same pane",
  async (engine) => {
    const { deps, setInfo } = setup();
    setInfo({ ...agent, agent: engine, agySessionId: engine === "agy" ? sessionId : null });
    deps.pty.writePty.mockImplementation(async () =>
      setInfo({
        ...agent,
        agent: engine,
        agySessionId: sessionId,
        processId: 456,
        account: account.id,
      }),
    );
    const pending = switchPaneAccount(7, { ...account, agent: engine }, deps);
    await vi.advanceTimersByTimeAsync(599);
    if (engine === "codex")
      expect(deps.pty.killForeground).toHaveBeenCalledWith(7, {
        processId: 123,
        sessionId,
        accountId: account.id,
      });
    else expect(deps.pty.killForeground).toHaveBeenCalledWith(7);
    expect(deps.pty.writePty).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(deps.pty.writePty).toHaveBeenCalledExactlyOnceWith(
      7,
      expect.stringMatching(
        new RegExp(`^\\x15stty sane && printf .* && cli resume ${sessionId} --acc codex2\\r$`),
      ),
    );
    expect(deps.pauseInput.mock.invocationCallOrder[0]).toBeLessThan(
      deps.pty.killForeground.mock.invocationCallOrder[0],
    );
    expect(deps.resetTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      deps.pty.writePty.mock.invocationCallOrder[0],
    );
    expect(deps.launched).toHaveBeenCalledWith(
      `cli resume ${sessionId} --acc codex2`,
      sessionId,
      "/project",
    );
  },
);

it.each([
  { ...agent, processId: null },
  { ...agent, cwd: null },
  { ...agent, agent: "agy" },
  shell,
])("refuses unproven identity or a different agent before stopping", async (info) => {
  const { deps, setInfo } = setup();
  setInfo(info);
  await expect(switchPaneAccount(7, account, deps)).rejects.toThrow(
    /same agent|running process|folder/,
  );
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
  expect(deps.pty.writePty).not.toHaveBeenCalled();
});

it("waits for delayed identity metadata before stopping the same process", async () => {
  const { deps, setInfo } = setup();
  setInfo({ ...agent, codexSessionId: null, codexIdentityState: "shared" });
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(149);
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
  setInfo(agent);
  await vi.advanceTimersByTimeAsync(601);
  await expect(pending).resolves.toBe(true);
  expect(deps.pty.ptyInfo).toHaveBeenCalledWith([7], [], true);
  expect(deps.pty.writePty).toHaveBeenCalledWith(
    7,
    expect.stringContaining(`cli resume ${sessionId} --acc codex2\r`),
  );
});

it("explains shared-daemon identity failures without stopping or guessing", async () => {
  const { deps, setInfo } = setup();
  setInfo({ ...agent, codexSessionId: null, codexIdentityState: "shared" });
  await Promise.all([
    expect(switchPaneAccount(7, account, deps)).rejects.toThrow("shared background server"),
    vi.advanceTimersByTimeAsync(1500),
  ]);
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
  expect(deps.pty.writePty).not.toHaveBeenCalled();
});

it("reports a blocked Codex resume accurately, including a drop onto the same account", async () => {
  const { deps, setInfo } = setup();
  setInfo({ ...agent, account: account.id, codexSessionId: null, codexIdentityState: "locked" });
  await expect(switchPaneAccount(7, account, deps)).rejects.toThrow(
    "another app or background Codex server",
  );
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
  expect(deps.launched).not.toHaveBeenCalled();
});

it("waits for the replacement to prove both session and account before reporting success", async () => {
  const { deps, setInfo } = setup();
  deps.pty.writePty.mockImplementation(async () =>
    setInfo({ ...agent, processId: 456, codexSessionId: null, account: null }),
  );
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(1000);
  expect(deps.launched).not.toHaveBeenCalled();
  setInfo({ ...agent, processId: 456, account: account.id });
  await vi.advanceTimersByTimeAsync(150);
  await expect(pending).resolves.toBe(true);
  expect(deps.launched).toHaveBeenCalledOnce();
});

it.each([
  {
    ...agent,
    processId: 456,
    account: account.id,
    codexSessionId: null,
    codexIdentityState: "locked" as const,
  },
  { ...agent, processId: 456, account: "codex3" },
  { ...agent, processId: 456, account: account.id, codexSessionId: "another-session" },
])(
  "does not report success when the replacement fails or opens the wrong identity",
  async (replacement) => {
    const { deps, setInfo, releaseInput } = setup();
    deps.pty.writePty.mockImplementation(async () => setInfo(replacement));
    await Promise.all([
      expect(switchPaneAccount(7, account, deps)).rejects.toThrow(
        /another app|different session or account/,
      ),
      vi.advanceTimersByTimeAsync(600),
    ]);
    expect(deps.launched).not.toHaveBeenCalled();
    expect(releaseInput).toHaveBeenCalledOnce();
  },
);

it("does not send resume until the host has verified stop completion", async () => {
  const { deps, setInfo } = setup();
  let finish!: () => void;
  deps.pty.killForeground.mockImplementation(async () => {
    setInfo(shell);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(3000);
  expect(deps.pty.writePty).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(600);
  await expect(pending).resolves.toBe(true);
});

it("releases input and reports an unconfirmed launch when startup never exposes identity", async () => {
  const { deps, setInfo, releaseInput } = setup();
  deps.pty.writePty.mockImplementation(async () =>
    setInfo({ ...agent, processId: 456, account: account.id, codexSessionId: null }),
  );
  await Promise.all([
    expect(switchPaneAccount(7, account, deps)).rejects.toThrow("could not confirm"),
    vi.advanceTimersByTimeAsync(16000),
  ]);
  expect(deps.launched).not.toHaveBeenCalled();
  expect(releaseInput).toHaveBeenCalledOnce();
});

it("cancels rather than borrowing an identity from a replacement process", async () => {
  const { deps, setInfo } = setup();
  setInfo({ ...agent, codexSessionId: null });
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(149);
  setInfo({ ...agent, processId: 456 });
  await Promise.all([
    expect(pending).rejects.toThrow("session changed"),
    vi.advanceTimersByTimeAsync(1),
  ]);
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
});

it("leaves the current account running when dropped onto itself", async () => {
  const { deps } = setup();
  await expect(switchPaneAccount(7, { ...account, id: "codex1" }, deps)).resolves.toBe(true);
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
});

it("rechecks process identity after command preparation", async () => {
  const { deps, setInfo } = setup();
  deps.prepare.mockImplementation(async (command) => {
    setInfo({ ...agent, processId: 456 });
    return command;
  });
  await expect(switchPaneAccount(7, account, deps)).rejects.toThrow("session changed");
  expect(deps.pty.killForeground).not.toHaveBeenCalled();
});

it("cancels if the pane closes or the account disappears while stopping", async () => {
  const { deps, releaseInput } = setup();
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(100);
  deps.valid.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(600);
  await expect(pending).resolves.toBe(false);
  expect(deps.pty.writePty).not.toHaveBeenCalled();
  expect(releaseInput).toHaveBeenCalledOnce();
});

it("never writes resume into an agent that did not stop", async () => {
  const { deps } = setup();
  deps.pty.killForeground.mockImplementation(async () => {});
  await Promise.all([
    expect(switchPaneAccount(7, account, deps)).rejects.toThrow("did not stop"),
    vi.advanceTimersByTimeAsync(9000),
  ]);
  expect(deps.pty.writePty).not.toHaveBeenCalled();
});

it("refuses a new occupant appearing just before resume", async () => {
  const { deps, setInfo } = setup();
  deps.stopped.mockImplementation(async () => {
    setInfo({ ...agent, processId: 999 });
  });
  await Promise.all([
    expect(switchPaneAccount(7, account, deps)).rejects.toThrow("no longer idle"),
    vi.advanceTimersByTimeAsync(600),
  ]);
  expect(deps.pty.writePty).not.toHaveBeenCalled();
});

it("restores input when stopping the agent fails", async () => {
  const { deps, releaseInput } = setup();
  deps.pty.killForeground.mockRejectedValue(new Error("Could not stop"));
  await expect(switchPaneAccount(7, account, deps)).rejects.toThrow("Could not stop");
  expect(releaseInput).toHaveBeenCalledOnce();
  expect(deps.resetTerminal).not.toHaveBeenCalled();
  expect(deps.pty.writePty).not.toHaveBeenCalled();
});

it("restores the agent cwd with shell quoting when it differs from the shell", async () => {
  const { deps, setInfo } = setup();
  setInfo({ ...agent, cwd: "/project/owner's folder" });
  const pending = switchPaneAccount(7, account, deps);
  await vi.advanceTimersByTimeAsync(600);
  await expect(pending).resolves.toBe(true);
  expect(deps.pty.writePty).toHaveBeenCalledWith(
    7,
    expect.stringContaining(
      `cd -- '/project/owner'\\''s folder' && cli resume ${sessionId} --acc codex2\r`,
    ),
  );
});
