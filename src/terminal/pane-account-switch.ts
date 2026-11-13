/* oxlint-disable eslint/no-await-in-loop -- Each reading must observe the preceding stop or shell transition. */
import type { PaneProcessInfo } from "../lib/process-info";
import type { DesktopPlatform } from "../lib/platform";
import type { PtyClient } from "./pty-client";
import { shellResumeInput } from "./pane-shell-reset";

interface SwitchDeps {
  pty: Pick<PtyClient, "ptyInfo" | "killForeground" | "writePty">;
  platform: DesktopPlatform;
  valid(): boolean;
  prepare(command: string): Promise<string | null>;
  stopped(): Promise<void>;
  pauseInput(): Promise<() => void>;
  resetTerminal(): Promise<void>;
  launched(command: string, sessionId: string, cwd: string): void;
}

function sessionOf(info: PaneProcessInfo | undefined): string | null {
  return (info?.agent === "codex" ? info.codexSessionId : info?.agySessionId) ?? null;
}

function assertCodexReady(info: PaneProcessInfo | undefined): void {
  if (info?.agent === "codex" && info.codexIdentityState === "locked")
    throw new Error(
      "Codex could not open this conversation because another app or background Codex server still holds it. Close that exact conversation there, then press R in Codex to retry. This pane has not opened the conversation; changing accounts cannot release the other app's lock.",
    );
}

/** Keep the PTY and layout; resume only the session proven by the live process. */
export async function switchPaneAccount(
  paneId: number,
  account: { readonly id: string; readonly agent: string },
  deps: SwitchDeps,
): Promise<boolean> {
  if (!deps.valid() || !deps.pty.killForeground) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(account.id)) return false;
  const read = async (waitForMetadata = false) =>
    (await deps.pty.ptyInfo([paneId], [], waitForMetadata)).find((i) => i.id === paneId);
  let initial = await read(true);
  if (!deps.valid()) return false;
  if (
    initial?.kind !== "agent" ||
    initial.agent !== account.agent ||
    (account.agent !== "codex" && account.agent !== "agy")
  )
    throw new Error("Drop an account onto a running session of the same agent.");
  assertCodexReady(initial);
  if (initial.account === account.id) return true;
  // A newly resumed CLI can publish its lock after the first process snapshot.
  // Keep every retry bound to the same process; never borrow another pane's id.
  const processId = initial.processId;
  for (let attempt = 0; !sessionOf(initial) && attempt < 10; attempt++) {
    if (!deps.valid()) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const next = await read(true);
    if (!deps.valid()) return false;
    if (next?.kind !== "agent" || next.agent !== account.agent || next.processId !== processId)
      throw new Error("The session changed while switching accounts. Try again.");
    initial = next;
    assertCodexReady(initial);
  }
  const sessionId = sessionOf(initial);
  if (initial.processId == null || initial.processId <= 1)
    throw new Error(
      "Could not identify this terminal's running process. The account was not changed.",
    );
  if (!initial.cwd || /[\r\n\0]/.test(initial.cwd))
    throw new Error("Could not read this session's folder. The account was not changed.");
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId))
    throw new Error(
      account.agent === "codex"
        ? initial.codexIdentityState === "shared"
          ? "This Codex client uses a shared background server. Deck cannot prove which conversation belongs to this pane. Close the conversation there, then open it from Deck's Session history. New Deck launches run with --no-daemon. The current client was not stopped."
          : "Codex has not published a verifiable conversation identity for this pane. Retry after it finishes starting. The current session was not stopped."
        : "AGY has not published this session's identity yet. Try again after it finishes starting. The account was not changed.",
    );
  const command = `cli resume ${sessionId} --acc ${account.id}`;
  const prepared = await deps.prepare(command);
  if (!deps.valid() || prepared === null) return false;
  const current = await read(true);
  if (!deps.valid()) return false;
  if (
    current?.kind !== "agent" ||
    current.agent !== initial.agent ||
    current.processId !== initial.processId ||
    sessionOf(current) !== sessionId
  )
    throw new Error("The session changed while switching accounts. Try again.");

  const releaseInput = await deps.pauseInput();
  try {
    if (!deps.valid()) return false;
    if (initial.agent === "codex" && deps.platform === "linux")
      await deps.pty.killForeground(paneId, {
        processId: initial.processId,
        sessionId,
        accountId: account.id,
      });
    else await deps.pty.killForeground(paneId);
    // Stop escalates after 500ms. Do not start a replacement inside that grace window.
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (let attempt = 0; attempt < 80 && deps.valid(); attempt++) {
      const info = await read();
      if (!deps.valid()) return false;
      if (info?.kind === "idle-shell") {
        await deps.stopped();
        const shell = await read();
        if (!deps.valid()) return false;
        if (shell?.kind !== "idle-shell" || shell.processId !== info.processId) {
          throw new Error("The terminal is no longer idle. The resume command was not sent.");
        }
        await deps.resetTerminal();
        if (!deps.valid()) return false;
        const cwd = initial.cwd;
        const quoted = `'${cwd.replace(/'/g, deps.platform === "windows" ? "''" : "'\\''")}'`;
        const launch =
          shell.cwd === cwd
            ? prepared
            : deps.platform === "windows"
              ? `Set-Location -LiteralPath ${quoted}; if ($?) { ${prepared} }`
              : `cd -- ${quoted} && ${prepared}`;
        await deps.pty.writePty(paneId, shellResumeInput(launch, deps.platform === "windows"));
        // Writing a command is not a successful switch: the replacement may
        // still be starting, reject the account, or show Codex's lock screen.
        for (let startup = 0; startup < 100 && deps.valid(); startup++) {
          const resumed = await read(true);
          if (!deps.valid()) return false;
          assertCodexReady(resumed);
          if (resumed?.kind === "agent") {
            if (
              resumed.agent !== account.agent ||
              (sessionOf(resumed) !== null && sessionOf(resumed) !== sessionId) ||
              (resumed.account != null && resumed.account !== account.id)
            )
              throw new Error(
                "The replacement opened a different session or account. Check the terminal before retrying.",
              );
            if (
              resumed.processId !== initial.processId &&
              sessionOf(resumed) === sessionId &&
              (deps.platform !== "linux" || resumed.account === account.id)
            ) {
              deps.launched(command, sessionId, cwd);
              return true;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!deps.valid()) return false;
        throw new Error(
          "The resume command was sent, but Deck could not confirm the same conversation under the selected account. Check the terminal before retrying.",
        );
      }
      if (info?.kind === "agent" && info.processId !== initial.processId) {
        throw new Error("Another agent started in this terminal. The resume command was not sent.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!deps.valid()) return false;
    throw new Error("The agent did not stop in time. The resume command was not sent.");
  } finally {
    releaseInput();
  }
}
