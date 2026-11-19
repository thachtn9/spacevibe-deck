import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createReviewExtensionServer } from "./extension-server";
import { REVIEW_EXTENSION_ID } from "./extension-identity";
import { ReviewStorage } from "./storage";
import type { ReviewCandidate } from "../../src/lib/web-review";

vi.mock("electron", () => {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 100, height: 100 }),
    toPNG: () => Buffer.from("test image"),
    crop: () => image,
  };
  return { nativeImage: { createFromDataURL: () => image } };
});
let server: ReturnType<typeof createReviewExtensionServer> | undefined;
let directory: string;
afterEach(async () => {
  server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  directory = await mkdtemp(path.join(os.tmpdir(), "deck-review-send-"));
  const storage = new ReviewStorage(directory);
  const target: ReviewCandidate = {
    clientId: "client",
    paneId: 1,
    tabKey: 1,
    root: directory,
    agent: "codex",
    sessionId: "exact-session",
    processId: 123,
    terminalRef: "epoch:1",
    startedAt: 1,
    label: "Codex",
    phase: "idle",
    confidence: "explicit",
    attention: "completed",
    hasRun: true,
    changedAt: 10,
    revision: 1,
    inputPending: false,
  };
  const dispatch = vi.fn(async (): Promise<"sent" | "waiting"> => "sent");
  let selected: ReviewCandidate | null = target;
  server = createReviewExtensionServer({
    port: 0,
    storage,
    candidates: () => [target],
    active: () => selected,
    verify: async () => true,
    changed: () => {},
    dispatch,
  });
  await server.start();
  let token = "";
  const request = async (
    route: string,
    payload?: unknown,
    origin = `chrome-extension://${REVIEW_EXTENSION_ID}`,
  ) => {
    const response = await fetch(`http://127.0.0.1:${server!.port}${route}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Deck-Extension": REVIEW_EXTENSION_ID,
        Origin: origin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, value: await response.json() };
  };
  const connect = async () => {
    const r = await request("/connect", {});
    token = r.value.token;
    return r;
  };
  const batch = () => ({
    id: randomUUID(),
    root: target.root,
    clientId: target.clientId,
    paneId: 1,
    sessionId: target.sessionId,
    annotations: [
      {
        id: "note",
        comment: "Fix padding",
        steps: "",
        image: "data:image/png;base64,dGVzdA==",
        capture: {
          kind: "element",
          url: "http://localhost:3000/",
          title: "Test",
          viewport: { width: 100, height: 100, scale: 1, scrollX: 0, scrollY: 0 },
          rect: { x: 0, y: 0, width: 50, height: 30 },
          selector: "#target",
          tag: "button",
          text: "Save",
          label: "Save",
          role: "",
          attributes: {},
          styles: {},
          components: [],
          source: null,
          headings: [],
          dialog: "",
          selectedTab: "",
        },
      },
    ],
  });
  return {
    storage,
    target,
    dispatch,
    request,
    connect,
    batch,
    select: (v: ReviewCandidate | null) => {
      selected = v;
    },
  };
}
describe("immediate extension delivery", () => {
  it("connects without a code only from the pinned extension origin", async () => {
    const f = await fixture();
    expect((await f.request("/connect", {}, "https://example.test")).status).toBe(403);
    expect((await f.connect()).status).toBe(200);
    expect((await f.request("/state")).value.active.sessionId).toBe("exact-session");
  });
  it("sends immediately and retries the durable batch without duplicate terminal input", async () => {
    const f = await fixture();
    await f.connect();
    const b = f.batch();
    expect((await f.request("/batch", b)).value.status).toBe("sent");
    expect((await f.request("/batch", b)).value.status).toBe("sent");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.storage.projects()[0].batches[0].status).toBe("sent");
  });
  it("rejects busy agents without queueing and does not send after they become idle", async () => {
    const f = await fixture();
    await f.connect();
    f.target.phase = "working";
    f.dispatch.mockResolvedValue("waiting");
    expect((await f.request("/batch", f.batch())).value.status).toBe("cancelled");
    f.target.phase = "idle";
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.storage.projects()[0].batches[0].status).toBe("cancelled");
  });
  it("rejects a dirty composer or a target that is no longer Active", async () => {
    const f = await fixture();
    await f.connect();
    f.target.inputPending = true;
    f.dispatch.mockResolvedValue("waiting");
    expect((await f.request("/batch", f.batch())).value.status).toBe("cancelled");
    f.target.inputPending = false;
    f.select(null);
    expect((await f.request("/batch", f.batch())).status).toBe(400);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("preserves uncertain deliveries and never retries their terminal writes", async () => {
    const f = await fixture();
    await f.connect();
    f.dispatch.mockRejectedValue(new Error("lost reply"));
    const b = f.batch();
    expect((await f.request("/batch", b)).value.status).toBe("uncertain");
    expect((await f.request("/batch", b)).value.status).toBe("uncertain");
    expect((await f.request("/batch", f.batch())).status).toBe(400);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
});
