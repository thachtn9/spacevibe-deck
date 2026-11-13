import { expect, it, vi } from "vitest";
import { createCliManagerQuotaService } from "./cli-manager-quota";

it("shares concurrent reads and only calls the manager's read-only status endpoint", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ antigravity: {}, codex: {} })));
  const service = createCliManagerQuotaService(request);
  const first = service.snapshot();
  expect(service.snapshot()).toBe(first);
  await expect(first).resolves.toMatchObject({ accounts: [] });
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0][0])).toBe("http://cli-manager.localhost:1428/api/status");
  expect(request.mock.calls[0][1]?.method).toBeUndefined();
  service.close();
});

it("rejects failed reads so the renderer can mark the last quota as cached", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("offline", { status: 503 }));
  const service = createCliManagerQuotaService(request);
  await expect(service.snapshot()).rejects.toThrow("could not be reached");
  service.close();
});
