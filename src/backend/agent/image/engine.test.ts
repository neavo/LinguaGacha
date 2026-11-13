import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ created: vi.fn(), close: vi.fn(), request: vi.fn() })); // 推理客户端调用计数替身。
vi.mock("../inference/client", () => ({
  InferenceClient: class {
    constructor() {
      fake.created();
    }
    request = fake.request;
    close = fake.close;
  },
}));
vi.mock("../inference/environment", () => ({ ort_entry: () => "ort", python: () => "python" }));
vi.mock("../inference/models", () => ({ model_ready: () => true }));
vi.mock("../inference/helper", () => ({
  run_helper: async (
    _executable: string,
    _script: string,
    command: string,
    _args: unknown,
    infer: NonNullable<Parameters<typeof import("../inference/helper").run_helper>[4]>,
  ) => {
    if (command === "layout") return;
    await infer({ kind: "inpaint" }, new Uint8Array());
    await infer({ kind: "inpaint" }, new Uint8Array());
  },
}));
/** 每次测试重置模块与推理路径绑定，避免静态队列状态串扰。 */
beforeEach(async () => {
  vi.resetModules();
  fake.created.mockClear();
  fake.request.mockReset().mockResolvedValue({ header: {} });
  fake.close.mockReset().mockResolvedValue(undefined);
  const { bind_inference } = await import("../inference/runtime");
  bind_inference({
    modelsDirectory: "/models",
    cacheDirectory: "/cache",
    runtimeDirectory: "/runtime",
  });
});
it("单次像素作业复用 Worker，失败后关闭，纯排版无需创建推理资源", async () => {
  const { pixels } = await import("./engine");
  await pixels("repair", {});
  expect(fake.request).toHaveBeenCalledTimes(2);
  expect(fake.created).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();
  fake.request.mockRejectedValueOnce(new Error("inference failed"));
  await expect(pixels("repair", {})).rejects.toThrow("inference failed");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);
  await pixels("layout", {});
  expect(fake.created).toHaveBeenCalledTimes(2);
});
