import fs from "node:fs/promises";
import path from "node:path";

/** Resolve both paths: a symlink inside the shared root cannot escape it. */
export async function remoteFolder(root: string, target: string): Promise<string> {
  if (!path.isAbsolute(target) || target.includes("\0") || target.length > 4096)
    throw new Error("Choose an absolute folder inside the shared root.");
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    fs.realpath(root),
    fs.realpath(target),
  ]);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("This folder is outside the shared root.");
  if (!(await fs.stat(canonicalTarget)).isDirectory()) throw new Error("Choose a folder.");
  return canonicalTarget;
}

export async function listRemoteFolders(root: string, target: string) {
  const canonicalRoot = await remoteFolder(root, root);
  const directory = await remoteFolder(root, target);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return {
    root: canonicalRoot,
    path: directory,
    parent: directory === canonicalRoot ? null : path.dirname(directory),
    entries: directories.slice(0, 500).map((entry) => ({
      name: entry.name,
      path: path.join(directory, entry.name),
    })),
    truncated: directories.length > 500,
  };
}
