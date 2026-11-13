import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ReviewStorage, localReviewUrl } from "./storage";
import { ReviewQueue } from "./queue";
import type { ReviewAnnotation, ReviewBatch, ReviewCandidate } from "../../src/lib/web-review";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const candidate: ReviewCandidate = {
  clientId: "owner",
  paneId: 1,
  tabKey: 1,
  root: "/source",
  agent: "codex",
  sessionId: "exact-session",
  processId: 42,
  terminalRef: "epoch:1",
  startedAt: 1,
  label: "Codex",
  phase: "idle",
  confidence: "explicit",
  attention: "completed",
  hasRun: true,
  changedAt: 10,
  revision: 3,
  inputPending: false,
};
const annotation = {
  id: "note",
  comment: "Enlarge this button",
  steps: "",
  capture: {
    url: "http://localhost:3000/",
    title: "Settings",
    kind: "element",
    label: "Save",
    tag: "button",
  },
  screenshot: "/screen.png",
  crop: "/crop.png",
} as ReviewAnnotation;
function batch(_label: string): ReviewBatch {
  return {
    id: randomUUID(),
    createdAt: 1,
    target: candidate,
    annotations: [annotation],
    status: "queued",
    message: "",
    attemptId: null,
    deliveredAt: null,
  };
}
async function fixture(batches = [batch("one")]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deck-review-queue-"));
  directories.push(dir);
  const storage = new ReviewStorage(dir),
    project = await storage.open(dir);
  await storage.edit(project.id, (p) => {
    p.batches = batches;
  });
  const live = { ...candidate };
  const dispatch = vi.fn(async () => "sent" as const),
    verify = vi.fn(async () => true);
  const queue = new ReviewQueue({
    storage,
    candidates: () => [live],
    dispatch,
    verify,
    changed: () => {},
    now: () => 100,
  });
  return { dir, storage, project, live, dispatch, verify, queue };
}

describe("web review queue", () => {
  it("waits while working and sends exactly once after confirmed idle", async () => {
    const f = await fixture();
    f.live.phase = "working";
    await f.queue.tick();
    expect(f.dispatch).not.toHaveBeenCalled();
    f.live.phase = "idle";
    await f.queue.tick();
    await f.queue.tick();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.storage.project(f.project.id).batches[0].status).toBe("sent");
  });
  it("does not use another conversation in the same pane", async () => {
    const f = await fixture();
    f.live.sessionId = "replacement";
    await f.queue.tick();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("withholds input when a draft or an unconfirmed idle signal exists", async () => {
    const f = await fixture();
    f.live.inputPending = true;
    await f.queue.tick();
    f.live.inputPending = false;
    f.live.confidence = "inferred";
    await f.queue.tick();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("reserves on disk before side effects and waits for another turn between batches", async () => {
    const f = await fixture([batch("one"), batch("two")]);
    f.dispatch.mockImplementation(async () => {
      const disk = JSON.parse(await readFile(path.join(f.dir, "workspace.json"), "utf8"));
      expect(
        disk.projects[0].batches.some(
          (b: ReviewBatch) => b.status === "dispatching" && b.attemptId,
        ),
      ).toBe(true);
      return "sent";
    });
    await f.queue.tick();
    await f.queue.tick();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    f.live.changedAt = 150;
    await f.queue.tick();
    expect(f.dispatch).toHaveBeenCalledTimes(2);
  });
  it("never replays a reservation left by a crash", async () => {
    const b = batch("interrupted");
    b.status = "dispatching";
    b.attemptId = "attempt";
    const f = await fixture([b]);
    const restored = new ReviewStorage(f.dir);
    await restored.load();
    expect(restored.project(f.project.id).batches[0].status).toBe("uncertain");
    const dispatch = vi.fn();
    await new ReviewQueue({
      storage: restored,
      candidates: () => [candidate],
      dispatch,
      verify: async () => true,
      changed: () => {},
    }).tick();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("holds later batches until an uncertain delivery is checked", async () => {
    const unresolved = batch("uncertain");
    unresolved.status = "uncertain";
    const f = await fixture([unresolved, batch("next")]);
    await f.queue.tick();
    expect(f.dispatch).not.toHaveBeenCalled();
    await f.storage.edit(f.project.id, (p) => {
      p.batches[0].status = "cancelled";
    });
    await f.queue.tick();
    expect(f.dispatch).toHaveBeenCalledOnce();
  });
  it("keeps unreadable storage intact", async () => {
    const f = await fixture();
    const file = path.join(f.dir, "workspace.json");
    await writeFile(file, "broken snapshot");
    await expect(new ReviewStorage(f.dir).open(f.dir)).rejects.toThrow(/JSON|Unexpected token/);
    expect(await readFile(file, "utf8")).toBe("broken snapshot");
  });
  it("does not dispatch a cancelled batch while verification is in flight", async () => {
    const f = await fixture();
    f.verify.mockImplementation(async () => {
      await f.storage.edit(f.project.id, (p) => {
        p.batches[0].status = "cancelled";
      });
      return true;
    });
    await f.queue.tick();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});

describe("local review URLs", () => {
  it("keeps project ports and paths", () =>
    expect(localReviewUrl("localhost:4200/admin")).toBe("http://localhost:4200/admin"));
  it.each([
    "https://example.com",
    "file:///tmp/file",
    "http://localhost@evil.test",
    "http://user:password@localhost:3000",
  ])("refuses %s", (url) =>
    expect(() => localReviewUrl(url)).toThrow(/local HTTP|localhost|valid URL/),
  );
});
