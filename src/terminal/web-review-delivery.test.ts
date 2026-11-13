import { describe, expect, it, vi } from "vitest";
import { deliverReviewPrompt, ReviewInputGuard } from "./web-review-delivery";
import type { ReviewCandidate } from "../lib/web-review";

const target: ReviewCandidate = {
  clientId: "owner",
  paneId: 1,
  tabKey: 1,
  root: "/source",
  agent: "codex",
  sessionId: "exact",
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
function fixture() {
  let current = { ...target };
  const unblock = vi.fn();
  const deps = {
    current: () => current,
    verify: vi.fn(async () => true),
    drain: vi.fn(async () => {}),
    block: vi.fn(() => unblock),
    write: vi.fn(async (_stage: "paste" | "submit") => true),
    submitted: vi.fn(),
    staged: vi.fn(),
  };
  return {
    deps,
    unblock,
    set: (value: Partial<ReviewCandidate>) => {
      current = { ...current, ...value };
    },
  };
}
describe("guarded review delivery", () => {
  it("checks identity before paste and submit", async () => {
    const { deps, unblock } = fixture();
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
    expect(deps.verify).toHaveBeenCalledTimes(2);
    expect(deps.write.mock.calls).toEqual([["paste"], ["submit"]]);
    expect(unblock).toHaveBeenCalledOnce();
  });
  it("does not write to a replacement session", async () => {
    const { deps, set } = fixture();
    set({ sessionId: "other" });
    expect(await deliverReviewPrompt(target, deps)).toBe("target-changed");
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("does not paste into a busy agent or a composer with input", async () => {
    for (const value of [
      { phase: "working" },
      { inputPending: true },
      { attention: "requested" },
    ]) {
      const { deps, set } = fixture();
      set(value);
      expect(await deliverReviewPrompt(target, deps)).toBe("waiting");
      expect(deps.write).not.toHaveBeenCalled();
    }
  });
  it("does not submit after the state changes across paste", async () => {
    const { deps, set } = fixture();
    deps.write.mockImplementation(async () => {
      set({ revision: 4, attention: "requested" });
      return true;
    });
    expect(await deliverReviewPrompt(target, deps)).toBe("staged");
    expect(deps.write.mock.calls).toEqual([["paste"]]);
    expect(deps.staged).toHaveBeenCalledOnce();
  });
  it("leaves input alone if a pending user write drains first", async () => {
    const { deps, set } = fixture();
    deps.drain.mockImplementation(async () => set({ inputPending: true }));
    expect(await deliverReviewPrompt(target, deps)).toBe("waiting");
    expect(deps.block).not.toHaveBeenCalled();
  });
  it("reports uncertain transport without retrying", async () => {
    const { deps } = fixture();
    deps.write.mockRejectedValue(new Error("connection lost"));
    expect(await deliverReviewPrompt(target, deps)).toBe("uncertain");
    expect(deps.write).toHaveBeenCalledTimes(1);
  });
});
describe("composer input guard", () => {
  it("holds an idle reattached composer until a new observed turn completes", () => {
    const guard = new ReviewInputGuard();
    guard.observe(1, "first-process", "idle", "explicit");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
    guard.observe(1, "first-process", "working", "explicit");
    guard.observe(1, "first-process", "idle", "explicit");
    expect(guard.pending(1, "idle", "explicit")).toBe(false);
    guard.observe(1, "replacement-process", "idle", "explicit");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
  });
  it("keeps edited text pending until a submitted turn has actually worked and completed", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "draft");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
    guard.input(1, "\r");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
    expect(guard.pending(1, "working", "explicit")).toBe(true);
    expect(guard.pending(1, "idle", "explicit")).toBe(false);
  });
  it("does not clear a draft typed while another turn runs", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "draft");
    guard.pending(1, "working", "explicit");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
  });
});
