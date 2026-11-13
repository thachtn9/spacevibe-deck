import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeFileAtomically } from "../fs/write";
import { RemoteRequestError } from "./errors";

const ACTION_LIFETIME = 24 * 60 * 60_000;
interface Reservation {
  key: string;
  fingerprint: string;
  at: number;
}

/** Reserve durably before input/spawn. A crash leaves an uncertain action, never a replay. */
export class RemoteActions {
  private readonly entries = new Map<string, Reservation & { result?: Promise<unknown> }>();
  private readonly ready: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file?: string) {
    this.ready = (async () => {
      if (!file) return;
      try {
        const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
        if (!Array.isArray(raw) || raw.length > 4096) throw new Error("Invalid action ledger.");
        for (const row of raw) {
          if (
            !row ||
            !/^[a-f0-9]{64}$/.test(row.key) ||
            !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
            typeof row.at !== "number" ||
            !Number.isFinite(row.at)
          )
            throw new Error("Invalid action ledger.");
          if (Date.now() - row.at <= ACTION_LIFETIME + 5 * 60_000) this.entries.set(row.key, row);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new RemoteRequestError(
            503,
            "Remote action history could not be read. Repair remote-actions.json on your computer before sending commands.",
          );
      }
    })();
    // A broken ledger blocks mutations; merely opening Settings must not reject globally.
    void this.ready.catch(() => {});
  }

  async run<T>(
    token: string,
    key: string,
    fingerprint: string,
    action: () => Promise<T>,
  ): Promise<T> {
    await this.ready;
    if (!/^\d{13}-[A-Za-z0-9-]{16,64}$/.test(key))
      throw new RemoteRequestError(400, "Supply a timestamped Idempotency-Key for this action.");
    const at = Number(key.slice(0, 13));
    if (Date.now() - at > ACTION_LIFETIME || at - Date.now() > 5 * 60_000)
      throw new RemoteRequestError(
        400,
        "This action expired. Review the session and edit the instruction before sending a new action.",
      );
    const identity = createHash("sha256").update(`${token}:${key}`).digest("hex");
    const previous = this.entries.get(identity);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new RemoteRequestError(
          409,
          "This action key already belongs to a different request.",
        );
      if (previous.result) return previous.result as Promise<T>;
      throw new RemoteRequestError(
        409,
        "Deck already accepted this action before reconnecting. Refresh Sessions and inspect the terminal before starting a new action.",
      );
    }
    for (const [id, row] of this.entries) {
      if (Date.now() - row.at > ACTION_LIFETIME + 5 * 60_000) this.entries.delete(id);
    }
    if (this.entries.size >= 4096)
      throw new RemoteRequestError(429, "Too many recent remote actions. Try again later.");
    const reservation: Reservation & { result?: Promise<T> } = { key: identity, fingerprint, at };
    this.entries.set(identity, reservation);
    const persist = this.writes.then(async () => {
      if (this.file)
        await writeFileAtomically(
          this.file,
          JSON.stringify(
            [...this.entries.values()].map((entry) => ({
              key: entry.key,
              fingerprint: entry.fingerprint,
              at: entry.at,
            })),
          ),
          { mode: 0o600 },
        );
    });
    this.writes = persist.catch(() => {});
    reservation.result = persist.then(action);
    return reservation.result;
  }
}
