import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverAgents } from "./agents";

const scratch: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(shellBody: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deck-agent-discovery-"));
  scratch.push(dir);
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  const shell = path.join(dir, "shell");
  await writeFile(shell, `#!/bin/sh\n${shellBody}\n`);
  await chmod(shell, 0o755);
  vi.stubEnv("SHELL", shell);
  vi.stubEnv("PATH", bin);
  return bin;
}

describe.skipIf(process.platform !== "linux")("Linux discovery recovery", () => {
  it("runs the shell in its own session, away from the launching terminal", async () => {
    await fixture(
      'session=$(/bin/ps -o sid= -p $$); [ "$session" -eq "$$" ] || exit 1; printf "/custom/bin/claude\\n"',
    );
    await expect(discoverAgents([])).resolves.toEqual([
      { name: "claude", path: "/custom/bin/claude" },
    ]);
  });

  it("finds executable agents on PATH after the interactive shell receives SIGPIPE", async () => {
    const bin = await fixture("trap - PIPE; kill -PIPE $$");
    const agent = path.join(bin, "claude");
    await writeFile(agent, "#!/bin/sh\nexit 0\n");
    await chmod(agent, 0o755);
    await expect(discoverAgents([])).resolves.toEqual([{ name: "claude", path: agent }]);
  });

  it("rejects a failed probe when PATH cannot establish a useful fallback", async () => {
    const bin = await fixture("exit 1");
    await writeFile(path.join(bin, "claude"), "not an executable");
    await expect(discoverAgents([])).rejects.toMatchObject({ code: 1 });
  });

  it("closes stdin so startup reads cannot hang discovery", async () => {
    await fixture("read input; printf '/custom/bin/claude\\n'");
    await expect(discoverAgents([])).resolves.toEqual([
      { name: "claude", path: "/custom/bin/claude" },
    ]);
  });
});
