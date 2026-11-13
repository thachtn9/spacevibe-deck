import { useMemo, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { agentTotals } from "../../lib/usage-aggregate";
import { formatUsd } from "../../lib/usage-pricing";
import { totalTokens } from "../../lib/usage-snapshot";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { AgentGlyph } from "../controls/agent-glyph";
import { EM_DASH, ESTIMATE_NOTE, formatTokensCompact } from "./usage-format";
import { rangeSinceMs, USAGE_RANGES, type UsageRangeId } from "./usage-ranges";

const COST_RANGES: readonly UsageRangeId[] = ["all", "today", "7d", "30d"];

/** Codex usage for the selected local-day period, using existing history pricing. */
export function RailCodexCost() {
  const rangeId = useSignal<UsageRangeId>("all");
  useEffect(() => {
    startUsagePolling();
    return stopUsagePolling;
  }, []);
  const range = USAGE_RANGES.find((entry) => entry.id === rangeId.value)!;
  const label = range.id === "all" ? "All time" : range.label;
  const sinceMs = rangeSinceMs(range, Date.now());
  const snapshot = usageSnapshot.value;
  const total = useMemo(
    () =>
      agentTotals(snapshot?.buckets.filter((bucket) => bucket.agent === "codex") ?? [], sinceMs)[0],
    [snapshot, sinceMs],
  );
  const source = snapshot?.sources.find((entry) => entry.agent === "codex");
  const cost = total?.costUsd ?? null;
  return (
    <section class="rail-quota__cost" aria-label="Codex estimated API cost">
      <div class="rail-quota__cost-head">
        <h2>Agent cost</h2>
        <button
          type="button"
          class="rail-quota__cost-range"
          aria-label={`Cost period: ${label}`}
          title="Change cost period: All time, Today, 7 days, 30 days"
          onClick={() => {
            rangeId.value =
              COST_RANGES[(COST_RANGES.indexOf(rangeId.value) + 1) % COST_RANGES.length];
          }}
        >
          {label}
        </button>
      </div>
      <div class="rail-quota__cost-line">
        <AgentGlyph agent="codex" className="rail-quota__cost-logo" />
        <span>Codex</span>
        <strong title={ESTIMATE_NOTE}>{cost === null ? EM_DASH : formatUsd(cost)}</strong>
      </div>
      {total && (
        <p>
          {formatTokensCompact(totalTokens(total.counters))} tokens
          {total.unpricedTokens > 0 && <> · {formatTokensCompact(total.unpricedTokens)} unpriced</>}
        </p>
      )}
      {total && total.unpricedModels.length > 0 && (
        <p title={total.unpricedModels.join(", ")}>
          {cost === null ? "No priced data" : "Partial estimate"} · excludes models without a price
        </p>
      )}
      <p role="status">
        {usageStale.value || source?.state === "unreadable"
          ? total
            ? "Cost history is stale — showing the last good read."
            : "Could not read Codex cost history."
          : !snapshot
            ? usageLoading.value
              ? "Reading cost history…"
              : "Cost history unavailable."
            : !total
              ? range.id === "all"
                ? "No recorded Codex usage."
                : range.emptyLabel
              : null}
      </p>
    </section>
  );
}
