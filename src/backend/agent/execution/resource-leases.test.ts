import { expect, it, vi } from "vitest";
import { WorkspaceResourceLeases } from "./resource-leases";

it("取消排队的 GPU 请求后，下一条仍等持有者归还，npm 可独立取得租约", async () => {
  const leases = new WorkspaceResourceLeases();
  const signal = new AbortController().signal;
  const cancelled = new AbortController();
  const release_gpu = await leases.acquire("gpu", signal);
  const abandoned = leases.acquire("gpu", cancelled.signal);
  const acquired = vi.fn();
  const next = leases.acquire("gpu", signal).then((release) => {
    acquired();
    return release;
  });

  const release_npm = await leases.acquire("npm", signal);
  release_npm();
  cancelled.abort();
  await expect(abandoned).rejects.toBe(cancelled.signal.reason);
  expect(acquired).not.toHaveBeenCalled();

  release_gpu();
  const release_next = await next;
  release_next();
});
