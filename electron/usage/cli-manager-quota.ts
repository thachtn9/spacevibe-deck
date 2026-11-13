import {
  CLI_MANAGER_URL,
  parseCliManagerStatus,
  type CliQuotaSnapshot,
} from "../../src/lib/cli-manager-quota";

/** Read the manager's existing cache; never refresh providers or switch accounts. */
export function createCliManagerQuotaService(fetchStatus: typeof fetch = fetch) {
  let flight: Promise<CliQuotaSnapshot> | null = null;
  const controller = new AbortController();
  return {
    snapshot(): Promise<CliQuotaSnapshot> {
      if (flight) return flight;
      flight = (async () => {
        const response = await fetchStatus(new URL("api/status", CLI_MANAGER_URL), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          redirect: "error",
        });
        if (!response.ok) throw new Error("CLI Manager could not be reached");
        return parseCliManagerStatus(await response.json());
      })().finally(() => {
        flight = null;
      });
      return flight;
    },
    close(): void {
      controller.abort();
    },
  };
}
