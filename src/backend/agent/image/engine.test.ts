import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  created: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  modelExists: true,
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
vi.mock("../inference/models", () => ({ model_exists: () => fake.modelExists }));
vi.mock("../inference/helper", () => ({
  run_helper: async (
    _executable: string,
    _script: URL,
    command: string,
    _args: Record<string, unknown>,
    infer: NonNullable<Parameters<typeof import("../inference/helper").run_helper>[4]>,
  ) => {
    if (command === "text_output") return null;
    if (command === "scan") {
      await infer({ kind: "bubble" }, new Uint8Array());
      await infer({ kind: "detection" }, new Uint8Array());
      await infer({ kind: "recognition" }, new Uint8Array());
      return { pages: [] };
    }
  },
}));

const page_spec = {
  pageId: "page",
  relativePath: "page.png",
  original: "originals/page.png",
  sha256: "a".repeat(64),
  width: 1,
  height: 1,
  orientation: 1,
  source: "source.png",
};
const script = new URL("file:///fixture/helper.py");
const scan_request = { pages: [page_spec], output: "output" };

/** 每次测试重置模块与推理路径绑定，避免静态队列状态串扰。 */
beforeEach(async () => {
  vi.resetModules();
  fake.modelExists = true;
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

it("单次图片识别复用一个 Worker，失败后关闭，纯像素命令不启动模型", async () => {
  const { pixels } = await import("./engine");
  await pixels(script, "scan", scan_request);
  expect(fake.request).toHaveBeenCalledTimes(3);
  expect(fake.created).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();

  fake.request.mockRejectedValueOnce(new Error("inference failed"));
  await expect(pixels(script, "scan", scan_request)).rejects.toThrow("inference failed");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);

  fake.modelExists = false;
  await pixels(script, "text_output", {
    root: "root",
    original: "source.png",
    qa: { path: "out.webp", maxEdge: 128, marks: [] },
  });
  expect(fake.created).toHaveBeenCalledTimes(2);
  fake.modelExists = true;
  await pixels(script, "scan", scan_request);
  expect(fake.created).toHaveBeenCalledTimes(3);
  expect(fake.close).toHaveBeenCalledTimes(3);
});
