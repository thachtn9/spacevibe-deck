import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverReviewRepositories, fetchReview, readReview, readReviewDiff } from "./review";

const cleanup: string[] = [];
afterEach(() => {
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});
function scratch(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "deck-review-test-"));
  cleanup.push(root);
  return root;
}
function git(root: string, ...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "Deck Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Deck Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function repo(root: string): void {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "dev");
}
function commit(root: string, content: string, message: string): string {
  writeFileSync(path.join(root, "file.txt"), content);
  git(root, "add", "file.txt");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD").trim();
}

describe("repository discovery", () => {
  it("finds child repos beneath a plain parent and skips dependencies and symlink loops", async () => {
    const root = scratch();
    repo(path.join(root, "one"));
    repo(path.join(root, "nested/two"));
    repo(path.join(root, "node_modules/ignored"));
    symlinkSync(root, path.join(root, "loop"));
    const result = await discoverReviewRepositories(root);
    expect(result.repositories.map((entry) => entry.label)).toEqual(["nested/two", "one"]);
    expect(result.truncated).toBe(false);
  });
  it("includes the current repo, nested repos and linked worktree .git files", async () => {
    const root = scratch();
    repo(path.join(root, "project"));
    commit(path.join(root, "project"), "base\n", "base");
    git(path.join(root, "project"), "worktree", "add", "-qb", "task", path.join(root, "linked"));
    repo(path.join(root, "project/child"));
    const result = await discoverReviewRepositories(root);
    expect(result.repositories.map((entry) => entry.label)).toEqual([
      "linked",
      "project",
      "project/child",
    ]);
    mkdirSync(path.join(root, "project/src"));
    expect(
      (await discoverReviewRepositories(path.join(root, "project/src"))).repositories[0].path,
    ).toBe(path.join(root, "project"));
  });
});

describe("branch review", () => {
  it("separates pushed commits not in dev from local commits and updates remote refs only on Fetch", async () => {
    const parent = scratch(),
      root = path.join(parent, "project"),
      remote = path.join(parent, "remote.git");
    repo(root);
    commit(root, "base\n", "base");
    git(parent, "init", "--bare", "-q", remote);
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-qu", "origin", "dev");
    git(root, "switch", "-qc", "feature");
    commit(root, "published\n", "published feature");
    git(root, "push", "-qu", "origin", "feature");
    const local = commit(root, "local\n", "local feature");
    writeFileSync(path.join(root, "new file.txt"), "new\n");
    const review = await readReview(root);
    expect(review.target).toBe("origin/dev");
    expect(review.ahead).toBe(2);
    expect(review.unpushed).toBe(1);
    expect(review.upstream).toBe("origin/feature");
    expect(review.commits.map((entry) => [entry.subject, entry.publication])).toEqual([
      ["local feature", "local"],
      ["published feature", "pushed"],
    ]);
    expect(
      review.history?.map((entry) => [entry.subject, entry.inTarget, entry.publication]),
    ).toEqual([
      ["local feature", false, "local"],
      ["published feature", false, "pushed"],
      ["base", true, "pushed"],
    ]);
    expect(review.changes.entries.map((entry) => entry.path)).toContain("new file.txt");
    const diff = await readReviewDiff(root, local);
    expect(diff.files).toEqual([{ status: "M", path: "file.txt" }]);
    expect((await readReviewDiff(root, local, "file.txt")).patch).toContain("+local");
    expect((await readReviewDiff(root, null, "new file.txt")).patch).toContain("+new");
    git(root, "push", "-q", "origin", "feature:dev");
    git(root, "update-ref", "refs/remotes/origin/dev", git(root, "rev-parse", "dev").trim());
    expect((await readReview(root)).ahead).toBe(2);
    await fetchReview(root, "origin");
    expect((await readReview(root)).ahead).toBe(0);
    const merged = await readReview(root);
    expect(merged.commits).toEqual([]);
    expect(merged.history).toHaveLength(3);
    expect(merged.history?.every((entry) => entry.inTarget)).toBe(true);
  });
  it("does not invent an upstream, preserves a missing target as unselected, and handles unborn repos", async () => {
    const root = scratch();
    repo(root);
    expect((await readReview(root)).changes.initial).toBe(true);
    commit(root, "base\n", "base");
    git(root, "switch", "-qc", "feature");
    commit(root, "feature\n", "feature");
    const review = await readReview(root);
    expect(review.target).toBe("dev");
    expect(review.unpushed).toBeNull();
    expect(review.commits[0].publication).toBe("unknown");
    git(root, "branch", "--set-upstream-to", "dev", "feature");
    expect((await readReview(root)).unpushed).toBeNull();
    const missing = await readReview(root, "origin/missing");
    expect(missing.target).toBeNull();
    expect(missing.commits).toEqual([]);
    expect(missing.history?.map((entry) => entry.subject)).toEqual(["feature", "base"]);
    expect(missing.history?.every((entry) => entry.inTarget === null)).toBe(true);
    expect((await readReview(root, "feature")).ahead).toBe(0);
  });
  it("reads deleted and initial-commit files and rejects paths and refs that could become options", async () => {
    const root = scratch();
    repo(root);
    const first = commit(root, "base\n", "base");
    expect((await readReviewDiff(root, first, "file.txt")).patch).toContain("+base");
    rmSync(path.join(root, "file.txt"));
    expect((await readReviewDiff(root, null, "file.txt")).patch).toContain("-base");
    await expect(readReviewDiff(root, "--help")).rejects.toThrow("Invalid commit");
    await expect(readReviewDiff(root, null, "../outside")).rejects.toThrow("Invalid changed file");
    await expect(fetchReview(root, "--upload-pack=command")).rejects.toThrow("valid remote");
  });
});
