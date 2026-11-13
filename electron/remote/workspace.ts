import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PersistentPtyManager } from "../pty/persistent-client";
import { EVENTS } from "../ipc/channels";
import { writeFileAtomically } from "../fs/write";
import { RemoteRequestError } from "./errors";
import {
  TERMINAL_REFERENCE,
  type PersistentTerminalMetadata,
} from "../../src/lib/persistent-terminal";
import type {
  RemoteCreate,
  RemoteSession,
  RemoteScreen,
  RemoteTerminalFrame,
  RemoteTerminalRequest,
} from "../../src/lib/deck-remote";

interface Snapshot {
  sequence: number;
  screen: string;
  text: string;
  cols: number;
  rows: number;
  title: string;
  cwd: string | null;
}
interface SavedSession {
  id: string;
  reference: string;
  path: string;
  title: string;
  agentId: "codex" | "agy" | null;
  account: string | null;
  startedAt: number;
  exited: boolean;
}
interface Session {
  saved: SavedSession;
  paneId: number;
  chunks: { sequence: number; data: string }[];
  bytes: number;
  latest: number;
  resetAt: number;
  owner: string | null;
  lease?: ReturnType<typeof setTimeout>;
  snapshot: Snapshot | null;
  flight: Promise<unknown>;
}
const LABEL = "remote-workspace";
const MAX_SESSIONS = 128;
const emptySnapshot = (): Snapshot => ({
  sequence: 0,
  screen: "Session ended.\r\n",
  text: "Session ended.",
  cols: 80,
  rows: 24,
  title: "",
  cwd: null,
});

/** Owns only its dedicated daemon; desktop routes and session journals never enter here. */
export class RemoteWorkspace {
  private sessionsById = new Map<string, Session>();
  private byPane = new Map<number, Session>();
  private owners = new Set<number>();
  private prompts = new Set<number>();
  private pendingOutput = new Map<number, { event: string; payload: unknown }[]>();
  private pty: PersistentPtyManager;
  private ready: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private creations: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly directory: string;
  private readonly file: string;

  constructor(userData: string) {
    this.directory = path.join(userData, "remote-workspace");
    this.file = path.join(this.directory, "workspace.json");
    this.pty = new PersistentPtyManager(
      {
        register: (id) => this.owners.add(id),
        unregister: (id) => this.owners.delete(id),
        assertOwner: (id, label) => {
          if (label !== LABEL || !this.owners.has(id))
            throw new Error("Remote terminal ownership changed.");
        },
        emitToOwner: (id, event, payload) => this.event(id, event, payload),
      },
      this.directory,
    );
  }

  initialize(): Promise<void> {
    this.ready ??= this.restore();
    return this.ready;
  }
  private async restore() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    let saved: SavedSession[] = [];
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!Array.isArray(raw) || raw.length > MAX_SESSIONS)
        throw new Error("Invalid remote workspace.");
      saved = raw.map((row) => {
        if (
          !row ||
          typeof row.id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(row.id) ||
          typeof row.reference !== "string" ||
          !TERMINAL_REFERENCE.test(row.reference) ||
          typeof row.path !== "string" ||
          !path.isAbsolute(row.path) ||
          typeof row.title !== "string" ||
          row.title.length > 160 ||
          ![null, "codex", "agy"].includes(row.agentId) ||
          !(row.account === null || typeof row.account === "string") ||
          !Number.isFinite(row.startedAt) ||
          typeof row.exited !== "boolean"
        )
          throw new Error("Invalid remote workspace session.");
        return row as SavedSession;
      });
      if (
        new Set(saved.map((row) => row.id)).size !== saved.length ||
        new Set(saved.map((row) => row.reference)).size !== saved.length
      )
        throw new Error("Duplicate remote workspace identities.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Remote workspace could not be read. Repair remote-workspace/workspace.json before creating terminals.",
          { cause: error },
        );
    }
    const status = await this.pty.request<{
      epoch: string;
      remoteWorkspace?: boolean;
      remoteReferences: string[];
    }>("status");
    if (!status.remoteWorkspace)
      throw new Error("This remote terminal service needs a Deck update.");
    const recovery = await this.pty.request<Record<string, PersistentTerminalMetadata>>("recovery");
    // A GUI crash after spawn but before its registry write must not orphan that shell.
    for (const [reference, metadata] of Object.entries(recovery)) {
      if (
        !status.remoteReferences.includes(reference) ||
        !reference.startsWith(`${status.epoch}:`) ||
        !TERMINAL_REFERENCE.test(reference) ||
        saved.some((row) => row.reference === reference) ||
        saved.length >= MAX_SESSIONS
      )
        continue;
      saved.push({
        id: randomUUID(),
        reference,
        path: metadata.cwd ?? this.directory,
        title: "Recovered terminal",
        agentId: metadata.agent === "codex" || metadata.agent === "agy" ? metadata.agent : null,
        account: metadata.account ?? null,
        startedAt: Date.now(),
        exited: false,
      });
    }
    for (const row of saved) {
      // A broken GUI connection can mark a still-running PTY as exited locally.
      // The dedicated daemon's exact live references are authoritative on restart.
      row.exited = !status.remoteReferences.includes(row.reference);
      let paneId = Number(row.reference.split(":")[1]);
      if (!row.exited) {
        const attached = await this.pty.attach(LABEL, row.reference);
        if (!attached) row.exited = true;
        else paneId = attached.id;
      }
      const entry = this.install(row, paneId);
      if (!row.exited) {
        try {
          await this.pty.ownedRequest(LABEL, paneId, "ready");
          entry.snapshot = await this.snapshot(entry);
          entry.latest = Math.max(entry.latest, entry.snapshot.sequence);
        } catch (error) {
          if (!row.exited) throw error;
        }
      }
    }
    await this.save();
  }
  private install(saved: SavedSession, paneId: number): Session {
    const entry: Session = {
      saved,
      paneId,
      chunks: [],
      bytes: 0,
      latest: 0,
      resetAt: 0,
      owner: null,
      snapshot: null,
      flight: Promise.resolve(),
    };
    this.sessionsById.set(saved.id, entry);
    if (!saved.exited) {
      this.byPane.set(paneId, entry);
      for (const message of this.pendingOutput.get(paneId) ?? [])
        this.event(paneId, message.event, message.payload);
      this.pendingOutput.delete(paneId);
    }
    return entry;
  }
  private event(id: number, event: string, raw: unknown) {
    if (event === EVENTS.ptyPromptReady) {
      this.prompts.add(id);
      return;
    }
    const entry = this.byPane.get(id);
    if (!entry) {
      // spawn can publish a prompt before the caller has received its PTY id.
      const pending = this.pendingOutput.get(id) ?? [];
      if (pending.length < 64) pending.push({ event, payload: raw });
      this.pendingOutput.set(id, pending);
      return;
    }
    const payload = raw as {
      sequence?: number;
      data?: string;
      reset?: boolean;
      remoteScreen?: Snapshot;
    };
    if (
      event === EVENTS.ptyOutput &&
      typeof payload.data === "string" &&
      Number.isSafeInteger(payload.sequence)
    ) {
      const sequence = payload.sequence!;
      entry.latest = Math.max(entry.latest, sequence);
      if (payload.reset) entry.resetAt = sequence;
      entry.chunks.push({ sequence, data: payload.data });
      entry.bytes += payload.data.length;
      while (entry.bytes > 262_144 || entry.chunks.length > 4096)
        entry.bytes -= entry.chunks.shift()!.data.length;
    } else if (event === EVENTS.ptyExit) {
      entry.saved.exited = true;
      entry.snapshot = payload.remoteScreen ?? entry.snapshot;
      entry.owner = null;
      clearTimeout(entry.lease);
      this.byPane.delete(id);
      this.prompts.delete(id);
      void this.save().catch(console.warn);
    }
  }
  private save(): Promise<void> {
    const data = JSON.stringify([...this.sessionsById.values()].map((entry) => entry.saved));
    const result = this.writes.then(() => writeFileAtomically(this.file, data, { mode: 0o600 }));
    this.writes = result.catch(() => {});
    return result;
  }
  private model(entry: Session): RemoteSession {
    const saved = entry.saved;
    return {
      id: saved.id,
      generation: saved.reference,
      paneId: entry.paneId,
      tabKey: entry.paneId,
      title:
        saved.agentId && entry.snapshot?.title && !/^[^ ]+@[^ ]+:/.test(entry.snapshot.title)
          ? entry.snapshot.title.slice(0, 160)
          : saved.title,
      path: saved.path,
      agentId: saved.agentId,
      account: saved.account,
      startedAt: saved.startedAt,
      phase: saved.exited ? "exited" : "unknown",
      attention: "none",
    };
  }
  sessions(): RemoteSession[] {
    return [...this.sessionsById.values()].map((entry) => this.model(entry));
  }
  private target(id: string, generation?: string): Session {
    if (this.stopped) throw new RemoteRequestError(503, "Remote workspace is unavailable.");
    const entry = this.sessionsById.get(id);
    if (!entry) throw new RemoteRequestError(404, "This remote session no longer exists.");
    if (generation !== undefined && entry.saved.reference !== generation)
      throw new RemoteRequestError(412, "This remote session changed. Reopen it.");
    return entry;
  }
  private async snapshot(entry: Session): Promise<Snapshot> {
    if (entry.saved.exited) return entry.snapshot ?? emptySnapshot();
    try {
      const snapshot = (await this.pty.ownedRequest(
        LABEL,
        entry.paneId,
        "remoteSnapshot",
      )) as Snapshot;
      entry.snapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (entry.saved.exited) return entry.snapshot ?? emptySnapshot();
      throw error;
    }
  }
  private exclusive<T>(entry: Session, run: () => Promise<T>): Promise<T> {
    const result = entry.flight.then(run);
    entry.flight = result.catch(() => {});
    return result;
  }
  async create(request: RemoteCreate): Promise<RemoteSession> {
    await this.initialize();
    const run = async () => {
      if (this.stopped) throw new Error("Remote workspace is unavailable.");
      if (this.sessionsById.size >= MAX_SESSIONS)
        throw new Error("Close a remote session before opening another.");
      const options = { cols: 80, rows: 24, cwd: request.path, remote: true };
      const id = await this.pty.spawn(LABEL, options);
      const reference = this.pty.reference(id);
      if (!reference) throw new Error("The remote terminal identity is unavailable.");
      const saved: SavedSession = {
        id: randomUUID(),
        reference,
        path: request.path,
        title: `${request.agentId === "codex" ? "Codex" : request.agentId === "agy" ? "AGY" : "Terminal"} ${id}`,
        agentId: request.agentId,
        account: request.accountId,
        startedAt: Date.now(),
        exited: false,
      };
      const entry = this.install(saved, id);
      await this.save();
      if (request.agentId) {
        // Unix login shells need not emit OSC 133. Match the desktop launcher's
        // first-output readiness, while still accepting structured prompt events.
        const shellReady = () => this.prompts.has(id) || entry.bytes > 0;
        const deadline = Date.now() + 15_000;
        while (!shellReady() && !saved.exited && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 40));
        if (!shellReady() || saved.exited)
          throw new Error(
            "The remote shell is not ready. Its terminal was kept; inspect it before launching an agent.",
          );
        const command = request.accountId
          ? `cli ${request.accountId}`
          : request.agentId === "codex"
            ? "cli-codex"
            : "cli-agy";
        const prepared = await this.pty.ownedRequest(LABEL, id, "prepareLaunch", { command });
        if (typeof prepared !== "string") throw new Error("Agent launch could not be prepared.");
        await this.pty.write(LABEL, id, prepared + "\r");
      }
      return this.model(entry);
    };
    const result = this.creations.then(run);
    this.creations = result.catch(() => {});
    return result;
  }
  async terminal(id: string, request: RemoteTerminalRequest): Promise<RemoteTerminalFrame> {
    await this.initialize();
    const entry = this.target(id, request.generation);
    return this.exclusive(entry, async () => {
      this.target(id, request.generation);
      const renew = () => {
        clearTimeout(entry.lease);
        entry.lease = setTimeout(() => {
          entry.owner = null;
        }, 12_000);
      };
      if (request.action === "claim" && !entry.saved.exited) {
        if (entry.owner && entry.owner !== request.client)
          throw new RemoteRequestError(409, "This remote session is active in another browser.");
        if (
          !Number.isInteger(request.cols) ||
          !Number.isInteger(request.rows) ||
          request.cols! < 24 ||
          request.cols! > 500 ||
          request.rows! < 2 ||
          request.rows! > 200
        )
          throw new RemoteRequestError(400, "Invalid terminal dimensions.");
        const current = await this.snapshot(entry);
        if (current.cols !== request.cols || current.rows !== request.rows)
          await this.pty.resize(LABEL, entry.paneId, request.cols!, request.rows!);
        entry.owner = request.client;
        renew();
      } else if (request.action === "release") {
        if (entry.owner === request.client) {
          entry.owner = null;
          clearTimeout(entry.lease);
        }
      } else if (request.action === "write") {
        if (entry.saved.exited) throw new Error("This remote terminal has ended.");
        if (entry.owner !== request.client)
          throw new RemoteRequestError(409, "This remote session is active in another browser.");
        if (typeof request.data !== "string" || Buffer.byteLength(request.data) > 32768)
          throw new RemoteRequestError(400, "Input exceeds 32 KB.");
        await this.pty.write(LABEL, entry.paneId, request.data);
        renew();
      } else if (entry.owner === request.client) renew();
      const first = entry.chunks[0]?.sequence ?? entry.latest + 1;
      const cursor = request.cursor;
      const reset =
        cursor === undefined ||
        cursor < first - 1 ||
        cursor < entry.resetAt ||
        cursor > entry.latest;
      let snapshot = entry.snapshot;
      if (request.action === "read" && (reset || !snapshot)) snapshot = await this.snapshot(entry);
      return {
        alive: !entry.saved.exited,
        cursor: reset && snapshot ? snapshot.sequence : entry.latest,
        reset,
        cols: snapshot?.cols ?? 80,
        rows: snapshot?.rows ?? 24,
        controller: entry.owner,
        data:
          request.action !== "read"
            ? ""
            : reset
              ? (snapshot?.screen ?? "")
              : entry.chunks
                  .filter((chunk) => chunk.sequence > cursor!)
                  .map((chunk) => chunk.data)
                  .join(""),
      };
    });
  }
  async screen(id: string): Promise<RemoteScreen & { session: RemoteSession }> {
    await this.initialize();
    const entry = this.target(id);
    return this.exclusive(entry, async () => ({
      text: (await this.snapshot(entry)).text,
      alive: !entry.saved.exited,
      capturedAtMs: Date.now(),
      session: this.model(entry),
    }));
  }
  async input(id: string, text: string, generation: string) {
    await this.initialize();
    const entry = this.target(id, generation);
    return this.exclusive(entry, async () => {
      if (entry.saved.exited) throw new Error("This remote terminal has ended.");
      if (entry.owner) throw new Error("This session is active in a browser terminal.");
      await this.pty.write(LABEL, entry.paneId, `\x1b[200~${text}\x1b[201~\r`);
      return { status: "sent" };
    });
  }
  async closeSession(id: string, generation: string) {
    await this.initialize();
    const entry = this.target(id, generation);
    return this.exclusive(entry, async () => {
      if (!entry.saved.exited) await this.pty.kill(LABEL, entry.paneId);
      clearTimeout(entry.lease);
      this.byPane.delete(entry.paneId);
      this.prompts.delete(entry.paneId);
      this.sessionsById.delete(id);
      await this.save();
      return { status: "closed" };
    });
  }
  dispose() {
    this.stopped = true;
    for (const entry of this.sessionsById.values()) clearTimeout(entry.lease);
    this.pty.disconnect();
  }
}
