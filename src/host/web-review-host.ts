import { invoke, listen } from "./bridge";
import type { ReviewCandidate, ReviewDelivery, ReviewTarget } from "../lib/web-review";

export const webReviewHost = {
  get available(): boolean {
    return "__deckHost" in globalThis;
  },
  active(): Promise<ReviewTarget | null> {
    return invoke("web_review_active");
  },
  activate(paneId: number | null): Promise<ReviewTarget | null> {
    return invoke("web_review_activate", { paneId });
  },
  onActive(callback: (target: ReviewTarget | null) => void): Promise<() => void> {
    return listen("web-review:active", ({ payload }) => callback(payload as ReviewTarget | null));
  },
  open(root: string, configure = false): Promise<void> {
    return invoke("web_review_open", { root, configure });
  },
  publish(clientId: string, rows: ReviewCandidate[], colors: unknown): Promise<void> {
    return invoke("web_review_publish", { clientId, rows, colors });
  },
  forget(clientId: string): Promise<void> {
    return invoke("web_review_forget", { clientId });
  },
  onDelivery(
    callback: (request: { target: ReviewTarget; attemptId: string }) => void,
  ): Promise<() => void> {
    return listen("web-review:deliver", ({ payload }) =>
      callback(payload as { target: ReviewTarget; attemptId: string }),
    );
  },
  write(attemptId: string, stage: "paste" | "submit", revision: number): Promise<boolean> {
    return invoke("web_review_write", { attemptId, stage, revision });
  },
  result(attemptId: string, outcome: ReviewDelivery): Promise<void> {
    return invoke("web_review_result", { attemptId, outcome });
  },
};
