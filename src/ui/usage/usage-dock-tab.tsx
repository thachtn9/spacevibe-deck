import { CliQuotaBody, type QuotaAccountActions } from "./cli-quota";

/** Keep the persisted dock tab id while replacing token costs with quota. */
export function UsageDockTab({
  accountActions,
}: {
  readonly accountActions?: QuotaAccountActions;
}) {
  return <CliQuotaBody accountActions={accountActions} />;
}
