import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { readMessages, sendMessage, type WireMessage } from "./persistent-wire";
import type { PtyManagerDeps } from "./manager";
import type { SpawnOptions } from "./spawn";
import type { PtySessionSnapshot } from "./session-store";
import { EVENTS } from "../ipc/channels";
import { terminateDetachedTerminalProcesses, terminateProcessGroups } from "../platform/linux";
import { persistentLaunchCommand } from "./persistent-launch";
import { stopLinuxCodexForSwitch, type CodexHandoff } from "../platform/linux-codex-handoff";
import {
  TERMINAL_REFERENCE,
  type PersistentTerminalSnapshot,
} from "../../src/lib/persistent-terminal";

interface Spawned {
  id: number;
  reference: string;
  snapshot: PtySessionSnapshot;
  hookToken: string;
}

/** The GUI owns access routes; the detached service owns the actual PTYs. */
export class PersistentPtyManager {
  private socket: Socket | null = null;
  private connection: Promise<void> | null = null;
  private nextRequest = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private references = new Map<number, string>();
  private tokens = new Map<number, string>();
  private attached = new Set<number>();
  private stopped = false;

  constructor(
    private readonly deps: PtyManagerDeps,
    private readonly userData: string,
  ) {}

  private async openSocket(socketPath: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.removeListener("error", reject);
        resolve(socket);
      });
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.stopped) throw new Error("Terminal service connection is closed");
    if (this.socket && !this.socket.destroyed) return;
    if (!this.connection)
      this.connection = this.connectService().finally(() => {
        this.connection = null;
      });
    return this.connection;
  }

  private async connectService(): Promise<void> {
    const hash = createHash("sha256").update(this.userData).digest("hex").slice(0, 20);
    const directory = path.join(
      os.tmpdir(),
      `deck-terminals-${process.getuid?.() ?? "user"}-${hash}`,
    );
    await fs.mkdir(directory, { mode: 0o700, recursive: true });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      throw new Error("Terminal service directory must be private to this user");
    }
    const socketPath = path.join(directory, "service.sock");
    let socket: Socket;
    try {
      socket = await this.openSocket(socketPath);
    } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
      await fs.rm(socketPath, { force: true });
      await fs.mkdir(this.userData, { recursive: true });
      const log = await fs.open(path.join(this.userData, "terminal-service.log"), "a", 0o600);
      try {
        const child = spawn(
          process.execPath,
          [path.join(__dirname, "persistent-daemon.cjs"), socketPath, this.userData],
          {
            detached: true,
            stdio: ["ignore", log.fd, log.fd],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DECK_VERSION: app.getVersion() },
          },
        );
        child.on("error", (failure) => console.error("Terminal service launch failed", failure));
        child.unref();
      } finally {
        await log.close();
      }
      let connected: Socket | null = null;
      for (let attempt = 0; attempt < 100 && !connected; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        try {
          connected = await this.openSocket(socketPath);
        } catch {
          /* Wait for bind. */
        }
      }
      if (!connected) throw new Error("Terminal service did not start; see terminal-service.log");
      socket = connected;
    }
    this.socket = socket;
    socket.on("error", (error) => console.warn("Terminal service connection failed", error));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      // A new daemon starts its integer ids at one. Retire the old routes
      // before allowing a reconnect so they can never address another PTY.
      for (const id of this.attached) {
        this.deps.emitToOwner(id, EVENTS.ptyExit, { id, exitCode: null });
        this.deps.unregister(id);
      }
      this.attached.clear();
      this.references.clear();
      this.tokens.clear();
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Terminal service disconnected"));
      }
      this.pending.clear();
    });
    readMessages(socket, (message) => this.receive(message));
  }

  private receive(message: WireMessage): void {
    if (message.request !== undefined) {
      const request = this.pending.get(message.request);
      if (!request) return;
      this.pending.delete(message.request);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
      return;
    }
    if (message.paneId === undefined || !message.event || !this.attached.has(message.paneId))
      return;
    this.deps.emitToOwner(message.paneId, message.event, message.payload);
    if (message.event === EVENTS.ptyExit) {
      this.attached.delete(message.paneId);
      this.tokens.delete(message.paneId);
      this.references.delete(message.paneId);
      this.deps.unregister(message.paneId);
    }
  }

  async request<T = unknown>(method: string, args: unknown = {}): Promise<T> {
    await this.ensureConnected();
    const request = ++this.nextRequest;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        reject(new Error(`Terminal service timed out: ${method}`));
      }, 15000);
      this.pending.set(request, { resolve: (value) => resolve(value as T), reject, timer });
      sendMessage(this.socket!, { request, method, args });
    });
  }

  async spawn(label: string, options: SpawnOptions): Promise<number> {
    const result = await this.request<Spawned>("spawn", {
      ...options,
      hookScript: this.deps.hookScript?.(),
      codexHookScript: this.deps.codexHookScript?.(),
    });
    this.register(label, result);
    return result.id;
  }

  private register(label: string, result: Spawned): void {
    this.deps.register(result.id, label);
    this.references.set(result.id, result.reference);
    this.attached.add(result.id);
    this.tokens.set(result.id, result.hookToken);
  }

  async attach(label: string, reference: unknown): Promise<PersistentTerminalSnapshot | null> {
    if (typeof reference !== "string" || !TERMINAL_REFERENCE.test(reference))
      throw new Error("Invalid terminal reference");
    if ([...this.references.values()].includes(reference))
      throw new Error("Terminal is already open in Deck");
    const result = await this.request<(PersistentTerminalSnapshot & Spawned) | null>("attach", {
      reference,
    });
    if (!result) return null;
    if (this.attached.has(result.id)) throw new Error("Terminal is already open in Deck");
    this.register(label, result);
    return {
      id: result.id,
      reference: result.reference,
      cols: result.cols,
      rows: result.rows,
      screen: result.screen,
      metadata: result.metadata,
    };
  }

  async ownedRequest(
    label: string,
    id: number,
    method: string,
    args: object = {},
  ): Promise<unknown> {
    this.deps.assertOwner(id, label);
    // Preparing a handoff must not update recovery metadata before the old
    // conversation is stopped and the replacement has been verified.
    const handoff = method === "prepareAccountSwitch";
    const result = handoff
      ? (args as { command?: unknown }).command
      : await this.request(method, { ...args, id });
    if (handoff && (typeof result !== "string" || result.length > 8192))
      throw new Error("Invalid terminal command");
    if ((!handoff && method !== "prepareLaunch") || typeof result !== "string") return result;
    this.deps.assertOwner(id, label);
    const reference = this.reference(id);
    if (!reference || !TERMINAL_REFERENCE.test(reference))
      throw new Error("Terminal identity is unavailable for agent launch");
    const directory = path.join(
      this.userData,
      "terminal-runtime",
      reference.split(":")[0],
      String(id),
    );
    const command = persistentLaunchCommand(result, directory);
    if (command !== result) {
      // The detached service may predate resume isolation. Apply it in GUI main
      // as well, without restarting the service or touching its live terminals.
      await fs.mkdir(path.join(directory, "codex-log"), { recursive: true, mode: 0o700 });
      this.deps.assertOwner(id, label);
    }
    return command;
  }
  write(label: string, id: number, data: string) {
    return this.ownedRequest(label, id, "write", { data });
  }
  resize(label: string, id: number, cols: number, rows: number) {
    return this.ownedRequest(label, id, "resize", { cols, rows });
  }
  kill(label: string, id: number) {
    return this.attached.has(id) ? this.ownedRequest(label, id, "kill") : Promise.resolve();
  }
  async killForeground(label: string, id: number, expected?: CodexHandoff) {
    this.deps.assertOwner(id, label);
    const snapshot = (await this.snapshots([id])).find((row) => row.id === id);
    this.deps.assertOwner(id, label);
    if (expected) {
      if (!snapshot) throw new Error("The terminal is no longer available.");
      return stopLinuxCodexForSwitch(
        snapshot,
        expected,
        async (group) => terminateProcessGroups(group, null),
        () => this.deps.assertOwner(id, label),
      );
    }
    // Older terminal services stop only the foreground group; AGY creates its own session.
    if (snapshot) await terminateDetachedTerminalProcesses(snapshot.pid, snapshot.ttyName);
    return this.ownedRequest(label, id, "stop");
  }
  terminate(id: number): void {
    if (this.attached.has(id)) void this.request("kill", { id }).catch(console.warn);
  }
  async killAll(): Promise<void> {
    await Promise.all([...this.attached].map((id) => this.request("kill", { id })));
  }
  snapshots(ids: readonly number[]): Promise<PtySessionSnapshot[]> {
    return this.request("snapshots", { ids });
  }
  liveIds(): number[] {
    return [...this.attached];
  }
  hookTokenOf(id: number): string | null {
    return this.tokens.get(id) ?? null;
  }
  /** Closing the GUI releases subscriptions, never the PTYs. */
  reference(id: number): string | null {
    return this.references.get(id) ?? null;
  }
  async detach(id: number): Promise<void> {
    if (!this.attached.has(id)) return;
    await this.request("detach", { id });
    this.attached.delete(id);
    this.tokens.delete(id);
    this.references.delete(id);
    this.deps.unregister(id);
  }
  disconnect(): void {
    this.stopped = true;
    this.attached.clear();
    this.references.clear();
    this.tokens.clear();
    this.socket?.destroy();
  }
}
