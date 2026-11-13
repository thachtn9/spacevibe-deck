import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  reviewReady,
  sameReviewTarget,
  type ReviewCandidate,
  type ReviewDelivery,
  type ReviewTarget,
} from "../../src/lib/web-review";
import { ReviewStorage, localReviewUrl, reviewText } from "./storage";
import { ReviewQueue } from "./queue";
import { ReviewWindow } from "./window";
import { createReviewExtensionServer } from "./extension-server";

interface Owner {
  label: string;
  rows: ReviewCandidate[];
  at: number;
}
interface Pending {
  target: ReviewTarget;
  label: string;
  prompt: string;
  pasted: boolean;
  submitted: boolean;
  writing: boolean;
  resolve(result: ReviewDelivery): void;
}

function validateCandidate(raw: unknown, clientId: string): ReviewCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as ReviewCandidate;
  if (
    c.clientId !== clientId ||
    !Number.isSafeInteger(c.paneId) ||
    c.paneId < 1 ||
    !Number.isSafeInteger(c.tabKey) ||
    !Number.isSafeInteger(c.processId) ||
    c.processId < 1 ||
    !["codex", "agy"].includes(c.agent) ||
    typeof c.sessionId !== "string" ||
    !/^[a-zA-Z0-9._-]{1,160}$/.test(c.sessionId) ||
    typeof c.root !== "string" ||
    !path.isAbsolute(c.root) ||
    typeof c.label !== "string" ||
    c.label.length > 300 ||
    !Number.isFinite(c.startedAt) ||
    !Number.isFinite(c.changedAt) ||
    !Number.isSafeInteger(c.revision) ||
    (c.terminalRef !== null && (typeof c.terminalRef !== "string" || c.terminalRef.length > 100))
  )
    return null;
  return {
    ...c,
    root: c.root.slice(0, 4096),
    phase: String(c.phase).slice(0, 30),
    confidence: String(c.confidence).slice(0, 30),
    attention: String(c.attention).slice(0, 30),
    hasRun: c.hasRun === true,
    inputPending: c.inputPending !== false,
  };
}

export function registerWebReview(deps: {
  userData: string;
  preload: string;
  pagePreload: string;
  rendererUrl: string;
  labelOf(event: IpcMainInvokeEvent): string;
  assertOwner(paneId: number, label: string): void;
  verify(target: ReviewTarget, label: string): Promise<boolean>;
  write(label: string, paneId: number, data: string): Promise<unknown> | void;
  emit(label: string, event: string, payload: unknown): boolean;
}) {
  const storage = new ReviewStorage(path.join(deps.userData, "web-review"));
  const owners = new Map<string, Owner>(),
    pending = new Map<string, Pending>();
  const canonical = new Map<string, string>();
  let theme: Record<string, string> = {};
  const candidates = () =>
    [...owners.values()].filter((o) => Date.now() - o.at < 8000).flatMap((o) => o.rows);
  const ownerFor = (target: ReviewTarget) => {
    const owner = owners.get(target.clientId);
    return owner &&
      Date.now() - owner.at < 8000 &&
      owner.rows.some((c) => sameReviewTarget(c, target))
      ? owner
      : null;
  };
  async function verify(target: ReviewTarget): Promise<boolean> {
    const owner = ownerFor(target);
    if (!owner) return false;
    try {
      deps.assertOwner(target.paneId, owner.label);
      return await deps.verify(target, owner.label);
    } catch {
      return false;
    }
  }
  const window = new ReviewWindow({
    ...deps,
    storage,
    snapshot: (project) => ({
      targets: candidates().filter((c) => c.root === project.root),
      theme,
    }),
  });
  const queue = new ReviewQueue({
    storage,
    candidates,
    verify,
    changed: () => window.changed(),
    dispatch: (target, attemptId, prompt) =>
      new Promise<ReviewDelivery>((resolve) => {
        const owner = ownerFor(target);
        if (!owner) {
          resolve("target-changed");
          return;
        }
        const timer = setTimeout(() => finish("uncertain"), 25_000);
        const finish = (result: ReviewDelivery) => {
          clearTimeout(timer);
          pending.delete(attemptId);
          resolve(result);
        };
        pending.set(attemptId, {
          target,
          label: owner.label,
          prompt: reviewText(prompt, 16000),
          pasted: false,
          submitted: false,
          writing: false,
          resolve: finish,
        });
        if (!deps.emit(owner.label, "web-review:deliver", { target, attemptId })) finish("waiting");
      }),
  });
  const extension = createReviewExtensionServer({ storage, candidates, verify, changed });
  void storage.load().then(changed).catch(error => console.warn("Browser review storage unavailable", error));
  void extension.start().catch(error => console.warn("Browser extension bridge unavailable", error));
  ipcMain.handle("web_review_pairing", event => { projectFor(event); return extension.pairing(); });
  ipcMain.handle("web_review_revoke", event => { projectFor(event); return extension.revoke(); });
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  function changed(): void {
    window.changed();
    const queued = storage.projects().some((p) => p.batches.some((b) => b.status === "queued"));
    if (queued && !tickTimer)
      tickTimer = setInterval(() => void queue.tick().catch((e) => window.fail(e)), 2000);
    if (!queued && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
    if (queued) void queue.tick().catch((e) => window.fail(e));
  }
  function projectFor(event: IpcMainInvokeEvent, id?: unknown) {
    const project = window.assert(event);
    if (id !== undefined && id !== project.id)
      throw new Error("The open source changed. Retry in the correct project.");
    return project;
  }
  function targetFor(projectRoot: string, key: unknown): ReviewTarget {
    const selected = candidates().find(
      (c) => `${c.clientId}:${c.paneId}` === key && c.root === projectRoot,
    );
    if (!selected)
      throw new Error("Select a live, identifiable Codex or AGY conversation in this checkout.");
    return selected;
  }

  ipcMain.handle("web_review_open", async (event, { root, configure }) => {
    deps.labelOf(event);
    if (typeof root !== "string" || !path.isAbsolute(root))
      throw new Error("Choose a local source folder.");
    const project = await storage.open(root);
    await window.open(project, configure === true);
    changed();
  });
  ipcMain.handle("web_review_publish", async (event, { clientId, rows, colors }) => {
    const label = deps.labelOf(event);
    if (
      typeof clientId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(clientId) ||
      !Array.isArray(rows) ||
      rows.length > 256
    )
      throw new Error("Invalid review session list.");
    const valid: ReviewCandidate[] = [];
    for (const row of rows) {
      const c = validateCandidate(row, clientId);
      if (!c) continue;
      try {
        deps.assertOwner(c.paneId, label);
        if (!canonical.has(c.root)) {
          if (canonical.size > 512) canonical.clear();
          canonical.set(c.root, await realpath(c.root));
        }
        valid.push({ ...c, root: canonical.get(c.root)! });
      } catch {
        /* A closing or transferred pane is not a target. */
      }
    }
    for (const [id, owner] of owners)
      if (owner.label === label && id !== clientId) owners.delete(id);
    owners.set(clientId, { label, rows: valid, at: Date.now() });
    if (colors && typeof colors === "object")
      theme = Object.fromEntries(
        Object.entries(colors).filter(
          ([key, value]) =>
            [
              "background",
              "foreground",
              "blue",
              "green",
              "red",
              "yellow",
              "magenta",
              "cyan",
            ].includes(key) &&
            typeof value === "string" &&
            /^#[a-f0-9]{6}$/i.test(value),
        ),
      ) as Record<string, string>;
    changed();
  });
  ipcMain.handle("web_review_forget", (event, { clientId }) => {
    const label = deps.labelOf(event);
    if (owners.get(clientId)?.label === label) owners.delete(clientId);
    window.changed();
  });
  ipcMain.handle("web_review_write", async (event, { attemptId, stage, revision }) => {
    const label = deps.labelOf(event),
      p = pending.get(attemptId);
    if (!p || p.label !== label || p.writing || !["paste", "submit"].includes(stage)) return false;
    if (stage === "paste" ? p.pasted : !p.pasted || p.submitted) return false;
    p.writing = true;
    try {
      if (!(await verify(p.target)) || pending.get(attemptId) !== p) return false;
      const current = ownerFor(p.target)?.rows.find((c) => sameReviewTarget(c, p.target));
      if (!current || !reviewReady(current) || current.revision !== revision) return false;
      deps.assertOwner(p.target.paneId, label);
      // Reserve the individual write before touching the PTY; retries cannot duplicate it.
      if (stage === "paste") p.pasted = true;
      else p.submitted = true;
      await deps.write(
        label,
        p.target.paneId,
        stage === "paste" ? `\x1b[200~${p.prompt}\x1b[201~` : "\r",
      );
      return true;
    } finally {
      p.writing = false;
    }
  });
  ipcMain.handle("web_review_result", (event, { attemptId, outcome }) => {
    const label = deps.labelOf(event),
      p = pending.get(attemptId);
    if (!p || p.label !== label) return;
    const allowed = ["sent", "waiting", "target-changed", "staged", "uncertain"].includes(outcome)
      ? (outcome as ReviewDelivery)
      : "uncertain";
    p.resolve(
      p.submitted
        ? allowed === "sent"
          ? "sent"
          : "uncertain"
        : p.pasted
          ? allowed === "staged"
            ? "staged"
            : "uncertain"
          : allowed === "sent" || allowed === "staged"
            ? "uncertain"
            : allowed,
    );
  });
  ipcMain.handle("web_review_state", (event) => {
    projectFor(event);
    return window.state();
  });
  ipcMain.handle("web_review_bounds", (event, { bounds }) => {
    projectFor(event);
    window.setBounds(bounds);
  });
  ipcMain.handle("web_review_configure", async (event, { projectId, url }) => {
    const project = projectFor(event, projectId),
      normalized = localReviewUrl(url);
    await storage.edit(project.id, (p) => {
      p.url = normalized;
    });
    await window.navigate(normalized);
    changed();
  });
  ipcMain.handle("web_review_navigate", async (event, { url, action }) => {
    const project = projectFor(event);
    if (url && new URL(localReviewUrl(url)).origin !== new URL(project.url).origin)
      throw new Error("Use Web Preview Settings to change this project's origin.");
    await window.navigate(url ? localReviewUrl(url) : undefined, action);
  });
  ipcMain.handle("web_review_mode", (event, { mode }) => {
    projectFor(event);
    return window.mode(mode);
  });
  ipcMain.handle("web_review_comment", async (event, { projectId, id, comment, steps }) => {
    const project = projectFor(event, projectId),
      text = reviewText(comment),
      details = reviewText(steps, 4000);
    await storage.edit(project.id, (p) => {
      const annotation = p.annotations.find((a) => a.id === id);
      if (!annotation) throw new Error("Comment missing.");
      if (
        p.batches.some(
          (b) =>
            !["queued", "cancelled"].includes(b.status) && b.annotations.some((a) => a.id === id),
        )
      )
        throw new Error(
          "This comment has already been sent. Add a new comment for follow-up changes.",
        );
      annotation.comment = text;
      annotation.steps = details;
      for (const batch of p.batches)
        if (batch.status === "queued")
          for (const a of batch.annotations)
            if (a.id === id) {
              a.comment = text;
              a.steps = details;
            }
    });
    changed();
  });
  ipcMain.handle("web_review_remove", async (event, { projectId, id }) => {
    const project = projectFor(event, projectId);
    await storage.edit(project.id, (p) => {
      if (
        p.batches.some(
          (b) =>
            ["queued", "dispatching"].includes(b.status) && b.annotations.some((a) => a.id === id),
        )
      )
        throw new Error("Cancel the queued batch before removing its comment.");
      p.annotations = p.annotations.filter((a) => a.id !== id);
    });
    changed();
    window.pins();
  });
  ipcMain.handle("web_review_target", async (event, { projectId, key }) => {
    const project = projectFor(event, projectId),
      target = targetFor(project.root, key);
    if (!(await verify(target)))
      throw new Error("The conversation changed. Refresh the session selection.");
    await storage.edit(project.id, (p) => {
      p.selectedTarget = target;
    });
    changed();
  });
  ipcMain.handle("web_review_enqueue", async (event, { projectId, ids }) => {
    const project = projectFor(event, projectId),
      target = project.selectedTarget;
    if (!target || !(await verify(target)))
      throw new Error("Select a live conversation before sending comments.");
    if (!Array.isArray(ids) || !ids.length || ids.length > 100)
      throw new Error("Select between 1 and 100 comments.");
    await storage.edit(project.id, (p) => {
      if (p.batches.filter((b) => ["queued", "dispatching"].includes(b.status)).length >= 30)
        throw new Error("There are already 30 waiting batches.");
      const annotations = p.annotations.filter((a) => ids.includes(a.id));
      if (annotations.length !== new Set(ids).size || annotations.some((a) => !a.comment.trim()))
        throw new Error("Write a request for every selected comment.");
      if (
        p.batches.some(
          (b) => b.status !== "cancelled" && b.annotations.some((a) => ids.includes(a.id)),
        )
      )
        throw new Error("A selected comment is already in a batch.");
      p.batches.push({
        id: randomUUID(),
        createdAt: Date.now(),
        target,
        annotations: structuredClone(annotations),
        status: "queued",
        message: "Waiting for the selected conversation to finish its current turn.",
        attemptId: null,
        deliveredAt: null,
      });
    });
    changed();
  });
  ipcMain.handle("web_review_cancel", async (event, { projectId, id }) => {
    const project = projectFor(event, projectId);
    await storage.edit(project.id, (p) => {
      const b = p.batches.find((item) => item.id === id);
      if (!b || !["queued", "staged", "uncertain"].includes(b.status))
        throw new Error("This batch can no longer be cancelled.");
      b.status = "cancelled";
      b.message = b.deliveredAt
        ? "Dismissed after checking the conversation. Delivery history has been kept."
        : "Cancelled before delivery.";
    });
    changed();
  });
  ipcMain.handle("web_review_retarget", async (event, { projectId, id, key }) => {
    const project = projectFor(event, projectId),
      target = targetFor(project.root, key);
    if (!(await verify(target))) throw new Error("The replacement conversation is unavailable.");
    await storage.edit(project.id, (p) => {
      const b = p.batches.find((item) => item.id === id);
      if (!b || b.status !== "queued") throw new Error("Only a waiting batch can change session.");
      b.target = target;
      b.message = "Waiting for the newly selected session.";
    });
    changed();
  });
  ipcMain.handle("web_review_reviewed", async (event, { projectId, id, reviewed }) => {
    const project = projectFor(event, projectId);
    await storage.edit(project.id, (p) => {
      const a = p.annotations.find((item) => item.id === id);
      if (a) a.reviewed = reviewed === true;
    });
    changed();
    window.pins();
  });
  ipcMain.handle("web_review_reveal", async (event, { id }) => {
    const annotation = projectFor(event).annotations.find((a) => a.id === id);
    if (annotation) await window.reveal(annotation);
  });
  ipcMain.handle("web_review_image", async (event, { id, kind }) => {
    const project = projectFor(event);
    if (!project.annotations.some((a) => a.id === id)) throw new Error("Image missing.");
    const image = await readFile(
      storage.imagePath(project.id, id, kind === "screen" ? "screen" : "crop"),
    );
    return `data:image/png;base64,${image.toString("base64")}`;
  });
  return {
    hasWindow: () => window.hasWindow(),
    closeForQuit: () => window.closeForQuit(),
    flush: () => storage.flush(),
    dispose() {
      extension.stop();
      queue.stop();
      if (tickTimer) clearInterval(tickTimer);
      for (const p of pending.values()) p.resolve("uncertain");
      window.dispose();
    },
    forgetWindow(label: string) {
      for (const [id, o] of owners) if (o.label === label) owners.delete(id);
      window.changed();
    },
  };
}
