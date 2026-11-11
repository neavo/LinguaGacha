import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ close: vi.fn(), created: vi.fn(), uv: vi.fn() }));
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
const python_root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-media-python-"));
vi.mock("../uv", () => ({ uv: { directory: python_root, run: fake.uv } }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/shared/node/node_modules/onnxruntime-node/index.js" }),
}));

afterAll(() => fs.rmSync(python_root, { recursive: true, force: true }));

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

it("Python 环境缺失时明确失败，补齐解释器后可定位且不隐式同步", async () => {
  const { python } = await import("./engine");
  expect(() => python()).toThrow("run uv sync --inexact through @lg/uv first");
  expect(fake.uv).not.toHaveBeenCalled();
  const executable = path.join(
    python_root,
    ".venv",
    ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "");
  expect(python()).toBe(executable);
});
