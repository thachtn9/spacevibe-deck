import {
  reviewReady,
  sameReviewTarget,
  type ReviewCandidate,
  type ReviewDelivery,
  type ReviewTarget,
} from "../lib/web-review";

/** Conservative composer guard: editing keys never imply that a draft is empty. */
export class ReviewInputGuard {
  private states = new Map<number, { dirty: boolean; submitted: boolean; working: boolean }>();
  private generations = new Map<number, string>();
  observe(id: number, generation: string, phase: string, confidence: string): void {
    if (this.generations.get(id) !== generation) {
      const first = !this.generations.has(id);
      this.generations.set(id, generation);
      // Reattachment cannot prove that a composer has no pre-existing draft.
      // A newly observed working -> idle turn is the first safe automatic handoff.
      if (!first || !this.states.has(id))
        this.states.set(id, { dirty: false, submitted: true, working: false });
    }
    this.pending(id, phase, confidence);
  }
  prune(ids: readonly number[]): void {
    for (const id of this.generations.keys())
      if (!ids.includes(id)) {
        this.generations.delete(id);
        this.states.delete(id);
      }
  }
  input(id: number, data: string): void {
    const state = this.states.get(id) ?? { dirty: false, submitted: false, working: false };
    if (data === "\r") {
      state.submitted = true;
      state.working = false;
    } else {
      state.dirty = true;
      state.submitted = false;
    }
    this.states.set(id, state);
  }
  pending(id: number, phase: string, confidence: string): boolean {
    const state = this.states.get(id);
    if (!state) return false;
    if (state.submitted && phase === "working" && confidence === "explicit") state.working = true;
    if (state.submitted && state.working && phase === "idle" && confidence === "explicit")
      this.states.delete(id);
    return this.states.has(id);
  }
}

export async function deliverReviewPrompt(
  target: ReviewTarget,
  deps: {
    current(): ReviewCandidate | null;
    verify(): Promise<boolean>;
    drain(): Promise<void>;
    block(): () => void;
    write(stage: "paste" | "submit"): Promise<boolean>;
    submitted(): void;
    staged(): void;
  },
): Promise<ReviewDelivery> {
  const start = deps.current();
  if (!start || !sameReviewTarget(start, target)) return "target-changed";
  if (!reviewReady(start)) return "waiting";
  const revision = start.revision;
  const valid = () => {
    const c = deps.current();
    return c && sameReviewTarget(c, target) && c.revision === revision && reviewReady(c);
  };
  let unblock = () => {};
  let pasted = false,
    submitted = false;
  try {
    await deps.drain();
    if (!valid()) return "waiting";
    unblock = deps.block();
    if (!valid() || !(await deps.verify()) || !valid()) return "waiting";
    if (!(await deps.write("paste"))) return "target-changed";
    pasted = true;
    if (!valid() || !(await deps.verify()) || !valid()) return "staged";
    if (!(await deps.write("submit"))) return "staged";
    submitted = true;
    deps.submitted();
    return "sent";
  } catch {
    return "uncertain";
  } finally {
    unblock();
    if (pasted && !submitted) deps.staged();
  }
}
