import { expect, it, vi } from "vitest";
import { createManagerSessionsService } from "./cli-manager";
import { parseManagerSessions, managerResumeCommand } from "../../src/lib/cli-manager-sessions";
import { asSessionsSnapshot } from "../../src/lib/session-history";

const session = {
  engine: "antigravity",
  id: "session-1",
  account: "acc5",
  workspace: "/work/project",
  workspace_exists: true,
  updated_at: "2026-10-15T08:24:20Z",
  is_client: false,
  is_running: true,
  title: "Fix layout",
};

it("maps both engines and preserves account/liveness across IPC validation", () => {
  const snapshot = parseManagerSessions({
    sessions: [session, { ...session, id: "session-2", engine: "codex", account: "codex2" }],
  });
  expect(snapshot.totals).toEqual({ claude: 0, codex: 1, agy: 1 });
  expect(asSessionsSnapshot(snapshot)).toEqual(snapshot);
  expect(snapshot.entries[0].manager).toEqual({
    account: "acc5",
    isClient: false,
    workspaceExists: true,
    running: true,
  });
  expect(managerResumeCommand(snapshot.entries[0])).toBe("cli resume session-1 --acc acc5");
});

it("does not turn malformed data into an empty successful response or executable command", () => {
  expect(() => parseManagerSessions({})).toThrow("Invalid CLI Manager session response");
  expect(
    parseManagerSessions({
      sessions: [
        { ...session, id: "--help" },
        { ...session, account: "x;pwd" },
        { ...session, updated_at: "bad" },
      ],
    }).entries,
  ).toEqual([]);
  const remote = parseManagerSessions({ sessions: [{ ...session, is_client: true }] }).entries[0];
  expect(managerResumeCommand(remote)).toBeNull();
  expect(
    managerResumeCommand({
      ...remote,
      manager: { ...remote.manager!, isClient: false, workspaceExists: false },
    }),
  ).toBeNull();
});

it("caps each engine after sorting newest first", () => {
  const snapshot = parseManagerSessions(
    {
      sessions: [
        session,
        { ...session, id: "session-2", updated_at: "2026-10-16T08:00:00Z" },
        { ...session, id: "session-3", engine: "codex" },
      ],
    },
    1,
  );
  expect(snapshot.entries.map((r) => r.sessionId)).toEqual(["session-2", "session-3"]);
  expect(snapshot.totals.agy).toBe(2);
});

it("shares a GET request and reports HTTP failures without falling back to local history", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ sessions: [session] }) });
  const service = createManagerSessionsService(fetcher as typeof fetch);
  await Promise.all([service.list(1), service.list(500)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("http://cli-manager.localhost:1428/api/sessions");
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  fetcher.mockResolvedValue({ ok: false });
  await expect(service.list()).rejects.toThrow("could not be reached");
  service.close();
});
