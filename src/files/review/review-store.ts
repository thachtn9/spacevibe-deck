import { signal } from "@preact/signals";
import { Store } from "../../host/store-host";

export const sourceControlView = signal<"changes" | "files">("changes");
let store: Promise<Store> | null = null;
function preferences(): Promise<Store> {
  store ??= Store.load("workspaces.json", { autoSave: false }).catch((error: unknown) => {
    store = null;
    throw error;
  });
  return store;
}
export async function reviewTarget(root: string): Promise<string | undefined> {
  try {
    const value = await (await preferences()).get<unknown>(`reviewTarget:${root}`);
    return typeof value === "string" && value.length < 4096 ? value : undefined;
  } catch {
    return undefined;
  }
}
export async function saveReviewTarget(root: string, target: string): Promise<void> {
  const data = await preferences();
  if (data.loadState.state !== "ready")
    throw new Error("Target preference could not be saved. The workspace store is unavailable.");
  await data.set(`reviewTarget:${root}`, target);
  await data.save();
}

export async function hiddenReviewRepositories(root: string): Promise<readonly string[]> {
  const data = await preferences();
  if (data.loadState.state !== "ready")
    throw new Error("Hidden folders could not be loaded. The workspace store is unavailable.");
  const value = await data.get<unknown>(`reviewHidden:${root}`);
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === "string")
    : [];
}

let hiddenWrites: Promise<void> = Promise.resolve();
export function saveHiddenReviewRepositories(
  root: string,
  paths: readonly string[],
): Promise<void> {
  const next = hiddenWrites
    .catch(() => {})
    .then(async () => {
      const data = await preferences();
      if (data.loadState.state !== "ready")
        throw new Error("Hidden folders could not be saved. The workspace store is unavailable.");
      await data.set(`reviewHidden:${root}`, paths);
      await data.save();
    });
  hiddenWrites = next;
  return next;
}
