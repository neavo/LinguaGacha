import { expect, it } from "vitest";
import { create_pi_model_index, type PiCatalogModel } from "./pi-model-index";

it("精确匹配优先，分隔别名保留最长且唯一 ID 的所有供应商记录", () => {
  const standard = model("chat-pro");
  const large = model("chat-pro-large");
  const mirror = { ...large, provider: "hosted" };
  const index = create_pi_model_index([
    standard,
    model("model-one"),
    model("model-two"),
    large,
    mirror,
  ]);

  expect(index.match_models(" CHAT-PRO ")).toEqual([standard]);
  expect(index.match_models("vendor/chat-pro-large-fast")).toEqual([large, mirror]);
  expect(index.match_models("chat-pro2")).toEqual([]);
  expect(index.match_models("model-one+model-two")).toEqual([]);
});

/** 自有模型记录只用于验证名称匹配，与实际供应商目录版本无关。 */
function model(id: string): PiCatalogModel {
  return {
    id,
    provider: "fixture",
    api: "openai-responses",
    baseUrl: "https://example.com/v1",
    reasoning: false,
    contextWindow: 100,
    maxTokens: 20,
  };
}
