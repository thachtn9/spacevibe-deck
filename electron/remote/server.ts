import fs from "node:fs/promises";
import nodePath from "node:path";
import { RemoteTerminalActions } from "./terminal-actions";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import {
  REMOTE_INPUT_LIMIT,
  REMOTE_PROTOCOL_VERSION,
  type RemoteCreate,
  type RemoteTerminalRequest,
  type RemoteSession,
} from "../../src/lib/deck-remote";
import type { CliQuotaSnapshot } from "../../src/lib/cli-manager-quota";
import { listRemoteFolders, remoteFolder } from "./folders";
import { RemoteActions } from "./actions";
import { RemoteRequestError as RequestError } from "./errors";
import { remoteWebAsset } from "./web";

export interface RemoteBackend {
  readonly mode?: "independent" | "desktop";
  closeSession?(id: string, generation: string): Promise<unknown>;
  sessions(): RemoteSession[];
  terminal?(id: string, request: RemoteTerminalRequest): Promise<unknown>;
  screen(id: string): Promise<unknown>;
  input(id: string, text: string, generation: string): Promise<unknown>;
  create(request: RemoteCreate): Promise<RemoteSession>;
  quota(): Promise<CliQuotaSnapshot>;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError(400, "Send a JSON object.");
  return value as Record<string, unknown>;
}

async function bodyOf(
  request: IncomingMessage,
): Promise<{ raw: string; body: Record<string, unknown> }> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new RequestError(415, "Send application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new RequestError(413, "The request is too large.");
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { raw, body: object(JSON.parse(raw)) };
  } catch {
    throw new RequestError(400, "The request is not valid JSON.");
  }
}

/** Native and same-origin web clients share the bearer-authenticated protocol. */
export function createRemoteServer(options: {
  token: string;
  root: string;
  backend: RemoteBackend;
  actions?: RemoteActions;
  terminalActions?: RemoteTerminalActions;
}) {
  const tokenHash = createHash("sha256").update(`Bearer ${options.token}`).digest();
  const actions = options.actions ?? new RemoteActions();
  const terminalActions = options.terminalActions ?? new RemoteTerminalActions();
  let quota: CliQuotaSnapshot | null = null;
  let quotaAt = 0;
  let quotaFlight: Promise<unknown> | null = null;
  let closed = false;
  let streams = 0;

  async function quotaSnapshot() {
    if (quota && Date.now() - quotaAt < 30_000)
      return { snapshot: quota, stale: false, error: null };
    if (!quotaFlight)
      quotaFlight = (async () => {
        try {
          quota = await options.backend.quota();
          quotaAt = Date.now();
          return { snapshot: quota, stale: false, error: null };
        } catch {
          return {
            snapshot: quota,
            stale: true,
            error: "CLI Manager is unavailable. Showing the last reading.",
          };
        } finally {
          quotaFlight = null;
        }
      })();
    return quotaFlight;
  }

  async function route(method: string, url: URL, body?: Record<string, unknown>): Promise<unknown> {
    if (closed) throw new RequestError(401, "Remote access was disabled. Pair this device again.");
    const path = url.pathname;
    if (method === "GET" && path === "/v1/info")
      return {
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        workspaceMode: options.backend.mode ?? "desktop",
        name: os.hostname(),
        root: await remoteFolder(options.root, options.root),
      };
    if (method === "GET" && path === "/v1/sessions") return options.backend.sessions();
    if (method === "GET" && path === "/v1/folders")
      return listRemoteFolders(options.root, url.searchParams.get("path") ?? options.root);
    if (method === "POST" && path === "/v1/folders") {
      if (
        typeof body?.path !== "string" ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 128 ||
        /[\\/\0]/.test(body.name) ||
        [".", ".."].includes(body.name)
      )
        throw new RequestError(400, "Choose a folder name without slashes.");
      const parent = await remoteFolder(options.root, body.path);
      const target = nodePath.join(parent, body.name);
      await fs.mkdir(target);
      return listRemoteFolders(options.root, target);
    }
    if (method === "GET" && path === "/v1/quota") return quotaSnapshot();
    const close = /^\/v1\/sessions\/([a-zA-Z0-9-]{1,80})\/close$/.exec(path);
    if (method === "POST" && close) {
      if (!options.backend.closeSession)
        throw new RequestError(404, "Closing remote sessions is unavailable.");
      if (typeof body?.generation !== "string" || body.generation.length > 4096)
        throw new RequestError(400, "Refresh the remote session before closing it.");
      return options.backend.closeSession(close[1], body.generation);
    }
    const terminal = /^\/v1\/sessions\/([a-zA-Z0-9-]{1,80})\/terminal$/.exec(path);
    if (method === "POST" && terminal) {
      if (!options.backend.terminal)
        throw new RequestError(404, "Interactive terminals are unavailable.");
      const request = body as unknown as RemoteTerminalRequest;
      validateTerminal(request);
      if (!["claim", "release", "write"].includes(request.action))
        throw new RequestError(400, "Unknown terminal action.");
      if (
        request.action === "write" &&
        (typeof request.data !== "string" || Buffer.byteLength(request.data) > REMOTE_INPUT_LIMIT)
      )
        throw new RequestError(400, "Input exceeds 32 KB.");
      return options.backend.terminal(terminal[1], request);
    }
    const match = /^\/v1\/sessions\/([a-zA-Z0-9-]{1,80})\/(screen|input)$/.exec(path);
    if (method === "GET" && match?.[2] === "screen") return options.backend.screen(match[1]);
    if (method === "POST" && match?.[2] === "input") {
      const text = body?.text;
      if (
        typeof text !== "string" ||
        Buffer.byteLength(text, "utf8") > REMOTE_INPUT_LIMIT ||
        [...text].some((character) => {
          const code = character.codePointAt(0)!;
          return (code < 32 && code !== 9 && code !== 10) || code === 127;
        })
      )
        throw new RequestError(400, "Use text up to 32 KB, without terminal control characters.");
      if (typeof body?.generation !== "string" || body.generation.length > 4096)
        throw new RequestError(400, "Refresh the session screen before sending.");
      return options.backend.input(match[1], text, body.generation);
    }
    if (method === "POST" && path === "/v1/sessions") {
      const agentId = body?.agentId ?? null;
      const accountId = body?.accountId ?? null;
      if (agentId !== null && agentId !== "codex" && agentId !== "agy")
        throw new RequestError(400, "Choose Codex, AGY or Shell.");
      if (
        accountId !== null &&
        (typeof accountId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(accountId) ||
          agentId === null)
      )
        throw new RequestError(400, "Choose an available account.");
      if (typeof body?.path !== "string") throw new RequestError(400, "Choose a folder.");
      const directory = await remoteFolder(options.root, body.path);
      if (accountId !== null) {
        const accounts = await options.backend.quota();
        if (!accounts.accounts.some((row) => row.id === accountId && row.agent === agentId))
          throw new RequestError(400, "This account is no longer available.");
      }
      return options.backend.create({ path: directory, agentId, accountId });
    }
    throw new RequestError(404, "This endpoint is unavailable.");
  }

  function validateTerminal(request: RemoteTerminalRequest) {
    if (
      !request ||
      typeof request.client !== "string" ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(request.client) ||
      typeof request.generation !== "string" ||
      request.generation.length > 4096
    )
      throw new RequestError(400, "Refresh the terminal connection.");
  }

  async function stream(url: URL, response: ServerResponse, id: string) {
    if (!options.backend.terminal)
      throw new RequestError(404, "Interactive terminals are unavailable.");
    if (streams >= 16) throw new RequestError(429, "Too many open terminal views.");
    const request: RemoteTerminalRequest = {
      action: "read",
      client: url.searchParams.get("client") ?? "",
      generation: url.searchParams.get("generation") ?? "",
    };
    validateTerminal(request);
    let ended = false;
    let cursor: number | undefined;
    response.once("close", () => {
      ended = true;
    });
    streams++;
    try {
      // Check ownership and generation before committing streaming response headers.
      let frame = await options.backend.terminal(id, request);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      while (!closed && !ended) {
        const data = JSON.stringify(frame) + "\n";
        if (!response.write(data)) {
          // Bound slow clients instead of retaining unlimited terminal output.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              response.destroy();
              finish();
            }, 5000);
            const finish = () => {
              clearTimeout(timer);
              response.off("drain", finish);
              response.off("close", finish);
              resolve();
            };
            response.once("drain", finish);
            response.once("close", finish);
          });
        }
        cursor = (frame as { cursor: number }).cursor;
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (closed || ended) break;
        frame = await options.backend.terminal(id, { ...request, cursor });
      }
    } catch (error) {
      if (!response.headersSent) throw error;
      if (!ended)
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Terminal disconnected.",
          }) + "\n",
        );
    } finally {
      streams--;
      if (!ended && response.headersSent) response.end();
    }
  }

  async function answer(action: () => Promise<unknown>): Promise<Answer> {
    try {
      return { status: 200, body: await action() };
    } catch (error) {
      return {
        status: error instanceof RequestError ? error.status : 409,
        body: {
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Deck could not complete the request.",
        },
      };
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Safari turns same-origin POST Origin into "null" under no-referrer.
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    let result: Answer;
    try {
      if (closed)
        throw new RequestError(401, "Remote access was disabled. Pair this device again.");
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://deck.invalid");
      // The public shell contains no pairing key or session data. Allow links from other sites.
      const asset = method === "GET" ? remoteWebAsset(url.pathname) : undefined;
      if (asset) {
        response.setHeader("Content-Type", asset.type);
        response.end(asset.body);
        return;
      }
      const origin = request.headers.origin;
      const expectedOrigin = `http://${request.headers.host}`;
      if (
        (origin !== undefined && origin !== expectedOrigin) ||
        request.headers["sec-fetch-site"] === "cross-site"
      )
        throw new RequestError(403, "Open Deck Remote from this computer's web link.");
      const authorization = request.headers.authorization ?? "";
      const suppliedHash = createHash("sha256").update(authorization).digest();
      if (!timingSafeEqual(suppliedHash, tokenHash))
        throw new RequestError(401, "Pair this device with Deck again.");
      const streamMatch = /^\/v1\/sessions\/([a-zA-Z0-9-]{1,80})\/stream$/.exec(url.pathname);
      if (method === "GET" && streamMatch) {
        await stream(url, response, streamMatch[1]);
        return;
      }
      if (method === "GET") result = await answer(() => route(method, url));
      else if (method === "POST") {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[A-Za-z0-9-]{16,128}$/.test(key))
          throw new RequestError(400, "Supply a unique Idempotency-Key for this action.");
        const { raw, body } = await bodyOf(request);
        const fingerprint = createHash("sha256")
          .update(`${method}\n${url.pathname}\n${raw}`)
          .digest("hex");
        result = url.pathname.endsWith("/terminal")
          ? await terminalActions.run(options.token, body.client, body.sequence, () =>
              answer(() => route(method, url, body)),
            )
          : await actions.run(options.token, key, fingerprint, () =>
              answer(() => route(method, url, body)),
            );
      } else throw new RequestError(405, "Use GET or POST.");
    } catch (error) {
      result = {
        status: error instanceof RequestError ? error.status : 400,
        body: { error: error instanceof Error ? error.message : "Invalid request." },
      };
    }
    if (!response.destroyed) {
      response.statusCode = result.status;
      response.end(JSON.stringify(result.body));
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 35_000;
  server.keepAliveTimeout = 5000;
  return {
    async listen(port: number, host = "0.0.0.0"): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        const error = (cause: Error) => reject(cause);
        server.once("error", error);
        server.listen(port, host, () => {
          server.off("error", error);
          resolve();
        });
      });
      server.on("error", () => {});
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("The remote listener is unavailable.");
      return address.port;
    },
    close(): void {
      closed = true;
      server.closeAllConnections();
      server.close();
    },
  };
}
