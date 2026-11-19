/** Portable review records. Page evidence never authorizes terminal input. */
export interface ReviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewCapture {
  kind: "element" | "region";
  url: string;
  title: string;
  capturedAt: number;
  viewport: { width: number; height: number; scale: number; scrollX: number; scrollY: number };
  rect: ReviewRect;
  selector: string;
  tag: string;
  text: string;
  label: string;
  role: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  components: string[];
  source: string | null;
  headings: string[];
  dialog: string;
  selectedTab: string;
}

export interface ReviewAnnotation {
  id: string;
  capture: ReviewCapture;
  comment: string;
  steps: string;
  screenshot: string;
  crop: string;
  git: { branch: string; commit: string; dirty: boolean } | null;
  reviewed: boolean;
}

export interface ReviewTarget {
  clientId: string;
  paneId: number;
  tabKey: number;
  root: string;
  agent: "codex" | "agy";
  sessionId: string;
  processId: number;
  terminalRef: string | null;
  startedAt: number;
  label: string;
}

export interface ReviewCandidate extends ReviewTarget {
  phase: string;
  confidence: string;
  attention: string;
  hasRun: boolean;
  changedAt: number;
  revision: number;
  inputPending: boolean;
}

export type ReviewDelivery = "sent" | "waiting" | "target-changed" | "staged" | "uncertain";
export interface ReviewBatch {
  id: string;
  createdAt: number;
  target: ReviewTarget;
  annotations: ReviewAnnotation[];
  status: "queued" | "dispatching" | "sent" | "staged" | "uncertain" | "cancelled";
  message: string;
  attemptId: string | null;
  deliveredAt: number | null;
}

export interface ReviewProject {
  id: string;
  root: string;
  url: string;
  selectedTarget: ReviewTarget | null;
  annotations: ReviewAnnotation[];
  batches: ReviewBatch[];
}

export interface ReviewSnapshot {
  project: ReviewProject;
  targets: ReviewCandidate[];
  page: { url: string; title: string; loading: boolean; error: string | null; mode: string };
  theme: Record<string, string>;
}

export function sameReviewTarget(a: ReviewTarget, b: ReviewTarget): boolean {
  return (
    a.clientId === b.clientId &&
    a.paneId === b.paneId &&
    a.tabKey === b.tabKey &&
    a.agent === b.agent &&
    a.sessionId === b.sessionId &&
    a.processId === b.processId &&
    a.terminalRef === b.terminalRef &&
    a.startedAt === b.startedAt
  );
}

export function reviewReady(candidate: ReviewCandidate): boolean {
  return (
    candidate.phase !== "exited" &&
    !candidate.inputPending &&
    (candidate.attention === "none" || candidate.attention === "completed")
  );
}

export const WEB_REVIEW_CHANNELS: ReadonlySet<string> = new Set([
  "web_review_state",
  "web_review_pairing",
  "web_review_revoke",
]);
