// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../../host/desktop-agents-host", () => ({
  desktopAgentsHost: { available: true },
}));
const requestPermission = vi.hoisted(() => vi.fn());
vi.mock("../../../host/shell-host", () => ({ requestPermission }));

import { NotificationsSection } from "./notifications-section";
import { settings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";

describe("NotificationsSection — sound toggle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = { ...DEFAULT_SETTINGS };
    requestPermission.mockClear();
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const mount = (): void => {
    act(() => render(<NotificationsSection />, host));
  };
  const getToggle = (): HTMLButtonElement =>
    host.querySelector('[aria-label="Agent notifications"]') as HTMLButtonElement;

  it("describes sound alerts and preserves the saved setting on mount", () => {
    settings.value = { ...DEFAULT_SETTINGS, agentNotifications: true };
    mount();
    expect(host.textContent).toContain("Play a sound");
    expect(getToggle().getAttribute("aria-checked")).toBe("true");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("toggles desktop activity independently from sound", async () => {
    mount();
    const toggle = host.querySelector('[aria-label="Desktop agent activity"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(settings.value.showDesktopAgents).toBe(false);
    expect(settings.value.agentNotifications).toBe(false);
    await act(async () => toggle.click());
    expect(settings.value.showDesktopAgents).toBe(true);
  });

  it("enables and disables sound without requesting OS notification permission", async () => {
    mount();
    await act(async () => getToggle().click());
    expect(settings.value.agentNotifications).toBe(true);
    expect(getToggle().getAttribute("aria-checked")).toBe("true");

    await act(async () => getToggle().click());
    expect(settings.value.agentNotifications).toBe(false);
    expect(getToggle().getAttribute("aria-checked")).toBe("false");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
