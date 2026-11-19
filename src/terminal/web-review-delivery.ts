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
      // Require a proven empty composer or a newly observed completed turn.
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
    // Focus, mouse and terminal query replies do not edit the composer. In
    // particular, losing focus after Enter must not turn submitted input dirty.
    /* oxlint-disable eslint/no-control-regex -- Terminal protocol reports contain ESC bytes. */
    data = data
      .replace(/\x1b\[(?:[IO]|<\d+;\d+;\d+[Mm]|\d+;\d+;\d+M|\d+;\d+R|[?>]?[\d;]*c)/g, "")
      .replace(/\x1b\[M[\s\S]{3}/g, "")
      .replace(/\x1b(?:\[(?:[\d;]*[CDHF])|O[CDHF])/g, "");
    /* oxlint-enable eslint/no-control-regex */
    if (!data) return;
    const state = this.states.get(id) ?? { dirty: false, submitted: false, working: false };
    if (!data.includes("\x1b[200~") && /\r\n?$/.test(data)) {
      state.dirty = true;
      state.submitted = true;
      state.working = false;
    } else {
      state.dirty = true;
      state.submitted = false;
    }
    this.states.set(id, state);
  }
  pending(
    id: number,
    phase: string,
    confidence: string,
    composerEmpty = false,
    processBound = false,
  ): boolean {
    const state = this.states.get(id);
    // A manually launched shared client has no task lifecycle on reattachment.
    // Its synthetic guard is not evidence of a user draft.
    if (processBound && state && !state.dirty && !state.working) {
      this.states.delete(id);
      return false;
    }
    if (
      composerEmpty &&
      phase === "idle" &&
      confidence === "explicit" &&
      (!state || !state.submitted || !state.dirty)
    ) {
      this.states.delete(id);
      return false;
    }
    if (!state) return false;
    // Submitted input is owned by the CLI, including its in-flight queue.
    if (state.submitted && state.dirty) return false;
    if (state.submitted && phase === "working" && (confidence === "explicit" || processBound))
      state.working = true;
    if (
      state.submitted &&
      state.working &&
      phase === "idle" &&
      (confidence === "explicit" || processBound)
    )
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
  const valid = () => {
    const c = deps.current();
    return c && sameReviewTarget(c, target) && reviewReady(c);
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
