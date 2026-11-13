import { describe, expect, it } from "vitest";
import { formatQuota, parseCliManagerStatus, quotaIsStale } from "./cli-manager-quota";

const fetched = "2026-10-15T06:00:00Z";
const fixture = {
  antigravity: {
    active: "acc2",
    accounts: {
      acc1: {
        name: "acc1",
        email: "private@example.test",
        quota: {
          status: "ok",
          gemini_5h_pct: 0,
          gemini_weekly_pct: 99.3,
          fetched_at: fetched,
          gemini_5h_reset: "2026-10-15T09:00:00Z",
        },
      },
      acc2: { name: "acc2", quota: { status: "ok", gemini_5h_pct: 98.2, fetched_at: fetched } },
    },
  },
  codex: {
    active: "codex1",
    accounts: {
      codex1: {
        name: "codex1",
        quota: {
          status: "ok",
          codex_5h_pct: 73,
          codex_weekly_pct: 82,
          codex_5h_reset_after_seconds: 18000,
          fetched_at: fetched,
        },
      },
    },
  },
};

describe("CLI Manager quota", () => {
  it("preserves remaining percentages, zero and decimal precision and puts active accounts first", () => {
    const result = parseCliManagerStatus(fixture);
    expect(result.accounts.map((a) => a.id)).toEqual(["acc2", "acc1", "codex1"]);
    expect(result.accounts[0]).toMatchObject({
      agent: "agy",
      active: true,
      fiveHour: 98.2,
      weekly: null,
    });
    expect(result.accounts[1]).toMatchObject({ fiveHour: 0, weekly: 99.3 });
    expect(formatQuota(0)).toBe("0%");
    expect(formatQuota(98.2)).toBe("98.2%");
    expect(result.accounts[1]).not.toHaveProperty("email");
  });

  it("anchors Codex reset durations to the cached reading rather than each poll", () => {
    const first = parseCliManagerStatus(fixture, Date.parse(fetched) + 60_000);
    const next = parseCliManagerStatus(fixture, Date.parse(fetched) + 120_000);
    expect(first.accounts[2].fiveHourResetAtMs).toBe(Date.parse(fetched) + 18_000_000);
    expect(next.accounts[2].fiveHourResetAtMs).toBe(first.accounts[2].fiveHourResetAtMs);
    expect(first.accounts[1].fiveHourResetAtMs).toBe(Date.parse("2026-10-15T09:00:00Z"));
    expect(quotaIsStale(first.accounts[0], Date.parse(fetched) + 360_000)).toBe(true);
  });

  it("shows unavailable quota rather than inventing 100% for missing or invalid readings", () => {
    const result = parseCliManagerStatus({
      antigravity: { accounts: { a: { quota: { status: "error", gemini_5h_pct: 100 } } } },
      codex: {
        accounts: { c: { quota: { status: "ok", codex_5h_pct: -1, codex_weekly_pct: 101 } } },
      },
    });
    expect(result.accounts[0]).toMatchObject({ state: "error", fiveHour: null, weekly: null });
    expect(result.accounts[1]).toMatchObject({ fiveHour: null, weekly: null });
    expect(formatQuota(null)).toBe("—");
    expect(() => parseCliManagerStatus({})).toThrow("invalid status");
  });
});
