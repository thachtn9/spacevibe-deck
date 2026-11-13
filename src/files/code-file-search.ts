import type { FileClient } from "./file-client";
import { isVisible } from "./file-tree";

export interface CodeFileIndex {
  readonly paths: readonly string[];
  readonly limited: boolean;
  readonly unreadable: number;
}

/** Bound traversal and IPC concurrency; canonical directory paths break symlink cycles. */
export async function scanCodeFiles(
  root: string,
  client: Pick<FileClient, "listDir">,
  signal: AbortSignal,
  showHidden: boolean,
  publish: (index: CodeFileIndex) => void,
): Promise<void> {
  const queue = [root];
  const seen = new Set(queue);
  const files = new Set<string>();
  let visited = 0;
  let unreadable = 0;
  while (queue.length > 0 && visited < 1500 && files.size < 20000 && !signal.aborted) {
    const batch = queue.splice(0, Math.min(6, 1500 - visited));
    visited += batch.length;
    const listings = await Promise.allSettled(batch.map((path) => client.listDir(root, path)));
    if (signal.aborted) return;
    for (const listing of listings) {
      if (listing.status === "rejected") {
        unreadable++;
        continue;
      }
      for (const entry of listing.value) {
        if (entry.outOfRoot || !isVisible(entry, showHidden)) continue;
        if (entry.directory) {
          if (!seen.has(entry.path) && seen.size < 1500) {
            seen.add(entry.path);
            queue.push(entry.path);
          }
        } else if (files.size < 20000) files.add(entry.path);
      }
    }
    publish({
      paths: [...files].sort(),
      limited: seen.size >= 1500 || files.size >= 20000,
      unreadable,
    });
  }
}

export function codePathLabel(root: string, path: string): string {
  const prefix = root.replace(/[\\/]$/, "") + (root.includes("\\") ? "\\" : "/");
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Subsequence matching accepts fragments such as "srcfsv" without a search dependency. */
export function matchCodeFiles(root: string, paths: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return paths
    .map((path) => {
      const label = codePathLabel(root, path).toLowerCase();
      let at = 0;
      for (const char of needle) {
        at = label.indexOf(char, at);
        if (at < 0) return null;
        at++;
      }
      const name = label.split(/[\\/]/).pop()!;
      return {
        path,
        score: needle === "" ? 0 : name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2,
      };
    })
    .filter((entry): entry is { path: string; score: number } => entry !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 100)
    .map((entry) => entry.path);
}
