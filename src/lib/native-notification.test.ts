import { afterEach, describe, expect, it, vi } from "vitest";
import notificationSoundUrl from "../assets/noti.mp3";
import { AGENT_SOUND_COOLDOWN_MS, createAgentNotificationAdapter } from "./native-notification";

const shell = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("../host/shell-host", () => shell);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("agent notification sound", () => {
  it("loads the bundled MP3 lazily and never calls OS notification APIs", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const Audio = vi.fn(function () {
      return { currentTime: 0, play };
    });
    vi.stubGlobal("Audio", Audio);
    const adapter = createAgentNotificationAdapter();
    expect(Audio).not.toHaveBeenCalled();

    await adapter.send({ title: "Workspace", body: "Agent finished" });

    expect(Audio).toHaveBeenCalledWith(notificationSoundUrl);
    expect(play).toHaveBeenCalledOnce();
    expect(shell.isPermissionGranted).not.toHaveBeenCalled();
    expect(shell.requestPermission).not.toHaveBeenCalled();
    expect(shell.sendNotification).not.toHaveBeenCalled();
  });

  it("restarts the same player for subsequent alerts instead of stacking players", async () => {
    const audio = { currentTime: 1.5, play: vi.fn().mockResolvedValue(undefined) };
    const createAudio = vi.fn(() => audio);
    let now = 0;
    const adapter = createAgentNotificationAdapter(createAudio, () => now);

    await adapter.send({ title: "First" });
    expect(audio.currentTime).toBe(0);
    audio.currentTime = 0.5;
    now += AGENT_SOUND_COOLDOWN_MS;
    await adapter.send({ title: "Second" });

    expect(audio.currentTime).toBe(0);
    expect(createAudio).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("collapses unrelated alerts arriving within the global cooldown", async () => {
    const audio = { currentTime: 0, play: vi.fn().mockResolvedValue(undefined) };
    let now = 10_000;
    const adapter = createAgentNotificationAdapter(
      () => audio,
      () => now,
    );

    await adapter.send({ title: "First pane" });
    now += AGENT_SOUND_COOLDOWN_MS - 1;
    await adapter.send({ title: "Second pane" });
    now += 1;
    await adapter.send({ title: "Third pane" });

    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("does not start a second player while the first play request is pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const audio = { currentTime: 0, play: vi.fn(() => pending) };
    const adapter = createAgentNotificationAdapter(() => audio);

    const first = adapter.send({ title: "First pane" });
    await adapter.send({ title: "Second pane" });
    expect(audio.play).toHaveBeenCalledOnce();

    release();
    await first;
  });

  it("contains playback rejection and allows the next alert to retry", async () => {
    const play = vi
      .fn()
      .mockRejectedValueOnce(new Error("Audio unavailable"))
      .mockResolvedValueOnce(undefined);
    const adapter = createAgentNotificationAdapter(() => ({ currentTime: 0, play }));

    await expect(adapter.send({ title: "First" })).resolves.toBeUndefined();
    await expect(adapter.send({ title: "Second" })).resolves.toBeUndefined();
    expect(play).toHaveBeenCalledTimes(2);
    expect(shell.sendNotification).not.toHaveBeenCalled();
  });

  it("contains player construction failure and retries on the next alert", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const createAudio = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Audio unavailable");
      })
      .mockReturnValueOnce({ currentTime: 0, play });
    const adapter = createAgentNotificationAdapter(createAudio);

    await expect(adapter.send({ title: "First" })).resolves.toBeUndefined();
    await adapter.send({ title: "Second" });
    expect(play).toHaveBeenCalledOnce();
  });
});
