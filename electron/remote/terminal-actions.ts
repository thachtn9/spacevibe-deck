import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeFileAtomically } from "../fs/write";
import { RemoteRequestError } from "./errors";

interface Reservation {
  id: string;
  sequence: number;
  at: number;
}
const LIFETIME = 24 * 60 * 60_000;

/** One durable high-water mark per keyboard connection, not one entry per keystroke. */
export class RemoteTerminalActions {
  private entries = new Map<string, Reservation>();
  private flight: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  constructor(private file?: string) {
    this.ready = (async () => {
      if (!file) return;
      try {
        const data = JSON.parse(await fs.readFile(file, "utf8"));
        if (!Array.isArray(data) || data.length > 4096) throw new Error("Invalid terminal ledger.");
        for (const row of data) {
          if (
            !/^[a-f0-9]{64}$/.test(row.id) ||
            !Number.isSafeInteger(row.sequence) ||
            row.sequence < 1 ||
            !Number.isFinite(row.at)
          )
            throw new Error("Invalid terminal ledger.");
          this.entries.set(row.id, row);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    })();
    void this.ready.catch(() => {});
  }
  run<T>(token: string, client: unknown, sequence: unknown, action: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.ready;
      if (
        typeof client !== "string" ||
        !/^\d{13}-[a-f0-9]{32}$/.test(client) ||
        !Number.isSafeInteger(sequence) ||
        Number(sequence) < 1
      )
        throw new RemoteRequestError(400, "Reconnect the terminal before typing.");
      const at = Number(client.slice(0, 13));
      if (Date.now() - at > LIFETIME || at - Date.now() > 300_000)
        throw new RemoteRequestError(409, "This terminal connection expired. Reopen the session.");
      for (const [id, row] of this.entries)
        if (Date.now() - row.at > LIFETIME + 300_000) this.entries.delete(id);
      const id = createHash("sha256").update(`${token}:${client}`).digest("hex");
      const last = this.entries.get(id)?.sequence ?? 0;
      if (sequence !== last + 1)
        throw new RemoteRequestError(
          409,
          "Input was already reserved or arrived out of order. Reconnect and review the terminal; it will not replay.",
        );
      if (!last && this.entries.size >= 4096)
        throw new RemoteRequestError(429, "Too many terminal connections.");
      this.entries.set(id, { id, sequence: Number(sequence), at });
      if (this.file)
        await writeFileAtomically(this.file, JSON.stringify([...this.entries.values()]), {
          mode: 0o600,
        });
      return action();
    };
    const result = this.flight.then(run);
    this.flight = result.catch(() => {});
    return result;
  }
}
