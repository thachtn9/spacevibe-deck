// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CliQuotaAccount, CliQuotaSnapshot } from "../../lib/cli-manager-quota";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../host/bridge", () => ({ invoke: mocks.invoke }));
vi.mock("./rail-codex-cost", () => ({ RailCodexCost: () => null }));
vi.stubGlobal("__deckHost", {});
const { RailQuotaPanel } = await import("./rail-quota-panel");
const { CliQuotaBody } = await import("./cli-quota");
const { cliQuota, cliQuotaError, cliQuotaLoading } = await import("../../usage/cli-quota-store");
const now = Date.parse("2026-10-16T07:00:00Z");
const account: CliQuotaAccount = {
  agent: "codex",
  id: "codex1",
  name: "codex1",
  active: true,
  state: "ready",
  limited: false,
  observedAtMs: now,
  fiveHour: 73,
  weekly: 42,
  fiveHourResetAtMs: now + 125 * 60_000,
  weeklyResetAtMs: now + 3 * 86_400_000,
};
const snapshot = (accounts = [account]): CliQuotaSnapshot => ({ checkedAtMs: now, accounts });
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  cliQuota.value = null;
  cliQuotaError.value = false;
  cliQuotaLoading.value = false;
  mocks.invoke.mockResolvedValue(snapshot());
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
});
async function mount(accounts = [account], open = vi.fn()) {
  mocks.invoke.mockResolvedValue(snapshot(accounts));
  await act(async () =>
    render(
      <>
        <RailQuotaPanel accountActions={{ slotRects: () => [], open }} />
      </>,
      host,
    ),
  );
  return open;
}
it("draws two labelled remaining-quota bars with no reset text while allowance remains", async () => {
  await mount();
  expect(host.querySelectorAll(".rail-quota__bar-fill")).toHaveLength(2);
  expect(
    [...host.querySelectorAll(".rail-quota__bar-fill")].map((n) => (n as HTMLElement).style.width),
  ).toEqual(["73%", "42%"]);
  expect(host.querySelector(".rail-quota__reset")).toBeNull();
  expect(host.querySelector(".rail-quota__row")?.getAttribute("aria-label")).toContain(
    "5h 73% remaining. 1w 42% remaining",
  );
  expect(host.textContent).not.toMatch(/Active|125m/);
});
it("formats hours and minutes at zero and counts down across the hour boundary", async () => {
  await mount([{ ...account, fiveHour: 0, fiveHourResetAtMs: now + 60 * 60_000 }]);
  expect(host.querySelector(".rail-quota__reset")?.textContent).toBe("5h resets in 1h0m");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(host.querySelector(".rail-quota__reset")?.textContent).toBe("5h resets in 59m");
  expect(host.querySelectorAll(".rail-quota__reset")).toHaveLength(1);
  expect(host.querySelector(".rail-quota__meter .rail-quota__reset")).not.toBeNull();
  expect(host.querySelectorAll(".rail-quota__meter")).toHaveLength(2);
});
it("shows weekly reset date and time, including when both windows are exhausted", async () => {
  await mount([{ ...account, fiveHour: 0, weekly: 0 }]);
  const text = [...host.querySelectorAll(".rail-quota__reset")].map((n) => n.textContent);
  expect(text[0]).toBe("5h resets in 2h5m");
  expect(text[1]).toContain("1w");
  expect(text[1]).toMatch(/19/);
  expect(text[1]).toMatch(/\d{2}:\d{2}/);
  expect(
    [...host.querySelectorAll<HTMLElement>(".rail-quota__bar-fill")].map((n) => n.style.width),
  ).toEqual([]);
  expect([...host.querySelectorAll(".rail-quota__percent")].map((n) => n.textContent)).toEqual([
    "0%",
    "0%",
  ]);
});
it("puts the limited window's reset on its existing line without an extra Limited row", async () => {
  await mount([{ ...account, fiveHour: 0, limited: true }]);
  expect(host.querySelector(".rail-quota__meter")?.textContent).toContain("5h resets in 2h5m");
  expect(host.querySelector(".rail-quota__state")).toBeNull();
  expect(host.querySelectorAll(".rail-quota__meter")).toHaveLength(2);
});
it("never fills unknown quota and marks unavailable, cached and offline readings", async () => {
  await mount([{ ...account, state: "unavailable", fiveHour: null, weekly: null }]);
  expect(host.querySelectorAll(".is-unknown")).toHaveLength(2);
  expect(host.querySelectorAll(".rail-quota__bar-fill")).toHaveLength(0);
  expect(host.textContent).toContain("Quota unavailable");
  act(() => {
    cliQuota.value = snapshot([{ ...account, observedAtMs: now - 360_000 }]);
    cliQuotaError.value = true;
  });
  expect(host.textContent).toContain("CLI Manager offline");
  expect(host.querySelector(".rail-quota__state")?.textContent).toBe("Cached quota");
});
it("shows only Codex accounts in numeric order without a provider heading or count", async () => {
  await mount([
    { ...account, agent: "agy", id: "acc1", name: "acc1" },
    { ...account, id: "codex10", name: "codex10" },
    account,
  ]);
  expect(host.querySelector(".rail-quota__toggle")).toBeNull();
  expect(host.querySelector("h3")).toBeNull();
  expect(host.textContent).not.toContain("Codex");
  expect([...host.querySelectorAll(".rail-quota__row-name")].map((n) => n.textContent)).toEqual([
    "codex1",
    "codex10",
  ]);
  act(() => {
    cliQuota.value = snapshot([account]);
  });
  expect(host.querySelectorAll(".rail-quota__row")).toHaveLength(1);
});
it("explains an empty Codex list even when AGY accounts exist", async () => {
  await mount([{ ...account, agent: "agy", id: "acc1", name: "acc1" }]);
  expect(host.textContent).toContain("No Codex accounts in CLI Manager.");
  expect(host.querySelector(".rail-quota__row")).toBeNull();
});
it("shares the dock poll and opens the exact account only on double-click", async () => {
  const open = vi.fn();
  await mount([account], open);
  const button = host.querySelector<HTMLButtonElement>(".rail-quota__row")!;
  act(() => button.click());
  expect(open).not.toHaveBeenCalled();
  act(() => {
    button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(open).toHaveBeenCalledExactlyOnceWith(account, { kind: "split" });
  await act(async () =>
    render(
      <>
        <RailQuotaPanel />
        <CliQuotaBody />
      </>,
      host,
    ),
  );
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  act(() => render(null, host));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("binds account dragging as soon as the sidebar quota is shown again", async () => {
  const open = vi.fn();
  const actions = {
    open,
    slotRects: () => [{ id: 7, left: 300, top: 0, right: 600, bottom: 400 }],
  };
  await act(async () => render(<RailQuotaPanel accountActions={actions} />, host));
  act(() => render(null, host));
  act(() => {
    render(<RailQuotaPanel accountActions={actions} />, host);
    const button = host.querySelector<HTMLButtonElement>(".rail-quota__row")!;
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 42 });
      return event;
    };
    button.dispatchEvent(pointer("pointerdown", 50, 50));
    window.dispatchEvent(pointer("pointermove", 580, 200));
    window.dispatchEvent(pointer("pointerup", 580, 200));
  });
  expect(open).toHaveBeenCalledExactlyOnceWith(account, {
    kind: "split",
    paneId: 7,
    edge: "right",
  });
});
