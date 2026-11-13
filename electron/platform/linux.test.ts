import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyDetachedTerminalResize, processCwds, shellLaunch } from "./linux";

afterEach(() => vi.unstubAllEnvs());

describe("Linux platform", () => {
  it.skipIf(process.platform !== "linux").each([false, true])(
    "notifies a detached CLI on this terminal (intermediate launcher: %s)",
    async (intermediateLauncher) => {
      const { spawn } = await import("node-pty");
      const childScript = `
        const stdout = process.stdout;
        process.on('SIGWINCH', () => console.log('RESIZED:' + stdout.columns));
        console.log('READY:' + process.pid);
        setInterval(() => {}, 1000);
      `;
      const launcherScript = `
        const {spawn} = require('node:child_process');
        const cli = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: 'inherit'});
        for (const sig of ['SIGTERM','SIGHUP']) process.on(sig, () => {cli.kill();process.exit();});
      `;
      const wrapper = `
        const {spawn} = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(intermediateLauncher ? launcherScript : childScript)}], {
          detached: true, stdio: 'inherit'
        });
        for (const sig of ['SIGTERM','SIGHUP']) process.on(sig, () => {
          child.kill(); process.exit();
        });
      `;
      const terminal = spawn(process.execPath, ["-e", wrapper], { cols: 80, rows: 24 });
      let output = "";
      const listener = terminal.onData((chunk) => (output += chunk));
      try {
        await vi.waitFor(() => expect(output).toContain("READY:"));
        const tty = (terminal as unknown as { ptsName: string }).ptsName.replace("/dev/", "");
        terminal.resize(100, 30);
        await notifyDetachedTerminalResize(terminal.pid, "pts/not-this-terminal");
        expect(output).not.toContain("RESIZED:");
        await notifyDetachedTerminalResize(terminal.pid, tty);
        await vi.waitFor(() => expect(output).toContain("RESIZED:100"));
      } finally {
        const pid = Number(output.match(/READY:(\d+)/)?.[1]);
        if (pid > 0) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Already exited.
          }
        }
        listener.dispose();
        terminal.kill();
      }
    },
  );

  it("starts the configured shell as a login shell", () => {
    vi.stubEnv("SHELL", "/bin/fish");
    expect(shellLaunch()).toEqual({ executable: "/bin/fish", args: ["-l"] });
  });

  it("falls back to bash when a desktop launcher has no SHELL", () => {
    vi.stubEnv("SHELL", "");
    expect(shellLaunch()).toEqual({ executable: "/bin/bash", args: ["-l"] });
  });

  it.skipIf(process.platform !== "linux")(
    "reads live cwd and tolerates missing processes",
    async () => {
      const cwds = await processCwds([process.pid, process.pid, -1, Number.NaN, 2_147_483_647]);
      expect(cwds).toEqual(new Map([[process.pid, process.cwd()]]));
    },
  );
});
