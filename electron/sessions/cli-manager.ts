import { CLI_MANAGER_URL } from "../../src/lib/cli-manager-quota";
import { parseManagerSessions } from "../../src/lib/cli-manager-sessions";

/** Fixed local read-only endpoint; concurrent windows share one fetch. */
export function createManagerSessionsService(fetchSessions: typeof fetch = fetch) {
  let flight: Promise<unknown> | null = null;
  const controller = new AbortController();
  return {
    async list(limit?: number) {
      if (!flight) {
        flight = (async () => {
          const response = await fetchSessions(new URL("api/sessions", CLI_MANAGER_URL), {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            redirect: "error",
          });
          if (!response.ok) throw new Error("CLI Manager session history could not be reached");
          return response.json() as Promise<unknown>;
        })().finally(() => {
          flight = null;
        });
      }
      return parseManagerSessions(await flight, limit);
    },
    close() {
      controller.abort();
    },
  };
}
