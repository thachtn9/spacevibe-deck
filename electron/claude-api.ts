import fs from "node:fs/promises";
import {
  claudeUserSettingsPath,
  updateClaudeUserSettings,
} from "./agent-hooks/claude-user-settings";
import {
  CLAUDE_API_DEFAULT_MODEL,
  CLAUDE_API_DEFAULT_URL,
  type ClaudeApiDraft,
  type ClaudeApiSettings,
  type ClaudeApiTestResult,
} from "../src/lib/claude-api";

type Document = Record<string, unknown>;

function object(value: unknown): Document {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Claude settings are invalid. Repair the settings file and try again.");
  }
  return value as Document;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(text(value).trim());
  } catch {
    throw new Error("Enter a valid HTTPS base URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new Error("Use an HTTPS base URL with no path, or ending in /v1.");
  }
  return url.origin;
}

function validate(raw: ClaudeApiDraft): ClaudeApiDraft {
  const baseUrl = normalizeUrl(raw.baseUrl);
  const model = text(raw.model).trim();
  const apiKey = text(raw.apiKey).trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(model)) {
    throw new Error("Enter a valid model ID.");
  }
  if (
    apiKey &&
    (apiKey.length > 4096 ||
      /\s/.test(apiKey) ||
      [...apiKey].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /…|\.\.\./.test(apiKey))
  ) {
    throw new Error("Enter the complete API key without spaces.");
  }
  return { baseUrl, model, apiKey };
}

function connectionFailure(error: unknown): ClaudeApiTestResult {
  const failure = error instanceof Error ? error : null;
  const cause = failure?.cause as { code?: unknown } | undefined;
  const code =
    text(cause?.code) ||
    text((failure as { code?: unknown } | null)?.code) ||
    failure?.message.match(/net::(ERR_[A-Z_]+)/)?.[1] ||
    "";
  const timeout =
    failure?.name === "TimeoutError" ||
    failure?.name === "AbortError" ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ERR_CONNECTION_TIMED_OUT", "ERR_TIMED_OUT"].includes(
      code,
    );
  if (timeout) {
    return {
      ok: false,
      message: "Connection timed out. Check your network and proxy settings, then retry.",
    };
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ERR_NAME_NOT_RESOLVED"].includes(code)) {
    return {
      ok: false,
      message: "Could not resolve the gateway address. Check the base URL and DNS settings.",
    };
  }
  if (
    code.startsWith("ERR_CERT_") ||
    [
      "CERT_HAS_EXPIRED",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ].includes(code)
  ) {
    return {
      ok: false,
      message:
        "The gateway certificate could not be verified. Check the certificate and system proxy configuration.",
    };
  }
  return {
    ok: false,
    message:
      "Could not connect to the gateway. Check your network and system proxy settings, then retry.",
  };
}

export function createClaudeApiService(
  deps: {
    readonly settingsPath?: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
) {
  const file = deps.settingsPath ?? claudeUserSettingsPath();
  const request = deps.fetch ?? fetch;

  async function read(): Promise<Document> {
    try {
      return object(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Could not read Claude settings. Repair the file and try again.");
    }
  }

  function environment(document: Document): Document {
    return document.env === undefined ? {} : object(document.env);
  }

  function credential(env: Document): { key: string; header: string } {
    const token = text(env.ANTHROPIC_AUTH_TOKEN);
    return token
      ? { key: token, header: "Authorization" }
      : { key: text(env.ANTHROPIC_API_KEY), header: "x-api-key" };
  }

  function publicSettings(document: Document): ClaudeApiSettings {
    const env = environment(document);
    return {
      baseUrl: text(env.ANTHROPIC_BASE_URL) || CLAUDE_API_DEFAULT_URL,
      model: (text(env.ANTHROPIC_BASE_URL) && text(document.model)) || CLAUDE_API_DEFAULT_MODEL,
      hasApiKey: !!credential(env).key,
    };
  }

  return {
    async load(): Promise<ClaudeApiSettings> {
      return publicSettings(await read());
    },
    async save(raw: ClaudeApiDraft): Promise<ClaudeApiSettings> {
      const draft = validate(raw);
      // Tighten an existing file before the atomic writer preserves its mode.
      await fs.chmod(file, 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw new Error("Could not secure Claude settings.");
      });
      let saved!: ClaudeApiSettings;
      await updateClaudeUserSettings(file, (document) => {
        const env = environment(document);
        if (!draft.apiKey && !credential(env).key) throw new Error("Enter an API key first.");
        if (
          !draft.apiKey &&
          normalizeUrl(text(env.ANTHROPIC_BASE_URL) || "https://api.anthropic.com") !==
            draft.baseUrl
        ) {
          throw new Error("Enter the API key again when changing the gateway address.");
        }
        const nextEnv: Document = { ...env, ANTHROPIC_BASE_URL: draft.baseUrl };
        if (draft.baseUrl === CLAUDE_API_DEFAULT_URL) {
          nextEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
        }
        if (draft.apiKey) {
          Object.assign(nextEnv, { ANTHROPIC_AUTH_TOKEN: draft.apiKey });
          delete nextEnv.ANTHROPIC_API_KEY;
        }
        const next = { ...document, env: nextEnv, model: draft.model };
        saved = publicSettings(next);
        return next;
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        if (
          [
            "Enter an API key first.",
            "Enter the API key again when changing the gateway address.",
          ].includes(message)
        ) {
          throw new Error(message);
        }
        throw new Error(
          "Could not save Claude settings. Check the file and its permissions, then retry.",
        );
      });
      return saved;
    },
    async test(raw: ClaudeApiDraft): Promise<ClaudeApiTestResult> {
      const draft = validate(raw);
      const env = environment(await read());
      const saved = credential(env);
      const key = draft.apiKey || saved.key;
      if (!key) throw new Error("Enter an API key first.");
      if (
        !draft.apiKey &&
        normalizeUrl(text(env.ANTHROPIC_BASE_URL) || "https://api.anthropic.com") !== draft.baseUrl
      ) {
        throw new Error("Enter the API key again when changing the gateway address.");
      }
      const header = draft.apiKey ? "Authorization" : saved.header;
      try {
        const response = await request(`${draft.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            [header]: header === "Authorization" ? `Bearer ${key}` : key,
          },
          body: JSON.stringify({
            model: draft.model,
            max_tokens: 8,
            messages: [{ role: "user", content: "Reply OK." }],
          }),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          const detail =
            response.status === 401 || response.status === 403
              ? "The key was rejected. Check the key and account access."
              : response.status === 404
                ? "The endpoint or model was not found. Check the base URL and model ID."
                : response.status === 429
                  ? "The gateway limit was reached. Check your balance or try again later."
                  : "The gateway could not complete the request. Check the model and account balance, then retry.";
          return { ok: false, message: `HTTP ${response.status}. ${detail}` };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return {
            ok: false,
            message:
              "The gateway returned invalid JSON. Check that the base URL serves the Anthropic Messages API.",
          };
        }
        if (
          !body ||
          typeof body !== "object" ||
          !("type" in body) ||
          body.type !== "message" ||
          !("content" in body) ||
          !Array.isArray(body.content)
        ) {
          return {
            ok: false,
            message: "The gateway did not return an Anthropic Messages response.",
          };
        }
        return { ok: true, message: `Connected. ${draft.model} returned a response.` };
      } catch (error) {
        return connectionFailure(error);
      }
    },
  };
}
