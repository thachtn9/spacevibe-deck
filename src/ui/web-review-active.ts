import { signal } from "@preact/signals";
import type { ReviewCandidate, ReviewTarget } from "../lib/web-review";

export const reviewCandidates = signal<ReviewCandidate[]>([]);
export const activeReviewTarget = signal<ReviewTarget | null>(null);
