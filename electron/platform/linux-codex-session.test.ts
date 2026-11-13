import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  inspectLinuxCodexSession,
  linuxCodexSession,
  linuxProcessStart,
} from "./linux-codex-session";

it("identifies only the pane's own open Codex rollout, excluding subagents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-codex-proc-"));
  try {
    await mkdir(path.join(root, "42/task/42"), { recursive: true });
    await mkdir(path.join(root, "42/fd"));
    await mkdir(path.join(root, "42/fdinfo"));
    await writeFile(path.join(root, "42/cmdline"), "codex\0--no-daemon\0");
    await writeFile(path.join(root, "42/task/42/children"), "");
    const main = "11111111-1111-4111-8111-111111111111";
    const child = "22222222-2222-4222-8222-222222222222";
    for (const [id, source, fd] of [
      [main, "cli", "5"],
      [child, { subagent: {} }, "6"],
    ] as const) {
      const file = path.join(root, `rollout-date-${id}.jsonl`);
      await writeFile(
        file,
        JSON.stringify({ type: "session_meta", payload: { id, source } }) + "\n",
      );
      await symlink(file, path.join(root, "42/fd", fd));
      await writeFile(path.join(root, "42/fdinfo", fd), "flags:\t0100001\n");
    }
    expect(await linuxCodexSession(42, root)).toBe(main);
    expect(await linuxCodexSession(99, root)).toBeNull();
    await symlink(`/profile/thread-writer-locks/${child}.lock`, path.join(root, "42/fd/7"));
    await writeFile(
      path.join(root, "42/fdinfo/7"),
      "lock:\t1: FLOCK  ADVISORY  WRITE 42 08:01:123 0 EOF\n",
    );
    // The child writer can outlive its rollout descriptor. The main CLI
    // rollout still proves which conversation is displayed in the TUI.
    await rm(path.join(root, "42/fd/6"));
    expect(await linuxCodexSession(42, root)).toBe(main);
    await rm(path.join(root, "42/fd/7"));
    await rm(path.join(root, "42/fd/5"));
    expect(await linuxCodexSession(42, root)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not borrow a descendant daemon's session, even when it has only one writer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-codex-daemon-"));
  try {
    await mkdir(path.join(root, "42/task/42"), { recursive: true });
    await mkdir(path.join(root, "42/fd"));
    await writeFile(path.join(root, "42/task/42/children"), "43");
    await writeFile(path.join(root, "42/cmdline"), "codex\0");
    await mkdir(path.join(root, "43/fd"), { recursive: true });
    await writeFile(path.join(root, "43/cmdline"), "codex\0app-server\0");
    await symlink(
      "/profile/thread-writer-locks/11111111-1111-4111-8111-111111111111.lock",
      path.join(root, "43/fd/5"),
    );
    expect(await linuxCodexSession(42, root)).toBeNull();
    expect(await inspectLinuxCodexSession(43, root)).toEqual({ sessionId: null, state: "shared" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires an acquired writer lock, not an open lock file or read-only rollout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-codex-lock-"));
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    await mkdir(path.join(root, "42/fd"), { recursive: true });
    await mkdir(path.join(root, "42/fdinfo"));
    await writeFile(path.join(root, "42/cmdline"), "codex\0--no-daemon\0");
    await symlink(`/profile/thread-writer-locks/${id}.lock`, path.join(root, "42/fd/5"));
    await writeFile(path.join(root, "42/fdinfo/5"), "flags:\t02100002\n");
    const rollout = path.join(root, `rollout-date-${id}.jsonl`);
    await writeFile(
      rollout,
      JSON.stringify({ type: "session_meta", payload: { id, source: "cli" } }),
    );
    await symlink(rollout, path.join(root, "42/fd/6"));
    await writeFile(path.join(root, "42/fdinfo/6"), "flags:\t0100000\n");
    expect(await linuxCodexSession(42, root)).toBeNull();
    await writeFile(
      path.join(root, "42/fdinfo/5"),
      "lock:\t1: FLOCK  ADVISORY  WRITE 42 08:01:123 0 EOF\n",
    );
    expect(await linuxCodexSession(42, root)).toBe(id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("diagnoses only this invocation's lock failure without inventing a live session id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-codex-blocked-"));
  const log = path.join(root, "terminal-runtime/epoch/7/codex-log/codex-tui.log");
  try {
    await mkdir(path.dirname(log), { recursive: true });
    await mkdir(path.join(root, "42/fd"), { recursive: true });
    await mkdir(path.join(root, "42/fdinfo"));
    await writeFile(path.join(root, "42/cmdline"), "codex\0--no-daemon\0");
    await writeFile(
      path.join(root, "42/stat"),
      `42 (codex) S ${Array(18).fill("0").join(" ")} 10000\n`,
    );
    await writeFile(path.join(root, "uptime"), "110 100");
    await symlink(log, path.join(root, "42/fd/5"));
    await writeFile(path.join(root, "42/fdinfo/5"), "flags:\t0100001\n");
    const failure =
      " ERROR failed to initialize thread persistence: thread-store conflict: thread 11111111-1111-4111-8111-111111111111 already has an active writer\n";
    await writeFile(log, new Date(Date.now() - 60000).toISOString() + failure);
    expect((await inspectLinuxCodexSession(42, root)).state).toBe("unidentified");
    await writeFile(log, new Date().toISOString() + failure);
    expect(await inspectLinuxCodexSession(42, root)).toEqual({ sessionId: null, state: "locked" });
    await writeFile(
      path.join(root, "42/stat"),
      `42 (codex) Z ${Array(18).fill("0").join(" ")} 10000\n`,
    );
    expect(await linuxProcessStart(42, root)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
