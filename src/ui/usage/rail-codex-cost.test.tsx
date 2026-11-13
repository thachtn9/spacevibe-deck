// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_COUNTERS, EMPTY_USAGE_SNAPSHOT, type UsageBucket } from "../../lib/usage-snapshot";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { RailCodexCost } from "./rail-codex-cost";

vi.mock("../../usage/usage-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../usage/usage-store")>()),
  startUsagePolling: vi.fn(),
  stopUsagePolling: vi.fn(),
}));

const bucket = (over: Partial<UsageBucket> = {}): UsageBucket => ({
  bucketStartMs: 1_750_000_000_000,
  agent: "codex",
  model: "gpt-5-codex",
  counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
  ...over,
});
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 21, 12));
  vi.clearAllMocks();
  usageSnapshot.value = null;
  usageLoading.value = false;
  usageStale.value = false;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
});
function show(buckets: readonly UsageBucket[]) {
  usageSnapshot.value = { ...EMPTY_USAGE_SNAPSHOT, buckets };
  act(() => render(<RailCodexCost />, host));
}

it("prices only Codex history and excludes other agents from both money and tokens", () => {
  show([bucket(), bucket({ agent: "claude", model: "claude-opus-4-5-20251101" })]);
  expect(host.querySelector("strong")?.textContent).toBe("$1.25");
  expect(host.textContent).toContain("1M tokens");
  expect(host.textContent).not.toContain("Claude");
  expect(host.textContent).not.toContain("not your subscription bill");
  expect(host.textContent).toContain("All time");
});

it("discloses partial pricing without erasing the known cost", () => {
  show([bucket(), bucket({ model: "unpriced-model" })]);
  expect(host.querySelector("strong")?.textContent).toBe("$1.25");
  expect(host.textContent).toContain("2M tokens · 1M unpriced");
  expect(host.textContent).toContain("Partial estimate");
});

it("keeps an entirely unpriced history unknown instead of displaying zero dollars", () => {
  show([bucket({ model: "unpriced-model" })]);
  expect(host.querySelector("strong")?.textContent).toBe("—");
  expect(host.textContent).toContain("No priced data");
  expect(host.textContent).not.toContain("$0.00");
});

it("explains empty Codex history even if another agent has data", () => {
  show([bucket({ agent: "claude" })]);
  expect(host.querySelector("strong")?.textContent).toBe("—");
  expect(host.textContent).toContain("No recorded Codex usage.");
});

it("shows loading, then preserves and labels the last good estimate after a failure", () => {
  usageLoading.value = true;
  act(() => render(<RailCodexCost />, host));
  expect(host.textContent).toContain("Reading cost history…");
  act(() => {
    usageSnapshot.value = { ...EMPTY_USAGE_SNAPSHOT, buckets: [bucket()] };
    usageLoading.value = false;
    usageStale.value = true;
  });
  expect(host.querySelector("strong")?.textContent).toBe("$1.25");
  expect(host.textContent).toContain("Cost history is stale");
});

it("reports an unavailable history without claiming a previous estimate exists", () => {
  usageStale.value = true;
  act(() => render(<RailCodexCost />, host));
  expect(host.textContent).toContain("Could not read Codex cost history.");
  expect(host.textContent).not.toContain("last good");
});

it("runs the existing usage poll only while the sidebar cost summary is mounted", () => {
  show([]);
  expect(startUsagePolling).toHaveBeenCalledOnce();
  expect(stopUsagePolling).not.toHaveBeenCalled();
  act(() => render(null, host));
  expect(stopUsagePolling).toHaveBeenCalledOnce();
});

it("cycles the cost and token totals through all time, today, 7 and 30 local calendar days", () => {
  const now = new Date();
  show(
    [0, 6, 7, 29, 30].map((daysAgo) =>
      bucket({
        bucketStartMs: new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - daysAgo,
        ).getTime(),
      }),
    ),
  );
  const button = host.querySelector<HTMLButtonElement>(".rail-quota__cost-range")!;
  expect(button.textContent).toBe("All time");
  expect(host.querySelector("strong")?.textContent).toBe("$6.25");
  for (const [label, amount, tokens] of [
    ["Today", "$1.25", "1M"],
    ["7 days", "$2.50", "2M"],
    ["30 days", "$5.00", "4M"],
    ["All time", "$6.25", "5M"],
  ]) {
    act(() => button.click());
    expect(button.textContent).toBe(label);
    expect(host.querySelector("strong")?.textContent).toBe(amount);
    expect(host.textContent).toContain(`${tokens} tokens`);
  }
});

it("names the selected period when it has no recorded usage", () => {
  show([bucket()]);
  act(() => host.querySelector<HTMLButtonElement>(".rail-quota__cost-range")!.click());
  expect(host.querySelector("strong")?.textContent).toBe("—");
  expect(host.textContent).toContain("No usage today");
});
