import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { RemoteTerminalActions } from "./terminal-actions";

it("persists keyboard sequence before side effects and refuses replay after restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-terminal-ledger-"));
  const file = path.join(root, "actions.json");
  const client = `${Date.now()}-${"b".repeat(32)}`;
  try {
    const actions = new RemoteTerminalActions(file);
    const send = vi.fn(async () => {
      expect(JSON.parse(await fs.readFile(file, "utf8"))[0].sequence).toBe(1);
      return "sent";
    });
    await actions.run("token", client, 1, send);
    await expect(actions.run("token", client, 1, send)).rejects.toThrow("reserved");
    const restored = new RemoteTerminalActions(file);
    await expect(restored.run("token", client, 1, send)).rejects.toThrow("reserved");
    await restored.run("token", client, 2, async () => "next");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
