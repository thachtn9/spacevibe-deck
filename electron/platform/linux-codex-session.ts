import fs from "node:fs/promises";
import path from "node:path";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LOCK = new RegExp(`/thread-writer-locks/(${UUID})\\.lock$`, "i");
const ROLLOUT = new RegExp(`/rollout-.*(${UUID})\\.jsonl$`, "i");

export interface LinuxCodexIdentity {
  sessionId: string | null;
  state: "ready" | "locked" | "shared" | "unidentified";
}

/** PID reuse must never authorize stopping the replacement process. */
export async function linuxProcessStart(pid: number, procRoot = "/proc"): Promise<string | null> {
  try {
    const stat = await fs.readFile(path.join(procRoot, String(pid), "stat"), "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : (fields[19] ?? null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function lockedInThisInvocation(root: string, files: string[], procRoot: string) {
  // A pane log is reused on resume. Ignore errors written before this process
  // started, and never inspect a shared profile log for a pane's identity.
  const log = files.find((file) =>
    /\/terminal-runtime\/[^/]+\/\d+\/codex-log\/codex-tui\.log$/.test(file),
  );
  if (!log) return false;
  try {
    const start = await linuxProcessStart(Number(path.basename(root)), procRoot);
    if (start === null) return false;
    const uptime = Number((await fs.readFile(path.join(procRoot, "uptime"), "utf8")).split(" ")[0]);
    // Linux exports /proc starttime in USER_HZ (100 ticks per second).
    const startedAt = Date.now() - (uptime - Number(start) / 100) * 1000;
    const handle = await fs.open(log, "r");
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        Math.max(0, size - buffer.length),
      );
      return buffer
        .toString("utf8", 0, bytesRead)
        .split("\n")
        .some(
          (line) =>
            Date.parse(line.split(" ")[0]) >= startedAt &&
            /thread-store conflict: thread [0-9a-f-]{36} already has an active writer/i.test(line),
        );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** Inspect only the TUI itself: a descendant app-server can serve other panes. */
export async function inspectLinuxCodexSession(
  pid: number,
  procRoot = "/proc",
): Promise<LinuxCodexIdentity> {
  const root = path.join(procRoot, String(pid));
  const locks = new Set<string>();
  const interactive = new Set<string>();
  const noninteractive = new Set<string>();
  const files: string[] = [];
  let command = "";
  try {
    command = await fs.readFile(path.join(root, "cmdline"), "utf8");
    if (command.split("\0").includes("app-server")) return { sessionId: null, state: "shared" };
  } catch {
    return { sessionId: null, state: "unidentified" };
  }
  try {
    for (const fd of await fs.readdir(path.join(root, "fd"))) {
      try {
        const file = await fs.readlink(path.join(root, "fd", fd));
        files.push(file);
        const fdinfo = await fs.readFile(path.join(root, "fdinfo", fd), "utf8");
        const lock = LOCK.exec(file);
        if (
          lock &&
          new RegExp(`^lock:.* FLOCK\\s+ADVISORY\\s+WRITE\\s+${pid}\\s`, "m").test(fdinfo)
        )
          locks.add(lock[1]);
        const rollout = ROLLOUT.exec(file);
        if (!rollout) continue;
        const flags = /^flags:\s+([0-7]+)/m.exec(fdinfo)?.[1];
        if (!flags || (Number.parseInt(flags, 8) & 3) === 0) continue;
        const handle = await fs.open(file, "r");
        try {
          const buffer = Buffer.alloc(128 * 1024);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const meta = JSON.parse(buffer.toString("utf8", 0, bytesRead).split("\n")[0]);
          if (meta.type === "session_meta" && meta.payload?.id === rollout[1]) {
            if (meta.payload.source === "cli") interactive.add(rollout[1]);
            else if (typeof meta.payload.source === "object") noninteractive.add(rollout[1]);
          }
        } finally {
          await handle.close();
        }
      } catch {
        /* Closed descriptors and incomplete metadata prove nothing. */
      }
    }
  } catch {
    return { sessionId: null, state: "unidentified" };
  }
  // The main rollout identifies the interactive conversation even while the
  // same TUI owns subagents whose rollout descriptors have already closed.
  if (interactive.size === 1) return { sessionId: [...interactive][0], state: "ready" };
  const candidates = [...locks].filter((id) => !noninteractive.has(id));
  if (interactive.size === 0 && candidates.length === 1)
    return { sessionId: candidates[0], state: "ready" };
  return {
    sessionId: null,
    state: (await lockedInThisInvocation(root, files, procRoot))
      ? "locked"
      : command.split("\0").includes("--no-daemon")
        ? "unidentified"
        : "shared",
  };
}

/** Persistence and non-Linux callers need only the proven live identity. */
export async function linuxCodexSession(pid: number, procRoot = "/proc"): Promise<string | null> {
  return (await inspectLinuxCodexSession(pid, procRoot)).sessionId;
}
