import { describe, expect, it } from "vitest";
import { buildAgentRail } from "./agent-rail-model";
import { buildRailFolderTree } from "./agent-rail-tree";
import type { TabView } from "../terminal/tabs-store";

function folders(paths: readonly string[]) {
  const tabs: TabView[] = paths.map((workspacePath, key) => ({
    key,
    workspacePath,
    process: "bash",
    name: null,
    dotColor: null,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: { kind: "idle", actionableCount: 0, workingCount: 0, unreadCount: 0 },
  }));
  return buildAgentRail({
    tabs,
    scans: new Map(),
    workspaceHistoryPaths: paths,
    activeIndex: 0,
    now: 0,
  }).stream;
}

describe("rail folder hierarchy", () => {
  it("places a child opened first beneath its nearest open ancestor and preserves tab targets", () => {
    const stream = folders([
      "/data/project/api/src",
      "/data/other",
      "/data/project",
      "/data/project/api",
    ]);
    const nodes = buildRailFolderTree(stream);
    expect(
      nodes.map(({ group, ancestors }) => [group.project, ancestors.length, group.tabIndexes]),
    ).toEqual([
      ["other", 0, [1]],
      ["project", 0, [2]],
      ["api", 1, [3]],
      ["src", 2, [0]],
    ]);
    expect(nodes[3].group).toBe(stream[0]);
    expect(nodes[3].ancestors).toEqual([stream[2].key, stream[3].key]);
  });

  it("reparents an existing canonical child when an aliased plain parent is added later", () => {
    const parent = "/home/me/data/SCRIPT";
    const child = "/data/SCRIPT/app";
    expect(buildRailFolderTree(folders([child]))[0].ancestors).toEqual([]);
    const stream = folders([child, parent]);
    const nodes = buildRailFolderTree(
      stream,
      new Map([[parent, { kind: "plain", reason: "not git", canonicalPath: "/data/SCRIPT" }]]),
    );
    expect(
      nodes.map(({ group, ancestors }) => [group.project, ancestors.length, group.tabIndexes]),
    ).toEqual([
      ["SCRIPT", 0, [1]],
      ["app", 1, [0]],
    ]);
    expect(nodes[1].group).toBe(stream[0]);
    expect(nodes[1].group.worktrees[0].path).toBe(child);
  });

  it("keeps similarly named siblings separate and leaves an unopened parent absent", () => {
    const nodes = buildRailFolderTree(
      folders(["/data/project", "/data/project-two", "/other/api"]),
    );
    expect(nodes.map((node) => node.ancestors)).toEqual([[], [], []]);
  });

  it("matches an opened alias even when Git supplies a canonical checkout path", () => {
    const stream = folders(["/home/me/data/project", "/home/me/data/project/api"]);
    const child = {
      ...stream[1],
      worktrees: stream[1].worktrees.map((w) => ({ ...w, path: "/data/project/api" })),
    };
    const nodes = buildRailFolderTree([stream[0], child]);
    expect(nodes[1].ancestors).toEqual([stream[0].key]);
  });
});
