import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  created: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  ready: true,
}));
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
vi.mock("../inference/models", () => ({ model_ready: () => fake.ready }));
vi.mock("../inference/helper", () => ({
  run_helper: async (
    _executable: string,
    _script: string,
    command: string,
    _args: unknown,
    infer: NonNullable<Parameters<typeof import("../inference/helper").run_helper>[4]>,
  ) => {
    if (command === "erase" || command === "pack") return;
    if (command === "prepare") {
      await infer({ kind: "bubble" }, new Uint8Array());
      await infer({ kind: "bubble" }, new Uint8Array());
      return;
    }
  },
}));

/** 每次测试重置模块与推理路径绑定，避免静态队列状态串扰。 */
beforeEach(async () => {
  vi.resetModules();
  fake.ready = true;
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

it("单次作业多次推理 复用单 Worker，失败后关闭，erase/pack 零模型零 Worker", async () => {
  const { pixels } = await import("./engine");
  await pixels("prepare", {});
  expect(fake.request).toHaveBeenCalledTimes(2);
  expect(fake.created).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();

  fake.request.mockRejectedValueOnce(new Error("inference failed"));
  await expect(pixels("prepare", {})).rejects.toThrow("inference failed");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);

  fake.ready = false;
  await pixels("erase", {});
  await pixels("pack", {});
  expect(fake.created).toHaveBeenCalledTimes(2);
});
