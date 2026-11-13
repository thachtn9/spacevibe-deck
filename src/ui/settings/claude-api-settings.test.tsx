// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeApiHost } from "../../host/claude-api-host";
import { ClaudeApiSettingsForm } from "./claude-api-settings";

vi.mock("../../host/claude-api-host", () => ({
  claudeApiHost: { load: vi.fn(), save: vi.fn(), test: vi.fn() },
}));

describe("Claude API settings form", () => {
  let root: HTMLDivElement;
  const saved = { baseUrl: "https://api.mwapi.dev", model: "claude-sonnet-4-6", hasApiKey: true };
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(claudeApiHost.load).mockResolvedValue(saved);
    root = document.createElement("div");
    document.body.append(root);
    await act(async () => {
      render(<ClaudeApiSettingsForm />, root);
    });
  });
  afterEach(() => {
    act(() => render(null, root));
    root.remove();
  });

  const input = (label: string): HTMLInputElement => root.querySelector(`[aria-label="${label}"]`)!;
  const button = (label: string): HTMLButtonElement =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === label)!;

  it("keeps the saved key out of the form and tests the unsaved draft", async () => {
    expect(input("Claude API key").type).toBe("password");
    expect(input("Claude API key").value).toBe("");
    vi.mocked(claudeApiHost.test).mockResolvedValue({
      ok: false,
      message: "HTTP 401. The key was rejected.",
    });
    act(() => {
      input("Claude API key").value = "sk-draft-key";
      input("Claude API key").dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Test connection").click();
    });
    expect(claudeApiHost.test).toHaveBeenCalledWith({
      ...saved,
      hasApiKey: undefined,
      apiKey: "sk-draft-key",
    });
    expect(claudeApiHost.save).not.toHaveBeenCalled();
    expect(root.textContent).toContain("HTTP 401");
    expect(root.textContent).not.toContain("sk-draft-key");
  });

  it("clears a replacement key only after a successful save", async () => {
    vi.mocked(claudeApiHost.save).mockResolvedValue(saved);
    act(() => {
      input("Claude API key").value = "sk-replacement-key";
      input("Claude API key").dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Save").click();
    });
    expect(input("Claude API key").value).toBe("");
    expect(root.textContent).toContain("Open a new Claude session");
  });
});
