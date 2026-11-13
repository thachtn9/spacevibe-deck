import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteServer, type RemoteBackend } from "./server";
import { RemoteRequestError } from "./errors";
import { RemoteActions } from "./actions";
import type { RemoteSession } from "../../src/lib/deck-remote";

const token = "a".repeat(64);
const key = () => `${Date.now()}-${randomUUID()}`;
const session: RemoteSession = {
  id: "session-one",
  generation: "generation-one",
  paneId: 7,
  tabKey: 1,
  title: "Codex",
  path: "/project",
  agentId: "codex",
  account: null,
  phase: "idle",
  attention: "none",
  startedAt: 0,
};

describe("Deck Remote HTTP boundary", () => {
  let root: string;
  let url: string;
  let server: ReturnType<typeof createRemoteServer>;
  let backend: RemoteBackend;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-remote-http-"));
    await fs.mkdir(path.join(root, "project"));
    backend = {
      sessions: vi.fn(() => [session]),
      screen: vi.fn(async () => ({ text: "ready", alive: true })),
      input: vi.fn(async () => ({ status: "sent" })),
      create: vi.fn(async () => session),
      quota: vi.fn(async () => ({ checkedAtMs: Date.now(), accounts: [] })),
    };
    server = createRemoteServer({ token, root, backend });
    url = `http://127.0.0.1:${await server.listen(0, "127.0.0.1")}`;
  });
  afterEach(async () => {
    server.close();
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  const headers = () => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": key(),
  });
  const post = (route: string, body: unknown, requestKey = key()) =>
    fetch(`${url}${route}`, {
      method: "POST",
      headers: { ...headers(), "Idempotency-Key": requestKey },
      body: JSON.stringify(body),
    });

  it("advertises independent mode and reserves close before running it once", async () => {
    Object.assign(backend, {
      mode: "independent",
      closeSession: vi.fn(async () => ({ status: "closed" })),
    });
    expect(await (await fetch(`${url}/v1/info`, { headers: headers() })).json()).toMatchObject({
      workspaceMode: "independent",
    });
    const requestKey = key();
    const request = { generation: session.generation };
    const replies = await Promise.all([
      post(`/v1/sessions/${session.id}/close`, request, requestKey),
      post(`/v1/sessions/${session.id}/close`, request, requestKey),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(backend.closeSession).toHaveBeenCalledExactlyOnceWith(session.id, session.generation);
    expect((await post(`/v1/sessions/${session.id}/close`, {})).status).toBe(400);
    expect(backend.closeSession).toHaveBeenCalledTimes(1);
  });

  it("requires authentication and refuses foreign browser origins", async () => {
    expect((await fetch(`${url}/v1/sessions`)).status).toBe(401);
    expect(
      (
        await fetch(`${url}/v1/sessions`, {
          headers: { ...headers(), Origin: "https://other.test" },
        })
      ).status,
    ).toBe(403);
    expect(backend.sessions).not.toHaveBeenCalled();
    expect(await (await fetch(`${url}/v1/sessions`, { headers: headers() })).json()).toEqual([
      session,
    ]);
  });
  it("serves a public phone shell without exposing credentials or session data", async () => {
    const page = await fetch(url, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain("apple-mobile-web-app-capable");
    expect(html).not.toContain(token);
    expect(html).not.toContain(session.id);
    const assets = await Promise.all(
      ["/remote.js", "/remote.css", "/manifest.webmanifest", "/icon.svg"].map(async (asset) => {
        const response = await fetch(url + asset);
        return { response, body: await response.text() };
      }),
    );
    for (const { response, body } of assets) {
      expect(response.status).toBe(200);
      expect(body).not.toContain(token);
    }
    expect(backend.sessions).not.toHaveBeenCalled();
    expect((await fetch(`${url}/v1/sessions`)).status).toBe(401);
  });
  it("accepts paired same-origin web reads and input while rejecting foreign and null origins", async () => {
    const read = await fetch(`${url}/v1/sessions`, {
      headers: { ...headers(), Origin: url, "Sec-Fetch-Site": "same-origin" },
    });
    expect(read.status).toBe(200);
    const input = await fetch(`${url}/v1/sessions/session-one/input`, {
      method: "POST",
      headers: { ...headers(), Origin: url, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ text: "continue", generation: session.generation }),
    });
    expect(input.status).toBe(200);
    expect(backend.input).toHaveBeenCalledExactlyOnceWith(
      session.id,
      "continue",
      session.generation,
    );
    const foreign = await Promise.all(
      ["null", "http://foreign.test", url.replace("127.0.0.1", "localhost")].map((origin) =>
        fetch(`${url}/v1/sessions`, { headers: { ...headers(), Origin: origin } }),
      ),
    );
    expect(foreign.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(
      (
        await fetch(`${url}/v1/sessions`, {
          headers: { ...headers(), Origin: url, "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect(input.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("deduplicates simultaneous input retries into exactly one backend operation", async () => {
    const requestKey = key();
    const responses = await Promise.all(
      [1, 2].map(() =>
        post(
          "/v1/sessions/session-one/input",
          { text: "continue\nwith tests", generation: session.generation },
          requestKey,
        ),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(backend.input).toHaveBeenCalledTimes(1);
    expect(backend.input).toHaveBeenCalledWith(
      session.id,
      "continue\nwith tests",
      session.generation,
    );
    const changed = await post(
      "/v1/sessions/session-one/input",
      { text: "different", generation: session.generation },
      requestKey,
    );
    expect(changed.status).toBe(409);
    expect(backend.input).toHaveBeenCalledTimes(1);
  });
  it("requires a viewed generation and rejects escape/control input", async () => {
    expect((await post("/v1/sessions/session-one/input", { text: "continue" })).status).toBe(400);
    expect(
      (
        await post("/v1/sessions/session-one/input", {
          text: "\u001b[201~",
          generation: session.generation,
        })
      ).status,
    ).toBe(400);
    expect(backend.input).not.toHaveBeenCalled();
  });
  it("creates only inside the shared root and validates account commands", async () => {
    const requestKey = key();
    const body = { path: path.join(root, "project"), agentId: null, accountId: null };
    expect((await post("/v1/sessions", body, requestKey)).status).toBe(200);
    expect((await post("/v1/sessions", body, requestKey)).status).toBe(200);
    expect(backend.create).toHaveBeenCalledTimes(1);
    expect((await post("/v1/sessions", { ...body, path: path.dirname(root) })).status).toBe(409);
    expect(
      (await post("/v1/sessions", { ...body, agentId: "codex", accountId: "x;touch bad" })).status,
    ).toBe(400);
    expect(
      (await post("/v1/sessions", { ...body, agentId: "codex", accountId: "unknown" })).status,
    ).toBe(400);
    expect(backend.create).toHaveBeenCalledTimes(1);
  });
  it("does not follow a symlink outside the shared folder", async () => {
    await fs.symlink(path.dirname(root), path.join(root, "escape"), "dir");
    const response = await fetch(
      `${url}/v1/folders?path=${encodeURIComponent(path.join(root, "escape"))}`,
      { headers: headers() },
    );
    expect(response.status).toBe(409);
    const listing = await (await fetch(`${url}/v1/folders`, { headers: headers() })).json();
    expect(listing.entries.map((entry: { name: string }) => entry.name)).toEqual(["project"]);
    expect(listing.parent).toBeNull();
  });
  it("shares quota reads for thirty seconds and labels an offline cached result", async () => {
    const read = () => fetch(`${url}/v1/quota`, { headers: headers() });
    await Promise.all([read(), read()]);
    expect(backend.quota).toHaveBeenCalledTimes(1);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    vi.mocked(backend.quota).mockRejectedValueOnce(new Error("offline"));
    const cached = await (await read()).json();
    expect(cached.stale).toBe(true);
    expect(cached.snapshot.accounts).toEqual([]);
    expect(cached.error).toContain("last reading");
  });
  it("streams ANSI after authorization and returns pre-stream generation errors as JSON", async () => {
    backend.terminal = vi.fn(async () => ({
      cursor: 1,
      data: "\x1b[31mready",
      reset: true,
      cols: 80,
      rows: 24,
      controller: null,
    }));
    const query = new URLSearchParams({
      client: `${Date.now()}-${"b".repeat(32)}`,
      generation: session.generation,
    });
    expect((await fetch(`${url}/v1/sessions/session-one/stream?${query}`)).status).toBe(401);
    const abort = new AbortController();
    const response = await fetch(`${url}/v1/sessions/session-one/stream?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abort.signal,
    });
    expect(response.headers.get("content-type")).toContain("ndjson");
    const { value } = await response.body!.getReader().read();
    expect(new TextDecoder().decode(value)).toContain("ready");
    abort.abort();
    backend.terminal = vi.fn(async () => {
      throw new RemoteRequestError(412, "Stale generation");
    });
    const stale = await fetch(`${url}/v1/sessions/session-one/stream?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toEqual({ error: "Stale generation" });
  });

  it("passes raw terminal keys once and keeps folder creation inside the shared root", async () => {
    backend.terminal = vi.fn(async () => ({ cursor: 1 }));
    const client = `${Date.now()}-${"c".repeat(32)}`;
    const post = (route: string, body: unknown) =>
      fetch(url + route, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key(),
        },
        body: JSON.stringify(body),
      });
    const body = {
      client,
      sequence: 1,
      generation: session.generation,
      action: "write",
      data: "\x03\t\r",
    };
    expect((await post("/v1/sessions/session-one/terminal", body)).status).toBe(200);
    expect((await post("/v1/sessions/session-one/terminal", body)).status).toBe(409);
    expect(backend.terminal).toHaveBeenCalledTimes(1);
    expect((await post("/v1/folders", { path: root, name: "../escape" })).status).toBe(400);
    const folder = await post("/v1/folders", { path: root, name: "new-project" });
    expect(folder.status).toBe(200);
    expect((await folder.json()).path).toBe(path.join(root, "new-project"));
  });
});

describe("durable remote action reservations", () => {
  it("never executes an accepted action again after a gateway restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-remote-actions-"));
    try {
      const file = path.join(root, "actions.json");
      const first = new RemoteActions(file);
      const action = vi.fn(async () => "sent");
      const requestKey = key();
      const fingerprint = "f".repeat(64);
      expect(await first.run(token, requestKey, fingerprint, action)).toBe("sent");
      expect(await first.run(token, requestKey, fingerprint, action)).toBe("sent");
      expect(action).toHaveBeenCalledTimes(1);
      const restarted = new RemoteActions(file);
      await expect(restarted.run(token, requestKey, fingerprint, action)).rejects.toThrow(
        "already accepted",
      );
      expect(action).toHaveBeenCalledTimes(1);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect(await fs.readFile(file, "utf8")).not.toContain(requestKey);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("rejects expired action keys and a corrupt ledger before executing anything", async () => {
    const actions = new RemoteActions();
    const action = vi.fn(async () => "sent");
    await expect(
      actions.run(
        token,
        `${Date.now() - 25 * 60 * 60_000}-${randomUUID()}`,
        "f".repeat(64),
        action,
      ),
    ).rejects.toThrow("expired");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-remote-corrupt-"));
    try {
      const file = path.join(root, "actions.json");
      await fs.writeFile(file, "invalid");
      await expect(
        new RemoteActions(file).run(token, key(), "f".repeat(64), action),
      ).rejects.toThrow("could not be read");
      expect(action).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
