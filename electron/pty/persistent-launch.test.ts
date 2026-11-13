import { expect, it } from "vitest";
import { persistentLaunchCommand } from "./persistent-launch";

it("isolates Codex launches and exact account resumes without changing AGY or shell commands", () => {
  for (const command of ["cli codex1", "cli-codex"]) {
    expect(persistentLaunchCommand(command, "/tmp/pane")).toBe(
      `${command} --no-daemon -c 'log_dir="/tmp/pane/codex-log"'`,
    );
  }
  for (const command of ["cli acc5", "cli resume a-session --acc acc5", "ls", "codex; echo x"])
    expect(persistentLaunchCommand(command, "/tmp/pane")).toBe(command);
});

it("routes Codex resume through the account branch so the manager preserves account and flags", () => {
  expect(persistentLaunchCommand("cli resume exact-session --acc codex2", "/tmp/pane")).toBe(
    `cli codex2 resume exact-session --no-daemon -c 'log_dir="/tmp/pane/codex-log"'`,
  );
});

it("repairs commands already prepared by an older daemon without appending another log override", () => {
  const older = `cli resume exact-session --acc codex2 -c 'log_dir="/tmp/pane/codex-log"'`;
  const prepared = persistentLaunchCommand(older, "/tmp/pane");
  expect(prepared).toBe(
    `cli codex2 resume exact-session -c 'log_dir="/tmp/pane/codex-log"' --no-daemon`,
  );
  expect(persistentLaunchCommand(prepared, "/tmp/pane")).toBe(prepared);
});

it("keeps custom log overrides while disabling the shared daemon exactly once", () => {
  const command = "codex -c log_dir=custom";
  const prepared = persistentLaunchCommand(command, "/tmp/pane");
  expect(prepared).toBe(`${command} --no-daemon`);
  expect(persistentLaunchCommand(prepared, "/tmp/pane")).toBe(prepared);
});

it("refuses shell operators and malformed resume identities before normalization", () => {
  for (const command of [
    "cli resume exact-session --acc codex2; echo unsafe",
    "cli resume --latest --acc codex2",
  ])
    expect(persistentLaunchCommand(command, "/tmp/pane")).toBe(command);
});
