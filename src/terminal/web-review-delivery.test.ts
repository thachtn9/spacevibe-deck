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
  it("does not mistake a lifecycle revision change for a changed target", async () => {
    const { deps, set } = fixture();
    deps.verify.mockImplementation(async () => {
      set({ phase: "working", revision: 10 });
      return true;
    });
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
  });
  it("sends again after Enter, focus loss and mouse activity on the terminal", async () => {
    const guard = new ReviewInputGuard();
    guard.observe(1, "process", "idle", "inferred");
    guard.pending(1, "idle", "inferred", false, true);
    const { deps, set } = fixture();
    deps.submitted.mockImplementation(() => guard.input(1, "\r"));
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
    for (const report of ["\x1b[O", "\x1b[I", "\x1b[<0;20;5M", "\x1b[<0;20;5m", "\x1b[M !!"]) {
      guard.input(1, report);
    }
    set({ phase: "working", inputPending: guard.pending(1, "working", "inferred", false, true) });
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
    guard.input(1, "actual draft");
    guard.input(1, "\x1b[O");
    set({ inputPending: guard.pending(1, "idle", "inferred", false, true) });
    expect(await deliverReviewPrompt(target, deps)).toBe("waiting");
  });
  it("sends consecutive requests while the agent is working", async () => {
    const { deps, set } = fixture();
    set({ phase: "working", confidence: "explicit" });
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
    expect(deps.write).toHaveBeenCalledTimes(4);
  });
  it("sends to a process-bound shared client without an explicit lifecycle", async () => {
    const { deps, set } = fixture();
    const shared = { ...target, sessionId: "process-42-123" };
    set({ sessionId: shared.sessionId, confidence: "inferred", phase: "idle" });
    expect(await deliverReviewPrompt(shared, deps)).toBe("sent");
  });
  it("allows a fresh explicitly idle agent before its first turn", async () => {
    const { deps, set } = fixture();
    set({ hasRun: false, attention: "none" });
    expect(await deliverReviewPrompt(target, deps)).toBe("sent");
  });
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
  it("does not paste into a composer with input or an approval prompt", async () => {
    for (const value of [{ inputPending: true }, { attention: "requested" }]) {
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
  it("treats bracketed multiline paste as a draft and coalesced Enter as submitted", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "\x1b[200~draft\r\x1b[201~");
    expect(guard.pending(1, "working", "explicit")).toBe(true);
    guard.input(1, "\r\x1b[O");
    expect(guard.pending(1, "working", "explicit")).toBe(false);
    guard.input(1, "\x1b[A"); // History recall may insert a draft.
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
  });
  it("releases a submitted shared-client turn after observed work completes", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "\r");
    expect(guard.pending(1, "idle", "inferred", false, true)).toBe(false);
    expect(guard.pending(1, "working", "inferred", false, true)).toBe(false);
    expect(guard.pending(1, "idle", "inferred", false, true)).toBe(false);
  });
  it("does not mistake an unobserved shared client's lifecycle for a draft", () => {
    const guard = new ReviewInputGuard();
    guard.observe(1, "process", "idle", "inferred");
    expect(guard.pending(1, "idle", "inferred", false, true)).toBe(false);
    guard.input(1, "draft");
    expect(guard.pending(1, "idle", "inferred", false, true)).toBe(true);
  });
  it("unblocks reattachment only with an explicitly idle empty composer", () => {
    const guard = new ReviewInputGuard();
    guard.observe(1, "process", "idle", "explicit");
    expect(guard.pending(1, "idle", "inferred", true)).toBe(true);
    expect(guard.pending(1, "working", "explicit", true)).toBe(true);
    expect(guard.pending(1, "idle", "explicit", true)).toBe(false);
  });
  it("allows a deleted draft and hands submitted input to the CLI", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "draft");
    expect(guard.pending(1, "idle", "explicit", true)).toBe(false);
    guard.input(1, "\r");
    expect(guard.pending(1, "idle", "explicit", true)).toBe(false);
  });
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
  it("blocks edited drafts and releases input once submitted", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "draft");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
    guard.input(1, "\r");
    expect(guard.pending(1, "idle", "explicit")).toBe(false);
    expect(guard.pending(1, "working", "explicit")).toBe(false);
    expect(guard.pending(1, "idle", "explicit")).toBe(false);
  });
  it("does not clear a draft typed while another turn runs", () => {
    const guard = new ReviewInputGuard();
    guard.input(1, "draft");
    guard.pending(1, "working", "explicit");
    expect(guard.pending(1, "idle", "explicit")).toBe(true);
  });
});
