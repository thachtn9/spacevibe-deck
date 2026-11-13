/* oxlint-disable eslint/no-await-in-loop -- Each observation follows a process transition. */
import fs from "node:fs/promises";
import path from "node:path";
import { ptyInfo } from "../pty/info";
import type { PtySessionSnapshot } from "../pty/session-store";
import { inspectLinuxCodexSession, linuxProcessStart } from "./linux-codex-session";

export interface CodexHandoff {
  processId: number;
  sessionId: string;
  accountId: string;
}

/** Inspect the kernel lock, never the mere existence of a persistent lock file. */
export async function linuxThreadWriterLocked(file: string, procRoot = "/proc"): Promise<boolean> {
  let stat;
  try {
    stat = await fs.stat(file, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const locks = await fs.readFile(path.join(procRoot, "locks"), "utf8");
  const major = ((stat.dev >> 8n) & 0xfffn) | ((stat.dev >> 32n) & 0xfffff000n);
  const minor = (stat.dev & 0xffn) | ((stat.dev >> 12n) & 0xffffff00n);
  return locks.split("\n").some((line) => {
    const match = /^\d+: FLOCK\s+ADVISORY\s+WRITE\s+\d+\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(
      line,
    );
    return (
      match !== null &&
      BigInt(`0x${match[1]}`) === major &&
      BigInt(`0x${match[2]}`) === minor &&
      BigInt(match[3]) === stat.ino
    );
  });
}

/** Guard the destructive step in GUI main, including when the PTY service is older. */
export async function stopLinuxCodexForSwitch(
  pane: PtySessionSnapshot,
  expected: CodexHandoff,
  stop: (processGroup: number) => Promise<unknown>,
  assertOwner: () => void,
): Promise<void> {
  if (
    !Number.isSafeInteger(expected.processId) ||
    expected.processId <= 1 ||
    typeof expected.sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected.sessionId) ||
    typeof expected.accountId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(expected.accountId)
  )
    throw new Error("Invalid Codex account handoff");
  assertOwner();
  const start = await linuxProcessStart(expected.processId);
  const [info] = await ptyInfo([pane], [], true);
  if (
    !start ||
    info?.agent !== "codex" ||
    info.processId !== expected.processId ||
    info.codexSessionId !== expected.sessionId
  )
    throw new Error("The Codex session changed. The account was not changed.");
  const root = `/proc/${expected.processId}`;
  const environment = await fs.readFile(`${root}/environ`, "utf8");
  const entries = environment.split("\0");
  const profile = environment
    .split("\0")
    .find((entry) => entry.startsWith("CODEX_HOME="))
    ?.slice(11);
  const userHome = entries.find((entry) => entry.startsWith("HOME="))?.slice(5);
  const home = profile || (userHome ? path.join(userHome, ".codex") : null);
  // The launcher account is taken from this process, never from a cached command.
  if (!home || !path.isAbsolute(home))
    throw new Error("Could not verify this Codex account's profile. The account was not changed.");
  const lock = path.join(home, "thread-writer-locks", `${expected.sessionId}.lock`);
  const targetLock = /\/profiles_codex\/[A-Za-z0-9_-]+\/?$/.test(home)
    ? path.join(
        path.dirname(home.replace(/\/$/, "")),
        expected.accountId,
        "thread-writer-locks",
        `${expected.sessionId}.lock`,
      )
    : null;
  if (targetLock !== null && targetLock !== lock && (await linuxThreadWriterLocked(targetLock)))
    throw new Error(
      `This conversation is still open under ${expected.accountId}. Close that conversation there, then retry. The current session is still running.`,
    );
  assertOwner();
  if (
    (await linuxProcessStart(expected.processId)) !== start ||
    (await fs.readlink(`${root}/fd/0`)) !== `/dev/${pane.ttyName}` ||
    (await inspectLinuxCodexSession(expected.processId)).sessionId !== expected.sessionId
  )
    throw new Error("The Codex session changed. The account was not changed.");
  assertOwner();
  // Pin the original job group. Asking an older service to stop whatever is
  // foreground now could hit a replacement that appeared during inspection.
  const stat = await fs.readFile(`${root}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const group = Number(fields[2]);
  if (fields[19] !== start || !Number.isSafeInteger(group) || group <= 1 || group === pane.pid)
    throw new Error("Could not verify Codex's process group. The account was not changed.");
  assertOwner();
  await stop(group);
  for (let attempt = 0; attempt < 80; attempt++) {
    assertOwner();
    if (
      (await linuxProcessStart(expected.processId)) !== start &&
      !(await linuxThreadWriterLocked(lock))
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Codex has not released this conversation yet. The replacement was not started. Close the conversation in its other app, then resume it from Session history.",
  );
}
