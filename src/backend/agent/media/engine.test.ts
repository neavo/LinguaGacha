import { beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ close: vi.fn(), created: vi.fn() }));
vi.mock("../workspace/runtime/request-channel", () => ({
  acquire_workspace_resource: async () => async () => {},
}));
vi.mock("./inference-engine", () => ({
  Engine: class {
    constructor(config: import("./worker-protocol").MediaWorkerConfig) {
      fake.created(config.models);
    }
    close = fake.close;
  },
}));
vi.mock("../npm", () => ({ npm: { directory: "/shared/node" } }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/shared/node/node_modules/onnxruntime-node/index.js" }),
}));

beforeEach(async () => {
  vi.resetModules();
  const { bind_inference } = await import("../inference/runtime");
  bind_inference({
    modelsDirectory: "/models",
    cacheDirectory: "/cache/media",
    runtimeDirectory: "/runtime",
  });
  fake.created.mockClear();
  fake.close.mockReset().mockResolvedValue(undefined);
});

it("returns GPU failure only after closing and lets the caller explicitly retry on CPU", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("../inference/client");
  const failure = new DeviceFailure("lost");
  const action = vi.fn().mockRejectedValue(failure);
  await expect(operate(action, { device: "gpu" })).rejects.toBe(failure);
  expect(action).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();
  await expect(operate(async () => "complete", { device: "cpu" })).resolves.toBe("complete");
  expect(fake.created.mock.calls.map(([models]) => [models.asr.device, models.asr.file])).toEqual([
    ["webgpu", path.join("/models", MEDIA_MODELS.asr_gpu.file)],
    ["cpu", path.join("/models", MEDIA_MODELS.asr_cpu.file)],
  ]);
  expect(
    fake.created.mock.calls.map(([models]) => [
      models.detection.device,
      models.detection.file,
      models.recognition.device,
      models.recognition.file,
    ]),
  ).toEqual([
    [
      "webgpu",
      path.join("/models", MEDIA_MODELS.detection.file),
      "webgpu",
      path.join("/models", MEDIA_MODELS.recognition.file),
    ],
    [
      "cpu",
      path.join("/models", MEDIA_MODELS.detection.file),
      "cpu",
      path.join("/models", MEDIA_MODELS.recognition.file),
    ],
  ]);
});

it("unconfirmed shutdown takes precedence over a retryable device failure", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("../inference/client");
  const closeFailure = new DeviceFailure("shutdown timed out");
  fake.close.mockRejectedValue(closeFailure);
  const failed = operate(
    async () => {
      throw new DeviceFailure("lost");
    },
    { device: "gpu" },
  );
  const error = await failed.catch((error: unknown) => error);
  expect(error).not.toBeInstanceOf(DeviceFailure);
  expect(error).toMatchObject({ cause: closeFailure });
});
