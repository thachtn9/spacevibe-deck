import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { CODE_VIEWER_CHANNELS } from "./code-viewer-policy";
import type { ViewerRequest } from "./code-viewer-windows";

/** XWayland owns only presentation; all reads and preferences stay in the owning GUI. */
export class CodeViewerChild {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private stopped = false;
  private pending = new Map<
    number,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private deps: {
      renderer: string;
      preload: string;
      devServerUrl?: string;
      invoke(channel: string, payload: Record<string, unknown>): Promise<unknown>;
      closed(): void;
    },
  ) {}
  async open(request: ViewerRequest): Promise<void> {
    this.starting ??= this.start();
    await this.starting;
    if (this.stopped) throw new Error("The code viewer closed");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.nonce);
        reject(new Error("The code viewer did not open in time"));
      }, 30000);
      this.pending.set(request.nonce, { resolve, reject, timer });
      this.send({
        open: {
          request,
          renderer: this.deps.renderer,
          preload: this.deps.preload,
          devServerUrl: this.deps.devServerUrl,
        },
      });
    });
  }
  event(event: string, payload: unknown): void {
    this.send({ event, payload });
  }
  dispose(): void {
    this.stopped = true;
    this.child?.stdin.end();
  }
  private send(message: unknown): void {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  private async start(): Promise<void> {
    const profile = await mkdtemp(path.join(os.tmpdir(), "deck-code-viewer-"));
    return new Promise<void>((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        process.execPath,
        [
          path.join(__dirname, "code-viewer-helper.cjs"),
          "--ozone-platform=x11",
          ...(app.commandLine.hasSwitch("no-sandbox") ? ["--no-sandbox"] : []),
          ...(app.commandLine.hasSwitch("remote-debugging-port")
            ? ["--remote-debugging-port=0"]
            : []),
          profile,
        ],
        { env, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.child = child;
      const readyTimer = setTimeout(() => {
        reject(new Error("The viewer helper did not start"));
        this.dispose();
      }, 15000);
      child.stdin.on("error", () => {});
      child.stderr.resume();
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 32 * 1024 * 1024) {
          this.dispose();
          return;
        }
        let end: number;
        while ((end = output.indexOf("\n")) >= 0) {
          const line = output.slice(0, end);
          output = output.slice(end + 1);
          try {
            const message = JSON.parse(line);
            if (message.ready) {
              clearTimeout(readyTimer);
              resolve();
            } else if (typeof message.opened === "number" || typeof message.failed === "number") {
              const id = message.opened ?? message.failed;
              const pending = this.pending.get(id);
              this.pending.delete(id);
              if (pending) {
                clearTimeout(pending.timer);
                if (message.failed) pending.reject(new Error(message.error));
                else pending.resolve();
              }
            } else if (typeof message.id === "number" && typeof message.channel === "string") {
              const { id, channel } = message;
              if (!CODE_VIEWER_CHANNELS.has(channel)) {
                this.send({ id, error: "Unknown viewer channel" });
                continue;
              }
              void this.deps.invoke(channel, message.payload ?? {}).then(
                (result) => this.send({ id, result }),
                (error) => this.send({ id, error: String(error) }),
              );
            }
          } catch {
            /* Runtime diagnostics are not protocol messages. */
          }
        }
      });
      let closed = false;
      const ended = (error: Error) => {
        if (closed) return;
        closed = true;
        clearTimeout(readyTimer);
        reject(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        this.stopped = true;
        this.deps.closed();
        void rm(profile, { recursive: true, force: true });
      };
      child.once("error", ended);
      child.once("close", () => ended(new Error("The code viewer closed")));
    });
  }
}
