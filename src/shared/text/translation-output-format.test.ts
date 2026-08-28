import { describe, expect, it } from "vitest";

import {
  build_translation_output_format,
  fill_translation_output_format_placeholder,
} from "./translation-output-format";

describe("翻译输出格式提示", () => {
  it.each([
    ["text", "zh", '```jsonline\n{"index":<序号>,"text":"<译文文本>"}\n```'],
    ["text", "en", '```jsonline\n{"index":<INDEX>,"text":"<Translated Text>"}\n```'],
    [
      "actor_text",
      "zh",
      '```jsonline\n{"index":<序号>,"actor":"<姓名译文或null>","text":"<正文译文>"}\n```',
    ],
    [
      "actor_text",
      "en",
      '```jsonline\n{"index":<INDEX>,"actor":"<Translated Actor or null>","text":"<Translated Text>"}\n```',
    ],
  ] as const)("%s 模式生成 %s JSONLINE 协议示例", (mode, language, expected) => {
    expect(build_translation_output_format(mode, language)).toBe(expected);
  });

  it("填充模板时只替换翻译输出格式占位符", () => {
    const result = fill_translation_output_format_placeholder(
      "输出格式：\n{translation_output_format}\n其它占位：{target_language}",
      "text",
      "zh",
    );

    expect(result).toBe(
      '输出格式：\n```jsonline\n{"index":<序号>,"text":"<译文文本>"}\n```\n其它占位：{target_language}',
    );
  });
});
