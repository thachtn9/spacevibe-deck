import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeApiService } from "./claude-api";

describe("Claude API settings", () => {
  let directory: string;
  let file: string;
  const draft = {
    baseUrl: "https://api.mwapi.dev/v1/",
    model: "claude-sonnet-4-6",
    apiKey: "sk-test-private-credential",
  };
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-claude-api-"));
    file = path.join(directory, "settings.json");
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("saves private Claude configuration while preserving unrelated settings and never returning the key", async () => {
    const original = {
      hooks: { Stop: [] },
      env: { KEEP: "value", ANTHROPIC_API_KEY: "old-key" },
      theme: "dark",
    };
    await fs.writeFile(file, JSON.stringify(original), { mode: 0o644 });
    const service = createClaudeApiService({ settingsPath: file });
    const saved = await service.save(draft);
    expect(saved).toEqual({
      baseUrl: "https://api.mwapi.dev",
      model: draft.model,
      hasApiKey: true,
    });
    const document = JSON.parse(await fs.readFile(file, "utf8"));
    expect(document).toMatchObject({
      hooks: original.hooks,
      theme: "dark",
      env: { KEEP: "value", ANTHROPIC_AUTH_TOKEN: draft.apiKey },
    });
    expect(document.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(document.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await service.load())).not.toContain(draft.apiKey);
    await service.save({ ...draft, apiKey: "", model: "claude-opus-4-6" });
    expect(JSON.parse(await fs.readFile(file, "utf8")).env.ANTHROPIC_AUTH_TOKEN).toBe(draft.apiKey);
  });

  it("sends one Anthropic Messages request using the draft without saving it", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ type: "message", content: [{ type: "text", text: "OK" }] })),
      );
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    expect((await service.test(draft)).ok).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.mwapi.dev/v1/messages");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${draft.apiKey}`, "anthropic-version": "2023-06-01" },
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: draft.model, max_tokens: 8 });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("tests a saved x-api-key without exposing it or sending it to a different host", async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://api.mwapi.dev", ANTHROPIC_API_KEY: draft.apiKey },
      }),
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("rejected", { status: 401 }));
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    expect(await service.test({ ...draft, apiKey: "" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("HTTP 401"),
    });
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": draft.apiKey });
    await expect(
      service.test({ ...draft, apiKey: "", baseUrl: "https://another.example" }),
    ).rejects.toThrow("Enter the API key again");
    await expect(
      service.save({ ...draft, apiKey: "", baseUrl: "https://another.example" }),
    ).rejects.toThrow("Enter the API key again");
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not reuse a direct Anthropic key with a new gateway", async () => {
    await fs.writeFile(file, JSON.stringify({ env: { ANTHROPIC_API_KEY: draft.apiKey } }));
    const service = createClaudeApiService({ settingsPath: file });
    await expect(service.save({ ...draft, apiKey: "" })).rejects.toThrow("Enter the API key again");
  });

  it("preserves malformed files and does not echo their contents in errors", async () => {
    const broken = `{"env":{"ANTHROPIC_AUTH_TOKEN":"${draft.apiKey}"},`;
    await fs.writeFile(file, broken);
    const service = createClaudeApiService({ settingsPath: file });
    await expect(service.load()).rejects.toThrow("Could not read Claude settings");
    await expect(service.save(draft)).rejects.toThrow("Could not save Claude settings");
    expect(await fs.readFile(file, "utf8")).toBe(broken);
  });

  it("keeps a settings symlink and rejects unsafe URLs before any request", async () => {
    const target = path.join(directory, "real.json");
    await fs.writeFile(target, "{}");
    await fs.symlink(target, file);
    const request = vi.fn<typeof fetch>();
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    await service.save(draft);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    await Promise.all(
      [
        "http://api.mwapi.dev",
        "https://user:pass@api.mwapi.dev",
        "https://api.mwapi.dev/path",
        "https://api.mwapi.dev?key=secret",
      ].map((baseUrl) =>
        expect(service.test({ ...draft, baseUrl })).rejects.toThrow("HTTPS base URL"),
      ),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("reports network failures and invalid success bodies without returning gateway text", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(draft.apiKey))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: draft.apiKey })));
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    const failure = await service.test(draft);
    expect(failure.ok).toBe(false);
    expect(failure.message).not.toContain(draft.apiKey);
    expect(await service.test(draft)).toMatchObject({
      ok: false,
      message: expect.stringContaining("Anthropic Messages"),
    });
  });

  it("distinguishes timeout, proxy, DNS and certificate failures without exposing request details", async () => {
    const failures = [
      {
        error: new DOMException("request included a private key", "TimeoutError"),
        message: "Connection timed out",
      },
      {
        error: new Error("fetch failed", { cause: { code: "ETIMEDOUT" } }),
        message: "Connection timed out",
      },
      { error: new Error("net::ERR_NAME_NOT_RESOLVED"), message: "Could not resolve" },
      {
        error: new Error("net::ERR_CERT_AUTHORITY_INVALID"),
        message: "certificate could not be verified",
      },
      { error: new Error("net::ERR_PROXY_CONNECTION_FAILED"), message: "system proxy settings" },
    ];
    const request = vi.fn<typeof fetch>();
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    for (const failure of failures) request.mockRejectedValueOnce(failure.error);
    const results = await Promise.all(failures.map(() => service.test(draft)));
    results.forEach((result, index) => {
      expect(result).toMatchObject({
        ok: false,
        message: expect.stringContaining(failures[index].message),
      });
      expect(result.message).not.toContain("private key");
    });
  });

  it("reports a non-JSON gateway response as a protocol error", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>gateway page</html>"));
    const service = createClaudeApiService({ settingsPath: file, fetch: request });
    expect(await service.test(draft)).toMatchObject({
      ok: false,
      message: expect.stringContaining("invalid JSON"),
    });
  });
});
