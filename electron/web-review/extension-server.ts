import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import {
  reviewReady,
  sameReviewTarget,
  type ReviewBatch,
  type ReviewDelivery,
  type ReviewAnnotation,
  type ReviewCandidate,
  type ReviewTarget,
} from "../../src/lib/web-review";
import { ReviewStorage, reviewText } from "./storage";
import { validateReviewCapture } from "./capture";

import { REVIEW_EXTENSION_ID } from "./extension-identity";

const PORT = 43129;
interface Credential {
  extension: string;
  token: string;
}
function equal(a: unknown, b: string): boolean {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12_000_000) throw new Error("Review request is too large.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request.");
  return value;
}

/** Extension transport has no arbitrary terminal-write or filesystem-read endpoint. */
export function createReviewExtensionServer(deps: {
  storage: ReviewStorage;
  port?: number;
  candidates(): ReviewCandidate[];
  verify(target: ReviewTarget): Promise<boolean>;
  changed(): void;
  active(): ReviewTarget | null;
  dispatch(target: ReviewTarget, attemptId: string, prompt: string): Promise<ReviewDelivery>;
}) {
  const credentialPath = path.join(deps.storage.directory, "extension.json");
  let credential: Credential | null = null;
  let code = "",
    expires = 0,
    failures = 0;
  let listening: Promise<void> | null = null;
  const ready = readFile(credentialPath, "utf8")
    .then((text) => {
      const value = JSON.parse(text) as Credential;
      if (!/^[a-p]{32}$/.test(value.extension) || !/^[a-f0-9]{64}$/.test(value.token))
        throw new Error("Extension credentials could not be read.");
      credential = value;
    })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  // Handle a stored-file failure only when the bridge is actually used.
  void ready.catch(() => {});
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    try {
      if (
        request.headers.host !==
          `127.0.0.1:${(server.address() as { port: number } | null)?.port}` ||
        request.method === "OPTIONS"
      ) {
        send(403, { error: "Extension requests only." });
        return;
      }
      const extension = request.headers["x-deck-extension"];
      if (
        typeof extension !== "string" ||
        !/^[a-p]{32}$/.test(extension) ||
        (request.headers.origin !== undefined &&
          request.headers.origin !== `chrome-extension://${extension}`)
      ) {
        send(403, { error: "Extension origin required." });
        return;
      }
      await ready;
      if (request.url === "/connect" && request.method === "POST") {
        if (
          extension !== REVIEW_EXTENSION_ID ||
          request.headers.origin !== `chrome-extension://${REVIEW_EXTENSION_ID}`
        ) {
          send(403, {
            error: "Use the Deck Review extension distributed with this Deck installation.",
          });
          return;
        }
        if (credential && credential.extension !== extension) {
          // The owner-authorized automatic connection replaces legacy code pairing.
          credential = null;
        }
        if (!credential) {
          const next = { extension, token: randomBytes(32).toString("hex") };
          await deps.storage.atomic(credentialPath, JSON.stringify(next));
          credential = next;
        }
        send(200, { token: credential.token });
        return;
      }
      if (request.url === "/pair" && request.method === "POST") {
        const input = await body(request);
        if (!code || Date.now() > expires || failures >= 5 || !equal(input.code, code)) {
          failures++;
          send(403, { error: "Pairing code expired or incorrect. Generate a new code in Deck." });
          return;
        }
        const next = { extension, token: randomBytes(32).toString("hex") };
        await deps.storage.atomic(credentialPath, JSON.stringify(next));
        credential = next;
        code = "";
        send(200, { token: next.token });
        return;
      }
      if (
        !credential ||
        credential.extension !== extension ||
        !equal(request.headers.authorization, `Bearer ${credential.token}`)
      ) {
        send(401, { error: "Pair this extension with Deck first." });
        return;
      }
      await deps.storage.load();
      if (request.method === "GET" && request.url === "/state") {
        const targets = deps.candidates();
        const roots = [...new Set(targets.map((t) => t.root))];
        const projects = deps.storage.projects().map((p) => ({
          id: p.id,
          root: p.root,
          batches: p.batches.map((b) => ({
            id: b.id,
            status: b.status,
            message: b.message,
            count: b.annotations.length,
            target: b.target.label,
          })),
        }));
        const selected = deps.active();
        const active = (selected && targets.find((t) => sameReviewTarget(t, selected))) || null;
        send(200, { roots, targets, projects, active, ready: !!active && reviewReady(active) });
        return;
      }
      if (request.method === "POST" && request.url === "/batch") {
        const input = await body(request);
        const id = String(input.id);
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid batch identity.");
        if (deps.storage.projects().some((p) => p.batches.some((b) => b.id === id))) {
          const existing = deps.storage
            .projects()
            .flatMap((p) => p.batches)
            .find((b) => b.id === id)!;
          send(200, { id, status: existing.status, message: existing.message });
          return;
        }
        const selected = deps.active();
        const target = selected && deps.candidates().find((t) => sameReviewTarget(t, selected));
        if (
          !target ||
          target.clientId !== input.clientId ||
          target.paneId !== input.paneId ||
          target.sessionId !== input.sessionId ||
          target.root !== input.root ||
          !(await deps.verify(target))
        )
          throw new Error("Select an active Browser Review session in Deck.");
        if (
          deps.storage
            .projects()
            .some((p) =>
              p.batches.some(
                (b) =>
                  sameReviewTarget(b.target, target) &&
                  ["dispatching", "staged", "uncertain", "queued"].includes(b.status),
              ),
            )
        )
          throw new Error("Check the previous delivery in Deck before sending another request.");
        const project = await deps.storage.open(target.root);
        if (project.batches.some((b) => b.id === id)) {
          send(200, { id });
          return;
        }
        if (
          !Array.isArray(input.annotations) ||
          !input.annotations.length ||
          input.annotations.length > 20
        )
          throw new Error("Send between 1 and 20 comments per batch.");
        const annotations: ReviewAnnotation[] = [];
        for (const raw of input.annotations) {
          const capture = validateReviewCapture(raw.capture, raw.capture?.url);
          const url = new URL(capture.url);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw new Error("Review HTTP or HTTPS pages only.");
          const comment = reviewText(raw.comment),
            steps = reviewText(raw.steps ?? "", 4000);
          if (!comment) throw new Error("Write a request for every comment.");
          if (
            typeof raw.image !== "string" ||
            !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(raw.image)
          )
            throw new Error("Screenshot missing.");
          const screen = nativeImage.createFromDataURL(raw.image),
            size = screen.getSize();
          if (screen.isEmpty() || size.width > 16000 || size.height > 16000)
            throw new Error("Invalid screenshot.");
          const noteId = randomUUID();
          const screenshot = deps.storage.imagePath(project.id, noteId, "screen");
          const crop = deps.storage.imagePath(project.id, noteId, "crop");
          const sx = size.width / capture.viewport.width,
            sy = size.height / capture.viewport.height;
          const x = Math.floor(capture.rect.x * sx),
            y = Math.floor(capture.rect.y * sy);
          const clipped = screen.crop({
            x,
            y,
            width: Math.max(1, Math.min(size.width - x, Math.ceil(capture.rect.width * sx))),
            height: Math.max(1, Math.min(size.height - y, Math.ceil(capture.rect.height * sy))),
          });
          await deps.storage.atomic(screenshot, screen.toPNG());
          await deps.storage.atomic(crop, clipped.toPNG());
          annotations.push({
            id: noteId,
            capture,
            comment,
            steps,
            screenshot,
            crop,
            git: null,
            reviewed: false,
          });
        }
        const attemptId = randomUUID();
        const batch: ReviewBatch = {
          id,
          createdAt: Date.now(),
          target,
          annotations,
          status: "dispatching",
          message: "Sending to the active conversation…",
          attemptId,
          deliveredAt: null,
        };
        const prompt = await deps.storage.prepare(project, batch);
        const reserved = await deps.storage.edit(project.id, (p) => {
          if (p.batches.some((b) => b.id === id)) return false;
          if (
            p.batches.some(
              (b) =>
                sameReviewTarget(b.target, target) &&
                ["dispatching", "staged", "uncertain", "queued"].includes(b.status),
            )
          )
            throw new Error(
              "Another delivery is already in progress. Check the agent before sending again.",
            );
          p.batches.push(batch);
          return true;
        });
        if (!reserved) {
          const existing = deps.storage.project(project.id).batches.find((b) => b.id === id)!;
          send(200, { id, status: existing.status, message: existing.message });
          return;
        }
        let outcome: ReviewDelivery = "uncertain";
        try {
          const fresh = deps.candidates().find((c) => sameReviewTarget(c, target));
          outcome =
            fresh && (await deps.verify(target))
              ? await deps.dispatch(target, attemptId, prompt)
              : "waiting";
        } catch {
          /* A lost reply cannot authorize replay. */
        }
        const status =
          outcome === "waiting" || outcome === "target-changed" ? "cancelled" : outcome;
        const message = {
          sent: "Sent to the active agent.",
          cancelled:
            outcome === "target-changed"
              ? "The active session changed. Select Active again in Deck. Your comments are saved."
              : "The active terminal has unsent input, an approval prompt, or another operation in progress. Your comments are saved.",
          staged: "Inserted but not submitted. Check the agent composer before continuing.",
          uncertain: "Delivery could not be confirmed. Check the conversation before continuing.",
        }[status];
        await deps.storage.edit(project.id, (p) => {
          const current = p.batches.find((b) => b.id === id)!;
          current.status = status;
          current.message = message;
          current.deliveredAt = Date.now();
        });
        deps.changed();
        send(200, { id, status, message });
        return;
      }
      if (request.method === "POST" && request.url === "/cancel") {
        const input = await body(request);
        const project = deps.storage
          .projects()
          .find((p) => p.batches.some((b) => b.id === input.id));
        if (!project) {
          send(200, {});
          return;
        }
        await deps.storage.edit(project.id, (p) => {
          const b = p.batches.find((b) => b.id === input.id)!;
          if (!["queued", "staged", "uncertain"].includes(b.status))
            throw new Error("This batch cannot be cancelled.");
          b.status = "cancelled";
          b.message = "Cancelled from the browser extension.";
        });
        deps.changed();
        send(200, {});
        return;
      }
      send(404, { error: "Unknown extension action." });
    } catch (error) {
      send(400, { error: error instanceof Error ? error.message : "Extension request failed." });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 8;
  function start(): Promise<void> {
    return (listening ??= ready
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(deps.port ?? PORT, "127.0.0.1", () => {
              server.removeListener("error", reject);
              resolve();
            });
          }),
      )
      .catch((error) => {
        listening = null;
        throw error;
      }));
  }
  return {
    get port(): number {
      return (server.address() as { port: number } | null)?.port ?? deps.port ?? PORT;
    },
    async pairing() {
      await start();
      code = String(randomInt(100000, 1000000));
      expires = Date.now() + 120000;
      failures = 0;
      return { code, expires, port: PORT, connected: credential !== null };
    },
    async revoke() {
      credential = null;
      code = "";
      await unlink(credentialPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
    start,
    stop() {
      server.close();
      server.closeAllConnections();
    },
  };
}
