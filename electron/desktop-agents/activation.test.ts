import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  execFile: vi.fn(),
  getPath: vi.fn(() => "/tmp/deck/agent-widget"),
  setPath: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => false),
  releaseSingleInstanceLock: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: fake.execFile }));
vi.mock("electron", () => ({ app: fake }));
import { activateDesktopAgent } from "./activation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
  vi.stubEnv("DISPLAY", ":0");
  vi.stubEnv("XDG_ACTIVATION_TOKEN", undefined);
  fake.execFile.mockImplementation((_file, _args, _options, reply) => reply(null, "click-token\n"));
  fake.requestSingleInstanceLock.mockReturnValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("desktop widget activation", () => {
  it("passes the click token and exact row to the owner, then restores the helper profile", async () => {
    fake.requestSingleInstanceLock.mockImplementation(() => {
      expect(process.env.XDG_ACTIVATION_TOKEN).toBe("click-token");
      return false;
    });
    expect(await activateDesktopAgent("/tmp/deck", "main:7")).toBe(true);
    expect(fake.requestSingleInstanceLock).toHaveBeenCalledWith({ desktopAgentKey: "main:7" });
    expect(fake.setPath.mock.calls).toEqual([
      ["userData", "/tmp/deck"],
      ["userData", "/tmp/deck/agent-widget"],
    ]);
    expect(process.env.XDG_ACTIVATION_TOKEN).toBeUndefined();
    expect(fake.releaseSingleInstanceLock).not.toHaveBeenCalled();
  });

  it("releases an unexpected lock when the owner has closed", async () => {
    vi.stubEnv("XDG_ACTIVATION_TOKEN", "previous-token");
    fake.requestSingleInstanceLock.mockReturnValue(true);
    expect(await activateDesktopAgent("/tmp/deck", "main:7")).toBe(false);
    expect(fake.releaseSingleInstanceLock).toHaveBeenCalledOnce();
    expect(process.env.XDG_ACTIVATION_TOKEN).toBe("previous-token");
  });

  it("uses the ordinary pipe without a Wayland display", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", undefined);
    expect(await activateDesktopAgent("/tmp/deck", "main:7")).toBe(false);
    expect(fake.execFile).not.toHaveBeenCalled();
    expect(fake.requestSingleInstanceLock).not.toHaveBeenCalled();
  });

  it("falls back when startup notification is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fake.execFile.mockImplementation((_file, _args, _options, reply) =>
        reply(new Error("Startup notification unavailable"), ""),
      );
      expect(await activateDesktopAgent("/tmp/deck", "main:7")).toBe(false);
      expect(fake.setPath).not.toHaveBeenCalled();
      expect(fake.requestSingleInstanceLock).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
