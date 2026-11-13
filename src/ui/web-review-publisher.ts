import { effect } from "@preact/signals";
import { webReviewHost } from "../host/web-review-host";
import { tabViews } from "../terminal/tabs-store";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import type { TabManager } from "../terminal/tab-manager-types";

export function installWebReviewPublisher(manager: () => TabManager | null): () => void {
  if (!webReviewHost.available) return () => {};
  const clientId = crypto.randomUUID();
  let stopped = false,
    publishing = false,
    again = false,
    unlisten: (() => void) | undefined;
  const publish = async () => {
    if (stopped) return;
    if (publishing) {
      again = true;
      return;
    }
    publishing = true;
    try {
      await webReviewHost.publish(
        clientId,
        manager()?.webReviewTargets?.(clientId) ?? [],
        resolveTheme(settings.value),
      );
    } catch (error) {
      console.warn("Web Review session update failed", error);
    } finally {
      publishing = false;
      if (again) {
        again = false;
        void publish();
      }
    }
  };
  void webReviewHost
    .onDelivery((request) => {
      if (stopped) return;
      void (async () => {
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
  const timer = setInterval(() => void publish(), 2500);
  return () => {
    stopped = true;
    stopEffect();
    clearInterval(timer);
    unlisten?.();
    void webReviewHost.forget(clientId).catch(() => {});
  };
}
