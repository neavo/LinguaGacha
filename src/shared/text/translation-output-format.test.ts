import { describe, expect, it } from "vitest";

import {
  build_translation_output_format,
  fill_translation_output_format_placeholder,
} from "./translation-output-format";

describe("翻译输出格式提示", () => {
  it("纯文本模式生成对应语言的 JSONLINE 字符串示例", () => {
    expect(build_translation_output_format("text", "zh")).toBe(
      '```jsonline\n{"<序号>":"<译文文本>"}\n```',
    );
    expect(build_translation_output_format("text", "en")).toBe(
      '```jsonline\n{"<INDEX>":"<Translated Text>"}\n```',
    );
  });

  it("actor/text 模式生成姓名与正文对象示例", () => {
    expect(build_translation_output_format("actor_text", "zh")).toBe(
      '```jsonline\n{"<序号>":{"actor":"<姓名译文或null>","text":"<正文译文>"}}\n```',
    );
    expect(build_translation_output_format("actor_text", "en")).toBe(
      '```jsonline\n{"<INDEX>":{"actor":"<Translated Actor or null>","text":"<Translated Text>"}}\n```',
    );
  });

  it("填充模板时只替换翻译输出格式占位符", () => {
    const result = fill_translation_output_format_placeholder(
      "输出格式：\n{translation_output_format}\n其它占位：{target_language}",
      "text",
      "zh",
    );

    expect(result).toBe(
      '输出格式：\n```jsonline\n{"<序号>":"<译文文本>"}\n```\n其它占位：{target_language}',
    );
  });
});
