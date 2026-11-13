import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ptyInfo } from "../pty/info";
import { inspectLinuxCodexSession, linuxProcessStart } from "./linux-codex-session";
import { linuxThreadWriterLocked, stopLinuxCodexForSwitch } from "./linux-codex-handoff";

vi.mock("../pty/info", () => ({ ptyInfo: vi.fn() }));
vi.mock("./linux-codex-session", () => ({
  inspectLinuxCodexSession: vi.fn(),
  linuxProcessStart: vi.fn(),
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const expected = { processId: 123, sessionId, accountId: "codex2" };
const pane = { id: 7, pid: 100, ttyName: "pts/42", cwd: "/project" };
const locked = "1: FLOCK  ADVISORY  WRITE 999 08:01:42 0 EOF\n";
let sourceLocked: boolean;
let targetLocked: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  sourceLocked = false;
  targetLocked = false;
  vi.mocked(ptyInfo).mockResolvedValue([
    {
      id: 7,
      processId: 123,
      cwd: "/project",
      kind: "agent",
      agent: "codex",
      process: "codex",
      codexSessionId: sessionId,
    },
  ]);
  vi.mocked(linuxProcessStart).mockResolvedValue("12345");
  vi.mocked(inspectLinuxCodexSession).mockResolvedValue({ sessionId, state: "ready" });
  vi.spyOn(fs, "readlink").mockResolvedValue("/dev/pts/42");
  vi.spyOn(fs, "readFile").mockImplementation(async (file) => {
    if (String(file).endsWith("/environ")) return "CODEX_HOME=/manager/profiles_codex/codex1\0";
    if (String(file).endsWith("/stat"))
      return `123 (codex) S 100 120 ${Array(16).fill("0").join(" ")} 12345`;
    if (String(file).endsWith("/locks")) return locked;
    throw new Error(`Unexpected read: ${file}`);
  });
  vi.spyOn(fs, "stat").mockImplementation(async (file) => {
    const active = String(file).includes("/codex1/") ? sourceLocked : targetLocked;
    if (!active) throw Object.assign(new Error("Absent"), { code: "ENOENT" });
    return { dev: 2049n, ino: 42n } as Awaited<ReturnType<typeof fs.stat>>;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("waits for both the old process and its writer lock to leave", async () => {
  sourceLocked = true;
  const stop = vi.fn(async () => {});
  const pending = stopLinuxCodexForSwitch(pane, expected, stop, () => {});
  let done = false;
  void pending.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(stop).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledWith(120);
  expect(done).toBe(false);
  vi.mocked(linuxProcessStart).mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(100);
  expect(done).toBe(false);
  sourceLocked = false;
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(done).toBe(true);
});

it("refuses a target account's live writer before stopping the current session", async () => {
  targetLocked = true;
  const stop = vi.fn();
  await expect(stopLinuxCodexForSwitch(pane, expected, stop, () => {})).rejects.toThrow(
    "still open under codex2",
  );
  expect(stop).not.toHaveBeenCalled();
});

it("supports an independently launched Codex using the default home", async () => {
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    if (String(file).endsWith("/environ")) return "HOME=/home/test\0";
    if (String(file).endsWith("/stat"))
      return `123 (codex) S 100 120 ${Array(16).fill("0").join(" ")} 12345`;
    return "";
  });
  const stop = vi.fn(async () => {
    vi.mocked(linuxProcessStart).mockResolvedValue(null);
  });
  await stopLinuxCodexForSwitch(pane, expected, stop, () => {});
  expect(stop).toHaveBeenCalledWith(120);
  expect(fs.stat).toHaveBeenCalledWith(`/home/test/.codex/thread-writer-locks/${sessionId}.lock`, {
    bigint: true,
  });
});

it("does not mistake an unlocked leftover file for an active writer", async () => {
  targetLocked = true;
  vi.mocked(fs.readFile).mockResolvedValue("1: FLOCK  ADVISORY  WRITE 999 08:01:999 0 EOF\n");
  expect(
    await linuxThreadWriterLocked("/manager/profiles_codex/codex2/thread-writer-locks/id.lock"),
  ).toBe(false);
});

it.each(["process", "tty", "session", "owner"])(
  "refuses a changed %s at the host boundary",
  async (change) => {
    const stop = vi.fn();
    const assertOwner = vi.fn();
    if (change === "process")
      vi.mocked(linuxProcessStart).mockResolvedValueOnce("12345").mockResolvedValue("replacement");
    if (change === "tty") vi.mocked(fs.readlink).mockResolvedValue("/dev/pts/99");
    if (change === "session")
      vi.mocked(inspectLinuxCodexSession).mockResolvedValue({
        sessionId: "different",
        state: "ready",
      });
    if (change === "owner")
      assertOwner
        .mockImplementationOnce(() => {})
        .mockImplementation(() => {
          throw new Error("Transferred");
        });
    await expect(stopLinuxCodexForSwitch(pane, expected, stop, assertOwner)).rejects.toThrow(
      /changed|Transferred/,
    );
    expect(stop).not.toHaveBeenCalled();
  },
);

it("times out without allowing a replacement while a writer survives", async () => {
  sourceLocked = true;
  await Promise.all([
    expect(
      stopLinuxCodexForSwitch(
        pane,
        expected,
        async () => {
          vi.mocked(linuxProcessStart).mockResolvedValue(null);
        },
        () => {},
      ),
    ).rejects.toThrow("not released"),
    vi.advanceTimersByTimeAsync(8000),
  ]);
});

it("fails closed if kernel lock inspection is unavailable", async () => {
  targetLocked = true;
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    if (String(file).endsWith("/environ")) return "CODEX_HOME=/manager/profiles_codex/codex1\0";
    throw new Error("Cannot inspect locks");
  });
  const stop = vi.fn();
  await expect(stopLinuxCodexForSwitch(pane, expected, stop, () => {})).rejects.toThrow(
    "Cannot inspect locks",
  );
  expect(stop).not.toHaveBeenCalled();
});
