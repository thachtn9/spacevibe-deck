import { readdir, realpath, open } from "node:fs/promises";
import path from "node:path";
import { resolveInsideRoot, resolveRoot } from "../fs/path-guard";
import { readChanges, runnerFor, type GitRunner } from "./changes";
import type {
  ReviewCommit,
  ReviewDiff,
  ReviewDiscovery,
  ReviewSnapshot,
} from "../../src/lib/git-review";

const SKIP = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
]);
const MAX_REPOSITORIES = 40;
const MAX_PATCH = 256 * 1024;
const SAFE_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

async function git(run: GitRunner, args: readonly string[], input?: string): Promise<string> {
  const reply = await run(args, input);
  if (!reply.ok) throw new Error(reply.stderr.trim() || `Git ${reply.kind}`);
  return reply.stdout;
}
function rootFor(value: unknown): string {
  if (typeof value !== "string") throw new Error("A repository folder is required");
  const root = resolveRoot(value);
  if (!root) throw new Error("The folder is unavailable");
  return root;
}

/** Walk directory entries, never subprocesses per directory; linked worktrees have a .git file. */
export async function discoverReviewRepositories(value: unknown): Promise<ReviewDiscovery> {
  const root = rootFor(value);
  const found = new Set<string>();
  const probe = await runnerFor(root)(["rev-parse", "--show-toplevel"]);
  if (probe.ok) found.add(await realpath(probe.stdout.trim()));
  const pending = [{ directory: root, depth: 0 }];
  let visited = 0;
  let truncated = false;
  const started = Date.now();
  while (pending.length) {
    if (visited >= 6000 || found.size >= MAX_REPOSITORIES || Date.now() - started > 2500) {
      truncated = true;
      break;
    }
    const current = pending.shift()!;
    visited += 1;
    try {
      const entries = await readdir(current.directory, { withFileTypes: true });
      if (entries.some((entry) => entry.name === ".git")) found.add(current.directory);
      const children = entries.filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name),
      );
      children.sort((a, b) => a.name.localeCompare(b.name));
      if (current.depth >= 6) {
        if (children.length) truncated = true;
        continue;
      }
      pending.push(
        ...children.map((entry) => ({
          directory: path.join(current.directory, entry.name),
          depth: current.depth + 1,
        })),
      );
    } catch {
      /* A child may be inaccessible or disappear while scanning. */
    }
  }
  const repositories = [...found].sort().map((repo) => ({
    path: repo,
    label:
      path.relative(root, repo) && !path.relative(root, repo).startsWith("..")
        ? path.relative(root, repo)
        : path.basename(repo) || repo,
  }));
  return { root, repositories, truncated };
}

export async function readReview(
  value: unknown,
  requestedTarget?: unknown,
): Promise<ReviewSnapshot> {
  const root = rootFor(value);
  const run = runnerFor(root);
  const [changes, refsText, upstreamResult, headResult, remotesText] = await Promise.all([
    readChanges(root),
    git(run, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads", "refs/remotes"]),
    run(["rev-parse", "--symbolic-full-name", "@{upstream}"]),
    run(["rev-parse", "--verify", "HEAD^{commit}"]),
    git(run, ["remote"]),
  ]);
  if (changes.kind !== "changes") throw new Error(changes.message);
  const refs = new Map<string, { full: string; oid: string }>();
  for (const row of refsText.trim().split("\n")) {
    const [full, oid] = row.split("\0");
    if (!oid || full.endsWith("/HEAD")) continue;
    refs.set(full.replace(/^refs\/(?:heads|remotes)\//, ""), { full, oid });
  }
  const preferred =
    requestedTarget === undefined
      ? refs.has("origin/dev")
        ? "origin/dev"
        : refs.has("dev")
          ? "dev"
          : null
      : requestedTarget;
  if (preferred !== null && typeof preferred !== "string") throw new Error("Invalid target branch");
  const target = typeof preferred === "string" && refs.has(preferred) ? preferred : null;
  const upstreamFull = upstreamResult.ok ? upstreamResult.stdout.trim() : null;
  const upstreamEntry = [...refs].find(
    ([, ref]) => ref.full === upstreamFull && ref.full.startsWith("refs/remotes/"),
  );
  const upstream = upstreamEntry?.[0] ?? null;
  const remotes = remotesText.trim().split("\n").filter(Boolean);
  const remoteRef = (target ? refs.get(target)?.full : null) ?? upstreamFull;
  const fetchRemote =
    remotes
      .sort((a, b) => b.length - a.length)
      .find((remote) => remoteRef?.startsWith(`refs/remotes/${remote}/`)) ??
    (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null);
  const result: ReviewSnapshot = {
    root,
    branch: changes.branch,
    target,
    refs: [...refs.keys()].sort(),
    upstream,
    unpushed: null,
    ahead: 0,
    behind: 0,
    commits: [],
    history: [],
    historyLimited: false,
    changes,
    fetchRemote,
  };
  if (!headResult.ok) return result;
  const head = headResult.stdout.trim();
  const targetOid = target ? refs.get(target)!.oid : null;
  const upstreamOid = upstreamEntry?.[1].oid;
  const logArgs = [
    "log",
    "--no-color",
    "--no-decorate",
    "--no-show-signature",
    "-z",
    "--format=%H%x00%h%x00%s%x00%an%x00%aI",
    "-n",
  ];
  const [counts, localCount, log, historyLog] = await Promise.all([
    targetOid
      ? git(run, ["rev-list", "--left-right", "--count", `${targetOid}...${head}`])
      : Promise.resolve("0\t0"),
    upstreamOid
      ? git(run, ["rev-list", "--count", `${upstreamOid}..${head}`])
      : Promise.resolve(null),
    targetOid ? git(run, [...logArgs, "100", `${targetOid}..${head}`, "--"]) : Promise.resolve(""),
    git(run, [...logArgs, "101", head, "--"]),
  ]);
  function parseLog(text: string): ReviewCommit[] {
    const fields = text.split("\0");
    const rows: ReviewCommit[] = [];
    for (let index = 0; index + 4 < fields.length; index += 5) {
      const [id, shortId, subject, author, date] = fields.slice(index, index + 5);
      if (SAFE_OID.test(id))
        rows.push({ id, shortId, subject, author, date, publication: "unknown" });
    }
    return rows;
  }
  const commits = parseLog(log);
  const history = parseLog(historyLog);
  const ids = [...new Set([...commits, ...history.slice(0, 100)].map((commit) => commit.id))];
  // --not tests reachability against the corresponding upstream, not an unrelated remote branch.
  const localIds =
    upstreamOid && ids.length
      ? new Set((await git(run, ["rev-list", ...ids, "--not", upstreamOid])).trim().split("\n"))
      : null;
  const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
  const pendingIds = new Set(commits.map((commit) => commit.id));
  const classify = (commit: ReviewCommit): ReviewCommit => ({
    ...commit,
    publication: localIds ? (localIds.has(commit.id) ? "local" : "pushed") : "unknown",
    inTarget: targetOid ? !pendingIds.has(commit.id) : null,
  });
  return {
    ...result,
    behind: behind || 0,
    ahead: ahead || 0,
    unpushed: localCount === null ? null : Number(localCount.trim()),
    commits: commits.map(classify),
    history: history.slice(0, 100).map(classify),
    historyLimited: history.length > 100,
  };
}

async function comparison(
  run: GitRunner,
  commit: unknown,
): Promise<{ base: string; head: string | null }> {
  if (commit === null) {
    const head = await run(["rev-parse", "--verify", "HEAD^{commit}"]);
    return {
      base: head.ok
        ? head.stdout.trim()
        : (await git(run, ["hash-object", "-t", "tree", "--stdin"], "")).trim(),
      head: null,
    };
  }
  if (typeof commit !== "string" || !SAFE_OID.test(commit)) throw new Error("Invalid commit id");
  const chain = (await git(run, ["rev-list", "--parents", "-n", "1", commit, "--"]))
    .trim()
    .split(" ");
  return {
    base: chain[1] ?? (await git(run, ["hash-object", "-t", "tree", "--stdin"], "")).trim(),
    head: chain[0],
  };
}

export async function readReviewDiff(
  value: unknown,
  commit: unknown,
  requestedPath?: unknown,
): Promise<ReviewDiff> {
  const root = rootFor(value);
  const run = runnerFor(root);
  const { base, head } = await comparison(run, commit);
  if (
    requestedPath !== undefined &&
    (typeof requestedPath !== "string" ||
      !requestedPath ||
      requestedPath.includes("\0") ||
      requestedPath.split(/[\\/]/).includes("..") ||
      path.isAbsolute(requestedPath))
  )
    throw new Error("Invalid changed file path");
  const range = head ? [base, head] : [base];
  const names = (
    await git(run, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-status",
      "-z",
      ...range,
      "--",
    ])
  ).split("\0");
  const files: ReviewDiff["files"][number][] = [];
  for (let index = 0; index + 1 < names.length; index += 2)
    if (names[index + 1]) files.push({ status: names[index][0], path: names[index + 1] });
  if (requestedPath === undefined)
    return { files: files.slice(0, 500), patch: "", truncated: files.length > 500 };
  const file = requestedPath as string;
  if (head === null && !files.some((entry) => entry.path === file)) {
    const untracked = await git(run, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      `:(literal)${file}`,
    ]);
    if (!untracked.split("\0").includes(file))
      throw new Error("This file is no longer changed. Refresh the list.");
    const absolute = resolveInsideRoot(root, file);
    if (!absolute) throw new Error("File is outside the repository");
    const handle = await open(absolute, "r");
    try {
      if (!(await handle.stat()).isFile()) throw new Error("Select a file to view its diff");
      const buffer = Buffer.alloc(MAX_PATCH);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.subarray(0, bytesRead).includes(0))
        return { files: [], patch: "Binary file added.", truncated: false };
      return {
        files: [],
        patch:
          `--- /dev/null\n+++ b/${file}\n` +
          buffer
            .toString("utf8", 0, bytesRead)
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n"),
        truncated: (await handle.stat()).size > MAX_PATCH,
      };
    } finally {
      await handle.close();
    }
  }
  const patch = await git(run, [
    "-c",
    "color.ui=false",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--unified=3",
    ...range,
    "--",
    `:(literal)${file}`,
  ]);
  return {
    files: files.slice(0, 500),
    patch: patch.slice(0, MAX_PATCH),
    truncated: patch.length > MAX_PATCH || files.length > 500,
  };
}

export async function fetchReview(value: unknown, remote: unknown): Promise<void> {
  const root = rootFor(value);
  const run = runnerFor(root);
  const remotes = (await git(run, ["remote"])).trim().split("\n");
  if (typeof remote !== "string" || !remote || remote.startsWith("-") || !remotes.includes(remote))
    throw new Error("Choose a valid remote to fetch");
  await git(run, ["fetch", "--prune", "--no-recurse-submodules", "--no-auto-maintenance", remote]);
}
