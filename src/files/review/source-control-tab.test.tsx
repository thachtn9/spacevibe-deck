// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControlTab } from "./source-control-tab";
import { CodeSourceControl } from "./code-source-control";
import {
  sourceControlView,
  hiddenReviewRepositories,
  saveHiddenReviewRepositories,
} from "./review-store";
import * as host from "../../host/git-review-host";
import type { ReviewSnapshot } from "../../lib/git-review";
import type { FileSurfaceController } from "../file-surface-controller";

vi.mock("../../host/git-review-host", () => ({
  discoverReview: vi.fn(),
  readReview: vi.fn(),
  readReviewDiff: vi.fn(),
  fetchReview: vi.fn(),
}));
vi.mock("./review-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    sourceControlView: signal("changes"),
    reviewTarget: vi.fn(async () => undefined),
    saveReviewTarget: vi.fn(async () => {}),
    hiddenReviewRepositories: vi.fn(async () => []),
    saveHiddenReviewRepositories: vi.fn(async () => {}),
  };
});
vi.mock("../changes/turn-end", () => ({ installTurnEndWatch: () => () => {} }));
vi.mock("../ui/explorer-tab", () => ({ ExplorerTab: () => <div>File tree retained</div> }));
let container: HTMLDivElement;
const controller = {} as FileSurfaceController;
const snapshot = (root: string): ReviewSnapshot => ({
  root,
  branch: "feature",
  target: "origin/dev",
  refs: ["origin/dev", "dev"],
  upstream: "origin/feature",
  unpushed: 1,
  ahead: 2,
  behind: 0,
  fetchRemote: "origin",
  commits: [
    {
      id: "a".repeat(40),
      shortId: "aaaaaaa",
      subject: "Local change",
      author: "Test",
      date: "2026-10-16T00:00:00Z",
      publication: "local",
    },
    {
      id: "b".repeat(40),
      shortId: "bbbbbbb",
      subject: "Published change",
      author: "Test",
      date: "2026-10-16T00:00:00Z",
      publication: "pushed",
    },
  ],
  changes: {
    kind: "changes",
    branch: "feature",
    detached: false,
    oid: null,
    initial: false,
    entries: [
      {
        path: "file.ts",
        oldPath: null,
        status: "modified",
        added: 1,
        removed: 1,
        binary: false,
        counted: true,
      },
    ],
    omitted: 0,
    totals: { added: 1, removed: 1 },
  },
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  sourceControlView.value = "changes";
  vi.mocked(hiddenReviewRepositories).mockResolvedValue([]);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.mocked(host.discoverReview).mockResolvedValue({
    root: "/parent",
    repositories: [
      { path: "/parent/a", label: "a" },
      { path: "/parent/nested/b", label: "nested/b" },
    ],
    truncated: false,
  });
  vi.mocked(host.readReview).mockImplementation(async (root) => snapshot(root));
  vi.mocked(host.readReviewDiff).mockResolvedValue({
    files: [{ path: "file.ts", status: "M" }],
    patch: "-old\n+new\n",
    truncated: false,
  });
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});
it("shows child repositories even when their opened parent has no Git", async () => {
  act(() =>
    render(
      <SourceControlTab workspacePath="/parent" controller={controller} canCreate />,
      container,
    ),
  );
  await settle();
  await settle();
  expect(container.querySelectorAll(".git-review-repository")).toHaveLength(2);
  expect(container.textContent).toContain("nested/b");
  expect(container.textContent).toContain("Local only");
  expect(container.textContent).toContain("Pushed");
  expect(host.readReview).toHaveBeenCalledWith("/parent/a", undefined);
});
it("opens a historical file diff and retains Files as a secondary view", async () => {
  act(() =>
    render(
      <SourceControlTab workspacePath="/parent" controller={controller} canCreate />,
      container,
    ),
  );
  await settle();
  await settle();
  click(container.querySelector(".git-review-commit__row"));
  await settle();
  click(container.querySelector(".git-review-commit__files .git-review-file"));
  await settle();
  expect(host.readReviewDiff).toHaveBeenLastCalledWith("/parent/a", "a".repeat(40), "file.ts");
  expect(container.querySelector(".git-review-diff__patch")?.textContent).toContain("+new");
  click(container.querySelector('[aria-label="Back to changes"]'));
  click(container.querySelector('[data-review-view="files"]'));
  expect(container.textContent).toContain("File tree retained");
});
it("reports discovery failures and an empty parent without a misleading clean state", async () => {
  vi.mocked(host.discoverReview).mockRejectedValue(new Error("Folder unavailable"));
  act(() =>
    render(
      <SourceControlTab workspacePath="/parent" controller={controller} canCreate />,
      container,
    ),
  );
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Folder unavailable");
  vi.mocked(host.discoverReview).mockResolvedValue({
    root: "/parent",
    repositories: [],
    truncated: false,
  });
  click(container.querySelector('[aria-label="Refresh repositories"]'));
  await settle();
  expect(container.textContent).toContain("No Git repositories found");
});

it("keeps repository navigation visible alongside the selected working diff in View code", async () => {
  act(() => render(<CodeSourceControl root="/parent" />, container));
  await settle();
  await settle();
  click(container.querySelector(".git-review-file"));
  await settle();
  expect(host.readReviewDiff).toHaveBeenLastCalledWith("/parent/a", null, "file.ts");
  expect(container.querySelector(".code-source-control__list")?.textContent).toContain(
    "Working changes",
  );
  expect(container.querySelector(".code-source-control__detail")?.textContent).toContain("+new");
});

it("shows recent history even when no commits are ahead of the target", async () => {
  vi.mocked(host.readReview).mockImplementation(async (root) => ({
    ...snapshot(root),
    ahead: 0,
    commits: [],
    history: [{ ...snapshot(root).commits[1], inTarget: true }],
  }));
  act(() => render(<CodeSourceControl root="/parent" />, container));
  await settle();
  await settle();
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Commit view for a"]')!;
  act(() => {
    select.value = "recent";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("Published change");
  expect(container.textContent).toContain("In origin/dev");
});

it("removes a repository without deleting files, clears its diff and restores it on request", async () => {
  act(() => render(<CodeSourceControl root="/parent" />, container));
  await settle();
  await settle();
  click(container.querySelector(".git-review-file"));
  await settle();
  click(container.querySelector('[aria-label="Remove a from source control"]'));
  await settle();
  expect(container.querySelector('[data-repository="/parent/a"]')).toBeNull();
  expect(container.querySelector(".git-review-diff")).toBeNull();
  expect(saveHiddenReviewRepositories).toHaveBeenLastCalledWith("/parent", ["/parent/a"]);
  click(
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Show hidden folders"),
    )!,
  );
  await settle();
  expect(container.querySelector('[data-repository="/parent/a"]')).not.toBeNull();
  expect(saveHiddenReviewRepositories).toHaveBeenLastCalledWith("/parent", []);
});

it("does not read hidden repositories after loading saved preferences", async () => {
  vi.mocked(hiddenReviewRepositories).mockResolvedValue(["/parent/a"]);
  act(() => render(<CodeSourceControl root="/parent" />, container));
  await settle();
  await settle();
  expect(container.querySelector('[data-repository="/parent/a"]')).toBeNull();
  expect(host.readReview).not.toHaveBeenCalledWith("/parent/a", undefined);
  expect(host.readReview).toHaveBeenCalledWith("/parent/nested/b", undefined);
});
