import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({
  npm: vi.fn(),
  uv: vi.fn(),
  download: vi.fn(),
  installed: new Set<string>(),
  declared: "",
  models: new Set<string>(),
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
    read_text_file: (file: string) => {
      if (!file.endsWith("package.json")) return fake.declared;
      if (
        [...fake.installed].some((name) =>
          file.replaceAll("\\", "/").endsWith(`${name}/package.json`),
        )
      )
        return JSON.stringify({ version: "1.31.1" });
      throw Object.assign(new Error("not installed"), { code: "ENOENT" });
    },
    make_dir_async: async () => undefined,
  },
}));
vi.mock("./engine", () => ({
  ORT_PACKAGE: "onnxruntime-node",
  ORT_VERSION: "1.31.1",
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

it("prepares all models and components, rechecking existing models without reinstalling packages", async () => {
  const { missing, setup } = await import("./preparation");
  expect((await missing()).models).toEqual(Object.values(MEDIA_MODELS).map((model) => model.file));
  expect(await setup()).toEqual({ packages: [], python: [], models: [] });
  expect(fake.models).toEqual(new Set(Object.values(MEDIA_MODELS).map((model) => model.file)));
  fake.npm.mockClear();
  fake.uv.mockClear();
  fake.download.mockClear();
  await setup();
  expect(fake.npm).not.toHaveBeenCalled();
  expect(fake.uv).not.toHaveBeenCalled();
  expect(fake.download).toHaveBeenCalledTimes(Object.keys(MEDIA_MODELS).length);
});

it("surfaces preparation failures and can resume using already prepared resources", async () => {
  const { missing, setup } = await import("./preparation");
  fake.download.mockImplementationOnce(async (_directory, _stats, model) => {
    fake.models.add(model.file);
  });
  fake.download.mockRejectedValueOnce(new Error("download interrupted"));
  await expect(setup()).rejects.toThrow("download interrupted");
  expect((await missing()).models.length).toBe(Object.keys(MEDIA_MODELS).length - 1);
  expect(await setup()).toEqual({ packages: [], python: [], models: [] });
});
