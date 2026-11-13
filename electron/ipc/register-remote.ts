import { RemoteWorkspace } from "../remote/workspace";
import { RemoteTerminalActions } from "../remote/terminal-actions";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { CHANNELS, EVENTS } from "./channels";
import { RemoteBroker } from "../remote/broker";
import { RemoteActions } from "../remote/actions";
import { createRemoteServer } from "../remote/server";
import { remoteFolder } from "../remote/folders";
import { createCliManagerQuotaService } from "../usage/cli-manager-quota";
import { writeFileAtomically } from "../fs/write";
import type { RemoteAccessStatus, RemotePane } from "../../src/lib/deck-remote";

interface Configuration {
  enabled: boolean;
  port: number;
  root: string;
  token: string;
}

function validatePanes(raw: unknown): RemotePane[] {
  if (!Array.isArray(raw) || raw.length > 512) throw new Error("Invalid remote session list.");
  return raw.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid remote session.");
    const row = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.paneId) ||
      Number(row.paneId) <= 0 ||
      !Number.isSafeInteger(row.tabKey) ||
      typeof row.startedAt !== "number" ||
      !Number.isFinite(row.startedAt)
    )
      throw new Error("Invalid remote session identity.");
    const text = (key: string, nullable = false): string | null => {
      const field = row[key];
      if (nullable && field === null) return null;
      if (typeof field !== "string" || field.length > 4096)
        throw new Error("Invalid remote session metadata.");
      return field;
    };
    return {
      paneId: Number(row.paneId),
      tabKey: Number(row.tabKey),
      startedAt: row.startedAt,
      title: text("title")!,
      path: text("path", true),
      agentId: text("agentId", true),
      account: text("account", true),
      phase: text("phase")!,
      attention: text("attention")!,
    };
  });
}

export function registerRemoteAccess(deps: {
  userData: string;
  home: string;
  labelOf: (event: IpcMainInvokeEvent) => string;
  assertOwner: (paneId: number, label: string) => void;
  preferredWindow: () => string | undefined;
  emit: (label: string, event: string, payload: unknown) => boolean;
}) {
  const file = path.join(deps.userData, "remote-access.json");
  const quota = createCliManagerQuotaService();
  const workspace = process.platform === "linux" ? new RemoteWorkspace(deps.userData) : null;
  const actions = new RemoteActions(path.join(deps.userData, "remote-actions.json"));
  const terminalActions = new RemoteTerminalActions(
    path.join(deps.userData, "remote-terminal-actions.json"),
  );
  const broker = new RemoteBroker({
    ...deps,
    emit: (label, request) => deps.emit(label, EVENTS.remoteRequest, request),
  });
  let config: Configuration = {
    enabled: false,
    port: 43189,
    root: deps.home,
    token: randomBytes(32).toString("hex"),
  };
  let server: ReturnType<typeof createRemoteServer> | null = null;
  let error: string | null = null;
  let locked = false;
  let disposed = false;

  function status(): RemoteAccessStatus {
    const hosts = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry?.family === "IPv4" && !entry.internal)
      .map((entry) => entry!.address)
      .sort((a, b) => Number(b.startsWith("100.")) - Number(a.startsWith("100.")));
    return {
      enabled: server !== null,
      port: config.port,
      root: config.root,
      addresses: server
        ? [...new Set([...hosts, "127.0.0.1"])].map((host) => `http://${host}:${config.port}`)
        : [],
      error,
    };
  }

  async function start(): Promise<void> {
    if (!config.enabled || disposed) return;
    await remoteFolder(config.root, config.root);
    if (disposed) return;
    await workspace?.initialize();
    if (disposed) return;
    const candidate = createRemoteServer({
      token: config.token,
      root: config.root,
      actions,
      terminalActions,
      backend: {
        mode: workspace ? "independent" : "desktop",
        sessions: () => (workspace ? workspace.sessions() : broker.sessions()),
        terminal: (id, request) =>
          workspace ? workspace.terminal(id, request) : broker.terminal(id, request),
        screen: (id) => (workspace ? workspace.screen(id) : broker.forSession(id, "screen")),
        input: (id, text, generation) =>
          workspace
            ? workspace.input(id, text, generation)
            : broker.forSession(id, "input", text, generation),
        create: (request) => (workspace ? workspace.create(request) : broker.create(request)),
        ...(workspace
          ? {
              closeSession: (id: string, generation: string) =>
                workspace.closeSession(id, generation),
            }
          : {}),
        quota: () => quota.snapshot(),
      },
    });
    try {
      await candidate.listen(config.port);
      if (disposed) candidate.close();
      else server = candidate;
    } catch (cause) {
      candidate.close();
      throw cause;
    }
  }

  const ready = (async () => {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as Configuration;
      if (
        typeof raw.enabled !== "boolean" ||
        !Number.isSafeInteger(raw.port) ||
        raw.port < 1024 ||
        raw.port > 65535 ||
        typeof raw.root !== "string" ||
        !path.isAbsolute(raw.root) ||
        !/^[a-f0-9]{64}$/.test(raw.token)
      )
        throw new Error("Invalid remote configuration.");
      config = raw;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        locked = true;
        error =
          "Remote access settings could not be read. Repair remote-access.json before enabling access.";
      }
    }
    if (!locked) {
      try {
        await start();
      } catch {
        error = "Remote access could not start. Check the port and shared folder.";
      }
    }
  })();
  let changes: Promise<unknown> = ready;

  ipcMain.handle(CHANNELS.remoteAccess, (event, payload: Record<string, unknown>) => {
    deps.labelOf(event);
    const action = async () => {
      await ready;
      if (payload.action === "status") return status();
      if (locked || disposed) throw new Error(error ?? "Remote access is unavailable.");
      if (payload.action === "pair" || payload.action === "pair_web") {
        if (typeof payload.address !== "string" || !status().addresses.includes(payload.address))
          throw new Error("Choose a running Deck address.");
        if (payload.action === "pair_web") return `${payload.address}/#token=${config.token}`;
        const query = new URLSearchParams({
          server: payload.address,
          token: config.token,
          name: os.hostname(),
        });
        return `deckremote://connect?${query}`;
      }
      if (payload.action !== "configure" && payload.action !== "rotate")
        throw new Error("Unknown remote access action.");
      const next = { ...config };
      if (payload.action === "rotate") next.token = randomBytes(32).toString("hex");
      else {
        if (
          typeof payload.enabled !== "boolean" ||
          !Number.isSafeInteger(payload.port) ||
          Number(payload.port) < 1024 ||
          Number(payload.port) > 65535 ||
          typeof payload.root !== "string" ||
          !path.isAbsolute(payload.root)
        )
          throw new Error("Choose a port from 1024 to 65535 and an absolute shared folder.");
        next.enabled = payload.enabled;
        next.port = Number(payload.port);
        next.root = next.enabled ? await remoteFolder(payload.root, payload.root) : payload.root;
      }
      await writeFileAtomically(file, JSON.stringify(next, null, 2), { mode: 0o600 });
      server?.close();
      server = null;
      config = next;
      error = null;
      try {
        await start();
      } catch {
        error = "Remote access could not start. Check the port and shared folder.";
      }
      return status();
    };
    const result = changes.then(action);
    changes = result.catch(() => {});
    return result;
  });
  ipcMain.handle(CHANNELS.remotePublish, (event, { panes }: { panes: unknown }) => {
    broker.publish(deps.labelOf(event), validatePanes(panes));
  });
  ipcMain.handle(
    CHANNELS.remoteReply,
    (
      event,
      {
        requestId,
        result,
        error: replyError,
      }: { requestId: unknown; result: unknown; error?: unknown },
    ) => {
      if (
        typeof requestId !== "string" ||
        (replyError !== undefined && typeof replyError !== "string")
      )
        throw new Error("Invalid remote reply.");
      broker.finish(deps.labelOf(event), requestId, result, replyError as string | undefined);
    },
  );
  const dispose = () => {
    disposed = true;
    server?.close();
    server = null;
    broker.close();
    workspace?.dispose();
    quota.close();
  };
  app.once("will-quit", dispose);
  return { forgetWindow: (label: string) => broker.forgetWindow(label), dispose };
}
