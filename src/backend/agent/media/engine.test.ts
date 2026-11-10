import { beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ close: vi.fn(), created: vi.fn() }));
vi.mock("./inference-engine", async (original) => ({
  ...(await original<typeof import("./inference-engine")>()),
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
  const { bind_media } = await import("./runtime");
  bind_media({
    modelsDirectory: "/models",
    cacheDirectory: "/cache/media",
    runtimeDirectory: "/runtime",
  });
  fake.created.mockClear();
  fake.close.mockReset().mockResolvedValue(undefined);
});

it("returns GPU failure only after closing and lets the caller explicitly retry on CPU", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
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
});

it("unconfirmed shutdown overrides device failure and prevents further operations", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const closeFailure = new DeviceFailure("shutdown timed out");
  fake.close.mockRejectedValue(closeFailure);
  const action = vi.fn().mockRejectedValue(new DeviceFailure("lost"));
  const error = await operate(action, { device: "gpu" }).catch((error: unknown) => error);
  expect(error).not.toBeInstanceOf(DeviceFailure);
  expect(error).toMatchObject({ cause: closeFailure });
  await expect(operate(action, { device: "cpu" })).rejects.toBe(error);
  expect(action).toHaveBeenCalledOnce();
});

it("rejects omitted or invalid devices before creating resources and isolates parallel choices", async () => {
  const { operate } = await import("./engine");
  for (const device of [undefined, "auto", "cuda"])
    await expect(operate(async () => undefined, { device } as never)).rejects.toThrow("cpu or gpu");
  expect(fake.created).not.toHaveBeenCalled();
  expect(
    await Promise.all([
      operate(async () => "audio", { device: "gpu" }),
      operate(async () => "text", { device: "cpu" }),
    ]),
  ).toEqual(["audio", "text"]);
  expect(fake.created.mock.calls.map(([models]) => models.asr.device)).toEqual(["webgpu", "cpu"]);
});
