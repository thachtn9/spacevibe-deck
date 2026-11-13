import { expect, it, vi } from "vitest";
import { PersistentPtyManager } from "./persistent-client";
import { terminateDetachedTerminalProcesses, terminateProcessGroups } from "../platform/linux";
import { stopLinuxCodexForSwitch } from "../platform/linux-codex-handoff";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ app: {} }));
vi.mock("../platform/linux", () => ({
  terminateDetachedTerminalProcesses: vi.fn(async () => {}),
  terminateProcessGroups: vi.fn(),
}));
vi.mock("../platform/linux-codex-handoff", () => ({ stopLinuxCodexForSwitch: vi.fn() }));

function setup() {
  vi.clearAllMocks();
  const assertOwner = vi.fn();
  const manager = new PersistentPtyManager(
    { assertOwner, register: vi.fn(), unregister: vi.fn(), emitToOwner: vi.fn() },
    "/unused-test-profile",
  );
  vi.spyOn(manager, "snapshots").mockResolvedValue([
    { id: 7, pid: 123, ttyName: "pts/42", cwd: "/project" },
  ]);
  const request = vi.spyOn(manager, "ownedRequest").mockResolvedValue(null);
  return { manager, assertOwner, request };
}

it("stops AGY's detached tty descendants before the legacy daemon foreground stop", async () => {
  const { manager, request } = setup();
  await manager.killForeground("main", 7);
  expect(terminateDetachedTerminalProcesses).toHaveBeenCalledExactlyOnceWith(123, "pts/42");
  expect(request).toHaveBeenCalledWith("main", 7, "stop");
  expect(vi.mocked(terminateDetachedTerminalProcesses).mock.invocationCallOrder[0]).toBeLessThan(
    request.mock.invocationCallOrder[0],
  );
});

it("refuses another window before inspecting or signalling anything", async () => {
  const { manager, assertOwner } = setup();
  assertOwner.mockImplementation(() => {
    throw new Error("Wrong owner");
  });
  await expect(manager.killForeground("other", 7)).rejects.toThrow("Wrong owner");
  expect(manager.snapshots).not.toHaveBeenCalled();
  expect(terminateDetachedTerminalProcesses).not.toHaveBeenCalled();
});

it("rechecks ownership after awaiting the daemon snapshot", async () => {
  const { manager, assertOwner, request } = setup();
  assertOwner
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw new Error("Transferred");
    });
  await expect(manager.killForeground("main", 7)).rejects.toThrow("Transferred");
  expect(terminateDetachedTerminalProcesses).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it("never signals a snapshot belonging to a different pane", async () => {
  const { manager, request } = setup();
  vi.mocked(manager.snapshots).mockResolvedValue([
    { id: 8, pid: 456, ttyName: "pts/43", cwd: null },
  ]);
  await manager.killForeground("main", 7);
  expect(terminateDetachedTerminalProcesses).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith("main", 7, "stop");
});

it("uses GUI-main handoff guards and the captured group instead of a legacy foreground stop", async () => {
  const { manager, request, assertOwner } = setup();
  const expected = {
    processId: 456,
    sessionId: "11111111-1111-4111-8111-111111111111",
    accountId: "codex2",
  };
  vi.mocked(stopLinuxCodexForSwitch).mockImplementation(async (_pane, _expected, stop, assert) => {
    assert();
    await stop(450);
  });
  await manager.killForeground("main", 7, expected);
  expect(stopLinuxCodexForSwitch).toHaveBeenCalledWith(
    { id: 7, pid: 123, ttyName: "pts/42", cwd: "/project" },
    expected,
    expect.any(Function),
    expect.any(Function),
  );
  expect(assertOwner).toHaveBeenCalledWith(7, "main");
  expect(terminateProcessGroups).toHaveBeenCalledWith(450, null);
  expect(request).not.toHaveBeenCalled();
  expect(terminateDetachedTerminalProcesses).not.toHaveBeenCalled();
});

it("isolates exact Codex resumes even when the existing daemon returns an unmodified command", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "deck-legacy-launch-"));
  try {
    const manager = new PersistentPtyManager(
      { assertOwner: vi.fn(), register: vi.fn(), unregister: vi.fn(), emitToOwner: vi.fn() },
      directory,
    );
    const command = "cli resume exact-session --acc codex2";
    vi.spyOn(manager, "request").mockResolvedValue(command);
    const epoch = "11111111-1111-4111-8111-111111111111";
    vi.spyOn(manager, "reference").mockReturnValue(`${epoch}:7`);
    const logDir = path.join(directory, "terminal-runtime", epoch, "7", "codex-log");
    const prepared = await manager.ownedRequest("main", 7, "prepareLaunch", { command });
    expect(prepared).toBe(
      `cli codex2 resume exact-session --no-daemon -c 'log_dir=${JSON.stringify(logDir)}'`,
    );
    expect((await stat(logDir)).isDirectory()).toBe(true);
    vi.mocked(manager.request).mockResolvedValue(prepared);
    expect(await manager.ownedRequest("main", 7, "prepareLaunch", { command })).toBe(prepared);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("repairs a legacy daemon's resume command even when it already contains log_dir", async () => {
  const epoch = "11111111-1111-4111-8111-111111111111";
  // Existing explicit log overrides must survive normalization, even if they
  // point somewhere other than the new GUI's default directory.
  const directory = await mkdtemp(path.join(tmpdir(), "deck-legacy-resume-"));
  try {
    const local = new PersistentPtyManager(
      { assertOwner: vi.fn(), register: vi.fn(), unregister: vi.fn(), emitToOwner: vi.fn() },
      directory,
    );
    vi.spyOn(local, "reference").mockReturnValue(`${epoch}:7`);
    const command = `cli resume exact-session --acc codex2 -c 'log_dir="/tmp/existing-log"'`;
    vi.spyOn(local, "request").mockResolvedValue(command);
    expect(await local.ownedRequest("main", 7, "prepareLaunch", { command })).toBe(
      `cli codex2 resume exact-session -c 'log_dir="/tmp/existing-log"' --no-daemon`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("prepares a handoff locally without changing the legacy service's recovery metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "deck-handoff-prepare-"));
  try {
    const manager = new PersistentPtyManager(
      { assertOwner: vi.fn(), register: vi.fn(), unregister: vi.fn(), emitToOwner: vi.fn() },
      directory,
    );
    const request = vi.spyOn(manager, "request").mockResolvedValue(null);
    const epoch = "11111111-1111-4111-8111-111111111111";
    vi.spyOn(manager, "reference").mockReturnValue(`${epoch}:7`);
    const command = "cli resume exact-session --acc codex2";
    expect(await manager.ownedRequest("main", 7, "prepareAccountSwitch", { command })).toContain(
      "cli codex2 resume exact-session --no-daemon",
    );
    expect(request).not.toHaveBeenCalled();
    await expect(
      manager.ownedRequest("main", 7, "prepareAccountSwitch", { command: null }),
    ).rejects.toThrow("Invalid terminal command");
    expect(request).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
