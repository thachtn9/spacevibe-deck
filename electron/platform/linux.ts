/** Linux uses POSIX process groups and /proc for live working directories. */
import { readFile, readlink } from "node:fs/promises";
import type { ShellLaunch } from "./macos";

export { foregroundProcess, readProcessTable, terminateProcessGroups, userHome } from "./macos";

export function shellLaunch(): ShellLaunch {
  return { executable: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

/**
 * TIOCSWINSZ only notifies the terminal's foreground process group. A wrapper
 * such as cli-agy starts its CLI with setsid(), so that CLI inherits the tty
 * descriptors but never receives the kernel's SIGWINCH. Notify descendants
 * outside the shell's session while stdin is this tty. The CLI may be behind
 * dbus-run-session or another launcher, rather than being the session leader.
 */
export async function notifyDetachedTerminalResize(
  shellPid: number,
  ttyName: string,
  active: () => boolean = () => true,
): Promise<void> {
  const pending = [shellPid];
  const seen = new Set<number>();
  while (pending.length > 0 && active()) {
    const pid = pending.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
      pending.push(
        ...children
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((id) => id > 0),
      );
      if (pid === shellPid) continue;
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[3]) === shellPid) continue;
      const stdin = await readlink(`/proc/${pid}/fd/0`);
      if (stdin === `/dev/${ttyName}` && active()) process.kill(pid, "SIGWINCH");
    } catch {
      // A child may exit or close its terminal while the tree is traversed.
    }
  }
}

export async function processCwds(pids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(pids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  const entries = await Promise.all(
    unique.map(async (pid): Promise<readonly [number, string] | null> => {
      try {
        const cwd = await readlink(`/proc/${pid}/cwd`);
        return cwd.startsWith("/") && !cwd.endsWith(" (deleted)") ? [pid, cwd] : null;
      } catch {
        // A process can exit or become unreadable between two poll ticks.
        return null;
      }
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [number, string] => entry !== null));
}

/** AGY may create a new session; close only descendants still reading this pane. */
export async function terminateDetachedTerminalProcesses(
  shellPid: number,
  ttyName: string,
): Promise<void> {
  const pending = [shellPid];
  const seen = new Set<number>();
  const targets: number[] = [];
  while (pending.length && seen.size < 512) {
    const pid = pending.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
      pending.push(
        ...children
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((n) => n > 0),
      );
      if (pid === shellPid) continue;
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (
        Number(fields[3]) !== shellPid &&
        (await readlink(`/proc/${pid}/fd/0`)) === `/dev/${ttyName}`
      )
        targets.push(pid);
    } catch {
      /* Processes may leave while the pane is closing. */
    }
  }
  for (const pid of targets.reverse()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
}
