import { beforeEach, expect, it, vi } from "vitest";
import { MEDIA_MODELS } from "./models";

const fake = vi.hoisted(() => ({ models: new Set<string>() }));
vi.mock("../inference/runtime", () => ({
  inference_configuration: () => ({ modelsDirectory: "/models", cacheDirectory: "/cache/media" }),
}));
vi.mock("../inference/models", async (original) => ({
  ...(await original<typeof import("../inference/models")>()),
  model_exists: (_directory: string, model: { file: string }) => fake.models.has(model.file),
}));

beforeEach(() => fake.models.clear());

it("计算前只要求本次消费的模型", async () => {
  const { require_models } = await import("./preparation");
  fake.models.add(MEDIA_MODELS.detection.file);
  expect(() => require_models(["detection"])).not.toThrow();
  expect(() => require_models(["detection", "recognition"])).toThrow(
    `Media models are missing (${MEDIA_MODELS.recognition.file}); call prepare_models() first.`,
  );
});
