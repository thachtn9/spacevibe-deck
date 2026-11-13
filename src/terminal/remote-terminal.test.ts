import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteTerminal } from "./remote-terminal";

afterEach(() => vi.useRealTimers());
function fixture() {
  let cols = 80;
  const write = vi.fn(async () => true);
  const restore = vi.fn();
  const adapter = createRemoteTerminal({
    id: 9876,
    flush: async () => {},
    snapshot: () => "snapshot",
    dimensions: () => ({ cols, rows: 24 }),
    resize: (next) => {
      cols = next;
    },
    restore,
    write,
    controlled: vi.fn(),
  });
  const request = { action: "read" as const, client: "browser-a", generation: "generation-one" };
  return { adapter, request, write, restore };
}
describe("remote terminal ownership and output", () => {
  it("streams ANSI increments and reboots a lagging cursor from a snapshot", async () => {
    const { adapter, request } = fixture();
    const initial = await adapter.request(request, () => true);
    expect(initial.reset).toBe(true);
    adapter.output("\x1b[31mred\x1b[0m");
    const next = await adapter.request({ ...request, cursor: initial.cursor }, () => true);
    expect(next).toMatchObject({ reset: false, data: "\x1b[31mred\x1b[0m" });
    adapter.output("x".repeat(300_000));
    expect(await adapter.request({ ...request, cursor: next.cursor }, () => true)).toMatchObject({
      reset: true,
      data: "snapshot",
    });
    adapter.dispose();
  });
  it("rejects competing controllers and releases geometry after a missed heartbeat", async () => {
    vi.useFakeTimers();
    const { adapter, request, write, restore } = fixture();
    await adapter.request({ ...request, action: "claim", cols: 100, rows: 24 }, () => true);
    await expect(
      adapter.request(
        { ...request, client: "browser-b", action: "claim", cols: 90, rows: 24 },
        () => true,
      ),
    ).rejects.toThrow("Another browser");
    await adapter.request({ ...request, action: "write", data: "\x03\t\r" }, () => true);
    expect(write).toHaveBeenCalledWith("\x03\t\r");
    await vi.advanceTimersByTimeAsync(12_001);
    expect(adapter.controlled).toBe(false);
    expect(restore).toHaveBeenCalled();
    await expect(
      adapter.request({ ...request, action: "write", data: "bad" }, () => true),
    ).rejects.toThrow("Take control");
    adapter.dispose();
  });
  it("rejects stale generation before writes and revokes a lease when the agent changes", async () => {
    const { adapter, request, write } = fixture();
    await adapter.request({ ...request, action: "claim", cols: 80, rows: 24 }, () => true);
    await expect(
      adapter.request({ ...request, action: "write", data: "bad" }, () => false),
    ).rejects.toThrow("changed");
    await adapter.request({ ...request, generation: "new-agent" }, () => true);
    expect(adapter.controlled).toBe(false);
    expect(write).not.toHaveBeenCalled();
    adapter.dispose();
  });
});
