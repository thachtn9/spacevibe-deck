export const CLAUDE_API_DEFAULT_URL = "https://api.mwapi.dev";
export const CLAUDE_API_DEFAULT_MODEL = "claude-sonnet-4-6";
export const CLAUDE_API_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
] as const;

export interface ClaudeApiSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
}

export interface ClaudeApiDraft {
  readonly baseUrl: string;
  readonly model: string;
  /** Empty keeps the saved credential. Never returned by the host. */
  readonly apiKey: string;
}

export interface ClaudeApiTestResult {
  readonly ok: boolean;
  readonly message: string;
}
