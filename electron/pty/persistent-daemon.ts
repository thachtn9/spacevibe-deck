import { persistentLaunchCommand } from "./persistent-launch";
import { terminateDetachedTerminalProcesses } from "../platform/linux";
import { linuxCodexSession } from "../platform/linux-codex-session";
/** Detached Linux PTY owner. No BrowserWindow or app lifecycle lives in this process. */
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { PtyManager } from "./manager";
import { validateSpawnOptions, validateResizeOptions } from "./spawn";
import { createHookServer } from "../agent-hooks/hook-server";
import { ptyInfo } from "./info";
import { EVENTS } from "../ipc/channels";
import { terminalMouseEncodingSequence } from "../../src/lib/terminal-mouse-state";
import { readMessages, sendMessage, type WireMessage } from "./persistent-wire";
import {
  accountFromCommand,
  type PersistentTerminalMetadata,
} from "../../src/lib/persistent-terminal";

interface Screen {
  terminal: Terminal;
  serialize: SerializeAddon;
  title: string;
  pendingBytes: number;
  agentPid: number | null;
  owner: Socket | null;
  paused: boolean;
  queue: WireMessage[];
  metadata: PersistentTerminalMetadata;
  remote: boolean;
  sequence: number;
}

const socketPath = process.argv[2];
const dataDirectory = process.argv[3];
if (!socketPath || !dataDirectory) throw new Error("Missing persistent terminal paths");
process.title = "deck-terminal-service";
const epoch = randomUUID();
const screens = new Map<number, Screen>();
const clients = new Set<Socket>();
const metadataPath = path.join(dataDirectory, "terminal-recovery.json");
let saved: Record<string, PersistentTerminalMetadata> = {};
let saving = Promise.resolve();
let saveTimer: NodeJS.Timeout | null = null;
let hookScript: string | null = null;
let codexHookScript: string | null = null;

function saveRecovery(): Promise<void> {
  for (const [id, screen] of screens) saved[`${epoch}:${id}`] = screen.metadata;
  // Retain recent reboot identities without allowing an unbounded history.
  const entries = Object.entries(saved);
  if (entries.length > 4096) saved = Object.fromEntries(entries.slice(-4096));
  const data = JSON.stringify(saved);
  saving = saving
    .then(async () => {
      const temporary = `${metadataPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, data, { mode: 0o600 });
      await fs.rename(temporary, metadataPath);
    })
    .catch((error) => console.error("Could not persist terminal recovery", error));
  return saving;
}
function persist(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveRecovery();
  }, 250);
}

function forward(id: number, event: string, payload: unknown): void {
  const screen = screens.get(id);
  if (!screen?.owner) return;
  const message = { paneId: id, event, payload };
  if (screen.paused) {
    screen.queue.push(message);
    if (screen.queue.length > 4096) screen.owner.destroy();
  } else sendMessage(screen.owner, message);
}

const hooks = createHookServer({
  tokenFor: (id) => manager.hookTokenOf(id),
  emitToOwner: (id, event) => {
    const screen = screens.get(id);
    if (screen) {
      screen.metadata = { ...screen.metadata, agent: event.agent, sessionId: event.sessionId };
      persist();
    }
    forward(id, EVENTS.hookEvent, event);
  },
});

const manager = new PtyManager({
  register: () => {},
  unregister: () => {},
  assertOwner: () => {},
  hookPort: () => hooks.port(),
  hookScript: () => hookScript,
  codexHookScript: () => codexHookScript,
  emitToOwner(id, event, payload) {
    const screen = screens.get(id);
    if (event === EVENTS.ptyOutput && screen) {
      const data = (payload as { data: string }).data;
      screen.pendingBytes += data.length;
      if (screen.pendingBytes > 1024 * 1024) manager.setOutputPaused(id, true);
      screen.terminal.write(data, () => {
        screen.pendingBytes -= data.length;
        if (screen.pendingBytes < 256 * 1024) manager.setOutputPaused(id, false);
        screen.sequence++;
        forward(
          id,
          event,
          screen.remote ? { ...(payload as object), sequence: screen.sequence } : payload,
        );
      });
    }
    if (event === EVENTS.ptyExit && screen) {
      screen.terminal.write("", () => {
        let remoteScreen;
        if (screen.remote) {
          try {
            remoteScreen = captureRemoteScreen(screen);
          } catch (error) {
            console.warn("Remote exit snapshot unavailable", error);
          }
        }
        forward(id, event, screen.remote ? { ...(payload as object), remoteScreen } : payload);
        screens.delete(id);
        screen.terminal.dispose();
        hooks.forgetPane(id);
      });
    } else if (event !== EVENTS.ptyOutput) forward(id, event, payload);
  },
});

/** Sequence and screen are captured at the same parser barrier. */
function captureRemoteScreen(screen: Screen) {
  let serialized = screen.serialize.serialize({ scrollback: 1000 });
  if (Buffer.byteLength(serialized) > 1_000_000)
    serialized = screen.serialize.serialize({ scrollback: 0 });
  if (Buffer.byteLength(serialized) > 1_000_000)
    throw new Error("The terminal screen is too large. Use a smaller terminal window.");
  const buffer = screen.terminal.buffer.active;
  const lines: string[] = [];
  for (let row = Math.max(0, buffer.length - 1000); row < buffer.length; row++)
    lines.push(buffer.getLine(row)?.translateToString(true).normalize("NFC") ?? "");
  return {
    sequence: screen.sequence,
    cols: screen.terminal.cols,
    rows: screen.terminal.rows,
    screen: serialized + terminalMouseEncodingSequence(screen.terminal),
    text: lines.join("\n").slice(-262144),
    title: screen.title,
    cwd: screen.metadata.cwd,
  };
}

function validateScreenSize(size: { cols: number; rows: number }): void {
  if (size.cols > 1000 || size.rows > 500)
    throw new Error("Terminal geometry exceeds the persistent screen limit");
}
function requireScreen(client: Socket, id: number): Screen {
  const screen = screens.get(id);
  if (!screen || screen.owner !== client)
    throw new Error("Terminal is not attached to this client");
  return screen;
}

async function request(client: Socket, method: string, raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid terminal request");
  const args = raw as Record<string, unknown>;
  const id = Number(args.id);
  switch (method) {
    case "status":
      return {
        epoch,
        pid: process.pid,
        version: 1,
        hookPort: hooks.port(),
        remoteWorkspace: true,
        remoteReferences: [...screens]
          .filter(([, screen]) => screen.remote)
          .map(([id]) => `${epoch}:${id}`),
      };
    case "spawn": {
      const options = validateSpawnOptions(args);
      validateScreenSize(options);
      hookScript = typeof args.hookScript === "string" ? args.hookScript : null;
      codexHookScript = typeof args.codexHookScript === "string" ? args.codexHookScript : null;
      const newId = manager.spawn("service", options);
      const terminal = new Terminal({
        cols: options.cols,
        rows: options.rows,
        scrollback: 2000,
        allowProposedApi: true,
      });
      const serialize = new SerializeAddon();
      terminal.loadAddon(serialize);
      terminal.loadAddon(new UnicodeGraphemesAddon());
      terminal.unicode.activeVersion = "15-graphemes";
      const screen: Screen = {
        terminal,
        serialize,
        title: "",
        pendingBytes: 0,
        agentPid: null,
        owner: client,
        paused: false,
        queue: [],
        metadata: { agent: null, sessionId: null, launchCommand: null, cwd: options.cwd },
        remote: args.remote === true,
        sequence: 0,
      };
      terminal.onTitleChange((title) => {
        screen.title = title;
      });
      // A detached CLI can still ask cursor/device questions while nobody displays it.
      terminal.onData((data) => {
        if (!screen.owner || screen.remote) manager.write("service", newId, data);
      });
      screens.set(newId, screen);
      persist();
      return {
        id: newId,
        reference: `${epoch}:${newId}`,
        snapshot: manager.snapshots([newId])[0],
        hookToken: manager.hookTokenOf(newId),
      };
    }
    case "attach": {
      if (typeof args.reference !== "string" || !args.reference.startsWith(`${epoch}:`))
        return null;
      const attachId = Number(args.reference.slice(epoch.length + 1));
      const screen = screens.get(attachId);
      if (!screen) return null;
      if (screen.owner && screen.owner !== client && !screen.owner.destroyed)
        throw new Error("Terminal is already attached");
      screen.owner = client;
      screen.paused = true;
      const serialized = await new Promise<string>((resolve) =>
        screen.terminal.write("", () => {
          screen.queue = [];
          resolve(screen.serialize.serialize() + terminalMouseEncodingSequence(screen.terminal));
        }),
      );
      if (screens.get(attachId) !== screen) return null;
      // The snapshot contains everything already parsed. Only later output is queued for ready.
      return {
        id: attachId,
        reference: args.reference,
        cols: screen.terminal.cols,
        rows: screen.terminal.rows,
        screen: serialized + (screen.title ? `\x1b]0;${screen.title}\x07` : ""),
        metadata: screen.metadata,
        snapshot: manager.snapshots([attachId])[0],
        hookToken: manager.hookTokenOf(attachId),
      };
    }
    case "remoteSnapshot": {
      const screen = requireScreen(client, id);
      if (!screen.remote) throw new Error("This terminal is not a remote workspace session");
      await new Promise<void>((resolve) => screen.terminal.write("", resolve));
      return captureRemoteScreen(screen);
    }
    case "detach": {
      const screen = requireScreen(client, id);
      screen.owner = null;
      screen.paused = false;
      screen.queue = [];
      persist();
      return null;
    }
    case "ready": {
      const screen = requireScreen(client, id);
      screen.paused = false;
      for (const message of screen.queue) sendMessage(client, message);
      screen.queue = [];
      return null;
    }
    case "prepareLaunch": {
      const screen = requireScreen(client, id);
      if (typeof args.command !== "string" || args.command.length > 8192)
        throw new Error("Invalid terminal command");
      screen.metadata = {
        ...screen.metadata,
        launchCommand: args.command,
        account: accountFromCommand(args.command) ?? screen.metadata.account,
      };
      const resume = /^cli resume ([A-Za-z0-9._-]{1,128}) --acc ([A-Za-z0-9_-]+)$/.exec(
        args.command,
      );
      if (resume)
        screen.metadata = {
          ...screen.metadata,
          sessionId: resume[1],
          agent: resume[2].startsWith("codex") ? "codex" : "agy",
        };
      persist();
      return persistentLaunchCommand(
        args.command,
        path.join(dataDirectory, "terminal-runtime", epoch, String(id)),
      );
    }
    case "write":
      requireScreen(client, id);
      if (typeof args.data !== "string") throw new Error("Invalid terminal input");
      manager.write("service", id, args.data);
      return null;
    case "resize": {
      const dimensions = validateResizeOptions(args);
      validateScreenSize(dimensions);
      const screen = requireScreen(client, id);
      await new Promise<void>((resolve) => screen.terminal.write("", resolve));
      screen.terminal.resize(dimensions.cols, dimensions.rows);
      manager.resize("service", id, dimensions.cols, dimensions.rows);
      if (screen.remote) {
        screen.sequence++;
        forward(id, EVENTS.ptyOutput, { id, data: "", sequence: screen.sequence, reset: true });
      }
      return null;
    }
    case "kill": {
      const screen = requireScreen(client, id);
      const snapshot = manager.snapshots([id])[0];
      if (snapshot) await terminateDetachedTerminalProcesses(snapshot.pid, snapshot.ttyName);
      manager.kill("service", id);
      forward(id, EVENTS.ptyExit, { id, exitCode: null });
      screens.delete(id);
      screen.terminal.dispose();
      delete saved[`${epoch}:${id}`];
      persist();
      return null;
    }
    case "stop":
      requireScreen(client, id);
      await manager.killForeground("service", id);
      return null;
    case "snapshots":
      if (!Array.isArray(args.ids) || !args.ids.every((id) => Number.isSafeInteger(id) && id > 0))
        throw new Error("Invalid terminal ids");
      return manager.snapshots(args.ids);
    case "metadata": {
      const screen = requireScreen(client, id);
      const value = args.metadata as PersistentTerminalMetadata;
      if (
        !value ||
        typeof value !== "object" ||
        ![
          value.agent,
          value.cwd,
          value.launchCommand,
          value.sessionId,
          value.account ?? null,
        ].every((field) => field === null || (typeof field === "string" && field.length <= 8192))
      )
        throw new Error("Invalid terminal metadata");
      screen.metadata = {
        ...screen.metadata,
        cwd: value.cwd ?? screen.metadata.cwd,
        launchCommand: value.launchCommand ?? screen.metadata.launchCommand,
        agent: value.agent ?? screen.metadata.agent,
        sessionId: value.sessionId ?? screen.metadata.sessionId,
        account:
          value.account ??
          accountFromCommand(value.launchCommand) ??
          screen.metadata.account ??
          null,
      };
      persist();
      return null;
    }
    case "recovery":
      return {
        ...saved,
        ...Object.fromEntries(
          [...screens].map(([id, screen]) => [`${epoch}:${id}`, screen.metadata]),
        ),
      };
    default:
      throw new Error("Unknown terminal service method");
  }
}

async function main(): Promise<void> {
  try {
    saved = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    if (saveTimer) clearTimeout(saveTimer);
    await saveRecovery();
    for (const snapshot of manager.snapshots(manager.liveIds())) {
      await terminateDetachedTerminalProcesses(snapshot.pid, snapshot.ttyName);
    }
    await manager.killAll();
    process.exit(0);
  }
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
  await hooks.listen();
  const server = createServer((client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => {
      clients.delete(client);
      for (const screen of screens.values())
        if (screen.owner === client) {
          screen.owner = null;
          screen.paused = false;
          screen.queue = [];
        }
    });
    // Preserve request order across asynchronous snapshot/resize barriers.
    let chain = Promise.resolve();
    readMessages(client, (message) => {
      chain = chain.then(async () => {
        try {
          sendMessage(client, {
            request: message.request,
            result: await request(client, message.method ?? "", message.args),
          });
        } catch (error) {
          sendMessage(client, {
            request: message.request,
            error: error instanceof Error ? error.message : "Terminal request failed",
          });
        }
      });
    });
  });
  server.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  server.listen(socketPath, () => {
    void fs.chmod(socketPath, 0o600);
  });
  let polling = false;
  setInterval(() => {
    if (polling || screens.size === 0) return;
    polling = true;
    void ptyInfo(manager.snapshots(manager.liveIds()), [], true)
      .then(async (infos) => {
        for (const info of infos) {
          const screen = screens.get(info.id);
          if (!screen) continue;
          let account = screen.metadata.account ?? null;
          if (info.processId && (info.agent === "codex" || info.agent === "agy")) {
            try {
              const env = await fs.readFile(`/proc/${info.processId}/environ`, "utf8");
              const home = env
                .split("\0")
                .find((entry) => entry.startsWith(info.agent === "codex" ? "CODEX_HOME=" : "HOME="))
                ?.split("=")
                .slice(1)
                .join("=");
              const match = home && /\/profiles(?:_codex)?\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(home);
              if (match) account = match[1];
            } catch {
              /* The foreground process may exit during this sample. */
            }
          }
          const codexSession =
            info.agent === "codex" && info.processId
              ? await linuxCodexSession(info.processId)
              : null;
          const sameProcess = screen.agentPid === info.processId;
          screen.agentPid = info.processId;
          const next = {
            ...screen.metadata,
            cwd: info.cwd ?? screen.metadata.cwd,
            account,
            agent: info.agent,
            sessionId:
              codexSession ??
              info.codexSessionId ??
              info.agySessionId ??
              (sameProcess && info.agent === screen.metadata.agent
                ? screen.metadata.sessionId
                : null),
          };
          const log = path.join(
            dataDirectory,
            "terminal-runtime",
            epoch,
            String(info.id),
            "codex-log",
            "codex-tui.log",
          );
          try {
            if ((await fs.stat(log)).size > 2 * 1024 * 1024) await fs.truncate(log, 0);
          } catch {
            /* This pane may not run Codex. */
          }
          if (JSON.stringify(next) !== JSON.stringify(screen.metadata)) {
            screen.metadata = next;
            persist();
          }
        }
      })
      .catch((error) => console.warn("Terminal metadata refresh failed", error))
      .finally(() => {
        polling = false;
      });
  }, 2000).unref();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
