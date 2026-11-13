import { app, dialog } from "electron";
import { listDir, readFile, statFiles } from "./fs/read";
import { discoverReviewRepositories, readReview, readReviewDiff, fetchReview } from "./git/review";
import { listThemes } from "./themes";
import type { StoreRegistry } from "./store";
import type { WatchRegistry } from "./fs/watch";

/** Helpers share the GUI's existing stores and filesystem guards, never a second journal. */
export function codeViewerServices(stores: StoreRegistry, watchers: WatchRegistry) {
  let gitRunning = 0;
  const waiting: (() => void)[] = [];
  async function bounded<T>(work: () => Promise<T>): Promise<T> {
    if (gitRunning >= 2) {
      if (waiting.length >= 80) throw new Error("Git review is busy. Refresh to retry.");
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else gitRunning++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else gitRunning--;
    }
  }
  return async (
    label: string,
    channel: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> => {
    const { root, path, directory, target, commit, remote } = payload;
    switch (channel) {
      case "desktop_environment":
        return { platform: "linux", homeDir: app.getPath("home"), isDevelopment: !app.isPackaged };
      case "list_dir":
        if (typeof root !== "string" || typeof directory !== "string")
          throw new Error("Invalid directory request");
        return listDir(root, directory);
      case "read_file":
        if (typeof root !== "string" || typeof path !== "string")
          throw new Error("Invalid file request");
        return readFile(root, path);
      case "stat_files":
        if (typeof root !== "string") throw new Error("Invalid workspace root");
        if (
          !Array.isArray(payload.paths) ||
          !payload.paths.every((path) => typeof path === "string")
        )
          throw new Error("Invalid file list");
        return statFiles(root, payload.paths as string[]);
      case "watch_paths":
        watchers.replace(label, payload as unknown as Parameters<WatchRegistry["replace"]>[1]);
        return;
      case "git_review_discover":
        return bounded(() => discoverReviewRepositories(root));
      case "git_review_read":
        return bounded(() => readReview(root, target));
      case "git_review_diff":
        return bounded(() => readReviewDiff(root, commit, path));
      case "git_review_fetch":
        return bounded(() => fetchReview(root, remote));
      case "themes_list":
        return listThemes();
      case "dialog_open": {
        const result = await dialog.showOpenDialog({
          title: "Choose a folder to view code",
          properties: ["openDirectory"],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }
      case "store_load":
      case "store_get":
      case "store_set":
      case "store_save": {
        const file = payload.file;
        if (file !== "settings.json" && file !== "workspaces.json")
          throw new Error("Unknown viewer store");
        const store = await stores.open(file);
        if (channel === "store_load") return store.loadState;
        if (channel === "store_save") {
          if (file !== "workspaces.json") throw new Error("Viewer settings are read only");
          return store.save();
        }
        const key = payload.key;
        if (typeof key !== "string") throw new Error("Invalid viewer preference");
        if (channel === "store_get") return store.get(key);
        if (file !== "workspaces.json" || !/^(reviewTarget:|reviewHidden:)/.test(key))
          throw new Error("Unknown viewer preference");
        store.set(key, payload.value);
        return;
      }
      default:
        throw new Error(`The code viewer cannot invoke ${channel}`);
    }
  };
}
