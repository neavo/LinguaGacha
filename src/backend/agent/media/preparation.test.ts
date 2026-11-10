import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({
  npm: vi.fn(),
  uv: vi.fn(),
  download: vi.fn(),
  calibrate: vi.fn(),
  installed: new Set<string>(),
  declared: "",
  models: new Set<string>(),
  cache: undefined as { device: "cpu" | "gpu" } | undefined,
}));
vi.mock("./runtime", () => ({
  MEDIA_PREPARE_LOCK_RETRY: {},
  media_configuration: () => ({ modelsDirectory: "/models", cacheDirectory: "/cache/media" }),
}));
vi.mock("../npm", () => ({ npm: { directory: "/node", run: fake.npm } }));
vi.mock("../uv", () => ({ uv: { directory: "/python", run: fake.uv } }));
vi.mock("proper-lockfile", () => ({ default: { lock: async () => async () => undefined } }));
vi.mock("../../../native/native-fs", () => ({
  default_native_fs: {
    exists: () => true,
    read_text_file: () => fake.declared,
    make_dir_async: async () => undefined,
  },
}));
vi.mock("./engine", () => ({
  ORT_PACKAGE: "onnxruntime-node",
  ORT_VERSION: "1.31.1",
  read_json: (file: string) =>
    [...fake.installed].some((name) => file.replaceAll("\\", "/").endsWith(`${name}/package.json`))
      ? { version: "1.31.1" }
      : undefined,
  inference_cache: async () => fake.cache,
  calibrate_devices: fake.calibrate,
  validate_device: () => undefined,
}));
vi.mock("./models", async (original) => ({
  ...(await original<typeof import("./models")>()),
  download_model: fake.download,
  model_ready: (_directory: string, model: { file: string }) => fake.models.has(model.file),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.installed.clear();
  fake.models.clear();
  fake.declared = "";
  fake.cache = undefined;
  fake.calibrate.mockImplementation(async () => {
    fake.cache = { device: "cpu" };
  });
  fake.npm.mockImplementation(async (args: string[]) => {
    for (const spec of args.slice(1).filter((arg) => !arg.startsWith("--")))
      fake.installed.add(spec.split("@")[0]!);
  });
  fake.uv.mockImplementation(async (args: string[]) => {
    fake.declared += args
      .slice(1)
      .map((spec) => `"${spec}"`)
      .join("\n");
  });
  fake.download.mockImplementation(
    async (_directory: string, _stats: string, model: { file: string }) => {
      fake.models.add(model.file);
    },
  );
});

it("资源齐全时仍重建缺失的推理配置", async () => {
  const { missing, setup } = await import("./preparation");
  await setup(["speech"]);
  fake.calibrate.mockClear();
  fake.cache = undefined; // 模型仍在，配置丢失需要重建。
  expect(await missing(["speech"])).toEqual({ packages: [], python: [], models: [] });
  await setup(["speech"]);
  expect(fake.calibrate).toHaveBeenCalledOnce();
});

it("prepares visualization without inference packages, weights or calibration", async () => {
  const { missing, setup } = await import("./preparation");
  const before = await missing(["visualize"]);
  expect(before.packages.some((spec) => spec.startsWith("onnxruntime-node@"))).toBe(false);
  expect(before.models).toEqual([]);
  expect(await setup(["visualize"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.calibrate).not.toHaveBeenCalled();
});

it("对白准备排除文字检测权重，追加用途时复用已完成的校准", async () => {
  const { setup } = await import("./preparation");
  expect(await setup(["speech"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.models.has(MEDIA_MODELS.det_cpu.file)).toBe(false);
  fake.cache = { device: "cpu" };
  expect(await setup(["speech", "text"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.calibrate).toHaveBeenCalledOnce();
});

it("text-only preparation uses the same speech benchmark, explicit GPU only prepares models", async () => {
  const { setup, missing } = await import("./preparation");
  fake.calibrate.mockImplementationOnce(async () => {
    fake.cache = { device: "gpu" };
  });
  await setup(["text"]);
  expect(fake.models.has(MEDIA_MODELS.det_gpu.file)).toBe(true);
  expect(fake.models.has(MEDIA_MODELS.asr_cpu.file)).toBe(true);
  expect(fake.models.has(MEDIA_MODELS.asr_gpu.file)).toBe(true);
  expect(fake.calibrate).toHaveBeenCalledOnce();
  fake.calibrate.mockClear();
  fake.cache = { device: "cpu" };
  fake.models.delete(MEDIA_MODELS.det_gpu.file);
  expect((await missing(["text"], { device: "gpu" })).models).toContain(MEDIA_MODELS.det_gpu.file);
  await setup(["text"], { device: "gpu" });
  expect(fake.models.has(MEDIA_MODELS.det_gpu.file)).toBe(true);
  expect(fake.calibrate).not.toHaveBeenCalled();
  expect(fake.cache).toEqual({ device: "cpu" });
});
