import { activeReviewTarget, reviewCandidates } from "./web-review-active";
import { effect } from "@preact/signals";
import { webReviewHost } from "../host/web-review-host";
import { tabViews } from "../terminal/tabs-store";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import type { TabManager } from "../terminal/tab-manager-types";

export let refreshWebReviewSessions: (() => Promise<void>) | undefined;

export function installWebReviewPublisher(manager: () => TabManager | null): () => void {
  if (!webReviewHost.available) return () => {};
  const clientId = crypto.randomUUID();
  let stopped = false,
    publishing: Promise<void> | null = null,
    again = false,
    unlisten: (() => void) | undefined,
    unlistenActive: (() => void) | undefined;
  const publish = (): Promise<void> => {
    again = true;
    if (publishing) return publishing;
    publishing = (async () => {
      while (again && !stopped) {
        again = false;
        try {
          const rows = manager()?.webReviewTargets?.(clientId) ?? [];
          reviewCandidates.value = rows;
          await webReviewHost.publish(clientId, rows, resolveTheme(settings.value));
        } catch (error) {
          console.warn("Web Review session update failed", error);
        }
      }
    })().finally(() => {
      publishing = null;
    });
    return publishing;
  };
  void webReviewHost
    .onActive((target) => {
      if (!stopped) activeReviewTarget.value = target;
    })
    .then((stop) => {
      if (stopped) stop();
      else unlistenActive = stop;
    })
    .catch(console.warn);
  void webReviewHost
    .active()
    .then((target) => {
      if (!stopped) activeReviewTarget.value = target;
    })
    .catch(console.warn);
  void webReviewHost
    .onDelivery((request) => {
      if (stopped) return;
      void (async () => {
        await manager()?.refreshWebReviewTargets?.();
        await publish();
        const outcome =
          (await manager()?.deliverWebReview?.(request.target, request.attemptId, clientId)) ??
          "target-changed";
        await webReviewHost.result(request.attemptId, outcome);
        void publish();
      })().catch((error) => console.warn("Web Review delivery could not be confirmed", error));
    })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(console.warn);
  const stopEffect = effect(() => {
    void tabViews.value;
    void settings.value;
    void publish();
  });
  refreshWebReviewSessions = async () => {
    await manager()?.refreshWebReviewTargets?.();
    await publish();
  };
  const timer = setInterval(() => void publish(), 2500);
  return () => {
    stopped = true;
    refreshWebReviewSessions = undefined;
    stopEffect();
    clearInterval(timer);
    unlisten?.();
    unlistenActive?.();
    reviewCandidates.value = [];
    void webReviewHost.forget(clientId).catch(() => {});
  };
}
