import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ download: vi.fn(), models: new Set<string>() }));
vi.mock("./runtime", () => ({
  MEDIA_PREPARE_LOCK_RETRY: {},
  media_configuration: () => ({ modelsDirectory: "/models", cacheDirectory: "/cache/media" }),
}));
vi.mock("proper-lockfile", () => ({ default: { lock: async () => async () => undefined } }));
vi.mock("../../../native/native-fs", () => ({
  default_native_fs: { make_dir_async: async () => undefined },
}));
vi.mock("./models", async (original) => ({
  ...(await original<typeof import("./models")>()),
  download_model: fake.download,
  model_ready: (_directory: string, model: { file: string }) => fake.models.has(model.file),
}));

const ALL = Object.values(MEDIA_MODELS).map((model) => model.file);

beforeEach(() => {
  vi.clearAllMocks();
  fake.models.clear();
  fake.download.mockImplementation(
    async (_directory: string, _stats: string, model: { file: string }) => {
      fake.models.add(model.file);
    },
  );
});

it("准备并逐个复查全部模型，中断后续传已完成的资源", async () => {
  const { missing_models, prepare_models } = await import("./preparation");
  expect(await missing_models()).toEqual(ALL);
  fake.download.mockImplementationOnce(async (_directory, _stats, model) => {
    fake.models.add(model.file);
  });
  fake.download.mockRejectedValueOnce(new Error("download interrupted"));
  await expect(prepare_models()).rejects.toThrow("download interrupted");
  expect(await missing_models()).toHaveLength(ALL.length - 1);
  expect(await prepare_models()).toEqual([]);
  fake.download.mockClear();
  expect(await prepare_models()).toEqual([]);
  expect(fake.download).toHaveBeenCalledTimes(ALL.length); // 已有模型仍逐个校验
});

it("计算前只要求本次消费的模型", async () => {
  const { require_models } = await import("./preparation");
  fake.models.add(MEDIA_MODELS.det_cpu.file);
  expect(() => require_models(["det_cpu"])).not.toThrow();
  expect(() => require_models(["det_cpu", "det_gpu"])).toThrow(
    `Media models are missing (${MEDIA_MODELS.det_gpu.file}); call prepare_models() first.`,
  );
});
