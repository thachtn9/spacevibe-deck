import path from "node:path";

/** Invocation-local configuration keeps Codex's writer identity owned by this pane. */
export function persistentLaunchCommand(command: string, directory: string): string {
  const resume =
    /^cli resume ([A-Za-z0-9][A-Za-z0-9._-]{0,127}) --acc (codex[A-Za-z0-9_-]{0,59})(?= |$)/.exec(
      command,
    );
  const codex =
    /^(?:codex|cli-codex)(?:\s|$)/.test(command) ||
    /^cli codex[A-Za-z0-9_-]*(?:\s|$)/.test(command) ||
    resume !== null;
  if (!codex || /[\n\r;|&<>`$]/.test(command)) return command;
  if (resume) {
    // Manager's history-resume branch drops forwarded flags and can auto-select
    // an account. Its account launch branch preserves both the account and argv.
    command = `cli ${resume[2]} resume ${resume[1]}${command.slice(resume[0].length)}`;
  }
  // A log override alone is not a contract that future Codex versions will
  // avoid the shared daemon. Its client does not hold the conversation lock.
  if (!/(?:^|\s)--no-daemon(?:\s|$)/.test(command)) command += " --no-daemon";
  if (/\blog_dir\s*=/.test(command)) return command;
  const config = `log_dir=${JSON.stringify(path.join(directory, "codex-log"))}`;
  return `${command} -c '${config.replace(/'/g, "'\\''")}'`;
}
