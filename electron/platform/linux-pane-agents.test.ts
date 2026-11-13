import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agySessionFromFiles, readLinuxPaneAgent } from "./linux-pane-agents";
import type { PtyInfo } from "../pty/info";

const SESSION = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const presence = (id: string) => `/profiles/acc5/home/.gemini/antigravity-cli/presence/${id}.lock`;
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "deck-pane-agent-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const info: PtyInfo = {
  id: 1,
  processId: 20,
  process: "python3",
  kind: "busy",
  agent: null,
  cwd: "/repo",
};
const pane = { id: 1, pid: 10, ttyName: "pts/2", cwd: "/repo" };

async function processFile(
  pid: number,
  command: string,
  children = "",
  tty = "/dev/pts/2",
  files: string[] = [],
) {
  const base = path.join(root, String(pid));
  await mkdir(path.join(base, "fd"), { recursive: true });
  await mkdir(path.join(base, "task", String(pid)), { recursive: true });
  await writeFile(path.join(base, "cmdline"), command + "\0");
  await writeFile(path.join(base, "task", String(pid), "children"), children);
  await symlink(tty, path.join(base, "fd/0"));
  await symlink("/repo/current", path.join(base, "cwd"));
  for (const [index, file] of files.entries())
    await symlink(file, path.join(base, "fd", String(index + 1)));
}

describe("Linux pane agent identity", () => {
  it("reads the automatically selected Codex account from the agent, not its launcher", async () => {
    await processFile(20, "python3\0/manager/codex_mgr.py", "30");
    await processFile(30, "/opt/codex");
    await writeFile(path.join(root, "20/environ"), "CODEX_HOME=/manager/profiles_codex/codex1\0");
    await writeFile(
      path.join(root, "30/environ"),
      "HOME=/home/test\0CODEX_HOME=/manager/profiles_codex/codex4\0",
    );
    expect(await readLinuxPaneAgent(info, pane, root)).toMatchObject({
      processId: 30,
      agent: "codex",
      account: "codex4",
    });
    await writeFile(path.join(root, "30/environ"), "CODEX_HOME=/manager/profiles_codex/codex2\0");
    expect((await readLinuxPaneAgent(info, pane, root)).account).toBe("codex2");
  });
  it("keeps missing or invalid profiles unknown while retaining agent detection", async () => {
    await processFile(20, "/opt/codex");
    expect(await readLinuxPaneAgent(info, pane, root)).toMatchObject({
      agent: "codex",
      account: null,
    });
    for (const home of ["/home/test/.codex", "/manager/profiles_codex/codex.invalid"]) {
      await writeFile(path.join(root, "20/environ"), `CODEX_HOME=${home}\0`);
      expect((await readLinuxPaneAgent(info, pane, root)).account).toBeNull();
    }
  });
  it("follows a detached AGY behind launchers and reads its own session lock", async () => {
    await processFile(20, "python3\0/manager/agy_mgr.py", "30");
    await processFile(30, "dbus-run-session", "40");
    await processFile(40, "/opt/agy", "", "/dev/pts/2", [presence(SESSION)]);
    await writeFile(path.join(root, "40/environ"), "HOME=/manager/profiles/acc5/home\0");
    expect(await readLinuxPaneAgent(info, pane, root)).toMatchObject({
      processId: 40,
      process: "agy",
      agent: "agy",
      kind: "agent",
      agySessionId: SESSION,
      account: "acc5",
      cwd: "/repo/current",
    });
  });
  it("does not borrow an agent from a different or closed terminal", async () => {
    await processFile(20, "python3", "30 40");
    await processFile(30, "/opt/agy", "", "/dev/pts/3", [presence(SESSION)]);
    await processFile(40, "/opt/agy", "", "/dev/pts/2 (deleted)", [presence(OTHER)]);
    expect(await readLinuxPaneAgent(info, pane, root)).toEqual(info);
  });
  it("keeps the outer agent when a tool launches another agent", async () => {
    await processFile(20, "/opt/codex", "30");
    await processFile(30, "/opt/agy", "", "/dev/pts/2", [presence(OTHER)]);
    expect(await readLinuxPaneAgent(info, pane, root)).toMatchObject({
      processId: 20,
      agent: "codex",
    });
  });
  it("never classifies background agents while the pane is at its shell", async () => {
    await processFile(20, "/bin/bash", "30");
    await processFile(30, "/opt/agy", "", "/dev/pts/2", [presence(SESSION)]);
    const shell = { ...info, processId: pane.pid, kind: "idle-shell" as const };
    expect(await readLinuxPaneAgent(shell, pane, root)).toEqual(shell);
  });
  it("follows a foreground Bash launcher without treating it as the idle pane shell", async () => {
    await processFile(20, "/bin/bash\0/home/test/.local/bin/cli", "30");
    await processFile(30, "/opt/codex");
    expect(await readLinuxPaneAgent({ ...info, kind: "idle-shell" }, pane, root)).toMatchObject({
      processId: 30,
      agent: "codex",
      kind: "agent",
    });
  });
  it("prefers presence over history files and refuses ambiguous identities", () => {
    const conversation = `/profiles/acc5/home/.gemini/antigravity-cli/conversations/${OTHER}.db`;
    expect(agySessionFromFiles([conversation, presence(SESSION)])).toBe(SESSION);
    expect(agySessionFromFiles([presence(SESSION), presence(OTHER)])).toBeNull();
    expect(agySessionFromFiles([conversation])).toBe(OTHER);
    expect(agySessionFromFiles([presence("invalid"), presence(SESSION) + " (deleted)"])).toBeNull();
  });
});
