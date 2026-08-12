import { describe, expect, it } from "vitest";

import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import { resolve_model_thinking } from "./model-thinking-policy";

describe("模型思考策略", () => {
  it.each([
    ["OpenAI", "unknown-model", "HIGH"],
    ["OpenAI", "deepseek-v3", "HIGH"],
    ["OpenAIResponses", "unknown-model", "MAX"],
    ["Google", "gemini-3-pro-preview", "HIGH"],
    ["Google", "gemini-2.5-flash", "HIGH"],
    ["SakuraLLM", "gpt-5.5", "MAX"],
  ] satisfies ReadonlyArray<readonly [ModelApiFormat, string, ModelThinkingLevel]>)(
    "%s/%s 不猜测 %s 档思考能力",
    (api_format, model_id, requested) => {
      expect(resolve_model_thinking(api_format, model_id, requested)).toBeNull();
    },
  );
});
