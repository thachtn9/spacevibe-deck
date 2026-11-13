import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import type { DesktopAgentSnapshot } from "../../src/lib/desktop-agents";

/** A helper process gives only this window X11 placement on a Wayland desktop. */
export class DesktopAgentWidget {
  private child: ChildProcessWithoutNullStreams | null = null;
  private latest: DesktopAgentSnapshot | null = null;
  private disposed = false;
  constructor(
    private options: {
      userData: string;
      rendererUrl: string;
      activate: (key: string) => void;
    },
  ) {}
  update(snapshot: DesktopAgentSnapshot): void {
    if (this.disposed || process.platform !== "linux") return;
    this.latest = snapshot;
    if (!this.child && !snapshot.rows.length) return;
    if (!this.child) this.start();
    this.send();
  }
  dispose(): void {
    this.disposed = true;
    this.child?.stdin.end();
    this.child = null;
  }
  private send(): void {
    if (this.child?.stdin.writable && this.latest) {
      this.child.stdin.write(JSON.stringify(this.latest) + "\n");
    }
  }
  private start(): void {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      process.execPath,
      [
        path.join(__dirname, "entry.cjs"),
        "--ozone-platform=x11",
        // Preserve an explicit parent launch mode (including Playwright's sandbox setting).
        ...(app.commandLine.hasSwitch("no-sandbox") ? ["--no-sandbox"] : []),
        this.options.userData,
        this.options.rendererUrl,
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    child.stdin.on("error", () => {});
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4096) {
        buffer = "";
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready) this.send();
          if (typeof message.activate === "string") this.options.activate(message.activate);
        } catch {
          /* Ignore runtime diagnostics on stdout. */
        }
      }
    });
    // Drain Chromium diagnostics without retaining an unbounded log.
    child.stderr.resume();
    child.on("error", (error) => console.warn("Deck agent widget unavailable:", error));
    child.on("close", () => {
      if (this.child === child) this.child = null;
    });
  }
}
