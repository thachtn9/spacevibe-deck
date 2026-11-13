import { batch, signal } from "@preact/signals";
import { invoke } from "../host/bridge";
import type { CliQuotaSnapshot } from "../lib/cli-manager-quota";

export const cliQuotaAvailable = (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
export const cliQuota = signal<CliQuotaSnapshot | null>(null);
export const cliQuotaLoading = signal(false);
export const cliQuotaError = signal(false);
let observers = 0;
let stop: (() => void) | null = null;
let refresh: (() => Promise<void>) | null = null;

export function refreshCliQuota(): Promise<void> {
  return refresh?.() ?? Promise.resolve();
}

/** Rail and dock share one read, polling loop and focus listener per window. */
export function observeCliQuota(): () => void {
  if (!cliQuotaAvailable) return () => undefined;
  observers += 1;
  if (observers === 1) {
    let disposed = false;
    let pending = false;
    refresh = async () => {
      if (pending || disposed) return;
      pending = true;
      cliQuotaLoading.value = true;
      try {
        const snapshot = await invoke<CliQuotaSnapshot>("cli_manager_quota");
        if (!disposed)
          batch(() => {
            cliQuota.value = snapshot;
            cliQuotaError.value = false;
          });
      } catch {
        if (!disposed) cliQuotaError.value = true;
      } finally {
        pending = false;
        if (!disposed) cliQuotaLoading.value = false;
      }
    };
    const focus = () => {
      void refreshCliQuota();
    };
    const timer = setInterval(focus, 30_000);
    window.addEventListener("focus", focus);
    stop = () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      refresh = null;
      cliQuotaLoading.value = false;
    };
    focus();
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    observers -= 1;
    if (!observers) {
      stop?.();
      stop = null;
    }
  };
}
