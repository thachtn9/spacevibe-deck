import { invoke } from "../host/bridge";
import { getDesktopEnvironment } from "../lib/platform";
import { restoreLegacyCodexMouseEncoding } from "../lib/terminal-mouse-state";
import type {
  PersistentTerminalMetadata,
  PersistentTerminalSnapshot,
} from "../lib/persistent-terminal";

const references = new Map<number, string>();
const remembered = new Map<number, string>();
export function persistentTerminalsAvailable(): boolean {
  return getDesktopEnvironment().platform === "linux" && "__deckHost" in globalThis;
}
export const persistentTerminal = {
  reference(id: number): string | undefined {
    return references.get(id);
  },
  async register(id: number): Promise<void> {
    if (!persistentTerminalsAvailable()) return;
    const reference = await invoke<string>("pty_persistent", { action: "reference", id });
    remembered.delete(id);
    references.set(id, reference);
  },
  async attach(reference: string): Promise<PersistentTerminalSnapshot | null> {
    const result = await invoke<PersistentTerminalSnapshot | null>("pty_persistent", {
      action: "attach",
      reference,
    });
    if (result) references.set(result.id, reference);
    return result
      ? { ...result, screen: restoreLegacyCodexMouseEncoding(result.screen, result.metadata.agent) }
      : null;
  },
  async prepareLaunch(
    id: number,
    command: string | null,
    accountSwitch = false,
  ): Promise<string | null> {
    if (command === null || !references.has(id)) return command;
    return invoke("pty_persistent", {
      action: accountSwitch ? "prepareAccountSwitch" : "prepareLaunch",
      id,
      command,
    });
  },
  async ready(id: number): Promise<void> {
    await invoke("pty_persistent", { action: "ready", id });
  },
  async detach(id: number): Promise<void> {
    await invoke("pty_persistent", { action: "detach", id });
    references.delete(id);
    remembered.delete(id);
  },
  async recovery(): Promise<Record<string, PersistentTerminalMetadata>> {
    return invoke("pty_persistent", { action: "recovery" });
  },
  remember(id: number, metadata: PersistentTerminalMetadata): void {
    if (!references.has(id)) return;
    const value = JSON.stringify(metadata);
    if (remembered.get(id) === value) return;
    remembered.set(id, value);
    void invoke("pty_persistent", { action: "metadata", id, metadata }).catch((error) => {
      remembered.delete(id);
      console.warn("Could not save terminal recovery metadata", error);
    });
  },
};
