import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteBroker } from "./broker";
import type { RemotePane, RemoteRpcRequest } from "../../src/lib/deck-remote";

const pane: RemotePane = {
  paneId: 7,
  tabKey: 1,
  title: "Codex",
  path: "/project",
  agentId: "codex",
  account: null,
  phase: "idle",
  attention: "none",
  startedAt: 1,
};

describe("remote window/pane routing", () => {
  let broker: RemoteBroker;
  let owner: string | null;
  let deliver: (label: string, request: RemoteRpcRequest) => void;
  beforeEach(() => {
    owner = "main";
    deliver = (label, request) =>
      queueMicrotask(() =>
        broker.finish(label, request.requestId, { text: "screen", paneId: pane.paneId }),
      );
    broker = new RemoteBroker({
      assertOwner: (id, label) => {
        if (id !== pane.paneId || owner !== label) throw new Error("wrong owner");
      },
      emit: (label, request) => {
        deliver(label, request);
        return true;
      },
      preferredWindow: () => "main",
    });
    broker.publish("main", [pane]);
  });
  it("preserves terminal ids across metadata updates but rejects an old agent generation", async () => {
    const original = broker.sessions()[0];
    broker.publish("main", [{ ...pane, title: "New title" }]);
    expect(broker.sessions()[0].id).toBe(original.id);
    broker.publish("main", [{ ...pane, agentId: "agy", startedAt: 2 }]);
    const current = broker.sessions()[0];
    expect(current.id).toBe(original.id);
    expect(current.generation).not.toBe(original.generation);
    await expect(
      broker.forSession(original.id, "input", "continue", original.generation),
    ).rejects.toThrow("changed");
    expect(
      ((await broker.forSession(current.id, "screen")) as { session: unknown }).session,
    ).toEqual(current);
    broker.close();
  });
  it("rechecks ownership before dispatch and refuses an old id after a renderer reload", async () => {
    const original = broker.sessions()[0];
    owner = null;
    expect(broker.sessions()).toEqual([]);
    await expect(broker.forSession(original.id, "screen")).rejects.toThrow("no longer available");
    owner = "main";
    broker.forgetWindow("main");
    broker.publish("main", [pane]);
    expect(broker.sessions()[0].id).not.toBe(original.id);
    await expect(
      broker.forSession(original.id, "input", "continue", original.generation),
    ).rejects.toThrow("no longer available");
    broker.close();
  });
  it("ignores replies from other windows and rejects a read when its generation changes in flight", async () => {
    deliver = (label, request) =>
      queueMicrotask(() => {
        broker.finish("other", request.requestId, { text: "wrong window" });
        broker.publish("main", [{ ...pane, agentId: "agy" }]);
        broker.finish(label, request.requestId, { text: "old screen" });
      });
    await expect(broker.forSession(broker.sessions()[0].id, "screen")).rejects.toThrow("changed");
    broker.close();
  });
  it("clears pending requests when their renderer goes away", async () => {
    deliver = vi.fn();
    const result = broker.forSession(broker.sessions()[0].id, "screen");
    broker.forgetWindow("main");
    await expect(result).rejects.toThrow("disconnected");
    broker.close();
  });
});
