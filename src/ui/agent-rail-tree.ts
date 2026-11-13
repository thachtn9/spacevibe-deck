import type { RepositoryScan } from "../repositories/repository-client";
import type { RailStreamGroup } from "./agent-rail-model";

export interface RailFolderNode {
  readonly group: RailStreamGroup;
  readonly ancestors: readonly string[];
  readonly hasChildren: boolean;
}

function folderPaths(
  group: RailStreamGroup,
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly string[] {
  const opened = [...group.worktrees.map((worktree) => worktree.path), ...group.historyPaths];
  return [
    ...opened,
    ...opened.flatMap((path) => {
      const scan = scans.get(path);
      return scan?.kind === "plain" && scan.canonicalPath ? [scan.canonicalPath] : [];
    }),
  ]
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/").replace(/\/+$/, "") || "/")
    .map((path) => (/^[a-z]:/i.test(path) ? path.toLowerCase() : path));
}

/** Presentation only: nesting never merges project identities or tab ownership. */
export function buildRailFolderTree(
  stream: readonly RailStreamGroup[],
  scans: ReadonlyMap<string, RepositoryScan> = new Map(),
): readonly RailFolderNode[] {
  const paths = stream.map((group) => folderPaths(group, scans));
  const parents = new Map<number, number>();
  for (let child = 0; child < stream.length; child += 1) {
    let nearest = -1;
    let distance = Infinity;
    for (let parent = 0; parent < stream.length; parent += 1) {
      if (parent === child) continue;
      for (const base of paths[parent]) {
        const prefix = base === "/" ? base : `${base}/`;
        for (const path of paths[child]) {
          if (path === base || !path.startsWith(prefix)) continue;
          const steps = path.slice(prefix.length).split("/").length;
          if (steps < distance) {
            nearest = parent;
            distance = steps;
          }
        }
      }
    }
    // Several aliases/worktrees can point in opposing directions. Never form a cycle.
    let ancestor: number | undefined = nearest;
    while (ancestor !== undefined && ancestor !== child) ancestor = parents.get(ancestor);
    if (nearest !== -1 && ancestor !== child) parents.set(child, nearest);
  }
  const children = new Map<number | undefined, number[]>();
  for (let index = 0; index < stream.length; index += 1) {
    const parent = parents.get(index);
    const siblings = children.get(parent) ?? [];
    siblings.push(index);
    children.set(parent, siblings);
  }
  const result: RailFolderNode[] = [];
  function visit(index: number, ancestors: readonly string[]): void {
    const group = stream[index];
    const nested = children.get(index) ?? [];
    result.push({ group, ancestors, hasChildren: nested.length > 0 });
    for (const child of nested) visit(child, [...ancestors, group.key]);
  }
  for (const root of children.get(undefined) ?? []) visit(root, []);
  return result;
}
