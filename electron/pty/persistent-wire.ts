import type { Socket } from "node:net";

export interface WireMessage {
  readonly request?: number;
  readonly method?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly event?: string;
  readonly paneId?: number;
  readonly payload?: unknown;
}

/** Private local socket, newline framed; bound both inbound frames and slow subscribers. */
export function readMessages(socket: Socket, receive: (message: WireMessage) => void): void {
  socket.setEncoding("utf8");
  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk;
    if (pending.length > 32 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try {
        receive(JSON.parse(line) as WireMessage);
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}

export function sendMessage(socket: Socket, message: WireMessage): void {
  if (socket.destroyed) return;
  if (socket.writableLength > 32 * 1024 * 1024) {
    socket.destroy();
    return;
  }
  socket.write(`${JSON.stringify(message)}\n`);
}
