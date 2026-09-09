import { describe, expect, it } from "vitest";

import {
  build_translation_output_format,
  fill_translation_output_format_placeholder,
} from "./translation-output-format";

describe("翻译输出格式提示", () => {
  it.each(["zh", "en"] as const)("%s 示例按请求模式声明 JSONL 字段", (language) => {
    expect(build_translation_output_format("text", language)).toMatch(
      /^```jsonline\n\{"id":<ID>,"text":"[^"\n]+"\}\n```$/u,
    );
    expect(build_translation_output_format("actor_text", language)).toMatch(
      /^```jsonline\n\{"id":<ID>,"actor":"[^"\n]+","text":"[^"\n]+"\}\n```$/u,
    );
  });

  it("填充模板时只替换翻译输出格式占位符", () => {
    const result = fill_translation_output_format_placeholder(
      "输出格式：\n{translation_output_format}\n其它占位：{target_language}",
      "text",
      "zh",
    );

    expect(result).toBe(
      `输出格式：\n${build_translation_output_format("text", "zh")}\n其它占位：{target_language}`,
    );
  });
});
