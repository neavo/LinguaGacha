import { describe, expect, it } from "vitest";

import {
  normalize_model_api_format,
  normalize_model_thinking_level,
  normalize_model_type,
  resolve_model_template_filename,
  resolve_model_type_sort_order,
} from "./model";

describe("model 基础模型", () => {
  it("规范化模型类型、API 格式和 thinking 档位", () => {
    expect(normalize_model_type("CUSTOM_GOOGLE")).toBe("CUSTOM_GOOGLE");
    expect(normalize_model_type("bad")).toBe("PRESET");
    expect(normalize_model_api_format("Anthropic")).toBe("Anthropic");
    expect(normalize_model_api_format("bad")).toBe("OpenAI");
    expect(normalize_model_thinking_level("HIGH")).toBe("HIGH");
    expect(normalize_model_thinking_level("bad")).toBe("OFF");
  });

  it("从基础映射派生排序和模板文件", () => {
    expect(resolve_model_type_sort_order("CUSTOM_OPENAI")).toBe(2);
    expect(resolve_model_type_sort_order("bad")).toBe(99);
    expect(resolve_model_template_filename("CUSTOM_ANTHROPIC")).toBe(
      "preset_model_custom_anthropic.json",
    );
    expect(resolve_model_template_filename("PRESET")).toBeNull();
  });
});
