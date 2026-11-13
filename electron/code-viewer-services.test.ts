import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoreRegistry } from "./store";
import type { WatchRegistry } from "./fs/watch";
import { codeViewerServices } from "./code-viewer-services";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
}));
let directory: string;
let stores: StoreRegistry;
let invoke: ReturnType<typeof codeViewerServices>;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "deck-viewer-service-test-"));
  stores = new StoreRegistry(directory);
  invoke = codeViewerServices(stores, { replace: vi.fn() } as unknown as WatchRegistry);
});
afterEach(async () => {
  await stores.saveAll();
  await rm(directory, { recursive: true, force: true });
});
it("shares hidden-folder preferences with the GUI store", async () => {
  await invoke("viewer", "store_load", { file: "workspaces.json" });
  await invoke("viewer", "store_set", {
    file: "workspaces.json",
    key: "reviewHidden:/project",
    value: ["/project/extra"],
  });
  await invoke("viewer", "store_save", { file: "workspaces.json" });
  expect((await stores.open("workspaces.json")).get("reviewHidden:/project")).toEqual([
    "/project/extra",
  ]);
});
it("refuses terminal commands, file writes, journal writes and settings edits", async () => {
  for (const channel of ["spawn_shell", "write_pty", "write_file"])
    await expect(invoke("viewer", channel, {})).rejects.toThrow("The code viewer cannot invoke");
  await expect(
    invoke("viewer", "store_set", { file: "session.json", key: "window:main", value: {} }),
  ).rejects.toThrow("Unknown viewer store");
  await expect(
    invoke("viewer", "store_set", { file: "settings.json", key: "settings", value: {} }),
  ).rejects.toThrow("Unknown viewer preference");
  await expect(
    invoke("viewer", "store_set", { file: "workspaces.json", key: "recent", value: [] }),
  ).rejects.toThrow("Unknown viewer preference");
});
it("uses the existing workspace guard for helper file reads", async () => {
  const root = path.join(directory, "project");
  await mkdir(root);
  await writeFile(path.join(root, "source.ts"), "const value = 1;\n");
  await writeFile(path.join(directory, "outside.txt"), "private");
  const result = await invoke("viewer", "read_file", { root, path: path.join(root, "source.ts") });
  expect(result).toMatchObject({ kind: "ok", content: "const value = 1;\n" });
  await expect(
    invoke("viewer", "read_file", { root, path: path.join(directory, "outside.txt") }),
  ).rejects.toThrow("Path is outside the workspace");
});
