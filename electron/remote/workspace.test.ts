import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock("../pty/persistent-client", () => ({
  PersistentPtyManager: class {
    reference = (id: number) => `00000000-0000-0000-0000-000000000001:${id}`;
    spawn = vi.fn(async () => {
      this.deps.register(1);
      return 1;
    });
    attach = vi.fn(async (_label: string, reference: string) => {
      const id = Number(reference.split(":")[1]);
      this.deps.register(id);
      return { id };
    });
    ownedRequest = vi.fn(async (_label: string, _id: number, method: string) =>
      method === "remoteSnapshot"
        ? {
            sequence: 0,
            screen: "ready",
            text: "ready",
            cols: 80,
            rows: 24,
            title: "",
            cwd: "/tmp",
          }
        : null,
    );
    request = vi.fn(async (method: string) =>
      method === "status"
        ? {
            epoch: "00000000-0000-0000-0000-000000000001",
            remoteWorkspace: true,
            remoteReferences: [this.reference(1)],
          }
        : {},
    );
    write = vi.fn(async () => {});
    resize = vi.fn(async () => {});
    kill = vi.fn(async () => {});
    disconnect = vi.fn();
    constructor(
      public deps: any,
      public directory: string,
    ) {
      service.instances.push(this);
    }
  },
}));
import { RemoteWorkspace } from "./workspace";

describe("independent remote workspace", () => {
  let root: string;
  const workspaces: RemoteWorkspace[] = [];
  const open = () => {
    const workspace = new RemoteWorkspace(root);
    workspaces.push(workspace);
    return workspace;
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-web-workspace-"));
    service.instances.length = 0;
  });
  afterEach(async () => {
    workspaces.splice(0).forEach((workspace) => workspace.dispose());
    await fs.rm(root, { recursive: true, force: true });
  });
  const create = (workspace: RemoteWorkspace) =>
    workspace.create({ path: "/tmp", agentId: null, accountId: null });

  it("uses a dedicated daemon namespace and rejects desktop identities", async () => {
    const workspace = open();
    await workspace.initialize();
    expect(service.instances[0].directory).toBe(path.join(root, "remote-workspace"));
    expect(workspace.sessions()).toEqual([]);
    await expect(workspace.screen("desktop-pane")).rejects.toMatchObject({ status: 404 });
    expect(service.instances[0].spawn).not.toHaveBeenCalled();
  });
  it("persists exact references and reattaches without spawning on GUI restart", async () => {
    const original = open();
    const session = await create(original);
    original.dispose();
    const restored = open();
    await restored.initialize();
    expect(restored.sessions()[0]).toMatchObject({
      id: session.id,
      generation: session.generation,
      path: "/tmp",
    });
    expect(service.instances[1].attach).toHaveBeenCalledWith(
      "remote-workspace",
      session.generation,
    );
    expect(service.instances[1].spawn).not.toHaveBeenCalled();
    expect(service.instances[0].kill).not.toHaveBeenCalled();
  });
  it("requires the exact generation before close and removes only the requested session", async () => {
    const workspace = open();
    const session = await create(workspace);
    await expect(workspace.closeSession(session.id, "old-reference")).rejects.toMatchObject({
      status: 412,
    });
    expect(service.instances[0].kill).not.toHaveBeenCalled();
    await workspace.closeSession(session.id, session.generation);
    expect(service.instances[0].kill).toHaveBeenCalledExactlyOnceWith("remote-workspace", 1);
    expect(workspace.sessions()).toEqual([]);
    expect(
      JSON.parse(await fs.readFile(path.join(root, "remote-workspace/workspace.json"), "utf8")),
    ).toEqual([]);
  });
  it("fails closed on an unreadable registry", async () => {
    await fs.mkdir(path.join(root, "remote-workspace"));
    await fs.writeFile(path.join(root, "remote-workspace/workspace.json"), "broken");
    await expect(create(open())).rejects.toThrow("could not be read");
    expect(service.instances[0].spawn).not.toHaveBeenCalled();
  });

  it.each(["structured", "plain"])(
    "launches the selected account after %s shell readiness and persists first",
    async (readiness) => {
      const workspace = open();
      const pty = service.instances[0];
      pty.spawn.mockImplementation(async () => {
        pty.deps.register(1);
        if (readiness === "structured") pty.deps.emitToOwner(1, "pty:prompt-ready", {});
        else pty.deps.emitToOwner(1, "pty:output", { id: 1, data: "user@host:~$ ", sequence: 1 });
        return 1;
      });
      pty.ownedRequest.mockResolvedValue("prepared explicit account");
      pty.write.mockImplementation(async () => {
        const rows = JSON.parse(
          await fs.readFile(path.join(root, "remote-workspace/workspace.json"), "utf8"),
        );
        expect(rows[0]).toMatchObject({
          account: "codex2",
          agentId: "codex",
          reference: pty.reference(1),
        });
      });
      await workspace.create({ path: "/tmp", agentId: "codex", accountId: "codex2" });
      expect(pty.ownedRequest).toHaveBeenCalledWith("remote-workspace", 1, "prepareLaunch", {
        command: "cli codex2",
      });
      expect(pty.write).toHaveBeenCalledExactlyOnceWith(
        "remote-workspace",
        1,
        "prepared explicit account\r",
      );
    },
  );

  it("arbitrates raw input between browsers without forwarding rejected keys", async () => {
    const workspace = open();
    const session = await create(workspace);
    const request = { generation: session.generation, client: "browser-one", cols: 80, rows: 24 };
    await workspace.terminal(session.id, { ...request, action: "claim" });
    await expect(
      workspace.terminal(session.id, {
        ...request,
        action: "write",
        client: "browser-two",
        data: "rejected",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(service.instances[0].write).not.toHaveBeenCalled();
    await workspace.terminal(session.id, { ...request, action: "write", data: "pwd\r" });
    expect(service.instances[0].write).toHaveBeenCalledExactlyOnceWith(
      "remote-workspace",
      1,
      "pwd\r",
    );
  });
});
