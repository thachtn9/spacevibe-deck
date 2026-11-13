// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseCliManagerStatus } from "../../lib/cli-manager-quota";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("../../host/bridge", () => ({ invoke: mocks.invoke }));
vi.mock("../../host/shell-host", () => ({ openUrl: mocks.openUrl }));
vi.stubGlobal("__deckHost", {});
const { UsageDockTab } = await import("./usage-dock-tab");
const { RailCliQuota } = await import("./cli-quota");
const { cliQuota, cliQuotaError, cliQuotaLoading } = await import("../../usage/cli-quota-store");
const now = Date.parse("2026-10-15T07:00:00Z");
const snapshot = parseCliManagerStatus(
  {
    antigravity: {
      active: "acc5",
      accounts: {
        acc5: {
          name: "acc5",
          quota: {
            status: "ok",
            gemini_5h_pct: 98.2,
            gemini_weekly_pct: 97.8,
            fetched_at: new Date(now).toISOString(),
          },
        },
        acc1: {
          name: "acc1",
          quota: { status: "ok", gemini_5h_pct: 0, fetched_at: new Date(now).toISOString() },
        },
      },
    },
    codex: {
      active: "codex2",
      accounts: {
        codex2: {
          name: "codex2",
          quota: {
            status: "ok",
            codex_5h_pct: 73,
            codex_weekly_pct: 81,
            fetched_at: new Date(now).toISOString(),
          },
        },
      },
    },
  },
  now,
);
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(snapshot);
  cliQuota.value = null;
  cliQuotaError.value = false;
  cliQuotaLoading.value = false;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});
it("replaces tokens and cost with all managed account quotas, preserving zero and unknown", async () => {
  await act(async () => render(<UsageDockTab />, host));
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Quota remaining");
  expect(host.textContent).toContain("98.2%");
  expect(host.textContent).toContain("0%");
  expect(host.textContent).toContain("—");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
  expect(host.querySelectorAll(".cli-quota__active")).toHaveLength(0);
  expect(
    [...host.querySelectorAll(".cli-quota__group")].map((el) => el.getAttribute("aria-label")),
  ).toEqual(["Codex accounts", "AGY accounts"]);
  expect(host.querySelector('[role="meter"][aria-valuenow="0"]')).not.toBeNull();
  expect(host.querySelector(".cli-quota__low")).not.toBeNull();
  expect(host.textContent).not.toMatch(/Claude|tokens|estimated cost|\$/i);
  expect(mocks.invoke.mock.calls).toEqual([["cli_manager_quota"]]);
});

it("collapses each quota group and opens a split only on double-click", async () => {
  const open = vi.fn();
  await act(async () =>
    render(<UsageDockTab accountActions={{ slotRects: () => [], open }} />, host),
  );
  await act(async () => {
    await Promise.resolve();
  });
  const toggle = host.querySelector<HTMLButtonElement>(".cli-quota__toggle")!;
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector<HTMLTableElement>("#quota-codex-accounts")!.hidden).toBe(true);
  act(() => toggle.click());
  const handle = host.querySelector<HTMLButtonElement>('[aria-label="Split with codex2"]')!;
  act(() => handle.click());
  expect(open).not.toHaveBeenCalled();
  act(() => {
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "codex2", agent: "codex" }), {
    kind: "split",
  });
});

it("drags an account to a specific terminal and calls launch only once", async () => {
  const open = vi.fn();
  const actions = { slotRects: () => [{ id: 7, left: 0, top: 0, right: 200, bottom: 100 }], open };
  await act(async () => render(<UsageDockTab accountActions={actions} />, host));
  await act(async () => {
    await Promise.resolve();
  });
  const handle = host.querySelector<HTMLButtonElement>('[aria-label="Split with codex2"]')!;
  function pointer(type: string, x: number, y: number) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    return event;
  }
  handle.dispatchEvent(pointer("pointerdown", 500, 500));
  window.dispatchEvent(pointer("pointermove", 100, 50));
  expect(document.querySelector(".quota-account-drop")?.textContent).toContain("codex2");
  window.dispatchEvent(pointer("pointerup", 100, 50));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "codex2" }), {
    kind: "split",
    paneId: 7,
    edge: "left",
  });
});
it("shares one quota poll between rail and dock and stops on final unmount", async () => {
  await act(async () =>
    render(
      <>
        <RailCliQuota onOpenUsage={() => undefined} />
        <UsageDockTab />
      </>,
      host,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(host.querySelector(".agent-usage-summary")?.textContent).toContain("AGY 97.8%");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  act(() => render(null, host));
  expect(vi.getTimerCount()).toBe(0);
});
it("marks retained quota as cached when the manager is unavailable and recovers on refresh", async () => {
  await act(async () => render(<UsageDockTab />, host));
  await act(async () => {
    await Promise.resolve();
  });
  mocks.invoke.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(host.textContent).toContain("CLI Manager is unavailable. Showing the last reading.");
  expect(host.textContent).toContain("98.2%");
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Refresh")!;
  await act(async () => button.click());
  expect(host.textContent).not.toContain("CLI Manager is unavailable");
});
it("shows an offline state without fabricated quota when the first read fails", async () => {
  mocks.invoke.mockRejectedValue(new Error("offline"));
  await act(async () => render(<UsageDockTab />, host));
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Open CLI Manager, then refresh.");
  expect(host.querySelector("table")).toBeNull();
});
