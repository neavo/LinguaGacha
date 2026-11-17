import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

it("两个推理领域共用 GPU 收尾队列，CPU 操作可继续", async () => {
  const { run_inference_operation, close_inference } = await import("./runtime");
  const closing = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const order: string[] = [];
  const media = run_inference_operation("gpu", async () => {
    order.push("media");
    await close_inference({
      close: () => {
        entered.resolve();
        return closing.promise;
      },
    });
  });
  await entered.promise;
  const image = run_inference_operation("gpu", async () => {
    order.push("image");
  });
  await run_inference_operation("cpu", async () => {
    order.push("cpu");
  });
  expect(order).toEqual(["media", "cpu"]);
  closing.resolve();
  await Promise.all([media, image]);
  expect(order).toEqual(["media", "cpu", "image"]);
});

it("关闭失败同时拒绝排队和后续资源创建", async () => {
  const { run_inference_operation, close_inference } = await import("./runtime");
  const cause = new Error("worker did not exit");
  const first = run_inference_operation("gpu", () =>
    close_inference({
      close: async () => {
        throw cause;
      },
    }),
  );
  const next = vi.fn(async () => undefined);
  const results = await Promise.allSettled([first, run_inference_operation("gpu", next)]);
  expect(results).toEqual([
    { status: "rejected", reason: expect.objectContaining({ cause }) },
    { status: "rejected", reason: expect.objectContaining({ cause }) },
  ]);
  await expect(run_inference_operation("cpu", next)).rejects.toMatchObject({ cause });
  expect(next).not.toHaveBeenCalled();
});
