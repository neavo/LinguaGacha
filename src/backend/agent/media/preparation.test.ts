import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({
  npm: vi.fn(),
  uv: vi.fn(),
  download: vi.fn(),
  calibrate: vi.fn(),
  probe: vi.fn(),
  installed: new Set<string>(),
  declared: "",
  models: new Set<string>(),
  cache: undefined as { asr: "cpu"; complete: string[] } | undefined,
}));
vi.mock("./runtime", () => ({
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
  probe_gpu: fake.probe,
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
  expect(await missing(["speech"])).toEqual({ packages: [], python: [], models: [] });
  await setup(["speech"]);
  expect(fake.calibrate).toHaveBeenCalledOnce();
});

it("prepares visualization without inference packages, weights or calibration", async () => {
  const { missing, setup } = await import("./preparation");
  const before = await missing(["visualize"]);
  expect(before.packages).toHaveLength(1);
  expect(before.python).toEqual(
    expect.arrayContaining([expect.stringContaining("numpy"), expect.stringContaining("opencv")]),
  );
  expect(before.models).toEqual([]);
  expect(await setup(["visualize"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.probe).not.toHaveBeenCalled();
  expect(fake.calibrate).not.toHaveBeenCalled();
});

it("对白准备排除文字检测权重，追加用途时复用已完成的校准", async () => {
  const { setup } = await import("./preparation");
  expect(await setup(["speech"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.models.has(MEDIA_MODELS.det_cpu.file)).toBe(false);
  fake.cache = { asr: "cpu", complete: ["asr"] };
  expect(await setup(["speech", "text"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.probe.mock.calls).toEqual([["asr"], ["det"]]);
  expect(fake.calibrate.mock.calls.map((call) => call[0])).toEqual([["asr"], ["det"]]);
});
