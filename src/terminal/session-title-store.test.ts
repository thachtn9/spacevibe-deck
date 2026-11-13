import { afterEach, describe, expect, it } from "vitest";
import {
  codexSessionTitle,
  paneSessionTitles,
  notePaneSessionTitle,
  forgetPaneSessionTitle,
} from "./session-title-store";

afterEach(() => {
  paneSessionTitles.value = new Map();
});
describe("Codex terminal session titles", () => {
  it("removes the changing spinner and project suffix without changing the conversation name", () => {
    expect(codexSessionTitle("⠋ Fix the café layout | project")).toBe("Fix the café layout");
    expect(codexSessionTitle("Fix the café layout | project")).toBe("Fix the café layout");
    expect(codexSessionTitle("Handle A | B | project")).toBe("Handle A | B");
  });
  it("ignores generic startup, shell and empty titles", () => {
    for (const value of [
      "Codex | project",
      "OpenAI Codex | project",
      "user@host:/repo",
      "",
      "⠋ Working",
    ])
      expect(codexSessionTitle(value)).toBeNull();
  });
  it("keeps each pane independent, suppresses spinner-only updates and forgets closed panes", () => {
    notePaneSessionTitle(1, "⠋ First task | project");
    notePaneSessionTitle(2, "Second task | project");
    const previous = paneSessionTitles.value;
    notePaneSessionTitle(1, "⠸ First task | project");
    expect(paneSessionTitles.value).toBe(previous);
    forgetPaneSessionTitle(1);
    expect([...paneSessionTitles.value]).toEqual([[2, "Second task"]]);
  });
  it("does not carry a previous conversation name into a new shell or untitled session", () => {
    notePaneSessionTitle(1, "Old task | project");
    notePaneSessionTitle(1, "Codex | project");
    expect(paneSessionTitles.value.has(1)).toBe(false);
    notePaneSessionTitle(1, "New task | project");
    notePaneSessionTitle(1, "user@host:/repo");
    expect(paneSessionTitles.value.has(1)).toBe(false);
  });
});
