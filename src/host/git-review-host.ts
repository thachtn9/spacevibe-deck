import { invoke } from "./bridge";
import type { ReviewDiff, ReviewDiscovery, ReviewSnapshot } from "../lib/git-review";

export const discoverReview = (root: string): Promise<ReviewDiscovery> =>
  invoke("git_review_discover", { root });
export const readReview = (root: string, target?: string): Promise<ReviewSnapshot> =>
  invoke("git_review_read", { root, target });
export const readReviewDiff = (
  root: string,
  commit: string | null,
  path?: string,
): Promise<ReviewDiff> => invoke("git_review_diff", { root, commit, path });
export const fetchReview = (root: string, remote: string): Promise<void> =>
  invoke("git_review_fetch", { root, remote });
