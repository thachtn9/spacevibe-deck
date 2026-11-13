import { invoke } from "./bridge";
import type { ClaudeApiDraft, ClaudeApiSettings, ClaudeApiTestResult } from "../lib/claude-api";

export const claudeApiHost = {
  get available(): boolean {
    return (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
  },
  load: () => invoke<ClaudeApiSettings>("claude_api_load"),
  save: ({ baseUrl, model, apiKey }: ClaudeApiDraft) =>
    invoke<ClaudeApiSettings>("claude_api_save", { baseUrl, model, apiKey }),
  test: ({ baseUrl, model, apiKey }: ClaudeApiDraft) =>
    invoke<ClaudeApiTestResult>("claude_api_test", { baseUrl, model, apiKey }),
};
