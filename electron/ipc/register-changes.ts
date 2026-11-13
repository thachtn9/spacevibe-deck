import { discoverReviewRepositories, readReview, readReviewDiff, fetchReview } from "../git/review";
/**
 * The Changes list's channels. `root` travels with every call, as in
 * `register-explorer.ts`, and is checked by `readChanges` and by the watch
 * registry through the path guard before git or `fs.watch` is touched.
 */
import { ipcMain, webContents, type WebContents } from "electron";
import { CHANNELS, EVENTS } from "./channels";
import { readChanges } from "../git/changes";
import { createChangesWatchRegistry, type ChangesWatchRegistry } from "../git/changes-watch";

export interface ChangesRegistration {
  readonly watches: ChangesWatchRegistry;
}

export function registerChanges(): ChangesRegistration {
  // Keep a folder containing many repositories from spawning an unbounded Git census.
  let running = 0;
  const waiting: (() => void)[] = [];
  async function bounded<T>(work: () => Promise<T>, interactive = false): Promise<T> {
    if (running >= 2) {
      if (waiting.length >= 80) throw new Error("Git review is busy. Refresh to retry.");
      await new Promise<void>((resolve) => {
        if (interactive) waiting.unshift(resolve);
        else waiting.push(resolve);
      });
    } else running += 1;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  }
  ipcMain.handle(CHANNELS.gitReviewDiscover, (_event, { root }) =>
    bounded(() => discoverReviewRepositories(root)),
  );
  ipcMain.handle(CHANNELS.gitReviewRead, (_event, { root, target }) =>
    bounded(() => readReview(root, target)),
  );
  ipcMain.handle(CHANNELS.gitReviewDiff, (_event, { root, commit, path }) =>
    bounded(() => readReviewDiff(root, commit, path), true),
  );
  ipcMain.handle(CHANNELS.gitReviewFetch, (_event, { root, remote }) =>
    bounded(() => fetchReview(root, remote), true),
  );
  const watches = createChangesWatchRegistry({
    emit: (sender, root) => {
      const target = webContents.fromId(sender);
      if (target !== undefined && !target.isDestroyed()) {
        target.send(EVENTS.gitChanged, { root });
      }
    },
  });
  const tracked = new Set<number>();

  /** Release once per webContents when it goes away or reloads. */
  const track = (sender: WebContents): number => {
    if (!tracked.has(sender.id)) {
      tracked.add(sender.id);
      const release = () => watches.release(sender.id);
      sender.on("render-process-gone", release);
      sender.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
          release();
        }
      });
      sender.once("destroyed", () => {
        release();
        tracked.delete(sender.id);
      });
    }
    return sender.id;
  };

  // Never rejects: every failure is a typed reply for the status line.
  ipcMain.handle(CHANNELS.gitChanges, (_event, { root }) => readChanges(root));
  ipcMain.handle(CHANNELS.gitChangesWatch, (event, { root }) => {
    const id = track(event.sender);
    if (root !== null && typeof root !== "string") {
      throw new TypeError("git_changes_watch requires a string root or null");
    }
    watches.replace(id, root);
  });
  return { watches };
}
