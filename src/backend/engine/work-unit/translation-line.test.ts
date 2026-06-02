import { describe, expect, it } from "vitest";

import {
  normalize_translation_actor,
  read_translation_text_srcs,
  resolve_translation_prompt_mode,
  type TranslationLine,
} from "./translation-line";

describe("翻译行模型", () => {
  it("归一姓名字段时只接受字符串姓名", () => {
    expect(normalize_translation_actor(null)).toBeNull();
    expect(normalize_translation_actor("  虎鉄  ")).toBe("虎鉄");
    expect(normalize_translation_actor("  ")).toBeNull();
    expect(normalize_translation_actor(["", " Alice ", 1, "Bob"])).toBeNull();
    expect(normalize_translation_actor([])).toBeNull();
    expect(normalize_translation_actor([" ", ""])).toBeNull();
  });

  it("单次请求内存在有效姓名时切换到 actor/text 模式", () => {
    const lines = [
      create_line({ request_index: 0, text_src: "正文一", actor_src: null }),
      create_line({ request_index: 1, text_src: "正文二", actor_src: "虎鉄" }),
    ];

    expect(resolve_translation_prompt_mode(lines)).toBe("actor_text");
    expect(read_translation_text_srcs(lines)).toEqual(["正文一", "正文二"]);
  });

  it("没有有效姓名的请求保持纯文本模式", () => {
    expect(
      resolve_translation_prompt_mode([
        create_line({ request_index: 0, text_src: "正文", actor_src: null }),
      ]),
    ).toBe("text");
  });
});

/**
 * 构造最小翻译行，测试通过 overrides 声明业务差异。
 */
function create_line(overrides: Partial<TranslationLine>): TranslationLine {
  return {
    request_index: 0,
    item_index: 0,
    line_index: 0,
    text_src: "",
    actor_src: null,
    ...overrides,
  };
}
