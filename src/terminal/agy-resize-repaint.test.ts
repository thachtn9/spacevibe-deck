import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgyResizeRepaint } from "./agy-resize-repaint";

const partial = "\x1b[?2026h\x1b[32A\x1b[JSTATUS\x1b[?2026l";
const repaint = "\x1b[2J\x1b[3J\x1b[H\x1b[?2026hRESPONSE\r\nSTATUS\x1b[?2026l";

afterEach(() => vi.useRealTimers());

describe("AGY resize repaint", () => {
  it("passes ordinary streaming output through immediately", () => {
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.write("hello");
    expect(emit).toHaveBeenCalledWith("hello");
  });

  it("presents the response erasure and its delayed full repaint together", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.begin();
    frames.write(partial);
    vi.advanceTimersByTime(150);
    expect(emit).not.toHaveBeenCalled();
    frames.write(repaint);
    expect(emit.mock.calls).toEqual([[partial + repaint]]);
    frames.write("next token");
    expect(emit).toHaveBeenLastCalledWith("next token");
  });

  it("handles repaint escape sequences split across any PTY chunk boundary", () => {
    for (let split = 1; split < repaint.length; split += 1) {
      const emit = vi.fn();
      const frames = createAgyResizeRepaint(emit);
      frames.begin();
      frames.write(partial + repaint.slice(0, split));
      expect(emit).not.toHaveBeenCalled();
      frames.write(repaint.slice(split));
      expect(emit.mock.calls).toEqual([[partial + repaint]]);
      frames.dispose();
    }
  });

  it("releases output within 250ms even during continuous resizing without a repaint", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.begin();
    frames.write(partial);
    vi.advanceTimersByTime(200);
    frames.begin();
    vi.advanceTimersByTime(50);
    expect(emit).toHaveBeenCalledWith(partial);
  });

  it("bounds queued output when a producer floods the terminal", () => {
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.begin();
    const data = "x".repeat(256 * 1024);
    frames.write(data);
    expect(emit).toHaveBeenCalledWith(data);
    frames.dispose();
  });

  it("flushes pending output for a terminal snapshot", () => {
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.begin();
    frames.write(partial);
    frames.flush();
    expect(emit).toHaveBeenCalledWith(partial);
    frames.dispose();
  });

  it("cancels the timer when the pane is disposed", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const frames = createAgyResizeRepaint(emit);
    frames.begin();
    frames.write(partial);
    frames.dispose();
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });
});
