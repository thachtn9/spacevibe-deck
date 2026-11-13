/* oxlint-disable eslint/no-await-in-loop -- Reservations and deliveries must remain ordered. */
import { randomUUID } from "node:crypto";
import {
  reviewReady,
  sameReviewTarget,
  type ReviewCandidate,
  type ReviewDelivery,
  type ReviewTarget,
} from "../../src/lib/web-review";
import type { ReviewStorage } from "./storage";

export class ReviewQueue {
  private running = false;
  private stopped = false;
  constructor(
    private readonly deps: {
      storage: ReviewStorage;
      candidates(): ReviewCandidate[];
      verify(target: ReviewTarget): Promise<boolean>;
      dispatch(target: ReviewTarget, attemptId: string, prompt: string): Promise<ReviewDelivery>;
      changed(): void;
      now?: () => number;
    },
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const now = this.deps.now ?? Date.now;
    try {
      await this.deps.storage.load();
      // Each target's first unsent batch owns its queue position, even while blocked.
      const seen = new Set<string>();
      for (const project of this.deps.storage.projects()) {
        for (const batch of project.batches) {
          if (batch.status !== "queued" || this.stopped) continue;
          const key = `${batch.target.clientId}:${batch.target.paneId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const unresolved = this.deps.storage
            .projects()
            .some((p) =>
              p.batches.some(
                (b) =>
                  ["dispatching", "staged", "uncertain"].includes(b.status) &&
                  b.target.agent === batch.target.agent &&
                  b.target.sessionId === batch.target.sessionId,
              ),
            );
          if (unresolved) continue;
          const candidate = this.deps.candidates().find((c) => sameReviewTarget(c, batch.target));
          const previous = project.batches
            .filter(
              (b) =>
                b.deliveredAt &&
                b.status !== "cancelled" &&
                sameReviewTarget(b.target, batch.target),
            )
            .at(-1);
          if (
            !candidate ||
            !reviewReady(candidate) ||
            batch.annotations.some((a) => !a.comment.trim()) ||
            (previous &&
              (previous.status !== "sent" || candidate.changedAt <= previous.deliveredAt!))
          )
            continue;
          if (!(await this.deps.verify(batch.target)) || this.stopped) continue;
          const prompt = await this.deps.storage.prepare(project, batch);
          const attemptId = randomUUID();
          const reserved = await this.deps.storage.edit(project.id, (p) => {
            const current = p.batches.find((b) => b.id === batch.id);
            // Editing or cancelling during preparation invalidates this snapshot.
            if (
              !current ||
              current.status !== "queued" ||
              JSON.stringify(current) !== JSON.stringify(batch)
            )
              return false;
            current.status = "dispatching";
            current.attemptId = attemptId;
            current.message = "Delivering to the selected conversation…";
            return true;
          });
          if (!reserved) continue;
          this.deps.changed();
          let outcome: ReviewDelivery = "uncertain";
          try {
            outcome = this.stopped
              ? "waiting"
              : await this.deps.dispatch(batch.target, attemptId, prompt);
          } catch {
            /* A lost reply is not evidence that no input reached the agent. */
          }
          await this.deps.storage.edit(project.id, (p) => {
            const current = p.batches.find((b) => b.id === batch.id)!;
            current.status =
              outcome === "waiting" || outcome === "target-changed" ? "queued" : outcome;
            current.deliveredAt = current.status === "queued" ? null : now();
            current.message = {
              sent: "Sent to the conversation. Review the result in the web page.",
              waiting: "Waiting for an idle conversation with no pending input.",
              "target-changed": "The selected session changed. Select its replacement explicitly.",
              staged:
                "Inserted but not submitted. Check the agent composer; this batch will not be sent again.",
              uncertain:
                "Delivery could not be confirmed. Check the conversation; this batch will not be retried automatically.",
            }[outcome];
          });
          this.deps.changed();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
