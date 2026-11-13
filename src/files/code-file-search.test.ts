import { describe, expect, it, vi } from "vitest";
import { matchCodeFiles, scanCodeFiles, type CodeFileIndex } from "./code-file-search";

describe("code file search", () => {
  it("ranks file names above directory matches and accepts fuzzy paths", () => {
    expect(
      matchCodeFiles("/r", ["/r/editor/a.ts", "/r/src/editor.ts", "/r/src/file-view.ts"], "editor"),
    ).toEqual(["/r/src/editor.ts", "/r/editor/a.ts"]);
    expect(matchCodeFiles("/r", ["/r/src/file-view.ts"], "srfv")).toEqual(["/r/src/file-view.ts"]);
  });

  it("skips generated folders, hidden files, escaped links and directory cycles", async () => {
    const entry = (name: string, directory = false, path = `/r/${name}`, outOfRoot = false) => ({
      name,
      path,
      directory,
      outOfRoot,
    });
    const listDir = vi.fn(async (_root: string, path: string) =>
      path === "/r"
        ? [
            entry("src", true),
            entry("node_modules", true),
            entry(".env"),
            entry("escape", true, "/outside", true),
          ]
        : [entry("index.ts", false, "/r/src/index.ts"), entry("cycle", true, "/r/src")],
    );
    let result: CodeFileIndex | undefined;
    await scanCodeFiles("/r", { listDir }, new AbortController().signal, false, (index) => {
      result = index;
    });
    expect(listDir.mock.calls.map((call) => call[1])).toEqual(["/r", "/r/src"]);
    expect(result?.paths).toEqual(["/r/src/index.ts"]);
  });

  it("does not publish or traverse after cancellation", async () => {
    const abort = new AbortController();
    const publish = vi.fn();
    const listDir = vi.fn(async () => {
      abort.abort();
      return [];
    });
    await scanCodeFiles("/r", { listDir }, abort.signal, false, publish);
    expect(publish).not.toHaveBeenCalled();
    expect(listDir).toHaveBeenCalledTimes(1);
  });

  it("reports unreadable folders while keeping other results", async () => {
    const listDir = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const publish = vi.fn();
    await scanCodeFiles("/r", { listDir }, new AbortController().signal, false, publish);
    expect(publish).toHaveBeenLastCalledWith({ paths: [], limited: false, unreadable: 1 });
  });
});
