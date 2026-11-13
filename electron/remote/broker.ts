import { randomUUID } from "node:crypto";
import { RemoteRequestError } from "./errors";
import {
  remotePaneIdentity,
  type RemotePane,
  type RemoteTerminalRequest,
  type RemoteOperation,
  type RemoteRpcRequest,
  type RemoteSession,
} from "../../src/lib/deck-remote";

interface Entry {
  readonly label: string;
  readonly session: RemoteSession;
}

export class RemoteBroker {
  private readonly windows = new Map<string, readonly Entry[]>();
  private readonly pending = new Map<
    string,
    {
      label: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly deps: {
      assertOwner: (paneId: number, label: string) => void;
      emit: (label: string, request: RemoteRpcRequest) => boolean;
      preferredWindow: () => string | undefined;
    },
  ) {}

  publish(label: string, panes: readonly RemotePane[]): void {
    const previous = new Map(
      (this.windows.get(label) ?? []).map((entry) => [
        `${entry.session.tabKey}:${entry.session.paneId}`,
        entry,
      ]),
    );
    const seen = new Set<number>();
    this.windows.set(
      label,
      panes
        .filter((pane) => {
          if (seen.has(pane.paneId)) return false;
          seen.add(pane.paneId);
          try {
            this.deps.assertOwner(pane.paneId, label);
            return true;
          } catch {
            return false;
          }
        })
        .map((pane) => ({
          label,
          session: {
            ...pane,
            generation: remotePaneIdentity(pane),
            id: previous.get(`${pane.tabKey}:${pane.paneId}`)?.session.id ?? randomUUID(),
          },
        })),
    );
  }

  sessions(): RemoteSession[] {
    return [...this.windows.values()]
      .flat()
      .filter((entry) => this.owned(entry))
      .map((entry) => entry.session);
  }

  private owned(entry: Entry): boolean {
    try {
      this.deps.assertOwner(entry.session.paneId, entry.label);
      return true;
    } catch {
      return false;
    }
  }

  private target(id: string): Entry {
    const entry = [...this.windows.values()].flat().find((row) => row.session.id === id);
    if (!entry || !this.owned(entry))
      throw new RemoteRequestError(404, "This session is no longer available. Refresh Sessions.");
    return entry;
  }

  async forSession(
    id: string,
    action: "screen" | "input",
    text = "",
    generation?: string,
  ): Promise<unknown> {
    const entry = this.target(id);
    if (action === "input" && generation !== entry.session.generation)
      throw new RemoteRequestError(412, "This session changed. Refresh its screen before sending.");
    const operation: RemoteOperation =
      action === "screen"
        ? { kind: "screen", pane: entry.session }
        : { kind: "input", pane: entry.session, text };
    const result = await this.call(entry.label, operation);
    // A window move/reload cannot make a reply describe a different session.
    const current = this.target(id);
    if (action === "screen" && current.session.generation !== entry.session.generation)
      throw new RemoteRequestError(412, "This session changed. Refresh its screen.");
    return action === "screen" ? { ...(result as object), session: current.session } : result;
  }

  async terminal(id: string, request: RemoteTerminalRequest): Promise<unknown> {
    const entry = this.target(id);
    if (request.generation !== entry.session.generation)
      throw new RemoteRequestError(412, "This session changed. Reopen the terminal.");
    const result = await this.call(entry.label, { kind: "terminal", pane: entry.session, request });
    if (this.target(id).session.generation !== entry.session.generation)
      throw new RemoteRequestError(412, "This session changed. Reopen the terminal.");
    return result;
  }

  async create(
    request: Extract<RemoteOperation, { kind: "create" }>["request"],
  ): Promise<RemoteSession> {
    const preferred = this.deps.preferredWindow();
    const label =
      preferred && this.windows.has(preferred) ? preferred : this.windows.keys().next().value;
    if (!label) throw new Error("Open a Deck window on your computer first.");
    const result = await this.call(label, { kind: "create", request });
    const paneId = (result as { paneId?: unknown } | null)?.paneId;
    const entry = this.windows.get(label)?.find((row) => row.session.paneId === paneId);
    if (!entry || !this.owned(entry))
      throw new Error(
        "The new session could not be confirmed. Refresh Sessions before trying again.",
      );
    return entry.session;
  }

  private call(label: string, operation: RemoteOperation): Promise<unknown> {
    if (this.pending.size >= 32)
      return Promise.reject(new Error("Deck is busy. Try again shortly."));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error("Deck did not answer. Check the session on your computer before retrying."),
        );
      }, 25_000);
      timer.unref?.();
      this.pending.set(requestId, { label, resolve, reject, timer });
      if (!this.deps.emit(label, { requestId, deadline: Date.now() + 24_000, operation })) {
        this.finish(label, requestId, null, "The Deck window is unavailable.");
      }
    });
  }

  finish(label: string, requestId: string, result: unknown, error?: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.label !== label) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (error) pending.reject(new Error(error.slice(0, 500)));
    else pending.resolve(result);
  }

  forgetWindow(label: string): void {
    this.windows.delete(label);
    for (const [id, request] of this.pending) {
      if (request.label === label) this.finish(label, id, null, "The Deck window disconnected.");
    }
  }

  close(): void {
    for (const label of this.windows.keys()) this.forgetWindow(label);
  }
}
