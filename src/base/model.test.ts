import { describe, expect, it } from "vitest";

import { Model } from "./model";

describe("model 基础模型", () => {
  it("规范化模型类型、API 格式和 thinking 档位", () => {
    expect(Model.normalize_type("CUSTOM_GOOGLE")).toBe("CUSTOM_GOOGLE");
    expect(Model.normalize_type("bad")).toBe("PRESET");
    expect(Model.normalize_api_format("Anthropic")).toBe("Anthropic");
    expect(Model.normalize_api_format("bad")).toBe("OpenAI");
    expect(Model.normalize_thinking_level("HIGH")).toBe("HIGH");
    expect(Model.normalize_thinking_level("bad")).toBe("OFF");
  });

  it("从基础映射派生排序和模板文件", () => {
    expect(Model.resolve_type_sort_order("CUSTOM_OPENAI")).toBe(2);
    expect(Model.resolve_type_sort_order("bad")).toBe(99);
    expect(Model.resolve_template_filename("CUSTOM_ANTHROPIC")).toBe(
      "preset_model_custom_anthropic.json",
    );
    expect(Model.resolve_template_filename("PRESET")).toBeNull();
  });
});
