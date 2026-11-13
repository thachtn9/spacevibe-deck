import { invoke, listen } from "./bridge";
import type { RemoteAccessStatus, RemotePane, RemoteRpcRequest } from "../lib/deck-remote";

export const remoteHost = {
  get available(): boolean {
    return (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
  },
  status: () => invoke<RemoteAccessStatus>("remote_access", { action: "status" }),
  configure: (enabled: boolean, port: number, root: string) =>
    invoke<RemoteAccessStatus>("remote_access", { action: "configure", enabled, port, root }),
  rotate: () => invoke<RemoteAccessStatus>("remote_access", { action: "rotate" }),
  pair: (address: string) => invoke<string>("remote_access", { action: "pair", address }),
  pairWeb: (address: string) => invoke<string>("remote_access", { action: "pair_web", address }),
  publish: (panes: readonly RemotePane[]) => invoke<void>("remote_publish", { panes }),
  reply: (requestId: string, result: unknown, error?: string) =>
    invoke<void>("remote_reply", { requestId, result, error }),
  onRequest: (callback: (request: RemoteRpcRequest) => void) =>
    listen<RemoteRpcRequest>("remote:request", ({ payload }) => callback(payload)),
};
