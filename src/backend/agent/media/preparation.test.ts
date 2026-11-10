import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  npm: vi.fn(),
  uv: vi.fn(),
  download: vi.fn(),
  calibrate: vi.fn(),
  probe: vi.fn(),
  installed: new Set<string>(),
  declared: "",
  models: new Set<string>(),
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
  media_directories: () => ({ models: "/models", runtime: "/runtime" }),
  read_json: (file: string) =>
    [...fake.installed].some((name) => file.replaceAll("\\", "/").endsWith(`${name}/package.json`))
      ? { version: "1.31.1" }
      : undefined,
  inference_cache: async () => undefined,
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

it("prepares speech without detector weights and calibrates only the added task later", async () => {
  const { setup } = await import("./preparation");
  expect(await setup(["speech"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.models.has("ppocr/v6/PP-OCRv6_det_small.onnx")).toBe(false);
  expect(await setup(["text"])).toEqual({ packages: [], python: [], models: [] });
  expect(fake.probe.mock.calls).toEqual([["asr"], ["det"]]);
  expect(fake.calibrate.mock.calls.map((call) => call[0])).toEqual([["asr"], ["det"]]);
});
