import { describe, expect, it } from "vitest";
import { DesktopAgentModel, validateDesktopAgents, validateDesktopAgentTheme } from "./model";
const row = (paneId: number, state = "working") => ({
  paneId,
  agentId: "codex",
  agent: "Codex",
  project: "deck",
  session: "Fix terminal resize",
  state,
});

describe("desktop agent snapshots", () => {
  it("keeps window identities distinct and puts requests before working agents", () => {
    const model = new DesktopAgentModel();
    model.update("main", validateDesktopAgents([row(1), row(2, "error")]), {});
    model.update("deck-1", validateDesktopAgents([row(3, "requested")]), {});
    expect(model.snapshot().rows.map((entry) => entry.key)).toEqual([
      "main:2",
      "deck-1:3",
      "main:1",
    ]);
    expect(model.target("deck-1:3")).toEqual({ label: "deck-1", paneId: 3 });
    expect(model.target("main:3")).toBeNull();
    model.forget("deck-1");
    expect(model.target("deck-1:3")).toBeNull();
  });
  it("replaces a window's snapshot and removes closed panes", () => {
    const model = new DesktopAgentModel();
    model.update("main", validateDesktopAgents([row(1)]), {});
    const first = model.snapshot();
    model.update("main", [], {});
    expect(model.snapshot().rows).toEqual([]);
    expect(model.snapshot().revision).toBeGreaterThan(first.revision);
    expect(model.target("main:1")).toBeNull();
  });
  it("rejects unbounded, duplicate, or malformed renderer input", () => {
    for (const rows of [
      null,
      [row(-1)],
      [row(1), row(1)],
      [row(1, "not-a-state")],
      [{ ...row(1), agentId: "" }],
      [{ ...row(1), agent: "x".repeat(81) }],
      [{ ...row(1), session: "" }],
      Array.from({ length: 257 }, (_, i) => row(i)),
    ]) {
      expect(() => validateDesktopAgents(rows)).toThrow(/Invalid desktop agent/);
    }
  });
  it("only forwards known hex theme values", () => {
    expect(
      validateDesktopAgentTheme({
        background: "#123456",
        foreground: "url(file:///tmp/a)",
        blue: "red",
        extra: "#ffffff",
      }),
    ).toEqual({ background: "#123456" });
  });
});
