/** Resolve launcher descendants only while they still read this pane's terminal. */
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { inspectLinuxCodexSession } from "./linux-codex-session";
import type { PtyInfo } from "../pty/info";
import type { PtySessionSnapshot } from "../pty/session-store";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PRESENCE = new RegExp(`/antigravity-cli/presence/(${UUID})\\.lock$`, "i");
const CONVERSATION = new RegExp(`/antigravity-cli/conversations/(${UUID})\\.db$`, "i");

export function agySessionFromFiles(files: readonly string[]): string | null {
  for (const pattern of [PRESENCE, CONVERSATION]) {
    const ids = new Set(files.flatMap((file) => pattern.exec(file)?.[1] ?? []));
    if (ids.size > 0) return ids.size === 1 ? [...ids][0] : null;
  }
  return null;
}

export async function readLinuxPaneAgent(
  info: PtyInfo,
  pane: PtySessionSnapshot,
  procRoot = "/proc",
): Promise<PtyInfo> {
  if (
    info.processId === null ||
    info.kind === "unknown" ||
    (info.kind === "idle-shell" && info.processId === pane.pid)
  )
    return info;
  const pending = [info.processId];
  const seen = new Set<number>();
  while (pending.length > 0 && seen.size < 64) {
    const pid = pending.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const root = path.join(procRoot, String(pid));
    try {
      const [cmdline, stdin, children] = await Promise.all([
        readFile(path.join(root, "cmdline"), "utf8"),
        readlink(path.join(root, "fd/0")),
        readFile(path.join(root, "task", String(pid), "children"), "utf8"),
      ]);
      if (stdin !== `/dev/${pane.ttyName}`) continue;
      const binary = path.basename(cmdline.split("\0")[0]);
      if (binary === "agy" || binary === "codex") {
        let cwd = info.cwd;
        try {
          const current = await readlink(path.join(root, "cwd"));
          if (current.startsWith("/") && !current.endsWith(" (deleted)")) cwd = current;
        } catch {
          // A cwd may disappear while the CLI remains alive.
        }
        let account: string | null = null;
        try {
          const environment = await readFile(path.join(root, "environ"), "utf8");
          const key = binary === "codex" ? "CODEX_HOME=" : "HOME=";
          const home = environment
            .split("\0")
            .find((entry) => entry.startsWith(key))
            ?.slice(key.length);
          account =
            home?.match(/\/profiles(?:_codex)?\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/|$)/)?.[1] ??
            null;
        } catch {
          // An unreadable environment leaves the account unknown, not the agent.
        }
        const result: PtyInfo = {
          ...info,
          processId: pid,
          process: binary,
          kind: "agent",
          agent: binary,
          account,
          cwd,
        };
        if (binary === "codex") {
          const identity = await inspectLinuxCodexSession(pid, procRoot);
          return {
            ...result,
            codexSessionId: identity.sessionId,
            codexIdentityState: identity.state,
          };
        }
        const files = await readdir(path.join(root, "fd"));
        const targets = await Promise.all(
          files.map((fd) => readlink(path.join(root, "fd", fd)).catch(() => "")),
        );
        return { ...result, agySessionId: agySessionFromFiles(targets) };
      }
      pending.push(
        ...children
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      );
    } catch {
      // Launchers and their children can exit between process-table ticks.
    }
  }
  return info;
}
