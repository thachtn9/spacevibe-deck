import { remoteTerminalFor } from "../terminal/remote-terminal";
import { effect } from "@preact/signals";
import { remoteHost } from "../host/remote-host";
import {
  REMOTE_INPUT_LIMIT,
  REMOTE_SCREEN_LIMIT,
  remotePaneIdentity,
  type RemotePane,
  type RemoteRpcRequest,
} from "../lib/deck-remote";
import { tabViews, type TabView } from "../terminal/tabs-store";
import type { TabManager } from "../terminal/tab-manager-types";
import { sessionTitlesFor } from "./agent-rail-card-model";
import { sessionEntries } from "../sessions/sessions-store";
import { paneSessionTitles } from "../terminal/session-title-store";

export function remotePanes(
  tabs: readonly TabView[],
  manager: Pick<TabManager, "paneAlive">,
  titles: ReadonlyMap<number, string> = new Map(),
): RemotePane[] {
  return tabs
    .flatMap((tab) =>
      (tab.panes ?? [])
        .filter((pane) => manager.paneAlive(pane.paneId))
        .map((pane) => ({
          paneId: pane.paneId,
          tabKey: tab.key,
          title: (
            tab.name ||
            titles.get(pane.paneId) ||
            `${pane.agent ?? "Shell"} ${pane.ordinal ?? pane.paneId}`
          ).slice(0, 160),
          path: tab.workspacePath,
          agentId: pane.agent,
          account: pane.account ?? null,
          phase: pane.phase,
          attention: pane.attention,
          startedAt: pane.startedAt ?? 0,
        })),
    )
    .slice(0, 512);
}

export function installRemoteSessionPublisher(deps: {
  manager: () => TabManager | null;
  rememberFolder: (path: string) => void;
}): () => void {
  if (!remoteHost.available) return () => {};
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const panes = () => {
    const manager = deps.manager();
    const tabs = tabViews.peek();
    return manager
      ? remotePanes(
          tabs,
          manager,
          sessionTitlesFor(tabs, sessionEntries.peek(), paneSessionTitles.peek()),
        )
      : [];
  };
  const publish = () => remoteHost.publish(panes());
  const handle = async ({ requestId, deadline, operation }: RemoteRpcRequest) => {
    try {
      const manager = deps.manager();
      const timely = () => !stopped && Date.now() < deadline;
      if (!manager || !timely()) throw new Error("The Deck window is unavailable.");
      let result: unknown;
      if (operation.kind === "create") {
        const request = operation.request;
        if (request.agentId !== null && !["codex", "agy"].includes(request.agentId))
          throw new Error("Unknown agent.");
        if (
          request.accountId !== null &&
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(request.accountId)
        )
          throw new Error("Invalid account.");
        const receipt = await manager.materializePane({
          layout: null,
          cwds: [request.path],
          workspacePath: request.path,
          agent: request.agentId,
          select: false,
          focusOnInit: false,
          canCommit: timely,
          ...(request.accountId
            ? { launchCommand: `cli ${request.accountId}`, chrome: { name: request.accountId } }
            : {}),
        });
        if (!receipt)
          throw new Error("The session could not be opened. Check Deck on your computer.");
        manager.notifySurfacesChanged();
        deps.rememberFolder(request.path);
        await publish();
        result = { paneId: receipt.paneId };
      } else {
        const expected = remotePaneIdentity(operation.pane);
        const valid = () =>
          timely() && panes().some((pane) => remotePaneIdentity(pane) === expected);
        if (!valid()) throw new Error("This session changed. Refresh Sessions.");
        if (operation.kind === "terminal") {
          result = await remoteTerminalFor(operation.pane.paneId).request(operation.request, valid);
        } else if (operation.kind === "screen") {
          const screen = manager.remoteScreen?.(operation.pane.paneId, 1000);
          const text = screen?.text ?? manager.serializePane(operation.pane.paneId, 1000);
          if (text === null) throw new Error("This session is no longer available.");
          result = {
            ...screen,
            text: text.slice(-REMOTE_SCREEN_LIMIT),
            capturedAtMs: Date.now(),
            alive: manager.paneAlive(operation.pane.paneId),
          };
        } else {
          if (remoteTerminalFor(operation.pane.paneId).controlled)
            throw new Error(
              "A browser controls this terminal. Release control before sending an instruction.",
            );
          if (new TextEncoder().encode(operation.text).length > REMOTE_INPUT_LIMIT)
            throw new Error("The text is too long.");
          result = await manager.sendRemoteInput(operation.pane.paneId, operation.text, valid);
        }
      }
      await remoteHost.reply(requestId, result);
    } catch (error) {
      await remoteHost.reply(
        requestId,
        null,
        error instanceof Error ? error.message : "The remote action failed.",
      );
    }
  };
  void remoteHost
    .onRequest((request) => {
      void handle(request).catch(console.warn);
    })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(console.warn);
  let previous = "";
  const stopEffect = effect(() => {
    const tabs = tabViews.value;
    const manager = deps.manager();
    const titles = sessionTitlesFor(tabs, sessionEntries.value, paneSessionTitles.value);
    const rows = manager ? remotePanes(tabs, manager, titles) : [];
    const next = JSON.stringify(rows);
    if (next === previous) return;
    previous = next;
    void remoteHost.publish(rows).catch(console.warn);
  });
  return () => {
    stopped = true;
    stopEffect();
    unlisten?.();
  };
}
