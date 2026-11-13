import type { ChangesSnapshot } from "../host/git-changes-host";

export interface ReviewRepository {
  readonly path: string;
  readonly label: string;
}
export interface ReviewDiscovery {
  readonly root: string;
  readonly repositories: readonly ReviewRepository[];
  readonly truncated: boolean;
}
export interface ReviewCommit {
  readonly id: string;
  readonly shortId: string;
  readonly subject: string;
  readonly author: string;
  readonly date: string;
  readonly publication: "local" | "pushed" | "unknown";
  readonly inTarget?: boolean | null;
}
export interface ReviewSnapshot {
  readonly root: string;
  readonly branch: string | null;
  readonly target: string | null;
  readonly refs: readonly string[];
  readonly upstream: string | null;
  readonly unpushed: number | null;
  readonly ahead: number;
  readonly behind: number;
  readonly commits: readonly ReviewCommit[];
  readonly history?: readonly ReviewCommit[];
  readonly historyLimited?: boolean;
  readonly changes: ChangesSnapshot;
  readonly fetchRemote: string | null;
}
export interface ReviewFile {
  readonly path: string;
  readonly status: string;
}
export interface ReviewDiff {
  readonly files: readonly ReviewFile[];
  readonly patch: string;
  readonly truncated: boolean;
}
