import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  created: vi.fn(),
  cache: "",
  measure: vi.fn(),
}));
vi.mock("./inference-engine", async (original) => {
  const actual = await original<typeof import("./inference-engine")>();
  return {
    ...actual,
    Engine: class {
      failed = false;
      constructor(profile: unknown) {
        fake.created(profile);
      }
      close = fake.close;
    },
  };
});
vi.mock("./calibration", async (original) => ({
  ...(await original<typeof import("./calibration")>()),
  run_calibration: fake.measure,
}));
vi.mock("../npm", () => ({ npm: { directory: "/shared/node" } }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/shared/node/node_modules/onnxruntime-node/index.js" }),
}));
vi.mock("../../../native/native-fs", () => ({
  default_native_fs: {
    ensure_parent_dir: () => undefined,
    write_file_atomic: (_file: string, text: string) => {
      fake.cache = text;
    },
    read_text_file: () => {
      if (fake.cache) return fake.cache;
      throw Object.assign(new Error("not cached"), { code: "ENOENT" });
    },
  },
}));

beforeEach(async () => {
  vi.resetModules();
  const { bind_media } = await import("./runtime");
  bind_media({
    modelsDirectory: "/models",
    cacheDirectory: "/cache/media",
    runtimeDirectory: "/runtime",
  });
  fake.cache = "";
  fake.measure.mockReset().mockResolvedValue({
    timings: [
      [1, 1, 1],
      [1, 1, 1],
    ],
    prepare: 1,
    close: 1,
  });
  fake.created.mockClear();
  fake.close.mockReset().mockResolvedValue(undefined);
});

it("discards the failed GPU operation and reruns the entire action exactly once", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("lost", "det"))
    .mockResolvedValueOnce("complete");
  await expect(operate(action)).resolves.toBe("complete");
  expect(action).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);
  expect(fake.created.mock.calls.at(-1)).toEqual([{ asr: "cpu", det: "cpu" }]);
});

it("does not start a CPU rerun or another operation after unconfirmed shutdown", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  fake.close.mockRejectedValue(new Error("shutdown timed out"));
  const action = vi.fn().mockRejectedValue(new DeviceFailure("lost", "asr"));
  await expect(operate(action)).rejects.toThrow("shutdown timed out");
  await expect(operate(action)).rejects.toThrow("shutdown timed out");
  expect(action).toHaveBeenCalledTimes(1);
  expect(fake.created).toHaveBeenCalledTimes(1);
});

it("preserves the original failure when the one allowed CPU rerun also fails", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const cpu = new Error("CPU failed");
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("device lost", "det"))
    .mockRejectedValueOnce(cpu);
  await expect(operate(action)).rejects.toMatchObject({
    message: expect.stringContaining("device lost"),
    cause: cpu,
  });
  expect(action).toHaveBeenCalledTimes(2);
});

it("retains partial calibration and measures the mixed profile only when both tasks are ready", async () => {
  const { calibrate_devices, inference_cache, probe_gpu } = await import("./engine");
  await probe_gpu("asr");
  expect(fake.measure.mock.calls.at(-1)?.[1].config.models.asr.file).toMatch(
    /sensevoice.model_quant/u,
  );
  fake.measure.mockClear();
  await calibrate_devices(["asr"], new Set(), {});
  expect((await inference_cache())?.det).toBeUndefined();
  expect((await inference_cache())?.complete).toEqual(["asr"]);
  expect(fake.measure.mock.calls.map((call) => call[1].task)).toEqual(["asr", "asr"]);
  fake.measure.mockClear();
  await calibrate_devices(["det"], new Set(), {});
  expect(fake.measure.mock.calls.map((call) => call[1].task)).toEqual(["det", "det", "mixed"]);
  expect((await inference_cache())?.complete).toEqual(["asr", "det"]);
  fake.measure.mockClear();
  await calibrate_devices(["det"], new Set(), {});
  expect(fake.measure.mock.calls.map((call) => call[1].task)).toEqual(["det", "det"]);
});
