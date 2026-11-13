/* oxlint-disable eslint/no-await-in-loop -- Exercise consecutive handoffs on the same real PTY. */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { spawn } from "node-pty";
import { ptyInfo } from "../pty/info";
import { terminateProcessGroups } from "./linux";
import { linuxThreadWriterLocked, stopLinuxCodexForSwitch } from "./linux-codex-handoff";
import { linuxProcessStart } from "./linux-codex-session";

it.skipIf(process.platform !== "linux")(
  "switches writers twice on one real PTY without terminating its shell",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "deck-handoff-pty-"));
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const homes = ["codex1", "codex2"].map((account) => path.join(root, "profiles_codex", account));
    const script = path.join(root, "writer.py");
    await Promise.all(
      homes.map((home) => mkdir(path.join(home, "thread-writer-locks"), { recursive: true })),
    );
    // A test-owned CLI-shaped writer exercises real procfs, flock, process groups
    // and delayed SIGKILL without opening an account or making model requests.
    await writeFile(
      script,
      `import fcntl,os,signal,time
lock=open(os.path.join(os.environ['CODEX_HOME'],'thread-writer-locks','${sessionId}.lock'),'a')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
signal.signal(signal.SIGHUP,signal.SIG_IGN)
print('WRITER_READY',flush=True)
while True: time.sleep(1)
`,
    );
    const terminal = spawn("/bin/bash", ["--noprofile", "--norc"], {
      cwd: root,
      cols: 80,
      rows: 24,
      env: { ...process.env, PS1: "DECK_TEST_SHELL> " } as Record<string, string>,
    });
    const pane = {
      id: 7,
      pid: terminal.pid,
      ttyName: (terminal as unknown as { ptsName: string }).ptsName.replace("/dev/", ""),
      cwd: root,
    };
    const pids = new Map<number, string | null>();
    let output = "";
    const subscription = terminal.onData((chunk) => {
      output += chunk;
    });
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    try {
      await vi.waitFor(() => expect(output).toContain("DECK_TEST_SHELL>"));
      for (const [index, accountId] of ["codex2", "codex1"].entries()) {
        output = "";
        terminal.write(
          `CODEX_HOME=${quote(homes[index])} bash -c ${quote(`exec -a codex python3 ${quote(script)}`)}\r`,
        );
        await vi.waitFor(() => expect(output).toContain("WRITER_READY"));
        const [info] = await ptyInfo([pane], [], true);
        expect(info).toMatchObject({
          agent: "codex",
          account: `codex${index + 1}`,
          codexSessionId: sessionId,
          codexIdentityState: "ready",
        });
        pids.set(info.processId!, await linuxProcessStart(info.processId!));
        const lock = path.join(homes[index], "thread-writer-locks", `${sessionId}.lock`);
        expect(await linuxThreadWriterLocked(lock)).toBe(true);
        let stopped = false;
        const handoff = stopLinuxCodexForSwitch(
          pane,
          { processId: info.processId!, sessionId, accountId },
          async (group) => {
            expect(group).not.toBe(terminal.pid);
            terminateProcessGroups(group, null);
          },
          () => {},
        ).then(() => {
          stopped = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(stopped).toBe(false);
        await handoff;
        expect(await linuxThreadWriterLocked(lock)).toBe(false);
        await vi.waitFor(async () =>
          expect((await ptyInfo([pane], [], true))[0]).toMatchObject({
            kind: "idle-shell",
            processId: terminal.pid,
          }),
        );
      }
    } finally {
      for (const [pid, start] of pids) {
        try {
          if (start !== null && (await linuxProcessStart(pid)) === start)
            process.kill(pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
      subscription.dispose();
      terminal.kill();
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
