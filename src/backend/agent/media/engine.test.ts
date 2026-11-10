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
      constructor(config: import("./worker-protocol").MediaWorkerConfig) {
        fake.created({ asr: config.models.asr.device, det: config.models.det.device });
      }
      close = fake.close;
    },
  };
});
vi.mock("./calibration", async (original) => ({
  ...(await original<typeof import("./calibration")>()),
  run_calibration: fake.measure,
}));
vi.mock("./models", async (original) => ({
  ...(await original<typeof import("./models")>()),
  model_ready: () => true,
}));
vi.mock("proper-lockfile", () => ({ default: { lock: async () => async () => undefined } }));
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
    inference: 1,
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
    .mockRejectedValueOnce(new DeviceFailure("lost"))
    .mockResolvedValueOnce("complete");
  await expect(operate(action, "asr", { device: "gpu" })).resolves.toEqual({
    result: "complete",
    execution: { requested: "gpu", actual: "cpu", fallback_reason: "lost" },
  });
  expect(action).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);
  expect(fake.created.mock.calls.at(-1)).toEqual([{ asr: "cpu", det: "cpu" }]);
});

it("does not start a CPU rerun or another operation after unconfirmed shutdown", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  fake.close.mockRejectedValue(new Error("shutdown timed out"));
  const action = vi.fn().mockRejectedValue(new DeviceFailure("lost"));
  await expect(operate(action, "asr", { device: "gpu" })).rejects.toThrow("shutdown timed out");
  await expect(operate(action, "asr", { device: "gpu" })).rejects.toThrow("shutdown timed out");
  expect(action).toHaveBeenCalledTimes(1);
  expect(fake.created).toHaveBeenCalledTimes(1);
});

it("preserves the original failure when the one allowed CPU rerun also fails", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const cpu = new Error("CPU failed");
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("device lost"))
    .mockRejectedValueOnce(cpu);
  await expect(operate(action, "asr", { device: "gpu" })).rejects.toMatchObject({
    message: expect.stringContaining("device lost"),
    cause: cpu,
  });
  expect(action).toHaveBeenCalledTimes(2);
});

it("measures CPU and GPU once and reuses the result for both tasks", async () => {
  const { calibrate_devices, inference_cache } = await import("./engine");
  fake.measure
    .mockResolvedValueOnce({ inference: 100, prepare: 1, close: 1 })
    .mockResolvedValueOnce({ inference: 70, prepare: 1, close: 1 });
  await calibrate_devices();
  expect(fake.measure).toHaveBeenCalledTimes(2);
  expect(
    fake.measure.mock.calls.map((call) => ({
      asr: call[1].config.models.asr.device,
      det: call[1].config.models.det.device,
    })),
  ).toEqual([
    { asr: "cpu", det: "cpu" },
    { asr: "webgpu", det: "webgpu" },
  ]);
  expect((await inference_cache())?.device).toBe("gpu");
});

it("isolates concurrent device overrides and leaves automatic selection unchanged", async () => {
  const { operate, calibrate_devices, inference_cache } = await import("./engine");
  await calibrate_devices();
  const before = await inference_cache();
  const results = await Promise.all([
    operate(async () => "audio", "asr", { device: "gpu" }),
    operate(async () => "text", "det", { device: "cpu" }),
  ]);
  expect(results.map((value) => value.execution.actual)).toEqual(["gpu", "cpu"]);
  expect(fake.created.mock.calls).toEqual([
    [{ asr: "webgpu", det: "webgpu" }],
    [{ asr: "cpu", det: "cpu" }],
  ]);
  expect(await inference_cache()).toEqual(before);
});

it("remembers an automatic GPU failure but permits an explicit retry", async () => {
  const { calibrate_devices, operate, inference_cache } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  fake.measure
    .mockResolvedValueOnce({ inference: 100, prepare: 1, close: 1 })
    .mockResolvedValueOnce({ inference: 50, prepare: 1, close: 1 });
  await calibrate_devices();
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("lost"))
    .mockResolvedValueOnce("ok");
  expect((await operate(action, "det")).execution).toEqual({
    requested: "auto",
    actual: "cpu",
    fallback_reason: "lost",
  });
  expect((await inference_cache())?.device).toBe("cpu");
  expect((await operate(async () => "retry", "det", { device: "gpu" })).execution.actual).toBe(
    "gpu",
  );
  expect((await inference_cache())?.device).toBe("cpu");
});
