import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ models: new Set<string>() }));
vi.mock("../inference/runtime", () => ({
  inference_configuration: () => ({ modelsDirectory: "/models", cacheDirectory: "/cache/media" }),
}));
vi.mock("../inference/models", async (original) => ({
  ...(await original<typeof import("../inference/models")>()),
  model_ready: (_directory: string, model: { file: string }) => fake.models.has(model.file),
}));

beforeEach(() => fake.models.clear());

it("计算前只要求本次消费的模型", async () => {
  const { require_models } = await import("./preparation");
  fake.models.add(MEDIA_MODELS.det_cpu.file);
  expect(() => require_models(["det_cpu"])).not.toThrow();
  expect(() => require_models(["det_cpu", "det_gpu"])).toThrow(
    `Media models are missing (${MEDIA_MODELS.det_gpu.file}); call prepare_models() first.`,
  );
});
