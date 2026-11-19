import { signal } from "@preact/signals";
import { afterEach, expect, it, vi } from "vitest";
import type { TabManager } from "../terminal/tab-manager-types";
import { installWebReviewPublisher } from "./web-review-publisher";

const host = vi.hoisted(() => ({
  available: true,
  publish: vi.fn(),
  active: vi.fn(async () => null),
  onActive: vi.fn(async () => () => {}),
  onDelivery: vi.fn(async (_callback: (request: any) => void) => () => {}),
  result: vi.fn(async () => {}),
  forget: vi.fn(async () => {}),
}));
vi.mock("../host/web-review-host", () => ({ webReviewHost: host }));
vi.mock("../terminal/tabs-store", () => ({ tabViews: signal([]) }));
vi.mock("../settings/settings-store", () => ({ settings: signal({}) }));
vi.mock("../settings/themes", () => ({ resolveTheme: () => ({}) }));
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.clearAllMocks();
});

it("waits for fresh publication behind an in-flight update before delivery", async () => {
  let releaseFirst!: () => void;
  let releaseFresh!: () => void;
  host.publish
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          releaseFirst = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          releaseFresh = r;
        }),
    )
    .mockResolvedValue(undefined);
  const deliver = vi.fn(async () => "sent");
  const manager = {
    webReviewTargets: () => [],
    refreshWebReviewTargets: async () => {},
    deliverWebReview: deliver,
  } as unknown as TabManager;
  stop = installWebReviewPublisher(() => manager);
  await vi.waitFor(() => expect(host.publish).toHaveBeenCalledTimes(1));
  host.onDelivery.mock.calls[0][0]({ target: {}, attemptId: "attempt" });
  await Promise.resolve();
  expect(deliver).not.toHaveBeenCalled();
  releaseFirst();
  await vi.waitFor(() => expect(host.publish).toHaveBeenCalledTimes(2));
  expect(deliver).not.toHaveBeenCalled();
  releaseFresh();
  await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
});
